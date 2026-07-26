import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { __catalogInternals as catalog } from '../weathered-mud-6ed5/src/integrated-worker.js';

const main = readFileSync(new URL('../main.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../weathered-mud-6ed5/src/integrated-worker.js', import.meta.url), 'utf8');

function loadClientBrandHelpers() {
  const start = client.indexOf('const SIGNATURE_BRANDS');
  const end = client.indexOf('function updateBrandUrl', start);
  assert.ok(start >= 0 && end > start);
  return new Function(`${client.slice(start, end)}; return { brandFromUrl, rememberBrand, recognizedBrandOnlySearch, recognizedBrandInSearch, matchesCatalogBrand, matchesExactCatalogText };`)();
}

test('builds exact brand recognition into search and applies it to House Signatures', () => {
  assert.doesNotMatch(main, /id="brand-filter"/);
  assert.match(main, /id="search-intent-status"/);
  assert.doesNotMatch(main, /id="brand-search-status"/);
  assert.match(main, /data-brand="Tom Ford"[\s\S]+?\?q=Tom%20Ford&amp;brand=Tom%20Ford#filter/);
  assert.match(client, /const initialBrand = explicitBrand[\s\S]{0,180}recognizedBrandOnlySearch\(requestedSearchTerm\)[\s\S]{0,120}recognizedBrandInSearch\(requestedSearchTerm\)/);
  assert.match(client, /\['ysl', 'Yves Saint Laurent'\]/);
  assert.match(client, /\['mfk', 'Maison Francis Kurkdjian'\]/);
  assert.match(client, /loadCJProducts\(initialSearchTerm, 1, null, buildServerFilters\(\)\)/);
  assert.match(client, /currentFilters\.brand = canonicalBrand/);
  assert.match(client, /updateBrandUrl\(canonicalBrand, \{ searchTerm: searchQuery \}\)/);
  assert.match(client, /mappedProducts\.filter\(\(product\) => \([\s\S]{0,180}matchesCatalogBrand\(product\.brand, enforcedBrand\)[\s\S]{0,240}matchesProductSearchIntent\(product, enforcedIntent\)/);
  assert.match(client, /if \(requestRevision !== catalogRequestRevision\) return data/);
  assert.match(worker, /brand: brandFilter/);
});

test('matches canonical brand identities without substring false positives', () => {
  assert.equal(catalog.normalizeBrandKey('Tom-Ford'), 'tom ford');
  assert.equal(catalog.normalizeBrandKey('Parfums Christian Dior'), 'dior');
  assert.equal(catalog.normalizeBrandKey('YSL'), 'yves saint laurent');
  assert.equal(catalog.normalizeBrandKey('Dolce & Gabbana'), 'dolce and gabbana');

  assert.equal(catalog.matchesBrandFilter('Christian Dior', 'Dior'), true);
  assert.equal(catalog.matchesBrandFilter('Tom Ford Beauty', 'tom-ford'), true);
  assert.equal(catalog.matchesBrandFilter('Diorama Parfums', 'Dior'), false);
  assert.equal(catalog.matchesBrandFilter('Ford Fragrances', 'Tom Ford'), false);
  assert.equal(catalog.matchesBrandFilter('Chanel', ''), true);
  assert.equal(catalog.matchesRawProductBrand({ brand: ['Chanel'] }, 'Chanel'), true);
  assert.equal(catalog.matchesRawProductBrand({ brand: [], advertiserName: 'Chanel' }, 'Chanel'), false);
  assert.equal(catalog.matchesRawProductBrand({ brand: ['Chanel-inspired'] }, 'Chanel'), false);
});

test('hydrates common brand aliases with polished display labels', () => {
  const helpers = loadClientBrandHelpers();
  assert.equal(helpers.brandFromUrl('tom-ford'), 'Tom Ford');
  assert.equal(helpers.brandFromUrl('ysl'), 'Yves Saint Laurent');
  assert.equal(helpers.brandFromUrl('mfk'), 'Maison Francis Kurkdjian');
  assert.equal(helpers.rememberBrand('Parfums Christian Dior'), 'Dior');
  assert.equal(helpers.recognizedBrandOnlySearch('CHANEL'), 'Chanel');
  assert.equal(helpers.recognizedBrandOnlySearch('tom-ford'), 'Tom Ford');
  assert.equal(helpers.recognizedBrandOnlySearch('Diorama'), '');
  assert.equal(helpers.recognizedBrandOnlySearch('Chanel No. 5'), '');
  assert.equal(helpers.matchesCatalogBrand('Chanel Paris', 'Chanel'), true);
  assert.equal(helpers.matchesCatalogBrand('Chanel-inspired', 'Chanel'), false);
});

test('recognizes aliases inside longer product searches and enforces their canonical house', () => {
  const helpers = loadClientBrandHelpers();
  assert.equal(helpers.recognizedBrandInSearch('YSL Libre'), 'Yves Saint Laurent');
  assert.equal(helpers.recognizedBrandInSearch('MFK Baccarat Rouge 540'), 'Maison Francis Kurkdjian');
  assert.equal(helpers.recognizedBrandInSearch('Saint Laurent Libre EDP'), 'Yves Saint Laurent');
  assert.equal(helpers.matchesCatalogBrand('YSL', helpers.recognizedBrandInSearch('YSL Libre')), true);
  assert.equal(helpers.matchesCatalogBrand('Maison Francis Kurkdjian Paris', helpers.recognizedBrandInSearch('MFK Baccarat Rouge')), true);
  assert.equal(helpers.matchesCatalogBrand('Dior', helpers.recognizedBrandInSearch('YSL Libre')), false);

  helpers.rememberBrand('Khadlaj');
  assert.equal(helpers.recognizedBrandInSearch('Khadlaj Jameel'), 'Khadlaj');
  assert.equal(helpers.matchesCatalogBrand('Other House', helpers.recognizedBrandInSearch('Khadlaj Jameel')), false);
});

test('discovers a feed brand inside a longer cold-load query before rendering results', () => {
  assert.match(client, /const responseDiscoveredBrand = !filters\.brand && !currentFilters\.brand[\s\S]{0,120}recognizedBrandOnlySearch\(query\) \|\| recognizedBrandInSearch\(query\)/);
});

test('treats canonical brand aliases as equivalent when matching all search words', () => {
  const helpers = loadClientBrandHelpers();
  const ysl = { name: 'Libre Eau de Parfum Spray', brand: 'Yves Saint Laurent', description: '' };
  const mfk = { name: 'Baccarat Rouge 540 Eau de Parfum', brand: 'Maison Francis Kurkdjian', description: '' };

  assert.equal(helpers.matchesExactCatalogText(ysl, 'YSL Libre'), true);
  assert.equal(helpers.matchesExactCatalogText(mfk, 'MFK Baccarat Rouge'), true);
  assert.equal(helpers.matchesExactCatalogText(ysl, 'YSL Sauvage'), false);
  assert.equal(catalog.matchesExactCatalogText({ title: ysl.name, brand: ysl.brand }, 'YSL Libre'), true);
  assert.equal(catalog.matchesExactCatalogText({ title: mfk.name, brand: mfk.brand }, 'MFK Baccarat Rouge'), true);
  assert.equal(catalog.matchesExactCatalogText({ title: ysl.name, brand: ysl.brand }, 'YSL Sauvage'), false);
});

test('uses the selected brand in upstream discovery before enforcing it locally', () => {
  assert.match(worker, /const brandQuery = normalizeText\(options\.brand, 100\)/);
  assert.match(worker, /queryAlreadyNamesBrand/);
  assert.match(worker, /matchesBrandFilter\(product\.brand, brandFilter\)/);
  assert.match(worker, /matchesRawProductBrand\(product, brandFilter\)/);
  assert.doesNotMatch(worker, /product\.brand \|\| ''\)\.toLowerCase\(\)\.includes\(brandFilter\.toLowerCase\(\)\)/);
});

test('retries one stale-Worker zero-result brand request without weakening browser enforcement', () => {
  assert.match(client, /const shouldRetryWithoutServerBrand = Boolean\(filters\.brand && requestedBrand\)/);
  assert.match(client, /!mappedProducts\.some\(\(product\) => matchesCatalogBrand\(product\.brand, requestedBrand\)\)/);
  assert.match(client, /const compatibilityData = await fetchProductsFromApi\(query, page, limit, \{ \.\.\.filters, brand: '' \}\)/);
  assert.match(client, /catch \{\s*\/\/ The original successful empty response is still usable/);
  assert.match(client, /shouldRetryWithoutServerBrand \|\| returnedDuplicateOffers/);
  assert.match(client, /matchesCatalogBrand\(product\.brand, enforcedBrand\)[\s\S]{0,180}matchesProductSearchIntent\(product, enforcedIntent\)/);
});
