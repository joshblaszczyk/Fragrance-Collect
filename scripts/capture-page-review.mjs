import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cdpOrigin = process.env.CDP_ORIGIN || 'http://127.0.0.1:9223';
const siteOrigin = process.env.SITE_ORIGIN || 'http://127.0.0.1:8787';
const supplementalFailure = process.env.REVIEW_SUPPLEMENTAL_FAILURE === '1';
const authenticatedHome = process.env.REVIEW_AUTHENTICATED_HOME === '1';
const reviewDirectory = supplementalFailure ? 'page-review-fallback' : 'page-review';
const outputDirectory = new URL(`../.artifacts/${reviewDirectory}/`, import.meta.url);
mkdirSync(outputDirectory, { recursive: true });

const allPages = [
  { name: 'home', path: '/' },
  { name: 'sign-in', path: '/auth.html?tab=signin' },
  { name: 'sign-up', path: '/auth.html?tab=signup' },
  { name: 'account', path: '/account.html' },
  { name: 'admin', path: '/admin.html' },
  { name: 'contact', path: '/contact.html' },
  { name: 'customer-service', path: '/customer-service.html' },
  { name: 'faq', path: '/faq.html' },
  { name: 'size-guide', path: '/size-guide.html' },
  { name: 'privacy', path: '/privacy-policy.html' },
  { name: 'terms', path: '/terms-of-service.html' },
  { name: 'not-found', path: '/404.html' }
];

const requestedPages = new Set((process.env.REVIEW_PAGES || '').split(',').filter(Boolean));
const pages = requestedPages.size ? allPages.filter((page) => requestedPages.has(page.name)) : allPages;

const allViewports = [
  { name: 'desktop', width: 1440, height: 1000, mobile: false },
  { name: 'tablet', width: 1024, height: 900, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true }
];
const requestedViewports = new Set((process.env.REVIEW_VIEWPORTS || '').split(',').filter(Boolean));
const viewports = requestedViewports.size
  ? allViewports.filter((viewport) => requestedViewports.has(viewport.name))
  : allViewports;

