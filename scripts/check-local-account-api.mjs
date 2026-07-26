const apiBase = String(process.env.LOCAL_API_BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');
const origin = process.env.LOCAL_SITE_ORIGIN || new URL(apiBase).origin;
const userAgent = 'FragranceCollect-LocalContractCheck/1.2';
const smokeEmail = process.env.LOCAL_SMOKE_EMAIL
  || `local-contract-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@example.invalid`;
const smokePassword = process.env.LOCAL_SMOKE_PASSWORD || 'LocalCheck!2026Secure';
const requireWatchDelivery = process.env.LOCAL_EXPECT_WATCHES === 'true';
const requireFullHealth = process.env.LOCAL_EXPECT_FULL_HEALTH === 'true';

let sessionCookie = '';

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  headers.set('Origin', origin);
  headers.set('User-Agent', userAgent);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (sessionCookie) headers.set('Cookie', sessionCookie);

  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function assertResponse(result, expectedStatus, label) {
  if (result.response.status !== expectedStatus) {
    throw new Error(
      `${label} returned ${result.response.status}; expected ${expectedStatus}: ${JSON.stringify(result.body)}`
    );
  }
}

function captureSession(response) {
  const cookieHeaders = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || ''];
  const tokens = cookieHeaders.flatMap((value) => [
    ...value.matchAll(/(?:^|,\s*)__Host-fragrance_session=([A-Za-z0-9_-]{40,100})(?=;)/g)
  ].map((match) => match[1]));
  const token = tokens.at(-1) || '';
  if (!token) {
    throw new Error('The account API did not issue the expected secure session cookie.');
  }
  sessionCookie = `__Host-fragrance_session=${token}`;
}

const health = await request('/api/health');
if (![200, 503].includes(health.response.status)) {
  throw new Error(`Health check returned ${health.response.status}: ${JSON.stringify(health.body)}`);
}
if (health.body.release?.apiVersion !== '1.2.0'
  || health.body.release?.schemaVersion !== '0006_identity_security') {
  throw new Error(`Unexpected local health contract: ${JSON.stringify(health.body)}`);
}
if (health.body.services?.database !== true
  || health.body.services?.schema !== true
  || health.body.services?.googleAuth !== true
  || health.body.schema?.ready !== true) {
  throw new Error(`The local Worker or D1 schema is not ready: ${JSON.stringify(health.body)}`);
}
const fullHealthValidated = health.response.status === 200 && health.body.status === 'ok';
if (requireFullHealth && (!fullHealthValidated
  || health.body.services?.catalog !== true
  || health.body.services?.email !== true)) {
  throw new Error(`Full local integration health was required but is degraded: ${JSON.stringify(health.body)}`);
}
if (!fullHealthValidated && (health.response.status !== 503 || health.body.status !== 'degraded')) {
  throw new Error(`The local health status is internally inconsistent: ${JSON.stringify(health.body)}`);
}

const version = await request('/api/version');
assertResponse(version, 200, 'Version check');
if (version.body.release?.apiVersion !== health.body.release.apiVersion
  || version.body.release?.schemaVersion !== health.body.release.schemaVersion
  || version.body.capabilities?.accountDataExport !== true
  || version.body.capabilities?.dealAlerts !== true
  || version.body.capabilities?.mailboxVerification !== true
  || version.body.capabilities?.providerIdentityLinking !== true
  || version.body.capabilities?.newProductsOnly !== true) {
  throw new Error('The local version endpoint does not match the required release capabilities.');
}

const signup = await request('/api/signup/email', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Local Contract Check',
    email: smokeEmail,
    password: smokePassword
  })
});
assertResponse(signup, 202, 'Smoke-account signup');
if (!/^[A-Za-z0-9_-]{40,100}$/.test(signup.body.verificationToken || '')) {
  throw new Error('Local verification bypass did not return a valid one-time token.');
}

const verification = await request('/api/signup/verify', {
  method: 'POST',
  body: JSON.stringify({ token: signup.body.verificationToken })
});
assertResponse(verification, 200, 'Smoke-account verification');
captureSession(verification.response);

