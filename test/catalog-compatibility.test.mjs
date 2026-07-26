import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const catalogSource = readFileSync(new URL('script.js', root), 'utf8');
const featureSource = readFileSync(new URL('catalog-features.js', root), 'utf8');
const featureStyles = readFileSync(new URL('feature-styles.css', root), 'utf8');
const siteConfig = readFileSync(new URL('site-config.js', root), 'utf8');

function loadCatalogMapper() {
  const start = catalogSource.indexOf('function mapProductsDataToItems');
  const end = catalogSource.indexOf('// ... existing code ...', start);
  assert.ok(start >= 0 && end > start, 'catalog mapper source should be discoverable');
  const factory = new Function(
    'SecurityUtils',
    `${catalogSource.slice(start, end)}; return mapProductsDataToItems;`
  );
  return factory({
    validateUrl(value) {
      return typeof value === 'string' ? value : '';
    },
    validateNumber(value, minimum, maximum, fallback) {
      const number = Number(value);
      return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback;
    }
  });
}

test('upgrades a sparse legacy CJ fragrance into a retailer-scoped, parsed listing', () => {
  const mapProducts = loadCatalogMapper();
  const title = 'Avant Fragrance World Perfume for Unisex - Eau de Parfum Spray 3.4 oz';
  const [product] = mapProducts({
    products: [{
      id: 'FS90353ga',
      advertiserId: '7287203',
      advertiser: 'FragranceShop.com',
      name: title,
      brand: 'Fragrance World',
      description: title,
      price: 17.95,
      currency: 'USD',
      image: 'https://example.com/avant.jpg',
      link: 'https://example.com/avant?size=eau-de-parfum-spray-3-4-oz',
      revenue: { commissionRate: 99 }
    }]
  });

  assert.deepEqual(product.size, ['3.4 fl oz / 100 ml']);
  assert.equal(product.canonicalSizeMl, 100);
  assert.equal(product.sizeSource, 'product title');
  assert.equal(product.fragranceConcentration, 'Eau de Parfum');
  assert.equal(product.fragranceForm, 'Spray');
  assert.deepEqual(product.audience, ['Unisex']);
  assert.equal(product.description, '');
  assert.equal(product.productKey, 'retailer:7287203:default:fs90353ga');
  assert.equal(product.matchConfidence, 'retailer');
  assert.equal(Object.hasOwn(product, 'revenue'), false);
});

test('keeps multipack fragrance variants distinct instead of treating total volume as one bottle', () => {
  const mapProducts = loadCatalogMapper();
  const [product] = mapProducts({
    products: [{
      id: 'set-4x7',
      advertiserId: '42',
      advertiser: 'Example Scent Shop',
      name: 'Discovery Perfume Gift Set 4 x 7 ml Eau de Toilette Spray',
      brand: 'Example House',
      price: 60,
      currency: 'USD',
      image: 'https://example.com/set.jpg',
      link: 'https://example.com/set'
    }]
  });

  assert.equal(product.packCount, 4);
  assert.equal(product.canonicalSizeMl, 7);
  assert.deepEqual(product.size, ['4 × 7 ml (28 ml total)']);
  assert.equal(product.presentation, 'Set');
});

test('uses legacy CJ gender and title evidence before incidental description copy', () => {
  const mapProducts = loadCatalogMapper();
  const products = mapProducts({
    products: [{
      id: 'legacy-men',
      advertiserId: '42',
      advertiser: 'Example Scent Shop',
      name: 'Atlas Eau de Parfum Spray 100 ml',
      description: 'A popular gift chosen by women.',
      gender: ['For Men'],
      brand: 'Example House',
      price: 60,
      currency: 'USD',
      image: 'https://example.com/atlas.jpg',
      link: 'https://example.com/atlas'
    }, {
      id: 'title-men',
      advertiserId: '42',
      advertiser: 'Example Scent Shop',
      name: 'Atlas Eau de Parfum for Men 100 ml',
      description: 'A popular gift chosen by women.',
      brand: 'Example House',
      price: 60,
      currency: 'USD',
      image: 'https://example.com/atlas.jpg',
      link: 'https://example.com/atlas-men'
    }, {
      id: 'title-unisex-alias',
      advertiserId: '42',
      advertiser: 'Example Scent Shop',
      name: 'Atlas Eau de Parfum Atomiser 100 ml for Men/Women',
      brand: 'Example House',
      price: 60,
      currency: 'USD',
      image: 'https://example.com/atlas.jpg',
      link: 'https://example.com/atlas-unisex'
    }]
  });
  assert.deepEqual(products.map((product) => product.audience), [['Men'], ['Men'], ['Unisex']]);
  assert.equal(products[2].fragranceForm, 'Spray');
});

