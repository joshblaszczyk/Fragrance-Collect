import test from 'node:test';
import assert from 'node:assert/strict';

import { __catalogInternals as catalog } from '../weathered-mud-6ed5/src/integrated-worker.js';

const sparseAvant = {
  id: 'FS90353ga',
  catalogId: 'catalog-42',
  adId: '16941446',
  advertiserId: '7287203',
  advertiserName: 'FragranceShop.com',
  title: 'Avant Fragrance World Perfume for Unisex - Eau de Parfum Spray 3.4 oz',
  brand: 'Fragrance World',
  description: 'Avant Fragrance World Perfume for Unisex - Eau de Parfum Spray 3.4 oz',
  productType: ['Health & Beauty > Personal Care > Cosmetics > Perfume & Cologne'],
  imageLink: 'https://example.com/avant.jpg',
  link: 'https://www.fragranceshop.com/product/avant-fragrance-world-for-unisex/?attribute_pa_size=eau-de-parfum-spray-3-4-oz',
  linkCode: { clickUrl: 'https://www.tkqlhce.com/click/example' },
  price: { amount: 17.95, currency: 'USD' },
  shipping: { price: { amount: 0, currency: 'USD' } }
};

test('turns the sparse Avant feed record into a useful exact retailer offer', () => {
  assert.equal(catalog.isFragranceProduct(sparseAvant), true);
  const product = catalog.formatProduct(sparseAvant);

  assert.equal(product.catalogId, 'catalog-42');
  assert.match(product.offerKey, /^retailer:v1:7287203:catalog-42:fs90353ga:/);
  assert.equal(product.productKey, product.offerKey);
  assert.equal(product.matchMethod, 'Retailer catalog ID');
  assert.equal(product.matchConfidence, 'retailer');
  assert.equal(product.normalizedSizeMl, 100);
  assert.equal(product.size[0], '3.4 fl oz / 100 mL');
  assert.equal(product.sizeSource, 'product title');
  assert.equal(product.sizeConfidence, 'inferred');
  assert.equal(product.concentration, 'Eau de Parfum');
  assert.equal(product.fragranceConcentration, 'Eau de Parfum');
  assert.equal(product.fragranceForm, 'Spray');
  assert.equal(product.presentation, 'Single bottle');
  assert.deepEqual(product.audience, ['Unisex']);
  assert.equal(product.description, null, 'a title repeated as the description should not create a duplicate section');

  const withoutImage = catalog.formatProduct({ ...sparseAvant, id: 'FS90353-no-image', imageLink: null });
  assert.ok(withoutImage, 'a valid retailer offer should use the site placeholder instead of disappearing when CJ has no image');
  assert.equal(withoutImage.image, null);

  const withoutBrand = catalog.formatProduct({ ...sparseAvant, id: 'FS90353-no-brand', brand: null, mpn: 'REUSED-SKU' });
  assert.equal(withoutBrand.brand, 'Unknown brand', 'a retailer name must not be presented as the fragrance house');
  assert.equal(withoutBrand.matchConfidence, 'retailer', 'an unknown house plus MPN must not be treated as a cross-retailer identity');
});

test('uses ranked structured size sources and keeps sets distinct from bottles', () => {
  const structured = catalog.extractFragranceSize({
    title: 'Example Eau de Parfum 3.4 oz',
    productDetail: []
  }, [{ attributeName: 'Volume', attributeValue: '50 ml' }]);
  assert.equal(structured.canonicalMl, 50);
  assert.equal(structured.source, 'retailer specification');
  assert.equal(structured.confidence, 'reported');

  const set = catalog.parseFragranceVolume('Discovery perfume set 4 x 7ml');
  assert.deepEqual(set, {
    canonicalMl: 7,
    unitMl: 7,
    totalMl: 28,
    quantity: 4,
    display: '4 × 7 mL'
  });
});

