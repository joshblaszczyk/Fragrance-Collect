import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { __catalogInternals as workerCatalog } from '../weathered-mud-6ed5/src/integrated-worker.js';

const source = readFileSync(new URL('../script.js', import.meta.url), 'utf8');

function loadSearchValidator() {
  const start = source.indexOf('const SecurityUtils');
  const end = source.indexOf('// Global variables for favorites filtering', start);
  assert.ok(start >= 0 && end > start, 'search validator should be discoverable');
  return new Function(`${source.slice(start, end)}; return SecurityUtils.validateSearchQuery;`)();
}

function loadIntentHelpers() {
  const start = source.indexOf('const SEARCH_INTENT_SLUGS');
  const end = source.indexOf('function searchIntentLabels', start);
  assert.ok(start >= 0 && end > start, 'search intent helpers should be discoverable');
  return new Function(`${source.slice(start, end)}; return { parseFragranceSearchIntent, matchesProductSearchIntent, mergeSearchIntentFromUrl };`)();
}

const { parseFragranceSearchIntent, matchesProductSearchIntent, mergeSearchIntentFromUrl } = loadIntentHelpers();
const validateSearchQuery = loadSearchValidator();

function facets(intent) {
  return {
    textQuery: intent.textQuery,
    retrievalQuery: intent.retrievalQuery,
    audience: intent.audience,
    concentration: intent.concentration,
    form: intent.form,
    presentation: intent.presentation,
    unitSizeMl: intent.unitSizeMl,
    packCount: intent.packCount
  };
}

test('parses explicit audience, concentration, form, qualified presentation, and sizes without treating bare hints as strict facets', () => {
  assert.deepEqual(facets(parseFragranceSearchIntent("Dior men's EDP spray tester 3.4 fl oz")), {
    textQuery: 'dior',
    retrievalQuery: 'dior',
    audience: 'Men',
    concentration: 'Eau de Parfum',
    form: 'Spray',
    presentation: 'Tester',
    unitSizeMl: 100,
    packCount: null
  });

  assert.deepEqual(facets(parseFragranceSearchIntent('unisex perfume oil refill 2 x 50 ml')), {
    textQuery: '',
    retrievalQuery: 'fragrance perfume',
    audience: 'Unisex',
    concentration: 'Perfume Oil',
    form: null,
    presentation: 'Refill',
    unitSizeMl: 50,
    packCount: 2
  });

  assert.equal(parseFragranceSearchIntent('women EDT gift set').audience, 'Women');
  assert.equal(parseFragranceSearchIntent('women EDT gift set').concentration, 'Eau de Toilette');
  assert.equal(parseFragranceSearchIntent('women EDT gift set').presentation, 'Set');
  assert.equal(parseFragranceSearchIntent('eau de cologne').concentration, 'Eau de Cologne');
  assert.equal(parseFragranceSearchIntent('male/female fragrance').audience, 'Unisex');
  assert.equal(parseFragranceSearchIntent('4 piece fragrance set').presentation, 'Set');
  assert.equal(parseFragranceSearchIntent('4 pcs fragrance set').textQuery, '');
  assert.equal(parseFragranceSearchIntent('6 pieces perfume set').textQuery, '');
  assert.equal(parseFragranceSearchIntent('perfume set').presentation, 'Set');
  assert.equal(parseFragranceSearchIntent('cologne').concentration, null, 'bare cologne is only a retrieval term');
  assert.equal(parseFragranceSearchIntent('set').presentation, null, 'bare set is not a verified presentation constraint');
});

test('keeps browser and Worker intent parsing in lockstep', () => {
  for (const query of [
    "men's EDP spray 3.4 fl oz",
    'male/female perfume oil roll-on 2 x 50 ml',
    'women EDT 4 piece fragrance set in stock free shipping',
    'unisex EDP atomiser 100 ml',
    'men parfum vaporizer 50 ml',
    '4 pcs fragrance set',
    '6 pieces perfume set',
    'cologne set'
  ]) {
    assert.deepEqual(facets(parseFragranceSearchIntent(query)), facets(workerCatalog.parseCatalogSearchIntent(query)), query);
  }
});

test('preserves international fragrance names during browser search validation', () => {
  assert.equal(validateSearchQuery('Lancôme Café Rose & L’Interdit'), 'Lancôme Café Rose & L’Interdit');
  assert.equal(validateSearchQuery(`Cafe\u0301 Noir`), `Cafe\u0301 Noir`, 'decomposed diacritics should remain intact');
  assert.equal(validateSearchQuery('Crème <No. 1> ✨'), 'Crème No. 1', 'unsafe delimiters and symbols should still be removed');
});

