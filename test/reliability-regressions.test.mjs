import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const catalog = readFileSync(new URL('script.js', root), 'utf8');
const account = readFileSync(new URL('account.js', root), 'utf8');
const accountHtml = readFileSync(new URL('account.html', root), 'utf8');
const auth = readFileSync(new URL('auth-script.js', root), 'utf8');
const authHtml = readFileSync(new URL('auth.html', root), 'utf8');
const authStyles = readFileSync(new URL('auth-styles.css', root), 'utf8');
const accountStyles = readFileSync(new URL('account-styles.css', root), 'utf8');
const contact = readFileSync(new URL('contact-script.js', root), 'utf8');
const header = readFileSync(new URL('universal-header-script.js', root), 'utf8');
const worker = readFileSync(new URL('weathered-mud-6ed5/src/integrated-worker.js', root), 'utf8');
const catalogFeatures = readFileSync(new URL('catalog-features.js', root), 'utf8');
const catalogSelects = readFileSync(new URL('catalog-selects.js', root), 'utf8');
const cjIntegration = readFileSync(new URL('weathered-mud-6ed5/src/cj-integration.js', root), 'utf8');
const build = readFileSync(new URL('scripts/build-site.mjs', root), 'utf8');
const pageReview = readFileSync(new URL('scripts/capture-page-review.mjs', root), 'utf8');
const designSystem = readFileSync(new URL('design-system.css', root), 'utf8');
const indexHtml = readFileSync(new URL('index.html', root), 'utf8');
const redirect = readFileSync(new URL('redirect-script.js', root), 'utf8');
const html = readdirSync(root)
  .filter((file) => file.endsWith('.html'))
  .map((file) => readFileSync(new URL(file, root), 'utf8'))
  .join('\n');

