import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'dist');
const failures = [];
const expected = new Map();
const wranglerConfig = readFileSync(join(root, 'weathered-mud-6ed5', 'wrangler.toml'), 'utf8');

function normalized(path) {
  return relative(output, path).replaceAll('\\', '/');
}

function filesBelow(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(path));
    else files.push(path);
  }
  return files;
}

function expectCopy(sourcePath, outputPath) {
  expected.set(normalized(outputPath), sourcePath);
}

if (!existsSync(output)) {
  console.error('Cloudflare release artifact validation failed: dist is missing.');
  process.exit(1);
}

const assetsSection = wranglerConfig.match(/^\[assets\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1] || '';
if (!/^\s*directory\s*=\s*["']\.\.\/dist["']\s*$/m.test(assetsSection)) {
  failures.push('wrangler.toml must deploy ../dist through a single [assets] configuration');
}

for (const filename of readdirSync(root)) {
  if (/\.(?:html|css|txt|xml)$/.test(filename) && filename !== 'main.html' && filename !== 'index.html') {
    expectCopy(join(root, filename), join(output, filename));
  }
}
for (const filename of [
  'site-config.js',
  'script.js',
  'catalog-selects.js',
  'catalog-features.js',
  'shared-auth.js',
  'universal-header-script.js',
  'auth-script.js',
  'account.js',
  'admin.js',
  'contact-script.js',
  'faq.js',
  'size-guide-script.js',
  '_headers',
  '_redirects'
]) {
  expectCopy(join(root, filename), join(output, filename));
}
expectCopy(join(root, 'main.html'), join(output, 'index.html'));
for (const sourcePath of filesBelow(join(root, 'assets'))) {
  expectCopy(sourcePath, join(output, 'assets', relative(join(root, 'assets'), sourcePath)));
}

const actualPaths = filesBelow(output).map(normalized).sort();
for (const actualPath of actualPaths) {
  const absolutePath = join(output, actualPath);
  if (lstatSync(absolutePath).isSymbolicLink()) failures.push(`${actualPath}: symlinks are not allowed in deployable assets`);
  if (!expected.has(actualPath)) failures.push(`${actualPath}: unexpected or stale build output`);
}
for (const [expectedPath, sourcePath] of expected) {
  const builtPath = join(output, expectedPath);
  if (!existsSync(builtPath)) {
    failures.push(`${expectedPath}: expected build output is missing`);
    continue;
  }
  if (!readFileSync(sourcePath).equals(readFileSync(builtPath))) {
    failures.push(`${expectedPath}: build output differs from its reviewed source`);
  }
}

for (const htmlPath of actualPaths.filter((path) => path.endsWith('.html'))) {
  const html = readFileSync(join(output, htmlPath), 'utf8');
  for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
    const reference = match[1];
    if (!reference || /^(?:https?:|\/\/|data:|mailto:|tel:|javascript:|#)/.test(reference)) continue;
    const clean = reference.split(/[?#]/, 1)[0];
    const target = clean.startsWith('/')
      ? resolve(output, clean.slice(1))
      : resolve(join(output, htmlPath, '..'), clean);
    const relativeTarget = relative(output, target);
    const escapesOutput = relativeTarget.startsWith('..') || isAbsolute(relativeTarget);
    if (escapesOutput) {
      failures.push(`${htmlPath}: local reference escapes the release artifact (${reference})`);
    } else if (!existsSync(target)) {
      failures.push(`${htmlPath}: local reference is absent from the release artifact (${reference})`);
    }
  }
}

for (const forbidden of ['CNAME', 'main.html', '.env', '.dev.vars', 'secrets.json', 'credentials.json']) {
  if (existsSync(join(output, forbidden))) failures.push(`${forbidden}: forbidden deployment-only or credential file is present`);
}

if (failures.length) {
  console.error('Cloudflare release artifact validation failed:');
  for (const failure of [...new Set(failures)].sort()) console.error(`- ${failure}`);
  process.exit(1);
}

const digest = createHash('sha256');
for (const path of actualPaths) {
  digest.update(path).update('\0').update(readFileSync(join(output, path))).update('\0');
}
console.log(`Cloudflare release artifact passed: ${actualPaths.length} exact files, digest ${digest.digest('hex')}.`);
