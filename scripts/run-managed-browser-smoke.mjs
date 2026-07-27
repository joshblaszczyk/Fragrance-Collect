import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const workerDirectory = join(root, 'weathered-mud-6ed5');
const wrangler = join(workerDirectory, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

async function findAvailablePort(rawPort, label, excluded = new Set()) {
  const requested = rawPort ? Number.parseInt(rawPort, 10) : 0;
  if (!Number.isInteger(requested) || requested < 0 || requested > 65_535) {
    throw new Error(`${label} must be an integer from 0 (automatic) through 65535.`);
  }
  for (;;) {
    const server = createServer();
    server.unref();
    const port = await new Promise((resolvePort, reject) => {
      server.once('error', reject);
      server.listen(requested, '127.0.0.1', () => resolvePort(server.address().port));
    });
    await new Promise((resolveClose) => server.close(resolveClose));
    if (!excluded.has(port)) return port;
    if (requested) throw new Error(`${label} must differ from the other managed smoke port.`);
  }
}

const sitePort = await findAvailablePort(process.env.SMOKE_SITE_PORT, 'SMOKE_SITE_PORT');
const cdpPort = await findAvailablePort(process.env.SMOKE_CDP_PORT, 'SMOKE_CDP_PORT', new Set([sitePort]));
const siteOrigin = `http://127.0.0.1:${sitePort}`;
const cdpOrigin = `http://127.0.0.1:${cdpPort}`;
const taskkill = process.platform === 'win32'
  ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
  : null;
const candidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
].filter(Boolean);
const chrome = candidates.find(existsSync);

if (!chrome) {
  console.error('Managed browser smoke requires Chrome/Chromium or CHROME_PATH.');
  process.exit(1);
}

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('Managed browser smoke requires a prepared dist artifact. Run build:cloudflare first.');
  process.exit(1);
}

const temporaryRoot = mkdtempSync(join(tmpdir(), 'fragrance-browser-smoke-'));
const profile = join(temporaryRoot, 'chrome');
const d1State = join(temporaryRoot, 'wrangler-state');
const smokeEnv = join(temporaryRoot, 'smoke.env');
writeFileSync(smokeEnv, '# Managed release smoke intentionally loads no local secrets.\n', { mode: 0o600 });

function removeTemporaryRoot() {
  rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function processStatus(child) {
  return new Promise((resolveStatus) => {
    child.once('error', () => resolveStatus(1));
    child.once('exit', (code) => resolveStatus(code ?? 1));
  });
}

const migration = spawn(process.execPath, [
  wrangler,
  'd1',
  'migrations',
  'apply',
  'fragrance-collect-db',
  '--local',
  '--persist-to',
  d1State,
  '--env-file',
  smokeEnv
], {
  cwd: workerDirectory,
  env: { ...process.env, CI: 'true' },
  stdio: 'inherit'
});
const migrationStatus = await processStatus(migration);
if (migrationStatus !== 0) {
  removeTemporaryRoot();
  console.error(`Local D1 migration setup failed with status ${migrationStatus}.`);
  process.exit(1);
}

// Applying migrations successfully is not enough: attest the exact ordered
// migration ledger and the schema markers the selected Worker requires before
// launching a browser against it. This is the same read-only contract used by
// the controlled production release, exercised here against isolated state.
const d1Preflight = spawn(process.execPath, [
  join(root, 'scripts', 'check-cloudflare-d1-prerequisites.mjs'),
  '--local',
  '--persist-to',
  d1State
], {
  cwd: root,
  env: { ...process.env, CI: 'true' },
  stdio: 'inherit'
});
const d1PreflightStatus = await processStatus(d1Preflight);
if (d1PreflightStatus !== 0) {
  removeTemporaryRoot();
  console.error(`Local D1 schema attestation failed with status ${d1PreflightStatus}.`);
  process.exit(1);
}

const server = spawn(process.execPath, [
  wrangler,
  'dev',
  '--local',
  '--ip',
  '127.0.0.1',
  '--port',
  String(sitePort),
  '--persist-to',
  d1State,
  '--env-file',
  smokeEnv,
  '--var',
  'ALLOW_LOCAL_ORIGINS:true',
  '--var',
  'LOCAL_EMAIL_VERIFICATION_BYPASS:true',
  '--var',
  `PUBLIC_SITE_URL:${siteOrigin}`,
  '--show-interactive-dev-session=false'
], {
  cwd: workerDirectory,
  env: { ...process.env, NODE_ENV: 'test' },
  detached: process.platform !== 'win32',
  stdio: ['ignore', 'pipe', 'pipe']
});
const browser = spawn(chrome, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--remote-debugging-address=127.0.0.1',
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${profile}`,
  'about:blank'
], {
  detached: process.platform !== 'win32',
  stdio: ['ignore', 'pipe', 'pipe']
});

const diagnostic = [];
for (const child of [server, browser]) {
  child.on('error', (error) => {
    diagnostic.push(error.message);
    if (diagnostic.length > 40) diagnostic.shift();
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk) => {
      diagnostic.push(String(chunk));
      if (diagnostic.length > 40) diagnostic.shift();
    });
  }
}

async function waitFor(url, label) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The managed process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready.`);
}

