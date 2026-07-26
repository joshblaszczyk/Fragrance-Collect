import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const cdpOrigin = process.env.CDP_ORIGIN || 'http://127.0.0.1:9223';
const siteOrigin = process.env.SITE_ORIGIN || 'http://127.0.0.1:8787';
const captureBrandSearch = process.env.SMOKE_CAPTURE_BRAND === '1';
const axeSource = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');

const targetResponse = await fetch(`${cdpOrigin}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
if (!targetResponse.ok) throw new Error(`Could not create a browser target at ${cdpOrigin}.`);
const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const eventWaiters = new Map();
let nextId = 1;

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (!waiter) return;
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
    return;
  }

  const waiters = eventWaiters.get(message.method) || [];
  eventWaiters.delete(message.method);
  waiters.forEach((resolve) => resolve(message.params));
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function waitForEvent(method, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}.`)), timeoutMs);
    const resolveOnce = (value) => {
      clearTimeout(timeout);
      resolve(value);
    };
    eventWaiters.set(method, [...(eventWaiters.get(method) || []), resolveOnce]);
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed.');
  return result.result.value;
}

async function navigate(path, settleMs = 700) {
  const loaded = waitForEvent('Page.loadEventFired');
  await send('Page.navigate', { url: `${siteOrigin}${path}` });
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, settleMs));
}

async function reload(settleMs = 700) {
  const loaded = waitForEvent('Page.loadEventFired');
  await send('Page.reload', { ignoreCache: true });
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, settleMs));
}

async function pressEscape() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await new Promise((resolve) => setTimeout(resolve, 100));
}

async function sampleCrossfade(selector, timeMs) {
  return evaluate(`
    (async () => {
      const slides = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const animations = slides.map((slide) => slide.getAnimations()[0]);
      if (!slides.length || animations.some((animation) => !animation)) return [];
      animations.forEach((animation) => {
        animation.pause();
        animation.currentTime = ${Number(timeMs)};
      });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return slides.map((slide) => Number.parseFloat(getComputedStyle(slide).opacity));
    })()
  `);
}

function assertCrossfade(opacities, label) {
  const transitioning = opacities.filter((opacity) => opacity > 0.02 && opacity < 0.98);
  assert.equal(transitioning.length, 2, `${label} does not have one outgoing and one incoming image: ${opacities.join(', ')}`);
  const visibleTotal = opacities.reduce((total, opacity) => total + opacity, 0);
  assert.ok(visibleTotal > 0.75 && visibleTotal < 1.25, `${label} exposes a flash or overlaid hard cut: ${opacities.join(', ')}`);
}

const browserExceptions = [];
await send('Page.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Network.clearBrowserCache');
await send('Runtime.enable');
await send('Runtime.addBinding', { name: '__smokeBinding' });
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') {
    browserExceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
});

await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 760,
    deviceScaleFactor: 1,
    mobile: true
});
// Crossfade assertions need deterministic motion regardless of the host OS
// accessibility preference. Reduced-motion behavior is covered separately by
// CSS; this suite verifies the standard animated path.
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
});

const mockScript = `
  (() => {
    const json = (value, status = 200) => Promise.resolve(new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' }
    }));
    window.fetch = (input, options = {}) => {
      const url = String(input);
      if (url.includes('/api/status')) return json({ error: 'Not authenticated' }, 401);
      if (url.includes('/api/products')) return json({
        products: [{ id: 'smoke-1', name: 'Smoke Test Fragrance', brand: 'Test House', advertiser: 'Test Retailer', price: 95, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/fragrance', shippingCost: null, availability: 'in_stock', size: ['3.4 oz'] }],
        total: 1, page: 1, limit: 25, hasMore: false, searchQuery: 'fragrance', optimization: { exactMatchApplied: false }
      });
      if (url.includes('open.er-api.com') || url.includes('frankfurter.app')) return json({ rates: { USD: 1, EUR: 0.9, GBP: 0.8 } });
      return json({});
    };
  })();
`;
const { identifier: mockIdentifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: mockScript });

const legacyHomepage = await fetch(`${siteOrigin}/main.html`, { redirect: 'manual' });
assert.equal(legacyHomepage.status, 301, 'The legacy /main.html route did not return a permanent compatibility redirect.');
assert.equal(
  new URL(legacyHomepage.headers.get('location'), siteOrigin).pathname,
  '/',
  'The legacy /main.html compatibility redirect did not target the canonical homepage.'
);

await navigate('/');
for (const [index, timeMs] of [6_600, 12_600, 18_600, 24_600].entries()) {
  assertCrossfade(await sampleCrossfade('.hero-slideshow .slide', timeMs), `Homepage transition ${index + 1}`);
}
const mainResult = await evaluate(`
  (async () => {
    const toggle = document.querySelector('.mobile-menu-toggle');
    toggle.focus();
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 450));
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      menuOpen: document.querySelector('.mobile-nav-menu').classList.contains('active'),
      focusedClass: document.activeElement.className,
      partnerCards: document.querySelectorAll('#partner-products-grid .product-card').length,
      ratingRows: document.querySelectorAll('#products-grid .product-rating').length,
      falseFreeShippingClaims: [...document.querySelectorAll('#products-grid .product-shipping')].filter((node) => /free shipping/i.test(node.textContent)).length,
      unknownShippingLabels: [...document.querySelectorAll('#products-grid .product-shipping')].filter((node) => /shipping shown at retailer/i.test(node.textContent)).length
    };
  })()
`);
assert.equal(mainResult.overflow, false, 'The mobile homepage overflows horizontally.');
assert.equal(mainResult.menuOpen, true, 'The mobile menu did not open.');
assert.match(mainResult.focusedClass, /mobile-menu-close/, 'Focus did not enter the mobile navigation dialog.');
assert.equal(mainResult.ratingRows, 0, 'A catalog item without rating evidence rendered a rating row.');
assert.equal(mainResult.falseFreeShippingClaims, 0, 'A catalog item without shipping evidence rendered a free-shipping claim.');
assert.equal(mainResult.unknownShippingLabels, 1, 'Unknown shipping evidence was not labeled honestly.');

for (const width of [900, 1024]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
  await navigate('/');
  const tabletNavigation = await evaluate(`
    (async () => {
      const toggle = document.querySelector('.mobile-menu-toggle');
      const visible = Boolean(toggle && toggle.getClientRects().length);
      toggle?.click();
      await new Promise((resolve) => setTimeout(resolve, 450));
      return {
        visible,
        menuOpen: document.querySelector('.mobile-nav-menu')?.classList.contains('active'),
        focusedClass: document.activeElement.className
      };
    })()
  `);
  assert.equal(tabletNavigation.visible, true, `The navigation toggle is missing at ${width}px.`);
  assert.equal(tabletNavigation.menuOpen, true, `The navigation drawer did not open at ${width}px.`);
  assert.match(tabletNavigation.focusedClass, /mobile-menu-close/, `Focus did not enter the navigation drawer at ${width}px.`);
  await pressEscape();
}

await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: mockIdentifier });
await navigate('/contact.html');
for (const [index, timeMs] of [7_630, 14_630, 21_630].entries()) {
  assertCrossfade(await sampleCrossfade('.support-masthead-slide', timeMs), `Support masthead transition ${index + 1}`);
}
const requiredSelectState = await evaluate(`(() => {
  document.getElementById('name').value = 'Smoke Test';
  document.getElementById('email').value = 'smoke@example.com';
  document.getElementById('subject').value = '';
  document.getElementById('message').value = 'This is a browser smoke test message.';
  document.getElementById('contactForm').requestSubmit();
  const visualButton = document.getElementById('subject').closest('.fc-select')?.querySelector('.fc-select__button');
  return {
    enhanced: document.getElementById('subject').dataset.enhancedSelect,
    invalid: visualButton?.getAttribute('aria-invalid'),
    focused: document.activeElement === visualButton
  };
})()`);
assert.equal(requiredSelectState.enhanced, 'true', 'The required contact subject uses a native dropdown instead of the shared control.');
assert.equal(requiredSelectState.invalid, 'true', 'The required custom dropdown does not expose its invalid state.');
assert.equal(requiredSelectState.focused, true, 'Invalid custom dropdown validation did not move focus to the visible control.');
await evaluate(`
  window.fetch = () => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  document.getElementById('name').value = 'Smoke Test';
  document.getElementById('email').value = 'smoke@example.com';
  document.getElementById('subject').value = 'general';
  document.getElementById('subject').dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('message').value = 'This is a browser smoke test message.';
  document.getElementById('contactForm').requestSubmit();
`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`!document.getElementById('successModal').hidden`), true, 'Contact success dialog did not open.');
await pressEscape();
assert.match(await evaluate(`document.activeElement.className`), /submit-btn/, 'Contact dialog did not restore focus to submit.');

