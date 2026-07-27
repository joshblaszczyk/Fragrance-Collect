import { copyFile, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'dist');

if (basename(output) !== 'dist' || dirname(output) !== root) {
  throw new Error('Refusing to prepare an unexpected Cloudflare asset directory.');
}
await stat(output).catch(() => {
  throw new Error('Build output is missing. Run the site build before preparing Cloudflare assets.');
});

for (const filename of ['_headers', '_redirects']) {
  await copyFile(join(root, filename), join(output, filename));
}

// CNAME controls GitHub Pages only. Publishing it as a Worker asset would make
// the release artifact ambiguous even though Cloudflare would serve it as text.
await rm(join(output, 'CNAME'), { force: true });

console.log('Prepared dist for a single Cloudflare Worker + Static Assets deployment.');
