import test from 'node:test';
import assert from 'node:assert/strict';

import { __catalogInternals as catalog } from '../weathered-mud-6ed5/src/integrated-worker.js';

const baseFeedProduct = {
  id: 'offer-1',
  catalogId: 'catalog-1',
  advertiserId: '1001',
  advertiserName: 'Example Retailer',
  title: 'Atlas Eau de Parfum Spray 3.4 oz',
  brand: 'Example House',
  description: 'A wearable fragrance.',
  productType: ['Perfume & Cologne'],
  link: 'https://retailer.example/atlas',
  linkCode: { clickUrl: 'https://affiliate.example/atlas' },
  price: { amount: 100, currency: 'USD' },
  shipping: { price: { amount: 0, currency: 'USD' } },
  gtin: '123456789012'
};

test('normalizes offer prices without comparing unlike currencies or inventing a currency', () => {
  assert.deepEqual(catalog.normalizeProductPricing(
    { amount: 100, currency: 'usd' },
    { amount: 80, currency: 'USD' }
  ), {
    price: 80,
    regularPrice: 100,
    salePrice: 80,
    currency: 'USD',
    saleCurrency: 'USD'
  });

  assert.deepEqual(catalog.normalizeProductPricing(
    { amount: 100, currency: 'USD' },
    { amount: 70, currency: 'EUR' }
  ), {
    price: 100,
    regularPrice: 100,
    salePrice: null,
    currency: 'USD',
    saleCurrency: null
  });

  assert.deepEqual(catalog.normalizeProductPricing(null, { amount: 75, currency: 'EUR' }), {
    price: 75,
    regularPrice: 75,
    salePrice: null,
    currency: 'EUR',
    saleCurrency: null
  });
  assert.equal(catalog.normalizeProductPricing({ amount: 50, currency: null }, null), null);
  assert.equal(catalog.normalizeProductPricing({ amount: 50_001, currency: 'USD' }, null), null);
  assert.deepEqual(catalog.normalizeProductShipping({ amount: 0, currency: null }), { cost: 0, currency: null });
  assert.deepEqual(catalog.normalizeProductShipping({ amount: 8, currency: 'usd' }), { cost: 8, currency: 'USD' });
  assert.deepEqual(catalog.normalizeProductShipping({ amount: 8, currency: null }), { cost: null, currency: null });
});

test('keeps only the newest complete record for one raw CJ offer even when its price changed', () => {
  const stale = {
    ...baseFeedProduct,
    lastUpdated: '2026-07-01T00:00:00Z',
    price: { amount: 110, currency: 'USD' }
  };
  const current = {
    ...baseFeedProduct,
    lastUpdated: '2026-07-02T00:00:00Z',
    price: { amount: 100, currency: 'USD' }
  };
  const anotherCatalog = { ...current, catalogId: 'catalog-2' };
  const products = catalog.deduplicateProducts([stale, anotherCatalog, current]);

  assert.equal(products.length, 2);
  assert.equal(products.find((product) => product.catalogId === 'catalog-1').price.amount, 100);
  assert.ok(products.some((product) => product.catalogId === 'catalog-2'));
});

test('retains separate currencies while collapsing duplicate retailer offers in exact comparisons', () => {
  const formatted = [
    { id: 'usd-high', advertiserId: '1001', catalogId: 'one', price: { amount: 100, currency: 'USD' } },
    { id: 'usd-low', advertiserId: '1001', catalogId: 'two', price: { amount: 90, currency: 'USD' } },
    { id: 'eur', advertiserId: '1001', catalogId: 'three', price: { amount: 80, currency: 'EUR' } },
    { id: 'other-usd', advertiserId: '2002', advertiserName: 'Second Retailer', catalogId: 'four', price: { amount: 95, currency: 'USD' } }
  ].map((overrides) => catalog.formatProduct({ ...baseFeedProduct, ...overrides }));

  const compared = catalog.attachOfferComparisons(formatted);
  for (const product of compared) {
    assert.equal(product.offerCount, 3);
    assert.deepEqual(product.comparison.map((offer) => `${offer.advertiserId}:${offer.currency}:${offer.price}`), [
      '1001:EUR:80',
      '1001:USD:90',
      '2002:USD:95'
    ]);
  }
});