test('filters mixed-retailer results to wearable fragrance products', () => {
  const mapProducts = loadCatalogMapper();
  const products = mapProducts({
    products: [
      { id: 'wearable', advertiserId: '1', name: 'Amber Eau de Parfum Spray', category: 'Perfume & Cologne', price: 40, image: 'https://example.com/a.jpg', link: 'https://example.com/a' },
      { id: 'gift-set', advertiserId: '1', name: 'Amber Eau de Parfum Gift Set with Body Lotion', category: 'Perfume & Cologne', price: 70, image: 'https://example.com/set.jpg', link: 'https://example.com/set' },
      { id: 'candle', advertiserId: '1', name: 'Amber Home Fragrance Candle', category: 'Home Fragrance', price: 25, image: 'https://example.com/b.jpg', link: 'https://example.com/b' },
      { id: 'lotion', advertiserId: '1', name: 'Perfumed Body Lotion', category: 'Bath & Body', price: 20, image: 'https://example.com/c.jpg', link: 'https://example.com/c' },
      { id: 'dior-aftershave', advertiserId: '1', name: 'Dior Homme Cologne for Men - After Shave 3.3 oz', category: 'Perfume & Cologne', price: 55, image: 'https://example.com/aftershave.jpg', link: 'https://example.com/aftershave' },
      { id: 'dior-body-milk', advertiserId: '1', name: 'Miss Dior Moisturizing Body Milk 6.8 oz', category: 'Perfume & Cologne', price: 62, image: 'https://example.com/body-milk.jpg', link: 'https://example.com/body-milk' },
      { id: 'chanel-lipstick', advertiserId: '1', name: 'Chanel Rouge Coco Lipstick', category: 'Perfume & Cologne', price: 45, image: 'https://example.com/lipstick.jpg', link: 'https://example.com/lipstick' },
      { id: 'dior-sunglasses', advertiserId: '1', name: 'Dior Signature Sunglasses', category: 'Perfume & Cologne', price: 320, image: 'https://example.com/sunglasses.jpg', link: 'https://example.com/sunglasses' },
      { id: 'fragrance-in-accessories', advertiserId: '1', name: 'Chanel No. 5 Eau de Parfum Travel Spray 10 ml', category: 'Beauty Accessories', price: 70, image: 'https://example.com/travel.jpg', link: 'https://example.com/travel' },
      { id: 'purse-spray', advertiserId: '1', name: 'Chanel No. 5 Parfum Purse Spray 7.5 ml', category: 'Perfume & Cologne', price: 150, image: 'https://example.com/purse-spray.jpg', link: 'https://example.com/purse-spray' },
      { id: 'sparse-fragrance', advertiserId: '1', name: 'Avant for Unisex 100 ml', category: 'Health & Beauty > Personal Care > Cosmetics > Perfume & Cologne', price: 25, image: 'https://example.com/sparse.jpg', link: 'https://example.com/sparse' },
      { id: 'organizer', advertiserId: '1', name: 'Perfume Organizer Stand', category: 'Perfume & Cologne', price: 30, image: 'https://example.com/d.jpg', link: 'https://example.com/d' },
      { id: 'air', advertiserId: '1', name: 'Perfume Air Freshener', category: 'Perfume & Cologne', price: 12, image: 'https://example.com/e.jpg', link: 'https://example.com/e' },
      { id: 'replacement', advertiserId: '1', name: 'Perfume Replacement Cap', category: 'Perfume & Cologne', price: 10, image: 'https://example.com/f.jpg', link: 'https://example.com/f' }
    ]
  });

  assert.deepEqual(products.map((product) => product.id), ['wearable', 'gift-set', 'fragrance-in-accessories', 'purse-spray', 'sparse-fragrance']);
});