await navigate('/auth.html?tab=signup');
assert.equal(await evaluate(`(() => {
  const checkbox = document.getElementById('agree-terms');
  checkbox.focus();
  return document.activeElement === checkbox;
})()`), true, 'The required terms checkbox is not keyboard-focusable.');
await evaluate(`
  let smokeSignedIn = false;
  window.fetch = (input) => {
    const url = String(input);
    const smokeUser = { id: '1', name: 'Smoke Test', email: 'smoke@example.com', hasPassword: true };
    if (url.includes('/api/signup/email')) smokeSignedIn = true;
    const body = url.includes('/api/signup/email')
      ? { success: true, user: smokeUser }
      : url.includes('/api/status') && smokeSignedIn
        ? { success: true, user: smokeUser }
      : url.includes('/api/password/forgot')
        ? { success: true, message: 'If an eligible account matches that email, a password reset link will arrive shortly.' }
        : { error: 'Not authenticated' };
    const status = url.includes('/api/status') && !smokeSignedIn ? 401 : 200;
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  };
  document.getElementById('signup-name').value = 'Smoke Test';
  document.getElementById('signup-email').value = 'smoke@example.com';
  document.getElementById('signup-password').value = 'StrongPass1!';
  document.getElementById('signup-confirm-password').value = 'StrongPass1!';
  document.getElementById('agree-terms').checked = true;
  document.getElementById('signup-form-element').requestSubmit();
`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(await evaluate(`document.getElementById('success-modal').open`), true, 'Signup success dialog did not open.');
assert.equal(await evaluate(`document.activeElement.id`), 'continue-to-home-btn', 'Signup success dialog did not receive focus.');
await pressEscape();
assert.equal(await evaluate(`document.getElementById('success-modal').open`), false, 'Signup success dialog did not close with Escape.');

await evaluate(`
  document.getElementById('forgot-password-button').click();
  document.getElementById('password-reset-email').value = 'smoke@example.com';
  document.getElementById('password-reset-request-form').requestSubmit();
`);
await new Promise((resolve) => setTimeout(resolve, 150));
assert.match(
  await evaluate(`document.getElementById('password-reset-status').textContent`),
  /reset link will arrive shortly/i,
  'Password reset success was replaced by a JavaScript error.'
);

const googleAccountMock = `
  (() => {
    const json = (value, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }));
    const passwordSetupScenario = new URL(location.href).searchParams.get('smoke') === 'password-setup';
    let hasPassword = !passwordSetupScenario;
    let hasGoogleIdentity = passwordSetupScenario;
    window.__accountIdentityRequests = [];
    let googleCallback;
    window.google = {
      accounts: {
        id: {
          __fragranceTestHarness: true,
          initialize(options) { googleCallback = options.callback; },
          renderButton(host) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'smoke-google-button';
            button.textContent = 'Continue with Google';
            button.addEventListener('click', () => googleCallback?.({ credential: 'smoke-google-credential' }));
            host.replaceChildren(button);
          }
        }
      }
    };
    window.fetch = (input, options = {}) => {
      const url = String(input);
      if (url.includes('/api/status')) return json({
        success: true,
        user: { id: 'google-1', name: 'Google User', email: 'google@example.com', picture: '', hasPassword, hasGoogleIdentity, emailVerified: true }
      });
      if (url.includes('/api/user/identities/google')) {
        const body = JSON.parse(options.body || '{}');
        window.__accountIdentityRequests.push({ endpoint: 'google-link', body });
        hasGoogleIdentity = true;
        return json({ success: true, message: 'Google is now linked to your account.' });
      }
      if (url.includes('/api/user/password')) {
        const body = JSON.parse(options.body || '{}');
        window.__accountIdentityRequests.push({ endpoint: 'password-setup', body });
        hasPassword = true;
        return json({ success: true, message: 'Your Fragrance Collect password is ready.' });
      }
      if (url.includes('/api/user/preferences')) return json({ success: true, preferences: { intensity: 'strong', season: 'winter', occasion: 'evening', budget_range: '100-200' } });
      if (url.includes('/api/user/favorites')) return json({ success: true, favorites: [] });
      return json({ success: true });
    };
  })();
`;
const { identifier: accountMockIdentifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: googleAccountMock });
await send('Network.setBlockedURLs', { urls: ['https://accounts.google.com/gsi/*'] });
await navigate('/account.html?smoke=google-link');
assert.deepEqual(await evaluate(`(() => ({
  nativeValue: document.getElementById('intensity').value,
  visualValue: document.getElementById('intensity').closest('.fc-select')?.querySelector('.fc-select__value')?.textContent
}))()`), { nativeValue: 'strong', visualValue: 'Strong' }, 'Asynchronous account preferences did not synchronize the visible dropdown value.');
assert.equal(await evaluate(`document.getElementById('google-method-status').textContent`), 'Not connected', 'An unlinked password account was labeled as Google-connected.');
await evaluate(`(() => {
  document.getElementById('google-link-current-password').value = 'CurrentPass1!';
  document.querySelector('#google-link-button .smoke-google-button').click();
})()`);
await new Promise((resolve) => setTimeout(resolve, 200));
assert.deepEqual(await evaluate(`window.__accountIdentityRequests[0]`), {
  endpoint: 'google-link',
  body: { credential: 'smoke-google-credential', currentPassword: 'CurrentPass1!' }
}, 'Google linking did not send both the provider credential and password reauthentication proof.');
assert.equal(await evaluate(`document.getElementById('google-method-status').textContent`), 'Connected', 'Google linking did not refresh the connected-method status.');

await navigate('/account.html?smoke=password-setup');
assert.equal(await evaluate(`document.getElementById('password-change-section').hidden`), true, 'Google-only account exposed a password-change form before creating a password.');
assert.equal(await evaluate(`document.getElementById('password-provider-note').hidden`), false, 'Google-only account password-creation guidance is missing.');
await evaluate(`document.querySelector('#password-setup-google-button .smoke-google-button').click()`);
await new Promise((resolve) => setTimeout(resolve, 80));
await evaluate(`(() => {
  document.getElementById('password-setup-new').value = 'StrongPass1!';
  document.getElementById('password-setup-confirm').value = 'StrongPass1!';
  document.getElementById('password-setup-submit').click();
})()`);
await new Promise((resolve) => setTimeout(resolve, 200));
assert.deepEqual(await evaluate(`window.__accountIdentityRequests[0]`), {
  endpoint: 'password-setup',
  body: { newPassword: 'StrongPass1!', googleCredential: 'smoke-google-credential' }
}, 'Google-only password creation did not use authenticated Google reauthentication.');
assert.equal(await evaluate(`document.getElementById('password-method-status').textContent`), 'Connected', 'Password creation did not update the connected-method status.');
assert.equal(await evaluate(`window.__accountIdentityRequests.some((request) => request.endpoint === 'password-forgot')`), false, 'Google-only password creation fell back to email recovery.');
await send('Network.setBlockedURLs', { urls: [] });
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: accountMockIdentifier });

