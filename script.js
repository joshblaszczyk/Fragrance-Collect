// Live data only: populated from CJ via Cloudflare Worker

// Feature-specific styles are kept separate and loaded dynamically because the
// catalog markup is shared with other pages.
function injectCatalogFeatureStyles() {
    if (document.querySelector('link[data-catalog-features]')) return;

    const featureStyles = document.createElement('link');
    featureStyles.rel = 'stylesheet';
    featureStyles.href = 'feature-styles.css';
    featureStyles.dataset.catalogFeatures = 'true';
    document.head.appendChild(featureStyles);
}

injectCatalogFeatureStyles();

// Security utilities for XSS prevention
const SecurityUtils = {
  // HTML entity encoding to prevent XSS
  escapeHtml(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  },

  // Validate and sanitize search queries
  validateSearchQuery(query) {
    if (!query || typeof query !== 'string') return '';

    // Remove HTML delimiters; natural fragrance queries can safely retain
    // apostrophes, ampersands, slashes, and multiplication signs.
    let sanitized = query.replace(/[<>\"]/g, '');

    // Keep international house and fragrance names intact. Unicode combining
    // marks are included so both composed (é) and decomposed (e + ◌́) input
    // survive validation, while unsafe delimiters are still removed above.
    sanitized = sanitized.replace(/[^\p{L}\p{M}\p{N}\s\-.,&()'’‘/×]/gu, '');

    // Limit length
    return sanitized.substring(0, 200).trim();
  },

  // Validate numeric inputs
  validateNumber(value, min = 0, max = Infinity, defaultValue = 0) {
    const num = Number(value);
    return isNaN(num) || num < min || num > max ? defaultValue : num;
  },

  // Validate URLs
  validateUrl(url) {
    if (!url || typeof url !== 'string') return '';

    try {
      const urlObj = new URL(url, window.location.origin);
      const isSecureRemoteUrl = urlObj.protocol === 'https:';
      const isSameOriginAsset = urlObj.origin === window.location.origin && ['http:', 'https:'].includes(urlObj.protocol);
      if (!isSecureRemoteUrl && !isSameOriginAsset) return '';
      return urlObj.href;
    } catch {
      return '';
    }
  },

  // Safe DOM manipulation
  setInnerHTML(element, content) {
    if (!element || !content) return;

    // Use textContent for safety, or create safe HTML
    if (typeof content === 'string' && content.includes('<')) {
      // If content contains HTML, sanitize it
      element.innerHTML = this.escapeHtml(content);
    } else {
      element.textContent = content;
    }
  }
};

// Global variables for favorites filtering
let currentFavorites = []; // Store the current favorites data
let isInFavoritesView = false; // Track if we're currently viewing favorites

// ... existing code ...
let currentFilters = {
    brand: '',
    priceRange: '',
    rating: '',
    shipping: '',
    search: '',
    intent: null
};

const SIGNATURE_BRANDS = Object.freeze(['Chanel', 'Creed', 'Dior', 'Tom Ford']);
const BRAND_DISPLAY_ALIASES = new Map([
    ['christian dior', 'Dior'],
    ['christian dior parfums', 'Dior'],
    ['parfums christian dior', 'Dior'],
    ['dior beauty', 'Dior'],
    ['tomford', 'Tom Ford'],
    ['tom ford beauty', 'Tom Ford'],
    ['house of creed', 'Creed'],
    ['creed fragrances', 'Creed'],
    ['chanel paris', 'Chanel'],
    ['ysl', 'Yves Saint Laurent'],
    ['saint laurent', 'Yves Saint Laurent'],
    ['mfk', 'Maison Francis Kurkdjian'],
    ['maison francis kurkdjian paris', 'Maison Francis Kurkdjian'],
    ['d and g', 'Dolce & Gabbana'],
    ['dolce gabbana', 'Dolce & Gabbana']
]);
const knownCatalogBrands = new Map(SIGNATURE_BRANDS.map((brand) => [normalizeBrandKey(brand), brand]));

function normalizeBrandKey(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[-_]+/g, ' ')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function brandFromUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const key = normalizeBrandKey(raw);
    return BRAND_DISPLAY_ALIASES.get(key)
        || knownCatalogBrands.get(key)
        || raw.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function rememberBrand(value) {
    const rawBrand = String(value || '').replace(/\s+/g, ' ').trim();
    const brand = BRAND_DISPLAY_ALIASES.get(normalizeBrandKey(rawBrand)) || rawBrand;
    const key = normalizeBrandKey(brand);
    if (['', 'unknown', 'unknown brand', 'not listed', 'n a'].includes(key)) return '';
    if (key && !knownCatalogBrands.has(key)) knownCatalogBrands.set(key, brand);
    return knownCatalogBrands.get(key) || '';
}

function recognizedBrandOnlySearch(value) {
    const key = normalizeBrandKey(value);
    if (!key) return '';
    return BRAND_DISPLAY_ALIASES.get(key) || knownCatalogBrands.get(key) || '';
}

function canonicalBrandKey(value) {
    const key = normalizeBrandKey(value);
    const canonical = BRAND_DISPLAY_ALIASES.get(key) || knownCatalogBrands.get(key) || value;
    return normalizeBrandKey(canonical);
}

function matchesCatalogBrand(productBrand, brandFilter) {
    if (!brandFilter) return true;
    const requested = canonicalBrandKey(brandFilter);
    return Boolean(requested) && canonicalBrandKey(productBrand) === requested;
}

const SEARCH_INTENT_SLUGS = Object.freeze({
    audience: Object.freeze({ Men: 'men', Women: 'women', Unisex: 'unisex' }),
    concentration: Object.freeze({
        'Extrait de Parfum': 'extrait',
        'Eau de Parfum': 'eau_de_parfum',
        'Eau de Toilette': 'eau_de_toilette',
        'Eau de Cologne': 'eau_de_cologne',
        Parfum: 'parfum',
        'Perfume Oil': 'perfume_oil',
        'Fragrance Mist': 'fragrance_mist'
    }),
    form: Object.freeze({ Spray: 'spray', 'Roll-on': 'roll_on', Splash: 'splash', Solid: 'solid' }),
    presentation: Object.freeze({ Set: 'set', Refill: 'refill', Tester: 'tester', Sample: 'sample', 'Travel size': 'travel_size', Bundle: 'bundle' })
});

// These patterns intentionally consume the complete audience phrase, including
// possessives and plurals. Otherwise a query such as “woman's perfume” leaves
// a stray "'s" behind as a product-name keyword and produces empty results.
const WOMEN_AUDIENCE_TERM = "(?:women(?:'?s)?|woman(?:'?s)?|ladies(?:'s|')?|lady(?:'s)?|females?(?:'s|')?)(?![\\p{L}\\p{N}])";
const MEN_AUDIENCE_TERM = "(?:men(?:'?s)?|man(?:'?s)?|gentlemen(?:'s|')?|gentleman(?:'s)?|males?(?:'s|')?)(?![\\p{L}\\p{N}])";
const SEARCH_AUDIENCE_PATTERNS = Object.freeze({
    unisex: new RegExp(`\\b(?:unisex|gender[ -]?neutral|(?:for\\s+)?${WOMEN_AUDIENCE_TERM}\\s*(?:and|&|\\/)\\s*${MEN_AUDIENCE_TERM}|(?:for\\s+)?${MEN_AUDIENCE_TERM}\\s*(?:and|&|\\/)\\s*${WOMEN_AUDIENCE_TERM})`, 'iu'),
    women: new RegExp(`\\b(?:${WOMEN_AUDIENCE_TERM}|for\\s+her|pour\\s+femme)`, 'iu'),
    men: new RegExp(`\\b(?:${MEN_AUDIENCE_TERM}|for\\s+him|pour\\s+homme)`, 'iu')
});

function normalizeSearchIntentText(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’‘`]/g, "'")
        .replace(/[–—_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function consumeIntentPattern(state, pattern) {
    if (!pattern.test(state.text)) return false;
    state.text = state.text.replace(pattern, ' ');
    return true;
}

function normalizeIntentVolume(amount, unit) {
    const normalizedUnit = String(unit || '').toLowerCase().replace(/[.\s]/g, '');
    let value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > 10_000) return null;
    if (normalizedUnit.includes('oz') || normalizedUnit.includes('ounce')) value *= 29.5735295625;
    else if (normalizedUnit.startsWith('cl') || normalizedUnit.startsWith('centil')) value *= 10;
    else if (normalizedUnit === 'l' || normalizedUnit.startsWith('lit')) value *= 1000;
    const common = [1, 1.5, 2, 3, 5, 7, 7.5, 8, 10, 15, 20, 25, 30, 40, 50, 60, 75, 80, 90, 100, 120, 125, 150, 200, 250, 500, 1000];
    const nearest = common.reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best, common[0]);
    return Math.abs(nearest - value) <= Math.max(0.35, nearest * 0.03) ? nearest : Math.round(value * 100) / 100;
}

function parseSearchVolumeIntent(state) {
    const unit = '(fl\\.?\\s*oz|fluid\\s+ounces?|ounces?|oz|ml|millilit(?:er|re)s?|cl|centilit(?:er|re)s?)';
    const multipack = new RegExp(`\\b(\\d{1,2})\\s*(?:x|×)\\s*(\\d{1,4}(?:\\.\\d{1,3})?)\\s*${unit}\\b`, 'i').exec(state.text);
    const single = multipack ? null : new RegExp(`\\b(\\d{1,4}(?:\\.\\d{1,3})?)\\s*${unit}\\b`, 'i').exec(state.text);
    const match = multipack || single;
    if (!match) return { unitSizeMl: null, packCount: null };
    const packCount = multipack ? Number(match[1]) : null;
    const amount = multipack ? match[2] : match[1];
    const measure = multipack ? match[3] : match[2];
    const unitSizeMl = normalizeIntentVolume(amount, measure);
    if (unitSizeMl === null) return { unitSizeMl: null, packCount: null };
    state.text = state.text.replace(match[0], ' ');
    return { unitSizeMl, packCount: packCount > 1 && packCount <= 50 ? packCount : null };
}

function parseFragranceSearchIntent(query) {
    const rawQuery = String(query || '').trim().slice(0, 120);
    const state = { text: normalizeSearchIntentText(rawQuery) };
    const intent = {
        rawQuery,
        textQuery: '',
        retrievalQuery: '',
        audience: null,
        concentration: null,
        form: null,
        presentation: null,
        unitSizeMl: null,
        packCount: null,
        availability: null,
        shipping: null
    };

    if (consumeIntentPattern(state, SEARCH_AUDIENCE_PATTERNS.unisex)) intent.audience = 'Unisex';
    else if (consumeIntentPattern(state, SEARCH_AUDIENCE_PATTERNS.women)) intent.audience = 'Women';
    else if (consumeIntentPattern(state, SEARCH_AUDIENCE_PATTERNS.men)) intent.audience = 'Men';

    const concentrations = [
        ['Extrait de Parfum', /\b(?:extrait(?:\s+de\s+parfum)?|parfum\s+extract)\b/i],
        ['Eau de Parfum', /\b(?:eau\s+de\s+parfum|edp)\b/i],
        ['Eau de Toilette', /\b(?:eau\s+de\s+toilette|edt)\b/i],
        ['Eau de Cologne', /\b(?:eau\s+de\s+cologne|edc)\b/i],
        ['Perfume Oil', /\b(?:concentrated\s+perfume\s+oil|perfume\s+oil|attar)\b/i],
        ['Fragrance Mist', /\b(?:fragrance|body)\s+mist\b/i],
        ['Parfum', /\bparfum\b/i]
    ];
    for (const [value, pattern] of concentrations) {
        if (consumeIntentPattern(state, pattern)) {
            intent.concentration = value;
            break;
        }
    }

    const presentations = [
        ['Set', /\b(?:\d+\s*(?:pieces?|pcs?)\s+(?:perfume\s+|fragrance\s+)?sets?|(?:gift|discovery|sampler|miniature|perfume|fragrance)\s+(?:gift\s+)?sets?)\b/i],
        ['Refill', /\brefills?\b/i],
        ['Tester', /\btesters?\b/i],
        ['Sample', /\b(?:samples?|decants?|vials?)\b/i],
        ['Travel size', /\b(?:travel|mini(?:ature)?)\s+(?:size|spray|bottle)\b/i],
        ['Bundle', /\bbundles?\b/i]
    ];
    for (const [value, pattern] of presentations) {
        if (consumeIntentPattern(state, pattern)) {
            intent.presentation = value;
            break;
        }
    }

    const forms = [
        ['Roll-on', /\broll[ -]?ons?\b/i],
        ['Solid', /\bsolid\s+perfume\b/i],
        ['Splash', /\bsplash(?:es)?\b/i],
        ['Spray', /\b(?:sprays?|atomisers?|atomizers?|atomiseurs?|vaporisers?|vaporizers?|vaporisateurs?)\b/i]
    ];
    for (const [value, pattern] of forms) {
        if (consumeIntentPattern(state, pattern)) {
            intent.form = value;
            break;
        }
    }

    if (consumeIntentPattern(state, /\b(?:in[ -]?stock|available\s+now)\b/i)) intent.availability = 'IN_STOCK';
    if (consumeIntentPattern(state, /\bfree\s+(?:delivery|shipping)\b/i)) intent.shipping = 'free';
    Object.assign(intent, parseSearchVolumeIntent(state));

    intent.textQuery = state.text
        .replace(/\b(?:perfumes?|fragrances?|scents?|colognes?)\b/gi, ' ')
        .replace(/\b(?:for|with|only)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    intent.retrievalQuery = intent.textQuery || 'fragrance perfume';
    return intent;
}

function hasStructuredSearchIntent(intent) {
    return Boolean(intent && (
        intent.audience || intent.concentration || intent.form || intent.presentation
        || intent.unitSizeMl !== null || intent.packCount !== null
        || intent.availability || intent.shipping
    ));
}

function searchIntentLabelFromSlug(facet, slug) {
    const normalizedSlug = String(slug || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return Object.entries(SEARCH_INTENT_SLUGS[facet] || {})
        .find(([, candidate]) => candidate === normalizedSlug)?.[0] || null;
}

function mergeSearchIntentFromUrl(intent, searchParams) {
    const requestedSize = Number(searchParams.get('sizeMl'));
    const requestedPackCount = Number.parseInt(searchParams.get('packCount') || '', 10);
    const requestedAvailability = normalizeAvailability(searchParams.get('availability'));
    const requestedShipping = String(searchParams.get('shipping') || '').toLowerCase() === 'free' ? 'free' : null;
    return {
        ...intent,
        audience: searchIntentLabelFromSlug('audience', searchParams.get('audience')) || intent.audience,
        concentration: searchIntentLabelFromSlug('concentration', searchParams.get('concentration')) || intent.concentration,
        form: searchIntentLabelFromSlug('form', searchParams.get('form')) || intent.form,
        presentation: searchIntentLabelFromSlug('presentation', searchParams.get('presentation')) || intent.presentation,
        unitSizeMl: Number.isFinite(requestedSize) && requestedSize >= 0.2 && requestedSize <= 10_000
            ? requestedSize
            : intent.unitSizeMl,
        packCount: Number.isInteger(requestedPackCount) && requestedPackCount >= 2 && requestedPackCount <= 50
            ? requestedPackCount
            : intent.packCount,
        availability: ['IN_STOCK', 'PREORDER', 'BACKORDER'].includes(requestedAvailability)
            ? requestedAvailability
            : intent.availability,
        shipping: requestedShipping || intent.shipping
    };
}

function recognizedBrandInSearch(value) {
    const normalized = ` ${normalizeBrandKey(value)} `;
    const candidates = new Map(knownCatalogBrands);
    for (const [alias, canonicalBrand] of BRAND_DISPLAY_ALIASES) {
        candidates.set(normalizeBrandKey(alias), canonicalBrand);
        candidates.set(normalizeBrandKey(canonicalBrand), canonicalBrand);
    }
    return [...candidates.entries()]
        .sort((left, right) => right[0].length - left[0].length)
        .find(([key]) => normalized.includes(` ${key} `))?.[1] || '';
}

function canonicalAudience(values) {
    const labels = new Set((Array.isArray(values) ? values : [values]).map((value) => {
        const normalized = normalizeSearchIntentText(value);
        if (SEARCH_AUDIENCE_PATTERNS.unisex.test(normalized)) return 'Unisex';
        if (new RegExp(`^(?:for\\s+)?${WOMEN_AUDIENCE_TERM}$|^pour\\s+femme$`, 'iu').test(normalized)) return 'Women';
        if (new RegExp(`^(?:for\\s+)?${MEN_AUDIENCE_TERM}$|^pour\\s+homme$`, 'iu').test(normalized)) return 'Men';
        return null;
    }).filter(Boolean));
    if (labels.has('Unisex') || (labels.has('Men') && labels.has('Women'))) return 'Unisex';
    return labels.size === 1 ? [...labels][0] : null;
}

function comparableIntentFacet(value) {
    return normalizeSearchIntentText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function canonicalIntentFacet(facet, value) {
    const normalized = comparableIntentFacet(value);
    if (!normalized) return '';
    const aliases = {
        concentration: {
            edp: 'eau de parfum',
            edt: 'eau de toilette',
            edc: 'eau de cologne',
            extrait: 'extrait de parfum',
            'parfum extract': 'extrait de parfum',
            attar: 'perfume oil',
            'body mist': 'fragrance mist'
        },
        form: {
            rollon: 'roll on',
            atomizer: 'spray',
            'atomizer spray': 'spray',
            atomiser: 'spray',
            'atomiser spray': 'spray',
            vaporizer: 'spray',
            'vaporizer spray': 'spray',
            vaporiser: 'spray'
        },
        presentation: {
            'gift set': 'set',
            'discovery set': 'set',
            'sampler set': 'set',
            'perfume set': 'set',
            'fragrance set': 'set',
            'travel spray': 'travel size',
            miniature: 'travel size',
            decant: 'sample',
            vial: 'sample'
        }
    };
    return aliases[facet]?.[normalized] || normalized;
}

function hasVerifiedFreeShipping(perfume) {
    return perfume?.shippingCost === 0 || perfume?.freeShippingVerified === true;
}

function matchesProductSearchIntent(product, intent) {
    if (!hasStructuredSearchIntent(intent)) return true;
    if (intent.audience && canonicalAudience(product.audience) !== intent.audience) return false;
    if (intent.concentration && canonicalIntentFacet('concentration', product.fragranceConcentration) !== canonicalIntentFacet('concentration', intent.concentration)) return false;
    if (intent.form && canonicalIntentFacet('form', product.fragranceForm) !== canonicalIntentFacet('form', intent.form)) return false;
    if (intent.presentation && canonicalIntentFacet('presentation', product.presentation) !== canonicalIntentFacet('presentation', intent.presentation)) return false;
    if (intent.unitSizeMl !== null) {
        const unitSize = Number(product.unitSizeMl ?? product.canonicalSizeMl);
        const tolerance = Math.max(0.6, intent.unitSizeMl * 0.025);
        if (!Number.isFinite(unitSize) || Math.abs(unitSize - intent.unitSizeMl) > tolerance) return false;
    }
    if (intent.packCount !== null && Number(product.packCount) !== intent.packCount) return false;
    if (intent.availability && String(product.availability || '').toUpperCase().replace(/[ -]+/g, '_') !== intent.availability) return false;
    if (intent.shipping === 'free' && !hasVerifiedFreeShipping(product)) return false;
    return true;
}

function normalizeAvailability(value) {
    return String(value || '').trim().toUpperCase().replace(/[ -]+/g, '_');
}

function equivalentCatalogBrandNames(value) {
    const canonicalKey = canonicalBrandKey(value);
    if (!canonicalKey) return [];
    const names = new Set([value, knownCatalogBrands.get(canonicalKey)]);
    for (const [alias, canonical] of BRAND_DISPLAY_ALIASES) {
        if (canonicalBrandKey(canonical) === canonicalKey) names.add(alias);
    }
    return [...names].filter(Boolean);
}

function matchesExactCatalogText(product, textQuery) {
    const requestedWords = normalizeSearchIntentText(textQuery)
        .replace(/'s\b/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    if (!requestedWords.length) return true;
    const productWords = new Set(normalizeSearchIntentText([
        product.name,
        product.brand,
        product.description,
        ...equivalentCatalogBrandNames(product.brand)
    ].filter(Boolean).join(' ')).replace(/'s\b/g, '').replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean));
    return requestedWords.every((word) => productWords.has(word));
}

function matchesLocalCatalogFilters(product, filters = {}) {
    const rawPrice = Number(product.price);
    const price = Number.isFinite(rawPrice) && filters.currency
        ? currencyConverter.convertSync(rawPrice, product.currency || 'USD', filters.currency)
        : rawPrice;
    if (filters.lowPrice !== null && filters.lowPrice !== undefined
        && (!Number.isFinite(price) || price < Number(filters.lowPrice))) return false;
    if (filters.highPrice !== null && filters.highPrice !== undefined
        && (!Number.isFinite(price) || price > Number(filters.highPrice))) return false;
    if (filters.availability && normalizeAvailability(product.availability) !== normalizeAvailability(filters.availability)) return false;
    if (filters.shipping && filters.shipping !== 'all' && !matchesShipping(product, filters.shipping)) return false;
    if (filters.country) {
        const requestedCountry = String(filters.country).trim().toUpperCase();
        const suppliedCountries = [...(Array.isArray(product.serviceableAreas) ? product.serviceableAreas : []), product.targetCountry]
            .filter(Boolean)
            .map((value) => String(value).trim().toUpperCase());
        if (!suppliedCountries.includes(requestedCountry)) return false;
    }
    if (filters.exactMatch && filters.searchIntent?.textQuery) {
        if (!matchesExactCatalogText(product, filters.searchIntent.textQuery)) return false;
    }
    return true;
}

function searchIntentLabels(intent = currentFilters.intent, brand = currentFilters.brand) {
    const labels = [];
    const canonicalBrand = rememberBrand(brand);
    if (canonicalBrand) labels.push(canonicalBrand);
    for (const value of [intent?.audience, intent?.concentration, intent?.form, intent?.presentation]) {
        if (value && !labels.includes(value)) labels.push(value);
    }
    if (intent?.unitSizeMl !== null && intent?.unitSizeMl !== undefined) {
        const size = Number.isInteger(intent.unitSizeMl) ? intent.unitSizeMl : Math.round(intent.unitSizeMl * 100) / 100;
        labels.push(intent.packCount ? `${intent.packCount} × ${size} mL` : `${size} mL`);
    }
    if (intent?.availability) {
        const availabilityLabels = { IN_STOCK: 'In stock', PREORDER: 'Preorder', BACKORDER: 'Backorder' };
        labels.push(availabilityLabels[normalizeAvailability(intent.availability)] || catalogLabel(intent.availability));
    }
    if (intent?.shipping === 'free') labels.push('Free shipping');
    return labels;
}

function updateSearchIntentStatus(intent = currentFilters.intent, brand = currentFilters.brand) {
    const status = document.getElementById('search-intent-status');
    if (!status) return;
    const labels = searchIntentLabels(intent, brand);
    status.classList.toggle('is-active', labels.length > 0);
    status.textContent = labels.length
        ? `Showing only: ${labels.join(' · ')}.`
        : 'Add a fragrance house or details such as men’s, Eau de Parfum, or 100 mL to filter precisely.';
}

const CATALOG_PRICE_URL_RANGES = Object.freeze({
    '0-50': Object.freeze({ lowPrice: '0', highPrice: '50' }),
    '50-100': Object.freeze({ lowPrice: '50', highPrice: '100' }),
    '100-200': Object.freeze({ lowPrice: '100', highPrice: '200' }),
    '200+': Object.freeze({ lowPrice: '200' })
});
const CATALOG_URL_SORTS = Object.freeze(['featured', 'deals', 'newest', 'price_low', 'price_high', 'trending', 'relevance']);
const CATALOG_URL_AVAILABILITY = Object.freeze(['IN_STOCK', 'PREORDER', 'BACKORDER']);
const CATALOG_FILTER_URL_PARAMS = Object.freeze([
    'lowPrice', 'highPrice', 'shipping', 'availability', 'country', 'sortBy', 'currency', 'exactMatch'
]);

function canonicalCatalogFilterUrlEntries({
    priceRange = 'all',
    shipping = 'all',
    availability = '',
    country = '',
    sortBy = 'featured',
    currency = 'USD',
    exactMatch = false
} = {}) {
    const entries = {};
    const price = CATALOG_PRICE_URL_RANGES[priceRange];
    if (price) Object.assign(entries, price);
    if (shipping === 'free') entries.shipping = 'free';
    if (CATALOG_URL_AVAILABILITY.includes(availability)) entries.availability = availability;
    const normalizedCountry = String(country || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(normalizedCountry)) entries.country = normalizedCountry;
    if (CATALOG_URL_SORTS.includes(sortBy) && sortBy !== 'featured') entries.sortBy = sortBy;
    const normalizedCurrency = String(currency || '').trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(normalizedCurrency) && normalizedCurrency !== 'USD') entries.currency = normalizedCurrency;
    if (exactMatch === true) entries.exactMatch = 'true';
    return entries;
}

function catalogPriceRangeFromUrl(searchParams) {
    const lowPrice = searchParams.get('lowPrice');
    const highPrice = searchParams.get('highPrice');
    return Object.entries(CATALOG_PRICE_URL_RANGES)
        .find(([, range]) => range.lowPrice === lowPrice && (range.highPrice || null) === highPrice)?.[0]
        || 'all';
}

function syncCatalogFilterUrlFromControls() {
    const entries = canonicalCatalogFilterUrlEntries({
        priceRange: document.getElementById('price-range')?.value,
        shipping: document.getElementById('shipping-filter')?.value,
        availability: document.getElementById('availability-filter')?.value,
        country: document.getElementById('country-filter')?.value,
        sortBy: document.getElementById('sort-by-filter')?.value,
        currency: document.getElementById('currency-converter')?.value,
        exactMatch: document.getElementById('exact-match-toggle')?.checked === true
    });
    const url = new URL(window.location.href);
    CATALOG_FILTER_URL_PARAMS.forEach((parameter) => url.searchParams.delete(parameter));
    Object.entries(entries).forEach(([parameter, value]) => url.searchParams.set(parameter, value));
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({ ...window.history.state, catalogFilters: entries }, '', next);
    return entries;
}

function catalogPaginationFromResponse({
    requestedPage = 1,
    requestedLimit = config.RESULTS_PER_PAGE,
    responsePage,
    responseLimit,
    suppliedTotal,
    responseHasMore = false,
    clientVerified = false
} = {}) {
    const page = Number.isInteger(Number(responsePage)) && Number(responsePage) >= 1
        ? Number(responsePage)
        : Math.max(1, Number(requestedPage) || 1);
    const limit = Number.isInteger(Number(responseLimit)) && Number(responseLimit) >= 1
        ? Number(responseLimit)
        : Math.max(1, Number(requestedLimit) || config.RESULTS_PER_PAGE);
    const total = Number(suppliedTotal);
    const hasMore = responseHasMore === true
        || (Number.isFinite(total) && total > page * limit);

    // An older Worker may paginate before applying a newly added browser-side
    // filter. Its broad total cannot be presented as the filtered total, but
    // it is still useful evidence that another page can be checked. Reveal one
    // verified page at a time instead of trapping the shopper on page one.
    const totalPages = clientVerified
        ? Math.max(page, hasMore ? page + 1 : page)
        : Math.max(page, Number.isFinite(total) ? Math.ceil(total / limit) : page);
    return { page, limit, hasMore, totalPages: Math.max(1, totalPages) };
}

function updateBrandUrl(brand, { preserveIntentParams = false, resetSearch = false, resetFilters = false, searchTerm = '' } = {}) {
    const url = new URL(window.location.href);
    if (!preserveIntentParams) {
        for (const parameter of ['audience', 'concentration', 'form', 'presentation', 'sizeMl', 'packCount']) {
            url.searchParams.delete(parameter);
        }
    }
    if (resetFilters) {
        for (const parameter of ['availability', 'shipping', 'country', 'lowPrice', 'highPrice', 'sortBy', 'currency', 'exactMatch']) {
            url.searchParams.delete(parameter);
        }
    }
    if (brand) url.searchParams.set('brand', brand);
    else url.searchParams.delete('brand');
    if (resetSearch) {
        url.searchParams.delete('q');
        url.searchParams.delete('scent');
        url.searchParams.delete('type');
    } else if (searchTerm) {
        url.searchParams.set('q', searchTerm);
        url.searchParams.delete('scent');
        url.searchParams.delete('type');
    }
    url.hash = '#filter';
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({ ...window.history.state, catalogBrand: brand || '' }, '', next);
}

function hydrateCatalogControlsFromUrl(searchParams) {
    const selections = [
        ['availability-filter', searchParams.get('availability'), ['', 'IN_STOCK', 'PREORDER', 'BACKORDER']],
        ['shipping-filter', searchParams.get('shipping'), ['all', 'free']],
        ['country-filter', String(searchParams.get('country') || '').toUpperCase(), ['', 'US', 'CA', 'GB', 'AU']],
        ['sort-by-filter', searchParams.get('sortBy'), ['featured', 'deals', 'newest', 'price_low', 'price_high', 'trending', 'relevance']]
    ];
    selections.forEach(([id, value, allowed]) => {
        const select = document.getElementById(id);
        if (select && value !== null && allowed.includes(value)) select.value = value;
    });
    const priceRange = document.getElementById('price-range');
    if (priceRange) priceRange.value = catalogPriceRangeFromUrl(searchParams);
    const requestedCurrency = String(searchParams.get('currency') || '').toUpperCase();
    const currencySelect = document.getElementById('currency-converter');
    if (currencySelect && [...currencySelect.options].some((option) => option.value === requestedCurrency)) {
        currencySelect.value = requestedCurrency;
        updatePriceRangeLabels(requestedCurrency);
    }
    const exactMatchToggle = document.getElementById('exact-match-toggle');
    if (exactMatchToggle && searchParams.get('exactMatch') === 'true') exactMatchToggle.checked = true;
    window.FragranceSelects?.syncAll();
}

let cjProducts = [];
let filteredPerfumes = [];
let userFavorites = new Set(); // Stores IDs of favorited fragrances
const favoriteProductData = new Map();
const catalogProductData = new Map();
const favoriteViewProductBackups = new Map();
const favoriteViewProductIds = new Set();
const FAVORITE_QUEUE_KEY = 'fragrance_collect_favorite_queue';
const favoriteQueueStorage = getFavoriteQueueStorage();
const FAVORITE_QUEUE_MAX_AGE = 24 * 60 * 60 * 1000;
let pendingFavoriteOperations = new Map();
let favoriteQueueOwner = '';
let activeFavoriteOwner = '';
let favoriteStateRevision = 0;
const favoriteRequestsInFlight = new Set();
userFavorites = reconcileFavoriteIds(userFavorites);
let isOnline = navigator.onLine; // Track online status

function getFavoriteQueueStorage() {
    try {
        const storage = window.localStorage;
        storage.getItem(FAVORITE_QUEUE_KEY);
        return storage;
    } catch {
        return null;
    }
}

function favoriteQueueOwnerFor(user = typeof getCurrentUser === 'function' ? getCurrentUser() : null) {
    const id = user?.id;
    return typeof id === 'string' || typeof id === 'number' ? String(id).trim().slice(0, 128) : '';
}

function clearPendingFavoriteOperations() {
    pendingFavoriteOperations = new Map();
    favoriteQueueOwner = '';
    if (!favoriteQueueStorage) return;
    try {
        favoriteQueueStorage.removeItem(FAVORITE_QUEUE_KEY);
    } catch {
        // A restricted storage area must not block signing out or browsing.
    }
}

function loadPendingFavoriteOperations(owner) {
    if (!favoriteQueueStorage || !owner) return new Map();
    try {
        const savedQueue = JSON.parse(favoriteQueueStorage.getItem(FAVORITE_QUEUE_KEY) || 'null');
        const isCurrentQueue = savedQueue
            && typeof savedQueue === 'object'
            && savedQueue.owner === owner
            && Number.isFinite(savedQueue.savedAt)
            && Date.now() - savedQueue.savedAt >= 0
            && Date.now() - savedQueue.savedAt < FAVORITE_QUEUE_MAX_AGE
            && Array.isArray(savedQueue.operations);
        if (!isCurrentQueue) {
            favoriteQueueStorage.removeItem(FAVORITE_QUEUE_KEY);
            return new Map();
        }

        return new Map(savedQueue.operations.slice(0, 50)
            .map(([fragranceId, operation]) => [normalizeFavoriteId(fragranceId), operation])
            .filter(([fragranceId, operation]) => fragranceId && operation && ['add', 'remove'].includes(operation.type)));
    } catch {
        try {
            favoriteQueueStorage.removeItem(FAVORITE_QUEUE_KEY);
        } catch {
            // Storage can become unavailable after initialization; the in-memory queue still works.
        }
        return new Map();
    }
}

function ensureFavoriteQueueOwner() {
    const owner = favoriteQueueOwnerFor();
    if (!owner) {
        if (activeFavoriteOwner || favoriteQueueOwner || pendingFavoriteOperations.size) {
            transitionFavoriteAccount(null);
        }
        return false;
    }
    if (owner !== activeFavoriteOwner) transitionFavoriteAccount({ id: owner });
    return true;
}

function transitionFavoriteAccount(user) {
    const owner = favoriteQueueOwnerFor(user);
    if (owner === activeFavoriteOwner) return owner;

    // Invalidate responses and optimistic actions that began for the previous
    // identity before clearing every account-specific in-memory/UI value.
    favoriteStateRevision += 1;
    activeFavoriteOwner = owner;
    userFavorites = new Set();
    currentFavorites = [];
    favoriteRequestsInFlight.clear();
    clearFavoriteViewProductData();

    if (!owner) {
        clearPendingFavoriteOperations();
    } else {
        pendingFavoriteOperations = loadPendingFavoriteOperations(owner);
        favoriteQueueOwner = owner;
        userFavorites = reconcileFavoriteIds([]);
    }

    updateAllFavoriteIcons();
    document.querySelectorAll('.favorite-btn[data-id]').forEach((button) => {
        button.classList.remove('is-busy');
        button.disabled = false;
        button.removeAttribute('aria-busy');
    });
    authUI?.favoritesGrid?.replaceChildren();
    if (authUI?.favoritesSection && !authUI.favoritesSection.hidden) {
        showFavoritesEmptyState();
    }
    return owner;
}

function setFavoriteViewProductData(productId, data) {
    const id = String(productId || '');
    if (!id) return;
    if (!favoriteViewProductIds.has(id)) {
        favoriteViewProductBackups.set(id, favoriteProductData.has(id) ? favoriteProductData.get(id) : null);
        favoriteViewProductIds.add(id);
    }
    favoriteProductData.set(id, data);
}

function clearFavoriteViewProductData() {
    favoriteViewProductIds.forEach((id) => {
        const backup = favoriteViewProductBackups.get(id);
        if (backup) favoriteProductData.set(id, backup);
        else favoriteProductData.delete(id);
    });
    favoriteViewProductIds.clear();
    favoriteViewProductBackups.clear();
}

function normalizeFavoriteId(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

// Catalog cards represent retailer offers, so their UI identity must not fall
// back to a CJ SKU that can be reused by another advertiser or catalog. Saved
// favorites already store this opaque value in the existing `fragrance_id`
// field; no API shape change is required.
function productInteractionKey(product) {
    return normalizeFavoriteId(
        product?.interactionKey
        || product?.offerKey
        || product?.productKey
        || product?.fragrance_id
        || product?.productId
        || product?.id
    );
}

function reconcileFavoriteIds(favoriteIds = []) {
    const reconciled = new Set(
        [...favoriteIds]
            .map(normalizeFavoriteId)
            .filter(Boolean)
    );

    pendingFavoriteOperations.forEach((operation, storedId) => {
        const fragranceId = normalizeFavoriteId(storedId);
        if (!fragranceId) return;

        if (operation.type === 'add') {
            reconciled.add(fragranceId);
        } else if (operation.type === 'remove') {
            reconciled.delete(fragranceId);
        }
    });

    return reconciled;
}

function updateFavoriteButtonsForId(fragranceId, isFavorited) {
    const normalizedId = normalizeFavoriteId(fragranceId);
    if (!normalizedId) return;

    document.querySelectorAll('.favorite-btn[data-id]').forEach(button => {
        if (normalizeFavoriteId(button.dataset.id) !== normalizedId) return;

        button.classList.toggle('favorited', isFavorited);
        button.setAttribute('aria-pressed', String(isFavorited));
        button.setAttribute('aria-label', isFavorited ? 'Remove from favorites' : 'Add to favorites');
    });
}

function setFavoriteButtonsBusyForId(fragranceId, isBusy) {
    const normalizedId = normalizeFavoriteId(fragranceId);
    if (!normalizedId) return;

    document.querySelectorAll('.favorite-btn[data-id]').forEach(button => {
        if (normalizeFavoriteId(button.dataset.id) !== normalizedId) return;

        button.classList.toggle('is-busy', isBusy);
        button.disabled = isBusy;
        if (isBusy) {
            button.setAttribute('aria-busy', 'true');
        } else {
            button.removeAttribute('aria-busy');
        }
    });
}

function setFavoriteState(fragranceId, isFavorited) {
    const normalizedId = normalizeFavoriteId(fragranceId);
    if (!normalizedId) return;

    if (isFavorited) {
        userFavorites.add(normalizedId);
    } else {
        userFavorites.delete(normalizedId);
    }

    updateFavoriteButtonsForId(normalizedId, isFavorited);
}

function persistPendingFavoriteOperations() {
    if (!favoriteQueueStorage || !favoriteQueueOwner) return;
    try {
        if (pendingFavoriteOperations.size === 0) {
            favoriteQueueStorage.removeItem(FAVORITE_QUEUE_KEY);
            return;
        }
        favoriteQueueStorage.setItem(FAVORITE_QUEUE_KEY, JSON.stringify({
            owner: favoriteQueueOwner,
            savedAt: Date.now(),
            operations: [...pendingFavoriteOperations].slice(0, 50)
        }));
    } catch {
        // Persistence is best effort; never block a favorite action when storage is restricted.
    }
}

// Track online/offline status
window.addEventListener('online', async () => {
    isOnline = true;
    if (pendingFavoriteOperations.size > 0) await syncPendingFavoriteOperations();
    else if (activeFavoriteOwner) await loadUserFavorites(activeFavoriteOwner);
});

window.addEventListener('offline', () => {
    isOnline = false;
});

// Function to sync pending operations when back online
async function syncPendingFavoriteOperations() {
    if (!ensureFavoriteQueueOwner()) return;
    if (pendingFavoriteOperations.size === 0) return;
    const syncOwner = activeFavoriteOwner;

    showToast(`Syncing ${pendingFavoriteOperations.size} favorite operations...`, 'info');

    for (const [fragranceId, operation] of pendingFavoriteOperations) {
        if (favoriteRequestsInFlight.has(fragranceId)) continue;
        favoriteRequestsInFlight.add(fragranceId);
        setFavoriteButtonsBusyForId(fragranceId, true);
        try {
            const headers = { 'Content-Type': 'application/json' };

            if (operation.type === 'add') {
                const response = await fetch(`${window.API_BASE}/api/user/favorites`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(operation.data),
                    credentials: 'include'
                });
                if (!response.ok) throw new Error(`Favorite sync failed with ${response.status}`);
            } else if (operation.type === 'remove') {
                const response = await fetch(`${window.API_BASE}/api/user/favorites/${encodeURIComponent(fragranceId)}`, {
                    method: 'DELETE',
                    headers,
                    credentials: 'include'
                });
                if (!response.ok && response.status !== 404) throw new Error(`Favorite sync failed with ${response.status}`);
            }

            if (syncOwner !== activeFavoriteOwner) return;

            pendingFavoriteOperations.delete(fragranceId);
            persistPendingFavoriteOperations();
        } catch (error) {
            if (syncOwner !== activeFavoriteOwner) return;
            console.error(`❌ Failed to sync operation for ${fragranceId}:`, error);
            // Keep the operation in the queue for next attempt
        } finally {
            if (syncOwner === activeFavoriteOwner) {
                favoriteRequestsInFlight.delete(fragranceId);
                setFavoriteButtonsBusyForId(fragranceId, false);
            }
        }
    }

    // Reload favorites to ensure UI is in sync
    if (syncOwner !== activeFavoriteOwner) return;
    if (pendingFavoriteOperations.size === 0) {
        showToast('All favorites synced successfully!', 'success');
    } else {
        showToast(`${pendingFavoriteOperations.size} operations still pending`, 'warning');
    }
    await loadUserFavorites(syncOwner);
}
let currentPage = 1;
let totalPages = 1;

const RECENTLY_VIEWED_KEY = 'fragrance_collect_recently_viewed';
const RECENTLY_VIEWED_LIMIT = 6;
const RECENTLY_VIEWED_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const recentlyViewedStorage = getRecentlyViewedStorage();
let recentlyViewedItems = loadRecentlyViewedItems();

// Currency symbols for display
const currencySymbols = {
    USD: '$', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$', JPY: '¥', CNY: '¥',
    CHF: 'CHF', SEK: 'kr', NOK: 'kr', DKK: 'kr', PLN: 'zł', CZK: 'Kč',
    HUF: 'Ft', RON: 'lei', BGN: 'лв', HRK: 'kn', RUB: '₽', TRY: '₺',
    BRL: 'R$', MXN: '$', ARS: '$', CLP: '$', COP: '$', PEN: 'S/',
    ZAR: 'R', INR: '₹', KRW: '₩', SGD: 'S$', HKD: 'HK$', TWD: 'NT$',
    THB: '฿', MYR: 'RM', IDR: 'Rp', PHP: '₱', VND: '₫'
};

// Currency conversion cache and rates
let currencyRates = {
    EUR: 1 // Base currency for ECB API
};
let lastFetchTime = 0;
let currencyRateFetchPromise = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const CURRENCY_CACHE_KEY = 'fragrance_collect_currency_rates_v1';
const CURRENCY_FETCH_TIMEOUT_MS = 5000;

function normalizeCurrencyRates(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const normalized = { EUR: 1 };
    for (const [rawCode, rawRate] of Object.entries(value).slice(0, 200)) {
        const code = String(rawCode || '').trim().toUpperCase();
        const rate = Number(rawRate);
        if (/^[A-Z]{3}$/.test(code) && Number.isFinite(rate) && rate > 0 && rate < 1_000_000_000) {
            normalized[code] = rate;
        }
    }
    return Number.isFinite(normalized.USD) && Object.keys(normalized).length > 2 ? normalized : null;
}

function readCurrencyRateCache(now) {
    try {
        const cached = JSON.parse(window.localStorage.getItem(CURRENCY_CACHE_KEY) || 'null');
        const savedAt = Number(cached?.savedAt);
        const rates = normalizeCurrencyRates(cached?.rates);
        return rates && Number.isFinite(savedAt) && now - savedAt >= 0 && now - savedAt < CACHE_DURATION
            ? { rates, savedAt }
            : null;
    } catch {
        return null;
    }
}

function storeCurrencyRateCache(rates, savedAt) {
    try {
        window.localStorage.setItem(CURRENCY_CACHE_KEY, JSON.stringify({ savedAt, rates }));
    } catch {
        // Conversion remains available in memory when storage is unavailable.
    }
}

async function fetchCurrencyRates(url) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CURRENCY_FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            signal: controller.signal
        });
        if (!response.ok) return null;
        const payload = await response.json();
        return normalizeCurrencyRates(payload?.rates);
    } catch {
        return null;
    } finally {
        window.clearTimeout(timeout);
    }
}

// Enhanced currency converter object with ECB API integration
const currencyConverter = {
    // Fetch latest exchange rates from ECB API
    async fetchRates() {
        const now = Date.now();

        // Return in-memory or persisted rates only while they are fresh.
        if (now - lastFetchTime < CACHE_DURATION && Object.keys(currencyRates).length > 1) {
            return currencyRates;
        }
        const cached = readCurrencyRateCache(now);
        if (cached) {
            currencyRates = cached.rates;
            lastFetchTime = cached.savedAt;
            return currencyRates;
        }

        // One shared refresh prevents every visible price from starting its
        // own provider request when the catalog renders while rates are cold.
        if (!currencyRateFetchPromise) {
            currencyRateFetchPromise = (async () => {
                const rates = await fetchCurrencyRates('https://open.er-api.com/v6/latest/EUR')
                    || await fetchCurrencyRates('https://api.frankfurter.app/latest?from=EUR');
                if (!rates) {
                    console.warn('Live currency rates are unavailable; original retailer currencies will be preserved.');
                    return null;
                }

                currencyRates = rates;
                lastFetchTime = Date.now();
                storeCurrencyRateCache(rates, lastFetchTime);
                return currencyRates;
            })();
        }

        try {
            return await currencyRateFetchPromise;
        } finally {
            currencyRateFetchPromise = null;
        }
    },

    // Convert amount between currencies
    async convert(amount, fromCurrency, toCurrency) {
        const numericAmount = Number(amount);
        const source = String(fromCurrency || '').toUpperCase();
        const target = String(toCurrency || '').toUpperCase();
        if (!Number.isFinite(numericAmount) || !source || !target) return null;
        if (source === target) return numericAmount;
        await this.fetchRates();
        return this.convertSync(numericAmount, source, target);
    },

    // Synchronous convert (for sorting - uses cached rates)
    convertSync(amount, fromCurrency, toCurrency) {
        const numericAmount = Number(amount);
        const source = String(fromCurrency || '').toUpperCase();
        const target = String(toCurrency || '').toUpperCase();
        if (!Number.isFinite(numericAmount) || !source || !target) return null;
        if (source === target) return numericAmount;
        const fromRate = currencyRates[source];
        const toRate = currencyRates[target];
        if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) return null;
        const result = (numericAmount / fromRate) * toRate;
        return Number.isFinite(result) ? result : null;
    },

    // Get currency symbol
    getSymbol(currency) {
        return currencySymbols[currency] || currency;
    },

    // Format price with proper currency symbol and formatting
    formatPrice(amount, currency) {
        const symbol = this.getSymbol(currency);
        const formattedAmount = amount.toFixed(2);

        // Handle different currency formatting conventions
        if (currency === 'JPY' || currency === 'KRW' || currency === 'IDR' || currency === 'VND') {
            // No decimal places for these currencies
            return `${symbol}${Math.round(amount)}`;
        } else if (currency === 'INR') {
            // Indian numbering system
            return `${symbol}${formattedAmount}`;
        } else {
            // Standard formatting
            return `${symbol}${formattedAmount}`;
        }
    },

    // Get available currencies
    getAvailableCurrencies() {
        return Object.keys(currencyRates);
    },

    // Check if currency is supported
    isSupported(currency) {
        return currency in currencyRates;
    }
};

// Populate currency dropdown with available currencies from ECB API
function populateCurrencyDropdown() {
    const currencyDropdown = document.getElementById('currency-converter');
    if (!currencyDropdown) return;

    // Get available currencies
    const availableCurrencies = currencyConverter.getAvailableCurrencies();
    const previousCurrency = currencyDropdown.value;
    if (availableCurrencies.length <= 1) {
        currencyDropdown.innerHTML = '<option value="USD">USD ($)</option>';
        currencyDropdown.value = 'USD';
        currencyDropdown.disabled = true;
        currencyDropdown.title = 'Live exchange rates are temporarily unavailable';
        updatePriceRangeLabels('USD');
        window.FragranceSelects?.refresh(currencyDropdown);
        return;
    }

    // Sort currencies by popularity/common usage
    const popularCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK'];
    const sortedCurrencies = [
        ...popularCurrencies.filter(c => availableCurrencies.includes(c)),
        ...availableCurrencies.filter(c => !popularCurrencies.includes(c)).sort()
    ];

    // Clear existing options
    currencyDropdown.innerHTML = '';

    // Add options for each currency
    sortedCurrencies.forEach(currency => {
        const symbol = currencyConverter.getSymbol(currency);
        const option = document.createElement('option');
        option.value = currency;
        option.textContent = `${currency} (${symbol})`;
        currencyDropdown.appendChild(option);
    });

    currencyDropdown.disabled = false;
    currencyDropdown.removeAttribute('title');
    const selectedCurrency = sortedCurrencies.includes(previousCurrency)
        ? previousCurrency
        : (sortedCurrencies.includes('USD') ? 'USD' : sortedCurrencies[0]);
    currencyDropdown.value = selectedCurrency;
    updatePriceRangeLabels(selectedCurrency);
    window.FragranceSelects?.refresh(currencyDropdown);

}

function updatePriceRangeLabels(currency = 'USD') {
    const priceRange = document.getElementById('price-range');
    if (!priceRange) return;
    const symbol = currencySymbols[currency] || `${currency} `;
    const labels = {
        all: 'All prices',
        '0-50': `${symbol}0 – ${symbol}50 ${currency}`,
        '50-100': `${symbol}50 – ${symbol}100 ${currency}`,
        '100-200': `${symbol}100 – ${symbol}200 ${currency}`,
        '200+': `${symbol}200+ ${currency}`
    };
    [...priceRange.options].forEach((option) => {
        if (labels[option.value]) option.textContent = labels[option.value];
    });
    window.FragranceSelects?.refresh(priceRange);
}

// Configuration
const config = {
    API_ENDPOINT: window.CATALOG_API_BASE || window.API_BASE,
    RESULTS_PER_PAGE: 12,
    DEBOUNCE_DELAY: 300,
    POPULAR_PICKS_LIMIT: 4,
    DEFAULT_SEARCH_TERM: 'fragrance perfume' // The term to search on page load
};

function getRecentlyViewedStorage() {
    try {
        const storage = window.localStorage;
        storage.getItem(RECENTLY_VIEWED_KEY);
        return storage;
    } catch {
        return null;
    }
}

function normalizeRecentlyViewedItem(item) {
    if (!item || typeof item !== 'object') return null;

    const id = String(item.id || item.productId || item.fragrance_id || '').trim();
    const name = String(item.name || '').trim();
    const productUrl = SecurityUtils.validateUrl(item.productUrl || item.buyUrl || '');
    if (!id || !name || !productUrl) return null;

    return {
        id,
        name: name.substring(0, 160),
        brand: String(item.brand || '').trim().substring(0, 100),
        advertiser: String(item.advertiser || item.advertiserName || '').trim().substring(0, 100),
        imageUrl: SecurityUtils.validateUrl(item.imageUrl || item.image || ''),
        productUrl,
        viewedAt: SecurityUtils.validateNumber(item.viewedAt, 0, Number.MAX_SAFE_INTEGER, Date.now())
    };
}

function loadRecentlyViewedItems() {
    if (!recentlyViewedStorage) return [];

    try {
        const savedItems = JSON.parse(recentlyViewedStorage.getItem(RECENTLY_VIEWED_KEY) || '[]');
        if (!Array.isArray(savedItems)) return [];
        const now = Date.now();
        const items = savedItems
            .map(normalizeRecentlyViewedItem)
            .filter((item) => item && item.viewedAt <= now && now - item.viewedAt < RECENTLY_VIEWED_MAX_AGE)
            .slice(0, RECENTLY_VIEWED_LIMIT);
        if (items.length !== savedItems.length) {
            recentlyViewedStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(items));
        }
        return items;
    } catch {
        try {
            recentlyViewedStorage.removeItem(RECENTLY_VIEWED_KEY);
        } catch {
            // The in-memory history remains available if storage becomes restricted.
        }
        return [];
    }
}

function persistRecentlyViewedItems() {
    if (!recentlyViewedStorage) return;

    try {
        recentlyViewedStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(recentlyViewedItems));
    } catch {
        // Recently viewed is an enhancement; storage failures must never block navigation.
    }
}

function recordRecentlyViewed(item) {
    const recentItem = normalizeRecentlyViewedItem({ ...item, viewedAt: Date.now() });
    if (!recentItem) return;

    recentlyViewedItems = [
        recentItem,
        ...recentlyViewedItems.filter(savedItem => savedItem.id !== recentItem.id)
    ].slice(0, RECENTLY_VIEWED_LIMIT);
    persistRecentlyViewedItems();
    renderRecentlyViewed();
}

function renderRecentlyViewed() {
    const shopContainer = document.querySelector('#shop > .container');
    if (!shopContainer) return;

    document.getElementById('recently-viewed')?.remove();
    if (recentlyViewedItems.length === 0) return;

    const section = document.createElement('section');
    section.id = 'recently-viewed';
    section.className = 'fc-recently-viewed';
    section.setAttribute('aria-labelledby', 'recently-viewed-title');

    const header = document.createElement('div');
    header.className = 'fc-recently-viewed-header';

    const headingGroup = document.createElement('div');
    const kicker = document.createElement('p');
    kicker.className = 'section-kicker';
    kicker.textContent = 'Pick up where you left off';

    const title = document.createElement('h2');
    title.id = 'recently-viewed-title';
    title.textContent = 'Recently viewed offers';

    const description = document.createElement('p');
    description.textContent = 'Return to retailer listings you opened from this catalog.';

    headingGroup.append(kicker, title, description);

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'fc-recently-viewed-clear';
    clearButton.textContent = 'Clear history';
    clearButton.addEventListener('click', () => {
        recentlyViewedItems = [];
        persistRecentlyViewedItems();
        renderRecentlyViewed();
    });
    header.append(headingGroup, clearButton);

    const list = document.createElement('ul');
    list.className = 'fc-recently-viewed-list';
    list.setAttribute('role', 'list');

    recentlyViewedItems.forEach(item => {
        const listItem = document.createElement('li');
        listItem.className = 'fc-recent-item';

        const link = document.createElement('a');
        link.href = item.productUrl;
        link.target = '_blank';
        link.rel = 'nofollow sponsored noopener';
        link.setAttribute('aria-label', `View ${item.name} offer at ${item.advertiser || 'the retailer'}`);

        const media = document.createElement('span');
        media.className = 'fc-recent-item-media';
        if (item.imageUrl) {
            const image = document.createElement('img');
            image.src = item.imageUrl;
            image.alt = '';
            image.width = 112;
            image.height = 112;
            image.loading = 'lazy';
            image.decoding = 'async';
            image.addEventListener('error', () => {
                const fallback = document.createElement('span');
                fallback.className = 'fc-recent-item-fallback';
                fallback.textContent = item.name.charAt(0).toUpperCase();
                image.replaceWith(fallback);
            }, { once: true });
            media.appendChild(image);
        } else {
            const fallback = document.createElement('span');
            fallback.className = 'fc-recent-item-fallback';
            fallback.textContent = item.name.charAt(0).toUpperCase();
            media.appendChild(fallback);
        }

        const details = document.createElement('span');
        details.className = 'fc-recent-item-details';

        const brand = document.createElement('span');
        brand.className = 'fc-recent-item-brand';
        brand.textContent = item.brand || 'Fragrance offer';

        const name = document.createElement('span');
        name.className = 'fc-recent-item-name';
        name.textContent = item.name;

        const retailer = document.createElement('span');
        retailer.className = 'fc-recent-item-retailer';
        retailer.textContent = item.advertiser ? `At ${item.advertiser}` : 'At the listed retailer';

        const action = document.createElement('span');
        action.className = 'fc-recent-item-action';
        action.textContent = 'View retailer offer →';

        details.append(brand, name, retailer, action);
        link.append(media, details);
        listItem.appendChild(link);
        list.appendChild(listItem);
    });

    section.append(header, list);
    const pagination = document.getElementById('pagination-container');
    if (pagination?.parentNode === shopContainer) {
        pagination.insertAdjacentElement('afterend', section);
    } else {
        shopContainer.appendChild(section);
    }
}

function initializeCatalogKeyboardShortcuts() {
    const searchInput = document.getElementById('main-search');
    if (!searchInput) return;

    document.addEventListener('keydown', async event => {
        if (event.key === 'Escape' && document.activeElement === searchInput) {
            if (searchInput.value) {
                searchInput.value = '';
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                currentFilters.search = config.DEFAULT_SEARCH_TERM;
                currentFilters.brand = '';
                currentFilters.intent = parseFragranceSearchIntent('');
                updateSearchIntentStatus(currentFilters.intent, '');
                updateBrandUrl('', { resetSearch: true });
                await applyFilters(true);
            } else {
                searchInput.blur();
            }
            event.preventDefault();
        }
    });
}

function initializeBackToTopButton() {
    if (document.querySelector('.fc-back-to-top')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fc-back-to-top';
    button.setAttribute('aria-label', 'Back to top');
    button.setAttribute('aria-hidden', 'true');
    button.tabIndex = -1;

    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↑';
    button.appendChild(arrow);
    document.body.appendChild(button);

    const updateVisibility = () => {
        const isVisible = window.scrollY > 700;
        button.classList.toggle('is-visible', isVisible);
        button.setAttribute('aria-hidden', String(!isVisible));
        button.tabIndex = isVisible ? 0 : -1;
    };

    let updatePending = false;
    window.addEventListener('scroll', () => {
        if (updatePending) return;
        updatePending = true;
        window.requestAnimationFrame(() => {
            updateVisibility();
            updatePending = false;
        });
    }, { passive: true });

    button.addEventListener('click', () => {
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    });
    updateVisibility();
}

function initializeCatalogFeatures() {
    renderRecentlyViewed();
    initializeCatalogKeyboardShortcuts();
    initializeBackToTopButton();

    document.addEventListener('click', event => {
        const dealLink = event.target.closest?.('.btn-view-deal[href]');
        if (!dealLink || dealLink.classList.contains('is-disabled')) return;

        const productId = dealLink.closest('.product-card')?.dataset.id;
        const product = productId ? favoriteProductData.get(productId) : null;
        if (product) recordRecentlyViewed(product);
    });
}

// --- AUTHENTICATION ---
// Note: isUserLoggedIn and currentUser are now managed by shared-auth.js

const authUI = {
    favoritesSection: document.getElementById('favorites'),
    favoritesGrid: document.getElementById('favorites-grid'),
    favoritesEmptyState: document.getElementById('favorites-empty-state'),
    mainContentSections: document.querySelectorAll('.main-content'),
    favoritesLink: document.querySelector('a[href="/#favorites"]')
};

// Auth status is the source of truth for account-specific catalog state. This
// event may arrive after a slow network response, so no fixed bootstrap timer
// is used and every identity transition starts from an empty state.
document.addEventListener('fragrance:auth-change', async (event) => {
    const owner = favoriteQueueOwnerFor(event.detail?.user);
    const changedIdentity = owner !== activeFavoriteOwner;
    if (changedIdentity) transitionFavoriteAccount(event.detail?.user || null);

    if (!owner) {
        if (window.location.hash === '#favorites') {
            window.location.href = 'auth.html?tab=signin';
        }
        return;
    }

    if (window.location.hash === '#favorites') showFavoritesView({ reload: false });
    if (navigator.onLine && pendingFavoriteOperations.size > 0) {
        await syncPendingFavoriteOperations();
    } else {
        await loadUserFavorites(owner);
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    // Logout handling is now in shared-auth.js - search row logout removed

    // Add event listener for the menu logout button
    const menuLogoutBtn = document.getElementById('menu-logout-btn');
    if (menuLogoutBtn) {
        menuLogoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleSharedLogout();
        });
    }

    if (authUI.favoritesLink) {
        authUI.favoritesLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.location.hash !== '#favorites') {
                window.history.pushState({ ...window.history.state, catalogView: 'favorites' }, '', '#favorites');
            }
            showFavoritesView();
        });
    } else {
    }

    // Add event listeners to navigation links to restore main view
    const navLinks = document.querySelectorAll('a.nav-link[href^="/#"]:not([href*="favorites"]), a.nav-link[href^="#"]:not([href*="favorites"])');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const targetHref = link.getAttribute('href') || '';
            // Only restore main view for navigation links (not favorites)
            if (targetHref && !targetHref.includes('#favorites')) {
                e.preventDefault();
                const targetHash = targetHref.includes('#') ? `#${targetHref.split('#')[1]}` : '#home';
                if (window.location.hash !== targetHash) {
                    window.history.pushState({ ...window.history.state, catalogView: 'catalog' }, '', targetHash);
                }
                showMainContentView();
                // Navigate to the target section
                if (targetHref.includes('#')) {
                    const targetId = targetHref.split('#')[1];
                    if (targetId === 'home') {
                        // Special case for Home - scroll to top
                        setTimeout(() => {
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                        }, 100);
                    } else {
                        const targetElement = document.getElementById(targetId);
                        if (targetElement) {
                            setTimeout(() => {
                                targetElement.scrollIntoView({ behavior: 'smooth' });
                            }, 100);
                        }
                    }
                } else {
                    // If no hash, also scroll to top (fallback for home)
                    setTimeout(() => {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }, 100);
                }
            }
        });
    });

    // Initialize the application

    // Load the catalog state represented by the current URL.
    const urlParams = new URLSearchParams(window.location.search);
    const collectionTerms = {
        designer: 'designer perfume',
        niche: 'niche fragrance',
        vintage: 'vintage perfume',
        seasonal: 'seasonal fragrance'
    };
    const explicitBrand = brandFromUrl(urlParams.get('brand'));
    if (explicitBrand) rememberBrand(explicitBrand);
    const requestedSearchTerm = urlParams.get('q')
        || (urlParams.get('scent') ? `${urlParams.get('scent')} fragrance` : '')
        || collectionTerms[urlParams.get('type')]
        || '';
    const initialBrand = explicitBrand
        || recognizedBrandOnlySearch(requestedSearchTerm)
        || recognizedBrandInSearch(requestedSearchTerm);
    const visibleInitialSearch = requestedSearchTerm || initialBrand || '';
    const initialSearchTerm = visibleInitialSearch || config.DEFAULT_SEARCH_TERM;
    const initialIntent = mergeSearchIntentFromUrl(parseFragranceSearchIntent(visibleInitialSearch), urlParams);
    const searchInput = document.getElementById('main-search');
    if (searchInput) {
        searchInput.value = visibleInitialSearch;
    }
    currentFilters.search = initialSearchTerm;
    currentFilters.brand = initialBrand;
    currentFilters.intent = initialIntent;
    updateSearchIntentStatus(initialIntent, initialBrand);

    // Defer secondary catalog requests until their sections approach the viewport.
    initializeDeferredRecommendations();

    // Initialize event listeners after all functions are defined
    initializeDropdowns(initialBrand, initialIntent);
    addEventListeners();
    initializeCatalogFeatures();

    initializeFilters(initialBrand, initialIntent);
    hydrateCatalogControlsFromUrl(urlParams);
    // Normalize shareable filter state after hydration. Defaults and malformed
    // values are removed instead of lingering as misleading URL parameters.
    syncCatalogFilterUrlFromControls();
    updateSearchIntentStatus(buildServerFilters().searchIntent, initialBrand);

    // Currency conversion improves comparison, but it must never hold the
    // catalog hostage to a third-party rate service. The native USD-first
    // controls are usable immediately; when fresh rates arrive, keep the
    // shopper's current selection and refresh the enhanced control in place.
    void currencyConverter.fetchRates()
        .then((rates) => {
            if (!rates) return;
            populateCurrencyDropdown();
            const selectedCurrency = document.getElementById('currency-converter')?.value;
            if (selectedCurrency && selectedCurrency !== 'USD' && cjProducts.length > 0) {
                return updateDisplayedPrices(selectedCurrency);
            }
        })
        .catch(() => {
            // Original retailer amounts and currencies remain visible when
            // exchange-rate providers are unavailable.
        });

    // Load products on initial page load
    try {
        showLoading();
        await loadCJProducts(initialSearchTerm, 1, null, buildServerFilters());
    } catch (error) {
        console.error('Error loading products:', error);
        showStatusMessage('Failed to load products. Please try again.', true);
    } finally {
        hideLoading();
    }
});

