import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const deployedApiOrigin = 'https://weathered-mud-6ed5.joshuablaszczyk.workers.dev';
const source = readFileSync(resolve(root, '_headers'), 'utf8');
const built = readFileSync(resolve(root, 'dist/_headers'), 'utf8');
const failures = [];

if (source !== built) failures.push('dist/_headers does not exactly match the reviewed source file');
const lines = source.split(/\r?\n/);
if (lines.some((line) => line.length > 2000)) failures.push('_headers contains a line longer than Cloudflare\'s 2,000-character limit');

const rules = [];
let current = null;
for (const rawLine of lines) {
  const line = rawLine.trimEnd();
  if (!line.trim() || line.trimStart().startsWith('#')) continue;
  if (!/^\s/.test(rawLine)) {
    current = { pattern: line.trim(), headers: new Map() };
    rules.push(current);
    continue;
  }
  const match = line.trim().match(/^([^:]+):\s*(.+)$/);
  if (!current || !match) {
    failures.push(`invalid _headers line near "${line.trim().slice(0, 60)}"`);
    continue;
  }
  const name = match[1].trim().toLowerCase();
  if (current.headers.has(name)) failures.push(`${current.pattern} repeats ${name}; Cloudflare would join both values`);
  current.headers.set(name, match[2].trim());
}

if (rules.length > 100) failures.push('_headers exceeds Cloudflare\'s 100-rule limit');
const globalRule = rules.find((rule) => rule.pattern === '/*');
if (!globalRule) failures.push('missing global /* security-header rule');

const requiredHeaders = [
  'content-security-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy'
];
for (const header of requiredHeaders) {
  if (!globalRule?.headers.has(header)) failures.push(`global rule is missing ${header}`);
}

const csp = globalRule?.headers.get('content-security-policy') || '';
for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
  if (!csp.includes(directive)) failures.push(`Content-Security-Policy is missing ${directive}`);
}
if (globalRule?.headers.get('x-frame-options') !== 'DENY') failures.push('global X-Frame-Options must be DENY');
if (/unsafe-eval|https:\/\/\*\.workers\.dev/i.test(csp)) {
  failures.push('Content-Security-Policy contains an unsafe evaluator or wildcard Worker endpoint');
}
const connectSrc = csp.match(/(?:^|;)\s*connect-src\s+([^;]+)/i)?.[1] || '';
const connectSources = connectSrc.split(/\s+/).filter(Boolean);
const connectSourceSet = new Set(connectSources);
if (!connectSourceSet.has(deployedApiOrigin)) {
  failures.push(`connect-src must allow the exact API origin ${deployedApiOrigin}`);
}
const configuredWorkerOrigins = [...new Set(
  connectSources.filter((source) => /^https:\/\/[A-Za-z0-9.-]+\.workers\.dev$/i.test(source))
)];
if (configuredWorkerOrigins.length !== 1 || configuredWorkerOrigins[0] !== deployedApiOrigin) {
  failures.push('connect-src must not allow any workers.dev origin except the deployed API');
}

for (const path of ['/auth', '/account', '/admin']) {
  const rule = rules.find((entry) => entry.pattern === path);
  if (!/\bprivate\b/i.test(rule?.headers.get('cache-control') || '')
    || !/\bno-store\b/i.test(rule?.headers.get('cache-control') || '')) {
    failures.push(`${path} must use a private, no-store cache policy at its canonical URL`);
  }
}
if (globalRule?.headers.get('referrer-policy') !== 'strict-origin-when-cross-origin') {
  failures.push('global Referrer-Policy must expose only the origin to cross-origin identity providers');
}

const workersRule = rules.find((rule) => /\.workers\.dev\/\*$/.test(rule.pattern));
if (!/\bnoindex\b/i.test(workersRule?.headers.get('x-robots-tag') || '')) {
  failures.push('workers.dev host rule must prevent duplicate search indexing');
}

if (failures.length) {
  console.error('Cloudflare static security-header validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Cloudflare static security-header validation passed for ${rules.length} rules.`);
