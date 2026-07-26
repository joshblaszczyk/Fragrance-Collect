import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const findings = [];
const ignoredContentPaths = [
  /(?:^|[\\/])node_modules[\\/]/,
  /(?:^|[\\/])\.git[\\/]/,
  /(?:^|[\\/])\.artifacts[\\/]/,
  /package-lock\.json$/
];
const sensitiveFilenames = /^(?:\.dev\.vars(?:\..+)?|\.env(?:\..+)?|secrets?\.json|credentials?\.json)$/i;
const allowedExampleFilenames = /^(?:\.env|\.dev\.vars)\.(?:example|sample|template)$/i;
const credentialPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Resend API key', /\bre_[A-Za-z0-9_-]{20,}\b/],
  ['GitHub access token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack access token', /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/],
  ['Cloudflare API token', /\bcfut_[A-Za-z0-9_-]{20,}\b/],
  ['JWT credential', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/]
];
const secretAssignment = /\b(CJ_DEV_KEY|CJ_PERSONAL_ACCESS_TOKEN|RESEND_API_KEY|ADMIN_EMAILS|GOOGLE_CLIENT_SECRET|CLOUDFLARE_API_TOKEN)\b\s*[:=]\s*(?:(['"])([^'"\r\n]{8,})\2|([^\s#,\r\n]{8,}))/g;
const safePlaceholder = /(?:example|placeholder|replace|test[-_ ]?only|your[-_ ]|<[^>]+>|\$\{\{\s*secrets\.)/i;
const safeTestCredential = /^test(?:-[a-z0-9]+)*-(?:token|key|secret)$/i;

function relativePath(path) {
  return relative(root, path).replaceAll('\\', '/');
}

function readText(path) {
  if (!existsSync(path) || statSync(path).size > 5 * 1024 * 1024) return null;
  const content = readFileSync(path);
  if (content.includes(0)) return null;
  return content.toString('utf8');
}

function inspectContent(path) {
  const displayPath = relativePath(path);
  if (ignoredContentPaths.some((pattern) => pattern.test(displayPath))) return;
  const content = readText(path);
  if (content === null) return;

  for (const [label, pattern] of credentialPatterns) {
    if (pattern.test(content)) findings.push(`${displayPath}: possible ${label}`);
  }
  for (const match of content.matchAll(secretAssignment)) {
    const assignedValue = match[3] || match[4] || '';
    if (!safePlaceholder.test(assignedValue) && !safeTestCredential.test(assignedValue)) {
      findings.push(`${displayPath}: hard-coded value assigned to ${match[1]}`);
    }
  }
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8'
}).split('\0').filter(Boolean);

for (const trackedFile of trackedFiles) {
  const filename = basename(trackedFile);
  if (sensitiveFilenames.test(filename) && !allowedExampleFilenames.test(filename)) {
    findings.push(`${trackedFile}: credential file is tracked by Git`);
  }
  inspectContent(join(root, trackedFile));
}

for (const path of walk(join(root, 'dist'))) inspectContent(path);

if (findings.length) {
  console.error('Secret exposure check failed:');
  for (const finding of [...new Set(findings)].sort()) console.error(`- ${finding}`);
  process.exit(1);
}

console.log('Secret exposure check passed: no credential values are tracked or bundled.');