const regressionMock = `
  (() => {
    const json = (value, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }));
    window.__favoriteMutationCount = 0;
    window.__productRequests = [];
    window.__lastAlertBody = null;
    window.fetch = (input, options = {}) => {
      const url = String(input);
      if (url.includes('/api/status')) return json({ success: true, user: { id: 'smoke-1', name: 'Smoke User', email: 'smoke@example.com', picture: '', hasPassword: true } });
      if (url.includes('/api/products')) {
        const requestUrl = new URL(url);
        window.__productRequests.push(requestUrl.href);
        const brand = requestUrl.searchParams.get('brand') || 'Test House';
        const requestedQuery = requestUrl.searchParams.get('q') || '';
        if (/^dior stale$/i.test(requestedQuery)) {
          const products = requestUrl.searchParams.has('brand') ? [] : [
            { id: 'stale-dior-match', productKey: 'catalog:stale-dior-match', advertiserId: '101', name: 'Dior Stale Eau de Parfum', brand: 'Christian Dior', advertiser: 'Test Retailer', price: 95, currency: 'USD', image: '/assets/images/dior-card.webp', link: 'https://example.com/stale-dior', shippingCost: 0, availability: 'IN_STOCK', productTypes: ['Perfume & Cologne'] },
            { id: 'stale-dior-noise', productKey: 'catalog:stale-dior-noise', advertiserId: '101', name: 'Dior Stale Inspired Perfume', brand: 'Other House', advertiser: 'Test Retailer', price: 40, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/stale-noise', shippingCost: 0, availability: 'IN_STOCK', productTypes: ['Perfume & Cologne'] }
          ];
          return json({ products, total: products.length, page: 1, limit: 25, hasMore: false, searchQuery: requestedQuery, optimization: { exactMatchApplied: false } });
        }
        if (/^atlas absolute$/i.test(requestedQuery)) {
          const rankingProducts = [
            { id: 'ranking-complete', productKey: 'catalog:ranking-complete', advertiserId: '101', name: 'Absolute Reserve Perfume', brand: 'House Atlas Absolute', advertiser: 'Test Retailer', price: 72, regularPrice: 100, salePrice: 72, discountPercent: 28, currency: 'USD', image: '/assets/images/dior-card.webp', additionalImages: ['/assets/images/dior-card.webp', '/assets/images/dior-hero-mobile.webp'], link: 'https://example.com/ranking-complete', shippingCost: 0, freeShippingVerified: true, availability: 'BACKORDER', serviceableAreas: ['CA'], gtin: '1234567890123', highlights: ['Current offer'], productTypes: ['Perfume & Cologne'] },
            { id: 'ranking-exact', productKey: 'catalog:ranking-exact', advertiserId: '101', name: 'Atlas Absolute Perfume', brand: 'Example House', advertiser: 'Test Retailer', price: 80, regularPrice: 80, salePrice: null, discountPercent: 0, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/ranking-exact', shippingCost: 0, freeShippingVerified: true, availability: 'BACKORDER', serviceableAreas: ['CA'], productTypes: ['Perfume & Cologne'] }
          ];
          return json({
            products: rankingProducts,
            total: rankingProducts.length,
            page: 1,
            limit: 25,
            hasMore: false,
            searchQuery: requestedQuery,
            filters: {
              lowPrice: requestUrl.searchParams.get('lowPrice') === null ? null : Number(requestUrl.searchParams.get('lowPrice')),
              highPrice: requestUrl.searchParams.get('highPrice') === null ? null : Number(requestUrl.searchParams.get('highPrice')),
              sortBy: requestUrl.searchParams.get('sortBy') || 'featured',
              exactMatch: requestUrl.searchParams.get('exactMatch') === 'true',
              currency: requestUrl.searchParams.get('currency'),
              country: requestUrl.searchParams.get('country'),
              availability: requestUrl.searchParams.get('availability'),
              shipping: requestUrl.searchParams.get('shipping')
            },
            optimization: { exactMatchApplied: requestUrl.searchParams.get('exactMatch') === 'true' }
          });
        }
        const semanticProducts = [
          { id: 'semantic-match', productKey: 'catalog:intent-atlas-edp-spray-100-men', advertiserId: 'intent-house', name: 'Atlas Eau de Parfum Spray 100 mL for Men', brand: 'Intent House', advertiser: 'Intent House', price: 120, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/atlas', shippingCost: 0, availability: 'IN_STOCK', size: ['100 mL'], unitSizeMl: 100, canonicalSizeMl: 100, packCount: 1, audience: ['Men'], fragranceConcentration: 'Eau de Parfum', fragranceForm: 'Spray', productTypes: ['Perfume & Cologne'] },
          { id: 'semantic-women', productKey: 'catalog:intent-atlas-edp-spray-100-women', advertiserId: 'intent-house', name: 'Atlas Eau de Parfum Spray 100 mL for Women', brand: 'Intent House', advertiser: 'Intent House', price: 120, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/atlas-women', shippingCost: 0, availability: 'IN_STOCK', size: ['100 mL'], unitSizeMl: 100, canonicalSizeMl: 100, packCount: 1, audience: ['Women'], fragranceConcentration: 'Eau de Parfum', fragranceForm: 'Spray', productTypes: ['Perfume & Cologne'] },
          { id: 'semantic-unisex', productKey: 'catalog:intent-atlas-edp-spray-100-unisex', advertiserId: 'intent-house', name: 'Atlas Eau de Parfum Spray 100 mL Unisex', brand: 'Intent House', advertiser: 'Intent House', price: 120, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/atlas-unisex', shippingCost: 0, availability: 'IN_STOCK', size: ['100 mL'], unitSizeMl: 100, canonicalSizeMl: 100, packCount: 1, audience: ['Unisex'], fragranceConcentration: 'Eau de Parfum', fragranceForm: 'Spray', productTypes: ['Perfume & Cologne'] },
          { id: 'semantic-edt', productKey: 'catalog:intent-atlas-edt-spray-100-men', advertiserId: 'intent-house', name: 'Atlas Eau de Toilette Spray 100 mL for Men', brand: 'Intent House', advertiser: 'Intent House', price: 110, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/atlas-edt', shippingCost: 0, availability: 'IN_STOCK', size: ['100 mL'], unitSizeMl: 100, canonicalSizeMl: 100, packCount: 1, audience: ['Men'], fragranceConcentration: 'Eau de Toilette', fragranceForm: 'Spray', productTypes: ['Perfume & Cologne'] },
          { id: 'semantic-size', productKey: 'catalog:intent-atlas-edp-spray-50-men', advertiserId: 'intent-house', name: 'Atlas Eau de Parfum Spray 50 mL for Men', brand: 'Intent House', advertiser: 'Intent House', price: 85, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/atlas-50', shippingCost: 0, availability: 'IN_STOCK', size: ['50 mL'], unitSizeMl: 50, canonicalSizeMl: 50, packCount: 1, audience: ['Men'], fragranceConcentration: 'Eau de Parfum', fragranceForm: 'Spray', productTypes: ['Perfume & Cologne'] },
          { id: 'semantic-paid', productKey: 'catalog:intent-atlas-edp-spray-100-men-paid', advertiserId: 'intent-house', name: 'Atlas Eau de Parfum Spray 100 mL for Men Paid Delivery', brand: 'Intent House', advertiser: 'Intent House', price: 116, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/atlas-paid', shippingCost: 9, availability: 'IN_STOCK', size: ['100 mL'], unitSizeMl: 100, canonicalSizeMl: 100, packCount: 1, audience: ['Men'], fragranceConcentration: 'Eau de Parfum', fragranceForm: 'Spray', productTypes: ['Perfume & Cologne'] },
          { id: 'semantic-out', productKey: 'catalog:intent-atlas-edp-spray-100-men-out', advertiserId: 'intent-house', name: 'Atlas Eau de Parfum Spray 100 mL for Men Out of Stock', brand: 'Intent House', advertiser: 'Intent House', price: 112, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/atlas-out', shippingCost: 0, availability: 'OUT_OF_STOCK', size: ['100 mL'], unitSizeMl: 100, canonicalSizeMl: 100, packCount: 1, audience: ['Men'], fragranceConcentration: 'Eau de Parfum', fragranceForm: 'Spray', productTypes: ['Perfume & Cologne'] },
          { id: 'semantic-roll-on', productKey: 'catalog:intent-atlas-edp-roll-on-100-men', advertiserId: 'intent-house', name: 'Atlas Eau de Parfum Roll-on 100 mL for Men', brand: 'Intent House', advertiser: 'Intent House', price: 105, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/atlas-roll-on', shippingCost: 0, availability: 'IN_STOCK', size: ['100 mL'], unitSizeMl: 100, canonicalSizeMl: 100, packCount: 1, audience: ['Men'], fragranceConcentration: 'Eau de Parfum', fragranceForm: 'Roll-on', productTypes: ['Perfume & Cologne'] }
        ];
        if (/^men'?s (?:perfume|fragrance)$/i.test(requestedQuery)) {
          return json({ products: semanticProducts, total: semanticProducts.length, page: 1, limit: 25, hasMore: false, searchQuery: requestedQuery, optimization: { exactMatchApplied: false } });
        }
        if (/men'?s eau de parfum spray 100 ml/i.test(requestedQuery)) {
          return json({ products: semanticProducts, total: semanticProducts.length, page: 1, limit: 25, hasMore: false, searchQuery: requestedQuery, optimization: { exactMatchApplied: false } });
        }
        if (/^khadlaj$/i.test(requestedQuery)) {
          return json({
            products: [
              { id: 'dynamic-brand-match', productKey: 'catalog:khadlaj-jameel', advertiserId: '101', name: 'Khadlaj Jameel Perfume Oil', brand: 'Khadlaj', advertiser: 'Test Retailer', price: 25, currency: 'USD', image: '/assets/images/creed-card.webp', link: 'https://example.com/khadlaj', shippingCost: 0, availability: 'IN_STOCK', productTypes: ['Perfume & Cologne'] },
              { id: 'dynamic-brand-noise', productKey: 'catalog:other-khadlaj-keyword', advertiserId: '101', name: 'Khadlaj Inspired Perfume', brand: 'Other House', advertiser: 'Test Retailer', price: 20, currency: 'USD', image: '/assets/images/dior-card.webp', link: 'https://example.com/other', shippingCost: 0, availability: 'IN_STOCK', productTypes: ['Perfume & Cologne'] }
            ],
            total: 2,
            page: 1,
            limit: 25,
            hasMore: false,
            searchQuery: requestedQuery,
            optimization: { exactMatchApplied: false }
          });
        }
        const products = [{ id: 'smoke-1', productKey: 'catalog:test-house-smoke-fragrance', advertiserId: '101', name: brand + ' Smoke Fragrance', brand, advertiser: 'Test Retailer', price: 95, regularPrice: 120, salePrice: 95, discountPercent: 21, currency: 'USD', image: '/assets/images/chanel-card.webp', additionalImages: ['/assets/images/chanel-hero-mobile.webp'], link: 'https://example.com/fragrance', shippingCost: 0, freeShippingVerified: true, availability: 'IN_STOCK', size: ['3.4 oz'], description: 'A browser test fragrance listing.', lastUpdated: '2026-07-18T12:00:00Z' }];
        if (requestUrl.searchParams.has('brand')) products.push({ ...products[0], id: 'smoke-unrelated', productKey: 'catalog:other-house-smoke-fragrance', name: 'Other House Smoke Fragrance', brand: 'Other House' });
        return json({ products, total: products.length, page: 1, limit: 25, hasMore: false, searchQuery: requestedQuery || 'fragrance', optimization: { exactMatchApplied: false } });
      }
      if (url.includes('/api/product-history')) return json({ observations: [], methodology: 'Daily local observations.' });
      if (url.includes('/api/user/alerts')) {
        if (String(options.method || 'GET').toUpperCase() === 'POST') window.__lastAlertBody = JSON.parse(options.body);
        return json({ success: true, alerts: [] });
      }
      if (url.includes('/api/user/preferences')) return json({ success: true, preferences: {} });
      if (url.includes('/api/user/favorites')) {
        const method = String(options.method || 'GET').toUpperCase();
        if (method !== 'GET') window.__favoriteMutationCount += 1;
        return json(method === 'GET' ? { success: true, favorites: [] } : { success: true });
      }
      if (url.includes('open.er-api.com') || url.includes('frankfurter.app')) return json({ rates: { USD: 1, EUR: 0.9, GBP: 0.8 } });
      return json({ success: true });
    };
  })();
`;
const { identifier: regressionMockIdentifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: regressionMock });

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await navigate('/?q=tom-ford#filter');
const initialBrandState = await evaluate(`(() => {
  const request = new URL(window.__productRequests.at(-1));
  return {
    requestedBrand: request.searchParams.get('brand'),
    requestedQuery: request.searchParams.get('q'),
    status: document.getElementById('search-intent-status').textContent.trim(),
    renderedBrands: [...document.querySelectorAll('#products-grid .product-brand')].map((node) => node.textContent.trim())
  };
})()`);
assert.equal(initialBrandState.requestedBrand, 'Tom Ford', 'A House Signature URL did not send an enforced brand filter.');
assert.equal(initialBrandState.requestedQuery, 'tom-ford', 'An exact house search did not preserve its search query.');
assert.match(initialBrandState.status, /Showing only: Tom Ford/i, 'An exact house search did not expose its enforced brand state.');
assert.deepEqual(initialBrandState.renderedBrands, ['Tom Ford'], 'The brand-filtered catalog rendered a different house.');
await evaluate(`document.querySelector('.collection-card[data-brand="Creed"] .collection-btn').click()`);
await new Promise((resolve) => setTimeout(resolve, 160));
const clickedBrandState = await evaluate(`(() => {
  const request = new URL(window.__productRequests.at(-1));
  return {
    requestedBrand: request.searchParams.get('brand'),
    requestedQuery: request.searchParams.get('q'),
    urlBrand: new URL(location.href).searchParams.get('brand'),
    urlQuery: new URL(location.href).searchParams.get('q'),
    hash: location.hash,
    input: document.getElementById('main-search').value,
    renderedBrands: [...document.querySelectorAll('#products-grid .product-brand')].map((node) => node.textContent.trim())
  };
})()`);
assert.deepEqual(clickedBrandState, {
  requestedBrand: 'Creed',
  requestedQuery: 'Creed',
  urlBrand: 'Creed',
  urlQuery: 'Creed',
  hash: '#filter',
  input: 'Creed',
  renderedBrands: ['Creed']
}, 'Clicking a House Signature did not enforce and preserve that exact brand.');

