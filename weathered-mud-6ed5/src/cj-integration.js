const CJ_ENDPOINTS = Object.freeze({
  products: 'https://ads.api.cj.com/query',
  advertisers: 'https://advertiser-lookup.api.cj.com/v2/advertiser-lookup',
  links: 'https://link-search.api.cj.com/v2/link-search',
  programs: 'https://programs.api.cj.com/query',
  itemLists: 'https://graph.cj.com/publishers',
  commissions: 'https://commissions.api.cj.com/query'
});

const DEAL_TYPES = new Set([
  'coupon',
  'sweepstakes',
  'product',
  'sale/discount',
  'free shipping',
  'seasonal link',
  'site to store'
]);

const CJ_CACHE_STALE_RESCUE_SECONDS = 24 * 60 * 60;

function requireCJToken(env) {
  const token = env.CJ_PERSONAL_ACCESS_TOKEN || env.CJ_DEV_KEY;
  if (!token) throw new Error('CJ authentication is not configured.');
  return token;
}

function safeInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

export function getCJCacheStaleRescueSeconds(env = {}) {
  return safeInteger(
    env.CJ_CACHE_STALE_RESCUE_SECONDS,
    CJ_CACHE_STALE_RESCUE_SECONDS,
    15 * 60,
    7 * 24 * 60 * 60
  );
}

function safeText(value, maxLength = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '' || value === 'N/A') return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function decodeXml(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function xmlValue(block, tag, maxLength = 2000) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return safeText(decodeXml(match?.[1] || '').replace(/<[^>]+>/g, ' '), maxLength).replace(/\s+/g, ' ');
}

function xmlBlocks(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...xml.matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'gi'))]
    .map((match) => match[1]);
}

function xmlAttribute(xml, tag, attribute) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<${escapedTag}[^>]*\\s${escapedAttribute}=["']([^"']*)["']`, 'i'));
  return safeText(match?.[1] || '', 40);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('CJ request timed out.'), timeoutMs);
  const externalSignal = options.signal;
  const abortFromExternalSignal = () => controller.abort(externalSignal?.reason || 'CJ request cancelled.');
  if (externalSignal?.aborted) abortFromExternalSignal();
  else externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });
  try {
    // Do not pass the caller's signal through directly: this local controller
    // enforces the per-CJ-call ceiling while also inheriting a shorter
    // request-wide catalog deadline when one is supplied.
    const { signal: _ignoredSignal, ...requestOptions } = options;
    return await fetch(url, { ...requestOptions, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromExternalSignal);
  }
}

export async function fetchCJGraphQL(env, endpoint, query, variables, requestOptions = {}) {
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireCJToken(env)}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ query, variables }),
    signal: requestOptions.signal
  }, requestOptions.timeoutMs);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.errors?.length) {
    const code = payload?.errors?.[0]?.extensions?.code || `HTTP_${response.status}`;
    throw new Error(`CJ GraphQL request failed (${code}).`);
  }
  return payload.data;
}

async function readCache(env, cacheKey, allowExpired = false) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT payload, expires_at, updated_at FROM cj_cache WHERE cache_key = ?`
    ).bind(cacheKey).first();
    if (!row) return null;
    const now = Date.now();
    const expiresAt = new Date(row.expires_at).getTime();
    if (!Number.isFinite(expiresAt)) return null;
    const expired = expiresAt <= now;
    if (expired && !allowExpired) return null;
    if (expired && expiresAt < now - (getCJCacheStaleRescueSeconds(env) * 1000)) return null;
    return { value: JSON.parse(row.payload), updatedAt: row.updated_at, expired };
  } catch {
    return null;
  }
}

