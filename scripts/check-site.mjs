import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const htmlFiles = readdirSync(root).filter((file) => file.endsWith('.html'));
const failures = [];

function report(file, message) {
  failures.push(`${file}: ${message}`);
}

for (const file of htmlFiles) {
  const source = readFileSync(path.join(root, file), 'utf8');
  const ids = new Set([...source.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
  const seenIds = new Set();

  for (const match of source.matchAll(/\bid=["']([^"']+)["']/g)) {
    if (seenIds.has(match[1])) report(file, `duplicate id "${match[1]}"`);
    seenIds.add(match[1]);
  }

  for (const match of source.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
    const reference = match[1];
    if (!reference || /^(?:https?:|\/\/|data:|mailto:|tel:|javascript:)/.test(reference)) continue;

    const [targetPath, fragment] = reference.split('#');
    const cleanPath = targetPath.split('?')[0];
    const targetFile = cleanPath || file;

    if (cleanPath && !existsSync(path.resolve(root, cleanPath))) {
      report(file, `missing local reference "${reference}"`);
      continue;
    }

    if (fragment && !fragment.includes('?') && targetFile.endsWith('.html')) {
      const targetSource = targetFile === file ? source : readFileSync(path.resolve(root, targetFile), 'utf8');
      const targetIds = targetFile === file
        ? ids
        : new Set([...targetSource.matchAll(/\bid=["']([^"']+)["']/g)].map((idMatch) => idMatch[1]));
      if (!targetIds.has(fragment)) report(file, `missing fragment target "${reference}"`);
    }
  }

  if (!/<html\s[^>]*\blang=["'][^"']+["']/i.test(source)) report(file, 'missing document language');
  if (!/<meta\s[^>]*name=["']viewport["']/i.test(source)) report(file, 'missing viewport metadata');
  if (!/<title>[^<]+<\/title>/i.test(source)) report(file, 'missing page title');
  if (!/<meta\s[^>]*name=["']description["'][^>]*content=["'][^"']{40,}["']/i.test(source)) report(file, 'missing useful meta description');
  if (!/<link\s[^>]*rel=["']canonical["'][^>]*href=["']https:\/\/fragrancecollect\.com\//i.test(source)) report(file, 'missing production canonical URL');
  if (!/<link\s[^>]*rel=["']icon["']/i.test(source)) report(file, 'missing site icon');
  if (!/<main\b[^>]*>/i.test(source)) report(file, 'missing main landmark');
  if ((source.match(/<h1\b/gi) || []).length !== 1) report(file, 'must contain exactly one h1');
  if (!/<meta\s[^>]*http-equiv=["']Content-Security-Policy["']/i.test(source)) report(file, 'missing Content Security Policy');
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(source)) report(file, 'contains an inline script');
  if (/\son[a-z]+\s*=/i.test(source)) report(file, 'contains an inline event handler');
  if (/href=["'][^"']*#[^"']*\?/i.test(source)) report(file, 'contains a query string after a URL fragment');

  if (source.includes('fragrance-header')) {
    if ((source.match(/<nav\s[^>]*class=["']fragrance-header["']/gi) || []).length !== 1) report(file, 'must contain exactly one primary header');
    if ((source.match(/class=["']mobile-nav-menu["']/gi) || []).length !== 1) report(file, 'must contain exactly one mobile navigation menu');
    if ((source.match(/class=["']mobile-nav-backdrop["']/gi) || []).length !== 1) report(file, 'must contain exactly one mobile navigation backdrop');
    if (!/class=["']skip-link["']\s+href=["']#main-content["']/i.test(source)) report(file, 'missing skip link');
  }
}

if (failures.length) {
  console.error(`Site validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Site validation passed for ${htmlFiles.length} HTML files.`);
