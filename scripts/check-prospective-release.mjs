import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const requireClean = process.argv.includes('--require-clean');
const findings = [];
const stateProblems = [];
const sensitiveFilenames = /^(?:\.dev\.vars(?:\..+)?|\.env(?:\..+)?|secrets?\.json|credentials?\.json)$/i;
const allowedExampleFilenames = /^(?:\.env|\.dev\.vars)\.(?:example|sample|template)$/i;
const ignoredContentPaths = [
  /(?:^|[\\/])node_modules[\\/]/,
  /(?:^|[\\/])\.git[\\/]/,
  /package-lock\.json$/,
  /^scripts[\\/]check-secrets\.mjs$/,
  /^scripts[\\/]check-prospective-release\.mjs$/
];
const credentialPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Resend API key', /\bre_[A-Za-z0-9_-]{20,}\b/],
  ['GitHub access token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack access token', /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/],
  ['Cloudflare API token', /\bcfut_[A-Za-z0-9_-]{20,}\b/],
  ['JWT credential', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['Cloudflare API token assignment', /\bCLOUDFLARE_API_TOKEN\b\s*[:=]\s*['"][^'"\r\n]{20,}['"]/]
];
const secretAssignment = /\b(CJ_DEV_KEY|CJ_PERSONAL_ACCESS_TOKEN|RESEND_API_KEY|ADMIN_EMAILS|GOOGLE_CLIENT_SECRET|CLOUDFLARE_API_TOKEN)\b\s*[:=]\s*(?:(['"])([^'"\r\n]{8,})\2|([^\s#,\r\n]{8,}))/g;
const safePlaceholder = /(?:example|placeholder|replace|test[-_ ]?only|your[-_ ]|<[^>]+>|\$\{\{\s*secrets\.)/i;
const safeTestCredential = /^test(?:-[a-z0-9]+)*-(?:token|key|secret)$/i;

function gitLines(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .map((value) => value.replaceAll('\\', '/'));
}

function displayPath(path) {
  return relative(root, path).replaceAll('\\', '/');
}

function inspectFile(repositoryPath) {
  const absolutePath = join(root, repositoryPath);
  if (!existsSync(absolutePath)) return;
  const filename = basename(repositoryPath);
  if (sensitiveFilenames.test(filename) && !allowedExampleFilenames.test(filename)) {
    findings.push(`${repositoryPath}: credential-bearing filename is prospective release content`);
  }

  const fileStatus = lstatSync(absolutePath);
  if (fileStatus.isSymbolicLink()) {
    findings.push(`${repositoryPath}: symbolic links are not allowed in prospective release content`);
    return;
  }
  if (!fileStatus.isFile() || ignoredContentPaths.some((pattern) => pattern.test(repositoryPath))) return;
  if (statSync(absolutePath).size > 5 * 1024 * 1024) return;

  const buffer = readFileSync(absolutePath);
  if (buffer.includes(0)) return;
  const content = buffer.toString('utf8');
  for (const [label, pattern] of credentialPatterns) {
    if (pattern.test(content)) findings.push(`${repositoryPath}: possible ${label}`);
  }
  for (const match of content.matchAll(secretAssignment)) {
    const assignedValue = match[3] || match[4] || '';
    if (!safePlaceholder.test(assignedValue) && !safeTestCredential.test(assignedValue)) {
      findings.push(`${repositoryPath}: hard-coded value assigned to ${match[1]}`);
    }
  }
}

let prospectiveFiles;
try {
  prospectiveFiles = gitLines(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
} catch {
  console.error('Prospective release check requires a Git worktree.');
  process.exit(1);
}

for (const repositoryPath of prospectiveFiles) inspectFile(repositoryPath);

if (requireClean) {
  const staged = new Set(gitLines(['diff', '--cached', '--name-only', '-z']));
  const unstaged = new Set(gitLines(['diff', '--name-only', '-z']));
  const untracked = gitLines(['ls-files', '-z', '--others', '--exclude-standard']);
  const mixed = [...staged].filter((path) => unstaged.has(path));

  if (mixed.length) {
    stateProblems.push(`mixed staged/unstaged content: ${mixed.sort().join(', ')}`);
  }
  if (staged.size) {
    stateProblems.push('the Git index differs from HEAD; commit the exact release before pushing');
  }
  if (unstaged.size) {
    stateProblems.push('tracked working files differ from the Git index');
  }
  if (untracked.length) {
    stateProblems.push(`untracked prospective files would be omitted from the push: ${untracked.sort().join(', ')}`);
  }
}

if (findings.length) {
  console.error('Prospective release content scan failed:');
  for (const finding of [...new Set(findings)].sort()) console.error(`- ${finding}`);
}
if (stateProblems.length) {
  console.error('Exact-release Git state check failed:');
  for (const problem of stateProblems) console.error(`- ${problem}`);
}
if (findings.length || stateProblems.length) process.exit(1);

console.log(
  `Prospective release check passed for ${prospectiveFiles.length} tracked and untracked Git-visible files${requireClean ? ' with a clean HEAD/index/worktree' : ''}.`
);
