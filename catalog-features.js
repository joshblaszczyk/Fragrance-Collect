(() => {
    'use strict';

    const catalog = window.FragranceCatalog;
    if (!catalog) return;

    const dialog = document.getElementById('product-detail-dialog');
    const dialogContent = document.getElementById('product-detail-content');
    const dealsList = document.getElementById('deals-list');
    const dealsStatus = document.getElementById('deals-status');
    const retailerDirectory = document.getElementById('retailer-directory');
    const apiBase = catalog.getApiEndpoint().replace(/\/$/, '');
    const accountApiBase = String(window.API_BASE || apiBase).replace(/\/$/, '');
    const detailImageFallback = new URL('assets/images/fragrance-placeholder.svg', window.location.href).href;
    const retailerDirectoryCacheKey = 'fragrance_collect_retailer_directory_v1';
    const retailerDirectoryCacheMaxAge = 7 * 24 * 60 * 60 * 1000;
    // This small fallback is intentionally limited to program identity and the
    // latest observed Product Search availability. Live /api/advertisers data
    // replaces its relationship status whenever that endpoint is available.
    const joinedRetailerSnapshot = Object.freeze([
        { id: '7287203', name: 'FragranceShop.com', kind: 'fragrance', searchableCatalog: true },
        { id: '1024283', name: 'FragranceX.com', kind: 'fragrance', searchableCatalog: true },
        { id: '904674', name: 'Perfumania.com', kind: 'fragrance', searchableCatalog: false },
        { id: '7563286', name: 'TikTok Shop US', kind: 'marketplace', searchableCatalog: false }
    ]);
    let lastDetailTrigger = null;
    let dealsFallbackActive = false;
    let retailerFallbackActive = false;
    let lastRetailerDirectory = [];
    let lastRetailerDirectoryState = 'loading';
    let lastRetailerDirectoryWarning = '';

    const escape = (value) => catalog.escapeHtml(String(value ?? ''));
    const validUrl = (value) => catalog.validateUrl(String(value || ''));
    const apiUrl = (path) => `${apiBase}${path}`;
    const formatMoney = (amount, currency = 'USD') => {
        const value = Number(amount);
        if (!Number.isFinite(value)) return 'Not listed';
        try {
            return new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency: /^[A-Z]{3}$/.test(currency) ? currency : 'USD'
            }).format(value);
        } catch {
            return `${value.toFixed(2)} ${currency}`;
        }
    };
    const formatDate = (value, options = { dateStyle: 'medium' }) => {
        if (!value) return '';
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat(undefined, options).format(parsed);
    };
    const label = (value) => String(value || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
        .trim();

    async function apiFetch(path, options = {}) {
        const response = await fetch(apiUrl(path), {
            credentials: 'include',
            headers: { Accept: 'application/json', ...(options.headers || {}) },
            ...options
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(payload.error || `Request failed (${response.status})`);
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    async function accountApiFetch(path, options = {}) {
        const response = await fetch(`${accountApiBase}${path}`, {
            credentials: 'include',
            headers: { Accept: 'application/json', ...(options.headers || {}) },
            ...options
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(payload.error || `Request failed (${response.status})`);
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function logOutbound(productId, advertiserId, source) {
        if (!productId) return;
        fetch(`${accountApiBase}/api/outbound-click`, {
            method: 'POST',
            credentials: 'include',
            keepalive: true,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ productId, advertiserId: advertiserId || null, source })
        }).catch(() => {
            // Measurement never blocks or changes the shopping action.
        });
    }

    function dealDateLine(deal) {
        const starts = formatDate(deal.startsAt);
        const ends = formatDate(deal.endsAt);
        if (starts && ends) return `${starts} – ${ends}`;
        if (ends) return `Ends ${ends}`;
        if (starts) return `Started ${starts}`;
        return 'Confirm timing with retailer';
    }

    function renderDeals(deals) {
        dealsList.replaceChildren();
        const usable = deals.filter((deal) => validUrl(deal.clickUrl)).slice(0, 8);
        if (!usable.length) {
            return renderDealsFallback('No verified promotion links are currently listed.');
        }

        dealsFallbackActive = false;
        dealsList.closest('.deals-section')?.classList.remove('has-compact-fallback');
        dealsStatus?.classList.remove('visually-hidden');

        for (const deal of usable) {
            const article = document.createElement('article');
            article.className = 'deal-row';
            const clickUrl = validUrl(deal.clickUrl);
            const type = label(deal.promotionType || deal.linkType || 'Retailer offer');
            const coupon = deal.couponCode ? String(deal.couponCode).slice(0, 100) : '';
            article.innerHTML = `
                <div class="deal-retailer">
                    <span class="deal-initial" aria-hidden="true">${escape(deal.advertiserName?.charAt(0) || 'R')}</span>
                    <div><p>${escape(deal.advertiserName || 'Retail partner')}</p><span>${escape(type)}</span></div>
                </div>
                <div class="deal-copy">
                    <h3>${escape(deal.name || deal.eventName || 'Current retailer promotion')}</h3>
                    ${deal.description ? `<p>${escape(deal.description)}</p>` : ''}
                    <span class="deal-dates">${escape(dealDateLine(deal))}</span>
                </div>
                <div class="deal-action">
                    ${coupon ? `<button type="button" class="coupon-copy" data-coupon="${escape(coupon)}"><span>Code</span><strong>${escape(coupon)}</strong></button>` : '<span class="deal-no-code">No code listed</span>'}
                    <a href="${escape(clickUrl)}" target="_blank" rel="nofollow sponsored noopener" data-deal-outbound="${escape(deal.id)}" data-advertiser-id="${escape(deal.advertiserId || '')}">View terms <i class="fas fa-arrow-right" aria-hidden="true"></i></a>
                </div>`;
            dealsList.appendChild(article);
        }
        return usable.length;
    }

    function currentSaleProducts() {
        return (catalog.getProducts?.() || [])
            .filter((product) => Number.isFinite(product.price)
                && Number.isFinite(product.regularPrice)
                && product.regularPrice > product.price
                && validUrl(product.buyUrl))
            .sort((a, b) => ((b.regularPrice - b.price) / b.regularPrice) - ((a.regularPrice - a.price) / a.regularPrice))
            .slice(0, 4);
    }

    function renderDealsFallback(reason = 'The partner promotion feed is temporarily unavailable.') {
        const saleProducts = currentSaleProducts();
        dealsFallbackActive = true;
        dealsList.closest('.deals-section')?.classList.add('has-compact-fallback');
        dealsStatus?.classList.add('visually-hidden');
        dealsList.replaceChildren();

        if (saleProducts.length) {
            const heading = document.createElement('div');
            heading.className = 'fallback-intro';
            heading.innerHTML = `<p class="fallback-kicker">Catalog fallback</p><h3>Current price reductions</h3><p>${escape(reason)} These are verified product-feed prices, not coupon claims.</p>`;
            dealsList.appendChild(heading);
            for (const product of saleProducts) {
                const savings = Math.round(((product.regularPrice - product.price) / product.regularPrice) * 100);
                const article = document.createElement('article');
                article.className = 'deal-row deal-row--catalog';
                article.innerHTML = `
                    <div class="deal-retailer"><span class="deal-initial" aria-hidden="true">${escape((product.advertiser || 'R').charAt(0))}</span><div><p>${escape(product.advertiser || 'Retail partner')}</p><span>Product-feed price</span></div></div>
                    <div class="deal-copy"><h3>${escape(product.name)}</h3><p>${escape(formatMoney(product.price, product.currency))} · was ${escape(formatMoney(product.regularPrice, product.currency))}</p></div>
                    <div class="deal-action"><span class="catalog-saving">${escape(savings)}% lower</span><a href="${escape(validUrl(product.buyUrl))}" target="_blank" rel="nofollow sponsored noopener" data-outbound-product="${escape(product.sourceProductId || product.id)}">Check price <i class="fas fa-arrow-right" aria-hidden="true"></i></a></div>`;
                dealsList.appendChild(article);
            }
            return 0;
        }

        dealsList.innerHTML = `
            <div class="catalog-fallback-panel" role="status">
                <span class="fallback-icon" aria-hidden="true"><i class="fas fa-tag"></i></span>
                <div><p class="fallback-kicker">Catalog still available</p><h3>Promotions are taking a pause</h3><p>${escape(reason)} Live fragrance listings and retailer prices remain available above.</p></div>
                <div class="fallback-actions"><a href="#shop">Browse offers</a><button type="button" data-retry-deals>Retry promotions</button></div>
            </div>`;
        return 0;
    }

    async function loadDeals() {
        if (!dealsList) return;
        try {
            const data = await apiFetch('/api/deals');
            const count = renderDeals(Array.isArray(data.deals) ? data.deals : []);
            if (dealsStatus) {
                const freshness = formatDate(data.updatedAt, { dateStyle: 'medium', timeStyle: 'short' });
                dealsStatus.textContent = count
                    ? `${count} current promotion${count === 1 ? '' : 's'}${freshness ? ` · updated ${freshness}` : ''}${data.stale ? ' · showing the last successful update' : ''}`
                    : 'No current partner promotions found.';
            }
        } catch {
            renderDealsFallback();
            if (dealsStatus) dealsStatus.textContent = 'Promotion feed temporarily unavailable; the catalog remains available.';
        } finally {
            dealsList.removeAttribute('aria-busy');
            dealsList.setAttribute('aria-busy', 'false');
        }
    }

    function retailersFromCatalog() {
        const unique = new Map();
        for (const product of catalog.getProducts?.() || []) {
            const name = String(product.advertiser || '').trim();
            if (!name || name === 'Unknown retailer') continue;
            const key = String(product.advertiserId || name).toLowerCase();
            if (!unique.has(key)) unique.set(key, {
                id: product.advertiserId || key,
                name,
                category: { child: 'Current fragrance listing' },
                relationshipStatus: 'Currently listed',
                hasCurrentCatalogOffer: true
            });
        }
        return [...unique.values()];
    }

    function retailerKind(advertiser) {
        const snapshot = joinedRetailerSnapshot.find((entry) => entry.id === String(advertiser.id || ''));
        if (snapshot?.kind) return snapshot.kind;
        const category = `${advertiser.category?.parent || ''} ${advertiser.category?.child || ''}`;
        const evidence = `${advertiser.name || ''} ${category}`.toLowerCase();
        if (/\b(?:marketplace|marketplaces|virtual malls?|tiktok shop)\b/.test(evidence)) return 'marketplace';
        if (/\b(?:fragrance|perfume|perfumery|beauty)\b/.test(evidence)) return 'fragrance';
        return 'general';
    }

    function mergeRetailers(advertisers) {
        const merged = new Map();
        const aliases = new Map();
        const add = (advertiser, source) => {
            const name = String(advertiser?.name || advertiser?.advertiser || '').trim();
            const id = String(advertiser?.id || advertiser?.advertiserId || '').trim();
            if (!name) return;
            const idKey = id ? `id:${id}` : '';
            const nameKey = `name:${name.toLowerCase()}`;
            const existingKey = (idKey && aliases.get(idKey)) || aliases.get(nameKey) || idKey || nameKey;
            const existing = merged.get(existingKey) || {};
            const next = {
                ...existing,
                ...advertiser,
                id: id || existing.id || '',
                name,
                fromSnapshot: existing.fromSnapshot || source === 'snapshot',
                fromDirectory: existing.fromDirectory || source === 'directory',
                fromCatalog: existing.fromCatalog || source === 'catalog',
                hasCurrentCatalogOffer: existing.hasCurrentCatalogOffer
                    || advertiser.hasCurrentCatalogOffer === true
                    || source === 'catalog'
            };
            merged.set(existingKey, next);
            if (idKey) aliases.set(idKey, existingKey);
            aliases.set(nameKey, existingKey);
        };

        joinedRetailerSnapshot.forEach((advertiser) => add(advertiser, 'snapshot'));
        (Array.isArray(advertisers) ? advertisers : []).forEach((advertiser) => add(advertiser, 'directory'));
        retailersFromCatalog().forEach((advertiser) => add(advertiser, 'catalog'));

        return [...merged.values()]
            .map((advertiser) => ({ ...advertiser, kind: retailerKind(advertiser) }))
            .sort((left, right) => {
                const priority = { fragrance: 0, general: 1, marketplace: 2 };
                return (priority[left.kind] ?? 1) - (priority[right.kind] ?? 1)
                    || left.name.localeCompare(right.name);
            });
    }

    function retailerCatalogState(advertiser) {
        if (advertiser.hasCurrentCatalogOffer) return 'available';
        if (typeof advertiser.searchableCatalog === 'boolean') {
            return advertiser.searchableCatalog ? 'available' : 'unavailable';
        }
        if (typeof advertiser.catalogAvailable === 'boolean') {
            return advertiser.catalogAvailable ? 'available' : 'unavailable';
        }
        if (typeof advertiser.productFeedAvailable === 'boolean') {
            return advertiser.productFeedAvailable ? 'available' : 'unavailable';
        }
        return 'unconfirmed';
    }

    function retailerStatus(advertiser) {
        const catalogState = retailerCatalogState(advertiser);
        if (advertiser.fromDirectory) {
            if (catalogState === 'available') return { state: catalogState, text: 'Joined · searchable catalog' };
            if (catalogState === 'unavailable') return { state: catalogState, text: 'Joined · searchable catalog unavailable' };
            return { state: catalogState, text: 'Joined · catalog status unconfirmed' };
        }
        if (advertiser.fromCatalog) return { state: 'available', text: 'Current catalog retailer' };
        if (catalogState === 'unavailable') return { state: catalogState, text: 'Joined snapshot · catalog unavailable' };
        if (catalogState === 'available') return { state: catalogState, text: 'Joined snapshot · catalog reported' };
        return { state: 'unconfirmed', text: 'Program snapshot · live status unavailable' };
    }

    function retailerTypeLabel(advertiser) {
        if (advertiser.kind === 'marketplace') return 'General marketplace · fragrance offers only';
        if (advertiser.kind === 'fragrance') return 'Fragrance specialist';
        return advertiser.category?.child || advertiser.category?.parent || 'Retail partner';
    }

    function retailerDirectorySummary(retailers, state, warning = '') {
        const liveCount = retailers.filter((retailer) => retailer.fromDirectory).length;
        const catalogCount = retailers.filter((retailer) => retailerCatalogState(retailer) === 'available').length;
        let text;
        if (state === 'live') {
            text = `${liveCount} active joined program${liveCount === 1 ? '' : 's'} · ${catalogCount} with a searchable catalog or current offer.`;
        } else if (state === 'stale' || state === 'cached') {
            text = 'Showing the last available joined-program directory plus retailers in the current catalog.';
        } else if (state === 'empty') {
            text = 'The live directory returned no active programs. Showing the configured program snapshot and current catalog retailers.';
        } else {
            text = 'Live directory unavailable. Showing the configured joined-program snapshot and current catalog retailers.';
        }
        return warning ? `${text} ${warning}` : text;
    }

    function renderRetailers(advertisers, { state = 'live', warning = '' } = {}) {
        retailerDirectory.replaceChildren();
        const retailers = mergeRetailers(advertisers);

        if (!retailers.length) return renderRetailerEmpty();

        retailerFallbackActive = state !== 'live';
        retailerDirectory.closest('.retailers-section')?.classList.remove('has-compact-fallback');

        const summary = document.createElement('p');
        summary.className = `retailer-directory-summary${state === 'live' ? '' : ' is-fallback'}`;
        summary.setAttribute('role', 'status');
        summary.textContent = retailerDirectorySummary(retailers, state, warning);
        retailerDirectory.appendChild(summary);

        const list = document.createElement('ul');
        list.className = 'retailer-list';
        for (const advertiser of retailers) {
            const item = document.createElement('li');
            const status = retailerStatus(advertiser);
            item.className = `retailer-item retailer-item--${advertiser.kind}`;
            item.dataset.advertiserId = advertiser.id || '';
            item.innerHTML = `
                <span class="retailer-monogram" aria-hidden="true">${escape(advertiser.name.charAt(0))}</span>
                <span class="retailer-name"><strong>${escape(advertiser.name)}</strong><small>${escape(retailerTypeLabel(advertiser))}</small></span>
                <span class="retailer-status is-${escape(status.state)}"><i aria-hidden="true"></i>${escape(status.text)}</span>`;
            list.appendChild(item);
        }
        retailerDirectory.appendChild(list);
        return retailers.length;
    }

    function renderRetailerEmpty() {
        retailerFallbackActive = true;
        retailerDirectory.closest('.retailers-section')?.classList.add('has-compact-fallback');
        retailerDirectory.innerHTML = `
            <div class="catalog-fallback-panel catalog-fallback-panel--retailers" role="status">
                <span class="fallback-icon" aria-hidden="true"><i class="fas fa-store"></i></span>
                <div><p class="fallback-kicker">Retailer transparency</p><h3>No retailer records available</h3><p>The catalog can still be browsed, and every available product card identifies its fulfilling store.</p></div>
                <div class="fallback-actions"><a href="#shop">Browse named retailers</a><button type="button" data-retry-retailers>Retry directory</button></div>
            </div>`;
        return 0;
    }

    function cacheRetailerDirectory(advertisers, updatedAt) {
        try {
            localStorage.setItem(retailerDirectoryCacheKey, JSON.stringify({
                advertisers,
                updatedAt: updatedAt || new Date().toISOString(),
                cachedAt: Date.now()
            }));
        } catch {
            // Storage is optional; the configured snapshot remains available.
        }
    }

    function readCachedRetailerDirectory() {
        try {
            const cached = JSON.parse(localStorage.getItem(retailerDirectoryCacheKey) || 'null');
            if (!cached || !Array.isArray(cached.advertisers)) return null;
            if (!Number.isFinite(cached.cachedAt) || Date.now() - cached.cachedAt > retailerDirectoryCacheMaxAge) return null;
            return cached;
        } catch {
            return null;
        }
    }

    function renderRetailerFallback() {
        renderRetailers(lastRetailerDirectory, {
            state: lastRetailerDirectoryState,
            warning: lastRetailerDirectoryWarning
        });
    }

    async function loadRetailers() {
        if (!retailerDirectory) return;
        try {
            const data = await apiFetch('/api/advertisers');
            lastRetailerDirectory = Array.isArray(data.advertisers) ? data.advertisers : [];
            lastRetailerDirectoryState = data.stale ? 'stale' : lastRetailerDirectory.length ? 'live' : 'empty';
            lastRetailerDirectoryWarning = String(data.warning || '').trim();
            if (lastRetailerDirectory.length) cacheRetailerDirectory(lastRetailerDirectory, data.updatedAt);
            renderRetailerFallback();
        } catch {
            const cached = readCachedRetailerDirectory();
            lastRetailerDirectory = cached?.advertisers || [];
            lastRetailerDirectoryState = cached ? 'cached' : 'snapshot';
            lastRetailerDirectoryWarning = '';
            renderRetailerFallback();
        } finally {
            retailerDirectory.removeAttribute('aria-busy');
            retailerDirectory.setAttribute('aria-busy', 'false');
        }
    }

    function shippingSummary(product) {
        if (product.shippingCost === 0 || product.freeShippingVerified === true) return 'Free shipping reported by retailer feed';
        if (typeof product.shippingCost === 'number' && Number.isFinite(product.shippingCost)) {
            return `${formatMoney(product.shippingCost, product.shippingCurrency || product.currency)} shipping`;
        }
        return '';
    }

    function deliverySummary(product) {
        const timing = product.shippingTiming || {};
        const readTiming = (value) => {
            if (value === null || value === undefined || value === '') return null;
            const number = Number(value);
            return Number.isFinite(number) && number >= 0 ? number : null;
        };
        const handlingMin = readTiming(timing.minimumHandlingTime);
        const handlingMax = readTiming(timing.maximumHandlingTime);
        const transitMin = readTiming(timing.minimumTransitTime);
        const transitMax = readTiming(timing.maximumTransitTime);
        const valid = [handlingMin, handlingMax, transitMin, transitMax].some((value) => value !== null);
        if (!valid) return '';
        const low = (handlingMin ?? 0) + (transitMin ?? 0);
        const high = (handlingMax ?? handlingMin ?? 0) + (transitMax ?? transitMin ?? 0);
        return `${low}${high !== low ? `–${high}` : ''} business days estimated from feed data`;
    }

    function hasDetailValue(value) {
        if (value === null || value === undefined) return false;
        if (Array.isArray(value)) return value.some(hasDetailValue);
        if (typeof value === 'number') return Number.isFinite(value);
        const normalized = String(value).trim().toLowerCase();
        return Boolean(normalized)
            && !['unknown', 'unknown brand', 'unknown retailer', 'not listed', 'not provided', 'n/a', 'na'].includes(normalized);
    }

    function productFactEntries(product) {
        const size = (Array.isArray(product.size) ? product.size.find(hasDetailValue) : '')
            || (hasDetailValue(product.unitPricingMeasure) ? product.unitPricingMeasure : '');
        const delivery = deliverySummary(product);
        return [
            ...(hasDetailValue(product.availability) ? [['Availability', label(product.availability)]] : []),
            ...(hasDetailValue(size) ? [['Size', size]] : []),
            ...(product.fragranceConcentration ? [['Concentration', product.fragranceConcentration]] : []),
            ...(product.fragranceForm ? [['Format', product.fragranceForm]] : []),
            ...(product.audience?.length ? [['Audience', product.audience.join(', ')]] : []),
            ...(product.presentation && product.presentation !== 'Single bottle' ? [['Presentation', product.presentation]] : []),
            ...(product.gtin ? [['GTIN / UPC / EAN', product.gtin]] : []),
            ...(!product.gtin && product.mpn ? [['Manufacturer number', product.mpn]] : []),
            ...(hasDetailValue(product.sourceProductId) ? [['Retailer product ID', product.sourceProductId]] : []),
            ...(hasDetailValue(product.condition) ? [['Condition', label(product.condition)]] : []),
            ...(hasDetailValue(product.shipsFromCountry || product.advertiserCountry) ? [['Ships from', product.shipsFromCountry || product.advertiserCountry]] : []),
            ...(hasDetailValue(delivery) ? [['Delivery', delivery]] : []),
            ...(formatDate(product.lastUpdated) ? [['Last feed update', formatDate(product.lastUpdated)]] : [])
        ].filter(([, value]) => hasDetailValue(value));
    }

    function productFacts(entries) {
        return entries.map(([name, value]) => `<div><dt>${escape(name)}</dt><dd>${escape(value)}</dd></div>`).join('');
    }

    function detailSignature(value) {
        return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function comparisonMarkup(product) {
        const offers = Array.isArray(product.comparison) ? product.comparison : [];
        const evidence = product.matchConfidence === 'exact' && product.gtin
            ? `<p class="comparison-evidence is-exact"><strong>Exact identifier match</strong><span>Compared using GTIN ${escape(product.gtin || '')}.</span></p>`
            : product.matchConfidence === 'high' && product.mpn
                ? `<p class="comparison-evidence is-high"><strong>Manufacturer match</strong><span>Compared using brand and MPN ${escape(product.mpn || '')}.</span></p>`
                : product.matchConfidence === 'retailer' && product.sourceProductId
                    ? `<p class="comparison-evidence is-retailer"><strong>Retailer-scoped identity</strong><span>SKU ${escape(product.sourceProductId || '')} is stable for this retailer’s history and watches, but is not used to merge another store’s listing.</span></p>`
                : '';
        if (offers.length < 2) return '';
        const showShipping = offers.every((offer) => typeof offer.shippingCost === 'number');
        const rows = offers.map((offer) => {
            const url = validUrl(offer.buyUrl);
            return `<tr>
                <th scope="row">${escape(offer.advertiser || 'Retail partner')}</th>
                <td>${escape(formatMoney(offer.price, offer.currency))}</td>
                ${showShipping ? `<td>${escape(offer.shippingCost === 0 ? 'Free' : formatMoney(offer.shippingCost, offer.shippingCurrency || offer.currency))}</td>` : ''}
                <td>${url ? `<a href="${escape(url)}" target="_blank" rel="nofollow sponsored noopener" data-comparison-outbound="${escape(offer.sourceProductId || offer.id)}" data-advertiser-id="${escape(offer.advertiserId || '')}">Visit</a>` : 'Unavailable'}</td>
            </tr>`;
        }).join('');
        return `${evidence}<div class="comparison-table-wrap"><table class="comparison-table"><thead><tr><th>Retailer</th><th>Price</th>${showShipping ? '<th>Shipping</th>' : ''}<th><span class="visually-hidden">Action</span></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    function galleryMarkup(product) {
        const images = [product.image, ...(product.additionalImages || [])]
            .map(validUrl)
            .filter((url, index, all) => url && all.indexOf(url) === index)
            .slice(0, 6);
        if (!images.length) return '<div class="detail-image-fallback">Image unavailable</div>';
        const thumbnails = images.length > 1 ? `<div class="detail-thumbnails" aria-label="Product images">${images.map((url, index) => `<button type="button" data-detail-image="${escape(url)}" class="${index === 0 ? 'is-active' : ''}" aria-label="Show product image ${index + 1}" aria-pressed="${index === 0}"><img src="${escape(url)}" alt="" width="84" height="84" loading="lazy"></button>`).join('')}</div>` : '';
        return `<div class="detail-image-stage"><img id="detail-primary-image" src="${escape(images[0])}" alt="${escape(product.name)}" width="720" height="720" decoding="async"></div>${thumbnails}`;
    }

    async function changeDetailImage(thumbnail) {
        const currentImage = document.getElementById('detail-primary-image');
        const stage = currentImage?.closest('.detail-image-stage');
        const requestedUrl = validUrl(thumbnail.dataset.detailImage);
        if (!currentImage || !stage || !requestedUrl || stage.dataset.transitioning === 'true') return;

        const nextUrl = new URL(requestedUrl, window.location.href).href;
        const buttons = [...thumbnail.parentElement.querySelectorAll('button')];
        if (currentImage.src === nextUrl) {
            buttons.forEach((button) => {
                const selected = button === thumbnail;
                button.classList.toggle('is-active', selected);
                button.setAttribute('aria-pressed', String(selected));
            });
            return;
        }

        stage.dataset.transitioning = 'true';
        const nextImage = new Image();
        nextImage.src = nextUrl;
        nextImage.alt = currentImage.alt;
        nextImage.width = currentImage.width;
        nextImage.height = currentImage.height;
        nextImage.className = 'detail-image-incoming';
        nextImage.decoding = 'async';

        try {
            await nextImage.decode();
            if (!currentImage.isConnected) return;
            stage.appendChild(nextImage);
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            currentImage.classList.add('is-leaving');
            nextImage.classList.add('is-visible');
            await new Promise((resolve) => setTimeout(resolve, 300));
            currentImage.remove();
            nextImage.id = 'detail-primary-image';
            nextImage.classList.remove('detail-image-incoming', 'is-visible');
            buttons.forEach((button) => {
                const selected = button === thumbnail;
                button.classList.toggle('is-active', selected);
                button.setAttribute('aria-pressed', String(selected));
            });
        } catch {
            nextImage.remove();
        } finally {
            delete stage.dataset.transitioning;
        }
    }

    function renderProductDetail(product) {
        const buyUrl = validUrl(product.buyUrl);
        const currentPrice = formatMoney(product.price, product.currency);
        const shipping = shippingSummary(product);
        const regular = typeof product.regularPrice === 'number' && product.regularPrice > product.price
            ? `<del>${escape(formatMoney(product.regularPrice, product.currency))}</del>` : '';
        const saleWindow = product.saleEndsAt ? `Offer end listed as ${formatDate(product.saleEndsAt)}` : '';
        const highlights = (product.highlights || []).filter(hasDetailValue).slice(0, 6);
        const factEntries = productFactEntries(product);
        const factNames = new Set(factEntries.map(([name]) => detailSignature(name)));
        const factValues = new Set(factEntries.map(([, value]) => detailSignature(value)));
        const specs = (product.specifications || [])
            .filter((spec) => hasDetailValue(spec?.name) && hasDetailValue(spec?.value))
            .filter((spec) => !factNames.has(detailSignature(spec.name)) && !factValues.has(detailSignature(spec.value)))
            .slice(0, 16);
        const countries = (product.serviceableAreas || []).filter(hasDetailValue).slice(0, 12);
        const specsMarkup = specs.length ? `<section><h3>Retailer specifications</h3><dl class="detail-spec-list">${specs.map((spec) => `<div><dt>${escape(spec.name)}</dt><dd>${escape(spec.value)}</dd></div>`).join('')}</dl></section>` : '';
        const aboutSection = product.description || highlights.length
            ? `<section class="product-about-section"><h3>About this listing</h3>${product.description ? `<p>${escape(product.description)}</p>` : ''}${highlights.length ? `<ul class="detail-highlights">${highlights.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>` : ''}</section>`
            : '';
        const facts = productFacts(factEntries);
        const eyebrow = [product.brand, product.advertiser].filter(hasDetailValue).join(' · ');
        const comparison = comparisonMarkup(product);

        dialogContent.innerHTML = `
            <div class="product-detail-grid">
                <div class="product-detail-gallery">${galleryMarkup(product)}</div>
                <div class="product-detail-summary">
                    ${eyebrow ? `<p class="detail-eyebrow">${escape(eyebrow)}</p>` : ''}
                    <h2 id="product-detail-title">${escape(product.name)}</h2>
                    ${hasDetailValue(currentPrice) ? `<div class="detail-price"><strong>${escape(currentPrice)}</strong>${regular}</div>` : ''}
                    ${shipping ? `<p class="detail-shipping">${escape(shipping)}</p>` : ''}
                    ${saleWindow ? `<p class="detail-sale-window">${escape(saleWindow)}</p>` : ''}
                    ${facts ? `<dl class="detail-facts">${facts}</dl>` : ''}
                    ${buyUrl ? `<div class="detail-primary-actions"><a class="detail-retailer-link" href="${escape(buyUrl)}" target="_blank" rel="nofollow sponsored noopener" data-detail-outbound="${escape(product.sourceProductId || product.id)}" data-advertiser-id="${escape(product.advertiserId || '')}">Visit ${escape(hasDetailValue(product.advertiser) ? product.advertiser : 'retailer')} <i class="fas fa-arrow-right" aria-hidden="true"></i></a></div>` : ''}
                    <p class="detail-disclosure">You will complete checkout on the retailer’s site. Confirm price, stock, shipping, authenticity policy, and returns there.</p>
                </div>
            </div>
            <div class="product-detail-sections">
                ${aboutSection}
                ${product.gtin || comparison ? `<section data-comparison-section${comparison ? '' : ' hidden'}><h3>Compare current offers</h3><div id="exact-comparison-content" aria-live="polite">${comparison}</div></section>` : ''}
                ${specsMarkup}
                ${countries.length ? `<section><h3>Delivery coverage</h3><p>${escape(countries.join(', '))}</p></section>` : ''}
                ${product.productKey ? '<section class="product-history-section" hidden><h3>Observed price history</h3><div id="product-history-content"></div></section>' : ''}
                ${product.productKey ? `<section class="product-alert-section">
                    <div class="product-alert-intro">
                        <span class="detail-section-label">Account alerts</span>
                        <h3>Watch this fragrance</h3>
                        <p>Track a price, restock, or new promotion from one place.</p>
                    </div>
                    ${alertMarkup(product)}
                </section>` : ''}
            </div>`;
    }

    function alertMarkup(product) {
        if (!product.productKey) return '<p class="detail-muted">This listing does not include a stable product identifier for watches.</p>';
        if (!catalog.isAuthenticated()) return '<a class="detail-signin-link" href="auth.html?tab=signin"><span>Sign in to create a watch</span><i class="fas fa-arrow-right" aria-hidden="true"></i></a>';
        return `<form id="product-alert-form" class="product-alert-form">
            <label>Watch for<select name="alertType"><option value="price_drop">Price at or below</option><option value="back_in_stock">Back in stock</option><option value="deal">New promotion</option></select></label>
            <label data-target-price-label>Target price<input name="targetPrice" type="number" min="0" max="50000" step="0.01" value="${escape(Number(product.price || 0).toFixed(2))}" required></label>
            <button type="submit">Save watch</button>
            <p class="alert-form-status" role="status" aria-live="polite"></p>
        </form>`;
    }

    async function loadProductHistory(product) {
        const target = document.getElementById('product-history-content');
        if (!target || !product.productKey) {
            return;
        }
        try {
            const data = await accountApiFetch(`/api/product-history?key=${encodeURIComponent(product.productKey)}`);
            const observations = Array.isArray(data.observations) ? data.observations.slice(-12) : [];
            if (!observations.length) {
                return;
            }
            const values = observations.map((item) => Number(item.sale_price ?? item.price)).filter(Number.isFinite);
            if (!values.length) return;
            const min = Math.min(...values);
            const max = Math.max(...values);
            target.innerHTML = `<div class="history-chart" role="img" aria-label="Observed prices from ${escape(formatDate(observations[0].observed_on))} to ${escape(formatDate(observations.at(-1).observed_on))}">${observations.map((item) => {
                const value = Number(item.sale_price ?? item.price);
                const height = max === min ? 58 : 24 + ((max - value) / (max - min)) * 50;
                const level = Math.max(0, Math.min(20, Math.round(height / 5)));
                return `<span class="history-level-${level}" title="${escape(formatDate(item.observed_on))}: ${escape(formatMoney(value, item.currency))}"></span>`;
            }).join('')}</div><div class="history-range"><span>Low ${escape(formatMoney(min, observations.at(-1).currency))}</span><span>High ${escape(formatMoney(max, observations.at(-1).currency))}</span></div>${data.methodology ? `<p class="history-method">${escape(data.methodology)}</p>` : ''}`;
            target.closest('.product-history-section')?.removeAttribute('hidden');
        } catch {
            // Missing history is omitted from the detail view.
        }
    }

    async function loadExactComparisons(product) {
        const target = document.getElementById('exact-comparison-content');
        if (!target || !product.gtin) return;
        try {
            const country = document.getElementById('country-filter')?.value || '';
            const query = new URLSearchParams({ gtin: product.gtin, limit: '50', sortBy: 'price_low' });
            if (country) query.set('country', country);
            const data = await apiFetch(`/api/products?${query.toString()}`);
            const offersByRetailer = new Map();
            for (const item of Array.isArray(data.products) ? data.products : []) {
                const buyUrl = validUrl(item.buyUrl || item.link);
                const price = Number(item.price);
                if (!buyUrl || !Number.isFinite(price)) continue;
                const offer = {
                    id: String(item.id || ''),
                    sourceProductId: String(item.sourceProductId || item.id || ''),
                    advertiserId: String(item.advertiserId || ''),
                    advertiser: String(item.advertiser || 'Retail partner'),
                    price,
                    currency: /^[A-Z]{3}$/.test(item.currency || '') ? item.currency : 'USD',
                    shippingCost: item.shippingCost === null || item.shippingCost === undefined ? null : Number(item.shippingCost),
                    shippingCurrency: /^[A-Z]{3}$/.test(item.shippingCurrency || '') ? item.shippingCurrency : null,
                    availability: String(item.availability || ''),
                    buyUrl
                };
                const key = `${offer.advertiserId || offer.advertiser}\u0000${offer.currency}`;
                const existing = offersByRetailer.get(key);
                if (!existing || offer.price < existing.price) offersByRetailer.set(key, offer);
            }
            const offers = [...offersByRetailer.values()]
                .sort((a, b) => a.currency === b.currency ? a.price - b.price : a.currency.localeCompare(b.currency));
            const markup = comparisonMarkup({ ...product, comparison: offers });
            target.innerHTML = markup;
            if (markup) target.closest('[data-comparison-section]')?.removeAttribute('hidden');
        } catch {
            // Keep the comparison already returned with the catalog search.
        }
    }

    function openProductDetail(productId, trigger) {
        if (!dialog || !dialogContent) return;
        const product = catalog.getProduct(productId);
        if (!product) {
            catalog.showToast('Product details are no longer available on this page.', 'error');
            return;
        }
        lastDetailTrigger = trigger || null;
        dialog.dataset.productId = String(productId || '');
        renderProductDetail(product);
        dialog.showModal();
        document.body.classList.add('has-open-dialog');
        loadProductHistory(product);
        loadExactComparisons(product);
        dialog.querySelector('[data-close-product-dialog]')?.focus();
    }

    function closeProductDetail() {
        if (!dialog?.open) return;
        dialog.close();
        document.body.classList.remove('has-open-dialog');
        lastDetailTrigger?.focus?.();
        lastDetailTrigger = null;
        delete dialog.dataset.productId;
    }

    async function saveAlert(form) {
        const cardButton = lastDetailTrigger;
        const productId = form.closest('#product-detail-dialog')?.dataset.productId
            || cardButton?.dataset.productDetails
            || '';
        const product = catalog.getProduct(productId);
        const status = form.querySelector('.alert-form-status');
        if (!product?.productKey) return;
        const formData = new FormData(form);
        const alertType = formData.get('alertType');
        const targetPrice = alertType === 'price_drop' ? Number(formData.get('targetPrice')) : null;
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        status.textContent = 'Saving watch…';
        try {
            await accountApiFetch('/api/user/alerts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    productKey: product.productKey,
                    productName: product.name,
                    alertType,
                    targetPrice,
                    currency: product.currency,
                    country: product.targetCountry || null
                })
            });
            status.textContent = 'Watch saved. Active watches are checked on the scheduled CJ refresh.';
            catalog.showToast('Watch saved.', 'success');
        } catch (error) {
            if (error.status === 401) {
                window.location.href = 'auth.html?tab=signin';
                return;
            }
            if (error.status === 404) {
                const localUsingDeployedApi = window.FRAGRANCE_RUNTIME?.localSite
                    && window.FRAGRANCE_RUNTIME?.apiChannel === 'deployed';
                status.textContent = localUsingDeployedApi
                    ? 'This local preview is using the older deployed API, which does not support watches yet.'
                    : 'Watch saving is not available on the current API release yet.';
            } else {
                status.textContent = error.message || 'Could not save this watch.';
            }
        } finally {
            submit.disabled = false;
        }
    }

    document.addEventListener('click', async (event) => {
        if (event.target.closest('[data-retry-deals]')) {
            dealsList.setAttribute('aria-busy', 'true');
            loadDeals();
            return;
        }

        if (event.target.closest('[data-retry-retailers]')) {
            retailerDirectory.setAttribute('aria-busy', 'true');
            loadRetailers();
            return;
        }

        const detailsButton = event.target.closest('[data-product-details]');
        if (detailsButton) {
            openProductDetail(detailsButton.dataset.productDetails, detailsButton);
            return;
        }

        if (event.target.closest('[data-close-product-dialog]')) {
            closeProductDetail();
            return;
        }

        const thumbnail = event.target.closest('[data-detail-image]');
        if (thumbnail) {
            await changeDetailImage(thumbnail);
            return;
        }

        const couponButton = event.target.closest('[data-coupon]');
        if (couponButton) {
            try {
                await navigator.clipboard.writeText(couponButton.dataset.coupon);
                const previous = couponButton.querySelector('span')?.textContent;
                const labelNode = couponButton.querySelector('span');
                if (labelNode) labelNode.textContent = 'Copied';
                setTimeout(() => { if (labelNode) labelNode.textContent = previous; }, 1800);
            } catch {
                catalog.showToast('Select the code and copy it manually.', 'error');
            }
            return;
        }

        const dealLink = event.target.closest('[data-deal-outbound]');
        if (dealLink) logOutbound(`deal:${dealLink.dataset.dealOutbound}`, dealLink.dataset.advertiserId, 'deal');

        const catalogLink = event.target.closest('[data-outbound-product]');
        if (catalogLink) {
            const card = catalogLink.closest('.product-card');
            logOutbound(catalogLink.dataset.outboundProduct, card?.dataset.advertiserId, 'catalog');
        }

        const detailLink = event.target.closest('[data-detail-outbound]');
        if (detailLink) logOutbound(detailLink.dataset.detailOutbound, detailLink.dataset.advertiserId, 'detail');

        const comparisonLink = event.target.closest('[data-comparison-outbound]');
        if (comparisonLink) logOutbound(comparisonLink.dataset.comparisonOutbound, comparisonLink.dataset.advertiserId, 'comparison');
    });

    document.addEventListener('error', (event) => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement)
            || !image.matches('#detail-primary-image, .detail-thumbnails img')
            || image.dataset.fallbackApplied === 'true') return;

        image.dataset.fallbackApplied = 'true';
        image.src = detailImageFallback;
        const thumbnail = image.closest('[data-detail-image]');
        if (thumbnail) thumbnail.dataset.detailImage = detailImageFallback;
    }, true);

    document.addEventListener('change', (event) => {
        if (event.target.matches('#product-alert-form select[name="alertType"]')) {
            const priceLabel = event.target.form.querySelector('[data-target-price-label]');
            priceLabel.hidden = event.target.value !== 'price_drop';
            priceLabel.querySelector('input').required = event.target.value === 'price_drop';
        }
    });

    document.addEventListener('submit', (event) => {
        if (!event.target.matches('#product-alert-form')) return;
        event.preventDefault();
        saveAlert(event.target);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && dialog?.open) {
            if (dialog.querySelector('.fc-select.is-open')) return;
            event.preventDefault();
            closeProductDetail();
        }
    }, true);

    dialog?.addEventListener('click', (event) => {
        if (event.target === dialog) closeProductDetail();
    });
    dialog?.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeProductDetail();
    });
    dialog?.addEventListener('close', () => document.body.classList.remove('has-open-dialog'));

    function loadSupplementalSections() {
        const targets = [
            { element: dealsList, load: loadDeals },
            { element: retailerDirectory, load: loadRetailers }
        ].filter((item) => item.element);
        targets.forEach((item) => item.load());
    }

    document.addEventListener('catalog:updated', () => {
        if (lastRetailerDirectoryState !== 'loading') renderRetailerFallback();
        if (dealsFallbackActive) renderDealsFallback();
    });

    loadSupplementalSections();
})();