test('uses valid GTIN check digits for universal matching and rejects malformed lengths', () => {
  assert.deepEqual(catalog.normalizeGtins('123456789012').map((item) => item.canonical), ['00123456789012']);
  assert.deepEqual(catalog.normalizeGtins('0123456789012').map((item) => item.canonical), ['00123456789012']);
  assert.deepEqual(catalog.normalizeGtins('12345678901'), []);
  assert.deepEqual(catalog.normalizeGtins('123456789013'), []);
});

test('sorts deterministically and does not compare bare prices across currencies', () => {
  const products = [
    { id: 'z', productKey: 'catalog:z', name: 'Same', brand: 'House', currency: 'USD', price: 1 },
    { id: 'b', productKey: 'catalog:b', name: 'Same', brand: 'House', currency: 'EUR', price: 100 },
    { id: 'a', productKey: 'catalog:a', name: 'Same', brand: 'House', currency: 'EUR', price: 100 }
  ];
  const low = catalog.rankProducts([...products], '', 'price_low', null, new Map());
  const high = catalog.rankProducts([...products].reverse(), '', 'price_high', null, new Map());

  assert.deepEqual(low.map((product) => product.id), ['a', 'b', 'z']);
  assert.deepEqual(high.map((product) => product.id), ['a', 'b', 'z']);
});

test('filters fragrance accessories while retaining an actual travel fragrance spray', () => {
  assert.equal(catalog.isFragranceProduct({
    title: '5 ml Refillable Perfume Atomizer Travel Spray Bottle',
    productType: 'Beauty Accessories'
  }), false);
  assert.equal(catalog.isFragranceProduct({
    title: 'Replacement Perfume Sprayer Nozzle',
    productType: 'Beauty Accessories'
  }), false);
  assert.equal(catalog.isFragranceProduct({
    title: 'Atlas Eau de Parfum Travel Spray 10 ml',
    productType: 'Perfume & Cologne'
  }), true);
});

test('rejects non-new conditions and non-retail fragrance presentations', () => {
  const accepted = [
    { ...baseFeedProduct, condition: 'NEW' },
    { ...baseFeedProduct, condition: null },
    { ...baseFeedProduct, advertiserName: 'TikTok Shop US - Marketplaces', condition: 'NEW' },
    { ...baseFeedProduct, title: 'Atlas Eau de Parfum Gift Set 3.4 oz', condition: 'New and sealed' }
  ];
  for (const product of accepted) {
    assert.equal(catalog.isNewRetailProduct(product), true, product.title);
    assert.ok(catalog.formatProduct(product), product.title);
  }

  const rejected = [
    { condition: 'USED' },
    { condition: 'Pre-owned' },
    { condition: 'Refurbished' },
    { condition: 'Open box' },
    { condition: 'New without box' },
    { condition: 'For parts' },
    { advertiserName: 'TikTok Shop US - Marketplaces', condition: null },
    { title: 'Atlas Eau de Parfum Tester 3.4 oz', condition: 'NEW' },
    { title: 'Atlas Eau de Parfum Sample Vial 2 ml', condition: 'NEW' },
    { title: 'Atlas Eau de Parfum Decant 10 ml', condition: 'NEW' },
    { title: 'Atlas Eau de Parfum Partial Bottle 50 ml' }
  ].map((overrides) => ({ ...baseFeedProduct, ...overrides }));

  for (const product of rejected) {
    assert.equal(catalog.isNewRetailProduct(product), false, `${product.condition || ''} ${product.title}`);
    assert.equal(catalog.formatProduct(product), null, `${product.condition || ''} ${product.title}`);
  }
});

test('removes monetization, ranking-strategy, and debug keys from public catalog payloads', () => {
  const clean = catalog.sanitizePublicCatalogPayload({
    products: [{
      id: 'safe',
      name: 'Atlas Eau de Parfum',
      revenue: { amount: 20 },
      commissionRate: 0.05,
      nested: { TEST_FIELD: true, safe: 'kept' }
    }],
    optimization: {
      ranking: 'featured',
      strategy: 'revenue-maximization',
      commissionDataUsed: false
    },
    sourceRevenue: 100,
    safeMetadata: { available: true }
  });

  assert.deepEqual(clean, {
    products: [{
      id: 'safe',
      name: 'Atlas Eau de Parfum',
      nested: { safe: 'kept' }
    }],
    optimization: { ranking: 'featured' },
    safeMetadata: { available: true }
  });
});

