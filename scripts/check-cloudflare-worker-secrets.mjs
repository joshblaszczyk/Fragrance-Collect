import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const workerDirectory = join(root, 'weathered-mud-6ed5');
const wrangler = join(workerDirectory, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const requiredSecrets = ['RESEND_API_KEY', 'ADMIN_EMAILS'];
const cjSecretAlternatives = ['CJ_PERSONAL_ACCESS_TOKEN', 'CJ_DEV_KEY'];

function parseSecretNames(rawOutput) {
  let records;
  try {
    records = JSON.parse(rawOutput);
  } catch {
    throw new Error('Wrangler returned an unexpected secret-list response.');
  }
  if (!Array.isArray(records) || records.some((record) => (
    !record || typeof record !== 'object' || typeof record.name !== 'string'
  ))) {
    throw new Error('Wrangler returned an unexpected secret-list response.');
  }
  return new Set(records.map((record) => record.name));
}

function policyFailures(names) {
  const failures = requiredSecrets
    .filter((name) => !names.has(name))
    .map((name) => `missing required Worker secret binding ${name}`);
  if (!cjSecretAlternatives.some((name) => names.has(name))) {
    failures.push(`missing CJ credential binding (${cjSecretAlternatives.join(' or ')})`);
  }
  return failures;
}

if (process.argv.includes('--self-test')) {
  const preferred = parseSecretNames(JSON.stringify([
    { name: 'CJ_PERSONAL_ACCESS_TOKEN', type: 'secret_text', text: 'ignored-value' },
    { name: 'RESEND_API_KEY', type: 'secret_text' },
    { name: 'ADMIN_EMAILS', type: 'secret_text' }
  ]));
  const legacy = new Set(['CJ_DEV_KEY', 'RESEND_API_KEY', 'ADMIN_EMAILS']);
  assert.deepEqual(policyFailures(preferred), []);
  assert.deepEqual(policyFailures(legacy), []);
  assert.deepEqual(policyFailures(new Set()), [
    'missing required Worker secret binding RESEND_API_KEY',
    'missing required Worker secret binding ADMIN_EMAILS',
    'missing CJ credential binding (CJ_PERSONAL_ACCESS_TOKEN or CJ_DEV_KEY)'
  ]);
  assert.throws(() => parseSecretNames('{not-json'));
  assert.throws(() => parseSecretNames(JSON.stringify([{ type: 'secret_text' }])));
  console.log('Cloudflare Worker secret-name policy self-test passed.');
  process.exit(0);
}

if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('Cloudflare Worker secret preflight requires the production environment credentials.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [wrangler, 'secret', 'list', '--format', 'json'], {
  cwd: workerDirectory,
  env: { ...process.env, CI: 'true' },
  encoding: 'utf8',
  maxBuffer: 1024 * 1024
});
if (result.status !== 0) {
  console.error('Cloudflare Worker secret preflight could not list binding names for the configured Worker.');
  process.exit(1);
}

let names;
try {
  names = parseSecretNames(result.stdout);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const failures = policyFailures(names);
if (failures.length) {
  console.error('Cloudflare Worker secret preflight failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Cloudflare Worker secret preflight passed: required binding names exist; no secret values were read.');
