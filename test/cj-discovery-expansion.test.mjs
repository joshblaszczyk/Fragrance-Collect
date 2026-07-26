import test from 'node:test';
import assert from 'node:assert/strict';

import worker, { __catalogInternals as catalog } from '../weathered-mud-6ed5/src/integrated-worker.js';
import { withCJCache } from '../weathered-mud-6ed5/src/cj-integration.js';

const liveJoinedAdvertisers = Object.freeze([
  { id: '7287203', name: 'FragranceShop.com' },
  { id: '1024283', name: 'FragranceX.com' },
  { id: '904674', name: 'Perfumania.com' },
  { id: '7563286', name: 'TikTok Shop US' },
  { id: '7057684', name: 'Maison Margiela' }
]);

function feedProduct(overrides = {}) {
  return {
    id: overrides.id || 'offer-1',
    catalogId: overrides.catalogId || 'catalog-1',
    advertiserId: overrides.advertiserId || '1001',
    advertiserName: overrides.advertiserName || 'Joined Fragrance Retailer',
    title: overrides.title || 'Sauvage Eau de Parfum Spray 3.4 oz',
    brand: overrides.brand || 'Christian Dior',
    description: overrides.description || 'Wearable eau de parfum.',
    productType: overrides.productType || 'Perfume & Cologne',
    price: overrides.price || { amount: 95, currency: 'USD' },
    link: overrides.link || `https://retailer.example/${overrides.id || 'offer-1'}`,
    ...overrides
  };
}

function createWorkerTestDb() {
  return {
    async batch() {
      return [];
    },
    prepare(sql) {
      const statement = {
        bind() {
          return statement;
        },
        async first() {
          return /SELECT request_count FROM rate_limits/i.test(sql) ? { request_count: 1 } : null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    }
  };
}

function createCacheDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...bound) {
          values = bound;
          return statement;
        },
        async first() {
          if (/SELECT payload, expires_at, updated_at FROM cj_cache/i.test(sql)) {
            return rows.get(values[0]) || null;
          }
          return null;
        },
        async run() {
          if (/INSERT INTO cj_cache/i.test(sql)) {
            rows.set(values[0], {
              payload: values[1],
              expires_at: values[2],
              updated_at: values[3]
            });
          }
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    }
  };
}

function joinedAdvertiserXml() {
  const records = liveJoinedAdvertisers.map(({ id, name }) => `
    <advertiser>
      <advertiser-id>${id}</advertiser-id>
      <advertiser-name>${name}</advertiser-name>
      <account-status>Active</account-status>
      <relationship-status>Joined</relationship-status>
    </advertiser>`).join('');
  return `<cj-api><advertisers total-matched="${liveJoinedAdvertisers.length}" records-returned="${liveJoinedAdvertisers.length}" page-number="1">${records}</advertisers></cj-api>`;
}

test('builds separate Dior and Chanel recall branches, including canonical feed aliases', () => {
  const dior = catalog.buildCJDiscoveryQueries({ query: 'Dior', brand: 'Dior' });
  assert.deepEqual(dior.map((entry) => entry.key), [
    'dior',
    'christian dior',
    'dior perfume',
    'dior fragrance'
  ]);

  const chanel = catalog.buildCJDiscoveryQueries({ query: 'Chanel', brand: 'Chanel' });
  assert.deepEqual(chanel.map((entry) => entry.key), [
    'chanel',
    'chanel paris',
    'chanel perfume',
    'chanel fragrance'
  ]);

  const sauvage = catalog.buildCJDiscoveryQueries({ query: 'Dior Sauvage', brand: 'Dior' });
  assert.deepEqual(sauvage.map((entry) => entry.key), [
    'dior sauvage',
    'sauvage',
    'dior',
    'christian dior'
  ]);
});