test('consumes common audience plurals and possessives with browser and Worker parity', () => {
  const cases = [
    ['woman’s Libre perfume', 'Women', 'libre'],
    ["man's Explorer fragrance", 'Men', 'explorer'],
    ['ladies’ Chance perfume', 'Women', 'chance'],
    ['gentlemen’s Givenchy fragrance', 'Men', 'givenchy'],
    ['males/females fragrance', 'Unisex', ''],
    ['females & males perfume oil', 'Unisex', '']
  ];

  for (const [query, audience, textQuery] of cases) {
    const browserIntent = parseFragranceSearchIntent(query);
    const workerIntent = workerCatalog.parseCatalogSearchIntent(query);
    assert.equal(browserIntent.audience, audience, query);
    assert.equal(browserIntent.textQuery, textQuery, `${query} should not leave audience grammar in text search`);
    assert.deepEqual(facets(browserIntent), facets(workerIntent), `${query} parser parity`);
  }

  const womenIntent = parseFragranceSearchIntent('woman’s perfume');
  const menIntent = parseFragranceSearchIntent('gentlemen’s fragrance');
  assert.equal(matchesProductSearchIntent({ audience: ['Females'] }, womenIntent), true);
  assert.equal(matchesProductSearchIntent({ audience: ['Ladies’'] }, womenIntent), true);
  assert.equal(workerCatalog.matchesCatalogSearchIntent({ audience: ['Males'] }, workerCatalog.parseCatalogSearchIntent('man’s fragrance')), true);
  assert.equal(workerCatalog.matchesCatalogSearchIntent({ audience: ["Gentlemen's"] }, workerCatalog.parseCatalogSearchIntent('gentlemen’s fragrance')), true);
  assert.equal(matchesProductSearchIntent({ audience: ['Women'] }, menIntent), false);
});

test('hydrates validated explicit URL facets without accepting malformed values', () => {
  const hydrated = mergeSearchIntentFromUrl(
    parseFragranceSearchIntent('Chanel'),
    new URLSearchParams('audience=women&concentration=eau_de_parfum&form=spray&presentation=refill&sizeMl=50&packCount=2')
  );
  assert.equal(hydrated.audience, 'Women');
  assert.equal(hydrated.concentration, 'Eau de Parfum');
  assert.equal(hydrated.form, 'Spray');
  assert.equal(hydrated.presentation, 'Refill');
  assert.equal(hydrated.unitSizeMl, 50);
  assert.equal(hydrated.packCount, 2);

  const malformed = mergeSearchIntentFromUrl(parseFragranceSearchIntent("men's fragrance"), new URLSearchParams('audience=children&sizeMl=-1&packCount=1'));
  assert.equal(malformed.audience, 'Men');
  assert.equal(malformed.unitSizeMl, null);
  assert.equal(malformed.packCount, null);
});

test('matches a complete structured intent and fails closed for each conflicting or unknown facet', () => {
  const intent = parseFragranceSearchIntent("men's eau de parfum spray tester 100 ml");
  const matching = {
    audience: ['Men'],
    fragranceConcentration: 'Eau de Parfum',
    fragranceForm: 'Spray',
    presentation: 'Tester',
    unitSizeMl: 100,
    canonicalSizeMl: 100,
    packCount: 1
  };

  assert.equal(matchesProductSearchIntent(matching, intent), true);
  assert.equal(matchesProductSearchIntent({ ...matching, fragranceConcentration: 'EDP', presentation: 'Tester' }, intent), true, 'retailer facet aliases should normalize before comparison');
  assert.equal(matchesProductSearchIntent({ ...matching, audience: ['Women'] }, intent), false);
  assert.equal(matchesProductSearchIntent({ ...matching, fragranceConcentration: 'Eau de Toilette' }, intent), false);
  assert.equal(matchesProductSearchIntent({ ...matching, fragranceForm: 'Roll-on' }, intent), false);
  assert.equal(matchesProductSearchIntent({ ...matching, presentation: 'Refill' }, intent), false);
  assert.equal(matchesProductSearchIntent({ ...matching, unitSizeMl: 50 }, intent), false);
  assert.equal(matchesProductSearchIntent({}, intent), false, 'an explicitly requested facet cannot be satisfied by missing metadata');
  assert.equal(workerCatalog.matchesCatalogSearchIntent(matching, workerCatalog.parseCatalogSearchIntent("men's eau de parfum spray tester 100 ml")), true);
  assert.equal(workerCatalog.matchesCatalogSearchIntent({ ...matching, audience: [] }, workerCatalog.parseCatalogSearchIntent("men's eau de parfum spray tester 100 ml")), false);
});

test('treats multipack unit size and count as independent exact constraints', () => {
  const intent = parseFragranceSearchIntent('unisex perfume oil refill 2 x 50 ml');
  const matching = {
    audience: ['Men', 'Women'],
    fragranceConcentration: 'Perfume Oil',
    presentation: 'Refill',
    unitSizeMl: 50,
    packCount: 2
  };

  assert.equal(matchesProductSearchIntent(matching, intent), true);
  assert.equal(matchesProductSearchIntent({ ...matching, unitSizeMl: 100, packCount: 1 }, intent), false, 'a 100 ml single is not two 50 ml units');
  assert.equal(matchesProductSearchIntent({ ...matching, unitSizeMl: 50, packCount: 1 }, intent), false);
  assert.equal(matchesProductSearchIntent({ ...matching, unitSizeMl: 50, packCount: 4 }, intent), false);
  assert.equal(matchesProductSearchIntent({
    audience: ['Unisex'],
    fragranceConcentration: 'Perfume Oil',
    presentation: 'Refill'
  }, intent), false, 'missing explicit size evidence fails closed');
});

test('accepts free shipping only when the feed supplies explicit evidence', () => {
  const intent = parseFragranceSearchIntent('free shipping perfume');
  assert.equal(matchesProductSearchIntent({ shippingCost: 0 }, intent), true);
  assert.equal(matchesProductSearchIntent({ shippingCost: null, freeShippingVerified: true }, intent), true);
  assert.equal(matchesProductSearchIntent({ shippingCost: null }, intent), false);
});