const targetResponse = await fetch(`${cdpOrigin}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
if (!targetResponse.ok) throw new Error(`Could not create a browser target at ${cdpOrigin}.`);
const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const eventWaiters = new Map();
let nextId = 1;
let currentPage = 'startup';
const browserExceptions = [];
const browserLogs = [];

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

  if (message.method === 'Runtime.exceptionThrown') {
    const error = message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text;
    if (!error.includes('chrome-extension://')) browserExceptions.push({
      page: currentPage,
      error
    });
  }

  if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(message.params.entry.level)) {
    browserLogs.push({ page: currentPage, source: message.params.entry.source, level: message.params.entry.level, text: message.params.entry.text });
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

function waitForEvent(method, timeoutMs = 12_000) {
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

async function waitForBrowserCondition(expression, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await evaluate(`Boolean(${expression})`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return false;
}

async function navigate(path) {
  const loaded = waitForEvent('Page.loadEventFired');
  await send('Page.navigate', { url: `${siteOrigin}${path}` });
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, 850));
  await evaluate(`
    (async () => {
      document.documentElement.style.scrollBehavior = 'auto';
      document.documentElement.style.overflowAnchor = 'none';
      const passes = location.pathname === '/' ? 3 : 1;
      for (let pass = 0; pass < passes; pass += 1) {
        const height = document.documentElement.scrollHeight;
        for (let y = 0; y < height; y += Math.max(500, innerHeight * 0.75)) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 70));
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      document.activeElement?.blur();
      const assetsReady = Promise.all([
        document.fonts?.ready || Promise.resolve(),
        Promise.all([...document.images].map((img) => img.decode?.().catch(() => {}) || Promise.resolve()))
      ]);
      // A broken third-party product image must not leave visual QA hanging
      // until the browser's network timeout. Capture the settled layout after
      // a bounded wait and let the image error fallback render normally.
      await Promise.race([
        assetsReady,
        new Promise((resolve) => setTimeout(resolve, 5000))
      ]);
      document.scrollingElement.scrollTop = 0;
      for (let attempt = 0; attempt < 20 && window.scrollY !== 0; attempt += 1) {
        document.scrollingElement.scrollTop = 0;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    })()
  `);
}

const mockScript = `
  (() => {
    const supplementalFailure = ${JSON.stringify(supplementalFailure)};
    const authenticatedHome = ${JSON.stringify(authenticatedHome)};
    const json = (value, status = 200) => Promise.resolve(new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' }
    }));
    const products = [
      { id: 'review-1', sourceProductId: 'AE-ECLAT-100', productKey: 'gtin:1234567890123', matchMethod: 'GTIN / UPC / EAN', matchConfidence: 'exact', gtin: '1234567890123', advertiserId: '1001', name: 'Éclat No. 04 Eau de Parfum', brand: 'Maison Éclat', advertiser: 'Atelier Beauty', price: 108, regularPrice: 128, salePrice: 108, discountPercent: 16, currency: 'USD', image: '/assets/images/chanel-card.webp', additionalImages: ['/assets/images/chanel-hero-mobile.webp'], link: 'https://example.com/eclat', shippingCost: null, availability: 'IN_STOCK', size: ['3.4 oz'], productTypes: ['Beauty > Fragrance > Eau de Parfum'], description: 'A luminous amber floral fragrance with a polished citrus opening.', highlights: ['Eau de Parfum', '3.4 oz presentation'], lastUpdated: '2026-07-18T16:00:00Z', serviceableAreas: ['US', 'CA'] },
      { id: 'review-2', productKey: 'catalog:archive-house-vetiver-archive-2-5-oz', advertiserId: '1002', name: 'Vetiver Archive Parfum', brand: 'Archive House', advertiser: 'Scent Market', price: 186, regularPrice: 186, currency: 'USD', image: '/assets/images/creed-card.webp', link: 'https://example.com/vetiver', shippingCost: 0, freeShippingVerified: true, availability: 'IN_STOCK', size: ['2.5 oz'], productTypes: ['Parfum'], lastUpdated: '2026-07-17T14:00:00Z' },
      { id: 'review-3', productKey: 'catalog:ligne-privee-bois-ambre-3-3-oz', advertiserId: '1003', name: 'Bois Ambré Eau de Toilette', brand: 'Ligne Privée', advertiser: 'The Fragrance Edit', price: 92, regularPrice: 92, currency: 'USD', image: '/assets/images/dior-card.webp', link: 'https://example.com/bois', shippingCost: 7.95, shippingCurrency: 'USD', availability: 'BACKORDER', size: ['3.3 oz'], productTypes: ['Eau de Toilette'], lastUpdated: '2026-07-16T11:00:00Z' },
      { id: 'review-4', productKey: 'catalog:nocturne-midnight-santal-50-ml', advertiserId: '1001', name: 'Midnight Santal Reserve', brand: 'Nocturne', advertiser: 'Atelier Beauty', price: 154, regularPrice: 154, currency: 'USD', image: '/assets/images/tom-ford-card.webp', link: 'https://example.com/santal', shippingCost: null, availability: 'PREORDER', size: ['50 ml'], productTypes: ['Fragrance'], lastUpdated: '2026-07-15T09:00:00Z' },
      { id: 'FS90353ga', advertiserId: '7287203', name: 'Avant Fragrance World Perfume for Unisex - Eau de Parfum Spray 3.4 oz', brand: 'Fragrance World', advertiser: 'FragranceShop.com', price: 17.95, currency: 'USD', image: '/assets/images/fragrance-placeholder.svg', link: 'https://example.com/avant?size=eau-de-parfum-spray-3-4-oz', shippingCost: 0, description: 'Avant Fragrance World Perfume for Unisex - Eau de Parfum Spray 3.4 oz' }
    ];
    const exactOffers = [
      products[0],
      { ...products[0], id: 'review-1b', sourceProductId: 'SM-04-34', advertiserId: '1002', advertiser: 'Scent Market', price: 112, regularPrice: 112, link: 'https://example.com/eclat-scent-market', shippingCost: 0, shippingCurrency: 'USD' }
    ];
    const semanticProducts = [
      { id: 'semantic-match', productKey: 'catalog:intent-atlas-edp-spray-100-men', advertiserId: 'intent-house', name: 'Atlas Eau de Parfum Spray 100 mL for Men', brand: 'Intent House', advertiser: 'Intent House', price: 120, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/atlas', shippingCost: 0, availability: 'IN_STOCK', size: ['100 mL'], unitSizeMl: 100, canonicalSizeMl: 100, packCount: 1, audience: ['Men'], fragranceConcentration: 'Eau de Parfum', fragranceForm: 'Spray', productTypes: ['Perfume & Cologne'] },
      { id: 'semantic-women', productKey: 'catalog:intent-atlas-edp-spray-100-women', advertiserId: 'intent-house', name: 'Atlas Eau de Parfum Spray 100 mL for Women', brand: 'Intent House', advertiser: 'Intent House', price: 120, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/atlas-women', shippingCost: 0, availability: 'IN_STOCK', size: ['100 mL'], unitSizeMl: 100, canonicalSizeMl: 100, packCount: 1, audience: ['Women'], fragranceConcentration: 'Eau de Parfum', fragranceForm: 'Spray', productTypes: ['Perfume & Cologne'] },
      { id: 'semantic-unisex', productKey: 'catalog:intent-atlas-edp-spray-100-unisex', advertiserId: 'intent-house', name: 'Atlas Eau de Parfum Spray 100 mL Unisex', brand: 'Intent House', advertiser: 'Intent House', price: 120, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/atlas-unisex', shippingCost: 0, availability: 'IN_STOCK', size: ['100 mL'], unitSizeMl: 100, canonicalSizeMl: 100, packCount: 1, audience: ['Unisex'], fragranceConcentration: 'Eau de Parfum', fragranceForm: 'Spray', productTypes: ['Perfume & Cologne'] },
      { id: 'semantic-edt', productKey: 'catalog:intent-atlas-edt-spray-100-men', advertiserId: 'intent-house', name: 'Atlas Eau de Toilette Spray 100 mL for Men', brand: 'Intent House', advertiser: 'Intent House', price: 110, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/atlas-edt', shippingCost: 0, availability: 'IN_STOCK', size: ['100 mL'], unitSizeMl: 100, canonicalSizeMl: 100, packCount: 1, audience: ['Men'], fragranceConcentration: 'Eau de Toilette', fragranceForm: 'Spray', productTypes: ['Perfume & Cologne'] },
      { id: 'semantic-size', productKey: 'catalog:intent-atlas-edp-spray-50-men', advertiserId: 'intent-house', name: 'Atlas Eau de Parfum Spray 50 mL for Men', brand: 'Intent House', advertiser: 'Intent House', price: 85, currency: 'USD', image: '/assets/images/chanel-card.webp', link: 'https://example.com/atlas-50', shippingCost: 0, availability: 'IN_STOCK', size: ['50 mL'], unitSizeMl: 50, canonicalSizeMl: 50, packCount: 1, audience: ['Men'], fragranceConcentration: 'Eau de Parfum', fragranceForm: 'Spray', productTypes: ['Perfume & Cologne'] }
    ];
    const advertisers = [
      { id: '1001', name: 'Atelier Beauty', relationshipStatus: 'joined', accountStatus: 'active', category: { child: 'Beauty' }, sevenDayEpc: 42.18, threeMonthEpc: 36.92, mobileSupported: true, mobileTrackingCertified: true },
      { id: '1002', name: 'Scent Market', relationshipStatus: 'joined', accountStatus: 'active', category: { child: 'Fragrance' }, sevenDayEpc: 31.4, threeMonthEpc: 29.76, mobileSupported: true, mobileTrackingCertified: true },
      { id: '1003', name: 'The Fragrance Edit', relationshipStatus: 'joined', accountStatus: 'active', category: { child: 'Specialty retail' }, sevenDayEpc: 18.2, threeMonthEpc: 21.08, mobileSupported: true, mobileTrackingCertified: false }
    ];
    window.fetch = (input) => {
      const url = String(input);
      // Cloudflare's canonical redirects remove the .html suffix; keep fixtures
      // authenticated on both the source URL and its extensionless target.
      let currentPath = location.pathname;
      while (currentPath.length > 1 && currentPath.endsWith('/')) currentPath = currentPath.slice(0, -1);
      const normalizedPath = currentPath.endsWith('.html') ? currentPath.slice(0, -5) : currentPath;
      const onAccountPage = normalizedPath === '/account';
      const onAdminPage = normalizedPath === '/admin';
      const onHomePage = normalizedPath === '' || normalizedPath === '/' || normalizedPath === '/index' || normalizedPath === '/main';
      if (url.includes('/api/status')) {
        return onAccountPage || onAdminPage || (authenticatedHome && onHomePage)
          ? json({ success: true, user: { id: 'review-user', name: 'Jordan Ellis', email: 'jordan@example.com', picture: '', hasPassword: true, hasGoogleIdentity: true } })
          : json({ error: 'Not authenticated' }, 401);
      }
      if (url.includes('/api/products')) {
        const requestUrl = new URL(url, location.origin);
        const requestedGtin = requestUrl.searchParams.get('gtin');
        const requestedBrand = requestUrl.searchParams.get('brand');
        const requestedQuery = requestUrl.searchParams.get('q') || '';
        const results = /men'?s eau de parfum spray 100 ml/i.test(requestedQuery)
          ? semanticProducts
          : requestedGtin
          ? exactOffers.filter((product) => product.gtin === requestedGtin)
          : requestedBrand
            ? [{ ...products[0], id: 'review-brand', productKey: 'catalog:review-brand-fragrance', name: requestedBrand + ' Eau de Parfum', brand: requestedBrand }]
            : products;
        return json({ products: results, total: results.length, page: 1, limit: 25, hasMore: false, searchQuery: requestedQuery || requestedGtin || 'fragrance', optimization: { exactMatchApplied: Boolean(requestedGtin) }, dataFreshness: { updatedAt: '2026-07-18T16:00:00Z', stale: false } });
      }
      if (url.includes('/api/deals') && supplementalFailure) return json({ error: 'Not found' }, 404);
      if (url.includes('/api/deals')) return json({ deals: [
        { id: 'deal-1', advertiserId: '1001', advertiserName: 'Atelier Beauty', name: 'Summer fragrance event', description: 'Save on selected eau de parfum and gift sets while the retailer promotion is active.', couponCode: 'SCENT15', promotionType: 'Coupon', startsAt: '2026-07-10', endsAt: '2026-07-31', clickUrl: 'https://example.com/deal-1' },
        { id: 'deal-2', advertiserId: '1002', advertiserName: 'Scent Market', name: 'Complimentary delivery event', description: 'Retailer shipping promotion on qualifying fragrance orders.', promotionType: 'Free Shipping', endsAt: '2026-07-28', clickUrl: 'https://example.com/deal-2' },
        { id: 'deal-3', advertiserId: '1003', advertiserName: 'The Fragrance Edit', name: 'Private selection savings', description: 'Current savings on a rotating selection of fragrance houses.', couponCode: 'ARCHIVE10', promotionType: 'Coupon', endsAt: '2026-08-02', clickUrl: 'https://example.com/deal-3' }
      ], updatedAt: '2026-07-19T08:00:00Z', stale: false });
      if (url.includes('/api/advertisers') && supplementalFailure) return json({ error: 'Not found' }, 404);
      if (url.includes('/api/advertisers')) return json({ advertisers, total: advertisers.length, updatedAt: '2026-07-19T08:00:00Z' });
      if (url.includes('/api/product-history')) return json({ observations: [], methodology: 'Daily local observations.' });
      if (url.includes('/api/user/alerts')) return json({ success: true, alerts: [] });
      if (url.includes('/api/user/preferences')) return json({ success: true, preferences: { scentFamilies: ['woody'], priceRange: '100-200' } });
      if (url.includes('/api/user/favorites')) return json({ success: true, favorites: [] });
      if (url.includes('/api/admin/cj/summary')) return json({ range: { days: 30 }, commissions: { totals: { actions: 24, salesUsd: 3840, commissionUsd: 312, corrected: 1, crossDevice: 4, averageOrderUsd: 160 }, byAdvertiser: [{ advertiser: 'Atelier Beauty', actions: 12, salesUsd: 2100, commissionUsd: 178 }, { advertiser: 'Scent Market', actions: 8, salesUsd: 1210, commissionUsd: 94 }, { advertiser: 'The Fragrance Edit', actions: 4, salesUsd: 530, commissionUsd: 40 }], byDay: [{ day: '2026-07-14', actions: 3, salesUsd: 420, commissionUsd: 34 }, { day: '2026-07-15', actions: 5, salesUsd: 820, commissionUsd: 66 }, { day: '2026-07-16', actions: 4, salesUsd: 610, commissionUsd: 48 }, { day: '2026-07-17', actions: 7, salesUsd: 1130, commissionUsd: 92 }, { day: '2026-07-18', actions: 5, salesUsd: 860, commissionUsd: 72 }], recent: [{ advertiser: 'Atelier Beauty', status: 'new', validationStatus: 'approved', eventDate: '2026-07-18', saleAmountUsd: 164, commissionUsd: 13.12, country: 'US' }] }, local: { clicks: { total: 186, products: 72, advertisers: 3 }, observations: { total: 248, products: 91, latest: '2026-07-19T07:00:00Z' }, activeAlerts: 14 }, sync: [{ source: 'advertisers', last_success_at: '2026-07-19T06:17:00Z', record_count: 3, last_error: null }, { source: 'deals', last_success_at: '2026-07-19T06:17:00Z', record_count: 16, last_error: null }, { source: 'deal-alerts', last_success_at: '2026-07-19T06:18:00Z', record_count: 8, last_error: null }] });
      if (url.includes('/api/admin/cj/advertisers')) return json({ advertisers });
      if (url.includes('/api/admin/cj/program-terms')) return json({ resultList: [] });
      if (url.includes('open.er-api.com') || url.includes('frankfurter.app')) return json({ rates: { USD: 1, EUR: 0.92, GBP: 0.79 } });
      return json({ success: true });
    };
  })();
`;

const report = [];

try {
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.clearBrowserCache');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: mockScript });

  for (const viewport of viewports) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile
    });

    for (const page of pages) {
      currentPage = `${page.name}-${viewport.name}`;
      await navigate(page.path);
      if (page.name === 'account') {
        const accountReady = await waitForBrowserCondition(
          `document.querySelector('#profile-name')?.value === 'Jordan Ellis'`
        );
        if (!accountReady) {
          throw new Error(`The authenticated account fixture did not render for ${currentPage}.`);
        }
      }
      const layout = await evaluate(`({
        title: document.title,
        width: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        height: document.documentElement.scrollHeight,
        scrollY: window.scrollY,
        overflow: document.documentElement.scrollWidth > innerWidth,
        mainLandmarks: document.querySelectorAll('main').length,
        productCards: document.querySelectorAll('.product-card').length,
        falseZeroRatings: [...document.querySelectorAll('.rating-number')].filter((node) => node.textContent.trim() === '0.0').length,
        freeShippingClaims: [...document.querySelectorAll('.product-shipping')].filter((node) => /free shipping/i.test(node.textContent)).length
        ,supportNavigationLinks: document.querySelectorAll('.support-subnav a, .support-nav a, .service-route-nav a').length
        ,currentSupportLinks: document.querySelectorAll('.support-subnav [aria-current="page"], .support-nav [aria-current="page"], .service-route-nav [aria-current="page"]').length
        ,compactFallbacks: document.querySelectorAll('.catalog-fallback-panel').length
        ,compactFallbackSections: document.querySelectorAll('.has-compact-fallback').length
        ,retailerFallbackDirectory: document.querySelectorAll('#retailer-directory .retailer-directory-summary.is-fallback').length
        ,retailerIds: [...document.querySelectorAll('#retailer-directory [data-advertiser-id]')].map((node) => node.dataset.advertiserId)
        ,marketplaceLabels: [...document.querySelectorAll('#retailer-directory .retailer-item--marketplace .retailer-name small')].map((node) => node.textContent.trim())
        ,headerLinkTops: [...document.querySelectorAll('.fragrance-header .main-nav > li > :is(a, button)')].map((node) => Math.round(node.getBoundingClientRect().top))
        ,googleDiagnostic: (() => {
          const host = document.querySelector('.google-button-host');
          if (!host) return null;
          return {
            host: { html: host.innerHTML.slice(0, 1200), rect: host.getBoundingClientRect().toJSON(), overflow: getComputedStyle(host).overflow },
            descendants: [...host.querySelectorAll('*')].slice(0, 12).map((node) => ({
              tag: node.tagName,
              className: typeof node.className === 'string' ? node.className : '',
              rect: node.getBoundingClientRect().toJSON(),
              display: getComputedStyle(node).display
            })),
            stylesheets: [...document.styleSheets].map((sheet) => sheet.href || 'inline')
          };
        })()
      })`);
      const screenshot = await send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true
      });
      const filename = `${page.name}-${viewport.name}.png`;
      writeFileSync(new URL(filename, outputDirectory), Buffer.from(screenshot.data, 'base64'));
      const entry = { page: page.path, viewport, screenshot: filename, ...layout };

      if (page.name === 'account') {
        const privacyOpened = await evaluate(`
          (async () => {
            const trigger = document.querySelector('.account-sidebar a[href="#privacy"]');
            const panel = document.getElementById('privacy');
            if (!trigger || !panel) return false;
            trigger.click();
            await new Promise((resolve) => setTimeout(resolve, 180));
            document.scrollingElement.scrollTop = 0;
            return panel.hidden === false;
          })()
        `);
        if (privacyOpened) {
          const privacyScreenshot = await send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: true
          });
          const privacyFilename = `account-privacy-${viewport.name}.png`;
          writeFileSync(new URL(privacyFilename, outputDirectory), Buffer.from(privacyScreenshot.data, 'base64'));
          entry.privacyScreenshot = privacyFilename;
        }
      }

      if (page.name === 'home') {
        const filterOpened = await evaluate(`
          (async () => {
            const trigger = document.querySelector('#sort-by-filter')?.closest('.fc-select')?.querySelector('.fc-select__button');
            if (!trigger) return false;
            document.getElementById('filter')?.scrollIntoView({ block: 'start' });
            await new Promise((resolve) => setTimeout(resolve, 250));
            trigger.click();
            await new Promise((resolve) => setTimeout(resolve, 180));
            return trigger.getAttribute('aria-expanded') === 'true';
          })()
        `);
        if (filterOpened) {
          const filterScreenshot = await send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: false
          });
          const filterFilename = `catalog-filters-${viewport.name}.png`;
          writeFileSync(new URL(filterFilename, outputDirectory), Buffer.from(filterScreenshot.data, 'base64'));
          entry.filterScreenshot = filterFilename;
          await evaluate(`
            document.querySelector('#sort-by-filter')?.closest('.fc-select')?.querySelector('.fc-select__button')?.click();
            document.scrollingElement.scrollTop = 0;
          `);
        }

        const brandSearchApplied = await evaluate(`
          (async () => {
            const input = document.getElementById('main-search');
            if (!input) return false;
            document.getElementById('filter')?.scrollIntoView({ block: 'start' });
            await new Promise((resolve) => setTimeout(resolve, 180));
            input.value = 'Chanel';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 250));
            document.documentElement.style.scrollBehavior = 'auto';
            const inputTop = input.getBoundingClientRect().top + window.scrollY;
            window.scrollTo(0, Math.max(0, inputTop - (window.innerHeight * 0.62)));
            await new Promise((resolve) => setTimeout(resolve, 180));
            return document.getElementById('search-intent-status')?.classList.contains('is-active') === true;
          })()
        `);
        if (brandSearchApplied) {
          const brandSearchScreenshot = await send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: false
          });
          const brandSearchFilename = `catalog-brand-search-${viewport.name}.png`;
          writeFileSync(new URL(brandSearchFilename, outputDirectory), Buffer.from(brandSearchScreenshot.data, 'base64'));
          entry.brandSearchScreenshot = brandSearchFilename;
          await evaluate(`
            document.scrollingElement.scrollTop = 0;
          `);
        }

        const detailsOpened = await evaluate(`
          (async () => {
            const trigger = document.querySelector('[data-product-details]');
            if (!trigger) return false;
            trigger.click();
            await new Promise((resolve) => setTimeout(resolve, 350));
            return document.getElementById('product-detail-dialog')?.open === true;
          })()
        `);
        if (detailsOpened) {
          const detailsScreenshot = await send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: false
          });
          const detailsFilename = `product-detail-${viewport.name}.png`;
          writeFileSync(new URL(detailsFilename, outputDirectory), Buffer.from(detailsScreenshot.data, 'base64'));
          entry.detailsScreenshot = detailsFilename;

          await evaluate(`
            (async () => {
              const dialog = document.getElementById('product-detail-dialog');
              if (!dialog) return;
              dialog.scrollTop = dialog.scrollHeight;
              await new Promise((resolve) => setTimeout(resolve, 180));
            })()
          `);
          const watchScreenshot = await send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: false
          });
          const watchFilename = `product-detail-watch-${viewport.name}.png`;
          writeFileSync(new URL(watchFilename, outputDirectory), Buffer.from(watchScreenshot.data, 'base64'));
          entry.watchScreenshot = watchFilename;
          const watchSelectOpened = await evaluate(`
            (async () => {
              const trigger = document.querySelector('#product-alert-form select[name="alertType"]')
                ?.closest('.fc-select')?.querySelector('.fc-select__button');
              if (!trigger) return false;
              trigger.click();
              await new Promise((resolve) => setTimeout(resolve, 180));
              return trigger.getAttribute('aria-expanded') === 'true';
            })()
          `);
          if (watchSelectOpened) {
            const watchSelectScreenshot = await send('Page.captureScreenshot', {
              format: 'png',
              fromSurface: true,
              captureBeyondViewport: false
            });
            const watchSelectFilename = `product-detail-watch-select-${viewport.name}.png`;
            writeFileSync(new URL(watchSelectFilename, outputDirectory), Buffer.from(watchSelectScreenshot.data, 'base64'));
            entry.watchSelectScreenshot = watchSelectFilename;
          }
          await evaluate(`document.getElementById('product-detail-dialog')?.close()`);
        }

        const sparseDetailsOpened = await evaluate(`
          (async () => {
            const sparseCard = [...document.querySelectorAll('.product-card')]
              .find((card) => card.querySelector('.product-name')?.textContent.includes('Avant Fragrance World'));
            const trigger = sparseCard?.querySelector('[data-product-details]');
            if (!trigger) return false;
            trigger.click();
            await new Promise((resolve) => setTimeout(resolve, 250));
            return document.getElementById('product-detail-dialog')?.open === true;
          })()
        `);
        if (sparseDetailsOpened) {
          const sparseDetailsScreenshot = await send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: false
          });
          const sparseDetailsFilename = `product-detail-sparse-${viewport.name}.png`;
          writeFileSync(new URL(sparseDetailsFilename, outputDirectory), Buffer.from(sparseDetailsScreenshot.data, 'base64'));
          entry.sparseDetailsScreenshot = sparseDetailsFilename;
          await evaluate(`document.getElementById('product-detail-dialog')?.close()`);
        }
      }

      report.push(entry);
    }
  }
} finally {
  writeFileSync(new URL('review-report.json', outputDirectory), JSON.stringify({
    generatedAt: new Date().toISOString(),
    siteOrigin,
    browserExceptions,
    browserLogs,
    pages: report
  }, null, 2));
  socket.close();
  await fetch(`${cdpOrigin}/json/close/${target.id}`).catch(() => {});
}

// Mobile emulation can report a 1–2 CSS pixel visual-viewport offset after a
// long automated scroll even when the layout viewport is reset to the top.
const failures = report.filter((entry) => entry.overflow || entry.mainLandmarks !== 1 || Math.abs(entry.scrollY) > 2);
const supportPaths = new Set(['/contact.html', '/customer-service.html', '/faq.html', '/size-guide.html', '/privacy-policy.html', '/terms-of-service.html']);
const supportFailures = report.filter((entry) => supportPaths.has(entry.page)
  && (entry.supportNavigationLinks !== 0 || entry.currentSupportLinks !== 0));
const headerAlignmentFailures = report.filter((entry) => entry.viewport.name === 'desktop'
  && entry.headerLinkTops.length > 1
  && (Math.max(...entry.headerLinkTops) - Math.min(...entry.headerLinkTops)) > 1);
const expectedFallbackRetailers = ['7287203', '1024283', '904674', '7563286'];
const fallbackFailures = supplementalFailure
  ? report.filter((entry) => entry.page === '/' && (
      entry.compactFallbackSections < 1
      || entry.retailerFallbackDirectory !== 1
      || expectedFallbackRetailers.some((id) => !entry.retailerIds.includes(id))
      || !entry.marketplaceLabels.some((text) => /general marketplace/i.test(text))
    ))
  : [];
const browserErrors = browserLogs.filter((entry) => entry.level === 'error');
if (browserExceptions.length || browserErrors.length || failures.length || supportFailures.length || headerAlignmentFailures.length || fallbackFailures.length) {
  throw new Error(`Page review found ${browserExceptions.length} browser exception(s), ${browserErrors.length} browser error(s), ${failures.length} layout failure(s), ${supportFailures.length} support-navigation failure(s), ${headerAlignmentFailures.length} header-alignment failure(s), and ${fallbackFailures.length} fallback failure(s).`);
}

console.log(`Captured ${report.length} full-page screenshots in ${fileURLToPath(outputDirectory)}`);
