import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const catalog = readFileSync(new URL('../script.js', import.meta.url), 'utf8');

test('currency conversion never relabels an unconverted amount', () => {
  assert.doesNotMatch(catalog, /currencyRates\[fromCurrency\]\s*\|\|\s*1/);
  assert.doesNotMatch(catalog, /return amount;\s*\/\/ Return original amount on error/);
  assert.match(catalog, /if \(!Number\.isFinite\(fromRate\)[\s\S]{0,140}return null/);
  assert.match(catalog, /if \(Number\.isFinite\(convertedPrice\)\)/);
  assert.match(catalog, /element\.textContent = `\$\{originalFormatted\} \$\{originalCurrency\}`/);
});

test('currency rates are bounded, validated, cached, and fetched without credentials', () => {
  assert.match(catalog, /const CURRENCY_FETCH_TIMEOUT_MS = 5000/);
  assert.match(catalog, /Object\.entries\(value\)\.slice\(0, 200\)/);
  assert.match(catalog, /credentials: 'omit'/);
  assert.match(catalog, /referrerPolicy: 'no-referrer'/);
  assert.match(catalog, /window\.localStorage\.setItem\(CURRENCY_CACHE_KEY/);
  assert.match(catalog, /let currencyRateFetchPromise = null/);
  assert.match(catalog, /if \(!currencyRateFetchPromise\)/);
  assert.match(catalog, /return await currencyRateFetchPromise/);
  assert.doesNotMatch(catalog, /ARS:\s*950|VND:\s*26500|Fallback to basic rates/);
});