async function writeCache(env, cacheKey, value, ttlSeconds) {
  if (!env.DB) return;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  try {
    await env.DB.prepare(`
      INSERT INTO cj_cache (cache_key, payload, expires_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload = excluded.payload,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).bind(cacheKey, JSON.stringify(value), expiresAt.toISOString(), now.toISOString()).run();
  } catch {
    // A cache failure must never turn a valid CJ response into a site failure.
  }
}

export async function withCJCache(env, cacheKey, ttlSeconds, loader, options = {}) {
  const fresh = await readCache(env, cacheKey);
  if (fresh) return { data: fresh.value, cache: 'hit', updatedAt: fresh.updatedAt, stale: false };

  const stale = await readCache(env, cacheKey, true);
  try {
    const data = await loader();
    if (stale && options.preferStale?.(data) === true) {
      return {
        data: stale.value,
        cache: 'stale',
        updatedAt: stale.updatedAt,
        stale: true,
        warning: 'CJ is temporarily unavailable; showing the last successful update.'
      };
    }
    if (options.shouldCache?.(data) !== false) await writeCache(env, cacheKey, data, ttlSeconds);
    return { data, cache: 'miss', updatedAt: new Date().toISOString(), stale: false };
  } catch (error) {
    if (stale) {
      return {
        data: stale.value,
        cache: 'stale',
        updatedAt: stale.updatedAt,
        stale: true,
        warning: 'CJ is temporarily unavailable; showing the last successful update.'
      };
    }
    throw error;
  }
}

async function fetchCJXml(env, url, requestOptions = {}) {
  const response = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${requireCJToken(env)}`,
      Accept: 'application/xml, text/xml'
    },
    signal: requestOptions.signal
  }, requestOptions.timeoutMs);
  const xml = await response.text();
  if (!response.ok || /<error-message>|Not Authenticated/i.test(xml)) {
    throw new Error(`CJ REST request failed (HTTP ${response.status}).`);
  }
  return xml;
}

export async function getCJAdvertisers(env, options = {}) {
  const relationship = options.relationship === 'notjoined' ? 'notjoined' : 'joined';
  const keywords = safeText(options.keywords, 100);
  const page = safeInteger(options.page, 1, 1, 100);
  const pageSize = safeInteger(options.pageSize, 100, 1, 100);
  const cacheKey = `cj:advertisers:${relationship}:${keywords.toLowerCase()}:${page}:${pageSize}`;

  return withCJCache(env, cacheKey, 6 * 60 * 60, async () => {
    const url = new URL(CJ_ENDPOINTS.advertisers);
    url.searchParams.set('requestor-cid', env.CJ_COMPANY_ID);
    url.searchParams.set('advertiser-ids', relationship);
    url.searchParams.set('page-number', String(page));
    url.searchParams.set('records-per-page', String(pageSize));
    if (keywords) url.searchParams.set('keywords', keywords);

    const xml = await fetchCJXml(env, url, options);
    const advertisers = xmlBlocks(xml, 'advertiser').map((block) => ({
      id: xmlValue(block, 'advertiser-id', 40),
      name: xmlValue(block, 'advertiser-name', 200),
      accountStatus: xmlValue(block, 'account-status', 30) || null,
      relationshipStatus: xmlValue(block, 'relationship-status', 30) || null,
      programUrl: safeHttpsUrl(xmlValue(block, 'program-url', 2000)),
      language: xmlValue(block, 'language', 30) || null,
      sevenDayEpc: safeNumber(xmlValue(block, 'seven-day-epc', 50)),
      threeMonthEpc: safeNumber(xmlValue(block, 'three-month-epc', 50)),
      mobileSupported: xmlValue(block, 'mobile-supported', 10).toLowerCase() === 'true',
      mobileTrackingCertified: xmlValue(block, 'mobile-tracking-certified', 10).toLowerCase() === 'true',
      cookielessTrackingEnabled: xmlValue(block, 'cookieless-tracking-enabled', 10).toLowerCase() === 'true',
      networkRank: safeNumber(xmlValue(block, 'network-rank', 20)),
      category: {
        parent: xmlValue(block, 'parent', 100) || null,
        child: xmlValue(block, 'child', 100) || null
      },
      performanceIncentives: xmlValue(block, 'performance-incentives', 10).toLowerCase() === 'true',
      linkTypes: xmlBlocks(block, 'link-type').map((value) => safeText(decodeXml(value).replace(/<[^>]+>/g, ''), 80)).filter(Boolean)
    })).filter((advertiser) => advertiser.id && advertiser.name);

    return {
      advertisers,
      total: safeInteger(xmlAttribute(xml, 'advertisers', 'total-matched'), advertisers.length, 0, 1_000_000),
      page,
      pageSize
    };
  });
}

