import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const output = path.join(root, 'dist');

if (path.basename(output) !== 'dist' || path.dirname(output) !== root) {
  throw new Error('Refusing to clean an unexpected build directory.');
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const rootEntries = await readdir(root);
const publicFiles = rootEntries.filter((file) =>
  /\.(?:html|css|txt|xml)$/.test(file) && file !== 'main.html' && file !== 'index.html'
);
publicFiles.push(
  '_headers',
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
  'size-guide-script.js'
);

for (const file of new Set(publicFiles)) {
  await cp(path.join(root, file), path.join(output, file));
}

// Publish one homepage entry. Internal navigation and the canonical both point to `/`.
await cp(path.join(root, 'main.html'), path.join(output, 'index.html'));

await cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });

console.log(`Built ${new Set(publicFiles).size} public files, a direct homepage entry, and optimized assets in ${output}.`);
