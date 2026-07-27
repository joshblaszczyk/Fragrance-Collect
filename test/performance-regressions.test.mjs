import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');

test('initial catalog loading does not wait on third-party currency rates', () => {
  const catalog = read('script.js');
  const startup = catalog.slice(
    catalog.indexOf("document.addEventListener('DOMContentLoaded'"),
    catalog.indexOf("window.addEventListener('hashchange'")
  );
  const currencyRefresh = startup.indexOf('void currencyConverter.fetchRates()');
  const catalogLoad = startup.indexOf('await loadCJProducts(initialSearchTerm');

  assert.ok(currencyRefresh >= 0, 'startup does not launch the non-blocking rate refresh');
  assert.ok(catalogLoad > currencyRefresh, 'the catalog must begin while rates are refreshing');
  assert.doesNotMatch(startup, /await currencyConverter\.fetchRates\(\)/);
  assert.match(startup, /if \(!rates\) return;/);
  assert.match(startup, /populateCurrencyDropdown\(\);/);
  assert.match(startup, /selectedCurrency !== 'USD' && cjProducts\.length > 0/);
  assert.match(catalog, /window\.FragranceSelects\?\.refresh\(currencyDropdown\);/);
});

test('mega-menu artwork remains deferred until an intentional menu interaction', () => {
  const header = read('universal-header-script.js');
  const menuPages = readdirSync(root)
    .filter((file) => file.endsWith('.html'))
    .filter((file) => /class="mega-menu"/.test(read(file)));

  assert.ok(menuPages.length >= 9);
  assert.match(header, /function hydrateMedia\(\)/);
  assert.match(header, /if \(!image\.hasAttribute\('src'\) && image\.dataset\.src\)/);
  assert.match(header, /if \(open\) void hydrateCarouselMedia\?\.\(\);/);
  assert.match(header, /menuButton\?\.addEventListener\('focus'/);
  assert.match(header, /menuDropdown\?\.addEventListener\('mouseenter'/);
  assert.doesNotMatch(header, /images\.forEach\(\(image\) => \{\s*image\.loading = 'eager'/);

  for (const file of menuPages) {
    const page = read(file);
    assert.equal((page.match(/<img data-src="assets\/images\/(?:chanel|dior|creed)-card\.webp"[^>]*class="promo-image/g) || []).length, 3, file);
    assert.doesNotMatch(page, /<img src="assets\/images\/(?:chanel|dior|creed)-card\.webp"[^>]*class="promo-image/);
  }
});

test('the primary product-detail image decodes asynchronously', () => {
  const features = read('catalog-features.js');
  assert.match(features, /id="detail-primary-image"[^>]*width="720" height="720" decoding="async"/);
});