test('recovers Dior from an alias branch, follows every page, and rejects non-perfume spillover', async () => {
  const queries = catalog.buildCJDiscoveryQueries({ query: 'Dior', brand: 'Dior' });
  const calls = [];
  const aliasProducts = Array.from({ length: 125 }, (_, index) => feedProduct({
    id: `dior-${index}`,
    title: `Dior fragrance ${index} Eau de Parfum Spray 100 ml`
  }));
  const discovery = await catalog.executeCJDiscoveryPlan({
    queries,
    advertiserScopes: [{ key: 'joined', partnerIds: null }],
    maxResults: 500,
    fetchPage: async ({ keywords, offset, limit }) => {
      const key = keywords.join('|').toLowerCase();
      calls.push({ key, offset, limit });
      if (key === 'christian dior') {
        return { totalCount: aliasProducts.length, resultList: aliasProducts.slice(offset, offset + limit) };
      }
      if (key === 'perfume' && offset === 0) {
        return {
          totalCount: 2,
          resultList: [
            aliasProducts[0],
            feedProduct({ id: 'dior-candle', title: 'Christian Dior Scented Candle', productType: 'Home Fragrance' })
          ]
        };
      }
      return { totalCount: 0, resultList: [] };
    }
  });

  assert.equal(discovery.complete, true);
  assert.ok(calls.some((call) => call.key === 'christian dior' && call.offset === 75), 'the alias result must be paginated');
  const eligible = catalog.deduplicateProducts(discovery.products)
    .filter(catalog.isFragranceProduct)
    .filter((product) => catalog.matchesRawProductBrand(product, 'Dior'));
  assert.equal(eligible.length, 125);
  assert.equal(eligible.some((product) => product.id === 'dior-candle'), false);
});

test('fans a Chanel brand search across joined advertisers without relaxing perfume or brand checks', async () => {
  const scopes = catalog.buildCJAdvertiserScopes(
    { query: 'Chanel', brand: 'Chanel' },
    null,
    { ids: ['1001', '2002'], complete: true }
  );
  assert.deepEqual(scopes.map((scope) => scope.partnerIds), [['1001'], ['2002']]);

  const discovery = await catalog.executeCJDiscoveryPlan({
    queries: [{ key: 'chanel', keywords: ['Chanel'], reason: 'primary' }],
    advertiserScopes: scopes,
    maxResults: 100,
    fetchPage: async ({ partnerIds }) => partnerIds[0] === '2002'
      ? {
          totalCount: 1,
          resultList: [feedProduct({
            id: 'chanel-chance',
            advertiserId: '2002',
            brand: 'Chanel Paris',
            title: 'Chance Eau de Parfum Spray 50 ml'
          })]
        }
      : {
          totalCount: 1,
          resultList: [feedProduct({
            id: 'chanel-bag',
            advertiserId: '1001',
            brand: 'Chanel',
            title: 'Chanel Quilted Handbag',
            productType: 'Apparel & Accessories'
          })]
        }
  });
  const eligible = catalog.deduplicateProducts(discovery.products)
    .filter(catalog.isFragranceProduct)
    .filter((product) => catalog.matchesRawProductBrand(product, 'Chanel'));
  assert.deepEqual(eligible.map((product) => product.id), ['chanel-chance']);
});

test('plans an independent scope for every active joined advertiser in broad and brand searches', () => {
  const directory = { ids: liveJoinedAdvertisers.map((advertiser) => advertiser.id), complete: true, available: true };
  for (const options of [
    { query: 'fragrance perfume', brand: null },
    { query: 'Dior', brand: 'Dior' }
  ]) {
    const scopes = catalog.buildCJAdvertiserScopes(options, null, directory);
    assert.deepEqual(
      scopes.map((scope) => scope.partnerIds),
      liveJoinedAdvertisers.map((advertiser) => [advertiser.id])
    );
    assert.ok(scopes.every((scope) => scope.kind === 'advertiser'));
  }
});

