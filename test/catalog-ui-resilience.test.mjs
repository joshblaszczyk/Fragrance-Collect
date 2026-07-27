import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const catalog = readFileSync(new URL('script.js', root), 'utf8');
const features = readFileSync(new URL('catalog-features.js', root), 'utf8');
const featureStyles = readFileSync(new URL('feature-styles.css', root), 'utf8');

test('suppresses repeated retailer offers before rendering catalog cards', () => {
  assert.match(catalog, /function dedupeCatalogProducts\(products\)/);
  assert.match(catalog, /const key = productInteractionKey\(product\)/);
  assert.match(catalog, /(?:const|let) mappedProducts = dedupeCatalogProducts\(rawMappedProducts\)/);
  assert.match(catalog, /returnedDuplicateOffers \|\| returnedUnrelatedBrands/);
});

test('keeps watch submission attached to the open product instead of a stale trigger', () => {
  assert.match(features, /dialog\.dataset\.productId = String\(productId \|\| ''\)/);
  assert.match(features, /form\.closest\('#product-detail-dialog'\)\?\.dataset\.productId/);
});

test('replaces failed detail and thumbnail images with the dark site placeholder', () => {
  assert.match(features, /#detail-primary-image, \.detail-thumbnails img/);
  assert.match(features, /image\.src = detailImageFallback/);
  assert.match(featureStyles, /img\[src\$="fragrance-placeholder\.svg"\][\s\S]{0,180}mix-blend-mode:\s*normal/);
});
