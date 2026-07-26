import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const workerDirectory = join(root, 'weathered-mud-6ed5');
const wrangler = join(workerDirectory, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const persistenceDirectory = join(workerDirectory, '.wrangler', 'state');
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error('npm_execpath is unavailable; start the development environment with npm run dev.');
}

mkdirSync(persistenceDirectory, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    stdio: 'inherit',
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

// Build the exact static asset tree first so local navigation, response
// headers, redirects, and API routes all run through one Worker origin.
run(process.execPath, [npmCli, 'run', 'build:cloudflare']);

// Apply migrations only to Wrangler's ignored local state. CI=true prevents an
// interactive confirmation without granting any remote Cloudflare authority.
run(
  process.execPath,
  [
    wrangler,
    'd1',
    'migrations',
    'apply',
    'fragrance-collect-db',
    '--local',
    '--persist-to',
    persistenceDirectory
  ],
  { cwd: workerDirectory, env: { ...process.env, CI: 'true' } }
);

const worker = spawn(
  process.execPath,
  [
    wrangler,
    'dev',
    '--ip',
    '127.0.0.1',
    '--port',
    '8787',
    '--persist-to',
    persistenceDirectory,
    '--var',
    'ALLOW_LOCAL_ORIGINS:true',
    '--var',
    'LOCAL_EMAIL_VERIFICATION_BYPASS:true',
    '--var',
    'PUBLIC_SITE_URL:http://127.0.0.1:8787',
    '--show-interactive-dev-session=false'
  ],
  { cwd: workerDirectory, env: process.env, stdio: 'inherit', shell: false }
);

let shuttingDown = false;

function stop(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!worker.killed) worker.kill(signal);
}

worker.on('exit', (code, signal) => {
  if (shuttingDown) return;
  stop(signal || 'SIGTERM');
  process.exit(code || 0);
});

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

console.log('Fragrance Collect will be available at http://127.0.0.1:8787');