export async function getCJDeals(env, options = {}) {
  const type = DEAL_TYPES.has(options.type) ? options.type : '';
  const country = /^[A-Z]{2}$/i.test(options.country || '') ? options.country.toUpperCase() : '';
  const keywords = safeText(options.keywords, 100);
  const page = safeInteger(options.page, 1, 1, 100);
  const pageSize = safeInteger(options.pageSize, 100, 1, 100);
  const cacheKey = `cj:deals:${type || 'all'}:${country || 'all'}:${keywords.toLowerCase()}:${page}:${pageSize}`;

  return withCJCache(env, cacheKey, 60 * 60, async () => {
    const url = new URL(CJ_ENDPOINTS.links);
    url.searchParams.set('website-id', env.CJ_WEBSITE_ID);
    url.searchParams.set('advertiser-ids', 'joined');
    url.searchParams.set('page-number', String(page));
    url.searchParams.set('records-per-page', String(pageSize));
    if (type) url.searchParams.set('promotion-type', type);
    if (country) url.searchParams.set('targeted-country', country);
    if (keywords) url.searchParams.set('keywords', keywords);

    const xml = await fetchCJXml(env, url);
    const deals = xmlBlocks(xml, 'link').map((block) => {
      const promotionType = xmlValue(block, 'promotion-type', 60);
      const clickUrl = safeHttpsUrl(xmlValue(block, 'clickUrl', 2000));
      return {
        id: xmlValue(block, 'link-id', 60),
        advertiserId: xmlValue(block, 'advertiser-id', 40),
        advertiserName: xmlValue(block, 'advertiser-name', 200),
        name: xmlValue(block, 'link-name', 300),
        description: xmlValue(block, 'description', 1000),
        category: xmlValue(block, 'category', 120) || null,
        couponCode: xmlValue(block, 'coupon-code', 100) || null,
        promotionType: promotionType && promotionType !== 'N/A' ? promotionType : null,
        startsAt: xmlValue(block, 'promotion-start-date', 80) || null,
        endsAt: xmlValue(block, 'promotion-end-date', 80) || null,
        eventName: xmlValue(block, 'event-name', 120).replace(/^null$/i, '') || null,
        targetCountries: xmlValue(block, 'targeted-countries', 300).replace(/^null$/i, '') || null,
        language: xmlValue(block, 'language', 50) || null,
        linkType: xmlValue(block, 'link-type', 80) || null,
        clickUrl,
        destinationUrl: safeHttpsUrl(xmlValue(block, 'destination', 2000)),
        allowDeepLinking: xmlValue(block, 'allow-deep-linking', 10).toLowerCase() === 'true',
        mobileOptimized: xmlValue(block, 'mobile-optimized', 10).toLowerCase() === 'true',
        crossDevice: xmlValue(block, 'cross-device-only', 10).toLowerCase() === 'true',
        lastUpdated: xmlValue(block, 'last-updated', 80) || null
      };
    }).filter((deal) => deal.id && deal.advertiserName && deal.clickUrl);

    return {
      deals,
      total: safeInteger(xmlAttribute(xml, 'links', 'total-matched'), deals.length, 0, 1_000_000),
      page,
      pageSize
    };
  });
}

const PROGRAM_TERMS_QUERY = `
  query PublisherContracts($publisherId: ID!, $limit: Int, $offset: Int, $filters: ContractFilters) {
    publisher {
      contracts(publisherId: $publisherId, limit: $limit, offset: $offset, filters: $filters) {
        count
        totalCount
        resultList {
          advertiserId
          startTime
          endTime
          status
          programTerms {
            id
            name
            isDefault
            actionTerms {
              id
              referralPeriod
              actionTracker { id name type }
              lockingMethod { type durationInDays }
              commissions {
                rank
                isViewThrough
                rate { type value currency }
                itemList { id name }
                situation { id name }
                promotionalProperties { id name }
              }
              performanceIncentives {
                currency
                reward { commissionType type value }
                threshold { type value }
              }
            }
          }
        }
      }
    }
  }
`;

