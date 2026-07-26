const origin = String(process.env.PRODUCTION_SITE_ORIGIN || 'https://fragrancecollect.com').replace(/\/$/, '');
const productionHostname = new URL(origin).hostname;
const paths = ['/', '/auth', '/account', '/admin', '/assets/images/emblem-96.webp'];
const privatePaths = new Set(['/auth', '/account', '/admin']);
const required = [
  'content-security-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy'
];
const failures = [];

for (const path of paths) {
  let response;
  try {
    response = await fetch(`${origin}${path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: path.endsWith('.webp') ? 'image/webp' : 'text/html' }
    });
  } catch {
    failures.push(`${path}: request failed`);
    continue;
  }
  if (!response.ok) failures.push(`${path}: returned HTTP ${response.status}`);
  for (const header of required) {
    if (!response.headers.get(header)) failures.push(`${path}: missing ${header}`);
  }
  const csp = response.headers.get('content-security-policy') || '';
  if (/unsafe-eval|weathered-mud-6ed5|\*\.workers\.dev/i.test(csp)) {
    failures.push(`${path}: CSP contains an unsafe evaluator or obsolete cross-origin Worker endpoint`);
  }
  if (!csp.includes("frame-ancestors 'none'")) failures.push(`${path}: CSP does not prohibit framing`);
  if (response.headers.get('x-frame-options') !== 'DENY') failures.push(`${path}: X-Frame-Options is not DENY`);
  if (privatePaths.has(path)) {
    const cacheControl = response.headers.get('cache-control') || '';
    if (!/\bprivate\b/i.test(cacheControl) || !/\bno-store\b/i.test(cacheControl)) {
      failures.push(`${path}: canonical private page is cacheable`);
    }
  }
  if (path === '/auth' && response.headers.get('referrer-policy') !== 'no-referrer') {
    failures.push('/auth: one-time credential page must use Referrer-Policy: no-referrer');
  }
}

const health = await fetch(`${origin}/api/health`, {
  signal: AbortSignal.timeout(15_000),
  headers: { Accept: 'application/json' }
}).catch(() => null);
if (!health?.ok) failures.push('/api/health is not healthy on the same production origin');
else if (!/application\/json/i.test(health.headers.get('content-type') || '')) failures.push('/api/health did not return JSON');

if (productionHostname === 'fragrancecollect.com') {
  const wwwResponse = await fetch('https://www.fragrancecollect.com/cutover-check?source=www', {
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'text/html' }
  }).catch(() => null);
  const wwwLocation = wwwResponse?.headers.get('location') || '';
  if (wwwResponse?.status !== 308
    || wwwLocation !== 'https://fragrancecollect.com/cutover-check?source=www') {
    failures.push('www does not permanently redirect to the canonical apex while preserving the path and query');
  }
}

if (failures.length) {
  console.error('Production Cloudflare header/cutover check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Production Cloudflare headers and same-origin API passed for ${origin}.`);