test('browser defense removes non-new and non-retail presentations from stale catalog APIs', () => {
  const mapProducts = loadCatalogMapper();
  const products = mapProducts({
    products: [
      { id: 'new', advertiserId: '1', name: 'Atlas Eau de Parfum Spray 100 ml', condition: 'NEW', category: 'Perfume & Cologne', price: 80, link: 'https://example.com/new' },
      { id: 'unknown-condition', advertiserId: '1', name: 'Atlas Eau de Toilette Spray 50 ml', category: 'Perfume & Cologne', price: 60, link: 'https://example.com/unknown' },
      { id: 'marketplace-new', advertiserId: '2', advertiser: 'TikTok Shop US - Marketplaces', name: 'Atlas Eau de Parfum Spray 100 ml', condition: 'NEW', category: 'Perfume & Cologne', price: 75, link: 'https://example.com/marketplace-new' },
      { id: 'marketplace-unknown', advertiserId: '2', advertiser: 'TikTok Shop US - Marketplaces', name: 'Atlas Eau de Parfum Spray 100 ml', category: 'Perfume & Cologne', price: 65, link: 'https://example.com/marketplace-unknown' },
      { id: 'used', advertiserId: '1', name: 'Atlas Eau de Parfum Spray 100 ml', condition: 'USED', category: 'Perfume & Cologne', price: 40, link: 'https://example.com/used' },
      { id: 'open-box', advertiserId: '1', name: 'Atlas Eau de Parfum Spray 100 ml', condition: 'Open box', category: 'Perfume & Cologne', price: 50, link: 'https://example.com/open-box' },
      { id: 'new-without-box', advertiserId: '1', name: 'Atlas Eau de Parfum Spray 100 ml', condition: 'New without box', category: 'Perfume & Cologne', price: 55, link: 'https://example.com/new-without-box' },
      { id: 'tester', advertiserId: '1', name: 'Atlas Eau de Parfum Tester 100 ml', condition: 'NEW', category: 'Perfume & Cologne', price: 50, link: 'https://example.com/tester' },
      { id: 'sample', advertiserId: '1', name: 'Atlas Eau de Parfum Sample Vial 2 ml', condition: 'NEW', category: 'Perfume & Cologne', price: 8, link: 'https://example.com/sample' },
      { id: 'decant', advertiserId: '1', name: 'Atlas Eau de Parfum Decant 10 ml', condition: 'NEW', category: 'Perfume & Cologne', price: 20, link: 'https://example.com/decant' }
    ]
  });

  assert.deepEqual(products.map((product) => product.id), ['new', 'unknown-condition', 'marketplace-new']);
});

test('supplemental sections expose compact retryable fallbacks and catalog retailer recovery', () => {
  assert.match(featureSource, /renderDealsFallback/);
  assert.match(featureSource, /retailersFromCatalog/);
  assert.match(featureSource, /data-retry-deals/);
  assert.match(featureSource, /data-retry-retailers/);
  assert.match(featureSource, /Retailer-scoped identity/);
  assert.match(featureStyles, /\.catalog-fallback-panel/);
  assert.match(featureStyles, /\.has-compact-fallback/);
});

test('every environment keeps catalog, account, and static traffic on one origin', () => {
  assert.match(siteConfig, /window\.API_BASE\s*=\s*window\.location\.origin/);
  assert.match(siteConfig, /window\.CATALOG_API_BASE\s*=\s*window\.location\.origin/);
  assert.doesNotMatch(siteConfig, /workers\.dev|api=deployed|catalog=local/);
  assert.doesNotMatch(siteConfig, /window\.API_BASE\s*=\s*new URLSearchParams/);
});

test('omits unavailable facts and empty sections from product details', () => {
  assert.match(featureSource, /function hasDetailValue\(value\)/);
  assert.match(featureSource, /if \(!valid\) return ''/);
  assert.match(featureSource, /const specsMarkup = specs\.length \? `<section/);
  assert.match(featureSource, /countries\.length \? `<section/);
  assert.match(featureSource, /!factNames\.has\(detailSignature\(spec\.name\)\)/);
  assert.match(featureSource, /!factValues\.has\(detailSignature\(spec\.value\)\)/);
  assert.doesNotMatch(featureSource, /const inferredSpecs =/);
  assert.doesNotMatch(featureSource, /\['Condition', label\(product\.condition\) \|\| 'Not listed'\]/);
  assert.doesNotMatch(featureSource, /No country-level delivery coverage was supplied/);
  assert.doesNotMatch(featureSource, /No separate specifications were supplied/);
});

test('explains the deployed watch-contract mismatch instead of showing a raw 404', () => {
  assert.match(featureSource, /older deployed API, which does not support watches yet/);
  assert.match(featureSource, /if \(error\.status === 404\)/);
});