// Handle hash changes for favorites navigation (back/forward buttons)
window.addEventListener('hashchange', () => {
    if (window.location.hash === '#favorites') {
        if (isAuthenticated()) {
            showFavoritesView();
        } else {
            window.location.href = 'auth.html?tab=signin';
        }
    } else if (window.location.hash !== '#favorites' && typeof isInFavoritesView !== 'undefined' && isInFavoritesView) {
        showMainContentView();
    }
});

function showStatusMessage(message, isError = false) {
    const grid = document.getElementById('products-grid');
    const noResults = document.getElementById('no-results');
    const pagination = document.getElementById('pagination-container');
    const resultsInfo = document.getElementById('search-results-info');
    if (!noResults) return;

    if (grid) {
        grid.innerHTML = '';
        grid.removeAttribute('aria-busy');
        grid.removeAttribute('aria-label');
    }
    if (pagination) pagination.hidden = true;
    if (resultsInfo) resultsInfo.hidden = true;

    noResults.replaceChildren();
    noResults.className = `fc-catalog-state${isError ? ' is-error' : ''}`;
    noResults.dataset.catalogState = isError ? 'error' : 'empty';
    noResults.setAttribute('role', isError ? 'alert' : 'status');
    noResults.setAttribute('aria-live', isError ? 'assertive' : 'polite');

    const icon = document.createElement('span');
    icon.className = 'fc-catalog-state-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = isError ? '!' : '⌕';

    const title = document.createElement('h2');
    title.textContent = isError ? 'Retailer offers are unavailable' : 'No matching retailer offers';

    const description = document.createElement('p');
    description.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'fc-catalog-state-actions';

    const primaryAction = document.createElement('button');
    primaryAction.type = 'button';
    primaryAction.className = 'fc-catalog-state-primary';
    primaryAction.textContent = isError ? 'Try again' : 'Reset catalog';
    primaryAction.addEventListener('click', async () => {
        if (!isError) {
            clearAllFilters();
            return;
        }

        primaryAction.disabled = true;
        showSearchLoading();
        const searchInput = document.getElementById('main-search');
        const query = currentFilters.search || searchInput?.value.trim() || config.DEFAULT_SEARCH_TERM;
        try {
            await loadCJProducts(query, currentPage, null, buildServerFilters());
        } finally {
            primaryAction.disabled = false;
            hideSearchLoading();
        }
    });

    const editAction = document.createElement('button');
    editAction.type = 'button';
    editAction.className = 'fc-catalog-state-secondary';
    editAction.textContent = 'Edit search';
    editAction.addEventListener('click', () => {
        const searchInput = document.getElementById('main-search');
        searchInput?.focus();
        searchInput?.select();
    });

    actions.append(primaryAction, editAction);
    noResults.append(icon, title, description, actions);
    noResults.hidden = false;
}