for (const expectedBrand of ['Tom Ford', 'Dior', 'Chanel']) {
  await evaluate(`document.querySelector('.collection-card[data-brand=${JSON.stringify(expectedBrand)}] .collection-btn').click()`);
  await new Promise((resolve) => setTimeout(resolve, 160));
  const state = await evaluate(`(() => {
    const request = new URL(window.__productRequests.at(-1));
    return {
      requestedBrand: request.searchParams.get('brand'),
      requestedQuery: request.searchParams.get('q'),
      input: document.getElementById('main-search').value,
      renderedBrands: [...document.querySelectorAll('#products-grid .product-brand')].map((node) => node.textContent.trim())
    };
  })()`);
  assert.deepEqual(state, {
    requestedBrand: expectedBrand,
    requestedQuery: expectedBrand,
    input: expectedBrand,
    renderedBrands: [expectedBrand]
  }, `The ${expectedBrand} House Signature did not enforce its exact brand.`);
}

await evaluate(`(() => {
  const input = document.getElementById('main-search');
  input.value = 'chanel';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await new Promise((resolve) => setTimeout(resolve, 160));
const typedBrandState = await evaluate(`(() => {
  const request = new URL(window.__productRequests.at(-1));
  return {
    requestedBrand: request.searchParams.get('brand'),
    requestedQuery: request.searchParams.get('q'),
    urlBrand: new URL(location.href).searchParams.get('brand'),
    status: document.getElementById('search-intent-status').textContent.trim(),
    renderedBrands: [...document.querySelectorAll('#products-grid .product-brand')].map((node) => node.textContent.trim())
  };
})()`);
assert.deepEqual(typedBrandState, {
  requestedBrand: 'Chanel',
  requestedQuery: 'chanel',
  urlBrand: 'Chanel',
  status: 'Showing only: Chanel.',
  renderedBrands: ['Chanel']
}, 'Typing an exact house name did not constrain results to that brand.');

const requestCountBeforeStaleBrand = await evaluate(`window.__productRequests.length`);
await evaluate(`(() => {
  const input = document.getElementById('main-search');
  input.value = 'Dior stale';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await new Promise((resolve) => setTimeout(resolve, 180));
const staleBrandCompatibilityState = await evaluate(`(() => ({
  requests: window.__productRequests.slice(${requestCountBeforeStaleBrand}).map((value) => {
    const url = new URL(value);
    return { query: url.searchParams.get('q'), brand: url.searchParams.get('brand') };
  }),
  status: document.getElementById('search-intent-status').textContent.trim(),
  brands: [...document.querySelectorAll('#products-grid .product-brand')].map((node) => node.textContent.trim())
}))()`);
assert.deepEqual(staleBrandCompatibilityState.requests, [
  { query: 'Dior stale', brand: 'Dior' },
  { query: 'Dior stale', brand: null }
], 'A stale zero-result brand response did not receive exactly one compatibility retry.');
assert.match(staleBrandCompatibilityState.status, /Showing only: Dior/i, 'The compatibility retry lost the enforced house state.');
assert.deepEqual(staleBrandCompatibilityState.brands, ['Christian Dior'], 'The compatibility retry either dropped the Dior alias or rendered another house.');

await navigate('/?q=Atlas%20Absolute#filter');
const featuredRankingName = await evaluate(`document.querySelector('#products-grid .product-name')?.textContent.trim()`);
assert.equal(featuredRankingName, 'Absolute Reserve Perfume', 'Featured did not prioritize the stronger current offer.');
await evaluate(`(() => {
  const select = document.getElementById('sort-by-filter');
  select.value = 'relevance';
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await new Promise((resolve) => setTimeout(resolve, 180));
const relevanceRankingName = await evaluate(`document.querySelector('#products-grid .product-name')?.textContent.trim()`);
assert.equal(relevanceRankingName, 'Atlas Absolute Perfume', 'Relevance was not distinct from Featured or did not prioritize the closest query match.');

const canonicalFilterState = await evaluate(`(async () => {
  document.getElementById('price-range').value = '50-100';
  document.getElementById('shipping-filter').value = 'free';
  document.getElementById('availability-filter').value = 'BACKORDER';
  document.getElementById('country-filter').value = 'CA';
  document.getElementById('sort-by-filter').value = 'relevance';
  document.getElementById('currency-converter').value = 'EUR';
  document.getElementById('exact-match-toggle').checked = true;
  await applyFilters(true);
  const pageUrl = new URL(location.href);
  const requestUrl = new URL(window.__productRequests.at(-1));
  return {
    page: Object.fromEntries(pageUrl.searchParams),
    request: Object.fromEntries(requestUrl.searchParams),
    path: pageUrl.pathname + pageUrl.search + pageUrl.hash
  };
})()`);
assert.deepEqual(canonicalFilterState.page, {
  q: 'Atlas Absolute',
  lowPrice: '50',
  highPrice: '100',
  shipping: 'free',
  availability: 'BACKORDER',
  country: 'CA',
  sortBy: 'relevance',
  currency: 'EUR',
  exactMatch: 'true'
}, 'Catalog filters were not written to canonical shareable URL state.');
assert.deepEqual({
  lowPrice: canonicalFilterState.request.lowPrice,
  highPrice: canonicalFilterState.request.highPrice,
  shipping: canonicalFilterState.request.shipping,
  availability: canonicalFilterState.request.availability,
  country: canonicalFilterState.request.country,
  sortBy: canonicalFilterState.request.sortBy,
  currency: canonicalFilterState.request.currency,
  exactMatch: canonicalFilterState.request.exactMatch
}, {
  lowPrice: '50',
  highPrice: '100',
  shipping: 'free',
  availability: 'BACKORDER',
  country: 'CA',
  sortBy: 'relevance',
  currency: 'EUR',
  exactMatch: 'true'
}, 'The canonical URL filters and Worker request diverged.');

await reload();
const rehydratedFilterState = await evaluate(`(() => {
  const request = new URL(window.__productRequests.at(-1));
  return {
    controls: {
      priceRange: document.getElementById('price-range').value,
      shipping: document.getElementById('shipping-filter').value,
      availability: document.getElementById('availability-filter').value,
      country: document.getElementById('country-filter').value,
      sortBy: document.getElementById('sort-by-filter').value,
      currency: document.getElementById('currency-converter').value,
      exactMatch: document.getElementById('exact-match-toggle').checked
    },
    requestedSort: request.searchParams.get('sortBy'),
    firstName: document.querySelector('#products-grid .product-name')?.textContent.trim()
  };
})()`);
assert.deepEqual(rehydratedFilterState.controls, {
  priceRange: '50-100',
  shipping: 'free',
  availability: 'BACKORDER',
  country: 'CA',
  sortBy: 'relevance',
  currency: 'EUR',
  exactMatch: true
}, 'A refresh did not rehydrate the complete catalog filter state.');
assert.equal(rehydratedFilterState.requestedSort, 'relevance', 'Initial loading overwrote the URL-selected Relevance ranking.');
assert.equal(rehydratedFilterState.firstName, 'Atlas Absolute Perfume', 'Relevance did not survive a refreshed/shareable URL.');

const defaultFilterParams = await evaluate(`(async () => {
  document.getElementById('price-range').value = 'all';
  document.getElementById('shipping-filter').value = 'all';
  document.getElementById('availability-filter').value = '';
  document.getElementById('country-filter').value = '';
  document.getElementById('sort-by-filter').value = 'featured';
  document.getElementById('currency-converter').value = 'USD';
  document.getElementById('exact-match-toggle').checked = false;
  await applyFilters(true);
  const params = new URL(location.href).searchParams;
  return ['lowPrice', 'highPrice', 'shipping', 'availability', 'country', 'sortBy', 'currency', 'exactMatch']
    .filter((name) => params.has(name));
})()`);
assert.deepEqual(defaultFilterParams, [], 'Default catalog controls left redundant parameters in the URL.');

await evaluate(`(() => {
  const input = document.getElementById('main-search');
  input.value = "Men's perfume";
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await new Promise((resolve) => setTimeout(resolve, 160));
const audienceOnlyState = await evaluate(`(() => {
  const request = new URL(window.__productRequests.at(-1));
  return {
    requestedAudience: request.searchParams.get('audience'),
    requestedBrand: request.searchParams.get('brand'),
    requestedQuery: request.searchParams.get('q'),
    status: document.getElementById('search-intent-status').textContent.trim(),
    names: [...document.querySelectorAll('#products-grid .product-name')].map((node) => node.textContent.trim()),
    emptyState: document.getElementById('no-results')?.textContent.trim() || ''
  };
})()`);
assert.equal(audienceOnlyState.requestedAudience, 'men', 'A men’s search did not send its audience constraint.');
assert.equal(audienceOnlyState.requestedBrand, null, 'A previous house filter leaked into a new audience search.');
assert.equal(audienceOnlyState.status, 'Showing only: Men.', 'A men’s search did not expose its active audience constraint.');
assert.equal(audienceOnlyState.names.length, 6, `A men’s-only search lost compatible products or retained a conflicting audience: ${JSON.stringify(audienceOnlyState)}`);
assert.ok(audienceOnlyState.names.every((name) => /for Men\b/i.test(name)), 'A men’s-only search rendered a women’s or unisex listing.');

await evaluate(`(() => {
  const input = document.getElementById('main-search');
  input.value = "men's Eau de Parfum spray 100 mL in stock free shipping";
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await new Promise((resolve) => setTimeout(resolve, 160));
const semanticIntentState = await evaluate(`(() => {
  const request = new URL(window.__productRequests.at(-1));
  return {
    requestedQuery: request.searchParams.get('q'),
    requestedIntent: {
      audience: request.searchParams.get('audience'),
      concentration: request.searchParams.get('concentration'),
      form: request.searchParams.get('form'),
      sizeMl: request.searchParams.get('sizeMl'),
      availability: request.searchParams.get('availability'),
      shipping: request.searchParams.get('shipping')
    },
    status: document.getElementById('search-intent-status').textContent.trim(),
    names: [...document.querySelectorAll('#products-grid .product-name')].map((node) => node.textContent.trim()),
    brands: [...document.querySelectorAll('#products-grid .product-brand')].map((node) => node.textContent.trim()),
    results: document.getElementById('search-results-info').textContent.trim()
  };
})()`);
assert.equal(semanticIntentState.requestedQuery, "men's Eau de Parfum spray 100 mL in stock free shipping", 'The semantic query was not preserved and sent to the catalog.');
assert.deepEqual(semanticIntentState.requestedIntent, {
  audience: 'men',
  concentration: 'eau_de_parfum',
  form: 'spray',
  sizeMl: '100',
  availability: 'IN_STOCK',
  shipping: 'free'
}, 'The browser did not send the structured intent alongside the readable query.');
assert.equal(semanticIntentState.status, 'Showing only: Men · Eau de Parfum · Spray · 100 mL · In stock · Free shipping.', 'The semantic query did not expose its exact intent.');
assert.deepEqual(semanticIntentState.names, ['Atlas Eau de Parfum Spray 100 mL for Men'], 'A mixed semantic catalog rendered incompatible audience, concentration, or size variants.');
assert.deepEqual(semanticIntentState.brands, ['Intent House'], 'The semantic result did not preserve the exact compatible product.');
assert.match(semanticIntentState.results, /Showing 1\b/i, 'Semantic result totals did not reflect the exact compatible result.');
assert.doesNotMatch(semanticIntentState.results, /approximately/i, 'Semantic result totals misleadingly retained the broad catalog count.');

await evaluate(`(() => {
  const availability = document.getElementById('availability-filter');
  availability.value = 'BACKORDER';
  availability.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await new Promise((resolve) => setTimeout(resolve, 160));
const overriddenAvailabilityState = await evaluate(`(() => {
  const request = new URL(window.__productRequests.at(-1));
  return {
    requestedAvailability: request.searchParams.get('availability'),
    status: document.getElementById('search-intent-status').textContent.trim(),
    cards: document.querySelectorAll('#products-grid .product-card').length
  };
})()`);
assert.equal(overriddenAvailabilityState.requestedAvailability, 'BACKORDER', 'The explicit availability control did not override query-derived stock intent.');
assert.match(overriddenAvailabilityState.status, /Backorder/i, 'The applied-filter status did not reflect the explicit availability override.');
assert.doesNotMatch(overriddenAvailabilityState.status, /In stock/i, 'The applied-filter status retained stale query-derived availability.');
assert.equal(overriddenAvailabilityState.cards, 0, 'An in-stock offer leaked into an explicit backorder result set.');
await evaluate(`(() => {
  const availability = document.getElementById('availability-filter');
  availability.value = '';
  availability.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await new Promise((resolve) => setTimeout(resolve, 160));

if (captureBrandSearch) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(`(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    const input = document.getElementById('main-search');
    const inputTop = input.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, inputTop - (window.innerHeight * 0.62)));
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const outputDirectory = new URL('../.artifacts/page-review/', import.meta.url);
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(new URL('catalog-brand-search-mobile.png', outputDirectory), Buffer.from(screenshot.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
}

await evaluate(`(() => {
  const input = document.getElementById('main-search');
  input.value = 'Khadlaj';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await new Promise((resolve) => setTimeout(resolve, 160));
const discoveredBrandState = await evaluate(`(() => ({
  urlBrand: new URL(location.href).searchParams.get('brand'),
  status: document.getElementById('search-intent-status').textContent.trim(),
  brands: [...document.querySelectorAll('#products-grid .product-brand')].map((node) => node.textContent.trim())
}))()`);
assert.deepEqual(discoveredBrandState, {
  urlBrand: 'Khadlaj',
  status: 'Showing only: Khadlaj.',
  brands: ['Khadlaj']
}, 'An exact feed brand discovered from search results did not become an enforced house filter.');

await navigate('/');
const desktopHeader = await evaluate(`(() => {
  const nav = document.querySelector('.nav-section').getBoundingClientRect();
  const input = document.getElementById('main-search');
  const initialClearButtons = [...document.querySelectorAll('#clear-search')].filter((button) => button.getClientRects().length).length;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
  const slashFocusedSearch = document.activeElement === input;
  input.value = 'fragrance';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return {
    navCenter: nav.left + (nav.width / 2),
    viewportCenter: document.documentElement.clientWidth / 2,
    searchType: input.type,
    shortcutHints: document.querySelectorAll('.fc-search-shortcut-hint').length,
    slashFocusedSearch,
    initialClearButtons,
    visibleClearButtons: [...document.querySelectorAll('#clear-search')].filter((button) => button.getClientRects().length).length,
    profileButton: (() => {
      const rect = document.querySelector('.profile-btn').getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()
  };
})()`);
assert.ok(Math.abs(desktopHeader.navCenter - desktopHeader.viewportCenter) < 2, 'The desktop navigation is not centered against the viewport.');
assert.equal(desktopHeader.searchType, 'text', 'The catalog search still exposes a browser-native duplicate cancel control.');
assert.equal(desktopHeader.shortcutHints, 0, 'The removed slash-key search hint was rendered.');
assert.equal(desktopHeader.slashFocusedSearch, false, 'The removed slash-key search shortcut still stole focus.');
assert.equal(desktopHeader.initialClearButtons, 0, 'An empty default catalog search rendered a stray clear action.');
assert.equal(desktopHeader.visibleClearButtons, 1, 'The catalog search does not expose exactly one clear action.');

const dropdownTheme = await evaluate(`(async () => {
  const select = document.getElementById('sort-by-filter');
  const wrapper = select?.closest('.fc-select');
  const trigger = wrapper?.querySelector('.fc-select__button');
  const menu = wrapper?.querySelector('.fc-select__menu');
  if (!trigger || !menu) return null;
  trigger.click();
  await new Promise((resolve) => setTimeout(resolve, 190));
  const background = getComputedStyle(menu).backgroundColor;
  const channels = (background.match(/[0-9.]+/g) || []).slice(0, 3).map(Number);
  const state = {
    expanded: trigger.getAttribute('aria-expanded'),
    background,
    darkSurface: channels.length === 3 && Math.max(...channels) < 80,
    optionColor: getComputedStyle(menu.querySelector('.fc-select__option')).color
  };
  trigger.click();
  return state;
})()`);
assert.ok(dropdownTheme, 'The catalog select was not enhanced into the shared dropdown.');
assert.equal(dropdownTheme.expanded, 'true', 'The catalog dropdown did not open.');
assert.equal(dropdownTheme.darkSurface, true, `The catalog dropdown reverted to a bright surface: ${dropdownTheme.background}`);
assert.notEqual(dropdownTheme.optionColor, 'rgb(40, 36, 30)', 'The catalog dropdown reverted to dark text intended for a light panel.');

const dropdownKeyboardState = await evaluate(`(async () => {
  const wrapper = document.getElementById('sort-by-filter').closest('.fc-select');
  const trigger = wrapper.querySelector('.fc-select__button');
  trigger.focus();
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const focusedOption = document.activeElement?.textContent.trim() || '';
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return {
    focusedOption,
    collapsed: trigger.getAttribute('aria-expanded') === 'false',
    focusRestored: document.activeElement === trigger
  };
})()`);
assert.match(dropdownKeyboardState.focusedOption, /^Price:/i, 'Dropdown typeahead did not move focus to a matching option.');
assert.equal(dropdownKeyboardState.collapsed, true, 'Escape did not close a dropdown opened by typeahead.');
assert.equal(dropdownKeyboardState.focusRestored, true, 'Closing a dropdown did not restore focus to its trigger.');

await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: desktopHeader.profileButton.x, y: desktopHeader.profileButton.y });
await new Promise((resolve) => setTimeout(resolve, 80));
const profilePointerPath = await evaluate(`(() => {
  const button = document.querySelector('.profile-btn').getBoundingClientRect();
  const menu = document.querySelector('.profile-menu').getBoundingClientRect();
  const firstLink = [...document.querySelectorAll('.profile-menu-item')].find((link) => link.getClientRects().length);
  const link = firstLink.getBoundingClientRect();
  firstLink.addEventListener('click', (event) => {
    event.preventDefault();
    window.__profileMenuLinkClicked = true;
  }, { once: true });
  return {
    gap: { x: Math.min(button.right - 4, menu.right - 12), y: button.bottom + 5 },
    link: { x: link.left + link.width / 2, y: link.top + link.height / 2 }
  };
})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: profilePointerPath.gap.x, y: profilePointerPath.gap.y });
await new Promise((resolve) => setTimeout(resolve, 80));
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: profilePointerPath.link.x, y: profilePointerPath.link.y });
await new Promise((resolve) => setTimeout(resolve, 260));
assert.equal(await evaluate(`document.querySelector('.profile-menu').getClientRects().length > 0 && getComputedStyle(document.querySelector('.profile-menu')).visibility === 'visible'`), true, 'The profile menu closed while crossing from the profile button to its links.');
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: profilePointerPath.link.x, y: profilePointerPath.link.y, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: profilePointerPath.link.x, y: profilePointerPath.link.y, button: 'left', buttons: 0, clickCount: 1 });
assert.equal(await evaluate(`window.__profileMenuLinkClicked === true`), true, 'A profile menu item could not be clicked after hovering into the menu.');
await pressEscape();
await new Promise((resolve) => setTimeout(resolve, 150));
const profileEscapeState = await evaluate(`(() => {
  const dropdown = document.querySelector('.profile-dropdown');
  const menu = document.querySelector('.profile-menu');
  const style = getComputedStyle(menu);
  return { className: dropdown.className, expanded: document.querySelector('.profile-btn').getAttribute('aria-expanded'), visibility: style.visibility, opacity: style.opacity };
})()`);
assert.equal(profileEscapeState.visibility, 'hidden', `Escape did not close the profile menu: ${JSON.stringify(profileEscapeState)}`);
assert.equal(await evaluate(`(() => {
  const button = document.querySelector('.profile-btn');
  button.focus();
  button.click();
  button.click();
  return button.getAttribute('aria-expanded');
})()`), 'false', 'Clicking the profile button a second time did not close its menu.');

const favoriteInteractionStart = await evaluate(`(() => {
  const button = document.querySelector('.product-card .favorite-btn');
  if (!button) return null;
  const duplicate = button.cloneNode(true);
  duplicate.classList.add('favorite-btn-test-duplicate');
  button.parentElement.appendChild(duplicate);
  button.click();
  duplicate.click();
  const rect = button.getBoundingClientRect();
  const interactionKey = button.dataset.id;
  const matches = [...document.querySelectorAll('.favorite-btn[data-id]')]
    .filter((candidate) => candidate.dataset.id === interactionKey);
  return {
    x: rect.left + (rect.width / 2),
    y: rect.top + (rect.height / 2),
    matchingButtons: matches.length,
    disabledMatches: matches.filter((candidate) => candidate.disabled).length,
    mutationCount: window.__favoriteMutationCount
  };
})()`);
assert.ok(favoriteInteractionStart, 'The catalog did not render a favorite button.');
assert.ok(favoriteInteractionStart.matchingButtons >= 2, 'The favorite concurrency test did not create a duplicate card control.');
assert.equal(favoriteInteractionStart.disabledMatches, favoriteInteractionStart.matchingButtons, 'Duplicate cards were not locked during a favorite request.');
assert.equal(favoriteInteractionStart.mutationCount, 1, 'Duplicate cards submitted more than one favorite mutation.');
await new Promise((resolve) => setTimeout(resolve, 120));
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: favoriteInteractionStart.x, y: favoriteInteractionStart.y });
// The favorite control intentionally animates its neutral-to-gold state over
// 200ms. Sample after that transition so this asserts the durable hover state,
// not an in-flight frame whose timing varies by host load.
await new Promise((resolve) => setTimeout(resolve, 260));
const favoriteHoverState = await evaluate(`(() => {
  const button = document.querySelector('.product-card .favorite-btn');
  const style = getComputedStyle(button);
  return {
    favorited: button.classList.contains('favorited'),
    pressed: button.getAttribute('aria-pressed'),
    color: style.color,
    borderColor: style.borderColor
  };
})()`);
assert.equal(favoriteHoverState.favorited, true, 'The selected favorite lost its active class.');
assert.equal(favoriteHoverState.pressed, 'true', 'The selected favorite did not expose its pressed state.');
assert.notEqual(favoriteHoverState.color, 'rgb(255, 255, 255)', 'The selected heart turned white on hover.');
assert.equal(favoriteHoverState.color, favoriteHoverState.borderColor, 'The selected heart and its gold border no longer match.');
const favoriteRerenderState = await evaluate(`(() => {
  displayProducts(filteredPerfumes);
  const button = document.querySelector('.product-card .favorite-btn');
  return {
    favorited: button?.classList.contains('favorited'),
    pressed: button?.getAttribute('aria-pressed'),
    color: button ? getComputedStyle(button).color : ''
  };
})()`);
assert.equal(favoriteRerenderState.favorited, true, 'The selected favorite lost its gold state after a catalog re-render.');
assert.equal(favoriteRerenderState.pressed, 'true', 'The selected favorite lost its pressed state after a catalog re-render.');
assert.notEqual(favoriteRerenderState.color, 'rgb(255, 255, 255)', 'The selected heart turned white after a catalog re-render.');

const detailState = await evaluate(`(async () => {
  const button = document.querySelector('[data-product-details]');
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const dialog = document.getElementById('product-detail-dialog');
  const rect = dialog.getBoundingClientRect();
  return {
    open: dialog.open,
    width: rect.width,
    viewportWidth: innerWidth,
    title: document.getElementById('product-detail-title')?.textContent,
    closeButtonFocused: document.activeElement?.matches('[data-close-product-dialog]') === true,
    hasComparisonSection: [...dialog.querySelectorAll('h3')].some((heading) => /compare current offers/i.test(heading.textContent)),
    historyVisible: document.querySelector('.product-history-section')?.hidden === false,
    watchSelectEnhanced: document.querySelector('#product-alert-form select[name="alertType"]')?.dataset.enhancedSelect === 'true',
    featureStylesLoaded: [...document.styleSheets].some((sheet) => /feature-styles\.css$/.test(sheet.href || ''))
  };
})()`);
assert.equal(detailState.open, true, 'Product details did not open in a modal dialog.');
assert.ok(detailState.width <= detailState.viewportWidth, 'Product details overflow the desktop viewport.');
assert.match(detailState.title, /Smoke Fragrance/, 'Product detail content does not match the selected card.');
assert.equal(detailState.closeButtonFocused, true, 'Product details did not move focus to a usable dialog control.');
assert.equal(detailState.hasComparisonSection, false, 'A comparison section was shown without multiple verified offers.');
assert.equal(detailState.historyVisible, false, 'An empty price-history section was shown.');
assert.equal(detailState.watchSelectEnhanced, true, 'The dynamically inserted watch selector still uses the browser-native dropdown.');
assert.equal(detailState.featureStylesLoaded, true, 'Catalog feature styles are not loaded on the homepage.');

const watchDropdownState = await evaluate(`(async () => {
  const select = document.querySelector('#product-alert-form select[name="alertType"]');
  const wrapper = select.closest('.fc-select');
  const trigger = wrapper.querySelector('.fc-select__button');
  const menu = wrapper.querySelector('.fc-select__menu');
  select.closest('label').click();
  const wrappingLabelFocusedTrigger = document.activeElement === trigger;
  trigger.click();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const channels = (getComputedStyle(menu).backgroundColor.match(/[0-9.]+/g) || []).slice(0, 3).map(Number);
  menu.querySelector('[data-value="deal"]').click();
  document.getElementById('product-alert-form').requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 80));
  return {
    darkSurface: channels.length === 3 && Math.max(...channels) < 80,
    wrappingLabelFocusedTrigger,
    selectedValue: select.value,
    targetPriceHidden: document.querySelector('[data-target-price-label]').hidden,
    requestBody: window.__lastAlertBody,
    status: document.querySelector('.alert-form-status').textContent
  };
})()`);
assert.equal(watchDropdownState.darkSurface, true, 'The watch selector dropdown reverted to a bright native-style surface.');
assert.equal(watchDropdownState.wrappingLabelFocusedTrigger, true, 'A wrapping label did not focus its enhanced dropdown trigger.');
assert.equal(watchDropdownState.selectedValue, 'deal', 'The custom watch selector did not update the native form value.');
assert.equal(watchDropdownState.targetPriceHidden, true, 'Promotion watches still display an irrelevant target-price field.');
assert.equal(watchDropdownState.requestBody?.alertType, 'deal', 'The selected watch type was not submitted.');
assert.equal(watchDropdownState.requestBody?.targetPrice, null, 'A promotion watch submitted a stale target price.');
assert.match(watchDropdownState.status, /watch saved/i, 'A successful watch request did not confirm the saved state.');

const galleryTransition = await evaluate(`(async () => {
  const stage = document.querySelector('.detail-image-stage');
  const thumbnails = [...document.querySelectorAll('[data-detail-image]')];
  const target = thumbnails[1];
  if (!stage || !target) return null;
  target.click();
  let crossfadeObserved = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const opacities = [...stage.querySelectorAll('img')].map((image) => Number.parseFloat(getComputedStyle(image).opacity));
    if (opacities.length === 2 && opacities.every((opacity) => opacity > 0 && opacity < 1)) crossfadeObserved = true;
    if (stage.dataset.transitioning !== 'true') break;
  }
  return {
    crossfadeObserved,
    imageCount: stage.querySelectorAll('img').length,
    selected: target.getAttribute('aria-pressed'),
    activeThumbnails: thumbnails.filter((thumbnail) => thumbnail.classList.contains('is-active')).length
  };
})()`);
assert.equal(galleryTransition?.crossfadeObserved, true, 'Product gallery images did not visibly crossfade.');
assert.equal(galleryTransition?.imageCount, 1, 'Product gallery left a transition image behind.');
assert.equal(galleryTransition?.selected, 'true', 'Product gallery did not expose the selected thumbnail state.');
assert.equal(galleryTransition?.activeThumbnails, 1, 'Product gallery exposed more than one selected thumbnail.');
await pressEscape();
assert.equal(await evaluate(`document.getElementById('product-detail-dialog').open`), false, 'Product details did not close with Escape.');

const favoritesRerenderState = await evaluate(`(async () => {
  const saved = {
    fragrance_id: 'saved-ui-smoke',
    name: 'Saved UI Smoke Fragrance',
    advertiserName: 'Test Retailer',
    imageUrl: '/assets/images/chanel-card.webp',
    productUrl: 'https://example.com/saved-ui-smoke',
    price: 100,
    currency: 'USD',
    shippingCost: 0,
    shipping_availability: 'available'
  };
  isInFavoritesView = true;
  authUI.favoritesSection.hidden = false;
  currentFilters.brand = '';
  currentFilters.priceRange = 'all';
  currentFilters.shipping = 'free';
  document.getElementById('shipping-filter').value = 'free';
  document.getElementById('currency-converter').value = 'EUR';
  userFavorites.add(saved.fragrance_id);
  currentFavorites = [saved];
  displayFavorites(currentFavorites);
  const beforeFilter = document.querySelector('#favorites-grid .product-price')?.textContent.trim() || '';
  filterFavorites();
  const afterFilter = document.querySelector('#favorites-grid .product-price')?.textContent.trim() || '';
  document.querySelector('#favorites-grid .favorite-btn').click();
  await new Promise((resolve) => setTimeout(resolve, 380));
  const result = {
    beforeFilter,
    afterFilter,
    currentCount: currentFavorites.length,
    renderedCards: document.querySelectorAll('#favorites-grid .product-card').length,
    emptyState: document.getElementById('favorites-empty-state').dataset.state
  };
  isInFavoritesView = false;
  authUI.favoritesSection.hidden = true;
  currentFilters.shipping = 'all';
  document.getElementById('shipping-filter').value = 'all';
  document.getElementById('currency-converter').value = 'USD';
  return result;
})()`);
assert.match(favoritesRerenderState.beforeFilter, /EUR$/, 'A saved offer ignored the selected display currency.');
assert.match(favoritesRerenderState.afterFilter, /EUR$/, 'Filtering favorites reverted a converted price to its original currency.');
assert.equal(favoritesRerenderState.currentCount, 0, 'A removed favorite remained in the in-memory saved list.');
assert.equal(favoritesRerenderState.renderedCards, 0, 'A removed favorite reappeared after its removal animation.');
assert.equal(favoritesRerenderState.emptyState, 'empty', 'Removing the last saved offer did not reveal the honest empty state.');

const publicPages = [
  '/',
  '/auth.html',
  '/account.html',
  '/admin.html',
  '/contact.html',
  '/customer-service.html',
  '/faq.html',
  '/privacy-policy.html',
  '/terms-of-service.html',
  '/size-guide.html',
  '/404.html'
];

for (const width of [320, 390, 768, 900, 1024, 1280]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 769 });
  for (const page of publicPages) {
    await navigate(page, 100);
    const layout = await evaluate(`({
      hasMain: Boolean(document.querySelector('main')),
      overflow: document.documentElement.scrollWidth > innerWidth,
      hasStandaloneBrandFilter: Boolean(document.getElementById('brand-filter')),
      searchTop: document.querySelector('.filter-container .search-container')?.getBoundingClientRect().top ?? null,
      advancedFiltersTop: document.querySelector('.catalog-advanced-filters')?.getBoundingClientRect().top ?? null,
      unenhancedSelects: [...document.querySelectorAll('select:not([data-native-select])')]
        .filter((select) => select.dataset.enhancedSelect !== 'true')
        .map((select) => select.id || select.name || 'unnamed')
    })`);
    assert.equal(layout.hasMain, true, `${page} has no main landmark at ${width}px.`);
    assert.equal(layout.overflow, false, `${page} overflows horizontally at ${width}px.`);
    assert.deepEqual(layout.unenhancedSelects, [], `${page} still has browser-native site dropdowns at ${width}px.`);
    if (page === '/') {
      assert.equal(layout.hasStandaloneBrandFilter, false, `The removed standalone brand dropdown returned at ${width}px.`);
      assert.ok(layout.searchTop < layout.advancedFiltersTop, `The catalog search fell below advanced filters at ${width}px.`);
    }

    if (width === 390 || width === 1280) {
      await evaluate(axeSource);
      const violations = await evaluate(`
        axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
        }).then((result) => result.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          targets: violation.nodes.map((node) => node.target.join(' '))
        })))
      `);
      assert.deepEqual(violations, [], `${page} has accessibility violations at ${width}px:\n${JSON.stringify(violations, null, 2)}`);
    }
  }
}
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: regressionMockIdentifier });

assert.deepEqual(browserExceptions, [], `Browser exceptions occurred:\n${browserExceptions.join('\n')}`);
console.log('Browser smoke checks passed for core interactions and all public layouts from 320px through 1280px.');

socket.close();
await fetch(`${cdpOrigin}/json/close/${target.id}`);