export async function getCJProgramTerms(env, options = {}) {
  const advertiserId = safeText(options.advertiserId, 40);
  const limit = safeInteger(options.limit, 100, 1, 100);
  const offset = safeInteger(options.offset, 0, 0, 100_000);
  const filters = {};
  if (advertiserId) filters.advertiserId = advertiserId;
  if (options.activeAfter) filters.activeAfter = options.activeAfter;
  if (options.activeBefore) filters.activeBefore = options.activeBefore;
  const cacheKey = `cj:terms:${advertiserId || 'all'}:${options.activeAfter || ''}:${options.activeBefore || ''}:${offset}:${limit}`;

  return withCJCache(env, cacheKey, 6 * 60 * 60, async () => {
    const data = await fetchCJGraphQL(env, CJ_ENDPOINTS.programs, PROGRAM_TERMS_QUERY, {
      publisherId: env.CJ_COMPANY_ID,
      limit,
      offset,
      filters: Object.keys(filters).length ? filters : null
    });
    return data.publisher.contracts;
  });
}

const ITEM_LIST_QUERY = `
  query PublisherItemList($itemListId: ID!, $pageSize: PositiveInt!, $page: PageToken) {
    itemList(itemListId: $itemListId) {
      id
      name
      items(pageSize: $pageSize, page: $page) {
        nextPage
        records { name sku }
      }
    }
  }
`;

export async function getCJItemList(env, itemListId, options = {}) {
  const id = safeText(itemListId, 80);
  if (!id) throw new Error('Item List ID is required.');
  const pageSize = safeInteger(options.pageSize, 1000, 1, 10_000);
  const page = safeText(options.page, 1000) || null;
  const cacheKey = `cj:item-list:${id}:${page || 'first'}:${pageSize}`;
  return withCJCache(env, cacheKey, 24 * 60 * 60, async () => {
    const data = await fetchCJGraphQL(env, CJ_ENDPOINTS.itemLists, ITEM_LIST_QUERY, {
      itemListId: id,
      pageSize,
      page
    });
    return data.itemList;
  });
}

const COMMISSIONS_QUERY = `
  query PublisherCommissions(
    $publisherIds: [String!]!,
    $advertiserIds: [String!],
    $sinceEventDate: String,
    $beforeEventDate: String,
    $sinceCommissionId: String
  ) {
    publisherCommissions(
      forPublishers: $publisherIds,
      advertiserIds: $advertiserIds,
      sinceEventDate: $sinceEventDate,
      beforeEventDate: $beforeEventDate,
      sinceCommissionId: $sinceCommissionId
    ) {
      count
      limit
      maxCommissionId
      payloadComplete
      records {
        commissionId
        advertiserId
        advertiserName
        actionStatus
        actionTrackerName
        actionType
        eventDate
        postingDate
        lockingDate
        validationStatus
        original
        correctionReason
        country
        coupon
        clickDate
        clickReferringURL
        initiatingDeviceType
        concludingDeviceType
        isCrossDevice
        pubCommissionAmountPubCurrency
        pubCommissionAmountUsd
        saleAmountPubCurrency
        saleAmountUsd
        source
        websiteId
        websiteName
        items {
          commissionItemId
          itemListId
          sku
          quantity
          perItemSaleAmountPubCurrency
          perItemSaleAmountUsd
          totalCommissionPubCurrency
          totalCommissionUsd
          situationDetails { id name }
        }
        situationDetails { id name }
      }
    }
  }
`;