test('authorizes the four probed joined IDs from the active directory and fails closed otherwise', () => {
  const directory = { ids: liveJoinedAdvertisers.map((advertiser) => advertiser.id), complete: true, available: true };
  for (const { id } of liveJoinedAdvertisers.slice(0, 4)) {
    assert.equal(catalog.resolveRequestedCJPartnerId(id, null, directory), id);
  }
  assert.equal(catalog.resolveRequestedCJPartnerId('9999999', null, directory), null);
  assert.equal(catalog.resolveRequestedCJPartnerId('not-an-id', null, directory), null);

  assert.equal(catalog.isActiveJoinedCJAdvertiser({ id: '1024283', accountStatus: 'Active', relationshipStatus: 'Joined' }), true);
  assert.equal(catalog.isActiveJoinedCJAdvertiser({ id: '1024283', accountStatus: 'Inactive', relationshipStatus: 'Joined' }), false);
  assert.equal(catalog.isActiveJoinedCJAdvertiser({ id: '1024283', accountStatus: 'Active', relationshipStatus: 'Not Joined' }), false);
});

test('the public partnerId filter validates all-mode requests against active joined Advertiser Lookup data', async () => {
  const originalFetch = globalThis.fetch;
  const productRequests = [];
  let advertiserLookupFails = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes('advertiser-lookup.api.cj.com')) {
      if (advertiserLookupFails) throw new Error('simulated advertiser lookup outage');
      return new Response(joinedAdvertiserXml(), {
        status: 200,
        headers: { 'Content-Type': 'application/xml' }
      });
    }
    if (url.includes('ads.api.cj.com/query')) {
      productRequests.push(JSON.parse(init.body).variables);
      return new Response(JSON.stringify({
        data: { shoppingProducts: { totalCount: 0, resultList: [] } }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Unexpected test request: ${url}`);
  };

  const env = {
    DB: createWorkerTestDb(),
    CJ_ADVERTISER_IDS: 'all',
    CJ_COMPANY_ID: 'publisher-1',
    CJ_WEBSITE_ID: 'website-1',
    CJ_PERSONAL_ACCESS_TOKEN: 'test-token',
    ALLOWED_ORIGIN: 'https://fragrancecollect.com'
  };
  try {
    const allowed = await worker.fetch(
      new Request('https://worker.test/api/products?partnerId=1024283'),
      env,
      { waitUntil() {} }
    );
    assert.equal(allowed.status, 200);
    assert.ok(productRequests.length > 0);
    assert.ok(productRequests.every((variables) => (
      variables.partnerStatus === 'JOINED'
      && JSON.stringify(variables.partnerIds) === JSON.stringify(['1024283'])
    )));

    const requestCountBeforeRejectedIds = productRequests.length;
    const unknown = await worker.fetch(
      new Request('https://worker.test/api/products?partnerId=9999999'),
      env,
      { waitUntil() {} }
    );
    assert.equal(unknown.status, 400);
    assert.equal(productRequests.length, requestCountBeforeRejectedIds, 'unknown IDs must not reach Product Search');

    const malformed = await worker.fetch(
      new Request('https://worker.test/api/products?partnerId=not-a-cj-id'),
      env,
      { waitUntil() {} }
    );
    assert.equal(malformed.status, 400);
    assert.equal(productRequests.length, requestCountBeforeRejectedIds, 'malformed IDs must not reach Product Search');

    advertiserLookupFails = true;
    const unavailable = await worker.fetch(
      new Request('https://worker.test/api/products?partnerId=1024283'),
      env,
      { waitUntil() {} }
    );
    assert.equal(unavailable.status, 503);
    assert.equal(productRequests.length, requestCountBeforeRejectedIds, 'unverified IDs must fail closed during directory outages');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps scheduled watch discovery focused on its one joined retailer', () => {
  assert.equal(catalog.buildCJDiscoveryQueries({
    query: 'Sauvage Eau de Parfum',
    discoveryMode: 'focused'
  }).length, 1);
  assert.deepEqual(catalog.buildCJAdvertiserScopes({ partnerId: '1024283' }, null, {
    ids: liveJoinedAdvertisers.map((advertiser) => advertiser.id),
    complete: true
  }), [{
    key: 'partner-1024283',
    partnerIds: ['1024283'],
    kind: 'selected'
  }]);
});

test('gives FragranceX its own broad-search result window instead of letting a larger catalog crowd it out', async () => {
  const directory = { ids: liveJoinedAdvertisers.map((advertiser) => advertiser.id), complete: true, available: true };
  const scopes = catalog.buildCJAdvertiserScopes({ query: 'fragrance perfume' }, null, directory);
  const calledAdvertisers = [];
  const discovery = await catalog.executeCJDiscoveryPlan({
    queries: [{ key: 'fragrance|perfume', keywords: ['fragrance', 'perfume'], reason: 'primary' }],
    advertiserScopes: scopes,
    maxResults: 500,
    fetchPage: async ({ partnerIds, limit }) => {
      const advertiserId = partnerIds[0];
      calledAdvertisers.push(advertiserId);
      if (advertiserId === '7287203') {
        return {
          totalCount: limit,
          resultList: Array.from({ length: limit }, (_, index) => feedProduct({
            id: `large-catalog-${index}`,
            advertiserId
          }))
        };
      }
      if (advertiserId === '1024283') {
        return {
          totalCount: 1,
          resultList: [feedProduct({
            id: 'fragrancex-exclusive',
            advertiserId,
            advertiserName: 'FragranceX.com',
            title: 'FragranceX Exclusive Eau de Parfum Spray 100 ml'
          })]
        };
      }
      return { totalCount: 0, resultList: [] };
    }
  });

  assert.deepEqual(new Set(calledAdvertisers), new Set(liveJoinedAdvertisers.map((advertiser) => advertiser.id)));
  assert.ok(discovery.products.some((product) => product.id === 'fragrancex-exclusive'));
});

test('bounds a very large advertiser plan while preserving fair primary-query coverage', async () => {
  const advertiserIds = Array.from({ length: 13 }, (_, index) => String(3000 + index));
  const calledAdvertisers = [];
  const discovery = await catalog.executeCJDiscoveryPlan({
    queries: [
      { key: 'perfume', keywords: ['perfume'], reason: 'primary' },
      { key: 'fragrance', keywords: ['fragrance'], reason: 'fallback' }
    ],
    advertiserScopes: advertiserIds.map((id) => ({
      key: `joined-advertiser-${id}`,
      partnerIds: [id],
      kind: 'advertiser'
    })),
    maxResults: 1200,
    fetchPage: async ({ partnerIds, limit }) => {
      calledAdvertisers.push(partnerIds[0]);
      return {
        totalCount: 10_000,
        resultList: Array.from({ length: limit }, (_, index) => feedProduct({
          id: `${partnerIds[0]}-${index}`,
          advertiserId: partnerIds[0]
        }))
      };
    }
  });

  assert.deepEqual(new Set(calledAdvertisers), new Set(advertiserIds.slice(0, 8)));
  assert.equal(discovery.requestCount, 8);
  assert.ok(discovery.scannedRecords > 0 && discovery.scannedRecords <= 600);
  assert.ok(discovery.truncatedReasons.includes('request-cap'));
});

test('keeps an all-joined scope when advertiser-directory pagination is incomplete', () => {
  const scopes = catalog.buildCJAdvertiserScopes(
    { query: 'Chanel', brand: 'Chanel' },
    null,
    { ids: ['1001', '2002', '3003', '4004', '5005'], complete: false }
  );
  assert.equal(scopes.length, 6);
  assert.deepEqual(scopes.slice(0, 5).map((scope) => scope.partnerIds), [['1001'], ['2002'], ['3003'], ['4004'], ['5005']]);
  assert.equal(scopes[5].key, 'joined-directory-remainder');
  assert.equal(scopes[5].partnerIds, null);
});

test('non-joined opportunity metadata names programs without exposing products or purchase data', () => {
  const eligible = [
    catalog.formatProduct(feedProduct({ id: 'nonjoined-1', advertiserId: '9001', advertiserName: 'Chanel Stockist One' })),
    catalog.formatProduct(feedProduct({ id: 'nonjoined-2', advertiserId: '9001', advertiserName: 'Chanel Stockist One' })),
    catalog.formatProduct(feedProduct({ id: 'nonjoined-3', advertiserId: '9002', advertiserName: 'Chanel Stockist Two' }))
  ];
  const summary = catalog.summarizeNonPartnerOpportunity(eligible, 12, 40);

  assert.deepEqual(summary.advertisers, [
    { id: '9001', name: 'Chanel Stockist One' },
    { id: '9002', name: 'Chanel Stockist Two' }
  ]);
  assert.equal(summary.offersReturned, 0);
  assert.equal(Object.hasOwn(summary, 'products'), false);
  assert.doesNotMatch(JSON.stringify(summary), /retailer\.example|affiliate|price|buyUrl/i);
});

test('reports an incomplete scan instead of inflating totals when a bounded result cap is reached', async () => {
  const calls = [];
  const discovery = await catalog.executeCJDiscoveryPlan({
    queries: [{ key: 'perfume', keywords: ['perfume'], reason: 'primary' }],
    advertiserScopes: [{ key: 'joined', partnerIds: null }],
    maxResults: 250,
    fetchPage: async ({ offset, limit }) => {
      calls.push({ offset, limit });
      return {
        totalCount: 1000,
        resultList: Array.from({ length: limit }, (_, index) => feedProduct({ id: `offer-${offset + index}` }))
      };
    }
  });

  assert.deepEqual(calls, [
    { offset: 0, limit: 75 },
    { offset: 75, limit: 75 },
    { offset: 150, limit: 75 },
    { offset: 225, limit: 25 }
  ]);
  assert.equal(discovery.products.length, 250);
  assert.equal(discovery.complete, false);
  assert.ok(discovery.truncatedReasons.includes('branch-result-cap'));
  assert.equal(discovery.reportedTotalLowerBound, 1000);
});

test('never exceeds concurrent request or record budgets', async () => {
  let requestedRecords = 0;
  const discovery = await catalog.executeCJDiscoveryPlan({
    queries: Array.from({ length: 5 }, (_, index) => ({
      key: `query-${index}`,
      keywords: [`query-${index}`],
      reason: 'test'
    })),
    advertiserScopes: Array.from({ length: 4 }, (_, index) => ({
      key: `scope-${index}`,
      partnerIds: [String(1000 + index)]
    })),
    maxResults: 1200,
    fetchPage: async ({ offset, limit }) => {
      requestedRecords += limit;
      return {
        totalCount: 10_000,
        resultList: Array.from({ length: limit }, (_, index) => feedProduct({ id: `budget-${requestedRecords}-${offset}-${index}` }))
      };
    }
  });

  assert.ok(discovery.requestCount <= 8);
  assert.equal(discovery.scannedRecords, 600);
  assert.equal(requestedRecords, 600);
  assert.ok(discovery.truncatedReasons.includes('aggregate-result-cap'));

  let returnedRecords = 0;
  const requestBound = await catalog.executeCJDiscoveryPlan({
    queries: Array.from({ length: 5 }, (_, index) => ({ key: `sparse-query-${index}`, keywords: [`sparse-query-${index}`] })),
    advertiserScopes: Array.from({ length: 5 }, (_, index) => ({ key: `sparse-scope-${index}`, partnerIds: [String(2000 + index)] })),
    maxResults: 1200,
    fetchPage: async () => {
      returnedRecords += 1;
      return { totalCount: 1, resultList: [feedProduct({ id: `sparse-${returnedRecords}` })] };
    }
  });
  assert.equal(requestBound.requestCount, 8);
  assert.equal(requestBound.scannedRecords, 8);
  assert.ok(requestBound.truncatedReasons.includes('request-cap'));

  let tinyRequestedRecords = 0;
  const tiny = await catalog.executeCJDiscoveryPlan({
    queries: Array.from({ length: 4 }, (_, index) => ({ key: `tiny-${index}`, keywords: [`tiny-${index}`] })),
    advertiserScopes: [{ key: 'joined', partnerIds: null }],
    maxResults: 2,
    fetchPage: async ({ limit }) => {
      tinyRequestedRecords += limit;
      return {
        totalCount: 10,
        resultList: Array.from({ length: limit }, (_, index) => feedProduct({ id: `tiny-${tinyRequestedRecords}-${index}` }))
      };
    }
  });
  assert.equal(tiny.requestCount, 2);
  assert.equal(tiny.scannedRecords, 2);
  assert.equal(tinyRequestedRecords, 2);
});

test('settles hung CJ branches at one shared deadline while retaining successful partial offers', async () => {
  const controller = new AbortController();
  const deadlineAt = Date.now() + 25;
  const deadlineTimer = setTimeout(() => controller.abort('test catalog deadline'), 25);
  const deadline = {
    signal: controller.signal,
    remainingMs: () => Math.max(0, deadlineAt - Date.now()),
    abort: () => controller.abort('test catalog deadline'),
    get expired() {
      return controller.signal.aborted || Date.now() >= deadlineAt;
    }
  };
  let slowBranchSawAbort = false;
  let lateReject;
  const startedAt = Date.now();
  try {
    const discovery = await catalog.executeCJDiscoveryPlan({
      queries: [{ key: 'dior', keywords: ['Dior'], reason: 'primary' }],
      advertiserScopes: [
        { key: 'joined-advertiser-fast', partnerIds: ['1001'], kind: 'advertiser' },
        { key: 'joined-advertiser-slow', partnerIds: ['2002'], kind: 'advertiser' }
      ],
      maxResults: 10,
      deadline,
      fetchPage: ({ partnerIds, signal }) => {
        if (partnerIds[0] === '1001') {
          return Promise.resolve({
            totalCount: 1,
            resultList: [feedProduct({ id: 'fast-dior', advertiserId: '1001', brand: 'Dior' })]
          });
        }
        // Deliberately ignore abort for the returned promise. The planner must
        // still finish promptly and keep this late rejection observed.
        signal.addEventListener('abort', () => { slowBranchSawAbort = true; }, { once: true });
        return new Promise((_, reject) => { lateReject = reject; });
      }
    });

    assert.ok(Date.now() - startedAt < 250, 'the shared deadline must bound a hung branch');
    assert.equal(slowBranchSawAbort, true, 'the request-wide signal must cancel in-flight CJ work');
    assert.deepEqual(discovery.products.map((product) => product.id), ['fast-dior']);
    assert.equal(discovery.requestCount, 2);
    assert.equal(discovery.complete, false);
    assert.equal(discovery.deadlineExceeded, true);
    assert.ok(discovery.truncatedReasons.includes('response-time-limit'));
    assert.equal(discovery.failedBranches, 1);

    // Promise.race has an observer on the original branch promise. A network
    // stack that rejects after the HTTP response must not leak an unhandled
    // rejection into the next request/test.
    lateReject(new Error('late CJ network rejection'));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    clearTimeout(deadlineTimer);
  }
});

test('reuses an expired exact-key catalog snapshot across consecutive CJ timeouts', async () => {
  const database = createCacheDb();
  const cacheKey = 'catalog-timeout-stale-test';
  const completeSnapshot = {
    products: [feedProduct({ id: 'known-good-dior', brand: 'Dior' })],
    discovery: { deadlineExceeded: false }
  };
  await withCJCache({ DB: database }, cacheKey, 60, async () => completeSnapshot);
  database.rows.get(cacheKey).expires_at = new Date(Date.now() - 1_000).toISOString();

  const timedOut = {
    products: [],
    discovery: { deadlineExceeded: true }
  };
  const loadTimedOutCatalog = () => withCJCache(
      { DB: database },
      cacheKey,
      60,
      async () => timedOut,
      {
        shouldCache: (data) => data.discovery.deadlineExceeded !== true,
        preferStale: (data) => data.discovery.deadlineExceeded === true && data.products.length === 0
      }
    );
  const responses = [await loadTimedOutCatalog(), await loadTimedOutCatalog()];

  for (const response of responses) {
    assert.equal(response.cache, 'stale');
    assert.equal(response.stale, true);
    assert.equal(response.data.products[0].id, 'known-good-dior');
  }
  assert.equal(JSON.parse(database.rows.get(cacheKey).payload).products[0].id, 'known-good-dior');
});