function showLoading() {
    const grid = document.getElementById('products-grid');
    const noResults = document.getElementById('no-results');
    const pagination = document.getElementById('pagination-container');
    const resultsInfo = document.getElementById('search-results-info');

    if (noResults) {
        noResults.hidden = true;
        noResults.dataset.catalogState = 'loading';
    }
    if (pagination) pagination.hidden = true;
    if (resultsInfo) {
        resultsInfo.textContent = 'Loading retailer offers…';
        resultsInfo.hidden = false;
    }
    if (!grid) return;

    grid.setAttribute('aria-busy', 'true');
    grid.setAttribute('aria-label', 'Loading fragrance offers');
    grid.innerHTML = Array.from({ length: 8 }, () => `
        <article class="product-card fc-skeleton-card" aria-hidden="true">
            <div class="product-image-container fc-skeleton-media">
                <span class="fc-skeleton-block"></span>
            </div>
            <div class="product-info fc-skeleton-info">
                <span class="fc-skeleton-block fc-skeleton-line is-short"></span>
                <span class="fc-skeleton-block fc-skeleton-line is-title"></span>
                <span class="fc-skeleton-block fc-skeleton-line"></span>
                <span class="fc-skeleton-block fc-skeleton-line is-price"></span>
            </div>
            <div class="product-meta fc-skeleton-meta">
                <span class="fc-skeleton-block fc-skeleton-line"></span>
                <span class="fc-skeleton-block fc-skeleton-button"></span>
            </div>
        </article>
    `).join('');
}