test('filters Dior and Chanel companion, makeup, and accessory spillover without losing fragrance sets', () => {
  const rejected = [
    'Dior Homme Cologne for Men - After Shave 3.3 oz',
    'Sauvage Cologne for Men - After-Shave Lotion 3.4 oz',
    'Miss Dior Moisturizing Body Milk 6.8 oz',
    'Chanel Rouge Coco Lipstick',
    'Chanel Les Beiges Foundation',
    'Dior Signature Sunglasses'
  ];
  for (const title of rejected) {
    assert.equal(catalog.isFragranceProduct({ title, productType: 'Perfume & Cologne' }), false, title);
  }

  assert.equal(catalog.isFragranceProduct({
    title: 'Dior Homme Eau de Toilette Gift Set with After Shave Balm',
    productType: 'Perfume & Cologne'
  }), true);
  assert.equal(catalog.isFragranceProduct({
    title: 'Chanel No. 5 Eau de Parfum Travel Spray 10 ml',
    productType: 'Beauty Accessories'
  }), true);
  assert.equal(catalog.isFragranceProduct({
    title: 'Chanel No. 5 Parfum Purse Spray 7.5 ml',
    productType: 'Perfume & Cologne'
  }), true);
  assert.equal(catalog.isFragranceProduct({
    title: 'Chanel Compact Mirror',
    productType: 'Beauty Accessories'
  }), false);
  assert.equal(catalog.isFragranceProduct({
    title: 'Avant for Unisex 100 ml',
    productType: 'Health & Beauty > Personal Care > Cosmetics > Perfume & Cologne'
  }), true);
});

test('keeps a general marketplace fragrance-only even when CJ assigns a misleading category', () => {
  assert.equal(catalog.isFragranceProduct({
    advertiserId: '7563286',
    advertiserName: 'TikTok Shop US',
    title: 'Luxury Perfume Bottle Phone Case',
    productType: 'Perfume & Cologne'
  }), false);

  assert.equal(catalog.isFragranceProduct({
    advertiserId: '7563286',
    advertiserName: 'TikTok Shop US',
    title: 'Amber Nocturne Eau de Parfum Spray 50 ml',
    productType: 'Beauty > Fragrance > Perfume & Cologne'
  }), true);
});

test('selects watch candidates in the requested currency and known delivery country', () => {
  const candidates = [
    { id: 'eur', productKey: 'gtin:test', offerKey: 'retailer:eur', price: 70, regularPrice: 70, salePrice: null, currency: 'EUR', serviceableAreas: ['US'], availability: 'IN_STOCK' },
    { id: 'usd-ca', productKey: 'gtin:test', offerKey: 'retailer:usd-ca', price: 80, regularPrice: 80, salePrice: null, currency: 'USD', targetCountry: 'CA', serviceableAreas: [], availability: 'IN_STOCK' },
    { id: 'usd-us', productKey: 'gtin:test', offerKey: 'retailer:usd-us', price: 90, regularPrice: 100, salePrice: 90, currency: 'USD', targetCountry: 'US', serviceableAreas: [], availability: 'IN_STOCK' }
  ];
  const selected = catalog.selectAlertProduct(candidates, {
    alert_type: 'price_drop',
    target_price: 95,
    currency: 'USD',
    country: 'US'
  });
  assert.equal(selected.id, 'usd-us');

  const deal = catalog.selectAlertProduct(candidates, {
    alert_type: 'deal',
    currency: 'USD',
    country: 'US'
  });
  assert.equal(deal.id, 'usd-us');
});

test('scopes variation groups to a retailer and accepts only secure destination URLs', () => {
  const product = catalog.formatProduct({
    ...baseFeedProduct,
    advertiserId: null,
    advertiserName: 'Named Retailer',
    itemGroupId: 'Atlas Variants',
    linkCode: { clickUrl: 'javascript:alert(1)' }
  });
  assert.match(product.variationGroupKey, /^advertiser:named-retailer:group:atlas-variants$/);
  assert.equal(product.buyUrl, 'https://retailer.example/atlas');

  assert.equal(catalog.formatProduct({
    ...baseFeedProduct,
    linkCode: { clickUrl: 'javascript:alert(1)' },
    link: 'http://insecure.example/atlas'
  }), null);
});
