import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const features = readFileSync(new URL('catalog-features.js', root), 'utf8');
const styles = readFileSync(new URL('feature-styles.css', root), 'utf8');
const main = readFileSync(new URL('main.html', root), 'utf8');

test('keeps the four configured CJ programs visible when the live directory is unavailable', () => {
  for (const [id, name] of [
    ['7287203', 'FragranceShop.com'],
    ['1024283', 'FragranceX.com'],
    ['904674', 'Perfumania.com'],
    ['7563286', 'TikTok Shop US']
  ]) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(features, new RegExp(`id: '${id}', name: '${escapedName}'`));
  }
  assert.match(features, /joinedRetailerSnapshot\.forEach\(\(advertiser\) => add\(advertiser, 'snapshot'\)\)/);
  assert.match(features, /retailersFromCatalog\(\)\.forEach\(\(advertiser\) => add\(advertiser, 'catalog'\)\)/);
});

test('labels catalog access separately from a joined CJ relationship', () => {
  assert.match(features, /Joined · searchable catalog unavailable/);
  assert.match(features, /Joined · searchable catalog/);
  assert.match(features, /Joined snapshot · catalog unavailable/);
  assert.match(main, /A joined program may not supply a searchable product catalog/);
});

test('prioritizes fragrance specialists and identifies a general marketplace', () => {
  assert.match(features, /const priority = \{ fragrance: 0, general: 1, marketplace: 2 \}/);
  assert.match(features, /General marketplace · fragrance offers only/);
  assert.match(features, /kind: 'marketplace'/);
  assert.match(styles, /\.retailer-item--marketplace \.retailer-monogram/);
});

test('retailer directory has dark loading, cached, empty, and retry states', () => {
  assert.match(features, /readCachedRetailerDirectory/);
  assert.match(features, /renderRetailerEmpty/);
  assert.match(features, /data-retry-retailers/);
  assert.match(features, /state: lastRetailerDirectoryState/);
  assert.match(styles, /\.retailer-loading-list i/);
  assert.doesNotMatch(styles.match(/\.retailer-loading-list i[\s\S]*?\n\}/)?.[0] || '', /background:\s*(?:#fff|white)/i);
});