function hideLoading() {
    const grid = document.getElementById('products-grid');
    const noResults = document.getElementById('no-results');
    if (grid) {
        grid.removeAttribute('aria-busy');
        grid.removeAttribute('aria-label');
    }
    if (noResults?.dataset.catalogState === 'loading') {
        noResults.hidden = true;
        delete noResults.dataset.catalogState;
    }
}

// SIMPLIFIED: This function is no longer needed as the new API provides clean data.
/*
function normalizeShippingLocal(cost, shippingField) {
    if (typeof cost === 'string' && cost.trim().toLowerCase() === 'free') return 0;
    if (typeof cost === 'number') return cost;
    if (shippingField && typeof shippingField === 'string') {
        if (shippingField.toLowerCase().includes('free')) return 0;
        const m = shippingField.match(/\$([0-9]+(\.[0-9]{1,2})?)/);
        if (m) return Number(m[1]);
    }
    return null;
}
*/

// SIMPLIFIED: This function now only handles the single, clean `products` array from the worker.
function mapProductsDataToItems(data) {
    if (!data || !Array.isArray(data.products)) return [];

    const optionalNumber = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) && number >= min && number <= max ? number : null;
    };

    const stringList = (value, limit = 10) => {
        const values = Array.isArray(value) ? value : [value];
        return values.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()).slice(0, limit);
    };

    const cleanText = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
    const cleanCode = (value, pattern, fallback = null) => pattern.test(value || '') ? value : fallback;
    const cleanDate = (value) => {
        if (!value) return null;
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
    };
    const cleanObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const isNewRetailProductListing = (product) => {
        if (!product || typeof product !== 'object') return false;
        const normalizedEvidence = (value) => String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[‐‑‒–—]/g, '-')
            .toLowerCase();
        const conditionEvidence = normalizedEvidence(product.condition || product.itemCondition);
        const retailerEvidence = normalizedEvidence([
            product.advertiser,
            product.advertiserName,
            product.marketplace
        ].filter(Boolean).join(' '));
        const presentationEvidence = normalizedEvidence([
            product.name,
            product.title,
            product.presentation,
            product.productTypes,
            product.productType
        ].flat().filter(Boolean).join(' '));
        const nonNewCondition = /\b(?:used|pre[\s-]?owned|previously[\s-]?owned|second[\s-]?hand|refurbished|remanufactured|renewed|open[\s-]?box|new[\s-]+other|like[\s-]+new|for[\s-]+parts|parts[\s-]+only|salvage|damaged|defective|not[\s-]+working)\b/i;
        const nonRetailPresentation = /\b(?:testers?|decants?|samples?|trial[\s-]+sizes?|vials?|partial[\s-]+bottles?|unboxed|no[\s-]+box|without[\s-]+box|not[\s-]+for[\s-]+sale|demonstration)\b/i;
        const marketplaceRetailer = /\b(?:marketplaces?|tiktok\s+shop|ebay|amazon\s+marketplace|walmart\s+marketplace)\b/i;
        const explicitlyNew = /\b(?:new|brand[\s-]+new|factory[\s-]+sealed|new[\s-]+and[\s-]+sealed|unused)\b/i;
        return !(marketplaceRetailer.test(retailerEvidence) && !explicitlyNew.test(conditionEvidence))
            && !nonNewCondition.test(conditionEvidence)
            && !nonNewCondition.test(presentationEvidence)
            && !nonRetailPresentation.test(conditionEvidence)
            && !nonRetailPresentation.test(presentationEvidence);
    };
    const identityPart = (value, limit = 100) => String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, limit);
    const normalizedGtin = (value) => {
        const candidates = (Array.isArray(value) ? value : [value])
            .flatMap(item => typeof item === 'string' ? item.split(/[,/|]/) : [])
            .map(item => item.replace(/[\s-]/g, ''))
            .filter(item => /^\d+$/.test(item));
        return candidates.find(item => [8, 10, 11, 12, 13, 14].includes(item.length)) || '';
    };
    const comparableText = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const normalizeAudienceEvidence = (values) => {
        const labels = new Set(stringList(values, 4).map((value) => {
            const normalized = String(value || '').normalize('NFKD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[’‘`]/g, "'")
                .trim()
                .toLowerCase();
            if (/\bunisex\b|\bgender[ -]?neutral\b|\b(?:men|gentlemen|males?)\s*(?:\/|&|and)\s*(?:women|ladies|females?)\b|\b(?:women|ladies|females?)\s*(?:\/|&|and)\s*(?:men|gentlemen|males?)\b/.test(normalized)) return 'Unisex';
            if (/^(?:for\s+)?(?:women(?:'?s)?|woman(?:'?s)?|ladies(?:'s|')?|lady(?:'s)?|females?(?:'s|')?)$|^pour\s+femme$/.test(normalized)) return 'Women';
            if (/^(?:for\s+)?(?:men(?:'?s)?|man(?:'?s)?|gentlemen(?:'s|')?|gentleman(?:'s)?|males?(?:'s|')?)$|^pour\s+homme$/.test(normalized)) return 'Men';
            return null;
        }).filter(Boolean));
        if (labels.has('Unisex') || (labels.has('Men') && labels.has('Women'))) return 'Unisex';
        return labels.size === 1 ? [...labels][0] : null;
    };
    const isWearableFragranceListing = (product) => {
        const title = String(product.name || product.title || '').toLowerCase();
        const category = [product.category, product.productTypes, product.productType]
            .flat().filter(Boolean).join(' ').toLowerCase();
        const supporting = [product.description, product.highlights]
            .flat().filter(Boolean).join(' ').toLowerCase();
        const wearable = /\b(?:perfume|parfum|fragrance|cologne|eau\s+de\s+(?:parfum|toilette|cologne)|extrait|attar|body\s+mist|perfume\s+oil|aftershave)\b/i;
        const identity = `${title} ${category}`;
        const excluded = /\b(?:fragrance[ -]?free|candle|wax\s+melt|reed\s+diffuser|oil\s+diffuser|home\s+fragrance|room\s+spray|linen\s+spray|pillow\s+spray|air\s+freshener|car\s+(?:scent|freshener)|incense|potpourri|laundry\s+(?:scent|detergent|beads?)|empty\s+(?:perfume\s+)?(?:bottle|atomizer)|perfume\s+(?:organizer|tray|stand)|gift\s*card|replacement\s+cap)\b/i;
        const companionOnly = /\b(?:body\s+(?:lotion|cream|butter|gel|milk|oil|powder|scrub|wash)|hand\s+(?:cream|lotion|wash)|shower\s+(?:cream|gel|oil)|bath\s+(?:foam|gel|oil|salts?)|bar\s+soap|deodorant|antiperspirant|shampoo|conditioner|after[\s-]?shave)\b/i;
        const nonFragranceMerchandise = /\b(?:lipstick|lip\s+(?:balm|color|colour|gloss|liner)|mascara|eye[\s-]?liner|eye[\s-]?shadow|foundation|concealer|make[\s-]?up|nail\s+(?:lacquer|polish)|skin[\s-]?care|serum|moisturi[sz]er|cleanser|toner|sunscreen|sun[\s-]?glasses|eye[\s-]?glasses|handbags?|purses?(?!\s+spray)|wallets?|card\s+holders?|shoes?|sandals?|boots?|belts?|scarves?|jewel(?:ry|lery)|earrings?|necklaces?|bracelets?|watches?|phone\s+cases?)\b/i;
        const nonFragranceCategory = /\b(?:make[\s-]?up|cosmetics?|skin[\s-]?care|hair[\s-]?care|fashion\s+accessories|beauty\s+accessories|handbags?|jewel(?:ry|lery)|footwear)\b/i;
        const qualifiedFragranceSet = /\b(?:perfume|parfum|cologne|eau\s+de\s+(?:parfum|toilette|cologne)|extrait|attar)\b/i.test(title)
            && /\b(?:set|bundle)\b/i.test(title);
        const explicitFragranceTitle = wearable.test(title);
        if (excluded.test(identity)
            || (companionOnly.test(identity) && !qualifiedFragranceSet)
            || (nonFragranceMerchandise.test(title) && !qualifiedFragranceSet)
            || (nonFragranceCategory.test(category) && !wearable.test(category) && !explicitFragranceTitle)) return false;
        return wearable.test(title) || wearable.test(category) || (wearable.test(supporting) && /\b(?:spray|bottle|wear|skin)\b/i.test(supporting));
    };
    const inferFragranceMetadata = (product) => {
        const specifications = [
            ...(Array.isArray(product.specifications) ? product.specifications : []),
            ...(Array.isArray(product.productDetail) ? product.productDetail : product.productDetail ? [product.productDetail] : [])
        ];
        const detailSizes = specifications
            .filter(detail => /\b(?:size|volume|capacity)\b/i.test(detail?.name || detail?.attributeName || ''))
            .map(detail => detail?.value || detail?.attributeValue)
            .filter(Boolean)
            .join(' ');
        const sources = [
            ['retailer size field', stringList(product.size, 6).join(' ')],
            ['unit-pricing field', product.unitPricingMeasure],
            ['retailer specification', detailSizes],
            ['product title', product.name || product.title],
            ['retailer link', (() => { try { return decodeURIComponent(product.link || product.cjLink || product.buyUrl || ''); } catch { return ''; } })()],
            ['product description', product.description]
        ];
        const commonSizes = [1, 1.5, 2, 3, 5, 7.5, 8, 10, 15, 20, 25, 30, 40, 50, 60, 75, 80, 90, 100, 120, 125, 150, 200, 250, 500];
        const snapMl = (rawMl) => {
            const nearest = commonSizes.reduce((best, candidate) => Math.abs(candidate - rawMl) < Math.abs(best - rawMl) ? candidate : best);
            return Math.abs(nearest - rawMl) <= Math.max(1.25, nearest * 0.04) ? nearest : Math.round(rawMl * 10) / 10;
        };
        let size = null;
        for (const [source, value] of sources) {
            if (!value) continue;
            const text = String(value)
                .replace(/\b(\d{1,3})-(\d{1,2})-(fl-?)?oz\b/gi, '$1.$2 fl oz')
                .replace(/-/g, ' ');
            const multi = text.match(/\b(\d{1,2})\s*[x×]\s*(\d{1,3}(?:\.\d{1,2})?)\s*(fl\.?\s*oz|fluid\s*ounces?|ounces?|oz|ml|millilit(?:er|re)s?|cl|centilit(?:er|re)s?)\b/i);
            const single = text.match(/\b(\d{1,3}(?:\.\d{1,2})?)\s*(fl\.?\s*oz|fluid\s*ounces?|ounces?|oz|ml|millilit(?:er|re)s?|cl|centilit(?:er|re)s?)\b/i);
            const match = multi || single;
            if (!match) continue;
            const packCount = multi ? Number(match[1]) : 1;
            const amount = Number(match[multi ? 2 : 1]);
            const unit = match[multi ? 3 : 2].toLowerCase();
            const rawMl = /^(?:ml|millilit)/.test(unit) ? amount : /^(?:cl|centilit)/.test(unit) ? amount * 10 : amount * 29.5735;
            if (!Number.isFinite(rawMl) || rawMl < 0.2 || rawMl > 1000) continue;
            const isOunces = /oz|ounce/.test(unit);
            const canonicalMl = isOunces ? snapMl(rawMl) : Math.round(rawMl * 10) / 10;
            const displayAmount = Number.isInteger(amount) ? String(amount) : String(amount).replace(/0+$/, '').replace(/\.$/, '');
            const measure = isOunces ? `${displayAmount} fl oz / ${canonicalMl} ml` : `${canonicalMl} ml`;
            size = {
                labels: [packCount > 1 ? `${packCount} × ${measure} (${Math.round(canonicalMl * packCount * 10) / 10} ml total)` : measure],
                canonicalMl,
                packCount,
                source,
                variantKey: packCount > 1 ? `${packCount}x${canonicalMl}ml` : `${canonicalMl}ml`
            };
            break;
        }
        size ||= { labels: [], canonicalMl: null, packCount: 1, source: '', variantKey: '' };

        const titleEvidence = [product.name, product.title, product.productTypes, product.productType]
            .flat().filter(Boolean).join(' ');
        const descriptionEvidence = String(product.description || '');
        const evidence = [titleEvidence, descriptionEvidence]
            .flat().filter(Boolean).join(' ');
        const concentrationMatch = evidence.match(/\b(eau\s+de\s+parfum|edp|eau\s+de\s+toilette|edt|eau\s+de\s+cologne|edc|extrait(?:\s+de\s+parfum)?|perfume\s+oil|attar|(?:fragrance|body)\s+mist|parfum)\b/i);
        const concentrationAliases = {
            edp: 'Eau de Parfum',
            'eau de parfum': 'Eau de Parfum',
            edt: 'Eau de Toilette',
            'eau de toilette': 'Eau de Toilette',
            edc: 'Eau de Cologne',
            'eau de cologne': 'Eau de Cologne',
            'perfume oil': 'Perfume Oil',
            attar: 'Perfume Oil',
            'fragrance mist': 'Fragrance Mist',
            'body mist': 'Fragrance Mist'
        };
        const rawConcentration = concentrationMatch?.[1] || '';
        const concentration = concentrationAliases[rawConcentration.toLowerCase()]
            || rawConcentration.replace(/\b\w/g, letter => letter.toUpperCase());
        const structuredAudience = normalizeAudienceEvidence(product.gender);
        const inferAudience = (value) => {
            const normalized = String(value || '').normalize('NFKD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[’‘`]/g, "'")
                .toLowerCase();
            if (/\b(?:unisex|gender[ -]?neutral|(?:for\s+)?(?:women(?:'?s)?|woman(?:'?s)?|ladies(?:'s|')?|lady(?:'s)?|females?(?:'s|')?)\s*(?:and|&|\/)\s*(?:men(?:'?s)?|man(?:'?s)?|gentlemen(?:'s|')?|gentleman(?:'s)?|males?(?:'s|')?)|(?:for\s+)?(?:men(?:'?s)?|man(?:'?s)?|gentlemen(?:'s|')?|gentleman(?:'s)?|males?(?:'s|')?)\s*(?:and|&|\/)\s*(?:women(?:'?s)?|woman(?:'?s)?|ladies(?:'s|')?|lady(?:'s)?|females?(?:'s|')?))\b/i.test(normalized)) return 'Unisex';
            if (/\b(?:women(?:'?s)?|woman(?:'?s)?|ladies(?:'s|')?|lady(?:'s)?|females?(?:'s|')?|for\s+her|pour\s+femme)\b/i.test(normalized)) return 'Women';
            if (/\b(?:men(?:'?s)?|man(?:'?s)?|gentlemen(?:'s|')?|gentleman(?:'s)?|males?(?:'s|')?|for\s+him|pour\s+homme)\b/i.test(normalized)) return 'Men';
            return null;
        };
        const inferredAudience = inferAudience(titleEvidence) || inferAudience(descriptionEvidence);
        const audience = structuredAudience || inferredAudience ? [structuredAudience || inferredAudience] : [];
        const form = /\broll[ -]?on\b/i.test(evidence) ? 'Roll-on'
            : /\b(?:sprays?|atomisers?|atomizers?|atomiseurs?|vaporisers?|vaporizers?|vaporisateurs?)\b/i.test(evidence) ? 'Spray'
                : /\bsplash\b/i.test(evidence) ? 'Splash'
                    : /\bsolid\s+perfume\b/i.test(evidence) ? 'Solid' : '';
        const presentation = /\b(?:gift|discovery|sampler|miniature|perfume|fragrance)\s+(?:gift\s+)?sets?\b|\b\d+\s*(?:pieces?|pcs?)\s+(?:perfume\s+|fragrance\s+)?sets?\b/i.test(titleEvidence) ? 'Set'
            : /\btesters?\b/i.test(titleEvidence) ? 'Tester'
                : /\brefills?\b/i.test(titleEvidence) ? 'Refill'
                    : /\b(?:samples?|decants?|vials?)\b/i.test(titleEvidence) ? 'Sample'
                        : /\b(?:travel|mini(?:ature)?)\s+(?:size|spray|bottle)\b/i.test(titleEvidence) ? 'Travel size'
                            : product.isBundle === true ? 'Bundle' : 'Single bottle';
        return { ...size, concentration, audience, form, presentation };
    };
    const cleanOffer = (offer) => {
        if (!offer || typeof offer !== 'object') return null;
        const buyUrl = SecurityUtils.validateUrl(offer.buyUrl || '');
        const offerPrice = optionalNumber(offer.price, 0, 50000);
        if (!buyUrl || offerPrice === null) return null;
        return {
            id: String(offer.id || ''),
            sourceProductId: cleanText(String(offer.sourceProductId || '')),
            catalogId: cleanText(String(offer.catalogId || '')),
            offerKey: cleanText(offer.offerKey),
            advertiserId: cleanText(String(offer.advertiserId || '')),
            advertiser: cleanText(offer.advertiser, 'Retail partner'),
            price: offerPrice,
            regularPrice: optionalNumber(offer.regularPrice, 0, 50000),
            currency: cleanCode(offer.currency, /^[A-Z]{3}$/, 'USD'),
            shippingCost: optionalNumber(offer.shippingCost, 0, 10000),
            shippingCurrency: cleanCode(offer.shippingCurrency, /^[A-Z]{3}$/),
            availability: cleanText(offer.availability),
            buyUrl
        };
    };

    return data.products
        .filter(isNewRetailProductListing)
        .filter(isWearableFragranceListing)
        .map(p => {
            const attributes = cleanObject(p.attributes);
            const dimensions = cleanObject(p.dimensions);
            const shippingTiming = cleanObject(p.shippingTiming);
            const comparison = (Array.isArray(p.comparison) ? p.comparison : []).map(cleanOffer).filter(Boolean).slice(0, 12);
            const sourceProductId = cleanText(String(p.sourceProductId || p.id || ''));
            const advertiserId = cleanText(String(p.advertiserId || ''));
            const identityBrand = cleanText(p.brand);
            const brand = identityBrand || 'Unknown Brand';
            const name = cleanText(p.name || p.title, 'Unnamed Product');
            const metadata = inferFragranceMetadata({ ...p, name });
            const gtin = normalizedGtin(p.gtin);
            const mpn = cleanText(Array.isArray(p.mpn) ? p.mpn[0] : p.mpn);
            const offerKey = cleanText(p.offerKey);
            let productKey = cleanText(p.productKey);
            let matchMethod = cleanText(p.matchMethod);
            let matchConfidence = ['exact', 'high', 'retailer', 'estimated'].includes(p.matchConfidence) ? p.matchConfidence : '';
            if (!productKey && gtin) {
                productKey = `gtin:${gtin}`;
                matchMethod = 'GTIN / UPC / EAN';
                matchConfidence = 'exact';
            } else if (!productKey && identityPart(identityBrand) && identityPart(mpn)) {
                productKey = `mpn:${identityPart(identityBrand)}:${identityPart(mpn)}`;
                matchMethod = 'Brand + MPN';
                matchConfidence = 'high';
            } else if (!productKey && identityPart(advertiserId || p.advertiser) && identityPart(sourceProductId)) {
                const catalogId = identityPart(p.catalogId || p.catalog?.id || 'default');
                productKey = `retailer:${identityPart(advertiserId || p.advertiser)}:${catalogId}:${identityPart(sourceProductId)}`;
                matchMethod = 'Retailer product ID';
                matchConfidence = 'retailer';
            }
            matchMethod ||= 'Name and parsed variant';
            matchConfidence ||= 'estimated';
            const clientOfferKey = [
                'retailer',
                'client-v1',
                identityPart(advertiserId || p.advertiser || 'unknown-retailer', 32),
                identityPart(p.catalogId || p.catalog?.id || p.adId || 'default', 48),
                identityPart(sourceProductId || name || 'unknown-product', 70)
            ].join(':');
            const hasRetailerScope = Boolean(
                identityPart(sourceProductId)
                && identityPart(advertiserId || p.advertiser || p.catalogId || p.catalog?.id || p.adId)
            );
            const interactionKey = offerKey
                || (hasRetailerScope ? clientOfferKey : '')
                || productKey
                || clientOfferKey;
            const rawDescription = cleanText(p.description);
            const description = comparableText(rawDescription) === comparableText(name) ? '' : rawDescription;
            return {
            id: String(p.id || `cj_${crypto.randomUUID()}`),
            sourceProductId,
            catalogId: cleanText(String(p.catalogId || '')),
            offerKey,
            productKey,
            interactionKey,
            matchMethod,
            matchConfidence,
            advertiserId,
            adId: cleanText(String(p.adId || '')),
            name,
            brand,
            price: SecurityUtils.validateNumber(p.price, 0, 50000, 0),
            regularPrice: optionalNumber(p.regularPrice, 0, 50000),
            salePrice: optionalNumber(p.salePrice, 0, 50000),
            saleStartsAt: cleanDate(p.saleStartsAt),
            saleEndsAt: cleanDate(p.saleEndsAt),
            rating: optionalNumber(p.rating, 0, 5),
            reviewCount: optionalNumber(p.reviewCount, 0),
            image: SecurityUtils.validateUrl(p.image || stringList(p.additionalImages, 10)[0] || ''),
            description,
            buyUrl: SecurityUtils.validateUrl(p.link || p.cjLink || p.buyUrl || ''),
            shippingCost: optionalNumber(p.shippingCost, 0, 10000),
            shippingCurrency: cleanCode(p.shippingCurrency, /^[A-Z]{3}$/),
            shippingService: cleanText(p.shippingService),
            shippingCountry: cleanCode(p.shippingCountry, /^[A-Z]{2}$/i),
            shipsFromCountry: cleanCode(p.shipsFromCountry, /^[A-Z]{2}$/i),
            shippingTiming: {
                minimumHandlingTime: optionalNumber(shippingTiming.minimumHandlingTime, 0, 365),
                maximumHandlingTime: optionalNumber(shippingTiming.maximumHandlingTime, 0, 365),
                minimumTransitTime: optionalNumber(shippingTiming.minimumTransitTime, 0, 365),
                maximumTransitTime: optionalNumber(shippingTiming.maximumTransitTime, 0, 365)
            },
            advertiser: cleanText(p.advertiser, 'Unknown retailer'),
            advertiserCountry: cleanCode(p.advertiserCountry, /^[A-Z]{2}$/i),
            category: cleanText(p.category, 'Fragrance'),
            googleCategoryId: cleanText(p.googleCategoryId),
            availability: cleanText(p.availability),
            availabilityDate: cleanDate(p.availabilityDate),
            expiresAt: cleanDate(p.expiresAt),
            lastUpdated: cleanDate(p.lastUpdated),
            condition: cleanText(p.condition),
            size: stringList(p.size, 4).length ? stringList(p.size, 4) : metadata.labels,
            canonicalSizeMl: optionalNumber(p.canonicalSizeMl ?? p.normalizedSizeMl, 0.2, 1000) || metadata.canonicalMl,
            unitSizeMl: optionalNumber(p.unitSizeMl, 0.2, 1000),
            totalSizeMl: optionalNumber(p.totalSizeMl, 0.2, 100000),
            sizeSource: cleanText(p.sizeSource) || metadata.source,
            sizeConfidence: cleanText(p.sizeConfidence),
            packCount: optionalNumber(p.packCount ?? p.sizeQuantity, 1, 100) || metadata.packCount,
            fragranceConcentration: cleanText(p.fragranceConcentration || p.concentration) || metadata.concentration,
            fragranceForm: cleanText(p.fragranceForm) || metadata.form,
            presentation: cleanText(p.presentation) || metadata.presentation,
            variantSignature: cleanText(p.variantSignature),
            audience: stringList(p.audience, 4).length ? stringList(p.audience, 4) : metadata.audience,
            ageGroup: cleanText(p.ageGroup),
            productTypes: stringList(p.productTypes || p.productType, 4),
            highlights: stringList(p.highlights, 6),
            additionalImages: stringList(p.additionalImages, 10).map(url => SecurityUtils.validateUrl(url)).filter(Boolean),
            specifications: (Array.isArray(p.specifications) ? p.specifications : []).filter(Boolean).slice(0, 20).map(detail => ({
                section: cleanText(detail?.section),
                name: cleanText(detail?.name),
                value: cleanText(detail?.value)
            })).filter(detail => detail.name && detail.value),
            gtin,
            mpn,
            itemGroupId: cleanText(String(p.itemGroupId || '')),
            variationGroupKey: cleanText(p.variationGroupKey),
            multipack: optionalNumber(p.multipack, 1, 100),
            isBundle: p.isBundle === true,
            unitPricingMeasure: cleanText(p.unitPricingMeasure),
            unitPricingBaseMeasure: cleanText(p.unitPricingBaseMeasure),
            attributes: {
                color: cleanText(attributes.color),
                material: cleanText(attributes.material),
                pattern: cleanText(attributes.pattern)
            },
            dimensions: {
                length: cleanText(dimensions.length),
                width: cleanText(dimensions.width),
                height: cleanText(dimensions.height),
                weight: cleanText(dimensions.weight),
                shippingWeight: cleanText(dimensions.shippingWeight)
            },
            serviceableAreas: stringList(p.serviceableAreas, 30),
            targetCountry: cleanCode(p.targetCountry, /^[A-Z]{2}$/i),
            freeShippingVerified: p.freeShippingVerified === true,
            discountPercent: optionalNumber(p.discountPercent, 0, 100) || 0,
            offerCount: optionalNumber(p.offerCount, 1, 100) || 1,
            bestOffer: p.bestOffer === true,
            comparison,
            currency: cleanCode(p.currency, /^[A-Z]{3}$/, 'USD'),
            dataFreshness: cleanObject(data.dataFreshness),
            isReal: true
        };});
}

// The Worker normally returns one row per retailer offer, but a stale catalog
// index or overlapping feed page can still repeat the same opaque offer key.
// Keep the first (already ranked) row and merge only supplemental media so the
// customer never sees duplicate cards for one offer.
function dedupeCatalogProducts(products) {
    const uniqueProducts = new Map();

    products.forEach((product, index) => {
        const key = productInteractionKey(product) || `unkeyed:${index}`;
        const existing = uniqueProducts.get(key);
        if (!existing) {
            uniqueProducts.set(key, product);
            return;
        }

        uniqueProducts.set(key, {
            ...product,
            ...existing,
            image: existing.image || product.image,
            buyUrl: existing.buyUrl || product.buyUrl,
            additionalImages: [...new Set([
                ...(existing.additionalImages || []),
                ...(product.additionalImages || [])
            ])].filter(Boolean).slice(0, 10)
        });
    });

    return [...uniqueProducts.values()];
}

// ... existing code ...
function initializeFilters(initialBrand = '', initialIntent = currentFilters.intent || parseFragranceSearchIntent('')) {
    const sortByFilter = document.getElementById('sort-by-filter');
    const currencyConverter = document.getElementById('currency-converter');
    const priceRangeFilter = document.getElementById('price-range');
    const shippingFilter = document.getElementById('shipping-filter');
    const availabilityFilter = document.getElementById('availability-filter');
    const countryFilter = document.getElementById('country-filter');
    const exactMatchToggle = document.getElementById('exact-match-toggle');

    if (sortByFilter) sortByFilter.value = 'featured';
    if (currencyConverter) currencyConverter.value = 'USD';
    if (priceRangeFilter) priceRangeFilter.value = 'all';
    if (shippingFilter) shippingFilter.value = 'all';
    if (availabilityFilter) availabilityFilter.value = '';
    if (countryFilter) countryFilter.value = '';
    if (exactMatchToggle) exactMatchToggle.checked = false;
    currentFilters.brand = initialBrand;
    currentFilters.intent = initialIntent;
    updateSearchIntentStatus(initialIntent, initialBrand);
    window.FragranceSelects?.syncAll();
}

// Apply filters and sorting from UI controls
async function clearAllFilters() {
    initializeFilters('', parseFragranceSearchIntent('')); // Set filters to default values
    updatePriceRangeLabels('USD');
    updateBrandUrl('', { resetSearch: true, resetFilters: true });

    const searchInput = document.getElementById('main-search');
    if (searchInput) {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Check if we're in favorites view
    if (isInFavoritesView) {
        // Reset filters and show all favorites
        currentFilters.priceRange = '';
        currentFilters.shipping = '';
        displayFavorites(currentFavorites);
        return;
    }

    currentFilters.search = config.DEFAULT_SEARCH_TERM;
    currentFilters.brand = '';
    currentFilters.intent = parseFragranceSearchIntent('');
    currentPage = 1;
    await applyFilters(true);
}

async function applyFilters(isServerSide = false) {
    try {
        // Get all filter values from the UI (safely handle missing elements)
        const priceFilter = document.getElementById('price-range');
        const shippingFilter = document.getElementById('shipping-filter');

        currentFilters.priceRange = priceFilter ? priceFilter.value : '';
        currentFilters.shipping = shippingFilter ? shippingFilter.value : '';
        syncCatalogFilterUrlFromControls();

        // Check if we're in favorites view
        if (isInFavoritesView) {
            filterFavorites();
            return;
        }

        // Server-side filters trigger a new data fetch from the worker
        if (isServerSide) {
            showLoading();
            // Always fetch from page 1 when a major filter changes
            currentPage = 1;
            const filters = buildServerFilters();
            await loadCJProducts(currentFilters.search, currentPage, null, filters);
        } else {
            // Client-side filters just refine the currently displayed products
            filterPerfumes();
        }
    } catch (error) {
        console.error('Error in applyFilters:', error);
        // Fallback: just try to load products without filters
        if (isServerSide && !isInFavoritesView) {
            showLoading();
            currentPage = 1;
            await loadCJProducts(currentFilters.search, currentPage);
        }
    }
}

// Sort products on the client-side
function sortProducts(products) {
    // Check if we're in favorites view
    if (isInFavoritesView) {
        sortFavorites(currentFavorites);
        return;
    }

    const sortByFilter = document.getElementById('sort-by-filter');

    if (!sortByFilter) {
        // If no sort filter exists, just display products without sorting
        displayProducts(products);
        return;
    }

    const sortBy = sortByFilter.value;
    const targetCurrency = document.getElementById('currency-converter')?.value || 'USD';
    const activeIntent = currentFilters.intent || parseFragranceSearchIntent(currentFilters.search);
    const rankingQuery = activeIntent.textQuery
        || (hasStructuredSearchIntent(activeIntent) ? '' : currentFilters.search);

    products.sort((a, b) => {
        if (sortBy === 'price_low') {
            const priceA = currencyConverter.convertSync(a.price || 0, a.currency || 'USD', targetCurrency);
            const priceB = currencyConverter.convertSync(b.price || 0, b.currency || 'USD', targetCurrency);
            if (!Number.isFinite(priceA)) return Number.isFinite(priceB) ? 1 : compareClientCatalogIdentity(a, b);
            if (!Number.isFinite(priceB)) return -1;
            return priceA - priceB;
        } else if (sortBy === 'price_high') {
            const priceA = currencyConverter.convertSync(a.price || 0, a.currency || 'USD', targetCurrency);
            const priceB = currencyConverter.convertSync(b.price || 0, b.currency || 'USD', targetCurrency);
            if (!Number.isFinite(priceA)) return Number.isFinite(priceB) ? 1 : compareClientCatalogIdentity(a, b);
            if (!Number.isFinite(priceB)) return -1;
            return priceB - priceA;
        } else if (sortBy === 'deals') {
            return (Number(b.discountPercent) || 0) - (Number(a.discountPercent) || 0)
                || (Number(a.price) || 0) - (Number(b.price) || 0);
        } else if (sortBy === 'newest') {
            return (Date.parse(b.lastUpdated || '') || 0) - (Date.parse(a.lastUpdated || '') || 0);
        } else if (sortBy === 'relevance') {
            return calculateClientCatalogRelevance(b, rankingQuery) - calculateClientCatalogRelevance(a, rankingQuery)
                || compareClientCatalogIdentity(a, b);
        } else if (sortBy === 'featured') {
            return calculateClientFeaturedScore(b, rankingQuery) - calculateClientFeaturedScore(a, rankingQuery)
                || compareClientCatalogIdentity(a, b);
        }
        return 0; // Default case
    });

    displayProducts(products);
}

function calculateClientCatalogRelevance(product, query) {
    const normalizedQuery = normalizeSearchIntentText(query);
    if (!normalizedQuery) return 0;
    const title = normalizeSearchIntentText(product.name || product.title);
    const brand = normalizeSearchIntentText(product.brand);
    const supporting = normalizeSearchIntentText([
        product.productTypes,
        product.fragranceConcentration || product.concentration,
        product.presentation
    ].flat().filter(Boolean).join(' '));
    let score = 0;
    if (title.includes(normalizedQuery)) score += 100;
    if (brand.includes(normalizedQuery)) score += 80;
    const genericTerms = new Set(['fragrance', 'perfume', 'parfum', 'cologne', 'eau', 'de', 'spray', 'for', 'men', 'women', 'unisex']);
    [...new Set(normalizedQuery.split(/\s+/).filter(Boolean))].forEach((word) => {
        const weight = genericTerms.has(word) ? 4 : 20;
        if (title.includes(word)) score += weight;
        if (brand.includes(word)) score += genericTerms.has(word) ? 2 : 15;
        if (supporting.includes(word)) score += genericTerms.has(word) ? 1 : 5;
    });
    return score;
}

function calculateClientFeaturedScore(product, query) {
    let score = calculateClientCatalogRelevance(product, query);
    if (/in[ _-]?stock/i.test(product.availability || '')) score += 24;
    if ((Number(product.discountPercent) || 0) > 0) score += 18;
    if (hasVerifiedFreeShipping(product)) score += 8;
    else if (product.shippingCost !== null && product.shippingCost !== undefined) score += 4;
    if (product.gtin) score += 5;
    if ((product.additionalImages?.length || 0) > 1) score += 4;
    if (product.highlights?.length) score += 3;
    return score;
}

function compareClientCatalogIdentity(left, right) {
    return String(left.productKey || left.id || left.name || '')
        .localeCompare(String(right.productKey || right.id || right.name || ''));
}

/**
 * A dedicated function to fetch products from the API worker.
 * This function only handles the network request and returns the data,
 * without updating the UI directly.
 */
async function fetchProductsFromApi(query = '', page = 1, limit = null, filters = {}) {
    try {
        const searchIntent = filters.searchIntent || parseFragranceSearchIntent(query);
        const params = new URLSearchParams({
            q: query || '',
            page: page.toString(),
            limit: (limit || config.RESULTS_PER_PAGE).toString()
        });

        if (filters.lowPrice !== null && filters.lowPrice !== undefined) params.append('lowPrice', filters.lowPrice.toString());
        if (filters.highPrice !== null && filters.highPrice !== undefined) params.append('highPrice', filters.highPrice.toString());
        if (filters.brand) params.append('brand', filters.brand);
        if (filters.shipping) params.append('shipping', filters.shipping);
        if (filters.rating) params.append('rating', filters.rating.toString());
        if (filters.partnerId) params.append('partnerId', filters.partnerId.toString());
        if (filters.sortBy) params.append('sortBy', filters.sortBy);
        if (filters.currency) params.append('currency', filters.currency);
        if (filters.country) params.append('country', filters.country);
        if (filters.availability) params.append('availability', filters.availability);
        if (searchIntent.audience) params.append('audience', SEARCH_INTENT_SLUGS.audience[searchIntent.audience]);
        if (searchIntent.concentration) params.append('concentration', SEARCH_INTENT_SLUGS.concentration[searchIntent.concentration]);
        if (searchIntent.form) params.append('form', SEARCH_INTENT_SLUGS.form[searchIntent.form]);
        if (searchIntent.presentation) params.append('presentation', SEARCH_INTENT_SLUGS.presentation[searchIntent.presentation]);
        if (searchIntent.unitSizeMl !== null) params.append('sizeMl', String(searchIntent.unitSizeMl));
        if (searchIntent.packCount !== null) params.append('packCount', String(searchIntent.packCount));
        if (filters.exactMatch) {
            params.append('exactMatch', filters.exactMatch.toString());
            // Add cache-busting parameter for exact match to ensure fresh results
            params.append('_cb', Date.now().toString());
        }

        const apiUrl = `${config.API_ENDPOINT}/api/products?${params.toString()}`;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(apiUrl, {
            method: 'GET',
            signal: controller.signal
        });

        clearTimeout(timer);

        if (!res.ok) {
            const errorText = await res.text();
            let errorMessage = `API fetch failed (${res.status})`;
            try {
                const errorData = JSON.parse(errorText);
                if (errorData.details) errorMessage += `: ${SecurityUtils.escapeHtml(errorData.details)}`;
            } catch (e) {
                if (errorText && errorText.length < 100) errorMessage += `: ${SecurityUtils.escapeHtml(errorText)}`;
            }
            throw new Error(errorMessage);
        }

        const data = await res.json();
        if (data && data.error) {
            throw new Error(data.error + (data.details ? `: ${SecurityUtils.escapeHtml(data.details)}` : ''));
        }

        return data;

    } catch (error) {
        if (error.name === 'AbortError') {
        } else {
            console.error('API fetch error:', error);
        }
        throw error; // Re-throw to be handled by the caller
    }
}

/**
 * Main function to load products from CJ Affiliate.
 * It now automatically fetches multiple pages if the initial result is too small.
 */
let catalogRequestRevision = 0;

async function loadCJProducts(query = '', page = 1, limit = null, filters = {}) {
    const requestRevision = ++catalogRequestRevision;
    showLoading();

    try {
        let data = await fetchProductsFromApi(query, page, limit, filters);
        // A slower, older request must never overwrite a newer brand search or
        // filter action. This is especially important while the initial catalog
        // request is still in flight.
        if (requestRevision !== catalogRequestRevision) return data;

        const requestedBrand = rememberBrand(
            filters.brand
            || currentFilters.brand
            || recognizedBrandOnlySearch(query)
            || recognizedBrandInSearch(query)
        );
        let rawMappedProducts = mapProductsDataToItems(data);
        let mappedProducts = dedupeCatalogProducts(rawMappedProducts);

        // The deployed Worker can briefly lag behind the browser bundle. Its
        // older brand filter rejects valid aliases such as Christian Dior for
        // a Dior request. If that branded response contains no usable match,
        // retry the same search once without the server brand parameter and
        // enforce the canonical brand below in the browser. This is deliberately
        // non-recursive and never weakens what is rendered to the shopper.
        const shouldRetryWithoutServerBrand = Boolean(filters.brand && requestedBrand)
            && !mappedProducts.some((product) => matchesCatalogBrand(product.brand, requestedBrand));
        if (shouldRetryWithoutServerBrand) {
            try {
                const compatibilityData = await fetchProductsFromApi(query, page, limit, { ...filters, brand: '' });
                if (requestRevision !== catalogRequestRevision) return compatibilityData;
                data = compatibilityData;
                rawMappedProducts = mapProductsDataToItems(data);
                mappedProducts = dedupeCatalogProducts(rawMappedProducts);
            } catch {
                // The original successful empty response is still usable. A
                // best-effort compatibility retry must not turn it into a page
                // level network error when the fallback request alone fails.
            }
        }

        const returnedDuplicateOffers = mappedProducts.length !== rawMappedProducts.length;
        mappedProducts.forEach((product) => rememberBrand(product.brand));
        const responseDiscoveredBrand = !filters.brand && !currentFilters.brand
            ? recognizedBrandOnlySearch(query) || recognizedBrandInSearch(query)
            : '';
        const enforcedBrand = rememberBrand(filters.brand || currentFilters.brand || responseDiscoveredBrand);
        if (responseDiscoveredBrand) {
            currentFilters.brand = responseDiscoveredBrand;
            updateBrandUrl(responseDiscoveredBrand, { preserveIntentParams: true, searchTerm: query });
        }
        const enforcedIntent = filters.searchIntent || currentFilters.intent || parseFragranceSearchIntent(query);
        const returnedUnrelatedBrands = Boolean(enforcedBrand)
            && mappedProducts.some((product) => !matchesCatalogBrand(product.brand, enforcedBrand));
        const returnedIntentMismatches = hasStructuredSearchIntent(enforcedIntent)
            && mappedProducts.some((product) => !matchesProductSearchIntent(product, enforcedIntent));
        const returnedLocalFilterMismatches = mappedProducts.some((product) => !matchesLocalCatalogFilters(product, filters));
        cjProducts = mappedProducts.filter((product) => (
            matchesCatalogBrand(product.brand, enforcedBrand)
            && matchesProductSearchIntent(product, enforcedIntent)
            && matchesLocalCatalogFilters(product, filters)
        ));
        filteredPerfumes = [...cjProducts];
        document.dispatchEvent(new CustomEvent('catalog:updated', {
            detail: { count: cjProducts.length }
        }));

        // Preserve user's currency selection when loading new results
        const currencyConverterDropdown = document.getElementById('currency-converter');
        if (currencyConverterDropdown && filteredPerfumes.length > 0) {
            // Store the current currency selection before any changes
            const userSelectedCurrency = currencyConverterDropdown.value;

            // Only auto-detect currency on the very first load (when no products exist yet)
            if (!cjProducts || cjProducts.length === 0) {
                const defaultCurrency = detectDefaultCurrency(filteredPerfumes);
                currencyConverterDropdown.value = defaultCurrency;
            } else {
                // Preserve the user's currency selection for subsequent loads
                // Ensure the dropdown still shows the user's selection
                currencyConverterDropdown.value = userSelectedCurrency;
            }
        }

        const backendConfirmedBrand = !enforcedBrand
            || normalizeBrandKey(data.filters?.brandFilter) === normalizeBrandKey(enforcedBrand);
        const backendConfirmedIntent = !hasStructuredSearchIntent(enforcedIntent)
            || data.optimization?.structuredIntentApplied === true;
        const backendConfirmedAvailability = !filters.availability
            || normalizeAvailability(data.filters?.availability) === normalizeAvailability(filters.availability);
        const backendConfirmedShipping = !filters.shipping
            || data.filters?.shipping === filters.shipping;
        const backendConfirmedCountry = !filters.country
            || String(data.filters?.country || '').toUpperCase() === String(filters.country).toUpperCase();
        const backendConfirmedExactText = !filters.exactMatch || !enforcedIntent.textQuery
            || data.optimization?.exactMatchApplied === true;
        const backendConfirmedPrice = (filters.lowPrice === null || filters.lowPrice === undefined
                || Number(data.filters?.lowPrice) === Number(filters.lowPrice))
            && (filters.highPrice === null || filters.highPrice === undefined
                || Number(data.filters?.highPrice) === Number(filters.highPrice));
        const hasPriceFilter = filters.lowPrice !== null && filters.lowPrice !== undefined
            || filters.highPrice !== null && filters.highPrice !== undefined;
        const backendConfirmedCurrency = !hasPriceFilter
            || String(data.filters?.currency || '').toUpperCase() === String(filters.currency || '').toUpperCase();
        const backendConfirmedSort = !filters.sortBy
            || data.filters?.sortBy === filters.sortBy
            || data.optimization?.ranking === filters.sortBy;
        const usedClientVerification = shouldRetryWithoutServerBrand || returnedDuplicateOffers || returnedUnrelatedBrands || returnedIntentMismatches || returnedLocalFilterMismatches
            || !backendConfirmedBrand || !backendConfirmedIntent || !backendConfirmedAvailability
            || !backendConfirmedShipping || !backendConfirmedCountry || !backendConfirmedExactText
            || !backendConfirmedPrice || !backendConfirmedCurrency || !backendConfirmedSort;
        const suppliedTotal = Number(data.total);
        const trustworthyTotal = usedClientVerification || !Number.isFinite(suppliedTotal)
            ? cjProducts.length
            : suppliedTotal;
        const paginationState = catalogPaginationFromResponse({
            requestedPage: page,
            requestedLimit: limit || config.RESULTS_PER_PAGE,
            responsePage: data.page,
            responseLimit: data.limit,
            suppliedTotal,
            responseHasMore: data.hasMore,
            clientVerified: usedClientVerification
        });
        currentPage = paginationState.page;
        totalPages = paginationState.totalPages;

        sortProducts(filteredPerfumes);
        displayPagination();
        updateSearchIntentStatus(enforcedIntent, enforcedBrand);

        const searchResultsInfo = document.getElementById('search-results-info');
        if (searchResultsInfo && cjProducts.length > 0) {
            let message;
            const appliedLabels = searchIntentLabels(enforcedIntent, enforcedBrand);

            if (usedClientVerification) {
                const scope = appliedLabels.length ? ` for ${appliedLabels.join(', ')}` : '';
                const pageScope = paginationState.hasMore || currentPage > 1 ? ` on page ${currentPage}` : '';
                message = `Showing ${cjProducts.length} verified matching ${cjProducts.length === 1 ? 'offer' : 'offers'}${scope}${pageScope}.`;
            } else if (data.optimization?.exactMatchApplied) {
                message = `Showing ${cjProducts.length} of ${trustworthyTotal} exact matching offers.`;
            } else {
                message = enforcedBrand
                    ? `Showing ${cjProducts.length} of ${trustworthyTotal} matching ${enforcedBrand} offers.`
                    : hasStructuredSearchIntent(enforcedIntent)
                        ? `Showing ${cjProducts.length} of ${trustworthyTotal} matching offers.`
                        : `Showing ${cjProducts.length} of approximately ${trustworthyTotal} results.`;
            }

            SecurityUtils.setInnerHTML(searchResultsInfo, message);
            searchResultsInfo.hidden = false;
        } else if (searchResultsInfo) {
            searchResultsInfo.hidden = true;
        }

        // Update displayed prices to the selected currency
        const selectedCurrency = document.getElementById('currency-converter')?.value;
        if (selectedCurrency) {
            await updateDisplayedPrices(selectedCurrency);
        }

        return data;

    } catch (error) {
        console.error('CJ API fetch error:', error);
        showStatusMessage('We couldn’t load offers from our retail partners. Check your connection and try again.', true);
        return [];
    } finally {
        if (requestRevision === catalogRequestRevision) hideLoading();
    }
}

// Detect the most common currency in the displayed products
function detectDefaultCurrency(products) {
    if (!products || products.length === 0) return 'USD';

    const currencyCounts = {};
    products.forEach(product => {
        const currency = product.currency || 'USD';
        currencyCounts[currency] = (currencyCounts[currency] || 0) + 1;
    });

    // Find the most common currency
    let mostCommonCurrency = 'USD';
    let maxCount = 0;

    Object.entries(currencyCounts).forEach(([currency, count]) => {
        if (count > maxCount) {
            maxCount = count;
            mostCommonCurrency = currency;
        }
    });

    return mostCommonCurrency;
}

// Update all displayed prices to the selected currency
async function updateDisplayedPrices(targetCurrency) {

    if (!targetCurrency) {
        console.warn('⚠️ No target currency specified');
        return;
    }

    // Check if we're in favorites view
    if (isInFavoritesView) {
        // Favorites retain their original amount/currency as conversion source.
        // displayFavorites derives the selected display currency every time, so
        // sorting or filtering cannot accidentally revert the cards afterward.
        displayFavorites(currentFavorites);
        return;
    }

    // Get all price elements on the page
    const priceElements = document.querySelectorAll('.product-price, .modal-price');

    if (priceElements.length === 0) {
        return;
    }


    // Convert all prices asynchronously
    const conversionPromises = Array.from(priceElements).map(async (element, index) => {
        const originalPrice = element.getAttribute('data-original-price');
        const originalCurrency = element.getAttribute('data-original-currency');

        if (!originalPrice || !originalCurrency) {
            console.warn(`⚠️ Missing price data for element ${index}:`, { originalPrice, originalCurrency });
            return;
        }

        try {
            const convertedPrice = await currencyConverter.convert(
                parseFloat(originalPrice),
                originalCurrency,
                targetCurrency
            );

            if (Number.isFinite(convertedPrice)) {
                const formattedPrice = currencyConverter.formatPrice(convertedPrice, targetCurrency);
                element.textContent = `${formattedPrice} ${targetCurrency}`;
            } else {
                const originalFormatted = currencyConverter.formatPrice(parseFloat(originalPrice), originalCurrency);
                element.textContent = `${originalFormatted} ${originalCurrency}`;
            }
        } catch (error) {
            console.error(`❌ Currency conversion error for element ${index}:`, error);
            // Fallback to original price if conversion fails
            const originalFormatted = currencyConverter.formatPrice(parseFloat(originalPrice), originalCurrency);
            element.textContent = `${originalFormatted} ${originalCurrency}`;
        }
    });

    try {
        // Wait for all conversions to complete
        await Promise.all(conversionPromises);
    } catch (error) {
        console.error('❌ Error during price updates:', error);
    }
}

// Render the current catalog page.
function displayProducts(perfumes) {
    const productsGrid = document.getElementById('products-grid');
    const noResults = document.getElementById('no-results');
    const pagination = document.getElementById('pagination-container');
    if (!productsGrid) return;

    if (perfumes.length === 0) {
        const searchTerm = document.getElementById('main-search')?.value.trim();
        const appliedLabels = searchIntentLabels(buildServerFilters().searchIntent, currentFilters.brand);
        const message = appliedLabels.length
            ? `No retailer offers with verified ${appliedLabels.join(', ')} details were found in the returned catalog. Broader or unknown variants were not substituted.`
            : searchTerm
            ? `We couldn’t find offers for “${searchTerm}”. Try a broader fragrance name or clear your filters.`
            : 'Try a broader fragrance name or clear your filters to explore more retailer offers.';
        showStatusMessage(message);
        return;
    }

    if (noResults) {
        noResults.hidden = true;
        noResults.className = '';
        delete noResults.dataset.catalogState;
    }
    if (pagination) pagination.hidden = false;
    productsGrid.removeAttribute('aria-busy');
    productsGrid.removeAttribute('aria-label');
    const productCards = perfumes.map(perfume => createProductCard(perfume)).join('');
    productsGrid.innerHTML = productCards;

    // Add infinite scroll if enabled
    if (window.infiniteScrollEnabled) {
        // setupInfiniteScroll();
    }

    // Automatically convert prices to the currently selected currency
    const currencyConverter = document.getElementById('currency-converter');
    if (currencyConverter && currencyConverter.value && currencyConverter.value !== 'USD') {
        // Use setTimeout to ensure DOM is updated before converting prices
        setTimeout(() => {
            updateDisplayedPrices(currencyConverter.value).catch(error => {
                console.warn('Auto currency conversion failed:', error);
            });
        }, 100);
    }
}

function displayPagination() {
    const paginationContainer = document.getElementById('pagination-container');
    if (!paginationContainer) return;

    // Don't show total pages to avoid confusion with client-side filtering.
    paginationContainer.innerHTML = `
        <button id="prev-page" class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
        <span class="page-info">Page ${currentPage}</span>
        <button id="next-page" class="pagination-btn" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
    `;

    // displayProducts() hides pagination for an empty verified page. Keep the
    // controls available when an older Worker reports another broad page so a
    // zero-match page does not become a navigation dead end.
    if (currentPage > 1 || totalPages > 1) paginationContainer.hidden = false;

    document.getElementById('prev-page').addEventListener('click', () => changePage(currentPage - 1));
    document.getElementById('next-page').addEventListener('click', () => changePage(currentPage + 1));
}

// Change page
function changePage(page) {
    if (page < 1 || page > totalPages) return;

    currentPage = page;
    const filters = buildServerFilters();
    loadCJProducts(currentFilters.search, currentPage, null, filters).then(() => {
        document.getElementById('shop').scrollIntoView({ behavior: 'smooth' });
    });
}

// Create product card HTML with XSS protection
function formatShipping(perfume) {
    if (hasVerifiedFreeShipping(perfume)) return { text: 'Free shipping at retailer', cls: 'free' };
    if (typeof perfume.shippingCost === 'number') {
        const currency = /^[A-Z]{3}$/.test(perfume.shippingCurrency || '') ? perfume.shippingCurrency : 'USD';
        const symbol = currencySymbols[currency] || '$';
        return { text: `+${symbol}${perfume.shippingCost.toFixed(2)} shipping at retailer`, cls: '' };
    }
    return { text: 'Shipping shown at retailer', cls: 'unknown' };
}

function catalogLabel(value) {
    return String(value || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, letter => letter.toUpperCase())
        .trim();
}

function compactProductType(values) {
    const value = Array.isArray(values) ? values.find(Boolean) : values;
    if (!value) return '';
    return String(value).split(/\s*>\s*|\s*\/\s*/).filter(Boolean).pop().trim();
}

function createAttributeMarkup(perfume) {
    const attributes = [];
    const audience = canonicalAudience(perfume.audience);
    if (audience) attributes.push(audience);
    const concentration = catalogLabel(perfume.fragranceConcentration);
    if (concentration) attributes.push(concentration);
    const form = catalogLabel(perfume.fragranceForm);
    if (form && !attributes.includes(form)) attributes.push(form);
    const presentation = catalogLabel(perfume.presentation);
    if (presentation && presentation !== 'Single Bottle' && !attributes.includes(presentation)) attributes.push(presentation);
    const size = Array.isArray(perfume.size) ? perfume.size.find(Boolean) : perfume.size;
    if (size) attributes.push(String(size));
    const type = compactProductType(perfume.productTypes);
    if (type && !attributes.some(value => value.toLowerCase() === type.toLowerCase())) attributes.push(type);
    return attributes.slice(0, 3).map(value => `<span>${SecurityUtils.escapeHtml(value)}</span>`).join('');
}

function createRatingMarkup(rating, reviewCount) {
    if (typeof rating !== 'number' || !Number.isFinite(rating) || rating <= 0 || rating > 5) return '';
    const safeRating = SecurityUtils.validateNumber(rating, 0, 5, 0);
    const count = Number.isInteger(reviewCount) && reviewCount > 0 ? ` <span class="review-count">(${reviewCount.toLocaleString()})</span>` : '';
    return `<div class="product-rating" role="img" aria-label="Rating: ${safeRating.toFixed(1)} out of 5 stars">
        ${generateStars(safeRating)}
        <span class="rating-number">${safeRating.toFixed(1)}</span>${count}
    </div>`;
}

function createProductCard(perfume) {
    const rating = typeof perfume.rating === 'number' && Number.isFinite(perfume.rating)
        ? SecurityUtils.validateNumber(perfume.rating, 0, 5, 0)
        : null;
    const price = SecurityUtils.validateNumber(perfume.price, 0, 10000, 0);
    const id = String(perfume.id || '');
    const sourceProductId = String(perfume.sourceProductId || id);
    const interactionKey = productInteractionKey(perfume);
    const name = String(perfume.name || 'Unnamed fragrance');
    const brand = String(perfume.brand || 'Unknown brand');
    const currency = /^[A-Z]{3}$/.test(perfume.currency || '') ? perfume.currency : 'USD';
    const imageUrl = SecurityUtils.validateUrl(perfume.image || '') || 'assets/images/fragrance-placeholder.svg';
    const buyUrl = SecurityUtils.validateUrl(perfume.buyUrl || '');
    const safeInteractionKey = SecurityUtils.escapeHtml(interactionKey);
    const safeSourceProductId = SecurityUtils.escapeHtml(sourceProductId);
    const safeName = SecurityUtils.escapeHtml(name);
    const safeBrand = SecurityUtils.escapeHtml(brand);
    const safeCurrency = SecurityUtils.escapeHtml(currency);
    const safeImageUrl = SecurityUtils.escapeHtml(imageUrl);
    const safeBuyUrl = SecurityUtils.escapeHtml(buyUrl);
    const advertiser = String(perfume.advertiser || brand);
    const safeAdvertiser = SecurityUtils.escapeHtml(advertiser);

    const ratingMarkup = createRatingMarkup(rating, perfume.reviewCount);
    const attributeMarkup = createAttributeMarkup(perfume);
    const shipping = formatShipping(perfume);
    const displayPrice = price.toFixed(2);
    const currencySymbol = currencySymbols[currency] || '$';
    const regularPrice = typeof perfume.regularPrice === 'number' && perfume.regularPrice > price ? perfume.regularPrice : null;
    const discountPercent = Number.isFinite(perfume.discountPercent) ? Math.min(Math.max(Math.round(perfume.discountPercent), 0), 100) : 0;
    const isFavorited = userFavorites.has(interactionKey);
    const brandSlug = SecurityUtils.escapeHtml(brand.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    const dealMarkup = buyUrl
        ? `<a href="${safeBuyUrl}" target="_blank" rel="nofollow sponsored noopener" class="btn-view-deal" data-outbound-product="${safeSourceProductId}">Visit retailer <i class="fas fa-arrow-right" aria-hidden="true"></i></a>`
        : '<span class="btn-view-deal is-disabled" aria-disabled="true">Deal unavailable</span>';
    const offerLabel = perfume.offerCount > 1 ? `${perfume.offerCount} retailer offers` : '';
    const badgeMarkup = [
        discountPercent > 0 ? `<span class="product-badge is-sale">${discountPercent}% off</span>` : '',
        perfume.bestOffer && perfume.offerCount > 1 ? '<span class="product-badge">Lowest listed offer</span>' : ''
    ].filter(Boolean).join('');
    const priceMarkup = regularPrice
        ? `<p class="product-price-row"><span class="product-price" data-original-price="${price}" data-original-currency="${safeCurrency}">${currencySymbol}${displayPrice} ${safeCurrency}</span><del>${currencySymbol}${regularPrice.toFixed(2)}</del></p>`
        : `<p class="product-price" data-original-price="${price}" data-original-currency="${safeCurrency}">${currencySymbol}${displayPrice} ${safeCurrency}</p>`;

    // Create perfume object for favorite functionality
    const perfumeData = {
        productId: interactionKey,
        interactionKey,
        offerKey: perfume.offerKey || '',
        productKey: perfume.productKey || '',
        sourceProductId,
        name,
        advertiserName: advertiser,
        brand,
        description: perfume.description || '',
        imageUrl,
        productUrl: buyUrl,
        price: price,
        currency,
        shippingCost: perfume.shippingCost ?? null,
        shipping_availability: hasVerifiedFreeShipping(perfume)
            ? 'available'
            : (typeof perfume.shippingCost === 'number' ? 'paid' : 'unknown')
    };
    favoriteProductData.set(interactionKey, perfumeData);
    catalogProductData.set(interactionKey, { ...perfume, id, sourceProductId, interactionKey, name, brand, advertiser, image: imageUrl, buyUrl, price, currency });

    return `
        <article class="product-card" data-id="${safeInteractionKey}" data-brand="${brandSlug}" data-price="${price}" data-rating="${rating ?? ''}" data-advertiser-id="${SecurityUtils.escapeHtml(perfume.advertiserId || '')}">
            <div class="product-image-container">
                ${badgeMarkup ? `<div class="product-badges">${badgeMarkup}</div>` : ''}
                <button type="button" class="favorite-btn ${isFavorited ? 'favorited' : ''}"
                        data-id="${safeInteractionKey}"
                        aria-pressed="${isFavorited}"
                        aria-label="${isFavorited ? 'Remove from' : 'Add to'} favorites">
                    <i class="fas fa-heart" aria-hidden="true"></i>
                </button>
                <img src="${safeImageUrl}" alt="" class="product-image" width="600" height="600" loading="lazy" decoding="async">
            </div>
            <div class="product-info">
                <h3 class="product-name">${safeName}</h3>
                <p class="product-brand">${safeBrand}</p>
                <p class="product-retailer">Sold by ${safeAdvertiser}</p>
                ${attributeMarkup ? `<div class="product-attributes">${attributeMarkup}</div>` : ''}
                ${ratingMarkup}
                ${priceMarkup}
                ${offerLabel ? `<p class="product-offer-count">${SecurityUtils.escapeHtml(offerLabel)}</p>` : ''}
            </div>
            <div class="product-meta">
                <div class="product-shipping ${shipping.cls}">${shipping.text}</div>
                <div class="product-actions">
                    <button type="button" class="btn-product-details" data-product-details="${safeInteractionKey}" aria-label="View details for ${safeName}">Details</button>
                    ${dealMarkup}
                </div>
            </div>
        </article>
    `;
}

// Create perfume card with favorite button for authenticated users
function createPerfumeCard(perfume) {
    // --- Data Standardization ---
    // The 'perfume' object can come from the API or the local favorites DB,
    // so we need to standardize its structure first.

    // 1. Standardize the ID
    const fragranceId = productInteractionKey(perfume);

    // 2. Standardize the Price and Currency
    const priceAmount = (typeof perfume.price === 'object' && perfume.price !== null)
        ? perfume.price.amount
        : perfume.price;
    const priceCurrency = (typeof perfume.price === 'object' && perfume.price !== null)
        ? perfume.price.currency
        : perfume.currency;
    const normalizedPriceAmount = SecurityUtils.validateNumber(priceAmount, 0, 10_000, 0);
    const requestedDisplayPrice = SecurityUtils.validateNumber(perfume.displayPrice, 0, 10_000, normalizedPriceAmount);
    const displayedPriceAmount = Number.isFinite(requestedDisplayPrice) ? requestedDisplayPrice : normalizedPriceAmount;
    const normalizedPriceCurrency = /^[A-Z]{3}$/.test(String(priceCurrency || '').toUpperCase())
        ? String(priceCurrency).toUpperCase()
        : 'USD';
    const displayedPriceCurrency = /^[A-Z]{3}$/.test(String(perfume.displayCurrency || '').toUpperCase())
        ? String(perfume.displayCurrency).toUpperCase()
        : normalizedPriceCurrency;

    // 3. Create a clean, consistent data object for the toggle function
    const perfumeDataForToggle = {
        ...perfume,
        fragrance_id: fragranceId, // Ensure the correct ID is always present
        price: normalizedPriceAmount,
        currency: normalizedPriceCurrency
    };

    // --- UI Generation ---
    const rating = typeof perfume.rating === 'number' && Number.isFinite(perfume.rating)
        ? SecurityUtils.validateNumber(perfume.rating, 0, 5, 0)
        : null;
    const ratingMarkup = createRatingMarkup(rating, perfume.reviewCount);
    const shipping = formatShipping(perfume);
    const displayPrice = displayedPriceAmount.toFixed(2);
    const currencySymbol = currencySymbols[displayedPriceCurrency] || '$';
    const isFavorited = userFavorites.has(fragranceId);
    const safeId = SecurityUtils.escapeHtml(String(fragranceId || ''));
    const safeName = SecurityUtils.escapeHtml(perfume.name || 'Unnamed fragrance');
    const safeAdvertiser = SecurityUtils.escapeHtml(perfume.advertiserName || 'Unknown retailer');
    const safeImageUrl = SecurityUtils.escapeHtml(SecurityUtils.validateUrl(perfume.imageUrl || '') || 'assets/images/fragrance-placeholder.svg');
    const safeProductUrl = SecurityUtils.escapeHtml(SecurityUtils.validateUrl(perfume.productUrl || ''));
    const dealMarkup = safeProductUrl
        ? `<a href="${safeProductUrl}" target="_blank" rel="nofollow sponsored noopener" class="btn-view-deal">View Deal <i class="fas fa-arrow-right" aria-hidden="true"></i></a>`
        : '<span class="btn-view-deal is-disabled" aria-disabled="true">Retailer link unavailable</span>';
    setFavoriteViewProductData(fragranceId, perfumeDataForToggle);

    return `
        <article class="product-card" data-id="${safeId}" data-brand="${SecurityUtils.escapeHtml((perfume.advertiserName || '').toLowerCase().replace(/\s+/g, '-'))}" data-price="${normalizedPriceAmount}" data-rating="${rating ?? ''}">
            <div class="product-image-container">
                <button type="button" class="favorite-btn ${isFavorited ? 'favorited' : ''}"
                        data-id="${safeId}"
                        aria-pressed="${isFavorited}"
                        aria-label="${isFavorited ? 'Remove from' : 'Add to'} favorites">
                    <i class="fas fa-heart" aria-hidden="true"></i>
                </button>
                <img src="${safeImageUrl}" alt="" class="product-image" width="600" height="600" loading="lazy" decoding="async">
            </div>
            <div class="product-info">
                <h3 class="product-name">${safeName}</h3>
                <p class="product-brand">Saved offer</p>
                <p class="product-retailer">Sold by ${safeAdvertiser}</p>
                ${ratingMarkup}
                <p class="product-price" data-original-price="${normalizedPriceAmount}" data-original-currency="${normalizedPriceCurrency}">${currencySymbol}${displayPrice} ${displayedPriceCurrency}</p>
            </div>
            <div class="product-meta">
                <div class="product-shipping ${shipping.cls}">${shipping.text}</div>
                ${dealMarkup}
            </div>
        </article>
    `;
}

// Generate star rating HTML
function generateStars(rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 !== 0;
    let starsHTML = '';

    for (let i = 0; i < fullStars; i++) {
        starsHTML += '<i class="fa-solid fa-star"></i>';
    }

    if (hasHalfStar) {
        starsHTML += '<i class="fa-solid fa-star-half-stroke"></i>';
    }

    const emptyStars = 5 - Math.ceil(rating);
    for (let i = 0; i < emptyStars; i++) {
        starsHTML += '<i class="fa-regular fa-star"></i>';
    }

    return starsHTML;
}

// Add event listeners
function addEventListeners() {
    // Filter event listeners
    const priceFilter = document.getElementById('price-range');
    const shippingFilter = document.getElementById('shipping-filter');
    const clearFiltersBtn = document.getElementById('clear-filters');
    const mainSearch = document.getElementById('main-search');
    const clearSearchBtn = document.getElementById('clear-search');
    const searchBtn = document.querySelector('.filter-search-btn');
    const browseFragrancesBtn = document.getElementById('browse-fragrances');
    const sortByFilter = document.getElementById('sort-by-filter');
    const recommendationsBtn = document.getElementById('get-recommendations');
    const availabilityFilter = document.getElementById('availability-filter');
    const countryFilter = document.getElementById('country-filter');

    if (priceFilter) {
        priceFilter.addEventListener('change', () => applyFilters(true));
    }

    if (shippingFilter) {
        shippingFilter.addEventListener('change', () => applyFilters(true));
    }

    availabilityFilter?.addEventListener('change', () => applyFilters(true));
    countryFilter?.addEventListener('change', () => applyFilters(true));

    clearFiltersBtn?.addEventListener('click', clearAllFilters);

    sortByFilter?.addEventListener('change', () => {
        syncCatalogFilterUrlFromControls();
        if (isInFavoritesView) {
            sortFavorites(currentFavorites);
        } else {
            applyFilters(true);
        }
    });

    const exactMatchToggle = document.getElementById('exact-match-toggle');
    exactMatchToggle?.addEventListener('change', () => {
        syncCatalogFilterUrlFromControls();
        if (currentFilters.search) applyFilters(true);
    });

    const currencySelect = document.getElementById('currency-converter');
    currencySelect?.addEventListener('change', async () => {
        currencySelect.disabled = true;
        currencySelect.setAttribute('aria-busy', 'true');
        try {
            updatePriceRangeLabels(currencySelect.value);
            syncCatalogFilterUrlFromControls();
            if (priceFilter?.value && priceFilter.value !== 'all') {
                await applyFilters(true);
            } else {
                await updateDisplayedPrices(currencySelect.value);
            }
        } catch {
            showToast('Currency conversion failed. Please try again.', 'error');
        } finally {
            currencySelect.disabled = false;
            currencySelect.removeAttribute('aria-busy');
        }
    });


    if (searchBtn) {
        searchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const searchInput = document.getElementById('main-search');
            if (searchInput) {
                const searchTerm = searchInput.value.trim();
                if (validateSearchTerm(searchTerm)) {
                    performSearch(searchTerm);
                }
            }
        });
    }

    if (mainSearch) {
        const updateClearButton = () => {
            if (clearSearchBtn) clearSearchBtn.hidden = !mainSearch.value.trim();
        };

        mainSearch.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const searchTerm = e.target.value.trim();
                if (validateSearchTerm(searchTerm)) {
                    performSearch(searchTerm);
                }
            }
        });
        mainSearch.addEventListener('input', updateClearButton);
        updateClearButton();
    }

    // Clear search button functionality
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', async function() {
            const mainSearch = document.getElementById('main-search');
            if (mainSearch) {
                mainSearch.value = '';
                mainSearch.focus();
                this.hidden = true;
                currentFilters.search = config.DEFAULT_SEARCH_TERM;
                currentFilters.brand = '';
                currentFilters.intent = parseFragranceSearchIntent('');
                updateSearchIntentStatus(currentFilters.intent, '');
                updateBrandUrl('', { resetSearch: true });
                await applyFilters(true);
            }
        });
    }

    // Removed duplicate click handler that called performSearch() without a term
    // if (searchBtn) {
    //     searchBtn.addEventListener('click', function(e) {
    //         e.preventDefault();
    //         performSearch();
    //     });
    // }

    if (browseFragrancesBtn) {
        browseFragrancesBtn.addEventListener('click', () => {
            document.getElementById('shop').scrollIntoView({ behavior: 'smooth' });
        });
    }

    // Collection Explore buttons functionality
    const collectionButtons = document.querySelectorAll('.collection-btn');
    collectionButtons.forEach(button => {
        button.addEventListener('click', function(event) {
            event.preventDefault();

            // Get the brand name from the data-brand attribute
            const card = event.target.closest('.collection-card');
            const brand = card.getAttribute('data-brand');
            if (!brand) return;

            const canonicalBrand = rememberBrand(brand);
            const searchQuery = canonicalBrand;

            // Scroll to the filter/search section
            const filterSection = document.getElementById('filter');
            if (filterSection) {
                filterSection.scrollIntoView({ behavior: 'smooth' });
            }

            // Set the search input value and perform the search
            const searchInput = document.getElementById('main-search');
            if (searchInput) {
                searchInput.value = searchQuery;
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            currentFilters.search = searchQuery;
            currentFilters.brand = canonicalBrand;
            currentFilters.intent = parseFragranceSearchIntent(searchQuery);
            updateSearchIntentStatus(currentFilters.intent, canonicalBrand);
            updateBrandUrl(canonicalBrand, { searchTerm: searchQuery });
            applyFilters(true);
        });
    });

    // Product card event listeners
    document.addEventListener('click', function(e) {
        const target = e.target;
        const favoriteButton = target.closest('.favorite-btn');
        if (favoriteButton) {
            e.preventDefault();
            const fragranceId = favoriteButton.dataset.id;
            const perfume = favoriteProductData.get(fragranceId);
            if (perfume) toggleFavorite(favoriteButton, perfume);
            return;
        }

    });

    document.addEventListener('error', function(event) {
        const image = event.target;
        if (image instanceof HTMLImageElement && image.classList.contains('product-image') && !image.dataset.fallbackApplied) {
            image.dataset.fallbackApplied = 'true';
            image.src = 'assets/images/fragrance-placeholder.svg';
        }
    }, true);

    if(recommendationsBtn) {
        recommendationsBtn.addEventListener('click', getPersonalizedRecommendations);
    }
}

// Loading bar control functions
function showSearchLoading() {
    const loadingBar = document.getElementById('search-loading-bar');
    if (loadingBar) loadingBar.hidden = false;
}

function hideSearchLoading() {
    const loadingBar = document.getElementById('search-loading-bar');
    if (loadingBar) loadingBar.hidden = true;
}


// Filter favorites based on current filters
function filterFavorites() {

    let filteredFavorites = [...currentFavorites];

    if (currentFilters.brand) {
        const brandKey = normalizeBrandKey(currentFilters.brand);
        filteredFavorites = filteredFavorites.filter((favorite) => normalizeBrandKey(favorite.brand || favorite.advertiserName) === brandKey);
    }

    // Price range filter
    if (currentFilters.priceRange && currentFilters.priceRange !== 'all') {
        const beforeCount = filteredFavorites.length;
        filteredFavorites = filteredFavorites.filter(fav => {
            const price = fav.price || 0;
            const currency = fav.currency || 'USD';
            const priceUSD = currencyConverter.convertSync(price, currency, 'USD');

            if (currentFilters.priceRange.includes('+')) {
                const minPrice = parseInt(currentFilters.priceRange, 10);
                return Number.isFinite(priceUSD) && priceUSD >= minPrice;
            } else if (currentFilters.priceRange.includes('-')) {
                const [low, high] = currentFilters.priceRange.split('-');
                const minPrice = low ? parseInt(low, 10) : 0;
                const maxPrice = high ? parseInt(high, 10) : Infinity;
                return Number.isFinite(priceUSD) && priceUSD >= minPrice && priceUSD <= maxPrice;
            }
            return true;
        });
    }

    // Shipping filter
    if (currentFilters.shipping && currentFilters.shipping !== 'all') {
        const beforeCount = filteredFavorites.length;
        filteredFavorites = filteredFavorites.filter(fav => {
            if (currentFilters.shipping === 'free') {
                const rawShippingCost = fav.shippingCost ?? fav.shipping_cost;
                const shippingCost = rawShippingCost === null || rawShippingCost === undefined
                    ? null
                    : Number(rawShippingCost);
                return fav.shipping_availability === 'available'
                    && (shippingCost === null || shippingCost === 0);
            }
            return true;
        });
    }

    // Sort favorites
    sortFavorites(filteredFavorites);
}

// Sort favorites based on current sort selection
function sortFavorites(favorites) {
    const sortByFilter = document.getElementById('sort-by-filter');
    if (!sortByFilter) {
        displayFavorites(favorites);
        return;
    }

    const sortBy = sortByFilter.value;

    favorites.sort((a, b) => {
        if (sortBy === 'price_low') {
            const priceA = currencyConverter.convertSync(a.price || 0, a.currency || 'USD', 'USD');
            const priceB = currencyConverter.convertSync(b.price || 0, b.currency || 'USD', 'USD');
            if (!Number.isFinite(priceA)) return Number.isFinite(priceB) ? 1 : 0;
            if (!Number.isFinite(priceB)) return -1;
            return priceA - priceB;
        } else if (sortBy === 'price_high') {
            const priceA = currencyConverter.convertSync(a.price || 0, a.currency || 'USD', 'USD');
            const priceB = currencyConverter.convertSync(b.price || 0, b.currency || 'USD', 'USD');
            if (!Number.isFinite(priceA)) return Number.isFinite(priceB) ? 1 : 0;
            if (!Number.isFinite(priceB)) return -1;
            return priceB - priceA;
        } else if (sortBy === 'relevance') {
            const ratingA = typeof a.rating === 'number' ? a.rating : -1;
            const ratingB = typeof b.rating === 'number' ? b.rating : -1;
            return ratingB - ratingA;
        }
        return 0; // Default case - no sorting
    });

    displayFavorites(favorites);
}

// ... existing code ...
function filterPerfumes() {
    let tempProducts = [...cjProducts];
    const searchIntent = currentFilters.intent || parseFragranceSearchIntent(currentFilters.search);

    // Rating filter (client-side)
    if (currentFilters.rating && currentFilters.rating !== 'all') {
        const minRating = Number(currentFilters.rating);
        tempProducts = tempProducts.filter(p => p.rating >= minRating);
    }
    // Shipping filter (client-side)
    if (currentFilters.shipping && currentFilters.shipping !== 'all') {
        tempProducts = tempProducts.filter(p => matchesShipping(p, currentFilters.shipping));
    }
    tempProducts = tempProducts.filter((product) => (
        matchesCatalogBrand(product.brand, currentFilters.brand)
        && matchesProductSearchIntent(product, searchIntent)
    ));
    // Residual product-name words can use fuzzy matching; typed facets such as
    // "men's" and "100 mL" must never be treated as loose title keywords.
    if (searchIntent.textQuery) tempProducts = searchWithFuzzyMatching(tempProducts, searchIntent.textQuery);
    filteredPerfumes = tempProducts;
    sortProducts(filteredPerfumes);
}

// Helper function to check if perfume matches shipping filter
function matchesShipping(perfume, filterVal) {
    if (!filterVal) return true;
    const cost = typeof perfume.shippingCost === 'number' ? perfume.shippingCost : null;
    switch (filterVal) {
        case 'free':
            return hasVerifiedFreeShipping(perfume);
        case 'unknown':
            return cost === null;
        case '20+':
            return cost !== null && cost >= 20;
        default: {
            const [minStr, maxStr] = filterVal.split('-');
            const min = Number(minStr);
            const max = maxStr ? Number(maxStr) : null;
            if (cost === null) return false;
            if (max === null) return cost >= min;
            return cost >= min && cost <= max;
        }
    }
}

function buildServerFilters() {
    const filters = {};
    const priceFilter = document.getElementById('price-range');
    const shippingFilter = document.getElementById('shipping-filter');
    const sortByFilter = document.getElementById('sort-by-filter');
    const exactMatchToggle = document.getElementById('exact-match-toggle');
    const availabilityFilter = document.getElementById('availability-filter');
    const countryFilter = document.getElementById('country-filter');
    const currencyFilter = document.getElementById('currency-converter');
    const priceRange = priceFilter ? priceFilter.value : '';
    const brand = currentFilters.brand;
    const shipping = shippingFilter ? shippingFilter.value : '';
    const sortBy = sortByFilter ? sortByFilter.value : 'featured';
    const exactMatch = exactMatchToggle ? exactMatchToggle.checked : false;
    const availability = availabilityFilter ? availabilityFilter.value : '';
    const country = countryFilter ? countryFilter.value : '';
    const currency = currencyFilter?.value || 'USD';
    const baseIntent = currentFilters.intent || parseFragranceSearchIntent(currentFilters.search);
    const searchIntent = {
        ...baseIntent,
        availability: availability || baseIntent.availability,
        shipping: shipping && shipping !== 'all' ? shipping : baseIntent.shipping
    };

    filters.searchIntent = searchIntent;
    filters.currency = currency;


    if (brand) {
        filters.brand = brand;
    }

    if (priceRange) {
        if (priceRange.includes('+')) {
            filters.lowPrice = parseInt(priceRange, 10);
        } else if (priceRange.includes('-')) {
            const [low, high] = priceRange.split('-');
            filters.lowPrice = low ? parseInt(low, 10) : null;
            filters.highPrice = high ? parseInt(high, 10) : null;
        }
    }

    if (searchIntent.shipping) filters.shipping = searchIntent.shipping;

    if (sortBy) {
        filters.sortBy = sortBy;
    }

    if (exactMatch) {
        filters.exactMatch = exactMatch;
    }

    if (searchIntent.availability) filters.availability = searchIntent.availability;
    if (country) filters.country = country;

    return filters;
}

// Let the newest submission win when someone searches again before an older
// retailer request has finished.
let searchInteractionRevision = 0;

// Polyfill for Element.closest() method for older browsers
if (!Element.prototype.closest) {
    Element.prototype.closest = function(selector) {
        let element = this;
        while (element && element.nodeType === 1) {
            if (element.matches(selector)) {
                return element;
            }
            element = element.parentNode;
        }
        return null;
    };
}

// Polyfill for Element.matches() method for older browsers
if (!Element.prototype.matches) {
    Element.prototype.matches = Element.prototype.msMatchesSelector ||
                                Element.prototype.webkitMatchesSelector;
}

// Initialize dropdowns to default values
function initializeDropdowns(initialBrand = '', initialIntent = currentFilters.intent || parseFragranceSearchIntent('')) {
    const priceFilter = document.getElementById('price-range');
    const shippingFilter = document.getElementById('shipping-filter');
    const sortByFilter = document.getElementById('sort-by-filter');
    const availabilityFilter = document.getElementById('availability-filter');
    const countryFilter = document.getElementById('country-filter');

    if (priceFilter) priceFilter.value = 'all';
    if (shippingFilter) shippingFilter.value = 'all';
    if (sortByFilter) sortByFilter.value = 'featured';
    if (availabilityFilter) availabilityFilter.value = '';
    if (countryFilter) countryFilter.value = '';
    currentFilters.brand = initialBrand;
    currentFilters.intent = initialIntent;
    updateSearchIntentStatus(initialIntent, initialBrand);
    window.FragranceSelects?.syncAll();
}

// Fuzzy search functionality
function fuzzyMatch(str, pattern) {
    if (!pattern) return true;
    if (!str) return false;

    const patternLower = pattern.toLowerCase();
    const strLower = str.toLowerCase();

    // Exact match gets highest priority
    if (strLower.includes(patternLower)) {
        return true;
    }

    // Simple fuzzy matching - check if all pattern characters exist in order
    let patternIndex = 0;
    for (let i = 0; i < strLower.length; i++) {
        if (strLower[i] === patternLower[patternIndex]) {
            patternIndex++;
            if (patternIndex === patternLower.length) {
                return true;
            }
        }
    }

    return false;
}

// Enhanced search with fuzzy matching
function searchWithFuzzyMatching(products, searchTerm) {
    if (!searchTerm || searchTerm.length < 2) {
        return products;
    }

    const normalizedTerm = searchTerm.toLowerCase().trim();

    // Define synonyms for special cases to make client-side search smarter
    const searchSynonyms = {
        'women': ['women', 'woman', 'female', 'femme'],
        'men': ['men', 'man', 'male', 'homme']
    };

    const termsToMatch = searchSynonyms[normalizedTerm] || [normalizedTerm];

    return products.filter(product => {
        const productNameLower = product.name ? product.name.toLowerCase() : '';
        const productBrandLower = product.brand ? product.brand.toLowerCase() : '';

        // Check if any of the terms (original or synonyms) are included
        const synonymMatch = termsToMatch.some(term =>
            productNameLower.includes(term) || productBrandLower.includes(term)
        );

        if (synonymMatch) {
            return true;
        }

        // Fuzzy matching for typos as a fallback
        const nameFuzzy = fuzzyMatch(productNameLower, normalizedTerm);
        const brandFuzzy = fuzzyMatch(productBrandLower, normalizedTerm);

        return nameFuzzy || brandFuzzy;
    });
}

// Validate search term
function validateSearchTerm(term) {
    const trimmed = term.trim();
    return trimmed.length >= 2 && !/^\s*$/.test(trimmed);
}

async function performSearch(searchTerm) {
    // Fallback: if no argument provided, read from input
    if (!searchTerm) {
        const inputEl = document.getElementById('main-search');
        if (inputEl) {
            searchTerm = inputEl.value.trim();
        }
    }
    const validatedSearchTerm = SecurityUtils.validateSearchQuery(searchTerm);
    if (!validateSearchTerm(validatedSearchTerm)) {
        return;
    }
    const searchRevision = ++searchInteractionRevision;
    showSearchLoading(); // Show loading bar

    try {
        currentFilters.search = validatedSearchTerm;
        currentFilters.intent = parseFragranceSearchIntent(validatedSearchTerm);
        currentFilters.brand = recognizedBrandOnlySearch(validatedSearchTerm)
            || recognizedBrandInSearch(validatedSearchTerm);
        updateSearchIntentStatus(currentFilters.intent, currentFilters.brand);
        updateBrandUrl(currentFilters.brand, { searchTerm: validatedSearchTerm });

        // A new search is a server-side filter action
        await applyFilters(true);
    } finally {
        if (searchRevision === searchInteractionRevision) hideSearchLoading();
    }
}

function initializeDeferredRecommendations() {
    // Supplemental catalog modules own their own lazy loading.
}

// ---------------------------------

function commitFavoriteRemoval(fragranceId, triggerButton) {
    const normalizedId = normalizeFavoriteId(fragranceId);
    currentFavorites = currentFavorites.filter((favorite) => productInteractionKey(favorite) !== normalizedId);

    const favoritesGrid = document.getElementById('favorites-grid');
    if (!favoritesGrid) return;
    const matchingCards = [...favoritesGrid.querySelectorAll('.product-card[data-id]')]
        .filter((card) => normalizeFavoriteId(card.dataset.id) === normalizedId);
    const triggerCard = triggerButton?.closest('#favorites-grid .product-card');
    if (triggerCard && !matchingCards.includes(triggerCard)) matchingCards.push(triggerCard);

    matchingCards.forEach((card) => card.classList.add('is-removing'));
    if (!matchingCards.length) return;

    window.setTimeout(() => {
        matchingCards.forEach((card) => card.remove());
        if (currentFavorites.length === 0) displayFavorites([]);
    }, 300);
}

async function toggleFavorite(button, perfume) {

    if (!isAuthenticated()) {
        window.location.href = 'auth.html?tab=signin';
        return;
    }
    const canPersistFavoriteIntent = ensureFavoriteQueueOwner();
    const operationOwner = activeFavoriteOwner;

    const fragranceId = productInteractionKey(perfume);
    if (!fragranceId) {
        console.error('Could not determine a fragrance ID for this favorite action.');
        showToast('Could not update favorite. Please try again.', 'error');
        return;
    }

    // A product may appear in more than one catalog section. Serialize its
    // favorite request so duplicate cards cannot submit opposite operations
    // that arrive at the API out of order.
    if (favoriteRequestsInFlight.has(fragranceId)) return;
    favoriteRequestsInFlight.add(fragranceId);

    const wasFavorited = userFavorites.has(fragranceId);
    const priceAmount = (typeof perfume.price === 'object' && perfume.price !== null) ? perfume.price.amount : perfume.price;
    const priceCurrency = (typeof perfume.price === 'object' && perfume.price !== null) ? perfume.price.currency : perfume.currency;
    const favoriteData = {
        fragrance_id: fragranceId,
        name: perfume.name,
        advertiserName: perfume.advertiserName || perfume.brand || null,
        description: perfume.description || '',
        imageUrl: perfume.imageUrl || perfume.image || null,
        productUrl: perfume.productUrl || perfume.buyUrl || null,
        price: priceAmount,
        currency: priceCurrency,
        shippingCost: perfume.shippingCost ?? null,
        shipping_availability: perfume.shipping_availability || (hasVerifiedFreeShipping(perfume) ? 'available' : 'unknown'),
    };

    // Optimistic update - keep every visible copy of this product in sync.
    favoriteStateRevision += 1;
    setFavoriteState(fragranceId, !wasFavorited);

    // Show loading state
    setFavoriteButtonsBusyForId(fragranceId, true);

    try {
        if (wasFavorited) {
            // Unfavorite logic
            const headers = {};

            const response = await fetch(`${window.API_BASE}/api/user/favorites/${encodeURIComponent(fragranceId)}`, {
                method: 'DELETE',
                headers,
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            if (operationOwner !== activeFavoriteOwner) return;

            pendingFavoriteOperations.delete(fragranceId);
            persistPendingFavoriteOperations();
            commitFavoriteRemoval(fragranceId, button);

        } else {
            // Favorite logic
            const headers = { 'Content-Type': 'application/json' };

            const response = await fetch(`${window.API_BASE}/api/user/favorites`, {
                method: 'POST',
                headers,
                body: JSON.stringify(favoriteData),
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            if (operationOwner !== activeFavoriteOwner) return;
            if (data.success) {
                pendingFavoriteOperations.delete(fragranceId);
                persistPendingFavoriteOperations();
                // Optionally reload favorites if the section is open
                if (!authUI.favoritesSection.hidden) {
                    loadUserFavorites(operationOwner);
                }
            } else {
                throw new Error(data.error || 'Failed to save favorite');
            }
        }
    } catch (error) {
        if (operationOwner !== activeFavoriteOwner) return;
        console.error('❌ Error toggling favorite:', error);

        const isNetworkError = error.message.includes('Failed to fetch') || error.name === 'TypeError';

        // Network failures are queued, so the optimistic state remains truthful to
        // the user's pending intent and survives a refresh through local storage.
        if (isNetworkError && canPersistFavoriteIntent) {
            pendingFavoriteOperations.set(fragranceId, {
                type: wasFavorited ? 'remove' : 'add',
                data: wasFavorited ? null : favoriteData
            });
            persistPendingFavoriteOperations();
            if (wasFavorited) commitFavoriteRemoval(fragranceId, button);
            showToast(
                wasFavorited ? 'Favorite removal will sync when you are online.' : 'Favorite saved and will sync when you are online.',
                'warning'
            );
        } else {
            // The server rejected the operation, so return to its last known state.
            setFavoriteState(fragranceId, wasFavorited);
            showToast('Could not update favorite. Please try again.', 'error');
        }
    } finally {
        if (operationOwner === activeFavoriteOwner) {
            favoriteRequestsInFlight.delete(fragranceId);
            setFavoriteButtonsBusyForId(fragranceId, false);
        }
    }
}

// Helper function to show toast notifications
function showToast(message, type = 'info') {
    // Remove any existing toasts
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) {
        existingToast.remove();
    }

    // Create new toast
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.textContent = message;

    document.body.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 5000);
}

function showFavoritesView({ reload = true } = {}) {
    // Check if user is logged in using shared auth system

    if (!isAuthenticated()) {
        // User is not logged in, redirect to auth page
        window.location.href = 'auth.html?tab=signin';
        return;
    }


    // Set favorites view flag
    isInFavoritesView = true;

    // Hide only the product sections, keep navigation and main content accessible
    const productSections = document.querySelectorAll('.main-content > section:not(#personalized)');
    productSections.forEach(section => {
        // Don't hide sections that contain navigation or are essential for navigation
        if (section.id !== 'filter' && section.id !== 'home') {
            section.hidden = true;
        }
    });

    authUI.favoritesSection.hidden = false;
    if (reload) loadUserFavorites(activeFavoriteOwner);
}

function showMainContentView() {
    // Clear favorites view flag
    isInFavoritesView = false;

    // Show all product sections and main content
    const productSections = document.querySelectorAll('.main-content > section:not(#personalized)');
    productSections.forEach(section => {
        section.hidden = false;
    });

    // Also show main content sections if they exist
    if (authUI.mainContentSections) {
        authUI.mainContentSections.forEach(section => {
            section.hidden = false;
        });
    }

    // Hide favorites section
    authUI.favoritesSection.hidden = true;

}

function showFavoritesState({ title, message, retry = false, error = false }) {
    if (!authUI.favoritesEmptyState) return;
    const heading = document.createElement('h3');
    const description = document.createElement('p');
    heading.textContent = title;
    description.textContent = message;
    authUI.favoritesEmptyState.replaceChildren(heading, description);
    authUI.favoritesEmptyState.classList.toggle('is-error', error);
    authUI.favoritesEmptyState.dataset.state = error ? 'error' : 'empty';

    if (retry) {
        const retryButton = document.createElement('button');
        retryButton.type = 'button';
        retryButton.className = 'fc-catalog-state-primary';
        retryButton.textContent = 'Try again';
        retryButton.addEventListener('click', () => loadUserFavorites(), { once: true });
        authUI.favoritesEmptyState.appendChild(retryButton);
    }

    authUI.favoritesEmptyState.hidden = false;
}

function showFavoritesEmptyState() {
    showFavoritesState({
        title: 'No saved offers yet',
        message: 'Select the heart on any fragrance offer to keep it here.'
    });
}

function showFavoritesLoadError() {
    showFavoritesState({
        title: 'Saved offers are unavailable',
        message: 'We could not load your saved fragrances. Check your connection and try again.',
        retry: true,
        error: true
    });
}

async function loadUserFavorites(expectedOwner = activeFavoriteOwner) {
    if (!expectedOwner || expectedOwner !== activeFavoriteOwner) return;
    const requestRevision = favoriteStateRevision;
    const shouldRenderFavorites = Boolean(authUI.favoritesSection && !authUI.favoritesSection.hidden);
    if (shouldRenderFavorites && authUI.favoritesGrid) {
        authUI.favoritesGrid.setAttribute('aria-busy', 'true');
        if (currentFavorites.length === 0) authUI.favoritesEmptyState.hidden = true;
    }

    try {
        const headers = {};

        const response = await fetch(`${window.API_BASE}/api/user/favorites`, {
            headers,
            credentials: 'include'
        });


        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.success && data.favorites) {
            // Do not let a response that began before a click overwrite the
            // optimistic state for that newer favorite operation or identity.
            if (requestRevision !== favoriteStateRevision || expectedOwner !== activeFavoriteOwner) return;

            userFavorites = reconcileFavoriteIds(data.favorites.map(fav => fav.fragrance_id));
            // Store favorites data for filtering
            currentFavorites = data.favorites;
            if (shouldRenderFavorites) {
                displayFavorites(data.favorites);
            }
            updateAllFavoriteIcons();

        } else {
            throw new Error('Invalid response format');
        }
    } catch (error) {
        if (expectedOwner !== activeFavoriteOwner) return;
        console.error('❌ Error loading user favorites:', error);
        userFavorites = reconcileFavoriteIds(userFavorites);
        updateAllFavoriteIcons();

        // Handle network errors gracefully
        if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {

            // If we have pending operations, show a message about offline mode
            if (pendingFavoriteOperations.size > 0) {
                showToast(`Offline mode - ${pendingFavoriteOperations.size} pending sync(s)`, 'warning');
            } else {
                showToast('Unable to load favorites. Check your connection.', 'warning');
            }

            // Still try to display favorites if we have local data
            if (shouldRenderFavorites && currentFavorites.length > 0) {
                displayFavorites(currentFavorites);
            } else if (shouldRenderFavorites && userFavorites.size > 0) {
                displayFavoritesFromLocal();
            } else if (shouldRenderFavorites) {
                showFavoritesLoadError();
            }
        } else {
            // Server error or other issue
            showToast('Failed to load favorites from server', 'error');
            if (shouldRenderFavorites && currentFavorites.length > 0) displayFavorites(currentFavorites);
            else if (shouldRenderFavorites) showFavoritesLoadError();
        }
    } finally {
        if (expectedOwner === activeFavoriteOwner && shouldRenderFavorites && authUI.favoritesGrid) {
            authUI.favoritesGrid.removeAttribute('aria-busy');
        }
    }
}

// Helper function to display favorites from local cache when offline
function displayFavoritesFromLocal() {
    if (!authUI.favoritesGrid || !authUI.favoritesEmptyState) return;

    authUI.favoritesGrid.innerHTML = '';

    if (userFavorites.size === 0) {
        showFavoritesEmptyState();
        return;
    }

    authUI.favoritesEmptyState.hidden = true;

    // Create basic cards from local data (limited info available)
    let count = 0;
    userFavorites.forEach(fragranceId => {
        if (count >= 50) return; // Limit to prevent too many cards

        const card = document.createElement('div');
        card.className = 'product-card';
        const safeId = SecurityUtils.escapeHtml(String(fragranceId));
        setFavoriteViewProductData(fragranceId, { productId: String(fragranceId), name: 'Cached Item' });
        card.innerHTML = `
            <div class="product-image-container">
                    <img src="assets/images/fragrance-placeholder.svg" alt="" class="product-image" width="300" height="300" loading="lazy" decoding="async">
                <button type="button" class="favorite-btn favorited" data-id="${safeId}" aria-pressed="true" aria-label="Remove from favorites">
                    <i class="fas fa-heart" aria-hidden="true"></i>
                </button>
            </div>
            <div class="product-info">
                <h3 class="product-name">Favorite Item (ID: ${safeId})</h3>
                <p class="product-brand">Cached offline</p>
            </div>
        `;
        authUI.favoritesGrid.appendChild(card);
        count++;
    });

    if (count >= 50) {
        const moreCard = document.createElement('div');
        moreCard.className = 'product-card';
        moreCard.innerHTML = `
            <div class="product-info">
                <h3 class="product-name">And ${userFavorites.size - 50} more...</h3>
                <p class="product-brand">Go online to see all favorites</p>
            </div>
        `;
        authUI.favoritesGrid.appendChild(moreCard);
    }
}

function displayFavorites(favorites) {
    if (!authUI.favoritesGrid || !authUI.favoritesEmptyState) return;

    authUI.favoritesGrid.innerHTML = '';
    if (favorites.length === 0) {
        showFavoritesEmptyState();
    } else {
        authUI.favoritesEmptyState.hidden = true;
        authUI.favoritesEmptyState.classList.remove('is-error');
        delete authUI.favoritesEmptyState.dataset.state;

        // Get the current selected currency to preserve conversion
        const currencySelect = document.getElementById('currency-converter');
        const currentCurrency = currencySelect ? currencySelect.value : 'USD';

        favorites.forEach(fav => {
            // Convert price to current currency if different from original
            let displayPrice = fav.price;
            let displayCurrency = fav.currency;

            if (fav.currency && fav.currency !== currentCurrency && currencySelect) {
                try {
                    const convertedPrice = currencyConverter.convertSync(fav.price || 0, fav.currency || 'USD', currentCurrency);
                    if (Number.isFinite(convertedPrice)) {
                        displayPrice = convertedPrice;
                        displayCurrency = currentCurrency;
                    }
                } catch (error) {
                    console.warn('Failed to convert currency for favorite:', fav.name, error);
                    // Keep original price if conversion fails
                }
            }

            // When displaying favorites, the ID is in fav.fragrance_id
            // We pass it directly to createPerfumeCard
            const perfumeData = {
                ...fav,
                productId: fav.fragrance_id, // Ensure consistency for createPerfumeCard
                displayPrice,
                displayCurrency
            };

            // Re-purposing createPerfumeCard for favorites
            const cardHTML = createPerfumeCard(perfumeData);

            // Convert HTML string to DOM node
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = cardHTML;
            const card = tempDiv.firstElementChild;

            if (card) {
                authUI.favoritesGrid.appendChild(card);
            } else {
                console.error('Failed to render a favorite card.');
            }
        });
    }
}

function updateAllFavoriteIcons() {
    document.querySelectorAll('.favorite-btn').forEach(btn => {
        const fragranceId = normalizeFavoriteId(btn.dataset.id);
        const isFavorited = userFavorites.has(fragranceId);
        btn.classList.toggle('favorited', isFavorited);
        btn.setAttribute('aria-pressed', String(isFavorited));
        btn.setAttribute('aria-label', isFavorited ? 'Remove from favorites' : 'Add to favorites');
    });
}

// --- Personalized Recommendations ---

async function fetchUserPreferences() {
    try {
        const url = `${window.API_BASE}/api/user/preferences`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        });

        if (response.status === 401) {
            // Not logged in, handle gracefully
            return null;
        }

        if (!response.ok) {
            throw new Error(`Failed to fetch preferences: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error fetching user preferences:', error);
        return null; // Return null on error
    }
}

function buildPersonalizedQuery(preferences) {
    if (!preferences) return { query: '', filters: {} };

    let positiveKeywords = [];
    let filters = {};

    // 1. Randomly select 1-2 scent families (instead of all)
    if (preferences.scent_categories && preferences.scent_categories.length > 0) {
        const shuffledScentCategories = [...preferences.scent_categories].sort(() => 0.5 - Math.random());
        const numToSelect = Math.min(Math.floor(Math.random() * 2) + 1, shuffledScentCategories.length); // 1-2 random categories
        const selectedCategories = shuffledScentCategories.slice(0, numToSelect);
        positiveKeywords.push(...selectedCategories);
    }

    // 2. Randomly select 1 preference from intensity, season, occasion
    const otherPrefs = [preferences.intensity, preferences.season, preferences.occasion].filter(Boolean);
    if (otherPrefs.length > 0) {
        const randomIndex = Math.floor(Math.random() * otherPrefs.length);
        let selectedPref = otherPrefs[randomIndex];

        // Handle backward compatibility: convert "work" to "professional"
        if (selectedPref === 'work') {
            selectedPref = 'professional';
        }

        positiveKeywords.push(selectedPref);
    }


    // 4. Budget filter (doesn't add keywords)
    if (preferences.budget_range) {
        const range = preferences.budget_range;
        if (range.includes('-')) {
            const [low, high] = range.split('-').map(p => parseInt(p));
            filters.lowPrice = low;
            filters.highPrice = high;
        } else if (range.startsWith('under-')) {
            filters.highPrice = parseInt(range.replace('under-', ''));
        } else if (range.startsWith('over-')) {
            filters.lowPrice = parseInt(range.replace('over-', ''));
        }
    }

    // 5. Sensitivities filter (client-side, doesn't add keywords)
    if (preferences.sensitivities && preferences.sensitivities.length > 0) {
        filters.sensitivities = preferences.sensitivities;
    }

    // 6. Deduplicate and strictly limit positive keywords to a safe number (3)
    const uniqueKeywords = [...new Set(positiveKeywords)];
    const limitedKeywords = uniqueKeywords.slice(0, 3); // MAX 3 positive keywords for safety


    // 7. Build final query with fragrance perfume at the end
    const coreTerms = 'fragrance perfume';
    const finalQueryString = `${limitedKeywords.join(' ')} ${coreTerms}`;


    const finalQuery = {
        query: finalQueryString,
        filters: filters
    };

    return finalQuery;
}

async function getPersonalizedRecommendations() {

    const personalizedSection = document.getElementById('personalized');
    const resultsGrid = document.getElementById('personalized-results-grid');
    const emptyState = document.getElementById('personalized-empty-state');
    const queryDisplay = document.getElementById('personalized-query-display');

    if (!personalizedSection || !resultsGrid || !emptyState || !queryDisplay) {
        return;
    }

    // Show the section and a loading state
    personalizedSection.hidden = false;
    resultsGrid.innerHTML = '<p>Loading your personalized recommendations...</p>';
    emptyState.hidden = true;
    queryDisplay.hidden = true;

    // Scroll to the section
    personalizedSection.scrollIntoView({ behavior: 'smooth' });

    const responseData = await fetchUserPreferences();

    // Check for the nested 'preferences' object within the response
    if (!responseData || !responseData.success || !responseData.preferences || Object.keys(responseData.preferences).length === 0) {
        // User has no preferences set or is not logged in
        resultsGrid.innerHTML = '';
        emptyState.hidden = false;
        return;
    }

    // Pass the actual preferences object to the build function
    const { query, filters } = buildPersonalizedQuery(responseData.preferences);

    // Query display removed - keeping interface clean

    filters.sortBy = 'featured';

    try {
        const results = await fetchProductsFromApi(query, 1, config.RESULTS_PER_PAGE, filters);

        if (results && results.products.length > 0) {
            // Filter out products without a valid price before displaying
            const validProducts = mapProductsDataToItems(results).filter(p => p.price > 0);

            if (validProducts.length > 0) {
                // Display products in the personalized grid
                const productCards = validProducts.map(p => createProductCard(p)).join('');
                resultsGrid.innerHTML = productCards;

                // Convert prices to the user's selected currency
                const selectedCurrency = document.getElementById('currency-converter')?.value;
                if (selectedCurrency) {
                    await updateDisplayedPrices(selectedCurrency);
                }

            } else {
                resultsGrid.innerHTML = '<p>We found recommendations, but none with valid pricing. Please try adjusting your preferences.</p>';
            }

        } else {
            resultsGrid.innerHTML = '<p>We couldn\'t find any recommendations based on your preferences. Try adjusting them!</p>';
        }
    } catch (error) {
        console.error('Error getting personalized recommendations:', error);
        resultsGrid.innerHTML = '<p>Sorry, something went wrong while fetching your recommendations.</p>';
    }
}

// --- End Personalized Recommendations ---

// A deliberately small integration surface for catalog-features.js. Keeping the
// product map private prevents feature modules from mutating the active results.
window.FragranceCatalog = Object.freeze({
    getProduct(productId) {
        const product = catalogProductData.get(String(productId || ''));
        return product ? structuredClone(product) : null;
    },
    getApiEndpoint() {
        return config.API_ENDPOINT;
    },
    getProducts() {
        return structuredClone(cjProducts);
    },
    isAuthenticated,
    showToast,
    escapeHtml: SecurityUtils.escapeHtml.bind(SecurityUtils),
    validateUrl: SecurityUtils.validateUrl.bind(SecurityUtils)
});