function exited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs) {
  if (exited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(exited(child));
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

function signalProcessTree(child, signal) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
    return true;
  } catch {
    return exited(child);
  }
}

async function stop(child) {
  if (!child?.pid || exited(child)) return;

  if (process.platform === 'win32') {
    spawnSync(taskkill, ['/PID', String(child.pid), '/T'], {
      stdio: 'ignore',
      windowsHide: true
    });
  } else {
    signalProcessTree(child, 'SIGTERM');
  }
  if (await waitForExit(child, 2_000)) return;

  if (process.platform === 'win32') {
    spawnSync(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });
  } else {
    signalProcessTree(child, 'SIGKILL');
  }
  await waitForExit(child, 2_000);
}

try {
  await Promise.all([
    waitFor(`${siteOrigin}/api/version`, 'Same-origin Worker and static site'),
    waitFor(`${cdpOrigin}/json/version`, 'Chrome debugging endpoint')
  ]);

  // Exercise the real Worker/D1 account lifecycle before browser requests are
  // intercepted for deterministic visual fixtures. This catches schema,
  // cookie, verification, favorites, export, and account-deletion regressions
  // in the same isolated release candidate used by the managed smoke test.
  const accountContract = spawn(process.execPath, [
    join(root, 'scripts', 'check-local-account-api.mjs')
  ], {
    cwd: root,
    env: {
      ...process.env,
      LOCAL_API_BASE: siteOrigin,
      LOCAL_SITE_ORIGIN: siteOrigin,
      LOCAL_EXPECT_FULL_HEALTH: 'false',
      LOCAL_EXPECT_WATCHES: 'false'
    },
    stdio: 'inherit'
  });
  const accountContractStatus = await processStatus(accountContract);
  if (accountContractStatus !== 0) {
    throw new Error(`Real Worker/D1 account contract exited with status ${accountContractStatus}.`);
  }

  const smoke = spawn(process.execPath, ['scripts/browser-smoke.mjs'], {
    cwd: root,
    env: { ...process.env, SITE_ORIGIN: siteOrigin, CDP_ORIGIN: cdpOrigin },
    stdio: 'inherit'
  });
  const status = await processStatus(smoke);
  if (status !== 0) throw new Error(`Browser smoke exited with status ${status}.`);
} catch (error) {
  console.error(error.message);
  if (diagnostic.length) console.error(diagnostic.join('').slice(-4000));
  process.exitCode = 1;
} finally {
  await Promise.all([stop(browser), stop(server)]);
  removeTemporaryRoot();
}
