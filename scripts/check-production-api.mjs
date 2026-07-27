const siteOrigin = String(process.env.PRODUCTION_SITE_ORIGIN || 'https://fragrancecollect.com').replace(/\/$/, '');
const healthUrl = process.env.API_HEALTH_URL
  || 'https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/health';
const expectedApiVersion = '1.2.0';
const expectedSchemaVersion = '0006_identity_security';
const apiBase = healthUrl.replace(/\/api\/health\/?(?:\?.*)?$/, '');
const browserHeaders = { Accept: 'application/json', Origin: siteOrigin };

const response = await fetch(healthUrl, {
  headers: browserHeaders,
  signal: AbortSignal.timeout(10_000)
});
const body = await response.json().catch(() => ({}));

if (!response.ok || body.status !== 'ok') {
  throw new Error(`Production API is not ready (${response.status}, status: ${body.status || 'unknown'}).`);
}
if (response.headers.get('access-control-allow-origin') !== siteOrigin
  || response.headers.get('access-control-allow-credentials') !== 'true') {
  throw new Error('Production API health check does not allow credentialed requests from the exact site origin.');
}

if (body.release?.apiVersion !== expectedApiVersion) {
  throw new Error(
    `Production API version ${body.release?.apiVersion || 'missing'} does not match required version ${expectedApiVersion}.`
  );
}
if (body.release?.schemaVersion !== expectedSchemaVersion) {
  throw new Error(
    `Production schema ${body.release?.schemaVersion || 'missing'} does not match required schema ${expectedSchemaVersion}.`
  );
}

if (body.capabilities?.passwordRecovery !== true || body.capabilities?.providerPasswordSetup !== true) {
  throw new Error('Production API does not advertise the required password-recovery capabilities.');
}
if (body.capabilities?.mailboxVerification !== true
  || body.capabilities?.providerIdentityLinking !== true) {
  throw new Error('Production API does not advertise mailbox verification and provider identity linking.');
}
if (body.capabilities?.accountDataExport !== true
  || body.capabilities?.dealAlerts !== true
  || body.capabilities?.newProductsOnly !== true) {
  throw new Error('Production API does not advertise export, deal-alert, and new-product enforcement capabilities.');
}

const contractChecks = await Promise.all([
  fetch(`${apiBase}/api/version`, {
    headers: browserHeaders,
    signal: AbortSignal.timeout(10_000)
  }),
  fetch(`${apiBase}/api/products?q=fragrance&limit=1&sortBy=featured`, {
    headers: browserHeaders,
    signal: AbortSignal.timeout(15_000)
  }),
  fetch(`${apiBase}/api/deals`, {
    headers: browserHeaders,
    signal: AbortSignal.timeout(15_000)
  }),
  fetch(`${apiBase}/api/advertisers`, {
    headers: browserHeaders,
    signal: AbortSignal.timeout(15_000)
  }),
  fetch(`${apiBase}/api/user/export`, {
    headers: browserHeaders,
    signal: AbortSignal.timeout(10_000)
  }),
  fetch(`${apiBase}/api/user/alerts`, {
    headers: browserHeaders,
    signal: AbortSignal.timeout(10_000)
  })
]);

const [versionResponse, productsResponse, dealsResponse, advertisersResponse, exportResponse, alertsResponse] = contractChecks;
for (const contractResponse of contractChecks) {
  if (contractResponse.headers.get('access-control-allow-origin') !== siteOrigin
    || contractResponse.headers.get('access-control-allow-credentials') !== 'true') {
    throw new Error(`API endpoint ${new URL(contractResponse.url).pathname} rejected the exact site origin.`);
  }
}
if (!versionResponse.ok) {
  throw new Error(`API version endpoint is unavailable (${versionResponse.status}).`);
}
if (!productsResponse.ok || !dealsResponse.ok || !advertisersResponse.ok) {
  throw new Error(
    `API contract incomplete (products ${productsResponse.status}, deals ${dealsResponse.status}, advertisers ${advertisersResponse.status}).`
  );
}
const version = await versionResponse.json();
if (version.release?.apiVersion !== expectedApiVersion
  || version.release?.schemaVersion !== expectedSchemaVersion) {
  throw new Error('The version endpoint does not match the health-check release contract.');
}
if (exportResponse.status !== 401 || alertsResponse.status !== 401) {
  throw new Error(
    `Account API contract incomplete (export ${exportResponse.status}, alerts ${alertsResponse.status}; expected authenticated routes to return 401).`
  );
}

const products = await productsResponse.json();
const deals = await dealsResponse.json();
const advertisers = await advertisersResponse.json();
if (!Array.isArray(products.products) || !Array.isArray(deals.deals) || !Array.isArray(advertisers.advertisers)) {
  throw new Error('API contract returned an unexpected response shape.');
}
if (products.products.some((product) => Object.hasOwn(product, 'revenue'))) {
  throw new Error('Public product responses must not expose commission or revenue data.');
}
const publicCatalogPayloads = { products, deals, advertisers };
const serializedCatalogPayloads = JSON.stringify(publicCatalogPayloads);
if (/"TEST_FIELD"|revenue-maximization/i.test(serializedCatalogPayloads)) {
  throw new Error('Public catalog responses contain internal test or revenue-ranking metadata.');
}
const forbiddenCommercialKey = /(?:revenue|commission)/i;
const visit = (value) => {
  if (!value || typeof value !== 'object') return;
  for (const [key, nestedValue] of Object.entries(value)) {
    if (forbiddenCommercialKey.test(key)) {
      throw new Error(`Public product responses expose internal commercial field "${key}".`);
    }
    visit(nestedValue);
  }
};
visit(publicCatalogPayloads);

console.log(`Production API ${body.release.apiVersion} is healthy and all catalog feature endpoints are compatible.`);
