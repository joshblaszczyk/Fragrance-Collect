import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const catalogSource = readFileSync(new URL('script.js', root), 'utf8');
const featureSource = readFileSync(new URL('catalog-features.js', root), 'utf8');

function loadCatalogMapper() {
  const start = catalogSource.indexOf('function mapProductsDataToItems');
  const end = catalogSource.indexOf('// ... existing code ...', start);
  assert.ok(start >= 0 && end > start, 'catalog mapper source should be discoverable');
  const factory = new Function(
    'SecurityUtils',
    'canonicalAudience',
    'normalizeSearchIntentText',
    'SEARCH_AUDIENCE_PATTERNS',
    `${catalogSource.slice(start, end)}; return mapProductsDataToItems;`
  );
  const normalize = (value) => String(value || '').toLowerCase().replace(/[’‘`]/g, "'").trim();
  return factory(
    {
      validateUrl(value) {
        return typeof value === 'string' ? value : '';
      },
      validateNumber(value, minimum, maximum, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback;
      }
    },
    (value) => {
      const text = normalize(Array.isArray(value) ? value.join(' ') : value);
      if (/\bunisex\b/.test(text)) return 'Unisex';
      if (/\b(?:women|woman|female|ladies)\b/.test(text)) return 'Women';
      if (/\b(?:men|man|male)\b/.test(text)) return 'Men';
      return null;
    },
    normalize,
    {
      unisex: /\bunisex\b/,
      women: /\b(?:women|woman|female|ladies)\b/,
      men: /\b(?:men|man|male)\b/
    }
  );
}

test('keeps duplicate retailer SKUs distinct throughout catalog interactions', () => {
  const mapProducts = loadCatalogMapper();
  const products = mapProducts({
    products: [{
      id: 'SHARED-SKU-100',
      sourceProductId: 'SHARED-SKU-100',
      offerKey: 'retailer:v1:1001:catalog-a:shared-sku-100:aaaa1111',
      productKey: 'gtin:00012345678905',
      advertiserId: '1001',
      advertiser: 'First Retailer',
      name: 'Atlas Eau de Parfum Spray 100 ml',
      brand: 'Atlas House',
      price: 100,
      currency: 'USD',
      image: 'https://example.com/first.jpg',
      link: 'https://example.com/first'
    }, {
      id: 'SHARED-SKU-100',
      sourceProductId: 'SHARED-SKU-100',
      offerKey: 'retailer:v1:2002:catalog-b:shared-sku-100:bbbb2222',
      productKey: 'gtin:00012345678905',
      advertiserId: '2002',
      advertiser: 'Second Retailer',
      name: 'Atlas Eau de Parfum Spray 100 ml',
      brand: 'Atlas House',
      price: 105,
      currency: 'USD',
      image: 'https://example.com/second.jpg',
      link: 'https://example.com/second'
    }]
  });

  assert.equal(products.length, 2);
  assert.deepEqual(products.map((product) => product.id), ['SHARED-SKU-100', 'SHARED-SKU-100']);
  assert.deepEqual(products.map((product) => product.sourceProductId), ['SHARED-SKU-100', 'SHARED-SKU-100']);
  assert.notEqual(products[0].interactionKey, products[1].interactionKey);
  assert.equal(products[0].interactionKey, products[0].offerKey);
  assert.equal(products[1].interactionKey, products[1].offerKey);

  const keyedProducts = new Map(products.map((product) => [product.interactionKey, product]));
  assert.equal(keyedProducts.size, 2, 'both offers must remain addressable by details and favorite controls');

  const fallbackProducts = mapProducts({
    products: products.map(({ interactionKey, offerKey, ...product }) => ({
      ...product,
      productKey: 'gtin:00012345678905'
    }))
  });
  assert.notEqual(
    fallbackProducts[0].interactionKey,
    fallbackProducts[1].interactionKey,
    'legacy responses without offerKey must still scope the UI identity by retailer'
  );
  assert.match(fallbackProducts[0].interactionKey, /^retailer:client-v1:1001:/);
  assert.match(fallbackProducts[1].interactionKey, /^retailer:client-v1:2002:/);
});

test('uses interaction keys for UI maps and favorites while retaining source IDs for outbound logging', () => {
  assert.match(catalogSource, /favoriteProductData\.set\(interactionKey, perfumeData\)/);
  assert.match(catalogSource, /catalogProductData\.set\(interactionKey,/);
  assert.match(catalogSource, /data-product-details="\$\{safeInteractionKey\}"/);
  assert.match(catalogSource, /productId:\s*interactionKey/);
  assert.match(catalogSource, /const fragranceId = productInteractionKey\(perfume\)/);
  assert.match(catalogSource, /fragrance_id:\s*fragranceId/);
  assert.match(catalogSource, /data-outbound-product="\$\{safeSourceProductId\}"/);
  assert.match(featureSource, /data-detail-outbound="\$\{escape\(product\.sourceProductId \|\| product\.id\)\}"/);
});
