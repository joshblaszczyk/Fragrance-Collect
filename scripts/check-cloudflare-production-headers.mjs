const siteOrigin = String(process.env.PRODUCTION_SITE_ORIGIN || 'https://fragrancecollect.com').replace(/\/$/, '');
const apiOrigin = String(
  process.env.PRODUCTION_API_ORIGIN
    || 'https://weathered-mud-6ed5.joshuablaszczyk.workers.dev'
).replace(/\/$/, '');
const expectedApiOrigin = 'https://weathered-mud-6ed5.joshuablaszczyk.workers.dev';
const htmlPaths = ['/main.html', '/auth.html', '/account.html', '/admin.html'];
const failures = [];

function validateEndpoint(name, value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.origin !== value) {
      failures.push(`${name} must be an HTTPS origin without a path, query, or fragment`);
    }
  } catch {
    failures.push(`${name} is not a valid URL origin`);
  }
}

function validateDocumentCsp(path, html) {
  const csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1] || '';
  if (!csp) {
    failures.push(`${path}: missing document-level Content-Security-Policy fallback`);
    return;
  }
  for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
    if (!csp.includes(directive)) failures.push(`${path}: CSP is missing ${directive}`);
  }
  if (/unsafe-eval|https:\/\/\*\.workers\.dev/i.test(csp)) {
    failures.push(`${path}: CSP contains an unsafe evaluator or wildcard Worker endpoint`);
  }
  const connectSrc = csp.match(/(?:^|;)\s*connect-src\s+([^;]+)/i)?.[1] || '';
  if (!connectSrc.split(/\s+/).includes(apiOrigin)) {
    failures.push(`${path}: connect-src does not allow ${apiOrigin}`);
  }
  const workerOrigins = [...new Set(connectSrc.match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev/gi) || [])];
  if (workerOrigins.length !== 1 || workerOrigins[0] !== apiOrigin) {
    failures.push(`${path}: connect-src allows a workers.dev origin other than the configured API`);
  }
}

validateEndpoint('PRODUCTION_SITE_ORIGIN', siteOrigin);
validateEndpoint('PRODUCTION_API_ORIGIN', apiOrigin);
if (siteOrigin === apiOrigin) failures.push('production site and API origins must remain separate in hybrid hosting');
if (!process.env.PRODUCTION_API_ORIGIN && apiOrigin !== expectedApiOrigin) {
  failures.push(`default API origin must remain ${expectedApiOrigin}`);
}

for (const path of htmlPaths) {
  let response;
  try {
    response = await fetch(`${siteOrigin}${path}`, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'text/html' }
    });
  } catch {
    failures.push(`${path}: GitHub Pages request failed`);
    continue;
  }
  if (!response.ok) {
    failures.push(`${path}: GitHub Pages returned HTTP ${response.status}`);
    continue;
  }
  if (!/text\/html/i.test(response.headers.get('content-type') || '')) {
    failures.push(`${path}: GitHub Pages did not return HTML`);
  }
  const html = await response.text();
  const expectedReferrerPolicy = ['/auth.html', '/account.html'].includes(path)
    ? 'strict-origin-when-cross-origin'
    : 'no-referrer';
  const referrerPattern = new RegExp(
    `<meta\\s+name=["']referrer["']\\s+content=["']${expectedReferrerPolicy}["']`,
    'i'
  );
  if (!referrerPattern.test(html)) {
    failures.push(`${path}: missing document-level ${expectedReferrerPolicy} policy`);
  }
  validateDocumentCsp(path, html);
}

const runtime = await fetch(`${siteOrigin}/site-config.js`, {
  signal: AbortSignal.timeout(15_000),
  headers: { Accept: 'text/javascript, application/javascript' }
}).catch(() => null);
if (!runtime?.ok) {
  failures.push('/site-config.js is unavailable from GitHub Pages');
} else {
  const runtimeSource = await runtime.text();
  if (!runtimeSource.includes(apiOrigin)) failures.push('/site-config.js does not select the deployed Worker API');
  if (/(?:API_BASE|CATALOG_API_BASE)\s*=\s*new URLSearchParams|\.get\(["'](?:api|catalog)["']\)/i.test(runtimeSource)) {
    failures.push('/site-config.js exposes a query-controlled API endpoint override');
  }
}

const health = await fetch(`${apiOrigin}/api/health`, {
  signal: AbortSignal.timeout(15_000),
  headers: { Accept: 'application/json', Origin: siteOrigin }
}).catch(() => null);
if (!health?.ok) {
  failures.push('Worker /api/health is unavailable');
} else {
  if (!/application\/json/i.test(health.headers.get('content-type') || '')) {
    failures.push('Worker /api/health did not return JSON');
  }
  if (health.headers.get('access-control-allow-origin') !== siteOrigin) {
    failures.push('Worker /api/health did not allow the exact GitHub Pages origin');
  }
  if (health.headers.get('access-control-allow-credentials') !== 'true') {
    failures.push('Worker /api/health did not allow credentialed browser requests');
  }
}

const preflight = await fetch(`${apiOrigin}/api/status`, {
  method: 'OPTIONS',
  signal: AbortSignal.timeout(15_000),
  headers: {
    Origin: siteOrigin,
    'Access-Control-Request-Method': 'GET'
  }
}).catch(() => null);
if (preflight?.status !== 204) {
  failures.push(`Worker CORS preflight returned HTTP ${preflight?.status || 'unavailable'}`);
} else {
  if (preflight.headers.get('access-control-allow-origin') !== siteOrigin) {
    failures.push('Worker preflight did not echo the exact GitHub Pages origin');
  }
  if (preflight.headers.get('access-control-allow-credentials') !== 'true') {
    failures.push('Worker preflight did not allow credentials');
  }
  const vary = preflight.headers.get('vary') || '';
  if (!vary.toLowerCase().split(',').map((value) => value.trim()).includes('origin')) {
    failures.push('Worker preflight does not vary by Origin');
  }
}

const rejectedPreflight = await fetch(`${apiOrigin}/api/status`, {
  method: 'OPTIONS',
  signal: AbortSignal.timeout(15_000),
  headers: {
    Origin: 'https://fragrancecollect.com.attacker.example',
    'Access-Control-Request-Method': 'GET'
  }
}).catch(() => null);
if (rejectedPreflight?.status !== 403) {
  failures.push(`Worker accepted an untrusted preflight origin (${rejectedPreflight?.status || 'unavailable'})`);
}
if (rejectedPreflight?.headers.get('access-control-allow-origin')) {
  failures.push('Worker emitted Access-Control-Allow-Origin for an untrusted origin');
}

if (failures.length) {
  console.error('Production hybrid-hosting validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`GitHub Pages at ${siteOrigin} and Worker API at ${apiOrigin} passed the hybrid-hosting checks.`);