test('prefers the retailer gender field over incidental audience wording', () => {
  const product = catalog.formatProduct({
    ...sparseAvant,
    id: 'structured-men',
    title: 'Atlas Eau de Parfum Spray 100 ml',
    gender: ['For Men'],
    description: 'Often purchased by women as a gift.'
  });
  assert.deepEqual(product.audience, ['Men']);

  const unisex = catalog.formatProduct({
    ...sparseAvant,
    id: 'structured-unisex',
    title: 'Atlas Eau de Parfum Spray 100 ml',
    gender: ['Male/Female']
  });
  assert.deepEqual(unisex.audience, ['Unisex']);

  const slashUnisex = catalog.formatProduct({
    ...sparseAvant,
    id: 'title-unisex-slash',
    title: 'Atlas Eau de Parfum Spray 100 ml for Men/Women',
    gender: []
  });
  assert.deepEqual(slashUnisex.audience, ['Unisex']);
});

test('keeps spray aliases consistent from feed extraction through semantic matching', () => {
  for (const alias of ['Atomizer', 'Atomiser', 'Vaporizer', 'Vaporiser']) {
    const product = catalog.formatProduct({
      ...sparseAvant,
      id: `spray-${alias.toLowerCase()}`,
      title: `Atlas Eau de Parfum ${alias} 100 ml`,
      description: null
    });
    const intent = catalog.parseCatalogSearchIntent(`eau de parfum ${alias.toLowerCase()} 100 ml`);

    assert.equal(product.fragranceForm, 'Spray', alias);
    assert.equal(intent.form, 'Spray', `${alias} query intent`);
    assert.equal(catalog.matchesCatalogSearchIntent(product, intent), true, alias);
  }
});

test('excludes unrelated products even when a merchant or title uses fragrance language', () => {
  assert.equal(catalog.isFragranceProduct({
    title: 'Fragrance World Scented Candle 10 oz',
    brand: 'Fragrance World',
    productType: 'Home Fragrance > Candles'
  }), false);
  assert.equal(catalog.isFragranceProduct({
    title: 'Fragrance World Logo Tote Bag',
    brand: 'Fragrance World',
    productType: 'Accessories > Bags'
  }), false);
  assert.equal(catalog.isFragranceProduct({
    title: 'Avant for Unisex 100 ml',
    productType: 'Health & Beauty > Personal Care > Cosmetics > Perfume & Cologne'
  }), true);
  assert.equal(catalog.isFragranceProduct({
    title: 'Atlas Eau de Parfum Gift Set with Body Lotion',
    productType: 'Health & Beauty > Perfume & Cologne'
  }), true, 'a qualified fragrance set should not be discarded because it includes a companion product');
});

test('canonicalizes equivalent GTIN forms but scopes retailer SKUs to their CJ catalog', () => {
  const upc = catalog.createProductIdentity({
    ...sparseAvant,
    gtin: '123456789012'
  });
  const ean = catalog.createProductIdentity({
    ...sparseAvant,
    gtin: '0123456789012'
  });
  assert.equal(upc.key, ean.key);
  assert.equal(upc.gtin, '123456789012');

  const firstCatalog = catalog.createProductIdentity(sparseAvant);
  const secondCatalog = catalog.createProductIdentity({ ...sparseAvant, catalogId: 'catalog-99' });
  assert.notEqual(firstCatalog.offerKey, secondCatalog.offerKey);
});

test('does not compare conflicting concentrations, sizes, or presentations', () => {
  const base = {
    concentration: 'Eau de Parfum',
    presentation: 'Single bottle',
    fragranceForm: 'Spray',
    normalizedSizeMl: 100,
    sizeQuantity: 1
  };
  assert.equal(catalog.areFragranceVariantsCompatible(base, { ...base }), true);
  assert.equal(catalog.areFragranceVariantsCompatible(base, { ...base, normalizedSizeMl: 50 }), false);
  assert.equal(catalog.areFragranceVariantsCompatible(base, { ...base, concentration: 'Eau de Toilette' }), false);
  assert.equal(catalog.areFragranceVariantsCompatible(base, { ...base, presentation: 'Refill' }), false);
});
