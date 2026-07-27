import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const catalog = readFileSync(new URL('script.js', root), 'utf8');
const designSystem = readFileSync(new URL('design-system.css', root), 'utf8');

function favoriteTransitionHarness(initial) {
  const start = catalog.indexOf('function favoriteQueueOwnerFor');
  const end = catalog.indexOf('function normalizeFavoriteId', start);
  assert.ok(start >= 0 && end > start, 'favorite transition source should be discoverable');
  const factory = new Function('initial', `
    const FAVORITE_QUEUE_KEY = 'fragrance_collect_favorite_queue';
    const FAVORITE_QUEUE_MAX_AGE = 24 * 60 * 60 * 1000;
    const values = new Map(initial.storage || []);
    const favoriteQueueStorage = {
      getItem(key) { return values.get(key) || null; },
      setItem(key, value) { values.set(key, value); },
      removeItem(key) { values.delete(key); }
    };
    let pendingFavoriteOperations = new Map(initial.pending || []);
    let favoriteQueueOwner = initial.queueOwner || '';
    let activeFavoriteOwner = initial.activeOwner || '';
    let userFavorites = new Set(initial.favorites || []);
    let currentFavorites = [...(initial.currentFavorites || [])];
    let favoriteStateRevision = 0;
    const favoriteRequestsInFlight = new Set(initial.inFlight || []);
    const favoriteProductData = new Map();
    const favoriteViewProductBackups = new Map();
    const favoriteViewProductIds = new Set();
    const authUI = { favoritesGrid: { replaceChildren() {} }, favoritesSection: { hidden: true } };
    const document = { querySelectorAll() { return []; } };
    function getCurrentUser() { return activeFavoriteOwner ? { id: activeFavoriteOwner } : null; }
    function normalizeFavoriteId(value) { return value == null ? '' : String(value).trim(); }
    function reconcileFavoriteIds(ids = []) {
      const result = new Set([...ids].map(normalizeFavoriteId).filter(Boolean));
      pendingFavoriteOperations.forEach((operation, id) => {
        if (operation.type === 'add') result.add(normalizeFavoriteId(id));
        if (operation.type === 'remove') result.delete(normalizeFavoriteId(id));
      });
      return result;
    }
    function updateAllFavoriteIcons() {}
    function showFavoritesEmptyState() {}
    ${catalog.slice(start, end)}
    return {
      transitionFavoriteAccount,
      state() {
        return {
          activeOwner: activeFavoriteOwner,
          queueOwner: favoriteQueueOwner,
          favorites: [...userFavorites],
          currentFavorites: [...currentFavorites],
          pending: [...pendingFavoriteOperations],
          inFlight: [...favoriteRequestsInFlight],
          stored: values.get(FAVORITE_QUEUE_KEY) || null,
          revision: favoriteStateRevision
        };
      }
    };
  `);
  return factory(initial);
}