export async function getCJCommissions(env, options = {}) {
  const since = options.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const before = options.before || null;
  const advertiserId = safeText(options.advertiserId, 40);
  const sinceCommissionId = safeText(options.sinceCommissionId, 100) || null;
  const data = await fetchCJGraphQL(env, CJ_ENDPOINTS.commissions, COMMISSIONS_QUERY, {
    publisherIds: [env.CJ_COMPANY_ID],
    advertiserIds: advertiserId ? [advertiserId] : null,
    sinceEventDate: since,
    beforeEventDate: before,
    sinceCommissionId
  });
  return data.publisherCommissions;
}

export async function getAllCJCommissions(env, options = {}) {
  const records = [];
  let cursor = options.sinceCommissionId || null;
  let page = 0;
  let payloadComplete = false;
  let lastPayload = null;
  const maxPages = safeInteger(options.maxPages, 12, 1, 50);

  while (page < maxPages) {
    const payload = await getCJCommissions(env, { ...options, sinceCommissionId: cursor });
    lastPayload = payload;
    records.push(...(Array.isArray(payload?.records) ? payload.records : []));
    page += 1;
    if (payload?.payloadComplete) {
      payloadComplete = true;
      break;
    }
    const nextCursor = safeText(payload?.maxCommissionId, 100);
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return {
    ...(lastPayload || {}),
    count: records.length,
    records,
    payloadComplete,
    pagesFetched: page,
    truncated: !payloadComplete
  };
}

export function summarizeCJCommissions(payload) {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const byAdvertiser = new Map();
  const byDay = new Map();
  let commissionUsd = 0;
  let salesUsd = 0;
  let corrected = 0;
  let crossDevice = 0;

  for (const record of records) {
    const commission = safeNumber(record.pubCommissionAmountUsd) || 0;
    const sales = safeNumber(record.saleAmountUsd) || 0;
    commissionUsd += commission;
    salesUsd += sales;
    if (!record.original || record.correctionReason) corrected += 1;
    if (record.isCrossDevice) crossDevice += 1;

    const advertiser = safeText(record.advertiserName, 200) || 'Unknown advertiser';
    const advertiserRow = byAdvertiser.get(advertiser) || { advertiser, actions: 0, salesUsd: 0, commissionUsd: 0 };
    advertiserRow.actions += 1;
    advertiserRow.salesUsd += sales;
    advertiserRow.commissionUsd += commission;
    byAdvertiser.set(advertiser, advertiserRow);

    const day = safeText(record.eventDate, 10) || 'Unknown';
    const dayRow = byDay.get(day) || { day, actions: 0, salesUsd: 0, commissionUsd: 0 };
    dayRow.actions += 1;
    dayRow.salesUsd += sales;
    dayRow.commissionUsd += commission;
    byDay.set(day, dayRow);
  }

  return {
    totals: {
      actions: records.length,
      salesUsd,
      commissionUsd,
      corrected,
      crossDevice,
      averageOrderUsd: records.length ? salesUsd / records.length : 0
    },
    byAdvertiser: [...byAdvertiser.values()].sort((a, b) => b.commissionUsd - a.commissionUsd),
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    recent: records.slice(0, 50).map((record) => ({
      id: record.commissionId,
      advertiser: record.advertiserName,
      status: record.actionStatus,
      validationStatus: record.validationStatus,
      eventDate: record.eventDate,
      postingDate: record.postingDate,
      saleAmountUsd: safeNumber(record.saleAmountUsd),
      commissionUsd: safeNumber(record.pubCommissionAmountUsd),
      coupon: record.coupon || null,
      country: record.country || null,
      isCrossDevice: Boolean(record.isCrossDevice),
      corrected: !record.original || Boolean(record.correctionReason),
      items: (record.items || []).map((item) => ({
        sku: item.sku || null,
        quantity: safeNumber(item.quantity),
        saleAmountUsd: safeNumber(item.perItemSaleAmountUsd),
        commissionUsd: safeNumber(item.totalCommissionUsd)
      }))
    })),
    pagination: {
      payloadComplete: Boolean(payload?.payloadComplete),
      nextCommissionId: payload?.maxCommissionId || null,
      pagesFetched: safeInteger(payload?.pagesFetched, 1, 0, 50),
      truncated: Boolean(payload?.truncated)
    }
  };
}

export { CJ_ENDPOINTS };