test('loads the initial catalog exactly once', () => {
  const calls = catalog.match(/loadCJProducts\(initialSearchTerm/g) || [];
  assert.equal(calls.length, 1);
});

test('persists structured offline favorite operations', () => {
  assert.match(catalog, /type:\s*wasFavorited\s*\?\s*['"]remove['"]\s*:\s*['"]add['"]/);
  assert.match(catalog, /persistPendingFavoriteOperations\(\)/);
  assert.doesNotMatch(catalog, /pendingFavoriteOperations\.set\([^\n]+\?\s*['"]remove['"]\s*:\s*['"]add['"]\s*\)/);
  assert.match(catalog, /if \(!favoriteQueueStorage\) return/);
  assert.doesNotMatch(catalog, /catch\s*\{\s*localStorage\./);
});

test('does not call known undeployed or misspelled account routes', () => {
  assert.doesNotMatch(account, /workers\.dev\/status/);
  assert.doesNotMatch(account, /api\/user\/profile-picture/);
});

test('uses query-before-fragment navigation URLs', () => {
  assert.doesNotMatch(html, /href=["'][^"']*#[^"']*\?/);
  assert.doesNotMatch(html, /main\.html\?search=/);
});

test('GitHub Pages homepage handoff preserves catalog query and fragment state', () => {
  assert.match(indexHtml, /<script src="redirect-script\.js(?:\?v=[^"]+)?"><\/script>/);
  assert.match(redirect, /target\.search\s*=\s*window\.location\.search/);
  assert.match(redirect, /target\.hash\s*=\s*window\.location\.hash/);
  assert.match(redirect, /window\.location\.replace\(target\.href\)/);
  assert.match(accountHtml, /href="\/#shop"[^>]*account-empty-state__action/);
});

test('preserves form and dialog focus across asynchronous actions', () => {
  assert.match(auth, /const form = event\.currentTarget;/);
  assert.match(auth, /form\.reset\(\)/);
  assert.doesNotMatch(auth, /event\.currentTarget\.reset\(\)/);
  assert.match(contact, /openModal\(submitButton\)/);
  assert.match(header, /addEventListener\(['"]transitionend['"], focusCloseButton/);
});

test('header heart opens a persistent accessible saved-items menu with durable destinations', () => {
  assert.match(header, /dataset\.savedDestination\s*=\s*destination/);
  assert.match(header, /destination:\s*['"]favorites['"]/);
  assert.match(header, /destination:\s*['"]watches['"]/);
  assert.match(header, /destination:\s*['"]browse['"]/);
  assert.match(header, /aria-haspopup/);
  assert.match(header, /aria-controls/);
  assert.match(header, /aria-expanded/);

  // Opening the heart must not require authentication. Authentication is
  // checked only after the shopper chooses a saved-items destination.
  const menuConstruction = header.slice(
    header.indexOf('function createSavedItemsMenu'),
    header.indexOf('setNavigationSemantics')
  );
  assert.match(menuConstruction, /addEventListener\(['"]click['"]/);
  assert.match(menuConstruction, /isAuthenticated/);
  assert.match(menuConstruction, /\/auth\.html\?tab=signin/);

  assert.match(menuConstruction, /\/account\.html#alerts/);
  assert.match(menuConstruction, /\/main\.html#favorites/);
  assert.match(menuConstruction, /\/main\.html#shop/);
  assert.match(menuConstruction, /history\.pushState\([\s\S]{0,180}#favorites/);
  assert.match(menuConstruction, /function revealHomeFavorites\(\)/);
  assert.match(menuConstruction, /showFavoritesView\(\{ reveal: true \}\)/);
  assert.match(menuConstruction, /authenticated && revealHomeFavorites\(\)[\s\S]{0,100}setSavedMenu\(false\)/);
  assert.match(menuConstruction, /pendingHeartActivation/);
  assert.match(menuConstruction, /fragrance:auth-change/);
  assert.match(menuConstruction, /Checking your saved items/);
  assert.match(catalog, /function revealFavoritesSection\(\)/);
  assert.match(catalog, /favoritesSection\.scrollIntoView\(/);
  assert.match(catalog, /favoritesSection\.focus\(\{ preventScroll: true \}\)/);
  assert.match(menuConstruction, /favoritesButton\?\.addEventListener\(['"]click['"][\s\S]{0,180}event\.preventDefault\(\)/);
  assert.match(menuConstruction, /location\.assign\([\s\S]{0,100}\/main\.html#favorites/);
});

test('handles provider-specific password settings without a server exception', () => {
  assert.match(worker, /hasPassword: Boolean\(session\.password_hash\)/);
  assert.match(worker, /if \(userRecord\.password_hash\)/);
  assert.match(worker, /google_reauthentication_required/);
  assert.match(worker, /payload\.sub !== userRecord\.google_subject/);
  assert.match(account, /user\?\.hasPassword === false/);
  assert.doesNotMatch(account, /&& \/\[\^a-zA-Z0-9\]\//);
  assert.ok(account.includes(`/[!@#$%^&*()_+\\-=\\[\\]{};':"\\\\|,.<>\\/?]/`));
});

test('publishes one canonical homepage and uses neutral partner claims', () => {
  assert.match(build, /file !== 'main\.html'/);
  assert.doesNotMatch(html, /viral-tiktok-finds|Viral TikTok Finds/i);
  assert.doesNotMatch(catalog, /loadTikTokFinds|tiktok-products-grid/i);
  assert.doesNotMatch(worker, /searchTikTokStore|TikTok Store search failed/i);
});

test('provides an authenticated account-data export and release contract', () => {
  assert.match(worker, /path === '\/api\/user\/export'/);
  assert.match(worker, /handleExportUserData/);
  assert.match(worker, /path === '\/api\/version'/);
  assert.match(worker, /apiVersion: '1\.2\.0'/);
  assert.match(worker, /schemaVersion: '0006_identity_security'/);
  assert.match(worker, /passwordRecovery: true/);
  assert.match(worker, /providerPasswordSetup: true/);
  assert.match(worker, /accountDataExport: true/);
  assert.match(worker, /dealAlerts: true/);
  assert.match(worker, /mailboxVerification: true/);
  assert.match(worker, /providerIdentityLinking: true/);
  assert.match(worker, /newProductsOnly: true/);
  assert.match(account, /fragrance-collect-data-/);
});

test('renders Google Identity through its supported API without styling provider internals', () => {
  assert.match(auth, /googleIdentity\.renderButton/);
  assert.match(auth, /googleIdentity\.initialize/);
  assert.match(authHtml, /google-signin-client-id/);
  assert.doesNotMatch(authHtml, /g_id_signin|g_id_onload/);
  assert.doesNotMatch(authStyles, /S9gUrf-YoZ4jf|nsm7Bb-HzV7m-LgbsSe|g_id_signin/);
});

test('keeps missing catalog evidence unknown instead of fabricating reviews or free shipping', () => {
  assert.match(worker, /const shippingPricing = normalizeProductShipping\(p\.shipping\?\.price\)/);
  assert.match(worker, /shippingCost:\s*shippingPricing\.cost/);
  assert.match(worker, /if \(amount !== null && amount <= 10_000 && currency\) return \{ cost: amount, currency \}/);
  assert.match(worker, /rating:\s*null/);
  assert.match(worker, /reviewCount:\s*null/);
  assert.doesNotMatch(worker, /shippingCost:\s*parseFloat\([^\n]+\|\|\s*0\)/);
  assert.doesNotMatch(catalog, /perfume\.rating\s*\|\|\s*4\.5/);
  assert.match(catalog, /Shipping shown at retailer/);
  assert.match(catalogFeatures, /if \(value === null \|\| value === undefined \|\| value === ''\) return null/);
  assert.match(catalogFeatures, /if \(!valid\) return ''/);
  assert.doesNotMatch(catalogFeatures, /\['Ships from',[^\n]+\|\| 'Not listed'\]/);
});

test('omits unknown saved-offer facts while preserving an accessible missing-action state', () => {
  assert.match(account, /const hasPrice = rawPrice !== '' && rawPrice !== null && rawPrice !== undefined/);
  assert.match(account, /const brandMarkup = advertiserName/);
  assert.match(account, /class="favorite-offer-note favorite-brand" role="status"/);
  assert.doesNotMatch(account, /Price unavailable/);
  assert.doesNotMatch(account, /Deal unavailable/);
  assert.doesNotMatch(account, /Unknown Brand/);
  assert.doesNotMatch(account, /fav\.currency \|\| 'USD'/);
});

test('keeps monetization private and ranks shopper results with observable evidence', () => {
  assert.match(worker, /sanitizePublicCatalogPayload\(responseData\)/);
  assert.doesNotMatch(worker, /commissionDataUsed: false/);
  assert.match(worker, /loadClickPopularity/);
  assert.match(worker, /const auth = await requireAdmin\(request, env\)/);
  assert.match(worker, /env\.ADMIN_EMAILS/);
  assert.match(worker, /getBoundedCJCommissions/);
  assert.match(worker, /CJ_ADMIN_COMMISSION_MAX_PAGES/);
  assert.doesNotMatch(worker, /pubCommissionAmountUsd[\s\S]{0,400}rankProducts/);
});

test('uses official CJ services with a preferred personal access token and cached fallback', () => {
  assert.match(cjIntegration, /https:\/\/ads\.api\.cj\.com\/query/);
  assert.match(cjIntegration, /https:\/\/commissions\.api\.cj\.com\/query/);
  assert.match(cjIntegration, /env\.CJ_PERSONAL_ACCESS_TOKEN \|\| env\.CJ_DEV_KEY/);
  assert.match(cjIntegration, /withCJCache/);
  assert.match(worker, /matchesShippingFilter\(product\.shippingCost, shipping\)/);
});

test('compares products only with defensible CJ identifiers', () => {
  assert.match(worker, /method: 'GTIN \/ UPC \/ EAN'/);
  assert.match(worker, /method: 'Brand \+ MPN'/);
  assert.match(worker, /\['exact', 'high'\]\.includes\(product\.matchConfidence\)/);
  assert.match(worker, /method: 'Retailer catalog ID'/);
  assert.match(worker, /product\.catalogId \|\| product\.adId/);
  assert.match(worker, /\(\?:gtin\|mpn\|retailer\|catalog\)/);
  assert.match(worker, /areFragranceVariantsCompatible/);
  assert.match(worker, /const keywords = buildCJProductKeywords\(options\)/);
  assert.match(worker, /return options\.gtin \? null : brandQuery/);
  assert.match(worker, /matchesBrandFilter\(product\.brand, brandFilter\)/);
  assert.match(catalogFeatures, /loadExactComparisons\(product\)/);
  assert.match(catalogFeatures, /if \(offers\.length < 2\) return ''/);
});

test('keeps expanded CJ catalogs fragrance-only and joined-only', () => {
  assert.match(worker, /filteredProducts\.filter\(isFragranceProduct\)/);
  assert.match(worker, /fragrance\[ -\]\?free/);
  assert.match(worker, /partnerStatus: 'JOINED'/);
  assert.match(worker, /configuredAdvertiserIds\?\.includes\(requestedPartnerId\)/);
});

test('keeps retailer observations independent and bounds watch creation', () => {
  assert.match(worker, /INSERT INTO product_offer_observations/);
  assert.match(worker, /ON CONFLICT\(offer_key, observed_on\)/);
  assert.match(worker, /const MAX_ACTIVE_WATCHES = 20/);
  assert.match(worker, /endpoint: 'deal-alert-create-ip', limit: 10/);
  assert.match(worker, /endpoint: 'deal-alert-create-user', limit: 10/);
  assert.match(worker, /SELECT COUNT\(\*\) FROM user_deal_alerts WHERE user_id = \? AND is_active = 1/);
  assert.match(worker, /Number\(result\.meta\?\.changes \|\| 0\) !== 1/);
});

test('Deal Watches treats application failures as errors and formats corrupt timestamps safely', () => {
  const loadAlerts = account.slice(
    account.indexOf('async function loadAlerts()'),
    account.indexOf('async function removeAlert', account.indexOf('async function loadAlerts()'))
  );
  assert.ok(loadAlerts.length > 0, 'loadAlerts implementation should be present');
  assert.match(loadAlerts, /data\.success\s*===\s*false[\s\S]{0,160}throw|throw[\s\S]{0,160}data\.success\s*===\s*false/);
  assert.doesNotMatch(
    loadAlerts,
    /format\(new Date\(alert\.last_triggered_at\)\)/,
    'A malformed retailer timestamp must not throw while rendering every saved watch.'
  );
  assert.match(account, /last_triggered_at/);
  assert.match(account, /Number\.isNaN\([\s\S]{0,80}getTime\(\)/);
});

test('Deal Watches empty state does not install an animated shimmer pseudo-element', () => {
  const pseudoRules = [...accountStyles.matchAll(
    /([^{}]*\.account-empty-state::(?:before|after)[^{}]*)\{([^{}]*)\}/gi
  )];
  for (const [, selector, declarations] of pseudoRules) {
    assert.doesNotMatch(
      declarations,
      /animation|linear-gradient|translate(?:X|Y)?\s*\(/i,
      `${selector.trim()} must remain a static empty-state decoration`
    );
  }
});

test('enhances catalog selects without losing native values or keyboard behavior', () => {
  assert.match(catalogSelects, /select\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
  assert.match(catalogSelects, /event\.key === 'ArrowDown'/);
  assert.match(catalogSelects, /event\.key === 'Escape'/);
  assert.match(build, /'catalog-selects\.js'/);
});

test('visual account fixtures survive canonical extensionless redirects', () => {
  assert.match(pageReview, /const normalizedPath = currentPath\.endsWith\('\.html'\)/);
  assert.match(pageReview, /const onAccountPage = normalizedPath === '\/account'/);
  assert.match(pageReview, /const onAdminPage = normalizedPath === '\/admin'/);
  assert.match(pageReview, /The authenticated account fixture did not render/);
  assert.doesNotMatch(pageReview, /location\.pathname\.endsWith\('\/account\.html'\)/);

  const definitionStart = pageReview.indexOf('const mockScript = ');
  const definitionEnd = pageReview.indexOf('\n\nconst report =', definitionStart);
  const definition = pageReview.slice(definitionStart, definitionEnd);
  const generatedMock = Function(
    'supplementalFailure',
    'authenticatedHome',
    `${definition}\nreturn mockScript;`
  )(false, false);
  assert.doesNotThrow(() => Function(generatedMock));
});

test('tablet footers reflow before contact details can clip', () => {
  assert.match(designSystem, /\.footer-section\s*\{[^}]*min-width:\s*0/s);
  assert.match(designSystem, /\.contact-info p\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  const tabletRules = designSystem.match(/@media \(max-width: 1100px\)\s*\{[\s\S]*?@media \(max-width: 768px\)/)?.[0] || '';
  assert.match(tabletRules, /\.footer-content\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
});