test('restores and normalizes favorite state even while the favorites view is hidden', () => {
  assert.match(catalog, /userFavorites\s*=\s*reconcileFavoriteIds\(data\.favorites\.map/);
  assert.match(catalog, /const shouldRenderFavorites\s*=\s*Boolean\(/);
  assert.doesNotMatch(catalog, /if\s*\(authUI\.favoritesSection\.hidden\)\s*\{\s*return;/);
  assert.match(catalog, /normalizeFavoriteId\(btn\.dataset\.id\)/);
});

test('keeps pending offline favorite intent in the UI and accessible button state', () => {
  assert.match(catalog, /userFavorites\s*=\s*reconcileFavoriteIds\(userFavorites\)/);
  assert.match(catalog, /aria-pressed="\$\{isFavorited\}"/);
  assert.match(catalog, /Favorite saved and will sync when you are online/);
  assert.match(catalog, /setFavoriteState\(fragranceId, wasFavorited\)/);
});

test('serializes duplicate-card favorite requests and scopes persisted intent to the signed-in account', () => {
  assert.match(catalog, /const favoriteRequestsInFlight\s*=\s*new Set\(\)/);
  assert.match(catalog, /if \(favoriteRequestsInFlight\.has\(fragranceId\)\) return;/);
  assert.match(catalog, /setFavoriteButtonsBusyForId\(fragranceId, true\)/);
  assert.match(catalog, /favoriteRequestsInFlight\.delete\(fragranceId\);\s*setFavoriteButtonsBusyForId\(fragranceId, false\)/);
  assert.match(catalog, /if \(wasFavorited\)[\s\S]+pendingFavoriteOperations\.delete\(fragranceId\);\s*persistPendingFavoriteOperations\(\)/);
  assert.match(catalog, /for \(const \[fragranceId, operation\] of pendingFavoriteOperations\) \{\s*if \(favoriteRequestsInFlight\.has\(fragranceId\)\) continue;/);
  assert.match(catalog, /function favoriteQueueOwnerFor/);
  assert.match(catalog, /savedQueue\.owner === owner/);
  assert.match(catalog, /owner: favoriteQueueOwner/);
  assert.match(catalog, /document\.addEventListener\('fragrance:auth-change'/);
  assert.match(catalog, /clearPendingFavoriteOperations\(\)/);
  assert.doesNotMatch(catalog, /persistPendingFavoriteOperations\(\);\s*persistPendingFavoriteOperations\(\);/);
});

test('identity transitions clear old favorites and hydrate only the new account queue', () => {
  const storedQueue = JSON.stringify({
    owner: 'account-b',
    savedAt: Date.now(),
    operations: [['offer-b', { type: 'add', data: { fragrance_id: 'offer-b' } }]]
  });
  const harness = favoriteTransitionHarness({
    storage: [['fragrance_collect_favorite_queue', storedQueue]],
    activeOwner: 'account-a',
    queueOwner: 'account-a',
    pending: [['offer-a', { type: 'add' }]],
    favorites: ['offer-a', 'old-server-offer'],
    currentFavorites: [{ fragrance_id: 'old-server-offer' }],
    inFlight: ['offer-a']
  });

  harness.transitionFavoriteAccount({ id: 'account-b' });
  assert.deepEqual(harness.state().favorites, ['offer-b']);
  assert.deepEqual(harness.state().currentFavorites, []);
  assert.deepEqual(harness.state().inFlight, []);
  assert.equal(harness.state().activeOwner, 'account-b');

  harness.transitionFavoriteAccount(null);
  assert.deepEqual(harness.state().favorites, []);
  assert.deepEqual(harness.state().pending, []);
  assert.equal(harness.state().activeOwner, '');
  assert.equal(harness.state().stored, null);
});

test('auth-change owns favorite loading without a fixed-delay bootstrap', () => {
  assert.match(catalog, /document\.addEventListener\('fragrance:auth-change', async \(event\) =>/);
  assert.match(catalog, /if \(changedIdentity\) transitionFavoriteAccount\(event\.detail\?\.user \|\| null\)/);
  assert.match(catalog, /await loadUserFavorites\(owner\)/);
  assert.doesNotMatch(catalog, /setTimeout\(async \(\) => \{[\s\S]{0,800}loadUserFavorites/);
  assert.match(catalog, /expectedOwner !== activeFavoriteOwner/);
  assert.match(catalog, /operationOwner !== activeFavoriteOwner/);
  assert.match(catalog, /clearFavoriteViewProductData\(\)/);
});

test('renders a saved heart gold across hover, focus, and loading states', () => {
  assert.match(designSystem, /\.favorite-btn\.favorited:hover/);
  assert.match(designSystem, /\.favorite-btn\.favorited:focus-visible/);
  assert.match(designSystem, /\.favorite-btn\.favorited:disabled/);
  assert.match(designSystem, /\.favorite-btn\.favorited[\s\S]{0,500}color:\s*var\(--fc-gold\)/);
});

test('keeps filtered favorites in the selected currency and removes stale saved rows', () => {
  assert.match(catalog, /displayPrice,\s*displayCurrency/);
  assert.match(catalog, /displayedPriceCurrency/);
  assert.match(catalog, /const normalizedPriceAmount = SecurityUtils\.validateNumber\(priceAmount, 0, 10_000, 0\)/);
  assert.match(catalog, /const normalizedPriceCurrency = \/\^\[A-Z\]\{3\}\$\/\.test\(String\(priceCurrency/);
  assert.match(catalog, /data-original-price="\$\{normalizedPriceAmount\}" data-original-currency="\$\{normalizedPriceCurrency\}"/);
  assert.match(catalog, /const safeProductUrl = SecurityUtils\.escapeHtml\(SecurityUtils\.validateUrl/);
  assert.match(catalog, /function commitFavoriteRemoval\(fragranceId, triggerButton\)/);
  assert.match(catalog, /currentFavorites = currentFavorites\.filter/);
  assert.match(catalog, /if \(wasFavorited\) commitFavoriteRemoval\(fragranceId, button\)/);
  assert.doesNotMatch(catalog, /Second currency conversion pass/);
});

test('distinguishes a favorites loading failure from a genuinely empty wardrobe', () => {
  assert.match(catalog, /function showFavoritesLoadError\(\)/);
  assert.match(catalog, /Saved offers are unavailable/);
  assert.match(catalog, /authUI\.favoritesGrid\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(catalog, /authUI\.favoritesGrid\.removeAttribute\('aria-busy'\)/);
  assert.match(catalog, /function showFavoritesEmptyState\(\)/);
});

test('limits browser-only recently viewed offers to a bounded retention window', () => {
  assert.match(catalog, /const RECENTLY_VIEWED_MAX_AGE = 30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(catalog, /now - item\.viewedAt < RECENTLY_VIEWED_MAX_AGE/);
  assert.match(catalog, /item\.viewedAt <= now/);
});
