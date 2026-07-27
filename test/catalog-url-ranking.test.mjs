import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { __catalogInternals as catalog } from '../weathered-mud-6ed5/src/integrated-worker.js';

const clientSource = readFileSync(new URL('../script.js', import.meta.url), 'utf8');

function loadCanonicalUrlHelper() {
  const start = clientSource.indexOf('const CATALOG_PRICE_URL_RANGES');
  const end = clientSource.indexOf('function catalogPriceRangeFromUrl', start);
  assert.ok(start >= 0 && end > start, 'catalog URL helpers should be discoverable');
  return new Function(`${clientSource.slice(start, end)}; return canonicalCatalogFilterUrlEntries;`)();
}

function loadPaginationHelper() {
  const start = clientSource.indexOf('function catalogPaginationFromResponse');
  const end = clientSource.indexOf('function updateBrandUrl', start);
  assert.ok(start >= 0 && end > start, 'catalog pagination helper should be discoverable');
  return new Function('config', `${clientSource.slice(start, end)}; return catalogPaginationFromResponse;`)({ RESULTS_PER_PAGE: 12 });
}

test('serializes non-default catalog controls into one canonical shareable URL state', () => {
  const canonicalEntries = loadCanonicalUrlHelper();
  assert.deepEqual(canonicalEntries({
    priceRange: '50-100',
    shipping: 'free',
    availability: 'BACKORDER',
    country: 'ca',
    sortBy: 'relevance',
    currency: 'eur',
    exactMatch: true
  }), {
    lowPrice: '50',
    highPrice: '100',
    shipping: 'free',
    availability: 'BACKORDER',
    country: 'CA',
    sortBy: 'relevance',
    currency: 'EUR',
    exactMatch: 'true'
  });

  assert.deepEqual(canonicalEntries({
    priceRange: 'all',
    shipping: 'all',
    availability: '',
    country: '',
    sortBy: 'featured',
    currency: 'USD',
    exactMatch: false
  }), {}, 'default controls must not produce noisy or misleading URL parameters');
});

test('keeps stale-Worker result pages navigable without trusting a broad total as a filtered count', () => {
  const pagination = loadPaginationHelper();
  assert.deepEqual(pagination({
    requestedPage: 1,
    requestedLimit: 12,
    responsePage: 1,
    responseLimit: 25,
    suppliedTotal: 247,
    responseHasMore: false,
    clientVerified: true
  }), { page: 1, limit: 25, hasMore: true, totalPages: 2 });
  assert.deepEqual(pagination({
    requestedPage: 2,
    responsePage: 2,
    responseLimit: 25,
    suppliedTotal: 247,
    clientVerified: true
  }), { page: 2, limit: 25, hasMore: true, totalPages: 3 });
  assert.deepEqual(pagination({
    requestedPage: 1,
    responsePage: 1,
    responseLimit: 25,
    suppliedTotal: 247,
    clientVerified: false
  }), { page: 1, limit: 25, hasMore: true, totalPages: 10 });
});

test('builds a single upstream brand/product query without repeating recognized aliases', () => {
  assert.deepEqual(catalog.buildCJProductKeywords({ query: 'Dior Sauvage', brand: 'Dior' }), ['Dior Sauvage']);
  assert.deepEqual(catalog.buildCJProductKeywords({ query: 'Dior Sauvage', brand: 'Christian Dior' }), ['Dior Sauvage']);
  assert.deepEqual(catalog.buildCJProductKeywords({ query: 'YSL Libre', brand: 'Yves Saint Laurent' }), ['YSL Libre']);
  assert.deepEqual(catalog.buildCJProductKeywords({ query: 'Sauvage', brand: 'Dior' }), ['Dior Sauvage']);
  assert.deepEqual(catalog.buildCJProductKeywords({ query: 'ysl', brand: 'Yves Saint Laurent' }), ['Yves Saint Laurent']);
  assert.equal(catalog.buildCJProductKeywords({ query: 'Dior Sauvage', brand: 'Dior' })[0].match(/dior/gi).length, 1);
});

test('ranks Relevance by query match while Featured also considers offer quality', () => {
  const exactMatch = {
    id: 'exact-match',
    productKey: 'catalog:exact-match',
    name: 'Atlas Absolute Perfume',
    brand: 'Example House',
    price: 90,
    regularPrice: 90,
    salePrice: null,
    availability: 'OUT_OF_STOCK',
    shippingCost: 12,
    additionalImages: [],
    highlights: [],
    productTypes: ['Perfume & Cologne']
  };
  const completeOffer = {
    id: 'complete-offer',
    productKey: 'catalog:complete-offer',
    name: 'Absolute Reserve Perfume',
    brand: 'House Atlas Absolute',
    price: 72,
    regularPrice: 100,
    salePrice: 72,
    availability: 'IN_STOCK',
    shippingCost: 0,
    gtin: '1234567890123',
    additionalImages: ['one', 'two'],
    highlights: ['Current offer'],
    productTypes: ['Perfume & Cologne']
  };

  const relevance = catalog.rankProducts(
    [{ ...completeOffer }, { ...exactMatch }],
    'atlas absolute',
    'relevance',
    null,
    new Map()
  );
  const featured = catalog.rankProducts(
    [{ ...exactMatch }, { ...completeOffer }],
    'atlas absolute',
    'featured',
    null,
    new Map()
  );

  assert.deepEqual(relevance.map((product) => product.id), ['exact-match', 'complete-offer']);
  assert.deepEqual(featured.map((product) => product.id), ['complete-offer', 'exact-match']);
  assert.ok(catalog.calculateRelevance(exactMatch, 'atlas absolute') > catalog.calculateRelevance(completeOffer, 'atlas absolute'));
  assert.ok(catalog.calculateFeaturedScore(completeOffer, 'atlas absolute', new Map()) > catalog.calculateFeaturedScore(exactMatch, 'atlas absolute', new Map()));
});