const status = await request('/api/status');
assertResponse(status, 200, 'Authenticated status');
if (status.body.user?.email !== smokeEmail
  || status.body.user?.emailVerified !== true
  || status.body.user?.hasPassword !== true) {
  throw new Error('Authenticated status omitted the verified local account state.');
}

const favoriteId = `local-favorite-${crypto.randomUUID()}`;
const addFavorite = await request('/api/user/favorites', {
  method: 'POST',
  body: JSON.stringify({
    fragrance_id: favoriteId,
    name: 'Local Contract Check Fragrance',
    advertiserName: 'Contract Test Retailer',
    productUrl: 'https://example.invalid/local-contract-fragrance',
    price: 99.95,
    currency: 'USD'
  })
});
assertResponse(addFavorite, 201, 'Favorite save');

const favorites = await request('/api/user/favorites');
assertResponse(favorites, 200, 'Favorite list');
if (!favorites.body.favorites?.some((item) => item.fragrance_id === favoriteId)) {
  throw new Error('The saved favorite was not returned by the account API.');
}

const removeFavorite = await request(`/api/user/favorites/${encodeURIComponent(favoriteId)}`, {
  method: 'DELETE'
});
assertResponse(removeFavorite, 200, 'Favorite deletion');

const productKey = `retailer:v1:local-contract-${crypto.randomUUID()}`;
const saveWatch = await request('/api/user/alerts', {
  method: 'POST',
  body: JSON.stringify({
    productKey,
    productName: 'Local Contract Check Fragrance',
    alertType: 'price_drop',
    targetPrice: 99.95,
    currency: 'USD',
    country: 'US'
  })
});

let watchValidated = false;
if (saveWatch.response.status === 201) {
  const watches = await request('/api/user/alerts');
  assertResponse(watches, 200, 'Price-watch list');
  const watch = watches.body.alerts?.find((item) => item.product_key === productKey);
  if (!watch?.id) throw new Error('The saved price watch was not returned by the account API.');

  const exportAfterWatch = await request('/api/user/export');
  assertResponse(exportAfterWatch, 200, 'Account export after watch save');
  if (!exportAfterWatch.body.dealWatches?.some((item) => item.product_key === productKey)) {
    throw new Error('The saved price watch was missing from the account-data export.');
  }

  const removeWatch = await request(`/api/user/alerts/${encodeURIComponent(watch.id)}`, {
    method: 'DELETE'
  });
  assertResponse(removeWatch, 200, 'Price-watch deletion');
  watchValidated = true;
} else if (saveWatch.response.status !== 503
  || !/temporarily unavailable/i.test(saveWatch.body.error || '')
  || requireWatchDelivery) {
  throw new Error(`Price-watch contract failed: ${saveWatch.response.status} ${JSON.stringify(saveWatch.body)}`);
}

const exportResult = await request('/api/user/export');
assertResponse(exportResult, 200, 'Account export');
if (exportResult.body.profile?.email !== smokeEmail
  || !Array.isArray(exportResult.body.favorites)
  || !Array.isArray(exportResult.body.identities)
  || !Array.isArray(exportResult.body.dealWatches)
  || !Array.isArray(exportResult.body.attributedRetailerVisits)) {
  throw new Error('Account export did not return the complete current schema.');
}

const deletion = await request('/api/user/account', {
  method: 'DELETE',
  body: JSON.stringify({ confirmation: 'DELETE', currentPassword: smokePassword })
});
assertResponse(deletion, 200, 'Account deletion');

console.log(
  `Local Worker ${health.body.release.apiVersion} passed verification, session, favorites, export, and secure deletion checks; `
  + `integration health ${fullHealthValidated ? 'is fully configured' : 'correctly reports unconfigured external CJ/email services'}; `
  + `watch contract ${watchValidated ? 'passed end-to-end' : 'correctly reported missing local email configuration'}.`
);
