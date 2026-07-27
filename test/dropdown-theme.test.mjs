import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const designSystem = readFileSync(new URL('../design-system.css', import.meta.url), 'utf8');
const selectEnhancer = readFileSync(new URL('../catalog-selects.js', import.meta.url), 'utf8');

test('uses the profile-menu dark surface as the default custom dropdown treatment', () => {
  assert.match(designSystem, /--fc-menu-surface:\s*rgba\(19, 19, 23,/);
  assert.match(designSystem, /\.mega-menu,\s*\.profile-menu\s*\{[\s\S]{0,300}background:\s*var\(--fc-menu-surface\)/);
  assert.match(designSystem, /\.fc-select__menu\s*\{[\s\S]{0,700}var\(--fc-menu-surface\)/);
  assert.match(designSystem, /\.fc-select__option\s*\{[\s\S]{0,600}color:\s*#e8e2d9/);
  assert.doesNotMatch(designSystem, /\.fc-select__menu\s*\{[\s\S]{0,700}#eee8dc/);
  assert.doesNotMatch(designSystem, /\.fc-select__menu\s*\{[\s\S]{0,700}rgba\(255, 255, 255, 0\.7\)/);
});

test('applies the shared dropdown to static and dynamically inserted site-owned selects', () => {
  assert.match(selectEnhancer, /const SELECTOR = 'select:not\(\[data-native-select\]\)'/);
  assert.match(selectEnhancer, /new MutationObserver\(\(mutations\)/);
  assert.match(selectEnhancer, /enhanceAll\(node\)/);
  assert.match(selectEnhancer, /select\.addEventListener\('invalid'/);
  assert.match(selectEnhancer, /button\.setAttribute\('aria-invalid', 'true'\)/);

  for (const page of ['main.html', 'account.html', 'contact.html', 'size-guide.html', 'admin.html']) {
    const source = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.match(source, /<script src="catalog-selects\.js"><\/script>/, `${page} must load the shared dropdown enhancer`);
  }
});

test('keeps enhanced selects usable through labels, typeahead, and rapid dismissal', () => {
  assert.match(selectEnhancer, /\(label \|\| wrappingLabel\)\?\.addEventListener\('click'/);
  assert.match(selectEnhancer, /function focusTypeaheadMatch\(character\)/);
  assert.match(selectEnhancer, /event\.key\.length === 1 && !event\.ctrlKey && !event\.metaKey && !event\.altKey/);
  assert.match(selectEnhancer, /if \(!wrapper\.classList\.contains\('is-open'\)\) return;/);
  assert.match(selectEnhancer, /open\(\{ focus: event\.key === 'Home' \? 'first' : 'last' \}\)/);
});
