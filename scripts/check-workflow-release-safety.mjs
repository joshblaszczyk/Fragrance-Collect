import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflowDirectory = join(root, '.github', 'workflows');
const workflows = new Map(
  readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => [name, readFileSync(join(workflowDirectory, name), 'utf8')])
);
const failures = [];
const approvedActions = new Map([
  ['actions/checkout', 'd23441a48e516b6c34aea4fa41551a30e30af803'],
  ['actions/setup-node', '249970729cb0ef3589644e2896645e5dc5ba9c38']
]);

for (const [name, source] of workflows) {
  if (/\bpull_request_target\s*:/.test(source)) failures.push(`${name}: pull_request_target is prohibited`);
  if (/\bpages\s*:\s*write|\bid-token\s*:\s*write|\bcontents\s*:\s*write/.test(source)) {
    failures.push(`${name}: workflow requests unnecessary write permissions`);
  }
  if (/\bd1\s+migrations\s+apply\b/.test(source)) failures.push(`${name}: workflows must never apply D1 migrations`);
  if (/\bwrangler\s+(?:versions\s+)?secret\s+(?:put|delete|bulk)\b|--secrets-file\b/.test(source)) {
    failures.push(`${name}: workflows must never create, rotate, or delete Worker secrets`);
  }
  if (/peaceiris\/actions-gh-pages|actions\/deploy-pages|wrangler pages deploy/i.test(source)) {
    failures.push(`${name}: legacy or split-host frontend deployment is prohibited`);
  }
  for (const match of source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
    const action = match[1];
    if (!action.startsWith('./') && !/@[0-9a-f]{40}$/.test(action)) {
      failures.push(`${name}: action is not pinned to a full commit SHA (${action})`);
      continue;
    }
    if (!action.startsWith('./')) {
      const separator = action.lastIndexOf('@');
      const actionName = action.slice(0, separator);
      const actionSha = action.slice(separator + 1);
      if (!approvedActions.has(actionName)) failures.push(`${name}: action is not on the reviewed allowlist (${actionName})`);
      else if (approvedActions.get(actionName) !== actionSha) failures.push(`${name}: ${actionName} does not use its reviewed SHA`);
    }
  }
  if (!/node-version:\s*['"]?22(?:\.|['"\s]|$)/.test(source)) failures.push(`${name}: Node 22 is not configured`);
}

const ci = workflows.get('ci.yml') || '';
if (!/pull_request\s*:/.test(ci) || !/push\s*:/.test(ci)) failures.push('ci.yml: PR and push validation triggers are required');
if (/wrangler\s+deploy|CLOUDFLARE_API_TOKEN/.test(ci)) failures.push('ci.yml: validation workflow must not have deployment authority');

const release = workflows.get('release-cloudflare.yml') || '';
if (!/workflow_dispatch\s*:/.test(release) || /(?:^|\n)\s+(?:push|pull_request)\s*:/.test(release)) {
  failures.push('release-cloudflare.yml: production release must be manual-only');
}
if (!/environment:\s*[\s\S]{0,100}name:\s*production/.test(release)) failures.push('release-cloudflare.yml: production environment gate is missing');
if (!/cancel-in-progress:\s*false/.test(release)) failures.push('release-cloudflare.yml: production deployments must not cancel one another');
if ((release.match(/git rev-parse origin\/main/g) || []).length < 2) {
  failures.push('release-cloudflare.yml: validation and release jobs must both reject a stale main SHA');
}
if (!/\n  validate:\s*\n/.test(release) || !/\n  release:\s*\n\s+needs:\s*validate\s*\n/.test(release)) {
  failures.push('release-cloudflare.yml: unprivileged validation must pass before the environment-gated release job');
}
const validationJobStart = release.indexOf('\n  validate:');
const releaseJobStart = release.indexOf('\n  release:');
const validationJob = validationJobStart >= 0 && releaseJobStart > validationJobStart
  ? release.slice(validationJobStart, releaseJobStart)
  : '';
if (/CLOUDFLARE_API_TOKEN|\$\{\{\s*secrets\./.test(validationJob)) {
  failures.push('release-cloudflare.yml: pre-approval validation job must not reference deployment secrets');
}
const secretCheck = release.indexOf('check:cloudflare-worker-secrets');
const d1Check = release.indexOf('check:cloudflare-d1');
const deploy = release.indexOf('wrangler deploy');
if (secretCheck < 0 || deploy < 0 || secretCheck > deploy) failures.push('release-cloudflare.yml: name-only Worker secret validation must precede deployment');
if (d1Check < 0 || deploy < 0 || d1Check > deploy) failures.push('release-cloudflare.yml: read-only D1 prerequisite validation must precede deployment');

if (failures.length) {
  console.error('Workflow release-safety validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Workflow release-safety validation passed for ${workflows.size} workflows.`);
