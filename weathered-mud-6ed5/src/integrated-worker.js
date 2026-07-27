import { createSessionCookie, escapeHtml, getSecurityHeaders as buildSecurityHeaders, isOriginAllowed } from './http-security.js';
import {
  getCJAdvertisers,
  getCJCommissions,
  getCJDeals,
  getCJItemList,
  getCJProgramTerms,
  getCJCacheStaleRescueSeconds,
  summarizeCJCommissions,
  withCJCache,
  fetchCJGraphQL
} from './cj-integration.js';

// A map to cache Google's public keys.
// Keys are key IDs, values are the imported CryptoKey objects.
const keyCache = new Map();
let lastKeyFetchTime = 0;
let keyFetchPromise = null;
const KEY_CACHE_TTL = 3600 * 1000; // 1 hour in milliseconds
const GOOGLE_JWKS_TIMEOUT_MS = 8 * 1000;

const PASSWORD_HASH_VERSION = 'pbkdf2-sha512-v1';
const PASSWORD_HASH_ITERATIONS = 240000;
const DUMMY_PASSWORD_HASH = `${PASSWORD_HASH_VERSION}$${PASSWORD_HASH_ITERATIONS}$00112233445566778899aabbccddeeff$5a15ef1cd61b08b55e52569f3619f8ff68e5d2c4155d7fc04e69af8b788031c8e833c76a82135b98e396d4388ac539d0f356a79d402d101ece354f70c10e2442`;
const LEGACY_PBKDF2_ITERATIONS = 100000;
const MAX_PASSWORD_CHARACTERS = 200;
const MAX_PASSWORD_BYTES = 256;
const MAX_JSON_BODY_BYTES = 16 * 1024;
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const EMAIL_VERIFICATION_TTL_MS = 30 * 60 * 1000;
const MAX_ACTIVE_ACCOUNT_TOKENS = 8;
const MAX_ACTIVE_WATCHES = 20;
const MAX_FAVORITES = 200;
const EMAIL_PROVIDER_TIMEOUT_MS = 12 * 1000;
const CLICK_POPULARITY_CACHE_MS = 5 * 60 * 1000;
const clickPopularityCache = new WeakMap();

const CATALOG_CONFIG = {
  // Product Search is deliberately scanned in small pages. A broader result
  // window improves recall without allowing one public request to create an
  // unbounded number of CJ subrequests.
  MAX_UPSTREAM_RESULTS: 600,
  UPSTREAM_PAGE_SIZE: 75,
  MAX_RESULTS_PER_DISCOVERY_BRANCH: 250,
  MAX_DISCOVERY_REQUESTS: 8,
  MAX_DISCOVERY_QUERIES: 4,
  MAX_ADVERTISER_LOOKUP_PAGES: 2,
  DISCOVERY_CONCURRENCY: 3,
  // The browser gives catalog requests 15 seconds. Keep all cold CJ work
  // inside a smaller shared window so filtering/ranking and the response can
  // still complete instead of the client aborting an otherwise valid search.
  DISCOVERY_DEADLINE_MS: 10_500,
  PRODUCT_CACHE_SECONDS: 15 * 60
};

const RELEASE_CONTRACT = Object.freeze({
  apiVersion: '1.2.0',
  schemaVersion: '0006_identity_security'
});
const RELEASE_CAPABILITIES = Object.freeze({
  passwordRecovery: true,
  providerPasswordSetup: true,
  accountDataExport: true,
  dealAlerts: true,
  mailboxVerification: true,
  providerIdentityLinking: true,
  newProductsOnly: true
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (url.hostname === 'www.fragrancecollect.com') {
      url.protocol = 'https:';
      url.hostname = 'fragrancecollect.com';
      url.port = '';
      return new Response(null, {
        status: 308,
        headers: {
          ...securityHeaders(request.headers.get('Origin'), env),
          'Cache-Control': 'public, max-age=3600',
          Location: url.toString()
        }
      });
    }

    if (request.method === 'OPTIONS') {
      return handleOptions(request, env);
    }

    if (path.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method)
      && !validateSiteOrigin(request, env)) {
      return jsonResponse(
        { error: 'Unauthorized origin' },
        403,
        privateSecurityHeaders(request.headers.get('Origin'), env)
      );
    }

    if (path === '/main.html' && (request.method === 'GET' || request.method === 'HEAD')) {
      url.pathname = '/';
      return new Response(null, {
        status: 301,
        headers: { ...securityHeaders(request.headers.get('Origin'), env), Location: url.toString() }
      });
    }

    // --- AUTHENTICATION ENDPOINTS ---
    if (path === '/api/signup/email' && request.method === 'POST') {
      return handleEmailSignup(request, env, ctx);
    }
    if (path === '/api/signup/verify' && request.method === 'POST') {
      return handleVerifyEmail(request, env);
    }
    if (path === '/api/signup/verification/resend' && request.method === 'POST') {
      return handleResendEmailVerification(request, env, ctx);
    }
    if (path === '/api/login/email' && request.method === 'POST') {
      return handleEmailLogin(request, env);
    }
    if (path === '/api/login/google' && request.method === 'POST') {
        return handleGoogleLogin(request, env);
    }
    if (path === '/api/password/forgot' && request.method === 'POST') {
        return handleForgotPassword(request, env, ctx);
    }
    if (path === '/api/password/reset' && request.method === 'POST') {
        return handleResetPassword(request, env);
    }
    if (path === '/api/status' && request.method === 'GET') {
      return handleGetStatus(request, env);
    }
    if (path === '/api/logout' && request.method === 'POST') {
        return handleLogout(request, env);
    }

    // --- API ENDPOINTS ---
    if (path === '/api/products' && request.method === 'GET') {
        return handleProductsRequest(request, url, env, ctx);
    }
    if (path === '/api/deals' && request.method === 'GET') {
        return handleDealsRequest(request, url, env);
    }
    if (path === '/api/advertisers' && request.method === 'GET') {
        return handleAdvertisersRequest(request, url, env);
    }
    if (path === '/api/product-history' && request.method === 'GET') {
        return handleProductHistoryRequest(request, url, env);
    }
    if (path === '/api/outbound-click' && request.method === 'POST') {
        return handleOutboundClick(request, env);
    }
    if (path === '/api/health' && request.method === 'GET') {
          return handleHealthRequest(request, env);
    }
    if (path === '/api/version' && request.method === 'GET') {
          return handleVersionRequest(request, env);
    }

    // --- CONTACT FORM ENDPOINT ---
    if (path === '/api/contact' && request.method === 'POST') {
        return handleContactForm(request, env);
    }

    // --- NEW ACCOUNT FEATURE ENDPOINTS ---
    if (path.startsWith('/api/user/')) {
        if (path === '/api/user/profile' && request.method === 'POST') {
            return handleUpdateProfile(request, env);
        }
        if (path === '/api/user/export' && request.method === 'GET') {
            return handleExportUserData(request, env);
        }
        if (path === '/api/user/password' && request.method === 'POST') {
            return handleChangePassword(request, env);
        }
        if (path === '/api/user/identities/google' && request.method === 'POST') {
            return handleLinkGoogleIdentity(request, env);
        }
        if (path === '/api/user/account' && request.method === 'DELETE') {
            return handleDeleteAccount(request, env);
        }
        if (path === '/api/user/preferences' && request.method === 'GET') {
            return handleGetPreferences(request, env);
        }
        if (path === '/api/user/preferences' && request.method === 'POST') {
            return handleUpdatePreferences(request, env);
        }
        if (path === '/api/user/favorites' && request.method === 'GET') {
            return handleGetFavorites(request, env);
        }
        if (path === '/api/user/favorites' && request.method === 'POST') {
            return handleAddFavorite(request, env);
        }
        if (path.startsWith('/api/user/favorites/') && request.method === 'DELETE') {
            return handleDeleteFavorite(request, env);
        }
        if (path === '/api/user/alerts' && request.method === 'GET') {
            return handleGetDealAlerts(request, env);
        }
        if (path === '/api/user/alerts' && request.method === 'POST') {
            return handleUpsertDealAlert(request, env);
        }
        if (path.startsWith('/api/user/alerts/') && request.method === 'DELETE') {
            return handleDeleteDealAlert(request, env);
        }
    }

    if (path.startsWith('/api/admin/cj/')) {
        return handleCJAdminRequest(request, url, env);
    }

    if (!path.startsWith('/api/') && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    const headers = securityHeaders(request.headers.get('Origin'), env);
    return new Response('Not Found', { status: 404, headers });
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(Promise.all([
      refreshCJReferenceData(env),
      refreshAndNotifyDealAlerts(env),
      cleanupExpiredCredentials(env)
    ]));
  }
};


// --- SECURITY & UTILITY FUNCTIONS ---

function getConfiguredOrigins(env) {
    return env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || '';
}

function environmentFlagEnabled(value) {
    return value === true || String(value || '').trim().toLowerCase() === 'true';
}

function localOriginsEnabled(env) {
    return environmentFlagEnabled(env.ALLOW_LOCAL_ORIGINS) || env.ENVIRONMENT === 'development';
}

function isExplicitLocalRuntimeRequest(request, env) {
    if (!localOriginsEnabled(env) || request.headers.get('CF-Connecting-IP')) return false;
    try {
      const requestUrl = new URL(request.url);
      if (requestUrl.protocol !== 'http:') return false;
      if (['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname)) return true;

      return String(getConfiguredOrigins(env)).split(',').some((value) => {
        try {
          const configured = new URL(value.trim());
          return configured.protocol === 'https:'
            && configured.hostname === requestUrl.hostname
            && configured.port === requestUrl.port;
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
}

function isWranglerRewrittenLocalOrigin(request, env) {
    if (!isExplicitLocalRuntimeRequest(request, env)) return false;
    try {
      const origin = new URL(request.headers.get('Origin'));
      const requestUrl = new URL(request.url);
      return origin.protocol === 'http:' && origin.host === requestUrl.host;
    } catch {
      return false;
    }
}

function securityHeaders(origin, env) {
    return buildSecurityHeaders(origin, getConfiguredOrigins(env), {
      allowLocalOrigins: localOriginsEnabled(env)
    });
}

function privateSecurityHeaders(origin, env) {
    return {
      ...securityHeaders(origin, env),
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache'
    };
}

/**
 * Checks if an IP address has exceeded the rate limit for a specific endpoint.
 * @param {string} ip - The client IP address.
 * @param {string} endpoint - The endpoint name (e.g., 'login').
 * @param {number} limit - The max number of requests allowed.
 * @param {number} windowMs - The time window in milliseconds.
 * @returns {boolean} - True if the request is rate-limited, false otherwise.
 */
async function isRateLimited(env, principal, endpoint, limit, windowMs) {
    const now = Date.now();
    const windowStartMs = now - (now % windowMs);
    const windowStart = new Date(windowStartMs).toISOString();
    const windowEnd = new Date(windowStartMs + windowMs).toISOString();
    const identifier = await sha512(String(principal));
    const id = await sha512(`${identifier}:${endpoint}:${windowStart}`);

    try {
        // The upsert is the only request-path write. Expired-row retention is
        // handled by the scheduled cleanup instead of issuing a broad DELETE
        // for every public request.
        const record = await env.DB.prepare(`
            INSERT INTO rate_limits (id, identifier, endpoint, request_count, window_start, window_end)
            VALUES (?, ?, ?, 1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET request_count = request_count + 1
            RETURNING request_count
        `).bind(id, identifier, endpoint, windowStart, windowEnd).first();
        return Number(record?.request_count || 0) > limit;
    } catch (error) {
        console.error('Durable rate limiter unavailable:');
        return true;
    }
}

async function isAnyRateLimited(env, limits) {
    for (const limit of limits) {
      if (await isRateLimited(env, limit.principal, limit.endpoint, limit.limit, limit.windowMs)) return true;
    }
    return false;
}

function configuredInteger(value, fallback, minimum, maximum) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

async function hasFreshCJCache(env, cacheKey) {
    try {
      const row = await env.DB.prepare(`
        SELECT 1 AS fresh FROM cj_cache WHERE cache_key = ? AND datetime(expires_at) > datetime('now')
      `).bind(cacheKey).first();
      return Boolean(row?.fresh);
    } catch {
      return false;
    }
}

async function pruneCJCache(env) {
    const maxRows = configuredInteger(env.CJ_CACHE_MAX_ROWS, 200, 50, 2000);
    const staleRescueSeconds = getCJCacheStaleRescueSeconds(env);
    try {
      await env.DB.batch([
        env.DB.prepare(`
          DELETE FROM cj_cache
          WHERE expires_at IS NULL
             OR datetime(expires_at) IS NULL
             OR datetime(expires_at) <= datetime('now', ?)
             OR length(payload) > 2000000
        `).bind(`-${staleRescueSeconds} seconds`),
        env.DB.prepare(`
          DELETE FROM cj_cache WHERE cache_key NOT IN (
            SELECT cache_key FROM cj_cache ORDER BY updated_at DESC LIMIT ?
          )
        `).bind(maxRows)
      ]);
    } catch {
      // Cache pruning is best-effort; the upstream budget still limits growth.
    }
}

async function consumeCJUpstreamBudget(env) {
    const limit = configuredInteger(env.CJ_GLOBAL_UPSTREAM_REQUESTS_PER_MINUTE, 60, 10, 300);
    return !await isRateLimited(
      env,
      'global:cj-upstream',
      'cj-upstream-global-v1',
      limit,
      60 * 1000
    );
}

async function consumeOutboundWriteBudget(env) {
    const limit = configuredInteger(env.OUTBOUND_GLOBAL_WRITES_PER_MINUTE, 300, 50, 2000);
    return !await isRateLimited(
      env,
      'global:outbound-click-writes',
      'outbound-click-global-v1',
      limit,
      60 * 1000
    );
}

async function consumeEmailSendBudget(env) {
    const limit = configuredInteger(env.EMAIL_GLOBAL_SENDS_PER_HOUR, 100, 10, 1000);
    return !await isRateLimited(
      env,
      'global:email-sends',
      'email-send-global-v1',
      limit,
      60 * 60 * 1000
    );
}

async function consumeObservationSnapshotBudget(env) {
    const limit = configuredInteger(env.PRODUCT_OBSERVATION_BATCHES_PER_MINUTE, 10, 5, 60);
    return !await isRateLimited(
      env,
      'global:product-observation-batches',
      'product-observation-global-v1',
      limit,
      60 * 1000
    );
}

async function reserveCJBudgetOnCacheMiss(env, cacheKey) {
    if (await hasFreshCJCache(env, cacheKey)) return true;
    await pruneCJCache(env);
    return consumeCJUpstreamBudget(env);
}

function getClientIP(request) {
    return request.headers.get('CF-Connecting-IP') || 'unknown-ip';
}

function ipPrincipal(request) {
    return `ip:${getClientIP(request)}`;
}

function accountPrincipal(value) {
    return `account:${String(value || '').trim().toLowerCase()}`;
}

function isLocalEmailVerificationBypass(request, env) {
    if (!environmentFlagEnabled(env.LOCAL_EMAIL_VERIFICATION_BYPASS)) return false;
    try {
      const hostname = new URL(request.url).hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    } catch {
      return false;
    }
    return isExplicitLocalRuntimeRequest(request, env);
}

/**
 * Validates the format of an email address.
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
    return typeof email === 'string'
      && email.length <= 254
      && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
}

function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Validates password complexity requirements.
 * @param {string} password
 * @returns {{isValid: boolean, errors: string[]}}
 */
function validatePasswordComplexity(password) {
    const errors = [];
    const minLength = 8;

    if (typeof password !== 'string' || password.length < minLength) {
        errors.push(`Password must be at least ${minLength} characters long.`);
    }
    if (typeof password === 'string' && (password.length > MAX_PASSWORD_CHARACTERS || new TextEncoder().encode(password).byteLength > MAX_PASSWORD_BYTES)) {
        errors.push(`Password must be ${MAX_PASSWORD_CHARACTERS} characters or fewer.`);
    }
    if (!/[A-Z]/.test(password || '')) {
        errors.push('Password must contain at least one uppercase letter.');
    }
    if (!/[a-z]/.test(password || '')) {
        errors.push('Password must contain at least one lowercase letter.');
    }
    if (!/\d/.test(password || '')) {
        errors.push('Password must contain at least one number.');
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password || '')) {
        errors.push('Password must contain at least one special character.');
    }

    return {
        isValid: errors.length === 0,
        errors: errors
    };
}


/**
 * Hashes a password using PBKDF2 with a random salt.
 * @param {string} password
 * @returns {Promise<string>} A versioned algorithm, work factor, salt, and hash.
 */
async function hashPasswordPBKDF2(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hashHex = await derivePasswordHash(password, salt, PASSWORD_HASH_ITERATIONS);
    const saltHex = bytesToHex(salt);
    return `${PASSWORD_HASH_VERSION}$${PASSWORD_HASH_ITERATIONS}$${saltHex}$${hashHex}`;
}

async function derivePasswordHash(password, salt, iterations) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations,
            hash: 'SHA-512',
        },
        keyMaterial,
        512
    );
    return bytesToHex(new Uint8Array(derivedBits));
}

/**
 * Verifies a password against a stored PBKDF2 hash.
 * @param {string} password - The plaintext password to verify.
 * @param {string} storedHash - The stored hash, including the salt.
 * @returns {Promise<boolean>} True if the password is correct.
 */
async function verifyPasswordPBKDF2(password, storedHash) {
    return (await verifyPasswordRecord(password, storedHash)).valid;
}

async function verifyPasswordRecord(password, storedHash) {
    if (typeof password !== 'string' || typeof storedHash !== 'string') return { valid: false, needsRehash: false };
    if (password.length > MAX_PASSWORD_CHARACTERS || new TextEncoder().encode(password).byteLength > MAX_PASSWORD_BYTES) {
      return { valid: false, needsRehash: false };
    }

    const versioned = storedHash.split('$');
    if (versioned.length === 4 && versioned[0] === PASSWORD_HASH_VERSION) {
      const iterations = Number.parseInt(versioned[1], 10);
      const salt = hexToBytes(versioned[2]);
      const originalHash = versioned[3];
      if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000 || !salt || !/^[a-f0-9]{128}$/i.test(originalHash)) {
        return { valid: false, needsRehash: false };
      }
      const calculated = await derivePasswordHash(password, salt, iterations);
      return {
        valid: compareHashes(calculated, originalHash.toLowerCase()),
        needsRehash: iterations < PASSWORD_HASH_ITERATIONS
      };
    }

    // Compatibility with the previous `salt:hash` PBKDF2-SHA512 format.
    const legacyPBKDF2 = storedHash.match(/^([a-f0-9]{32}):([a-f0-9]{128})$/i);
    if (legacyPBKDF2) {
      const calculated = await derivePasswordHash(password, hexToBytes(legacyPBKDF2[1]), LEGACY_PBKDF2_ITERATIONS);
      return { valid: compareHashes(calculated, legacyPBKDF2[2].toLowerCase()), needsRehash: true };
    }

    return { valid: false, needsRehash: false };
}

function bytesToHex(bytes) {
    return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value) {
    if (typeof value !== 'string' || value.length % 2 || !/^[a-f0-9]+$/i.test(value)) return null;
    return new Uint8Array(value.match(/../g).map((pair) => Number.parseInt(pair, 16)));
}

function compareHashes(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

function validateSiteOrigin(request, env) {
    return isOriginAllowed(request.headers.get('Origin'), getConfiguredOrigins(env), {
      allowLocalOrigins: localOriginsEnabled(env)
    }) || isWranglerRewrittenLocalOrigin(request, env);
}

function handleOptions(request, env) {
  const origin = request.headers.get('Origin');
  if (!validateSiteOrigin(request, env)) {
    return new Response(null, { status: 403, headers: securityHeaders(null, env) });
  }
  const requestedMethod = String(request.headers.get('Access-Control-Request-Method') || '').toUpperCase();
  if (!['GET', 'POST', 'DELETE'].includes(requestedMethod)) {
    return new Response(null, { status: 405, headers: securityHeaders(origin, env) });
  }
  const requestedHeaders = String(request.headers.get('Access-Control-Request-Headers') || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some((value) => !['content-type', 'x-csrf-token'].includes(value))) {
    return new Response(null, { status: 403, headers: securityHeaders(origin, env) });
  }
  return new Response(null, { status: 204, headers: securityHeaders(origin, env) });
}

function usesPartitionedSessionCookie(request, env) {
    if (!validateSiteOrigin(request, env)) return false;
    try {
      const siteOrigin = new URL(request.headers.get('Origin')).origin;
      const apiOrigin = new URL(request.url).origin;
      return siteOrigin !== apiOrigin && new URL(request.url).protocol === 'https:';
    } catch {
      return false;
    }
}

function sessionCookieValues(request, env, token, maxAgeSeconds) {
    const partitioned = usesPartitionedSessionCookie(request, env);
    if (maxAgeSeconds > 0) {
      const cookies = [
        createSessionCookie('', -1),
        createSessionCookie('', -1, { name: 'session_token' })
      ];
      cookies.push(createSessionCookie(token, maxAgeSeconds, partitioned
        ? { sameSite: 'None', partitioned: true }
        : { sameSite: 'Lax' }));
      return cookies;
    }
    return [
      createSessionCookie('', -1),
      createSessionCookie('', -1, { sameSite: 'None', partitioned: true }),
      createSessionCookie('', -1, { name: 'session_token' })
    ];
}

function setSessionCookie(headers, request, env, token, maxAgeSeconds) {
    headers['Set-Cookie'] = sessionCookieValues(request, env, token, maxAgeSeconds);
}

async function buildSessionRecord(request, userId) {
    const token = generateSecureToken(32);
    const normalizedUserAgent = String(request.headers.get('User-Agent') || 'unknown')
      .trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 300);
    return {
      id: crypto.randomUUID(),
      userId,
      token,
      tokenHash: await sha512(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
      clientIP: null,
      userAgent: null,
      fingerprint: await sha512(`ua:${normalizedUserAgent}`)
    };
}

function prepareSessionInsert(env, session) {
    return env.DB.prepare(`
      INSERT INTO user_sessions (id, user_id, token, expires_at, client_ip, user_agent, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      session.id, session.userId, session.tokenHash, session.expiresAt,
      session.clientIP, session.userAgent, session.fingerprint
    );
}

async function createSession(request, env, userId) {
    const session = await buildSessionRecord(request, userId);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ? AND datetime(expires_at) <= datetime('now')").bind(userId),
      prepareSessionInsert(env, session),
      env.DB.prepare(`
        DELETE FROM user_sessions
        WHERE user_id = ? AND id <> ? AND id NOT IN (
          SELECT id FROM user_sessions
          WHERE user_id = ? AND id <> ?
          ORDER BY last_activity DESC, created_at DESC
          LIMIT 7
        )
      `).bind(userId, session.id, userId, session.id)
    ]);
    return session.token;
}

function getTokenFromRequest(request) {
    const cookieHeader = request.headers.get('Cookie') || '';
    const encodedToken = cookieHeader.split(';').map((part) => part.trim()).find((part) => (
      part.startsWith('__Host-fragrance_session=')
    ))?.slice('__Host-fragrance_session='.length);
    if (!encodedToken) return null;
    try {
      const token = decodeURIComponent(encodedToken);
      return /^[A-Za-z0-9_-]{40,100}$/.test(token) ? token : null;
    } catch {
      return null;
    }
}

async function getValidSession(env, token) {
    const tokenHash = await sha512(token);
    const session = await env.DB.prepare(`
      SELECT s.*, u.email, u.name, u.picture, u.password_hash, u.email_verified_at,
             EXISTS(
               SELECT 1 FROM user_identities i
               WHERE i.user_id = u.id AND i.email_verified_at IS NOT NULL
                 AND i.email = u.email COLLATE NOCASE
             ) AS has_verified_identity,
             EXISTS(
               SELECT 1 FROM user_identities i
               WHERE i.user_id = u.id AND i.provider = 'google' AND i.email_verified_at IS NOT NULL
                 AND i.email = u.email COLLATE NOCASE
             ) AS has_verified_google_identity
      FROM user_sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ? AND u.email_verified_at IS NOT NULL
    `).bind(tokenHash).first();
    if (!session || new Date(session.expires_at) < new Date()) return null;
    return session;
}

async function deleteSession(env, token) {
    await env.DB.prepare(`DELETE FROM user_sessions WHERE token = ?`).bind(await sha512(token)).run();
}

async function touchSession(env, token) {
    await env.DB.prepare(`
      UPDATE user_sessions SET last_activity = CURRENT_TIMESTAMP
      WHERE token = ? AND datetime(last_activity) <= datetime('now', '-5 minutes')
    `).bind(await sha512(token)).run();
}

async function validateSessionSecurity(session, request) {
    const normalizedUserAgent = String(request.headers.get('User-Agent') || 'unknown')
      .trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 300);
    const currentFingerprint = await sha512(`ua:${normalizedUserAgent}`);
    return session.fingerprint === currentFingerprint;
}

async function cleanupUserSessions(env, userId) {
    await env.DB.prepare(`DELETE FROM user_sessions WHERE user_id = ? AND datetime(expires_at) < datetime(?)`)
        .bind(userId, new Date().toISOString())
        .run();
}

async function sha512(str) {
  const buffer = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(str));
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

class RequestBodyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

class EmailSendBudgetError extends Error {
  constructor() {
    super('The email send budget is temporarily exhausted.');
    this.name = 'EmailSendBudgetError';
    this.retryAfter = 60 * 60;
  }
}

class CJUpstreamBudgetError extends Error {
  constructor() {
    super('The global CJ request budget is temporarily exhausted.');
    this.name = 'CJUpstreamBudgetError';
  }
}

class CJDiscoveryDeadlineError extends Error {
  constructor() {
    super('CJ catalog discovery reached its request-wide deadline.');
    this.name = 'CJDiscoveryDeadlineError';
  }
}

function createCJDiscoveryDeadline(env = {}) {
  const durationMs = configuredInteger(
    env.CJ_CATALOG_DISCOVERY_DEADLINE_MS,
    CATALOG_CONFIG.DISCOVERY_DEADLINE_MS,
    3_000,
    12_000
  );
  const controller = new AbortController();
  const deadlineAt = Date.now() + durationMs;
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(new CJDiscoveryDeadlineError());
  };
  const timeout = setTimeout(abort, durationMs);
  return {
    signal: controller.signal,
    remainingMs() {
      return Math.max(0, deadlineAt - Date.now());
    },
    get expired() {
      return controller.signal.aborted || Date.now() >= deadlineAt;
    },
    abort,
    close() {
      clearTimeout(timeout);
    }
  };
}

function isCJDiscoveryDeadlineError(error) {
  return error instanceof CJDiscoveryDeadlineError
    || error?.name === 'CJDiscoveryDeadlineError'
    || error === 'CJ catalog discovery reached its request-wide deadline.';
}

async function settleWithinCJDiscoveryDeadline(task, deadline) {
  if (!deadline) return task;
  if (deadline.expired) throw new CJDiscoveryDeadlineError();
  const work = Promise.resolve(task);
  // The race observes late rejection as well, so a misbehaving upstream mock
  // (or a network stack that settles after abort) cannot produce an unhandled
  // rejection after this request has already returned.
  work.catch(() => {});
  let timeout;
  const timedOut = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      deadline.abort?.();
      reject(new CJDiscoveryDeadlineError());
    }, deadline.remainingMs());
  });
  try {
    return await Promise.race([work, timedOut]);
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonBody(request, maxBytes = MAX_JSON_BODY_BYTES) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new RequestBodyError('Content-Type must be application/json.', 415);
  }
  const declaredLength = Number.parseInt(request.headers.get('Content-Length') || '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyError('Request body is too large.', 413);
  }
  if (!request.body) throw new RequestBodyError('Request body must be a valid JSON object.', 400);
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel('request body limit exceeded').catch(() => {});
      throw new RequestBodyError('Request body is too large.', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let raw;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new RequestBodyError('Request body must be valid UTF-8.', 400);
  }
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value;
  } catch {
    throw new RequestBodyError('Request body must be a valid JSON object.', 400);
  }
}

function bodyErrorResponse(error, headers) {
  return error instanceof RequestBodyError
    ? jsonResponse({ error: error.message }, error.status, headers)
    : null;
}

async function enforceMinimumDuration(startedAt, minimumMs) {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

function scheduleBackgroundTask(ctx, taskFactory, failureMessage) {
  // Defer invoking the factory as well as awaiting it. This keeps provider
  // latency out of public response timing and gives every waitUntil promise an
  // internal rejection handler, so a provider outage cannot become an
  // unhandled Worker rejection.
  const task = Promise.resolve()
    .then(taskFactory)
    .catch(() => {
      console.error(failureMessage);
    });
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
  return task;
}

function jsonResponse(data, status = 200, headers = {}) {
  const cookieValues = Array.isArray(headers['Set-Cookie'])
    ? headers['Set-Cookie']
    : (headers['Set-Cookie'] ? [headers['Set-Cookie']] : []);
  const headerValues = { ...headers };
  delete headerValues['Set-Cookie'];
  const finalHeaders = new Headers(headerValues);
  finalHeaders.set('Content-Type', 'application/json');
  for (const cookie of cookieValues) finalHeaders.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers: finalHeaders });
}

// --- AUTHENTICATION FUNCTIONS ---

async function handleEmailSignup(request, env, ctx) {
    const responseStartedAt = Date.now();
    const origin = request.headers.get('Origin');
    if (!validateSiteOrigin(request, env)) {
        return jsonResponse({ error: 'Unauthorized origin' }, 403, privateSecurityHeaders(origin, env));
    }

    const headers = privateSecurityHeaders(origin, env);
    if (await isRateLimited(env, ipPrincipal(request), 'signup-ip', 6, 60 * 60 * 1000)) {
        return jsonResponse({ error: 'Too many signup attempts. Please try again later.' }, 429, headers);
    }
    const localVerificationBypass = isLocalEmailVerificationBypass(request, env);
    if ((!env.RESEND_API_KEY || !env.RESEND_FROM) && !localVerificationBypass) {
        return jsonResponse({ error: 'Email verification is temporarily unavailable.' }, 503, headers);
    }

    try {
        const body = await readJsonBody(request);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const email = normalizeEmail(body.email);
        const password = typeof body.password === 'string' ? body.password : '';
        if (!name || !email || !password) return jsonResponse({ error: 'Name, email, and password are required.' }, 400, headers);
        if (name.length > 100) return jsonResponse({ error: 'Name must be 100 characters or fewer.' }, 400, headers);

        if (!isValidEmail(email)) {
            return jsonResponse({ error: 'Invalid email format.' }, 400, headers);
        }

        if (await isRateLimited(env, accountPrincipal(email), 'signup-account', 4, 60 * 60 * 1000)) {
            return jsonResponse({ error: 'Too many signup attempts. Please try again later.' }, 429, headers);
        }

        const passwordValidation = validatePasswordComplexity(password);
        if (!passwordValidation.isValid) {
            return jsonResponse({ error: 'Password does not meet complexity requirements.', details: passwordValidation.errors }, 400, headers);
        }

        // Perform the expensive password work before the existence branch so a
        // caller cannot distinguish registered mailboxes by KDF timing.
        const passwordHash = await hashPasswordPBKDF2(password);
        const existingUser = await env.DB.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').bind(email).first();
        if (existingUser) {
          await enforceMinimumDuration(responseStartedAt, 600);
          return jsonResponse({
            success: true,
            pendingVerification: true,
            verificationRequired: true,
            message: 'If this address is eligible, check its inbox for the next account step.'
          }, 202, headers);
        }

        const userId = crypto.randomUUID();
        const verificationToken = generateSecureToken();
        const tokenHash = await sha512(verificationToken);
        const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString();
        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO users (id, name, email, password_hash, created_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          `).bind(userId, name, email, passwordHash),
          env.DB.prepare(`
            INSERT INTO user_identities (id, user_id, provider, provider_subject, email)
            VALUES (?, ?, 'password', ?, ?)
          `).bind(crypto.randomUUID(), userId, email, email),
          env.DB.prepare(`
            INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
            VALUES (?, ?, ?, ?)
          `).bind(crypto.randomUUID(), userId, tokenHash, expiresAt)
        ]);

        if (!localVerificationBypass) {
          scheduleBackgroundTask(
            ctx,
            () => sendEmailVerificationEmail({ id: userId, name, email }, verificationToken, env),
            'Signup verification delivery failed.'
          );
        }

        await enforceMinimumDuration(responseStartedAt, 600);
        return jsonResponse({
          success: true,
          pendingVerification: true,
          verificationRequired: true,
          message: localVerificationBypass
            ? 'Local verification token issued.'
            : 'If this address is eligible, check its inbox for the next account step.',
          ...(localVerificationBypass ? { verificationToken } : {})
        }, 202, headers);
    } catch (error) {
        const bodyResponse = bodyErrorResponse(error, headers);
        if (bodyResponse) return bodyResponse;
        console.error('Error during email signup:');
        return jsonResponse({ error: 'Signup failed.' }, 500, headers);
    }
}

async function handleEmailLogin(request, env) {
    const origin = request.headers.get('Origin');
    if (!validateSiteOrigin(request, env)) {
        return jsonResponse({ error: 'Unauthorized origin' }, 403, privateSecurityHeaders(origin, env));
    }
    const headers = privateSecurityHeaders(origin, env);
    if (await isRateLimited(env, ipPrincipal(request), 'login-ip', 15, 15 * 60 * 1000)) {
        return jsonResponse({ error: 'Too many login attempts. Please try again later.' }, 429, headers);
    }

    try {
        const body = await readJsonBody(request);
        const email = normalizeEmail(body.email);
        const password = typeof body.password === 'string' ? body.password : '';
        if (!email || !password) return jsonResponse({ error: 'Email and password are required.' }, 400, headers);
        if (!isValidEmail(email) || password.length > MAX_PASSWORD_CHARACTERS || new TextEncoder().encode(password).byteLength > MAX_PASSWORD_BYTES) {
          return jsonResponse({ error: 'Invalid email or password.' }, 401, headers);
        }
        if (await isRateLimited(env, accountPrincipal(email), 'login-account', 10, 15 * 60 * 1000)) {
          return jsonResponse({ error: 'Too many login attempts. Please try again later.' }, 429, headers);
        }

        const user = await env.DB.prepare(`
          SELECT u.*,
                 EXISTS(
                   SELECT 1 FROM user_identities i
                   WHERE i.user_id = u.id AND i.provider = 'google'
                     AND i.email_verified_at IS NOT NULL
                     AND i.email = u.email COLLATE NOCASE
                 ) AS has_google_identity
          FROM users u WHERE u.email = ? COLLATE NOCASE
        `).bind(email).first();
        const passwordHash = user?.password_hash || DUMMY_PASSWORD_HASH;
        const passwordResult = await verifyPasswordRecord(password, passwordHash);
        if (!user?.password_hash || !passwordResult.valid) {
            return jsonResponse({ error: 'Invalid email or password.' }, 401, headers);
        }
        if (passwordResult.needsRehash) {
          const newHash = await hashPasswordPBKDF2(password);
          await env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .bind(newHash, user.id).run();
        }

        if (!user.email_verified_at) {
          return jsonResponse({
            error: 'Verify your email before signing in.',
            code: 'email_verification_required',
            verificationRequired: true
          }, 403, headers);
        }

        const token = await createSession(request, env, user.id);
        setSessionCookie(headers, request, env, token, SESSION_TTL_SECONDS);

        return jsonResponse({
          success: true,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            picture: user.picture,
            hasPassword: true,
            hasGoogleIdentity: Boolean(user.has_google_identity),
            identityLinkRequired: false,
            emailVerified: true
          }
        }, 200, headers);
    } catch (error) {
        const bodyResponse = bodyErrorResponse(error, headers);
        if (bodyResponse) return bodyResponse;
        console.error('Error during email login:');
        return jsonResponse({ error: 'Login failed.' }, 500, headers);
    }
}

function generateSecureToken(byteLength = 32) {
    const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sendResendEmail(payload, env) {
    if (!env.RESEND_API_KEY?.startsWith('re_')) {
        throw new Error('Email service is not configured.');
    }

    // Reserve from one durable, installation-wide budget immediately before
    // the provider call. This covers contact, recovery, verification, and
    // scheduled watch mail rather than only limiting each public caller IP.
    if (!await consumeEmailSendBudget(env)) throw new EmailSendBudgetError();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMAIL_PROVIDER_TIMEOUT_MS);
    try {
      const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Email provider rejected the request.');
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Email provider timed out.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
}

async function sendPasswordResetEmail(user, resetToken, env) {
    const siteUrl = env.PUBLIC_SITE_URL || 'https://fragrancecollect.com';
    const resetUrl = new URL('/auth.html', siteUrl);
    // Keep one-time credentials out of request URLs, proxy logs, referrers,
    // analytics, and the HTTP cache key. The browser reads the fragment.
    resetUrl.hash = new URLSearchParams({ reset_token: resetToken }).toString();
    const sender = env.RESEND_FROM || 'Fragrance Collect <support@fragrancecollect.com>';
    const safeName = escapeHtml(user.name || 'there');
    const safeResetUrl = escapeHtml(resetUrl.toString());

    await sendResendEmail({
        from: sender,
        to: [user.email],
        subject: 'Reset your Fragrance Collect password',
        html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;color:#222;max-width:560px;margin:auto;padding:24px">
                <h1 style="font-size:24px">Reset your password</h1>
                <p>Hello ${safeName},</p>
                <p>Use the secure link below to choose a new Fragrance Collect password. The link expires in 30 minutes and can only be used once.</p>
                <p><a href="${safeResetUrl}" style="display:inline-block;padding:12px 20px;background:#C9A646;color:#121212;text-decoration:none;border-radius:6px;font-weight:bold">Reset password</a></p>
                <p>If you did not request this, you can ignore this message. Your password has not changed.</p>
            </div>
        `
    }, env);
}

async function sendEmailVerificationEmail(user, verificationToken, env) {
    const siteUrl = env.PUBLIC_SITE_URL || 'https://fragrancecollect.com';
    const verifyUrl = new URL('/auth.html', siteUrl);
    verifyUrl.hash = new URLSearchParams({ verify_token: verificationToken }).toString();
    const sender = env.RESEND_FROM || 'Fragrance Collect <support@fragrancecollect.com>';
    const safeName = escapeHtml(user.name || 'there');
    const safeVerifyUrl = escapeHtml(verifyUrl.toString());

    await sendResendEmail({
      from: sender,
      to: [user.email],
      subject: 'Verify your Fragrance Collect email',
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#222;max-width:560px;margin:auto;padding:24px">
          <h1 style="font-size:24px">Verify your email</h1>
          <p>Hello ${safeName},</p>
          <p>Confirm this mailbox to finish creating your Fragrance Collect account. This one-time link expires in 30 minutes.</p>
          <p><a href="${safeVerifyUrl}" style="display:inline-block;padding:12px 20px;background:#C9A646;color:#121212;text-decoration:none;border-radius:6px;font-weight:bold">Verify email</a></p>
          <p>If you did not create this account, you can ignore this message.</p>
        </div>`
    }, env);
}

async function handleVerifyEmail(request, env) {
    const origin = request.headers.get('Origin');
    const headers = privateSecurityHeaders(origin, env);
    if (!validateSiteOrigin(request, env)) {
      return jsonResponse({ error: 'Unauthorized origin' }, 403, headers);
    }
    if (await isRateLimited(env, ipPrincipal(request), 'email-verify-ip', 20, 60 * 60 * 1000)) {
      return jsonResponse({ error: 'Too many verification attempts. Please try again later.' }, 429, headers);
    }

    try {
      const body = await readJsonBody(request);
      const token = typeof body.token === 'string' ? body.token.trim() : '';
      if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
        return jsonResponse({ error: 'This verification link is invalid or expired.' }, 400, headers);
      }
      const tokenHash = await sha512(token);
      if (await isRateLimited(env, accountPrincipal(`verify:${tokenHash}`), 'email-verify-token', 8, 60 * 60 * 1000)) {
        return jsonResponse({ error: 'Too many verification attempts. Please try again later.' }, 429, headers);
      }
      const now = new Date().toISOString();
      const record = await env.DB.prepare(`
        SELECT t.id, t.user_id, u.name, u.email, u.picture, u.password_hash,
               EXISTS(
                 SELECT 1 FROM user_identities i
                 WHERE i.user_id = u.id AND i.provider = 'google'
                   AND i.email_verified_at IS NOT NULL
                   AND i.email = u.email COLLATE NOCASE
               ) AS has_google_identity
        FROM email_verification_tokens t
        JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ? AND t.used_at IS NULL
          AND datetime(t.expires_at) > datetime(?)
      `).bind(tokenHash, now).first();
      if (!record) return jsonResponse({ error: 'This verification link is invalid or expired.' }, 400, headers);

      // Finish the only fallible session preparation before consuming every
      // still-valid verification link for this account. The scalar subquery
      // rechecks the presented digest on the write path, so concurrent sibling
      // links cannot both establish sessions.
      const session = await buildSessionRecord(request, record.user_id);
      const claimTime = new Date().toISOString();
      const claimed = await env.DB.prepare(`
        UPDATE email_verification_tokens
        SET used_at = ?
        WHERE user_id = (
          SELECT presented.user_id
          FROM email_verification_tokens AS presented
          WHERE presented.token_hash = ?
            AND presented.used_at IS NULL
            AND datetime(presented.expires_at) > datetime(?)
        )
          AND used_at IS NULL
          AND datetime(expires_at) > datetime(?)
      `).bind(claimTime, tokenHash, claimTime, claimTime).run();
      if (Number(claimed.meta?.changes || 0) < 1) {
        return jsonResponse({ error: 'This verification link is invalid or expired.' }, 400, headers);
      }

      await env.DB.batch([
        env.DB.prepare(`
          UPDATE users SET email_verified_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(claimTime, record.user_id),
        env.DB.prepare(`
          UPDATE user_identities SET email_verified_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND provider = 'password'
        `).bind(claimTime, record.user_id),
        env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(record.user_id),
        prepareSessionInsert(env, session),
        env.DB.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').bind(record.user_id)
      ]);

      setSessionCookie(headers, request, env, session.token, SESSION_TTL_SECONDS);
      return jsonResponse({
        success: true,
        message: 'Your email is verified.',
        user: {
          id: record.user_id,
          name: record.name,
          email: record.email,
          picture: record.picture,
          hasPassword: Boolean(record.password_hash),
          hasGoogleIdentity: Boolean(record.has_google_identity),
          identityLinkRequired: !Boolean(record.password_hash || record.has_google_identity),
          emailVerified: true
        }
      }, 200, headers);
    } catch (error) {
      const bodyResponse = bodyErrorResponse(error, headers);
      if (bodyResponse) return bodyResponse;
      console.error('Email verification failed.');
      return jsonResponse({ error: 'Unable to verify this email.' }, 500, headers);
    }
}

async function handleResendEmailVerification(request, env, ctx) {
    const responseStartedAt = Date.now();
    const origin = request.headers.get('Origin');
    const headers = privateSecurityHeaders(origin, env);
    const localVerificationBypass = isLocalEmailVerificationBypass(request, env);
    if (!validateSiteOrigin(request, env)) {
      return jsonResponse({ error: 'Unauthorized origin' }, 403, headers);
    }
    if ((!env.RESEND_API_KEY || !env.RESEND_FROM) && !localVerificationBypass) {
      return jsonResponse({ error: 'Email verification is temporarily unavailable.' }, 503, headers);
    }

    try {
      const body = await readJsonBody(request);
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) return jsonResponse({ error: 'Enter a valid email address.' }, 400, headers);
      if (await isAnyRateLimited(env, [
        { principal: ipPrincipal(request), endpoint: 'email-verify-resend-ip', limit: 5, windowMs: 60 * 60 * 1000 },
        { principal: accountPrincipal(email), endpoint: 'email-verify-resend-account', limit: 3, windowMs: 60 * 60 * 1000 }
      ])) {
        return jsonResponse({ error: 'Too many verification requests. Please try again later.' }, 429, headers);
      }

      const user = await env.DB.prepare(`
        SELECT id, name, email,
               COALESCE(CAST(email_verified_at AS TEXT), '') AS verification_version
        FROM users
        WHERE email = ? COLLATE NOCASE AND (
          email_verified_at IS NULL OR (
            password_hash IS NULL AND NOT EXISTS (
              SELECT 1 FROM user_identities i WHERE i.user_id = users.id
            )
          )
        )
      `).bind(email).first();
      let localVerificationToken = null;
      if (user) {
        const token = generateSecureToken();
        const now = new Date().toISOString();
        const tokenHash = await sha512(token);
        const tokenId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString();
        const tokenWrites = await env.DB.batch([
          env.DB.prepare(`
            DELETE FROM email_verification_tokens
            WHERE user_id = ?
              AND (used_at IS NOT NULL OR datetime(expires_at) <= datetime(?))
          `).bind(user.id, now),
          env.DB.prepare(`
            INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
            SELECT ?, ?, ?, ?
            WHERE (
              SELECT COUNT(*) FROM email_verification_tokens
              WHERE user_id = ? AND used_at IS NULL
                AND datetime(expires_at) > datetime(?)
            ) < ?
              AND EXISTS (
                SELECT 1 FROM users AS eligible
                WHERE eligible.id = ?
                  AND COALESCE(CAST(eligible.email_verified_at AS TEXT), '') = ?
                  AND (
                    eligible.email_verified_at IS NULL OR (
                      eligible.password_hash IS NULL AND NOT EXISTS (
                        SELECT 1 FROM user_identities i WHERE i.user_id = eligible.id
                      )
                    )
                  )
              )
          `).bind(
            tokenId, user.id, tokenHash, expiresAt,
            user.id, now, MAX_ACTIVE_ACCOUNT_TOKENS,
            user.id, String(user.verification_version || '')
          )
        ]);
        const inserted = Number(tokenWrites[1]?.meta?.changes || 0) === 1;
        if (localVerificationBypass && inserted) {
          localVerificationToken = token;
        } else if (inserted) {
          scheduleBackgroundTask(
            ctx,
            () => sendEmailVerificationEmail(user, token, env),
            'Verification resend delivery failed.'
          );
        }
      }

      await enforceMinimumDuration(responseStartedAt, 450);
      return jsonResponse({
        success: true,
        pendingVerification: true,
        message: 'If that account still needs verification, a new link will arrive shortly.',
        ...(localVerificationBypass && localVerificationToken
          ? { verificationToken: localVerificationToken }
          : {})
      }, 202, headers);
    } catch (error) {
      const bodyResponse = bodyErrorResponse(error, headers);
      if (bodyResponse) return bodyResponse;
      console.error('Verification resend failed.');
      return jsonResponse({ error: 'Unable to request another verification email.' }, 500, headers);
    }
}

async function handleForgotPassword(request, env, ctx) {
    const responseStartedAt = Date.now();
    const origin = request.headers.get('Origin');
    const headers = privateSecurityHeaders(origin, env);
    if (!validateSiteOrigin(request, env)) {
        return jsonResponse({ error: 'Unauthorized origin' }, 403, headers);
    }

    if (await isRateLimited(env, ipPrincipal(request), 'password-forgot-ip', 5, 60 * 60 * 1000)) {
        return jsonResponse({ error: 'Too many password reset requests. Please try again later.' }, 429, headers);
    }

    if (!env.RESEND_API_KEY) {
        return jsonResponse({ error: 'Password reset service is temporarily unavailable.' }, 503, headers);
    }

    try {
        const body = await readJsonBody(request);
        const email = normalizeEmail(body.email);
        if (!isValidEmail(email) || email.length > 254) {
            return jsonResponse({ error: 'Enter a valid email address.' }, 400, headers);
        }

        if (await isRateLimited(env, accountPrincipal(email), 'password-forgot-account', 3, 60 * 60 * 1000)) {
          return jsonResponse({ error: 'Too many password reset requests. Please try again later.' }, 429, headers);
        }

        const user = await env.DB.prepare(`
          SELECT u.id, u.name, u.email, u.password_hash AS password_version FROM users u
          JOIN user_identities i ON i.user_id = u.id AND i.provider = 'password'
          WHERE u.email = ? COLLATE NOCASE AND u.password_hash IS NOT NULL
        `).bind(email).first();

        // Recovery is limited to accounts that already own a password identity.
        // Google-only accounts must authenticate by their immutable provider
        // subject before adding a password from account settings.
        if (user) {
            const resetToken = generateSecureToken();
            const tokenHash = await sha512(resetToken);
            const tokenId = crypto.randomUUID();
            const createdAt = new Date().toISOString();
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

            const tokenWrites = await env.DB.batch([
                env.DB.prepare(`
                  DELETE FROM password_reset_tokens
                  WHERE user_id = ?
                    AND (used_at IS NOT NULL OR datetime(expires_at) <= datetime(?))
                `).bind(user.id, createdAt),
                env.DB.prepare(`
                    INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
                    SELECT ?, ?, ?, ?, ?
                    WHERE (
                      SELECT COUNT(*) FROM password_reset_tokens
                      WHERE user_id = ? AND used_at IS NULL
                        AND datetime(expires_at) > datetime(?)
                    ) < ?
                      AND EXISTS (
                        SELECT 1 FROM users AS eligible
                        JOIN user_identities i
                          ON i.user_id = eligible.id AND i.provider = 'password'
                        WHERE eligible.id = ? AND eligible.password_hash = ?
                      )
                `).bind(
                  tokenId, user.id, tokenHash, expiresAt, createdAt,
                  user.id, createdAt, MAX_ACTIVE_ACCOUNT_TOKENS,
                  user.id, user.password_version
                )
            ]);

            if (Number(tokenWrites[1]?.meta?.changes || 0) === 1) {
              scheduleBackgroundTask(
                ctx,
                () => sendPasswordResetEmail(user, resetToken, env),
                'Password reset email delivery failed.'
              );
            }
        }

        await enforceMinimumDuration(responseStartedAt, 450);
        return jsonResponse({
            success: true,
            message: 'If an eligible account matches that email, a password reset link will arrive shortly.'
        }, 200, headers);
    } catch (error) {
        const bodyResponse = bodyErrorResponse(error, headers);
        if (bodyResponse) return bodyResponse;
        console.error('Password reset request failed:');
        return jsonResponse({ error: 'Unable to process the password reset request.' }, 500, headers);
    }
}

async function handleResetPassword(request, env) {
    const origin = request.headers.get('Origin');
    const headers = privateSecurityHeaders(origin, env);
    if (!validateSiteOrigin(request, env)) {
        return jsonResponse({ error: 'Unauthorized origin' }, 403, headers);
    }

    if (await isRateLimited(env, ipPrincipal(request), 'password-reset-ip', 10, 60 * 60 * 1000)) {
        return jsonResponse({ error: 'Too many reset attempts. Please try again later.' }, 429, headers);
    }

    try {
        const body = await readJsonBody(request);
        const token = typeof body.token === 'string' ? body.token.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
            return jsonResponse({ error: 'This password reset link is invalid or expired.' }, 400, headers);
        }

        const passwordValidation = validatePasswordComplexity(password);
        if (!passwordValidation.isValid) {
            return jsonResponse({
                error: 'Password does not meet complexity requirements.',
                details: passwordValidation.errors
            }, 400, headers);
        }

        const tokenHash = await sha512(token);
        if (await isRateLimited(env, accountPrincipal(`reset:${tokenHash}`), 'password-reset-token', 8, 60 * 60 * 1000)) {
          return jsonResponse({ error: 'Too many reset attempts. Please try again later.' }, 429, headers);
        }
        const now = new Date().toISOString();
        const record = await env.DB.prepare(`
            SELECT t.id, t.user_id, u.email FROM password_reset_tokens t
            JOIN users u ON u.id = t.user_id
            WHERE t.token_hash = ? AND t.used_at IS NULL AND datetime(t.expires_at) > datetime(?)
        `).bind(tokenHash, now).first();

        if (!record) {
            return jsonResponse({ error: 'This password reset link is invalid or expired.' }, 400, headers);
        }

        // Complete the intentionally expensive password work before claiming
        // every active sibling. The presented digest is rechecked inside this
        // single write, making concurrent reset links first-writer-wins.
        const passwordHash = await hashPasswordPBKDF2(password);
        const claimTime = new Date().toISOString();
        const claimed = await env.DB.prepare(`
            UPDATE password_reset_tokens
            SET used_at = ?
            WHERE user_id = (
              SELECT presented.user_id
              FROM password_reset_tokens AS presented
              WHERE presented.token_hash = ?
                AND presented.used_at IS NULL
                AND datetime(presented.expires_at) > datetime(?)
            )
              AND used_at IS NULL
              AND datetime(expires_at) > datetime(?)
        `).bind(claimTime, tokenHash, claimTime, claimTime).run();
        if (Number(claimed.meta?.changes || 0) < 1) {
            return jsonResponse({ error: 'This password reset link is invalid or expired.' }, 400, headers);
        }

        await env.DB.batch([
            env.DB.prepare(`
              UPDATE users
              SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).bind(passwordHash, claimTime, record.user_id),
            env.DB.prepare(`
              INSERT INTO user_identities (
                id, user_id, provider, provider_subject, email, email_verified_at, updated_at
              ) VALUES (?, ?, 'password', ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(user_id, provider) DO UPDATE SET
                provider_subject = excluded.provider_subject,
                email = excluded.email,
                email_verified_at = COALESCE(user_identities.email_verified_at, excluded.email_verified_at),
                updated_at = CURRENT_TIMESTAMP
            `).bind(crypto.randomUUID(), record.user_id, record.email, record.email, claimTime),
            env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(record.user_id),
            env.DB.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').bind(record.user_id),
            env.DB.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').bind(record.user_id)
        ]);

        setSessionCookie(headers, request, env, '', -1);
        return jsonResponse({ success: true, message: 'Your password has been reset. Sign in with your new password.' }, 200, headers);
    } catch (error) {
        const bodyResponse = bodyErrorResponse(error, headers);
        if (bodyResponse) return bodyResponse;
        console.error('Password reset failed:');
        return jsonResponse({ error: 'Unable to reset the password.' }, 500, headers);
    }
}

async function handleGetStatus(request, env) {
    const headers = privateSecurityHeaders(request.headers.get('Origin'), env);
    try {
        const token = getTokenFromRequest(request);
        if (!token) return jsonResponse({ error: 'Not authenticated' }, 401, headers);

        const session = await getValidSession(env, token);
        if (!session) {
            setSessionCookie(headers, request, env, '', -1);
            return jsonResponse({ error: 'Invalid or expired session' }, 401, headers);
        }

        if (!await validateSessionSecurity(session, request)) {
            await deleteSession(env, token);
            setSessionCookie(headers, request, env, '', -1);
            return jsonResponse({ error: 'Session security validation failed' }, 401, headers);
        }

        await touchSession(env, token);

        return jsonResponse({
          success: true,
          user: {
            id: session.user_id,
            email: session.email,
            name: session.name,
            picture: session.picture,
            hasPassword: Boolean(session.password_hash),
            hasGoogleIdentity: Boolean(session.has_verified_google_identity),
            identityLinkRequired: !Boolean(session.has_verified_identity),
            emailVerified: Boolean(session.email_verified_at)
          }
        }, 200, headers);
    } catch (error) {
        console.error('Error getting status:');
        return jsonResponse({ error: 'Failed to get user status' }, 500, headers);
    }
}

async function handleLogout(request, env) {
    const origin = request.headers.get('Origin');
    const headers = privateSecurityHeaders(origin, env);
    if (!validateSiteOrigin(request, env)) {
        return jsonResponse({ error: 'Unauthorized origin' }, 403, headers);
    }
    try {
        const token = getTokenFromRequest(request);
        if (token) {
            await deleteSession(env, token);
        }
        setSessionCookie(headers, request, env, '', -1);
        return jsonResponse({ success: true, message: 'Logged out' }, 200, headers);
    } catch (error) {
        console.error('Error during logout:');
        return jsonResponse({ error: 'Logout failed' }, 500, headers);
    }
}

async function handleGoogleLogin(request, env) {
    const origin = request.headers.get('Origin');
    const headers = privateSecurityHeaders(origin, env);

    if (!validateSiteOrigin(request, env)) {
        return jsonResponse({ error: 'Unauthorized origin' }, 403, headers);
    }

    if (await isRateLimited(env, ipPrincipal(request), 'google-login-ip', 20, 15 * 60 * 1000)) {
        return jsonResponse({ error: 'Too many login attempts. Please try again later.' }, 429, headers);
    }

    try {
        const body = await readJsonBody(request);
        const token = typeof (body.credential || body.token) === 'string' ? (body.credential || body.token).trim() : '';
        if (!token) {
            return jsonResponse({ error: 'Google token is required.' }, 400, headers);
        }

        // 1. Verify the token
        const payload = await verifyGoogleToken(token, env.GOOGLE_CLIENT_ID);
        const subject = typeof payload?.sub === 'string' ? payload.sub : '';
        const email = normalizeEmail(payload?.email);
        if (!payload || (payload.email_verified !== true && payload.email_verified !== 'true')
          || !/^[A-Za-z0-9_-]{1,255}$/.test(subject) || !isValidEmail(email)) {
            return jsonResponse({ error: 'Invalid Google token.' }, 401, headers);
        }
        if (await isRateLimited(env, accountPrincipal(`google:${subject}`), 'google-login-subject', 12, 15 * 60 * 1000)) {
          return jsonResponse({ error: 'Too many login attempts. Please try again later.' }, 429, headers);
        }

        const name = normalizeText(payload.name || email.split('@')[0], 100) || 'Fragrance Collect member';
        const picture = normalizeHttpsUrl(payload.picture);
        let user = await env.DB.prepare(`
          SELECT u.* FROM user_identities i
          JOIN users u ON u.id = i.user_id
          WHERE i.provider = 'google' AND i.provider_subject = ?
        `).bind(subject).first();

        let userId = user?.id;
        if (user) {
          const emailChanged = normalizeEmail(user.email) !== email;
          if (emailChanged) {
            const emailOwner = await env.DB.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').bind(email).first();
            if (emailOwner && emailOwner.id !== userId) {
              return jsonResponse({
                error: 'Google verified a new email that is already owned by another account.',
                code: 'google_email_change_conflict'
              }, 409, headers);
            }
            const verifiedAt = new Date().toISOString();
            await env.DB.batch([
              env.DB.prepare(`
                UPDATE users
                SET email = ?, name = ?, picture = ?, email_verified_at = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `).bind(email, name, picture, verifiedAt, userId),
              env.DB.prepare(`
                UPDATE user_identities
                SET email = ?, email_verified_at = ?,
                    provider_subject = CASE WHEN provider = 'password' THEN ? ELSE provider_subject END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
              `).bind(email, verifiedAt, email, userId),
              env.DB.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').bind(userId),
              env.DB.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').bind(userId),
              env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(userId)
            ]);
            user.email = email;
          } else {
            await env.DB.batch([
              env.DB.prepare(`
                UPDATE users
                SET name = ?, picture = ?, email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `).bind(name, picture, userId),
              env.DB.prepare(`
                UPDATE user_identities
                SET email_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE provider = 'google' AND provider_subject = ?
              `).bind(subject)
            ]);
          }
        } else {
          const emailOwner = await env.DB.prepare(`
            SELECT u.id, u.password_hash, u.email_verified_at,
                   (SELECT COUNT(*) FROM user_identities i WHERE i.user_id = u.id) AS identity_count
            FROM users u WHERE u.email = ? COLLATE NOCASE
          `).bind(email).first();
          if (emailOwner) {
            // Pre-0006 Google accounts did not retain Google's immutable sub.
            // Never recreate that link from email alone. Mailbox proof creates
            // a restricted recovery session, after which this same signed
            // Google credential can be linked explicitly.
            if (!emailOwner.password_hash && Number(emailOwner.identity_count || 0) === 0) {
              return jsonResponse({
                error: 'Verify this legacy account email, then link Google from the signed-in account.',
                code: 'legacy_verification_required',
                pendingVerification: true,
                verificationRequired: true,
                recoveryEmail: email
              }, 409, headers);
            }
            return jsonResponse({
              error: 'An account already uses this email. Sign in first, then explicitly link Google in account settings.',
              code: 'account_link_required'
            }, 409, headers);
          }
          userId = crypto.randomUUID();
          const verifiedAt = new Date().toISOString();
          await env.DB.batch([
            env.DB.prepare(`
              INSERT INTO users (id, email, name, picture, email_verified_at, created_at)
              VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).bind(userId, email, name, picture, verifiedAt),
            env.DB.prepare(`
              INSERT INTO user_identities (
                id, user_id, provider, provider_subject, email, email_verified_at
              ) VALUES (?, ?, 'google', ?, ?, ?)
            `).bind(crypto.randomUUID(), userId, subject, email, verifiedAt)
          ]);
          user = { id: userId, email, name, picture, password_hash: null };
        }

        const sessionToken = await createSession(request, env, userId);
        setSessionCookie(headers, request, env, sessionToken, SESSION_TTL_SECONDS);

        return jsonResponse({
          success: true,
          user: {
            id: userId,
            name,
            email: user.email,
            picture,
            hasPassword: Boolean(user?.password_hash),
            hasGoogleIdentity: true,
            identityLinkRequired: false,
            emailVerified: true
          }
        }, 200, headers);

    } catch (error) {
        const bodyResponse = bodyErrorResponse(error, headers);
        if (bodyResponse) return bodyResponse;
        console.error('Error during Google login:');
        return jsonResponse({ error: 'Google login failed.' }, 500, headers);
    }
}

async function handleLinkGoogleIdentity(request, env) {
    const { user, headers, errorResponse } = await getUserFromRequest(request, env);
    if (errorResponse) return errorResponse;
    if (await isAnyRateLimited(env, [
      { principal: ipPrincipal(request), endpoint: 'google-link-ip', limit: 10, windowMs: 60 * 60 * 1000 },
      { principal: accountPrincipal(user.id), endpoint: 'google-link-user', limit: 5, windowMs: 60 * 60 * 1000 }
    ])) {
      return jsonResponse({ error: 'Too many provider-link attempts. Please try again later.' }, 429, headers);
    }

    try {
      const body = await readJsonBody(request);
      const credential = typeof (body.credential || body.token) === 'string' ? (body.credential || body.token).trim() : '';
      if (!credential) return jsonResponse({ error: 'Google credential is required.' }, 400, headers);
      const payload = await verifyGoogleToken(credential, env.GOOGLE_CLIENT_ID);
      const subject = typeof payload?.sub === 'string' ? payload.sub : '';
      const email = normalizeEmail(payload?.email);
      if (!payload || (payload.email_verified !== true && payload.email_verified !== 'true')
        || !/^[A-Za-z0-9_-]{1,255}$/.test(subject) || !isValidEmail(email)) {
        return jsonResponse({ error: 'Google reauthentication failed.', code: 'reauthentication_failed' }, 401, headers);
      }
      if (email !== normalizeEmail(user.email)) {
        return jsonResponse({ error: 'Google must verify the same email as this account.', code: 'reauthentication_failed' }, 401, headers);
      }

      const [subjectOwner, account] = await Promise.all([
        env.DB.prepare(`
          SELECT user_id FROM user_identities WHERE provider = 'google' AND provider_subject = ?
        `).bind(subject).first(),
        env.DB.prepare(`
          SELECT password_hash,
                 (SELECT provider_subject FROM user_identities
                  WHERE user_id = users.id AND provider = 'google') AS linked_google_subject
          FROM users WHERE id = ?
        `).bind(user.id).first()
      ]);
      if (!account) return jsonResponse({ error: 'Account not found.' }, 404, headers);
      if (subjectOwner && subjectOwner.user_id !== user.id) {
        return jsonResponse({ error: 'That Google identity is already linked to another account.' }, 409, headers);
      }
      if (account.linked_google_subject && account.linked_google_subject !== subject) {
        return jsonResponse({ error: 'Remove the existing Google identity before linking another one.' }, 409, headers);
      }
      if (account.password_hash) {
        const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
        if (!currentPassword) {
          return jsonResponse({ error: 'Enter your current password to link Google.', code: 'password_reauthentication_required' }, 400, headers);
        }
        if (!(await verifyPasswordRecord(currentPassword, account.password_hash)).valid) {
          return jsonResponse({ error: 'Reauthentication failed.', code: 'reauthentication_failed' }, 401, headers);
        }
      }

      const verifiedAt = new Date().toISOString();
      const session = await buildSessionRecord(request, user.id);
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO user_identities (
            id, user_id, provider, provider_subject, email, email_verified_at
          ) VALUES (?, ?, 'google', ?, ?, ?)
          ON CONFLICT(user_id, provider) DO UPDATE SET
            provider_subject = excluded.provider_subject,
            email = excluded.email,
            email_verified_at = excluded.email_verified_at,
            updated_at = CURRENT_TIMESTAMP
        `).bind(crypto.randomUUID(), user.id, subject, email, verifiedAt),
        env.DB.prepare(`
          UPDATE users
          SET email_verified_at = COALESCE(email_verified_at, ?),
              picture = COALESCE(picture, ?), updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(verifiedAt, normalizeHttpsUrl(payload.picture), user.id),
        env.DB.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').bind(user.id),
        env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(user.id),
        prepareSessionInsert(env, session)
      ]);
      setSessionCookie(headers, request, env, session.token, SESSION_TTL_SECONDS);
      return jsonResponse({
        success: true,
        message: 'Google is now linked to your account.',
        user: { hasGoogleIdentity: true, identityLinkRequired: false, emailVerified: true }
      }, 200, headers);
    } catch (error) {
      const bodyResponse = bodyErrorResponse(error, headers);
      if (bodyResponse) return bodyResponse;
      console.error('Google identity linking failed.');
      return jsonResponse({ error: 'Unable to link Google.' }, 500, headers);
    }
}

async function handleDeleteAccount(request, env) {
    const { user, headers, errorResponse } = await getUserFromRequest(request, env);
    if (errorResponse) return errorResponse;
    if (await isAnyRateLimited(env, [
      { principal: ipPrincipal(request), endpoint: 'account-delete-ip', limit: 6, windowMs: 60 * 60 * 1000 },
      { principal: accountPrincipal(user.id), endpoint: 'account-delete-user', limit: 4, windowMs: 60 * 60 * 1000 }
    ])) {
      return jsonResponse({ error: 'Too many account deletion attempts. Please try again later.' }, 429, headers);
    }

    try {
      const body = await readJsonBody(request);
      if (body.confirmation !== 'DELETE') {
        return jsonResponse({ error: 'Type DELETE to confirm permanent account deletion.' }, 400, headers);
      }
      const account = await env.DB.prepare(`
        SELECT u.password_hash,
               (SELECT i.provider_subject FROM user_identities i
                WHERE i.user_id = u.id AND i.provider = 'google'
                  AND i.email_verified_at IS NOT NULL AND i.email = u.email COLLATE NOCASE) AS google_subject
        FROM users u WHERE u.id = ?
      `).bind(user.id).first();
      if (!account) return jsonResponse({ error: 'Account not found.' }, 404, headers);

      if (account.password_hash) {
        const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
        if (!currentPassword) {
          return jsonResponse({
            error: 'Enter your current password to delete this account.',
            code: 'password_reauthentication_required'
          }, 400, headers);
        }
        if (!(await verifyPasswordRecord(currentPassword, account.password_hash)).valid) {
          return jsonResponse({ error: 'Reauthentication failed.', code: 'reauthentication_failed' }, 401, headers);
        }
      } else {
        if (!account.google_subject) {
          return jsonResponse({ error: 'No verified sign-in provider is available for reauthentication.' }, 403, headers);
        }
        const credential = typeof (body.googleCredential || body.credential) === 'string'
          ? (body.googleCredential || body.credential).trim()
          : '';
        if (!credential) {
          return jsonResponse({
            error: 'Reauthenticate with Google to delete this account.',
            code: 'google_reauthentication_required',
            provider: 'google'
          }, 400, headers);
        }
        const payload = await verifyGoogleToken(credential, env.GOOGLE_CLIENT_ID);
        if (!payload || payload.sub !== account.google_subject
          || (payload.email_verified !== true && payload.email_verified !== 'true')
          || normalizeEmail(payload.email) !== normalizeEmail(user.email)) {
          return jsonResponse({ error: 'Reauthentication failed.', code: 'reauthentication_failed' }, 401, headers);
        }
      }

      const result = await env.DB.batch([
        env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(user.id),
        env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id)
      ]);
      // D1 can report cascaded child-row changes in this batch, so a successful
      // parent deletion may legitimately report more than one affected row.
      // Only zero means the concurrently rechecked account was not removed.
      if (Number(result[1]?.meta?.changes || 0) < 1) {
        return jsonResponse({ error: 'Unable to delete this account.' }, 500, headers);
      }
      setSessionCookie(headers, request, env, '', -1);
      return jsonResponse({ success: true, message: 'Your account has been deleted.' }, 200, headers);
    } catch (error) {
      const bodyResponse = bodyErrorResponse(error, headers);
      if (bodyResponse) return bodyResponse;
      console.error('Account deletion failed.');
      return jsonResponse({ error: 'Unable to delete this account.' }, 500, headers);
    }
}


// --- API FUNCTIONS ---

async function handleProductsRequest(request, url, env, ctx) {
  const { searchParams } = new URL(url);
  const query = (searchParams.get('q') || '').trim();
  const requestedLimit = Number.parseInt(searchParams.get('limit') || '24', 10);
  const requestedPage = Number.parseInt(searchParams.get('page') || '1', 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 24;
  const page = Number.isInteger(requestedPage) ? Math.min(Math.max(requestedPage, 1), 100) : 1;
  const offset = (page - 1) * limit;
  const lowPrice = normalizePriceFilter(searchParams.get('lowPrice'));
  const highPrice = normalizePriceFilter(searchParams.get('highPrice'));
  const requestedPartnerIdValue = searchParams.get('partnerId');
  const requestedPartnerId = /^\d{1,20}$/.test(requestedPartnerIdValue || '') ? requestedPartnerIdValue : null;
  const configuredAdvertiserIds = parseConfiguredAdvertiserIds(env.CJ_ADVERTISER_IDS);
  let partnerId = requestedPartnerId && configuredAdvertiserIds?.includes(requestedPartnerId)
    ? requestedPartnerId
    : null;
  let validatedAdvertiserDirectory = null;
  const requestedSort = searchParams.get('sortBy') || 'featured';
  const sortBy = requestedSort === 'revenue' || requestedSort === 'commission' ? 'featured' : requestedSort;
  const brandFilter = normalizeText(searchParams.get('brand') || '', 100) || null;
  const exactMatch = searchParams.get('exactMatch') === 'true';
  const currency = /^[A-Z]{3}$/.test(searchParams.get('currency') || '') ? searchParams.get('currency') : null;
  const country = /^[A-Z]{2}$/i.test(searchParams.get('country') || '') ? searchParams.get('country').toUpperCase() : null;
  const gtin = normalizeGtin(searchParams.get('gtin'));
  const inferredSearchIntent = parseCatalogSearchIntent(query);
  const mergedSearchIntent = mergeCatalogSearchIntent(
    inferredSearchIntent,
    readExplicitCatalogSearchIntent(searchParams)
  );
  const requestedAvailability = normalizeAvailabilityFilter(searchParams.get('availability'));
  const requestedShipping = normalizeShippingFilter(searchParams.get('shipping'));
  const searchIntent = {
    ...mergedSearchIntent,
    availability: requestedAvailability || mergedSearchIntent.availability,
    shipping: requestedShipping || mergedSearchIntent.shipping
  };
  const availability = searchIntent.availability;
  const shipping = searchIntent.shipping;
  if (await isRateLimited(env, ipPrincipal(request), 'products', 30, 60 * 1000)) {
    return jsonResponse(
      { error: 'Too many product requests. Please slow down and try again.' },
      429,
      securityHeaders(request.headers.get('Origin'), env)
    );
  }

  if (query.length > 120) {
    return jsonResponse(
      { error: 'Search query must be 120 characters or fewer.' },
      400,
      securityHeaders(request.headers.get('Origin'), env)
    );
  }

  if (requestedPartnerIdValue && !requestedPartnerId) {
    return jsonResponse(
      { error: 'That retailer is not available in the joined-retailer filter.' },
      400,
      securityHeaders(request.headers.get('Origin'), env)
    );
  }

  const catalogDeadline = createCJDiscoveryDeadline(env);

  // `CJ_ADVERTISER_IDS=all` has no static allowlist. Resolve the cached active
  // JOINED directory before accepting a public retailer scope. Any ID not
  // present in that active directory fails closed, including when lookup could
  // not verify an otherwise valid-looking number.
  if (requestedPartnerId && !partnerId && !configuredAdvertiserIds?.length) {
    try {
      validatedAdvertiserDirectory = await resolveCJAdvertiserDirectory(
        { forceDirectory: true },
        null,
        env,
        catalogDeadline
      );
    } catch {
      catalogDeadline.close();
      return jsonResponse(
        { error: 'The joined-retailer directory is temporarily unavailable.' },
        503,
        securityHeaders(request.headers.get('Origin'), env)
      );
    }
    if (validatedAdvertiserDirectory.available === false) {
      catalogDeadline.close();
      return jsonResponse(
        { error: 'The joined-retailer directory is temporarily unavailable.' },
        503,
        securityHeaders(request.headers.get('Origin'), env)
      );
    }
    partnerId = resolveRequestedCJPartnerId(requestedPartnerId, null, validatedAdvertiserDirectory);
  }

  if (requestedPartnerId && !partnerId) {
    catalogDeadline.close();
    return jsonResponse(
      { error: 'That retailer is not available in the joined-retailer filter.' },
      400,
      securityHeaders(request.headers.get('Origin'), env)
    );
  }

  try {
    const exactTextMatch = exactMatch && Boolean(searchIntent.textQuery);
    const catalog = await searchCJStore({
      query: searchIntent.retrievalQuery,
      brand: brandFilter,
      limit: CATALOG_CONFIG.MAX_UPSTREAM_RESULTS,
      offset: 0,
      lowPrice,
      highPrice,
      partnerId,
      currency,
      country,
      gtin,
      availability,
      exactMatch: exactTextMatch,
      advertiserDirectory: validatedAdvertiserDirectory,
      deadline: catalogDeadline
    }, env);
    const deduplicatedProducts = deduplicateProducts(catalog.data.products);

    let filteredProducts = deduplicatedProducts;
    if (exactTextMatch) {
        filteredProducts = deduplicatedProducts.filter((product) => matchesExactCatalogText(product, searchIntent.textQuery));
    }

    const fragranceProducts = filteredProducts.filter(isFragranceProduct);
    const newRetailProducts = fragranceProducts.filter(isNewRetailProduct);
    // CJ keywords improve recall but are not a trustworthy brand facet. Enforce
    // an exact identity against the raw feed brand before display fallbacks can
    // substitute an advertiser name for a missing brand.
    const brandMatchedProducts = brandFilter
      ? newRetailProducts.filter((product) => matchesRawProductBrand(product, brandFilter))
      : newRetailProducts;
    const formattedCatalogProducts = brandMatchedProducts
      .map(formatProduct)
      .filter(Boolean);
    const intentMatchedProducts = formattedCatalogProducts.filter((product) => matchesCatalogSearchIntent(product, searchIntent));
    const priceMatchedProducts = intentMatchedProducts.filter((product) => matchesPriceFilters(product.price, lowPrice, highPrice));
    const availabilityMatchedProducts = priceMatchedProducts.filter((product) => matchesAvailabilityFilter(product.availability, availability));
    const countryMatchedProducts = availabilityMatchedProducts.filter((product) => matchesServiceableCountry(product, country));
    const formattedProducts = countryMatchedProducts.filter((product) => matchesShippingFilter(product.shippingCost, shipping));
    let nonPartnerOpportunity = null;
    if (brandFilter && formattedProducts.length === 0) {
      try {
        const opportunity = await searchCJNonJoinedBrandOpportunity({
          query: searchIntent.retrievalQuery,
          brand: brandFilter,
          lowPrice,
          highPrice,
          currency,
          country,
          availability,
          shipping
        }, searchIntent, env, catalogDeadline);
        nonPartnerOpportunity = opportunity.data;
      } catch {
        // Non-joined discovery is advisory only. It must never prevent the
        // joined-retailer catalog from returning an honest empty state.
      }
    }
    const popularity = await loadClickPopularity(env);
    const rankingQuery = searchIntent.textQuery
      || (hasStructuredCatalogIntent(searchIntent) ? '' : query);
    const rankedProducts = rankProducts(formattedProducts, rankingQuery, sortBy, brandFilter, popularity);
    const products = attachOfferComparisons(rankedProducts);

    const total = products.length;
    const upstreamReportedTotal = Math.max(Number(catalog.data.reportedTotalLowerBound) || 0, catalog.data.products.length);
    const upstreamTruncated = catalog.data.totalIsComplete === false;
    const paginatedProducts = products.slice(offset, offset + limit);
    if (catalog.cache === 'miss' && paginatedProducts.length) {
      scheduleBackgroundTask(
        ctx,
        () => snapshotProductObservationsBounded(env, paginatedProducts),
        'Catalog observation snapshot failed.'
      );
    }
    const responseData = {
      products: paginatedProducts,
      total,
      totalIsComplete: !upstreamTruncated,
      totalScope: upstreamTruncated
        ? 'eligible products within the bounded CJ discovery window'
        : 'complete eligible set returned by the CJ discovery plan',
      moreMayExist: upstreamTruncated,
      page,
      limit,
      hasMore: total > (offset + limit),
      searchQuery: query,
      retrievalQuery: searchIntent.retrievalQuery,
      filters: { lowPrice, highPrice, partnerId, sortBy, brandFilter, exactMatch, currency, country, gtin, availability, shipping, intent: publicCatalogSearchIntent(searchIntent) },
      sources: {
        cj: catalog.data.products.length,
        upstreamReported: upstreamTruncated ? null : upstreamReportedTotal,
        upstreamReportedLowerBound: upstreamReportedTotal,
        upstreamTruncated,
        discovery: catalog.data.discovery || null,
        nonPartnerOpportunity,
        deduplicated: deduplicatedProducts.length,
        total: formattedProducts.length,
        eligibleBeforePagination: formattedProducts.length,
        excludedAsNonFragrance: filteredProducts.length - fragranceProducts.length,
        excludedAsNonNew: fragranceProducts.length - newRetailProducts.length,
        excludedByBrand: newRetailProducts.length - brandMatchedProducts.length,
        excludedByStructuredIntent: formattedCatalogProducts.length - intentMatchedProducts.length,
        excludedByPrice: intentMatchedProducts.length - priceMatchedProducts.length,
        excludedByAvailability: priceMatchedProducts.length - availabilityMatchedProducts.length,
        excludedByCountry: availabilityMatchedProducts.length - countryMatchedProducts.length,
        excludedByShipping: countryMatchedProducts.length - formattedProducts.length,
        retailerScope: partnerId
          ? 'selected joined retailer'
          : configuredAdvertiserIds?.length
            ? 'configured joined retailers'
            : 'all joined CJ retailers'
      },
      optimization: {
        exactMatchApplied: exactTextMatch,
        structuredIntentApplied: hasStructuredCatalogIntent(searchIntent),
        ranking: sortBy,
        nonPartnerOffersReturned: false,
        trendingEvidence: sortBy === 'trending' ? 'anonymized outbound clicks from the last 30 days' : null
      },
      dataFreshness: {
        updatedAt: catalog.updatedAt,
        stale: catalog.stale,
        warning: catalog.warning || catalog.data.warning || null
      }
    };

    const headers = {
      ...securityHeaders(request.headers.get('Origin'), env),
      'Cache-Control': 'public, max-age=60, s-maxage=900, stale-while-revalidate=86400'
    };
    return jsonResponse(sanitizePublicCatalogPayload(responseData), 200, headers);

  } catch (error) {
    console.error('Error fetching products:');
    return jsonResponse({ error: 'Failed to fetch products from partner retailers' }, 500, securityHeaders(request.headers.get('Origin'), env));
  } finally {
    catalogDeadline.close();
  }
}

async function searchCJStore(options, env) {
  const discoveryQueries = buildCJDiscoveryQueries(options);
  const brandQuery = normalizeText(options.brand, 100);
  const configuredIds = parseConfiguredAdvertiserIds(env.CJ_ADVERTISER_IDS);
  const cacheKey = [
    'cj:products:v3-advertiser-fair', discoveryQueries.map((entry) => entry.key).join(','), normalizeBrandKey(brandQuery), options.lowPrice ?? '', options.highPrice ?? '',
    options.partnerId || configuredIds?.join(',') || 'joined', options.currency || '', options.country || '', options.gtin || '',
    options.availability || '', options.exactMatch ? 'exact' : options.discoveryMode || 'broad', options.limit
  ].join(':');

  return withCJCache(env, cacheKey, CATALOG_CONFIG.PRODUCT_CACHE_SECONDS, async () => {
    await pruneCJCache(env);
    const directory = options.advertiserDirectory
      || await resolveCJAdvertiserDirectory(options, configuredIds, env, options.deadline);
    const advertiserScopes = buildCJAdvertiserScopes(options, configuredIds, directory);
    const discovery = await executeCJDiscoveryPlan({
      queries: discoveryQueries,
      advertiserScopes,
      maxResults: Math.min(options.limit || CATALOG_CONFIG.MAX_UPSTREAM_RESULTS, CATALOG_CONFIG.MAX_UPSTREAM_RESULTS),
      deadline: options.deadline,
      fetchPage: async ({ keywords, partnerIds, limit, offset, signal, timeoutMs }) => {
        if (!await consumeCJUpstreamBudget(env)) throw new Error('CJ upstream request budget exhausted.');
        const data = await fetchCJGraphQL(env, 'https://ads.api.cj.com/query', buildShoppingProductsQuery(), {
          companyId: env.CJ_COMPANY_ID,
          keywords,
          limit,
          offset,
          websiteId: env.CJ_WEBSITE_ID,
          lowPrice: options.lowPrice,
          highPrice: options.highPrice,
          partnerIds,
          // Explicit advertiser scopes only subdivide the publisher's joined
          // relationships. They never grant access to a non-joined catalog.
          partnerStatus: 'JOINED',
          currency: options.currency,
          serviceableAreas: options.country ? [options.country] : null,
          gtin: options.gtin,
          availability: options.availability
        }, { signal, timeoutMs });
        return data.shoppingProducts || {};
      }
    });
    const products = deduplicateProducts(discovery.products);
    const independentlyPlannedScopes = advertiserScopes
      .filter((scope) => scope.kind === 'advertiser' || scope.kind === 'selected');
    const independentlyQueriedScopeKeys = new Set(discovery.branches
      .filter((branch) => branch.successful && (branch.scope.kind === 'advertiser' || branch.scope.kind === 'selected'))
      .map((branch) => branch.scope.key));
    return {
      products,
      // Multiple discovery branches overlap, so their upstream totals must not
      // be added together. The deduplicated scanned count is the only honest
      // aggregate total unless every branch was completely consumed.
      totalCount: products.length,
      reportedTotalLowerBound: Math.max(discovery.reportedTotalLowerBound, products.length),
      totalIsComplete: discovery.complete,
      discovery: {
        queryCount: discoveryQueries.length,
        advertiserScopeCount: advertiserScopes.length,
        requestCount: discovery.requestCount,
        scannedRecords: discovery.scannedRecords,
        successfulBranches: discovery.branches.filter((branch) => branch.successful).length,
        branchCount: discovery.branches.length,
        truncatedReasons: discovery.truncatedReasons,
        advertiserDirectoryAvailable: directory.available !== false,
        advertiserDirectoryComplete: directory.complete,
        advertiserDirectoryCount: directory.ids.length,
        independentlyPlannedAdvertisers: independentlyPlannedScopes.length,
        independentlyQueriedAdvertisers: independentlyQueriedScopeKeys.size,
        advertiserScopeCoverageComplete: directory.complete === true
          && independentlyQueriedScopeKeys.size === independentlyPlannedScopes.length,
        aggregateFallbackPlanned: advertiserScopes.some((scope) => scope.kind === 'aggregate-fallback'),
        deadlineExceeded: discovery.deadlineExceeded
      },
      warning: discovery.deadlineExceeded
        ? 'CJ discovery reached its response-time limit; available joined-retailer results are shown and more may exist.'
        : discovery.failedBranches
        ? 'Some CJ discovery branches were temporarily unavailable; available joined-retailer results are shown.'
        : null
    };
  }, {
    // A partial timeout response is useful for this caller but must never
    // replace the last complete catalog snapshot used for stale-cache rescue.
    shouldCache: (data) => data?.discovery?.deadlineExceeded !== true,
    // If every current branch times out, an exact-key stale snapshot is more
    // useful than presenting a misleading empty catalog. Successful partial
    // branches still win so their current retailer data remains visible.
    preferStale: (data) => data?.discovery?.deadlineExceeded === true
      && Array.isArray(data.products)
      && data.products.length === 0
  });
}

async function searchCJNonJoinedBrandOpportunity(options, searchIntent, env, deadline = null) {
  const queries = buildCJDiscoveryQueries(options)
    .filter((entry) => !entry.broad)
    .slice(0, 2);
  const cacheKey = [
    'cj:nonjoined-brand-opportunity:v1', normalizeBrandKey(options.brand),
    queries.map((entry) => entry.key).join(','), options.lowPrice ?? '', options.highPrice ?? '',
    options.currency || '', options.country || '', options.availability || '',
    options.shipping || '',
    JSON.stringify(publicCatalogSearchIntent(searchIntent))
  ].join(':');

  return withCJCache(env, cacheKey, 6 * 60 * 60, async () => {
    await pruneCJCache(env);
    const responses = await Promise.allSettled(queries.map(async (entry) => {
      if (deadline?.expired) throw new CJDiscoveryDeadlineError();
      if (!await consumeCJUpstreamBudget(env)) throw new Error('CJ upstream request budget exhausted.');
      const data = await settleWithinCJDiscoveryDeadline(fetchCJGraphQL(env, 'https://ads.api.cj.com/query', buildShoppingProductsQuery(), {
        companyId: env.CJ_COMPANY_ID,
        keywords: entry.keywords,
        limit: 50,
        offset: 0,
        websiteId: env.CJ_WEBSITE_ID,
        lowPrice: options.lowPrice,
        highPrice: options.highPrice,
        partnerIds: null,
        // This branch is discovery metadata only. Its records are never
        // returned as shopper offers or used to generate purchase links.
        partnerStatus: 'NOT_JOINED',
        currency: options.currency,
        serviceableAreas: options.country ? [options.country] : null,
        gtin: null,
        availability: options.availability
      }, {
        signal: deadline?.signal,
        timeoutMs: deadline?.remainingMs()
      }), deadline);
      return data.shoppingProducts || {};
    }));
    const successful = responses.filter((response) => response.status === 'fulfilled');
    if (!successful.length) throw new Error('Non-joined CJ discovery is unavailable.');
    const rawProducts = deduplicateProducts(successful.flatMap((response) => (
      Array.isArray(response.value.resultList) ? response.value.resultList : []
    )));
    const eligible = rawProducts
      .filter(isFragranceProduct)
      .filter(isNewRetailProduct)
      .filter((product) => matchesRawProductBrand(product, options.brand))
      .map(formatProduct)
      .filter(Boolean)
      .filter((product) => matchesCatalogSearchIntent(product, searchIntent))
      .filter((product) => matchesPriceFilters(product.price, options.lowPrice, options.highPrice))
      .filter((product) => matchesAvailabilityFilter(product.availability, options.availability))
      .filter((product) => matchesServiceableCountry(product, options.country))
      .filter((product) => matchesShippingFilter(product.shippingCost, options.shipping));
    const reportedTotals = successful
      .map((response) => Number(response.value.totalCount))
      .filter((value) => Number.isFinite(value) && value >= 0);
    return summarizeNonPartnerOpportunity(
      eligible,
      rawProducts.length,
      reportedTotals.length ? Math.max(...reportedTotals) : rawProducts.length
    );
  });
}

function summarizeNonPartnerOpportunity(eligibleProducts, sampledRecords, upstreamReportedLowerBound) {
  const advertisers = new Map();
  for (const product of Array.isArray(eligibleProducts) ? eligibleProducts : []) {
    const id = /^\d{1,20}$/.test(product?.advertiserId || '') ? product.advertiserId : null;
    const name = normalizeText(product?.advertiser, 200);
    if (id && name) advertisers.set(id, { id, name });
  }
  const candidates = [...advertisers.values()]
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
    .slice(0, 10);
  const eligibleCount = Array.isArray(eligibleProducts) ? eligibleProducts.length : 0;
  return {
    available: eligibleCount > 0,
    sampledEligibleOffers: eligibleCount,
    sampledRecords: Math.max(0, Number(sampledRecords) || 0),
    upstreamReportedLowerBound: Math.max(0, Number(upstreamReportedLowerBound) || 0),
    relationship: 'not joined',
    offersReturned: 0,
    advertisers: candidates,
    message: eligibleCount
      ? 'CJ has sampled matching perfume listings in programs that Fragrance Collect has not joined. They are not shown as purchase offers.'
      : 'No eligible matching perfume was found in the bounded non-joined CJ sample.'
  };
}

function discoveryKeywordKey(keywords) {
  return Array.isArray(keywords)
    ? keywords.map((keyword) => normalizeBrandText(keyword)).filter(Boolean).join('|')
    : 'gtin';
}

function removeCatalogBrandFromQuery(query, brand) {
  let remaining = normalizeText(query, 120);
  const names = equivalentCatalogBrandNames(brand)
    .sort((left, right) => right.length - left.length);
  for (const name of names) {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    remaining = remaining.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'ig'), ' ');
  }
  return remaining.replace(/\s+/g, ' ').trim();
}

function buildCJDiscoveryQueries(options = {}) {
  const queries = [];
  const seen = new Set();
  const add = (keywords, reason, broad = false) => {
    const cleanKeywords = Array.isArray(keywords)
      ? keywords.map((keyword) => normalizeText(keyword, 120)).filter(Boolean)
      : null;
    if (Array.isArray(keywords) && !cleanKeywords.length) return;
    const key = discoveryKeywordKey(cleanKeywords);
    if (seen.has(key) || queries.length >= CATALOG_CONFIG.MAX_DISCOVERY_QUERIES) return;
    seen.add(key);
    queries.push({ key, keywords: cleanKeywords, reason, broad });
  };

  if (options.gtin) {
    add(null, 'gtin');
    return queries;
  }

  const keywords = buildCJProductKeywords(options);
  const primary = keywords;
  const query = normalizeText(options.query, 120);
  const brand = normalizeText(options.brand, 100);
  add(primary, 'primary');
  if (options.exactMatch || options.discoveryMode === 'focused') return queries;

  if (brand) {
    const productTerms = removeCatalogBrandFromQuery(query, brand);
    if (productTerms) add([productTerms], 'product-name-without-brand');
    add([brand], 'brand-only');
    const alias = equivalentCatalogBrandNames(brand)
      .find((candidate) => normalizeBrandText(candidate) !== normalizeBrandText(brand)
        && normalizeBrandKey(candidate) === normalizeBrandKey(brand));
    if (alias) add([alias], 'brand-alias');
    if (!productTerms) {
      add([`${brand} perfume`], 'brand-and-perfume');
      add([`${brand} fragrance`], 'brand-and-fragrance');
    }
    // A generic perfume scan catches retailer feeds whose searchable title
    // omits the brand even though the structured brand field is correct. The
    // raw brand and wearable-fragrance checks still run before anything is
    // returned to a shopper.
    add(['perfume'], 'perfume-category-fallback', true);
    return queries;
  }

  if (query && !/^(?:fragrance\s+perfume|perfume\s+fragrance)$/i.test(query)) {
    add([query], 'full-query');
    add([`${query} perfume`], 'query-and-perfume');
  }
  add(['perfume'], 'perfume-category');
  add(['eau de parfum'], 'eau-de-parfum-category');
  add(['cologne'], 'cologne-category');
  return queries;
}

function resolveRequestedCJPartnerId(requestedPartnerId, configuredIds = null, directory = {}) {
  if (!/^\d{1,20}$/.test(requestedPartnerId || '')) return null;
  const allowedIds = configuredIds?.length
    ? configuredIds
    : Array.isArray(directory.ids) ? directory.ids : [];
  return allowedIds.includes(requestedPartnerId) ? requestedPartnerId : null;
}

function buildCJAdvertiserScopes(options = {}, configuredIds = null, directory = {}) {
  if (options.partnerId) {
    return [{ key: `partner-${options.partnerId}`, partnerIds: [options.partnerId], kind: 'selected' }];
  }

  const directoryIds = Array.isArray(directory.ids) ? directory.ids : [];
  const candidateIds = [...new Set((configuredIds?.length ? configuredIds : directoryIds)
    .filter((id) => /^\d{1,20}$/.test(String(id)))
    .map(String))];
  const scopes = candidateIds.map((advertiserId) => ({
    key: `joined-advertiser-${advertiserId}`,
    partnerIds: [advertiserId],
    kind: 'advertiser'
  }));
  // If Advertiser Lookup did not reach the end, retain an all-JOINED search as
  // a safety net for advertisers beyond the scanned directory pages. Known
  // advertisers still keep independent scopes, so a large catalog cannot
  // crowd a smaller retailer such as FragranceX out of its own result window.
  if (!configuredIds?.length && directory.complete === false) {
    scopes.push({ key: 'joined-directory-remainder', partnerIds: null, kind: 'aggregate-fallback' });
  }
  return scopes.length
    ? scopes
    : [{ key: configuredIds?.length ? 'configured' : 'joined', partnerIds: configuredIds || null, kind: 'aggregate-fallback' }];
}

async function resolveCJAdvertiserDirectory(options, configuredIds, env, deadline = null) {
  if (!options.forceDirectory && (options.partnerId || configuredIds?.length)) {
    return { ids: configuredIds || (options.partnerId ? [options.partnerId] : []), complete: true, available: true };
  }

  const ids = [];
  let complete = false;
  let available = false;
  for (let page = 1; page <= CATALOG_CONFIG.MAX_ADVERTISER_LOOKUP_PAGES; page += 1) {
    if (deadline?.expired) break;
    try {
      const cacheKey = `cj:advertisers:joined::${page}:100`;
      if (!await reserveCJBudgetOnCacheMiss(env, cacheKey)) break;
      const result = await settleWithinCJDiscoveryDeadline(getCJAdvertisers(env, {
        relationship: 'joined',
        page,
        pageSize: 100,
        signal: deadline?.signal,
        timeoutMs: deadline?.remainingMs()
      }), deadline);
      available = true;
      const advertisers = result.data.advertisers || [];
      ids.push(...advertisers
        .filter(isActiveJoinedCJAdvertiser)
        .map((advertiser) => advertiser.id));
      const total = Number(result.data.total);
      if (advertisers.length < 100 || (Number.isFinite(total) && page * 100 >= total)) {
        complete = true;
        break;
      }
    } catch {
      break;
    }
  }
  return { ids: [...new Set(ids.filter(Boolean))], complete, available };
}

function isActiveJoinedCJAdvertiser(advertiser) {
  const id = String(advertiser?.id || '');
  const accountStatus = String(advertiser?.accountStatus || '').trim().toLowerCase();
  const relationshipStatus = String(advertiser?.relationshipStatus || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  return /^\d{1,20}$/.test(id)
    && (!accountStatus || accountStatus === 'active')
    && (!relationshipStatus || relationshipStatus === 'joined');
}

async function executeCJDiscoveryPlan({ queries, advertiserScopes, fetchPage, maxResults, deadline = null }) {
  const safeQueries = Array.isArray(queries) ? queries : [];
  const safeScopes = Array.isArray(advertiserScopes) && advertiserScopes.length
    ? advertiserScopes
    : [{ key: 'joined', partnerIds: null, kind: 'aggregate' }];
  const resultCap = Math.max(1, Math.min(Number(maxResults) || CATALOG_CONFIG.MAX_UPSTREAM_RESULTS, CATALOG_CONFIG.MAX_UPSTREAM_RESULTS));
  const branches = safeQueries.flatMap((query) => safeScopes.map((scope) => ({
    key: `${query.key}:${scope.key}`,
    query,
    scope,
    offset: 0,
    scanned: 0,
    reportedTotal: null,
    complete: false,
    attempted: false,
    successful: false,
    failed: false,
    timedOut: false
  })));
  // Queries are the outer dimension, so the first N branches are the primary
  // query for each advertiser scope. Reserve record capacity across that set
  // before later aliases/pages can consume the scan window.
  const coverageBranches = branches.slice(0, safeScopes.length);
  const queue = [...branches];
  const products = [];
  const truncatedReasons = new Set();
  let requestCount = 0;
  let scannedRecords = 0;

  while (queue.length && requestCount < CATALOG_CONFIG.MAX_DISCOVERY_REQUESTS && scannedRecords < resultCap) {
    if (deadline?.expired) {
      truncatedReasons.add('response-time-limit');
      break;
    }
    const availableRequests = CATALOG_CONFIG.MAX_DISCOVERY_REQUESTS - requestCount;
    const remainingRecordCapacity = resultCap - scannedRecords;
    const wave = queue.splice(0, Math.min(
      CATALOG_CONFIG.DISCOVERY_CONCURRENCY,
      availableRequests,
      remainingRecordCapacity
    ));
    let waveCapacity = resultCap - scannedRecords;
    let unattemptedCoverageBranches = coverageBranches.filter((branch) => !branch.attempted).length;
    wave.forEach((branch, index) => {
      const branchRemaining = CATALOG_CONFIG.MAX_RESULTS_PER_DISCOVERY_BRANCH - branch.scanned;
      // Until each advertiser has received its primary query, reserve a fair
      // share for every remaining advertiser, not just the current concurrent
      // wave. This prevents early large catalogs from exhausting the record
      // cap before a later advertiser is queried.
      const protectedBranches = Math.max(wave.length - index, unattemptedCoverageBranches);
      const fairShare = Math.ceil(waveCapacity / protectedBranches);
      branch.requestedLimit = Math.max(1, Math.min(CATALOG_CONFIG.UPSTREAM_PAGE_SIZE, branchRemaining, fairShare));
      waveCapacity -= branch.requestedLimit;
      branch.attempted = true;
      if (coverageBranches.includes(branch)) unattemptedCoverageBranches -= 1;
    });
    requestCount += wave.length;
    const responses = await Promise.allSettled(wave.map((branch) => {
      if (deadline?.expired) return Promise.reject(new CJDiscoveryDeadlineError());
      return settleWithinCJDiscoveryDeadline(fetchPage({
        keywords: branch.query.keywords,
        partnerIds: branch.scope.partnerIds,
        limit: branch.requestedLimit,
        offset: branch.offset,
        signal: deadline?.signal,
        timeoutMs: deadline?.remainingMs()
      }), deadline);
    }));

    responses.forEach((response, index) => {
      const branch = wave[index];
      if (response.status === 'rejected') {
        branch.failed = true;
        branch.timedOut = isCJDiscoveryDeadlineError(response.reason);
        return;
      }
      branch.successful = true;
      const rawPageProducts = Array.isArray(response.value?.resultList) ? response.value.resultList : [];
      const pageProducts = rawPageProducts.slice(0, branch.requestedLimit);
      if (rawPageProducts.length > pageProducts.length) truncatedReasons.add('upstream-page-overflow');
      const remainingCapacity = Math.max(0, resultCap - scannedRecords);
      const acceptedProducts = pageProducts.slice(0, remainingCapacity);
      products.push(...acceptedProducts);
      scannedRecords += acceptedProducts.length;
      branch.scanned += acceptedProducts.length;
      branch.offset += pageProducts.length;
      const reportedTotal = Number(response.value?.totalCount);
      if (Number.isFinite(reportedTotal) && reportedTotal >= 0) {
        branch.reportedTotal = Math.max(Math.floor(reportedTotal), branch.offset);
      } else if (pageProducts.length < branch.requestedLimit) {
        branch.reportedTotal = branch.offset;
      }

      const droppedProducts = pageProducts.length - acceptedProducts.length;
      const reachedReportedEnd = branch.reportedTotal !== null && branch.offset >= branch.reportedTotal;
      const shortPage = pageProducts.length < branch.requestedLimit;
      if (droppedProducts > 0) {
        truncatedReasons.add('aggregate-result-cap');
      } else if (reachedReportedEnd || shortPage || pageProducts.length === 0) {
        branch.complete = true;
      } else if (branch.scanned >= CATALOG_CONFIG.MAX_RESULTS_PER_DISCOVERY_BRANCH) {
        truncatedReasons.add('branch-result-cap');
      } else if (scannedRecords >= resultCap) {
        truncatedReasons.add('aggregate-result-cap');
      } else {
        queue.push(branch);
      }
    });
    if (deadline?.expired) {
      truncatedReasons.add('response-time-limit');
      break;
    }
  }

  if (queue.length) {
    if (requestCount >= CATALOG_CONFIG.MAX_DISCOVERY_REQUESTS) truncatedReasons.add('request-cap');
    if (scannedRecords >= resultCap) truncatedReasons.add('aggregate-result-cap');
  }
  const failedBranches = branches.filter((branch) => branch.failed).length;
  const deadlineExceeded = Boolean(deadline?.expired || branches.some((branch) => branch.timedOut));
  if (deadlineExceeded) truncatedReasons.add('response-time-limit');
  if (failedBranches === branches.length && branches.length && !deadlineExceeded) {
    throw new Error('All CJ discovery branches failed.');
  }
  if (failedBranches) truncatedReasons.add('partial-upstream-failure');

  const reportedTotals = branches
    .map((branch) => branch.reportedTotal)
    .filter((value) => Number.isFinite(value));
  return {
    products,
    branches,
    requestCount,
    scannedRecords,
    failedBranches,
    deadlineExceeded,
    reportedTotalLowerBound: reportedTotals.length ? Math.max(...reportedTotals) : products.length,
    complete: branches.length > 0 && branches.every((branch) => branch.complete && !branch.failed),
    truncatedReasons: [...truncatedReasons]
  };
}

function catalogQueryIncludesBrand(query, brand) {
  const queryText = ` ${normalizeBrandText(query)} `;
  const canonicalBrand = normalizeBrandKey(brand);
  if (!canonicalBrand || !queryText.trim()) return false;
  const acceptedNames = new Set([canonicalBrand]);
  for (const [alias, canonical] of BRAND_ALIASES) {
    if (canonical === canonicalBrand) acceptedNames.add(alias);
  }
  return [...acceptedNames].some((candidate) => queryText.includes(` ${candidate} `));
}

function buildCJProductKeywords(options = {}) {
  // A GTIN query is already exact. Adding the default "fragrance" keyword can
  // accidentally exclude a valid retailer record whose title uses other terms.
  const genericCatalogQuery = /^(?:fragrance\s+perfume|perfume\s+fragrance)$/i.test((options.query || '').trim());
  const brandQuery = normalizeText(options.brand, 100);
  const queryIsOnlyBrand = Boolean(brandQuery)
    && normalizeBrandKey(options.query) === normalizeBrandKey(brandQuery);
  const queryAlreadyNamesBrand = Boolean(brandQuery)
    && catalogQueryIncludesBrand(options.query, brandQuery);
  return options.gtin ? null : brandQuery
    ? [options.query && !genericCatalogQuery && !queryIsOnlyBrand
      ? (queryAlreadyNamesBrand ? options.query : `${brandQuery} ${options.query}`)
      : brandQuery]
    : options.query
    ? (options.exactMatch ? [options.query] : options.query.split(/\s+/).filter(Boolean))
    : ['fragrance', 'perfume', 'cologne', 'eau de parfum', 'eau de toilette'];
}

function buildShoppingProductsQuery() {
  return `
    query shoppingProducts(
      $companyId: ID!, $keywords: [String!], $limit: Int!, $offset: Int!, $websiteId: ID!,
      $lowPrice: Float, $highPrice: Float, $partnerIds: [ID!], $partnerStatus: PartnerStatus,
      $currency: String, $serviceableAreas: [String!], $gtin: String, $availability: Availability
    ) {
      shoppingProducts(
        companyId: $companyId, keywords: $keywords, limit: $limit, offset: $offset,
        lowPrice: $lowPrice, highPrice: $highPrice, partnerIds: $partnerIds,
        partnerStatus: $partnerStatus, currency: $currency, serviceableAreas: $serviceableAreas,
        gtin: $gtin, availability: $availability
      ) {
        totalCount
        resultList {
          id
          adId
          catalogId
          title
          brand
          lastUpdated
          price { amount currency }
          salePrice { amount currency }
          salePriceEffectiveDateStart
          salePriceEffectiveDateEnd
          imageLink
          additionalImageLink
          advertiserName
          advertiserId
          advertiserCountry
          description
          productType
          productHighlight
          productDetail { sectionName attributeName attributeValue }
          googleProductCategory { id name }
          availability
          availabilityDate
          expirationDate
          condition
          size
          unitPricingMeasure
          unitPricingBaseMeasure
          gender
          ageGroup
          gtin
          mpn
          itemGroupId
          multipack
          isBundle
          color
          material
          pattern
          productLength
          productWidth
          productHeight
          productWeight
          shippingWeight
          shipsFromCountry
          serviceableAreas
          targetCountry
          mobileLink
          link
          shipping {
            price { amount currency }
            service
            country
            minimumHandlingTime
            maximumHandlingTime
            minimumTransitTime
            maximumTransitTime
          }
          linkCode(pid: $websiteId) {
            clickUrl
          }
        }
      }
    }
  `;
}

const BRAND_ALIASES = new Map([
  ['christian dior', 'dior'],
  ['christian dior parfums', 'dior'],
  ['parfums christian dior', 'dior'],
  ['dior beauty', 'dior'],
  ['tomford', 'tom ford'],
  ['tom ford beauty', 'tom ford'],
  ['house of creed', 'creed'],
  ['creed fragrances', 'creed'],
  ['chanel paris', 'chanel'],
  ['ysl', 'yves saint laurent'],
  ['saint laurent', 'yves saint laurent'],
  ['mfk', 'maison francis kurkdjian'],
  ['maison francis kurkdjian paris', 'maison francis kurkdjian'],
  ['d and g', 'dolce and gabbana'],
  ['dolce gabbana', 'dolce and gabbana']
]);

function normalizeBrandText(value) {
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

function normalizeBrandKey(value) {
  const key = normalizeBrandText(value);
  return BRAND_ALIASES.get(key) || key;
}

function matchesBrandFilter(productBrand, brandFilter) {
  if (!brandFilter) return true;
  const requested = normalizeBrandKey(brandFilter);
  return Boolean(requested) && normalizeBrandKey(productBrand) === requested;
}

function matchesRawProductBrand(product, brandFilter) {
  if (!brandFilter) return true;
  const rawBrand = normalizeFeedValues(product?.brand, 10)[0];
  return Boolean(rawBrand) && matchesBrandFilter(rawBrand, brandFilter);
}

function equivalentCatalogBrandNames(value) {
  const canonical = normalizeBrandKey(value);
  if (!canonical) return [];
  const names = new Set([value, canonical]);
  for (const [alias, aliasCanonical] of BRAND_ALIASES) {
    if (aliasCanonical === canonical) names.add(alias);
  }
  return [...names].filter(Boolean);
}

function matchesExactCatalogText(product, textQuery) {
  const queryWords = normalizeSearchWords(textQuery);
  if (!queryWords.length) return true;
  const brand = normalizeFeedValues(product?.brand, 10)[0] || product?.brand || '';
  const searchable = [
    product?.title || product?.name,
    brand,
    product?.description,
    ...equivalentCatalogBrandNames(brand)
  ].filter(Boolean).join(' ');
  const allWords = new Set(normalizeSearchWords(searchable));
  return queryWords.every((queryWord) => allWords.has(queryWord));
}

const CATALOG_INTENT_PARAMS = Object.freeze({
  audience: Object.freeze({ men: 'Men', women: 'Women', unisex: 'Unisex' }),
  concentration: Object.freeze({
    extrait: 'Extrait de Parfum',
    eau_de_parfum: 'Eau de Parfum',
    eau_de_toilette: 'Eau de Toilette',
    eau_de_cologne: 'Eau de Cologne',
    parfum: 'Parfum',
    perfume_oil: 'Perfume Oil',
    fragrance_mist: 'Fragrance Mist'
  }),
  form: Object.freeze({ spray: 'Spray', roll_on: 'Roll-on', splash: 'Splash', solid: 'Solid' }),
  presentation: Object.freeze({
    set: 'Set',
    refill: 'Refill',
    tester: 'Tester',
    sample: 'Sample',
    travel_size: 'Travel size',
    bundle: 'Bundle'
  })
});

const CATALOG_INTENT_SLUGS = Object.freeze(Object.fromEntries(
  Object.entries(CATALOG_INTENT_PARAMS).map(([facet, values]) => [
    facet,
    Object.freeze(Object.fromEntries(Object.entries(values).map(([slug, label]) => [label.toLowerCase(), slug])))
  ])
));

// Keep this grammar in lockstep with the browser parser. Complete possessive
// and plural phrases must be consumed so they cannot leak into text matching.
const WOMEN_AUDIENCE_TERM = "(?:women(?:'?s)?|woman(?:'?s)?|ladies(?:'s|')?|lady(?:'s)?|females?(?:'s|')?)(?![\\p{L}\\p{N}])";
const MEN_AUDIENCE_TERM = "(?:men(?:'?s)?|man(?:'?s)?|gentlemen(?:'s|')?|gentleman(?:'s)?|males?(?:'s|')?)(?![\\p{L}\\p{N}])";
const SEARCH_AUDIENCE_PATTERNS = Object.freeze({
  unisex: new RegExp(`\\b(?:unisex|gender[ -]?neutral|(?:for\\s+)?${WOMEN_AUDIENCE_TERM}\\s*(?:and|&|\\/)\\s*${MEN_AUDIENCE_TERM}|(?:for\\s+)?${MEN_AUDIENCE_TERM}\\s*(?:and|&|\\/)\\s*${WOMEN_AUDIENCE_TERM})`, 'iu'),
  women: new RegExp(`\\b(?:${WOMEN_AUDIENCE_TERM}|for\\s+her|pour\\s+femme)`, 'iu'),
  men: new RegExp(`\\b(?:${MEN_AUDIENCE_TERM}|for\\s+him|pour\\s+homme)`, 'iu')
});

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/[–—_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeSearchWords(value) {
  return normalizeSearchText(value)
    .replace(/'s\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function consumeSearchPattern(state, pattern) {
  if (!pattern.test(state.text)) return false;
  state.text = state.text.replace(pattern, ' ');
  return true;
}

function parseSearchVolumeIntent(state) {
  const unit = '(?:fl\\.?\\s*oz|fluid\\s+ounces?|ounces?|oz|ml|millilit(?:er|re)s?|cl|centilit(?:er|re)s?)';
  const multipackPattern = new RegExp(`\\b\\d{1,2}\\s*(?:x|×)\\s*\\d{1,4}(?:\\.\\d{1,3})?\\s*${unit}\\b`, 'i');
  const singlePattern = new RegExp(`\\b\\d{1,4}(?:\\.\\d{1,3})?\\s*${unit}\\b`, 'i');
  const match = state.text.match(multipackPattern) || state.text.match(singlePattern);
  if (!match) return { unitSizeMl: null, packCount: null };
  const parsed = parseFragranceVolume(match[0]);
  if (!parsed) return { unitSizeMl: null, packCount: null };
  state.text = state.text.replace(match[0], ' ');
  return {
    unitSizeMl: parsed.unitMl,
    packCount: parsed.quantity > 1 ? parsed.quantity : null
  };
}

function parseCatalogSearchIntent(query) {
  const rawQuery = normalizeText(query, 120);
  const state = { text: normalizeSearchText(rawQuery) };
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

  if (consumeSearchPattern(state, SEARCH_AUDIENCE_PATTERNS.unisex)) {
    intent.audience = 'Unisex';
  } else if (consumeSearchPattern(state, SEARCH_AUDIENCE_PATTERNS.women)) {
    intent.audience = 'Women';
  } else if (consumeSearchPattern(state, SEARCH_AUDIENCE_PATTERNS.men)) {
    intent.audience = 'Men';
  }

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
    if (consumeSearchPattern(state, pattern)) {
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
    if (consumeSearchPattern(state, pattern)) {
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
    if (consumeSearchPattern(state, pattern)) {
      intent.form = value;
      break;
    }
  }

  if (consumeSearchPattern(state, /\b(?:in[ -]?stock|available\s+now)\b/i)) intent.availability = 'IN_STOCK';
  if (consumeSearchPattern(state, /\bfree\s+(?:delivery|shipping)\b/i)) intent.shipping = 'free';

  Object.assign(intent, parseSearchVolumeIntent(state));

  intent.textQuery = state.text
    .replace(/\b(?:perfumes?|fragrances?|scents?|colognes?)\b/gi, ' ')
    .replace(/\b(?:for|with|only)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  intent.retrievalQuery = intent.textQuery || 'fragrance perfume';
  return intent;
}

function normalizeCatalogIntentParam(facet, value) {
  const slug = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return CATALOG_INTENT_PARAMS[facet]?.[slug] || null;
}

function catalogIntentSlug(facet, value) {
  return CATALOG_INTENT_SLUGS[facet]?.[String(value || '').toLowerCase()] || null;
}

function readExplicitCatalogSearchIntent(searchParams) {
  const requestedSize = Number(searchParams.get('sizeMl'));
  const requestedPackCount = Number.parseInt(searchParams.get('packCount') || '', 10);
  return {
    audience: normalizeCatalogIntentParam('audience', searchParams.get('audience')),
    concentration: normalizeCatalogIntentParam('concentration', searchParams.get('concentration')),
    form: normalizeCatalogIntentParam('form', searchParams.get('form')),
    presentation: normalizeCatalogIntentParam('presentation', searchParams.get('presentation')),
    unitSizeMl: Number.isFinite(requestedSize) && requestedSize >= 0.2 && requestedSize <= 10_000 ? requestedSize : null,
    packCount: Number.isInteger(requestedPackCount) && requestedPackCount >= 2 && requestedPackCount <= 50 ? requestedPackCount : null
  };
}

function mergeCatalogSearchIntent(inferred, explicit = {}) {
  return {
    ...inferred,
    audience: explicit.audience || inferred.audience,
    concentration: explicit.concentration || inferred.concentration,
    form: explicit.form || inferred.form,
    presentation: explicit.presentation || inferred.presentation,
    unitSizeMl: explicit.unitSizeMl ?? inferred.unitSizeMl,
    packCount: explicit.packCount ?? inferred.packCount
  };
}

function hasStructuredCatalogIntent(intent) {
  return Boolean(intent && (
    intent.audience || intent.concentration || intent.form || intent.presentation
    || intent.unitSizeMl !== null || intent.packCount !== null
    || intent.availability || intent.shipping
  ));
}

function publicCatalogSearchIntent(intent) {
  return {
    audience: catalogIntentSlug('audience', intent.audience),
    concentration: catalogIntentSlug('concentration', intent.concentration),
    form: catalogIntentSlug('form', intent.form),
    presentation: catalogIntentSlug('presentation', intent.presentation),
    sizeMl: intent.unitSizeMl,
    packCount: intent.packCount,
    availability: intent.availability,
    shipping: intent.shipping
  };
}

function canonicalAudience(values) {
  const labels = new Set((Array.isArray(values) ? values : [values]).map(labelAudience).filter((value) => ['Men', 'Women', 'Unisex'].includes(value)));
  if (labels.has('Unisex') || (labels.has('Men') && labels.has('Women'))) return 'Unisex';
  if (labels.size !== 1) return null;
  return [...labels][0];
}

function normalizeComparableFacet(value) {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchesCatalogSearchIntent(product, intent) {
  if (!hasStructuredCatalogIntent(intent)) return true;
  if (intent.audience && canonicalAudience(product.audience) !== intent.audience) return false;
  if (intent.concentration && normalizeComparableFacet(product.concentration || product.fragranceConcentration) !== normalizeComparableFacet(intent.concentration)) return false;
  if (intent.form && normalizeComparableFacet(product.fragranceForm) !== normalizeComparableFacet(intent.form)) return false;
  if (intent.presentation && normalizeComparableFacet(product.presentation) !== normalizeComparableFacet(intent.presentation)) return false;
  if (intent.unitSizeMl !== null) {
    const unitSize = normalizeNonNegativeNumber(product.unitSizeMl ?? product.canonicalSizeMl ?? product.normalizedSizeMl);
    const tolerance = Math.max(0.6, intent.unitSizeMl * 0.025);
    if (unitSize === null || Math.abs(unitSize - intent.unitSizeMl) > tolerance) return false;
  }
  if (intent.packCount !== null && normalizeNonNegativeNumber(product.packCount ?? product.sizeQuantity) !== intent.packCount) return false;
  return true;
}

function matchesPriceFilters(price, lowPrice, highPrice) {
  const amount = normalizeNonNegativeNumber(price);
  if (amount === null) return false;
  if (lowPrice !== null && amount < lowPrice) return false;
  if (highPrice !== null && amount > highPrice) return false;
  return true;
}

function matchesAvailabilityFilter(productAvailability, requestedAvailability) {
  if (!requestedAvailability) return true;
  return String(productAvailability || '').trim().toUpperCase().replace(/[ -]+/g, '_') === requestedAvailability;
}

function matchesServiceableCountry(product, requestedCountry) {
  if (!requestedCountry) return true;
  const suppliedCountries = [...normalizeFeedValues(product.serviceableAreas, 30), product.targetCountry]
    .filter(Boolean)
    .map((value) => String(value).trim().toUpperCase());
  return suppliedCountries.includes(requestedCountry);
}

function rankProducts(products, query, sortBy, brandFilter, popularity) {
  const filtered = products.filter((product) => matchesBrandFilter(product.brand, brandFilter));
  switch (sortBy) {
    case 'trending':
      return filtered.sort((a, b) => (popularity.get(b.id) || 0) - (popularity.get(a.id) || 0)
        || calculateRelevance(b, query) - calculateRelevance(a, query)
        || compareCatalogIdentity(a, b));
    case 'deals':
      return filtered.sort((a, b) => calculateDiscountPercent(b) - calculateDiscountPercent(a)
        || compareCatalogPrice(a, b)
        || compareCatalogIdentity(a, b));
    case 'newest':
      return filtered.sort((a, b) => catalogTimestamp(b.lastUpdated) - catalogTimestamp(a.lastUpdated)
        || compareCatalogIdentity(a, b));
    case 'price_low':
      return filtered.sort((a, b) => compareCatalogPrice(a, b)
        || compareCatalogIdentity(a, b));
    case 'price_high':
      return filtered.sort((a, b) => compareCatalogPrice(a, b, -1)
        || compareCatalogIdentity(a, b));
    case 'relevance':
      return filtered.sort((a, b) => calculateRelevance(b, query) - calculateRelevance(a, query)
        || compareCatalogIdentity(a, b));
    case 'featured':
    default:
      return filtered.sort((a, b) => calculateFeaturedScore(b, query, popularity) - calculateFeaturedScore(a, query, popularity)
        || compareCatalogIdentity(a, b));
  }
}

function compareCatalogIdentity(left, right) {
  const identity = (product) => [
    product.productKey,
    product.offerKey,
    product.advertiserId,
    product.catalogId,
    product.id,
    product.name || product.title
  ].filter(Boolean).join(':');
  return identity(left).localeCompare(identity(right));
}

function compareCatalogPrice(left, right, direction = 1) {
  const currencyOrder = String(left.currency || '').localeCompare(String(right.currency || ''));
  if (currencyOrder) return currencyOrder;
  return direction * (Number(left.price) - Number(right.price));
}

function catalogTimestamp(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function calculateFeaturedScore(product, query, popularity) {
  let score = calculateRelevance(product, query);
  if (/in[ _-]?stock/i.test(product.availability || '')) score += 24;
  if (calculateDiscountPercent(product) > 0) score += 18;
  if (product.shippingCost === 0) score += 8;
  else if (product.shippingCost !== null) score += 4;
  if (product.gtin) score += 5;
  if (product.additionalImages.length > 1) score += 4;
  if (product.highlights.length) score += 3;
  score += Math.min(popularity.get(product.id) || 0, 20);
  return score;
}

function calculateRelevance(product, query) {
  if (!query) return 0;
  const queryLower = query.toLowerCase();
  const titleLower = (product.name || product.title || '').toLowerCase();
  const brandLower = product.brand?.toLowerCase() || '';
  const supporting = [product.productTypes, product.concentration, product.presentation].flat().filter(Boolean).join(' ').toLowerCase();
  let score = 0;
  if (titleLower.includes(queryLower)) score += 100;
  if (brandLower.includes(queryLower)) score += 80;
  const genericTerms = new Set(['fragrance', 'perfume', 'parfum', 'cologne', 'eau', 'de', 'spray', 'for', 'men', 'women', 'unisex']);
  const queryWords = [...new Set(queryLower.split(/\s+/).filter(Boolean))];
  queryWords.forEach(word => {
    const weight = genericTerms.has(word) ? 4 : 20;
    if (titleLower.includes(word)) score += weight;
    if (brandLower.includes(word)) score += genericTerms.has(word) ? 2 : 15;
    if (supporting.includes(word)) score += genericTerms.has(word) ? 1 : 5;
  });
  return score;
}

function formatProduct(p) {
  if (!isNewRetailProduct(p)) {
    return null;
  }

  const clickUrl = normalizeHttpsUrl(p.linkCode?.clickUrl);
  const productLink = normalizeHttpsUrl(p.link); // The actual product landing page URL from CJ
  const pricing = normalizeProductPricing(p.price, p.salePrice);
  const shippingPricing = normalizeProductShipping(p.shipping?.price);
  const productDetails = (Array.isArray(p.productDetail) ? p.productDetail : [p.productDetail]).filter(Boolean);
  const sizeData = extractFragranceSize(p, productDetails);
  const fragranceData = extractFragranceAttributes(p, sizeData, productDetails);
  const brand = normalizeFeedValues(p.brand, 10)[0] || 'Unknown brand';
  const identity = createProductIdentity({ ...p, brand }, fragranceData);
  const variationAdvertiser = normalizeIdentifierPart(p.advertiserId || p.advertiserName).slice(0, 60);
  const variationGroup = normalizeIdentifierPart(p.itemGroupId).slice(0, 80);
  const description = normalizeDistinctDescription(p.description, p.title);
  const additionalImages = normalizeFeedValues(p.additionalImageLink, 10)
    .map(normalizeHttpsUrl)
    .filter(Boolean);
  const primaryImage = normalizeHttpsUrl(p.imageLink) || additionalImages[0] || null;

  // Missing and obviously incorrect prices are not presented as real offers.
  if (!pricing) {
    return null;
  }

  // Determine the final link to use for clicks
  let finalClickUrl;
  // Only publish a URL returned by the partner feed; guessed retailer URLs are unreliable.
  if (clickUrl) {
    finalClickUrl = clickUrl;
  } else if (productLink) {
    finalClickUrl = productLink;
  } else {
    return null;
  }

  return {
    id: normalizeText(String(p.id || ''), 100),
    sourceProductId: normalizeText(String(p.id || ''), 100) || null,
    catalogId: normalizeText(String(p.catalogId || ''), 80) || null,
    offerKey: identity.offerKey,
    productKey: identity.key,
    matchMethod: identity.method,
    matchConfidence: identity.confidence,
    advertiserId: normalizeText(String(p.advertiserId || ''), 40) || null,
    adId: normalizeText(String(p.adId || ''), 40) || null,
    name: normalizeText(p.title, 300) || 'Unnamed fragrance',
    brand,
    price: pricing.price,
    regularPrice: pricing.regularPrice,
    salePrice: pricing.salePrice,
    saleCurrency: pricing.saleCurrency,
    saleStartsAt: p.salePriceEffectiveDateStart || null,
    saleEndsAt: p.salePriceEffectiveDateEnd || null,
    image: primaryImage,
    additionalImages: additionalImages.filter((url) => url !== primaryImage),
    shippingCost: shippingPricing.cost,
    shippingCurrency: shippingPricing.currency,
    shippingService: normalizeText(p.shipping?.service, 80) || null,
    shippingCountry: normalizeText(p.shipping?.country, 8) || null,
    shipsFromCountry: normalizeText(p.shipsFromCountry, 8) || null,
    shippingTiming: {
      minimumHandlingTime: normalizeNonNegativeNumber(p.shipping?.minimumHandlingTime),
      maximumHandlingTime: normalizeNonNegativeNumber(p.shipping?.maximumHandlingTime),
      minimumTransitTime: normalizeNonNegativeNumber(p.shipping?.minimumTransitTime),
      maximumTransitTime: normalizeNonNegativeNumber(p.shipping?.maximumTransitTime)
    },
    buyUrl: finalClickUrl,
    link: finalClickUrl,
    description,
    advertiser: normalizeText(p.advertiserName, 200) || 'Retail partner',
    advertiserCountry: normalizeText(p.advertiserCountry, 8) || null,
    category: normalizeText(p.googleProductCategory?.name, 220) || 'Fragrance',
    googleCategoryId: normalizeText(String(p.googleProductCategory?.id || ''), 40) || null,
    currency: pricing.currency,
    availability: normalizeText(p.availability, 40) || null,
    availabilityDate: p.availabilityDate || null,
    expiresAt: p.expirationDate || null,
    lastUpdated: p.lastUpdated || null,
    condition: normalizeText(p.condition, 40) || null,
    size: sizeData.labels,
    canonicalSizeMl: sizeData.canonicalMl,
    normalizedSizeMl: sizeData.canonicalMl,
    unitSizeMl: sizeData.unitMl,
    totalSizeMl: sizeData.totalMl,
    sizeQuantity: sizeData.quantity,
    packCount: sizeData.quantity,
    sizeSource: sizeData.source,
    sizeConfidence: sizeData.confidence,
    unitPricingMeasure: normalizeText(p.unitPricingMeasure, 80) || null,
    unitPricingBaseMeasure: normalizeText(p.unitPricingBaseMeasure, 80) || null,
    audience: fragranceData.audience,
    ageGroup: normalizeFeedValues(p.ageGroup, 2)[0] || null,
    concentration: fragranceData.concentration,
    fragranceConcentration: fragranceData.concentration,
    fragranceForm: fragranceData.form,
    presentation: fragranceData.presentation,
    variantSignature: fragranceData.variantSignature,
    productTypes: normalizeFeedValues(p.productType, 4),
    highlights: normalizeFeedValues(p.productHighlight, 6),
    specifications: productDetails.slice(0, 30).map((detail) => ({
      section: normalizeText(detail.sectionName, 140) || null,
      name: normalizeText(detail.attributeName, 140) || null,
      value: normalizeText(detail.attributeValue, 1000) || null
    })).filter((detail) => detail.name && detail.value),
    gtin: identity.gtin,
    gtins: identity.gtins,
    mpn: identity.mpn,
    itemGroupId: normalizeText(String(p.itemGroupId || ''), 80) || null,
    variationGroupKey: variationAdvertiser && variationGroup
      ? `advertiser:${variationAdvertiser}:group:${variationGroup}`
      : null,
    multipack: Number.isInteger(Number(p.multipack)) && Number(p.multipack) > 1 ? Number(p.multipack) : null,
    isBundle: ['yes', 'true', '1'].includes(String(p.isBundle || '').toLowerCase()),
    attributes: {
      color: normalizeText(p.color, 100) || null,
      material: normalizeText(p.material, 200) || null,
      pattern: normalizeText(p.pattern, 100) || null
    },
    dimensions: {
      length: normalizeText(p.productLength, 50) || null,
      width: normalizeText(p.productWidth, 50) || null,
      height: normalizeText(p.productHeight, 50) || null,
      weight: normalizeText(p.productWeight, 50) || null,
      shippingWeight: normalizeText(p.shippingWeight, 50) || null
    },
    serviceableAreas: normalizeFeedValues(p.serviceableAreas, 30),
    targetCountry: normalizeText(p.targetCountry, 8) || null,
    freeShippingVerified: shippingPricing.cost === 0,
    // CJ's current publisher Product Feed GraphQL response does not expose
    // consumer ratings or review counts. Keep these explicitly unknown.
    rating: null,
    reviewCount: null
  };
}

function normalizeFeedValues(value, maxItems = 6) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,|]/) : [value];
  return values
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.trim().replace(/\s+/g, ' ').slice(0, 180))
    .slice(0, maxItems);
}

function normalizeDistinctDescription(description, title) {
  const cleanDescription = normalizeText(description, 5000);
  if (!cleanDescription) return null;
  const comparable = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return comparable(cleanDescription) === comparable(title) ? null : cleanDescription;
}

/**
 * Fragrance Collect lists standard new retail merchandise only.
 *
 * Joined specialist-retailer feeds frequently omit `condition`, so missing
 * condition evidence is not treated as proof that an item is used. Explicit
 * non-new evidence always fails closed. Testers, samples, decants, trial vials,
 * partial bottles, and unboxed merchandise are also excluded even when a feed
 * labels them "new": they are not standard sealed retail presentations.
 */
function isNewRetailProduct(product) {
  if (!product || typeof product !== 'object') return false;

  const normalizedEvidence = (value) => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[‐‑‒–—]/g, '-')
    .toLowerCase();
  const conditionDetails = (Array.isArray(product.productDetail)
    ? product.productDetail
    : product.productDetail ? [product.productDetail] : [])
    .filter((detail) => detail && typeof detail === 'object'
      && /\b(?:condition|item\s+condition|product\s+state)\b/i.test(String(detail.attributeName || detail.sectionName || '')))
    .map((detail) => detail.attributeValue);
  const conditionEvidence = normalizedEvidence([
    product.condition,
    product.itemCondition,
    ...conditionDetails
  ].filter(Boolean).join(' '));
  const retailerEvidence = normalizedEvidence([
    product.advertiserName,
    product.advertiser,
    product.marketplace
  ].filter(Boolean).join(' '));
  const presentationEvidence = normalizedEvidence([
    product.title,
    product.presentation,
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
}

function isFragranceProduct(product) {
  const title = String(product.title || '').toLowerCase();
  const category = [product.googleProductCategory?.name, product.productType]
    .flat().filter(Boolean).join(' ').toLowerCase();
  const supporting = [product.description, product.productHighlight, product.productDetail]
    .flat(2).filter(Boolean).map((value) => typeof value === 'object' ? Object.values(value).join(' ') : value).join(' ').toLowerCase();
  const strongFragranceTerm = /\b(?:perfume|parfum|cologne|eau\s+de\s+(?:parfum|toilette|cologne)|extrait(?:\s+de\s+parfum)?|attar|body\s+mist|fragrance\s+mist|perfume\s+oil)\b/i;
  const categoryTerm = /\b(?:perfume|parfum|cologne|fragrances?)\b/i;
  const fragranceWithWearableContext = /\bfragrance\b/i.test(title)
    && /\b(?:spray|for\s+(?:men|women)|unisex|\d+(?:[.,]\d+)?\s*(?:ml|fl\.?\s*oz|oz))\b/i.test(title);
  const listingIdentity = `${title} ${category}`;
  const hardExclusion = /\b(?:fragrance[ -]?free|candle|wax\s+melt|reed\s+diffuser|oil\s+diffuser|home\s+fragrance|room\s+spray|linen\s+spray|pillow\s+spray|air\s+freshener|car\s+(?:scent|freshener)|incense|potpourri|laundry\s+(?:scent|detergent|beads?)|empty\s+(?:travel\s+)?(?:perfume\s+)?(?:bottles?|atomizers?|atomisers?)|refillable\s+(?:travel\s+)?(?:perfume\s+)?(?:bottles?|atomizers?|atomisers?)|(?:perfume\s+)?(?:bottles?|atomizers?|atomisers?)\s+(?:cases?|holders?|dispensers?|refillable|empty)|perfume\s+(?:organizers?|trays?|stands?|making\s+kits?)|gift\s+cards?|replacement\s+(?:perfume\s+)?(?:caps?|nozzles?|sprayers?))\b/i;
  const companionOnly = /\b(?:body\s+(?:lotion|cream|butter|gel|milk|oil|powder|scrub|wash)|hand\s+(?:cream|lotion|wash)|shower\s+(?:cream|gel|oil)|bath\s+(?:foam|gel|oil|salts?)|bar\s+soap|deodorant|antiperspirant|shampoo|conditioner|after[\s-]?shave)\b/i;
  const nonFragranceMerchandise = /\b(?:lipstick|lip\s+(?:balm|color|colour|gloss|liner)|mascara|eye[\s-]?liner|eye[\s-]?shadow|foundation|concealer|make[\s-]?up|nail\s+(?:lacquer|polish)|skin[\s-]?care|serum|moisturi[sz]er|cleanser|toner|sunscreen|sun[\s-]?glasses|eye[\s-]?glasses|handbags?|purses?(?!\s+spray)|wallets?|card\s+holders?|shoes?|sandals?|boots?|belts?|scarves?|jewel(?:ry|lery)|earrings?|necklaces?|bracelets?|watches?|phone\s+cases?)\b/i;
  const nonFragranceCategory = /\b(?:make[\s-]?up|cosmetics?|skin[\s-]?care|hair[\s-]?care|fashion\s+accessories|beauty\s+accessories|handbags?|jewel(?:ry|lery)|footwear)\b/i;
  const qualifiedFragranceSet = strongFragranceTerm.test(title) && /\b(?:set|bundle)\b/i.test(title);

  const explicitFragranceTitle = strongFragranceTerm.test(title) || fragranceWithWearableContext;
  if (hardExclusion.test(listingIdentity)
    || (companionOnly.test(listingIdentity) && !qualifiedFragranceSet)
    || (nonFragranceMerchandise.test(title) && !qualifiedFragranceSet)
    || (nonFragranceCategory.test(category) && !categoryTerm.test(category) && !explicitFragranceTitle)) return false;
  let score = 0;
  if (categoryTerm.test(category) && !/\b(?:home|household|candle|diffuser|air\s+freshener)\b/i.test(category)) score += 7;
  if (strongFragranceTerm.test(title) || fragranceWithWearableContext) score += 6;
  if (strongFragranceTerm.test(supporting)) score += 1;
  return score >= 6;
}

function sanitizePublicCatalogPayload(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizePublicCatalogPayload);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (normalizedKey.includes('revenue')
      || normalizedKey.includes('commission')
      || normalizedKey === 'strategy'
      || normalizedKey === 'testfield') {
      continue;
    }
    sanitized[key] = sanitizePublicCatalogPayload(nestedValue);
  }
  return sanitized;
}

function extractFragranceSize(product, productDetails = []) {
  const sources = [];
  for (const value of normalizeFeedValues(product.size, 8)) {
    sources.push({ name: 'retailer size field', value, rank: 1 });
  }
  if (normalizeText(product.unitPricingMeasure, 100)) {
    sources.push({ name: 'unit-pricing field', value: product.unitPricingMeasure, rank: 2 });
  }
  for (const detail of productDetails) {
    if (/\b(?:size|volume|capacity|net\s+contents?|amount)\b/i.test(String(detail?.attributeName || ''))) {
      sources.push({ name: 'retailer specification', value: detail?.attributeValue, rank: 3 });
    }
  }
  sources.push({ name: 'product title', value: product.title, rank: 4 });
  for (const link of [product.link, product.mobileLink]) {
    const readable = readableProductUrl(link);
    if (readable) sources.push({ name: 'retailer product URL', value: readable, rank: 5 });
  }
  sources.push({ name: 'product description', value: product.description, rank: 6 });

  for (const source of sources.sort((a, b) => a.rank - b.rank)) {
    let parsed = parseFragranceVolume(source.value);
    if (!parsed) continue;
    const reportedPack = Number(product.multipack);
    if (parsed.quantity === 1 && Number.isInteger(reportedPack) && reportedPack > 1 && reportedPack <= 50) {
      parsed = {
        ...parsed,
        quantity: reportedPack,
        totalMl: roundVolume(parsed.unitMl * reportedPack),
        display: `${reportedPack} × ${formatVolumeNumber(parsed.unitMl)} mL`
      };
    }
    const suppliedLabels = normalizeFeedValues(product.size, 4);
    return {
      ...parsed,
      labels: [...new Set([parsed.display, ...suppliedLabels].filter(Boolean))].slice(0, 4),
      source: source.name,
      confidence: source.rank <= 3 ? 'reported' : 'inferred'
    };
  }
  return {
    labels: normalizeFeedValues(product.size, 4),
    canonicalMl: null,
    unitMl: null,
    totalMl: null,
    quantity: null,
    source: null,
    confidence: null
  };
}

function readableProductUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return decodeURIComponent(`${url.pathname} ${url.search}`)
      .replace(/(\d+)-(\d+)-(?=(?:fl-?)?(?:oz|ml|cl)\b)/gi, '$1.$2 ')
      .replace(/(\d+)-(ml|cl|oz)\b/gi, '$1 $2')
      .replace(/fl-oz/gi, 'fl oz')
      .replace(/[-_]+/g, ' ');
  } catch {
    return '';
  }
}

function parseFragranceVolume(value) {
  const text = normalizeText(value, 2500)
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[×✕]/g, 'x');
  if (!text) return null;
  const unitPattern = '(?:fl\\.?\\s*oz(?:\\.|es)?|fluid\\s+ounces?|oz(?:\\.|es)?|m(?:illi)?l(?:it(?:er|re))?s?|c(?:enti)?l(?:it(?:er|re))?s?|l(?:it(?:er|re))s?)';
  const multipack = new RegExp(`\\b(\\d{1,2})\\s*x\\s*(\\d{1,4}(?:\\.\\d{1,3})?)\\s*(${unitPattern})\\b`, 'i').exec(text);
  if (multipack) {
    const quantity = Number(multipack[1]);
    const unitMl = normalizeCommonFragranceVolume(volumeToMl(Number(multipack[2]), multipack[3]));
    if (quantity > 1 && quantity <= 50 && unitMl !== null) {
      return {
        canonicalMl: unitMl,
        unitMl,
        totalMl: roundVolume(unitMl * quantity),
        quantity,
        display: `${quantity} × ${formatVolumeNumber(unitMl)} mL`
      };
    }
  }

  const single = new RegExp(`\\b(\\d{1,4}(?:\\.\\d{1,3})?)\\s*(${unitPattern})\\b`, 'i').exec(text);
  if (!single) return null;
  const amount = Number(single[1]);
  const unit = single[2];
  const canonicalMl = normalizeCommonFragranceVolume(volumeToMl(amount, unit));
  if (canonicalMl === null) return null;
  return {
    canonicalMl,
    unitMl: canonicalMl,
    totalMl: canonicalMl,
    quantity: 1,
    display: /oz|ounce/i.test(unit)
      ? `${formatVolumeNumber(amount)} fl oz / ${formatVolumeNumber(canonicalMl)} mL`
      : `${formatVolumeNumber(canonicalMl)} mL`
  };
}

function volumeToMl(amount, unit) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000) return null;
  const normalizedUnit = String(unit || '').toLowerCase().replace(/[.\s]/g, '');
  if (normalizedUnit.includes('oz') || normalizedUnit.includes('ounce')) return amount * 29.5735295625;
  if (normalizedUnit.startsWith('cl') || normalizedUnit.startsWith('centil')) return amount * 10;
  if (normalizedUnit === 'l' || normalizedUnit.startsWith('lit')) return amount * 1000;
  return amount;
}

function normalizeCommonFragranceVolume(value) {
  if (!Number.isFinite(value) || value < 0.2 || value > 10_000) return null;
  const common = [1, 1.5, 2, 3, 5, 7, 7.5, 8, 10, 15, 20, 25, 30, 40, 50, 60, 75, 80, 90, 100, 120, 125, 150, 200, 250, 500, 1000];
  const nearest = common.reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best, common[0]);
  return Math.abs(nearest - value) <= Math.max(0.35, nearest * 0.03) ? nearest : roundVolume(value);
}

function roundVolume(value) {
  return Math.round(value * 100) / 100;
}

function formatVolumeNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function extractFragranceAttributes(product, sizeData, productDetails = []) {
  const detailText = productDetails.map((detail) => [detail?.attributeName, detail?.attributeValue].filter(Boolean).join(' ')).join(' ');
  const titleAndDetails = `${product.title || ''} ${normalizeFeedValues(product.productType, 10).join(' ')} ${detailText}`;
  const combined = `${titleAndDetails} ${product.description || ''}`;
  const concentrations = [
    ['Extrait de Parfum', /\b(?:extrait(?:\s+de\s+parfum)?|parfum\s+extract)\b/i],
    ['Eau de Parfum', /\b(?:eau\s+de\s+parfum|edp)\b/i],
    ['Eau de Toilette', /\b(?:eau\s+de\s+toilette|edt)\b/i],
    ['Eau de Cologne', /\b(?:eau\s+de\s+cologne|edc)\b/i],
    ['Parfum', /\bparfum\b/i],
    ['Perfume Oil', /\b(?:perfume\s+oil|attar)\b/i],
    ['Fragrance Mist', /\b(?:fragrance|body)\s+mist\b/i]
  ];
  const concentration = concentrations.find(([, pattern]) => pattern.test(titleAndDetails))?.[0]
    || concentrations.find(([, pattern]) => pattern.test(String(product.description || '')))?.[0]
    || null;
  const form = /\broll[ -]?on\b/i.test(combined) ? 'Roll-on'
    : /\bsplash\b/i.test(combined) ? 'Splash'
      : /\bsolid\s+perfume\b/i.test(combined) ? 'Solid'
        : /\b(?:sprays?|atomisers?|atomizers?|vaporisers?|vaporizers?|vaporisateurs?)\b/i.test(combined) ? 'Spray'
          : null;
  const presentation = /\b(?:discovery|sampler|gift|miniature|perfume|fragrance)\s+(?:gift\s+)?sets?\b|\b\d+\s*(?:pieces?|pcs?)\s+(?:perfume\s+|fragrance\s+)?sets?\b/i.test(combined)
    ? 'Set'
    : /\brefills?\b/i.test(combined) ? 'Refill'
      : /\btesters?\b/i.test(combined) ? 'Tester'
        : /\b(?:samples?|decants?|vials?)\b/i.test(combined) ? 'Sample'
          : /\b(?:travel|mini(?:ature)?)\s+(?:size|spray|bottle)\b/i.test(combined) ? 'Travel size'
            : ['yes', 'true', '1'].includes(String(product.isBundle || '').toLowerCase()) ? 'Bundle'
              : 'Single bottle';
  const suppliedAudience = canonicalAudience(normalizeFeedValues(product.gender, 4));
  const titleAudience = inferAudienceFromText(titleAndDetails);
  const descriptionAudience = inferAudienceFromText(product.description);
  // Prefer CJ's structured gender field, then title/specification evidence,
  // then description copy. Mixing conflicting sources makes an exact audience
  // filter look more certain than the retailer data supports.
  const resolvedAudience = suppliedAudience || titleAudience || descriptionAudience;
  const audience = resolvedAudience ? [resolvedAudience] : [];
  const variantSignature = [
    normalizeIdentifierPart(concentration || 'unknown-concentration'),
    normalizeIdentifierPart(presentation),
    normalizeIdentifierPart(form || 'unknown-form'),
    `q${sizeData.quantity || 1}`,
    sizeData.unitMl !== null ? `ml${formatVolumeNumber(sizeData.unitMl).replace('.', '_')}` : 'unknown-size'
  ].join('-');
  return { ...sizeData, concentration, form, presentation, audience, variantSignature };
}

function labelAudience(value) {
  const normalized = normalizeSearchText(value);
  if (SEARCH_AUDIENCE_PATTERNS.unisex.test(normalized)) return 'Unisex';
  if (new RegExp(`^(?:for\\s+)?${WOMEN_AUDIENCE_TERM}$|^pour\\s+femme$`, 'iu').test(normalized)) return 'Women';
  if (new RegExp(`^(?:for\\s+)?${MEN_AUDIENCE_TERM}$|^pour\\s+homme$`, 'iu').test(normalized)) return 'Men';
  return null;
}

function inferAudienceFromText(value) {
  const normalized = normalizeSearchText(value);
  if (SEARCH_AUDIENCE_PATTERNS.unisex.test(normalized)) return 'Unisex';
  if (SEARCH_AUDIENCE_PATTERNS.women.test(normalized)) return 'Women';
  if (SEARCH_AUDIENCE_PATTERNS.men.test(normalized)) return 'Men';
  return null;
}

function rawCJOfferIdentity(product) {
  const retailerOfferKey = createRetailerOfferKey(product);
  if (retailerOfferKey) return retailerOfferKey;

  const advertiser = normalizeIdentifierPart(product?.advertiserId || product?.advertiserName);
  if (!advertiser) return null;
  const catalog = normalizeIdentifierPart(product?.catalogId || product?.adId || 'catalog');
  const gtin = normalizeGtins(product?.gtin)[0]?.canonical;
  const fallback = normalizeIdentifierPart([
    normalizeFeedValues(product?.brand, 2)[0],
    product?.title,
    normalizeFeedValues(product?.size, 2)[0],
    product?.multipack
  ].filter(Boolean).join(' '));
  const productIdentity = gtin ? `gtin-${gtin}` : fallback;
  return productIdentity ? `raw:${advertiser}:${catalog}:${productIdentity}` : null;
}

function cjRecordQuality(product) {
  let score = 0;
  if (normalizeProductPricing(product?.price, product?.salePrice)) score += 16;
  if (normalizeHttpsUrl(product?.linkCode?.clickUrl)) score += 8;
  else if (normalizeHttpsUrl(product?.link)) score += 4;
  if (normalizeHttpsUrl(product?.imageLink)) score += 2;
  if (normalizeFeedValues(product?.brand, 2).length) score += 2;
  if (normalizeText(product?.description, 5000)) score += 1;
  if ((Array.isArray(product?.productDetail) && product.productDetail.length) || (product?.productDetail && typeof product.productDetail === 'object')) score += 1;
  return score;
}

function compareDuplicateCJRecords(candidate, current) {
  const dateDifference = catalogTimestamp(candidate?.lastUpdated) - catalogTimestamp(current?.lastUpdated);
  if (dateDifference) return dateDifference;
  const qualityDifference = cjRecordQuality(candidate) - cjRecordQuality(current);
  if (qualityDifference) return qualityDifference;

  const candidatePrice = normalizeProductPricing(candidate?.price, candidate?.salePrice)?.price;
  const currentPrice = normalizeProductPricing(current?.price, current?.salePrice)?.price;
  if (candidatePrice !== undefined && currentPrice !== undefined && candidatePrice !== currentPrice) {
    return currentPrice - candidatePrice;
  }

  const signature = (product) => [
    product?.title,
    normalizeFeedValues(product?.brand, 2)[0],
    product?.price?.currency,
    product?.price?.amount,
    product?.salePrice?.currency,
    product?.salePrice?.amount,
    product?.linkCode?.clickUrl,
    product?.link
  ].map((value) => String(value || '')).join('\u0000');
  return signature(current).localeCompare(signature(candidate));
}

function deduplicateProducts(products) {
  const deduplicated = [];
  const positions = new Map();
  for (const product of Array.isArray(products) ? products : []) {
    const key = rawCJOfferIdentity(product);
    if (!key || !positions.has(key)) {
      if (key) positions.set(key, deduplicated.length);
      deduplicated.push(product);
      continue;
    }
    const position = positions.get(key);
    if (compareDuplicateCJRecords(product, deduplicated[position]) > 0) {
      deduplicated[position] = product;
    }
  }
  return deduplicated;
}

function normalizePriceFilter(value) {
  if (value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 50_000 ? number : null;
}

function normalizeAvailabilityFilter(value) {
  const normalized = String(value || '').toUpperCase().replace(/[ -]/g, '_');
  return ['IN_STOCK', 'OUT_OF_STOCK', 'PREORDER', 'BACKORDER'].includes(normalized) ? normalized : null;
}

function normalizeShippingFilter(value) {
  const normalized = String(value || '').toLowerCase();
  return ['free', 'unknown', '0-5', '5-10', '10-20', '20+'].includes(normalized) ? normalized : null;
}

function isValidProductKey(value) {
  return /^(?:gtin|mpn|retailer|catalog):[a-zA-Z0-9:_-]{1,210}$/.test(value || '');
}

function matchesShippingFilter(cost, filter) {
  if (!filter) return true;
  if (filter === 'unknown') return cost === null;
  if (filter === 'free') return cost === 0;
  if (cost === null) return false;
  if (filter === '20+') return cost >= 20;
  const [minimum, maximum] = filter.split('-').map(Number);
  return Number.isFinite(minimum) && Number.isFinite(maximum) && cost >= minimum && cost <= maximum;
}

function parseConfiguredAdvertiserIds(value) {
  if (!value || String(value).trim().toLowerCase() === 'all') return null;
  const ids = String(value).split(',').map((id) => id.trim()).filter((id) => /^\d{1,20}$/.test(id));
  return ids.length ? [...new Set(ids)] : null;
}

function normalizeGtin(value) {
  return normalizeGtins(value)[0]?.display || null;
}

function normalizeGtins(value) {
  const candidates = (Array.isArray(value) ? value : [value])
    .flatMap((item) => typeof item === 'string' ? item.split(/[,/|]/) : [])
    .map((item) => item.replace(/[\s-]/g, ''))
    .filter((item) => /^\d+$/.test(item) && [8, 12, 13, 14].includes(item.length) && hasValidGtinCheckDigit(item));
  const seen = new Set();
  return candidates.map((display) => ({
    display,
    // Left-padding lets a UPC-A and its EAN/GTIN representation share an
    // entity key without changing the identifier sent back to CJ searches.
    canonical: [8, 12, 13, 14].includes(display.length) ? display.padStart(14, '0') : display
  })).filter(({ canonical }) => {
    if (seen.has(canonical)) return false;
    seen.add(canonical);
    return true;
  });
}

function hasValidGtinCheckDigit(value) {
  const digits = [...String(value || '')].map(Number);
  if (![8, 12, 13, 14].includes(digits.length) || digits.some((digit) => !Number.isInteger(digit))) return false;
  let sum = 0;
  let weight = 3;
  for (let index = digits.length - 2; index >= 0; index -= 1) {
    sum += digits[index] * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10 === digits.at(-1);
}

function normalizeIdentifierPart(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

function createProductIdentity(product, fragranceData = extractFragranceAttributes(product, extractFragranceSize(product))) {
  const gtins = normalizeGtins(product.gtin);
  const gtin = gtins[0]?.display || null;
  const mpn = normalizeText(normalizeFeedValues(product.mpn, 2)[0], 80) || null;
  const offerKey = createRetailerOfferKey(product);
  if (gtin) {
    return {
      key: `gtin:${gtins[0].canonical}`,
      offerKey,
      gtin,
      gtins: gtins.map(({ display }) => display),
      mpn,
      method: 'GTIN / UPC / EAN',
      confidence: 'exact'
    };
  }

  const brandKey = normalizeIdentifierPart(product.brand).slice(0, 60);
  const mpnKey = normalizeIdentifierPart(mpn).slice(0, 60);
  const hasKnownBrand = brandKey && !['unknown', 'unknown-brand', 'not-listed', 'n-a'].includes(brandKey);
  if (hasKnownBrand && mpnKey) {
    const variantKey = normalizeIdentifierPart(fragranceData.variantSignature || 'unknown-variant').slice(0, 70);
    return {
      key: `mpn:${brandKey}:${mpnKey}:${variantKey}`,
      offerKey,
      gtin: null,
      gtins: [],
      mpn,
      method: 'Brand + MPN',
      confidence: 'high'
    };
  }

  if (offerKey) {
    return {
      key: offerKey,
      offerKey,
      gtin: null,
      gtins: [],
      mpn,
      method: 'Retailer catalog ID',
      confidence: 'retailer'
    };
  }

  const normalized = normalizeIdentifierPart([hasKnownBrand ? product.brand : '', product.title, fragranceData.canonicalMl ? `${fragranceData.canonicalMl}ml` : '']
    .flat()
    .filter(Boolean)
    .join(' ')).slice(0, 180);
  const fallback = normalized || normalizeIdentifierPart(product.id) || 'unknown-product';
  return { key: `catalog:${fallback}`, offerKey: null, gtin: null, gtins: [], mpn, method: 'Brand, name + size', confidence: 'estimated' };
}

function createRetailerOfferKey(product) {
  const advertiser = normalizeIdentifierPart(product.advertiserId || product.advertiserName).slice(0, 32);
  const catalog = normalizeIdentifierPart(product.catalogId || product.adId || 'catalog').slice(0, 48);
  const sourceId = normalizeIdentifierPart(product.id).slice(0, 70);
  if (!advertiser || !sourceId) return null;
  const rawIdentity = `${product.advertiserId || product.advertiserName || ''}\u0000${product.catalogId || product.adId || ''}\u0000${product.id || ''}`;
  return `retailer:v1:${advertiser}:${catalog}:${sourceId}:${stableTextHash(rawIdentity)}`;
}

function stableTextHash(value) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of String(value || '')) {
    const code = character.codePointAt(0);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

function calculateDiscountPercent(product) {
  return product.salePrice !== null && product.regularPrice > product.salePrice
    ? Math.round(((product.regularPrice - product.salePrice) / product.regularPrice) * 100)
    : 0;
}

function attachOfferComparisons(products) {
  const groups = new Map();
  for (const product of products) {
    const group = groups.get(product.productKey) || [];
    group.push(product);
    groups.set(product.productKey, group);
  }
  return products.map((product) => {
    const matched = ['exact', 'high'].includes(product.matchConfidence)
      ? (groups.get(product.productKey) || [product]).filter((offer) => areFragranceVariantsCompatible(product, offer))
      : [product];
    const bestByAdvertiser = new Map();
    for (const offer of matched) {
      // A retailer can publish country/currency-specific offers for one GTIN.
      // Retain one best offer per retailer and currency; comparing the bare
      // numbers would otherwise discard valid offers or call the wrong one
      // cheapest.
      const advertiserKey = `${offer.advertiserId || offer.advertiser || offer.id}\u0000${offer.currency || ''}`;
      const existing = bestByAdvertiser.get(advertiserKey);
      if (!existing || offer.price < existing.price
        || (offer.price === existing.price && compareCatalogIdentity(offer, existing) < 0)) {
        bestByAdvertiser.set(advertiserKey, offer);
      }
    }
    const offers = [...bestByAdvertiser.values()];
    const oneCurrency = new Set(offers.map((offer) => offer.currency)).size === 1;
    const lowest = oneCurrency
      ? offers.reduce((best, offer) => offer.price < best.price ? offer : best, offers[0])
      : null;
    return {
      ...product,
      discountPercent: calculateDiscountPercent(product),
      offerCount: offers.length,
      bestOffer: Boolean(lowest && (lowest.offerKey
        ? lowest.offerKey === product.offerKey
        : lowest.id === product.id && lowest.advertiserId === product.advertiserId)),
      comparison: offers.length > 1 ? offers.map((offer) => ({
        id: offer.id,
        sourceProductId: offer.sourceProductId,
        catalogId: offer.catalogId,
        offerKey: offer.offerKey,
        advertiserId: offer.advertiserId,
        advertiser: offer.advertiser,
        price: offer.price,
        regularPrice: offer.regularPrice,
        currency: offer.currency,
        shippingCost: offer.shippingCost,
        shippingCurrency: offer.shippingCurrency,
        availability: offer.availability,
        buyUrl: offer.buyUrl
      })).sort((a, b) => a.currency === b.currency
        ? a.price - b.price || String(a.offerKey || a.id).localeCompare(String(b.offerKey || b.id))
        : a.currency.localeCompare(b.currency)) : []
    };
  });
}

function areFragranceVariantsCompatible(left, right) {
  if (!left || !right) return false;
  const conflictingText = (key) => left[key] && right[key]
    && normalizeIdentifierPart(left[key]) !== normalizeIdentifierPart(right[key]);
  if (conflictingText('concentration') || conflictingText('presentation') || conflictingText('fragranceForm')) return false;
  const leftSize = normalizeNonNegativeNumber(left.normalizedSizeMl ?? left.canonicalSizeMl);
  const rightSize = normalizeNonNegativeNumber(right.normalizedSizeMl ?? right.canonicalSizeMl);
  if (leftSize !== null && rightSize !== null && Math.abs(leftSize - rightSize) > 0.5) return false;
  const leftQuantity = normalizeNonNegativeNumber(left.sizeQuantity);
  const rightQuantity = normalizeNonNegativeNumber(right.sizeQuantity);
  if (leftQuantity !== null && rightQuantity !== null && leftQuantity !== rightQuantity) return false;
  return true;
}

async function loadClickPopularity(env) {
  if (!env.DB || (typeof env.DB !== 'object' && typeof env.DB !== 'function')) return new Map();
  const now = Date.now();
  const cached = clickPopularityCache.get(env.DB);
  if (cached?.value && cached.expiresAt > now) return cached.value;
  if (cached?.promise) return cached.promise;

  const promise = (async () => {
    const scores = new Map();
    try {
      const result = await env.DB.prepare(`
        SELECT product_id, COUNT(*) AS click_count
        FROM outbound_clicks
        WHERE created_at >= datetime('now', '-30 days')
        GROUP BY product_id
        ORDER BY click_count DESC
        LIMIT 500
      `).all();
      for (const row of result.results || []) scores.set(String(row.product_id), Number(row.click_count || 0));
    } catch {
      // The catalog remains deterministic before the additive migration is applied.
    }
    clickPopularityCache.set(env.DB, {
      value: scores,
      expiresAt: Date.now() + CLICK_POPULARITY_CACHE_MS,
      promise: null
    });
    return scores;
  })();
  clickPopularityCache.set(env.DB, {
    value: cached?.value || null,
    expiresAt: cached?.expiresAt || 0,
    promise
  });
  return promise;
}

async function snapshotProductObservationsBounded(env, products) {
  if (!await consumeObservationSnapshotBudget(env)) return;
  await snapshotProductObservations(env, products);
}

async function snapshotProductObservations(env, products) {
  if (!env.DB || !products.length) return;
  const observedOn = new Date().toISOString().slice(0, 10);
  const offers = [...new Map(products
    .filter((product) => product.offerKey)
    .map((product) => [product.offerKey, product])).values()].slice(0, 50);
  if (!offers.length) return;
  const statements = offers.map((product) => env.DB.prepare(`
    INSERT INTO product_offer_observations (
      id, product_key, offer_key, product_id, catalog_id, advertiser_id, advertiser_name,
      title, brand, gtin, normalized_size_ml, concentration, presentation,
      price, sale_price, currency, shipping_cost, availability, observed_on, observed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(offer_key, observed_on) DO UPDATE SET
      product_key = excluded.product_key,
      product_id = excluded.product_id,
      catalog_id = excluded.catalog_id,
      advertiser_id = excluded.advertiser_id,
      advertiser_name = excluded.advertiser_name,
      title = excluded.title,
      brand = excluded.brand,
      gtin = excluded.gtin,
      normalized_size_ml = excluded.normalized_size_ml,
      concentration = excluded.concentration,
      presentation = excluded.presentation,
      price = excluded.price,
      sale_price = excluded.sale_price,
      currency = excluded.currency,
      shipping_cost = excluded.shipping_cost,
      availability = excluded.availability,
      observed_at = CURRENT_TIMESTAMP
  `).bind(
    crypto.randomUUID(), product.productKey, product.offerKey, product.id, product.catalogId,
    product.advertiserId, product.advertiser, product.name, product.brand, product.gtin,
    product.normalizedSizeMl, product.concentration, product.presentation, product.price,
    product.salePrice, product.currency, product.shippingCost, product.availability, observedOn
  ));
  try {
    await env.DB.batch(statements);
    return;
  } catch {
    // During a rolling migration, fall back to the legacy single-series table.
  }

  const legacyStatements = offers.map((product) => env.DB.prepare(`
    INSERT INTO product_observations (
      id, product_key, product_id, advertiser_id, advertiser_name, title, brand, gtin,
      price, sale_price, currency, shipping_cost, availability, observed_on, observed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(product_key, observed_on) DO UPDATE SET
      product_id = excluded.product_id,
      advertiser_id = excluded.advertiser_id,
      advertiser_name = excluded.advertiser_name,
      price = excluded.price,
      sale_price = excluded.sale_price,
      currency = excluded.currency,
      shipping_cost = excluded.shipping_cost,
      availability = excluded.availability,
      observed_at = CURRENT_TIMESTAMP
  `).bind(
    crypto.randomUUID(), product.productKey, product.id, product.advertiserId, product.advertiser,
    product.name, product.brand, product.gtin, product.price, product.salePrice, product.currency,
    product.shippingCost, product.availability, observedOn
  ));
  try {
    await env.DB.batch(legacyStatements);
  } catch {
    // Snapshot history is an enhancement and must not delay or fail catalog responses.
  }
}

async function handleDealsRequest(request, url, env) {
  const headers = {
    ...securityHeaders(request.headers.get('Origin'), env),
    'Cache-Control': 'public, max-age=120, s-maxage=3600, stale-while-revalidate=86400'
  };
  if (await isRateLimited(env, ipPrincipal(request), 'deals', 30, 60 * 1000)) {
    return jsonResponse({ error: 'Too many deal requests. Please try again shortly.' }, 429, headers);
  }

  const type = normalizeText(url.searchParams.get('type') || '', 60).toLowerCase();
  const country = /^[A-Z]{2}$/i.test(url.searchParams.get('country') || '')
    ? url.searchParams.get('country').toUpperCase()
    : '';
  const keywords = normalizeText(url.searchParams.get('q') || '', 100);
  const page = Math.min(Math.max(Number.parseInt(url.searchParams.get('page') || '1', 10) || 1, 1), 100);
  try {
    const validDealTypes = new Set(['coupon', 'sweepstakes', 'product', 'sale/discount', 'free shipping', 'seasonal link', 'site to store']);
    const cacheType = validDealTypes.has(type) ? type : 'all';
    const cacheKey = `cj:deals:${cacheType}:${country || 'all'}:${keywords.toLowerCase()}:${page}:100`;
    if (!await reserveCJBudgetOnCacheMiss(env, cacheKey)) {
      return jsonResponse({ error: 'Retailer promotions are busy. Please try again shortly.' }, 503, { ...headers, 'Retry-After': '60' });
    }
    const result = await getCJDeals(env, { type, country, keywords, page, pageSize: 100 });
    return jsonResponse({
      ...result.data,
      updatedAt: result.updatedAt,
      stale: result.stale,
      warning: result.warning || null,
      disclosure: 'Promotions are supplied by participating retailers. Confirm terms and eligibility on the retailer site.'
    }, 200, headers);
  } catch {
    return jsonResponse({ error: 'Retailer promotions are temporarily unavailable.' }, 503, headers);
  }
}

async function handleAdvertisersRequest(request, url, env) {
  const headers = {
    ...securityHeaders(request.headers.get('Origin'), env),
    'Cache-Control': 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400'
  };
  if (await isRateLimited(env, ipPrincipal(request), 'advertisers', 30, 60 * 1000)) {
    return jsonResponse({ error: 'Too many retailer-directory requests. Please try again shortly.' }, 429, headers);
  }
  const keywords = normalizeText(url.searchParams.get('q') || '', 100);
  try {
    const cacheKey = `cj:advertisers:joined:${keywords.toLowerCase()}:1:100`;
    if (!await reserveCJBudgetOnCacheMiss(env, cacheKey)) {
      return jsonResponse({ error: 'Retailer directory is busy. Please try again shortly.' }, 503, { ...headers, 'Retry-After': '60' });
    }
    const result = await getCJAdvertisers(env, { relationship: 'joined', keywords, pageSize: 100 });
    const advertisers = result.data.advertisers
      .filter((advertiser) => !advertiser.accountStatus || advertiser.accountStatus.toLowerCase() === 'active')
      .map((advertiser) => ({
        id: advertiser.id,
        name: advertiser.name,
        programUrl: advertiser.programUrl,
        language: advertiser.language,
        category: advertiser.category,
        mobileSupported: advertiser.mobileSupported,
        mobileTrackingCertified: advertiser.mobileTrackingCertified,
        relationshipStatus: advertiser.relationshipStatus
      }));
    return jsonResponse({
      advertisers,
      total: advertisers.length,
      updatedAt: result.updatedAt,
      stale: result.stale,
      warning: result.warning || null
    }, 200, headers);
  } catch {
    return jsonResponse({ error: 'Retailer directory is temporarily unavailable.' }, 503, headers);
  }
}

async function handleProductHistoryRequest(request, url, env) {
  const headers = {
    ...securityHeaders(request.headers.get('Origin'), env),
    'Cache-Control': 'public, max-age=300, s-maxage=3600'
  };
  if (await isRateLimited(env, ipPrincipal(request), 'product-history', 60, 60 * 1000)) {
    return jsonResponse({ error: 'Too many history requests. Please try again shortly.' }, 429, headers);
  }
  const productKey = normalizeText(url.searchParams.get('key') || '', 220);
  if (!isValidProductKey(productKey)) {
    return jsonResponse({ error: 'A valid product key is required.' }, 400, headers);
  }
  try {
    let rows = [];
    try {
      const result = await env.DB.prepare(`
        SELECT observed_on, price, sale_price, currency, shipping_cost, availability,
               advertiser_name, offer_key
        FROM product_offer_observations
        WHERE product_key = ? OR offer_key = ?
        ORDER BY observed_on DESC, COALESCE(sale_price, price) ASC
        LIMIT 2000
      `).bind(productKey, productKey).all();
      rows = result.results || [];
    } catch {
      // The additive offer-level migration may still be rolling out.
    }
    if (!rows.length) {
      const legacy = await env.DB.prepare(`
        SELECT observed_on, price, sale_price, currency, shipping_cost, availability,
               advertiser_name, NULL AS offer_key
        FROM product_observations
        WHERE product_key = ?
        ORDER BY observed_on DESC
        LIMIT 366
      `).bind(productKey).all();
      rows = legacy.results || [];
    }
    // For universal identities, retain the least expensive offer for each day
    // and currency. Never compare unlike currencies or silently overwrite a
    // different retailer's observation.
    const daily = new Map();
    for (const row of rows) {
      const key = `${row.observed_on}:${row.currency || ''}`;
      const current = daily.get(key);
      const value = Number(row.sale_price ?? row.price);
      const currentValue = Number(current?.sale_price ?? current?.price);
      if (!current || (Number.isFinite(value) && (!Number.isFinite(currentValue) || value < currentValue))) daily.set(key, row);
    }
    const observations = [...daily.values()]
      .sort((left, right) => String(left.observed_on).localeCompare(String(right.observed_on)) || String(left.currency || '').localeCompare(String(right.currency || '')))
      .slice(-366);
    return jsonResponse({
      productKey,
      observations,
      methodology: 'Daily observations recorded by Fragrance Collect from participating retailer feeds. Exact retailer keys show that listing; universal keys show the lowest observed offer per currency and day. This is not retailer-supplied price history.'
    }, 200, headers);
  } catch {
    return jsonResponse({ productKey, observations: [], methodology: 'No local history is available yet.' }, 200, headers);
  }
}

async function handleOutboundClick(request, env) {
  const origin = request.headers.get('Origin');
  const headers = securityHeaders(origin, env);
  if (!validateSiteOrigin(request, env)) {
    return jsonResponse({ error: 'Unauthorized origin' }, 403, headers);
  }
  if (await isRateLimited(env, ipPrincipal(request), 'outbound-click', 90, 60 * 1000)) {
    return jsonResponse({ error: 'Too many requests.' }, 429, headers);
  }
  try {
    const payload = await readJsonBody(request);
    const productId = normalizeText(payload.productId, 200);
    const advertiserId = /^\d{1,20}$/.test(payload.advertiserId || '') ? payload.advertiserId : null;
    const source = normalizeSelection(payload.source, ['catalog', 'detail', 'comparison', 'deal', 'favorite']) || 'catalog';
    const country = /^[A-Z]{2}$/i.test(payload.country || '') ? payload.country.toUpperCase() : null;
    if (!productId) return jsonResponse({ error: 'Product ID is required.' }, 400, headers);

    let userId = null;
    const token = getTokenFromRequest(request);
    if (token) {
      const session = await getValidSession(env, token);
      if (session && await validateSessionSecurity(session, request)) userId = session.user_id;
    }
    if (!await consumeOutboundWriteBudget(env)) {
      return jsonResponse(
        { error: 'Interaction recording is temporarily busy. Please try again shortly.', retryAfter: 60 },
        503,
        { ...headers, 'Retry-After': '60' }
      );
    }
    await env.DB.prepare(`
      INSERT INTO outbound_clicks (id, user_id, product_id, advertiser_id, source, country)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), userId, productId, advertiserId, source, country).run();
    return jsonResponse({ accepted: true }, 202, { ...headers, 'Cache-Control': 'no-store' });
  } catch (error) {
    const bodyResponse = bodyErrorResponse(error, headers);
    if (bodyResponse) return bodyResponse;
    return jsonResponse({ error: 'Unable to record the outbound interaction.' }, 400, headers);
  }
}

async function handleGetDealAlerts(request, env) {
  const { user, headers, errorResponse } = await getUserFromRequest(request, env);
  if (errorResponse) return errorResponse;
  try {
    const result = await env.DB.prepare(`
      SELECT id, product_key, product_name, alert_type, target_price, currency, country,
             is_active, last_triggered_at, last_checked_at, created_at, updated_at
      FROM user_deal_alerts
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).bind(user.id).all();
    return jsonResponse({ success: true, alerts: result.results || [] }, 200, { ...headers, 'Cache-Control': 'no-store' });
  } catch {
    return jsonResponse({ error: 'Unable to load deal alerts.' }, 500, headers);
  }
}

async function handleUpsertDealAlert(request, env) {
  const { user, headers, errorResponse } = await getUserFromRequest(request, env);
  if (errorResponse) return errorResponse;
  if (!validateSiteOrigin(request, env)) {
    return jsonResponse({ error: 'Unauthorized origin' }, 403, headers);
  }
  if (!user.emailVerified) {
    return jsonResponse({ error: 'Verify your email before creating a watch.' }, 403, headers);
  }
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
    return jsonResponse({ error: 'Watch notifications are temporarily unavailable.' }, 503, headers);
  }
  if (await isAnyRateLimited(env, [
    { principal: ipPrincipal(request), endpoint: 'deal-alert-create-ip', limit: 10, windowMs: 60 * 60 * 1000 },
    { principal: accountPrincipal(user.id), endpoint: 'deal-alert-create-user', limit: 10, windowMs: 60 * 60 * 1000 }
  ])) {
    return jsonResponse({ error: 'Too many watch changes. Please try again later.' }, 429, headers);
  }
  try {
    const payload = await readJsonBody(request);
    const productKey = normalizeText(payload.productKey, 220);
    const productName = normalizeText(payload.productName, 200);
    const alertType = normalizeSelection(payload.alertType, ['price_drop', 'back_in_stock', 'deal']);
    const targetPrice = normalizeNonNegativeNumber(payload.targetPrice);
    const currency = /^[A-Z]{3}$/.test(payload.currency || '') ? payload.currency : null;
    const country = /^[A-Z]{2}$/i.test(payload.country || '') ? payload.country.toUpperCase() : null;
    if (!isValidProductKey(productKey) || !productName || !alertType) {
      return jsonResponse({ error: 'Product and alert type are required.' }, 400, headers);
    }
    if (alertType === 'price_drop' && targetPrice === null) {
      return jsonResponse({ error: 'A target price is required for price alerts.' }, 400, headers);
    }
    // The cap check and mutation live in one SQLite statement, so concurrent
    // requests cannot both observe an available slot and exceed the limit.
    const result = await env.DB.prepare(`
      INSERT INTO user_deal_alerts (
        id, user_id, product_key, product_name, alert_type, target_price, currency, country, is_active, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP
      WHERE EXISTS (
        SELECT 1 FROM user_deal_alerts
        WHERE user_id = ? AND product_key = ? AND alert_type = ? AND is_active = 1
      ) OR (
        SELECT COUNT(*) FROM user_deal_alerts WHERE user_id = ? AND is_active = 1
      ) < ?
      ON CONFLICT(user_id, product_key, alert_type) DO UPDATE SET
        product_name = excluded.product_name,
        target_price = excluded.target_price,
        currency = excluded.currency,
        country = excluded.country,
        is_active = 1,
        last_checked_at = NULL,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_deal_alerts.is_active = 1 OR (
        SELECT COUNT(*) FROM user_deal_alerts WHERE user_id = ? AND is_active = 1
      ) < ?
    `).bind(
      crypto.randomUUID(), user.id, productKey, productName, alertType, targetPrice, currency, country,
      user.id, productKey, alertType, user.id, MAX_ACTIVE_WATCHES,
      user.id, MAX_ACTIVE_WATCHES
    ).run();
    if (Number(result.meta?.changes || 0) !== 1) {
      return jsonResponse({
        error: `You can keep up to ${MAX_ACTIVE_WATCHES} active watches. Remove one before adding another.`
      }, 409, headers);
    }
    return jsonResponse({ success: true, message: 'Alert saved.' }, 201, { ...headers, 'Cache-Control': 'no-store' });
  } catch (error) {
    const bodyResponse = bodyErrorResponse(error, headers);
    if (bodyResponse) return bodyResponse;
    return jsonResponse({ error: 'Unable to save the alert.' }, 500, headers);
  }
}

async function handleDeleteDealAlert(request, env) {
  const { user, headers, errorResponse } = await getUserFromRequest(request, env);
  if (errorResponse) return errorResponse;
  const alertId = normalizeText(decodeURIComponent(new URL(request.url).pathname.split('/').pop() || ''), 100);
  if (!alertId) return jsonResponse({ error: 'Alert ID is required.' }, 400, headers);
  const result = await env.DB.prepare('DELETE FROM user_deal_alerts WHERE id = ? AND user_id = ?')
    .bind(alertId, user.id).run();
  if (!Number(result.meta?.changes || 0)) return jsonResponse({ error: 'Alert not found.' }, 404, headers);
  return jsonResponse({ success: true }, 200, { ...headers, 'Cache-Control': 'no-store' });
}

async function requireAdmin(request, env) {
  const auth = await getUserFromRequest(request, env);
  if (auth.errorResponse) return auth;
  const allowedUserIds = String(env.ADMIN_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9_-]{1,100}$/.test(id));
  const allowedEmails = String(env.ADMIN_EMAILS || '')
    .split(',')
    .map(normalizeEmail)
    .filter(isValidEmail);
  const hasAssuredIdentity = auth.user.emailVerified && auth.user.hasVerifiedIdentity;
  const allowedByStableId = allowedUserIds.includes(auth.user.id);
  // Email allowlists remain a compatibility path only when Google has verified
  // the same mailbox and the account is keyed by Google's immutable subject.
  const allowedByVerifiedGoogleEmail = auth.user.hasVerifiedGoogleIdentity
    && allowedEmails.includes(normalizeEmail(auth.user.email));
  if (!hasAssuredIdentity || (!allowedByStableId && !allowedByVerifiedGoogleEmail)) {
    return {
      errorResponse: jsonResponse({ error: 'Administrator access is not configured for this account.' }, 403, auth.headers)
    };
  }
  return auth;
}

function isValidISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function getBoundedCJCommissions(env, options = {}) {
  const maxPages = configuredInteger(env.CJ_ADMIN_COMMISSION_MAX_PAGES, 4, 1, 6);
  const records = [];
  let cursor = options.sinceCommissionId || null;
  let payloadComplete = false;
  let lastPayload = null;
  let pagesFetched = 0;

  while (pagesFetched < maxPages) {
    // Commissions are not cached, so reserve the installation-wide budget
    // immediately before every upstream page.
    if (!await consumeCJUpstreamBudget(env)) throw new CJUpstreamBudgetError();
    const payload = await getCJCommissions(env, { ...options, sinceCommissionId: cursor });
    lastPayload = payload;
    records.push(...(Array.isArray(payload?.records) ? payload.records : []));
    pagesFetched += 1;
    if (payload?.payloadComplete) {
      payloadComplete = true;
      break;
    }
    const nextCursor = normalizeText(payload?.maxCommissionId, 100);
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return {
    ...(lastPayload || {}),
    count: records.length,
    records,
    payloadComplete,
    pagesFetched,
    truncated: !payloadComplete
  };
}

async function handleCJAdminRequest(request, url, env) {
  const auth = await requireAdmin(request, env);
  if (auth.errorResponse) return auth.errorResponse;
  const headers = { ...auth.headers, 'Cache-Control': 'no-store' };
  const path = url.pathname;
  const accountLimit = configuredInteger(env.CJ_ADMIN_REQUESTS_PER_15_MINUTES, 12, 5, 60);
  if (await isAnyRateLimited(env, [
    { principal: ipPrincipal(request), endpoint: 'admin-cj-ip', limit: Math.min(accountLimit * 3, 120), windowMs: 15 * 60 * 1000 },
    { principal: accountPrincipal(auth.user.id), endpoint: 'admin-cj-account', limit: accountLimit, windowMs: 15 * 60 * 1000 }
  ])) {
    return jsonResponse({ error: 'Too many CJ administration requests. Please try again later.' }, 429, {
      ...headers,
      'Retry-After': '900'
    });
  }
  try {
    if (path === '/api/admin/cj/summary' && request.method === 'GET') {
      const daysValue = url.searchParams.get('days');
      if (daysValue !== null && (!/^\d{1,3}$/.test(daysValue) || Number(daysValue) < 1 || Number(daysValue) > 365)) {
        return jsonResponse({ error: 'days must be a whole number from 1 through 365.' }, 400, headers);
      }
      const days = daysValue === null ? 30 : Number(daysValue);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const [commissions, localMetrics, syncStatus] = await Promise.all([
        getBoundedCJCommissions(env, { since }),
        loadLocalCJMetrics(env, days),
        env.DB.prepare('SELECT * FROM cj_sync_status ORDER BY source').all().catch(() => ({ results: [] }))
      ]);
      return jsonResponse({
        range: { days, since },
        commissions: summarizeCJCommissions(commissions),
        local: localMetrics,
        sync: syncStatus.results || []
      }, 200, headers);
    }

    if (path === '/api/admin/cj/program-terms' && request.method === 'GET') {
      const advertiserId = url.searchParams.get('advertiserId') || '';
      const activeAfter = url.searchParams.get('activeAfter') || '';
      const activeBefore = url.searchParams.get('activeBefore') || '';
      if (advertiserId && !/^\d{1,20}$/.test(advertiserId)) {
        return jsonResponse({ error: 'advertiserId must contain 1 to 20 digits.' }, 400, headers);
      }
      if ((activeAfter && !isValidISODate(activeAfter)) || (activeBefore && !isValidISODate(activeBefore))) {
        return jsonResponse({ error: 'Program-term dates must use a valid YYYY-MM-DD date.' }, 400, headers);
      }
      if (activeAfter && activeBefore && activeAfter > activeBefore) {
        return jsonResponse({ error: 'activeAfter cannot be later than activeBefore.' }, 400, headers);
      }
      const cacheKey = `cj:terms:${advertiserId || 'all'}:${activeAfter}:${activeBefore}:0:100`;
      if (!await reserveCJBudgetOnCacheMiss(env, cacheKey)) throw new CJUpstreamBudgetError();
      const result = await getCJProgramTerms(env, {
        advertiserId,
        activeAfter: activeAfter || undefined,
        activeBefore: activeBefore || undefined,
        offset: 0,
        limit: 100
      });
      return jsonResponse({ ...result.data, updatedAt: result.updatedAt, stale: result.stale }, 200, headers);
    }

    if (path === '/api/admin/cj/item-list' && request.method === 'GET') {
      const itemListId = url.searchParams.get('id') || '';
      const page = url.searchParams.get('page') || '';
      const pageSizeValue = url.searchParams.get('pageSize');
      if (!/^[A-Za-z0-9._:-]{1,80}$/.test(itemListId)) {
        return jsonResponse({ error: 'A valid item-list id is required.' }, 400, headers);
      }
      if (page && !/^[A-Za-z0-9._~+/=-]{1,256}$/.test(page)) {
        return jsonResponse({ error: 'The item-list page token is invalid.' }, 400, headers);
      }
      if (pageSizeValue !== null && (!/^\d{1,3}$/.test(pageSizeValue) || Number(pageSizeValue) < 1 || Number(pageSizeValue) > 250)) {
        return jsonResponse({ error: 'pageSize must be a whole number from 1 through 250.' }, 400, headers);
      }
      const pageSize = pageSizeValue === null ? 100 : Number(pageSizeValue);
      const cacheKey = `cj:item-list:${itemListId}:${page || 'first'}:${pageSize}`;
      if (!await reserveCJBudgetOnCacheMiss(env, cacheKey)) throw new CJUpstreamBudgetError();
      const result = await getCJItemList(env, itemListId, {
        page: page || null,
        pageSize
      });
      return jsonResponse({ itemList: result.data, updatedAt: result.updatedAt, stale: result.stale }, 200, headers);
    }

    if (path === '/api/admin/cj/advertisers' && request.method === 'GET') {
      if (!await reserveCJBudgetOnCacheMiss(env, 'cj:advertisers:joined::1:100')) {
        return jsonResponse({ error: 'The global CJ request budget is temporarily exhausted.' }, 503, { ...headers, 'Retry-After': '60' });
      }
      const result = await getCJAdvertisers(env, { relationship: 'joined', pageSize: 100 });
      return jsonResponse({ ...result.data, updatedAt: result.updatedAt, stale: result.stale }, 200, headers);
    }

    if (path === '/api/admin/cj/sync' && request.method === 'POST') {
      if (!validateSiteOrigin(request, env)) return jsonResponse({ error: 'Unauthorized origin' }, 403, headers);
      const result = await refreshCJReferenceData(env);
      return jsonResponse({ success: true, result }, 200, headers);
    }

    return jsonResponse({ error: 'Admin CJ endpoint not found.' }, 404, headers);
  } catch (error) {
    if (error instanceof CJUpstreamBudgetError) {
      return jsonResponse({ error: error.message }, 503, { ...headers, 'Retry-After': '60' });
    }
    return jsonResponse({ error: 'CJ reporting is unavailable. Verify API permissions and configuration.' }, 503, headers);
  }
}

async function loadLocalCJMetrics(env, days) {
  const modifier = `-${days} days`;
  try {
    const observationMetrics = env.DB.prepare(`
      SELECT COUNT(*) AS total, COUNT(DISTINCT product_key) AS products,
             COUNT(DISTINCT offer_key) AS offers, MAX(observed_at) AS latest
      FROM product_offer_observations WHERE observed_at >= datetime('now', ?)
    `).bind(modifier).first().catch(() => env.DB.prepare(`
      SELECT COUNT(*) AS total, COUNT(DISTINCT product_key) AS products,
             NULL AS offers, MAX(observed_at) AS latest
      FROM product_observations WHERE observed_at >= datetime('now', ?)
    `).bind(modifier).first());
    const [clicks, observations, alerts] = await Promise.all([
      env.DB.prepare(`
        SELECT COUNT(*) AS total,
               COUNT(DISTINCT product_id) AS products,
               COUNT(DISTINCT advertiser_id) AS advertisers
        FROM outbound_clicks WHERE created_at >= datetime('now', ?)
      `).bind(modifier).first(),
      observationMetrics,
      env.DB.prepare('SELECT COUNT(*) AS total FROM user_deal_alerts WHERE is_active = 1').first()
    ]);
    return { clicks, observations, activeAlerts: Number(alerts?.total || 0) };
  } catch {
    return { clicks: null, observations: null, activeAlerts: 0 };
  }
}

async function recordCJSyncStatus(env, source, success, recordCount = 0, error = null) {
  try {
    await env.DB.prepare(`
      INSERT INTO cj_sync_status (source, last_attempt_at, last_success_at, last_error, record_count, updated_at)
      VALUES (?, CURRENT_TIMESTAMP, CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(source) DO UPDATE SET
        last_attempt_at = CURRENT_TIMESTAMP,
        last_success_at = CASE WHEN excluded.last_success_at IS NOT NULL THEN excluded.last_success_at ELSE cj_sync_status.last_success_at END,
        last_error = excluded.last_error,
        record_count = excluded.record_count,
        updated_at = CURRENT_TIMESTAMP
    `).bind(source, success ? 1 : 0, error ? normalizeText(error, 500) : null, recordCount).run();
  } catch {
    // Sync diagnostics are non-critical.
  }
}

async function refreshCJReferenceData(env) {
  const result = {};
  for (const [source, loader] of [
    ['advertisers', async () => {
      if (!await reserveCJBudgetOnCacheMiss(env, 'cj:advertisers:joined::1:100')) throw new Error('CJ request budget exhausted.');
      return getCJAdvertisers(env, { relationship: 'joined', pageSize: 100 });
    }],
    ['deals', async () => {
      if (!await reserveCJBudgetOnCacheMiss(env, 'cj:deals:all:all::1:100')) throw new Error('CJ request budget exhausted.');
      return getCJDeals(env, { pageSize: 100 });
    }]
  ]) {
    try {
      const response = await loader();
      const count = response.data.advertisers?.length ?? response.data.deals?.length ?? 0;
      result[source] = { success: true, count, stale: response.stale };
      await recordCJSyncStatus(env, source, true, count);
    } catch (error) {
      result[source] = { success: false };
      await recordCJSyncStatus(env, source, false, 0, error.message);
    }
  }
  try {
    const maxCacheRows = configuredInteger(env.CJ_CACHE_MAX_ROWS, 200, 50, 2000);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM cj_cache WHERE datetime(expires_at) <= datetime('now') OR length(payload) > 2000000"),
      env.DB.prepare(`
        DELETE FROM cj_cache WHERE cache_key NOT IN (
          SELECT cache_key FROM cj_cache ORDER BY updated_at DESC LIMIT ?
        )
      `).bind(maxCacheRows),
      env.DB.prepare("DELETE FROM outbound_clicks WHERE created_at < datetime('now', '-13 months')"),
      env.DB.prepare("DELETE FROM product_observations WHERE observed_at < datetime('now', '-18 months')"),
      env.DB.prepare("DELETE FROM product_offer_observations WHERE observed_at < datetime('now', '-18 months')")
    ]);
  } catch {
    // Retention cleanup can retry on the next scheduled event.
  }
  return result;
}

async function cleanupExpiredCredentials(env) {
  if (!env.DB) return;
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM user_sessions WHERE datetime(expires_at) <= datetime('now')"),
      env.DB.prepare("DELETE FROM password_reset_tokens WHERE datetime(expires_at) <= datetime('now') OR datetime(used_at) < datetime('now', '-1 day')"),
      env.DB.prepare("DELETE FROM email_verification_tokens WHERE datetime(expires_at) <= datetime('now') OR datetime(used_at) < datetime('now', '-1 day')"),
      env.DB.prepare("DELETE FROM rate_limits WHERE datetime(window_end) <= datetime('now')")
    ]);
  } catch {
    // Cleanup is idempotent and will retry on the next scheduled event.
  }
}

async function refreshAndNotifyDealAlerts(env) {
  if (!env.DB) return { checkedProducts: 0, notifications: 0 };
  let rows;
  try {
    const result = await env.DB.prepare(`
      SELECT a.id, a.product_key, a.product_name, a.alert_type, a.target_price,
             a.currency, a.country, u.email, u.name
      FROM user_deal_alerts a
      JOIN users u ON u.id = a.user_id
      WHERE a.is_active = 1 AND u.email_verified_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM user_identities i
          WHERE i.user_id = u.id AND i.email_verified_at IS NOT NULL
            AND i.email = u.email COLLATE NOCASE
        )
      ORDER BY COALESCE(a.last_checked_at, '1970-01-01') ASC, a.created_at ASC
      LIMIT 80
    `).all();
    rows = result.results || [];
  } catch {
    return { checkedProducts: 0, notifications: 0 };
  }

  const grouped = new Map();
  for (const row of rows) {
    const current = grouped.get(row.product_key) || [];
    current.push(row);
    grouped.set(row.product_key, current);
  }
  // CJ request volume stays bounded; least-recently checked watches rotate first.
  const groups = [...grouped.values()].slice(0, 8);
  let notifications = 0;
  let checkedProducts = 0;

  for (let index = 0; index < groups.length; index += 3) {
    const batch = groups.slice(index, index + 3);
    const results = await Promise.all(batch.map((alerts) => evaluateDealAlertGroup(env, alerts)));
    checkedProducts += results.length;
    notifications += results.reduce((total, result) => total + result.notifications, 0);
  }

  await recordCJSyncStatus(env, 'deal-alerts', true, checkedProducts);
  return { checkedProducts, notifications };
}

async function evaluateDealAlertGroup(env, alerts) {
  const representative = alerts[0];
  try {
    const gtin = representative.product_key.startsWith('gtin:')
      ? representative.product_key.slice(5)
      : null;
    const retailerAdvertiserId = representative.product_key.startsWith('retailer:v1:')
      ? representative.product_key.split(':')[2]
      : null;
    const partnerId = /^\d{1,20}$/.test(retailerAdvertiserId || '') ? retailerAdvertiserId : null;
    const search = (gtinFilter) => searchCJStore({
      query: representative.product_name,
      limit: 100,
      offset: 0,
      lowPrice: null,
      highPrice: null,
      partnerId,
      currency: null,
      country: null,
      gtin: gtinFilter,
      availability: null,
      exactMatch: false,
      // Scheduled watches already verify the stable product key after
      // retrieval. One focused CJ query avoids spending the public catalog's
      // multi-branch discovery budget for each watched item.
      discoveryMode: 'focused'
    }, env);
    const matchingProducts = (catalog) => deduplicateProducts(catalog.data.products)
      .filter(isFragranceProduct)
      .filter(isNewRetailProduct)
      .map(formatProduct)
      .filter((product) => product && product.productKey === representative.product_key)
      .sort((a, b) => compareCatalogPrice(a, b) || compareCatalogIdentity(a, b));
    let catalog = await search(gtin);
    let candidates = matchingProducts(catalog);
    // Entity keys use canonical GTIN-14 representation so UPC/EAN aliases can
    // match. If CJ indexed only the retailer's shorter display form, fall back
    // to the product name and verify the canonical key after formatting.
    if (!candidates.length && gtin) {
      catalog = await search(null);
      candidates = matchingProducts(catalog);
    }
    if (!candidates.length) {
      await markAlertGroupChecked(env, alerts, 'No matching joined-retailer offer was found.');
      return { notifications: 0 };
    }

    await snapshotProductObservations(env, candidates);
    let notifications = 0;
    for (const alert of alerts) {
      const product = selectAlertProduct(candidates, alert);
      const shouldTrigger = product && matchesAlertCondition(product, alert);

      if (!shouldTrigger) {
        await markAlertChecked(env, alert.id, null);
        continue;
      }

      const claimed = await env.DB.prepare(`
        UPDATE user_deal_alerts
        SET is_active = 0, last_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND is_active = 1
      `).bind(alert.id).run();
      if (Number(claimed.meta?.changes || 0) !== 1) continue;

      try {
        await sendDealAlertEmail(alert, product, env);
        await env.DB.prepare(`
          UPDATE user_deal_alerts
          SET last_triggered_at = CURRENT_TIMESTAMP,
              last_checked_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND is_active = 0
        `).bind(alert.id).run();
        notifications += 1;
      } catch (error) {
        await env.DB.prepare(`
          UPDATE user_deal_alerts
          SET is_active = 1, last_checked_at = CURRENT_TIMESTAMP,
              last_error = 'Notification delivery failed.', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND is_active = 0
        `).bind(alert.id).run();
      }
    }
    return { notifications };
  } catch (error) {
    await markAlertGroupChecked(env, alerts, 'Retailer feed check temporarily failed.');
    return { notifications: 0 };
  }
}

function productServesAlertCountry(product, country) {
  const targetCountry = normalizeText(country, 2).toUpperCase();
  if (!targetCountry) return true;
  const suppliedCountries = [...normalizeFeedValues(product?.serviceableAreas, 30), product?.targetCountry]
    .filter(Boolean)
    .map((value) => String(value).trim().toUpperCase());
  // Preserve watches when a retailer supplied no coverage metadata, but never
  // select a known country-specific offer for the wrong destination.
  return !suppliedCountries.length || suppliedCountries.includes(targetCountry);
}

function matchesAlertCondition(product, alert) {
  if (!product || !alert) return false;
  if (alert.alert_type === 'price_drop') {
    return (!alert.currency || alert.currency === product.currency)
      && product.price <= Number(alert.target_price);
  }
  if (alert.alert_type === 'back_in_stock') return product.availability === 'IN_STOCK';
  if (alert.alert_type === 'deal') return product.salePrice !== null && product.regularPrice > product.salePrice;
  return false;
}

function selectAlertProduct(candidates, alert) {
  const eligible = (Array.isArray(candidates) ? candidates : [])
    .filter((product) => (!alert?.currency || alert.currency === product.currency)
      && productServesAlertCountry(product, alert?.country))
    .sort((a, b) => compareCatalogPrice(a, b) || compareCatalogIdentity(a, b));
  return eligible.find((product) => matchesAlertCondition(product, alert)) || eligible[0] || null;
}

async function markAlertGroupChecked(env, alerts, error) {
  await Promise.all(alerts.map((alert) => markAlertChecked(env, alert.id, error)));
}

async function markAlertChecked(env, alertId, error) {
  try {
    await env.DB.prepare(`
      UPDATE user_deal_alerts
      SET last_checked_at = CURRENT_TIMESTAMP, last_error = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(error ? normalizeText(error, 300) : null, alertId).run();
  } catch {
    // A later scheduled run can retry the watch.
  }
}

async function sendDealAlertEmail(alert, product, env) {
  if (!env.RESEND_API_KEY) throw new Error('Email delivery is not configured.');
  const sender = env.RESEND_FROM || 'Fragrance Collect <support@fragrancecollect.com>';
  const siteBase = env.PUBLIC_SITE_URL || 'https://fragrancecollect.com';
  const productUrl = new URL('/', siteBase);
  productUrl.searchParams.set('q', product.name);
  productUrl.hash = 'shop';
  const triggerLabel = alert.alert_type === 'price_drop'
    ? `The listed price is now ${product.price.toFixed(2)} ${product.currency}.`
    : alert.alert_type === 'back_in_stock'
      ? 'A joined retailer now reports this fragrance in stock.'
      : `A joined retailer now lists a sale price of ${product.price.toFixed(2)} ${product.currency}.`;
  const safeName = escapeHtml(alert.name || 'there');
  const safeProductName = escapeHtml(product.name);
  const safeRetailer = escapeHtml(product.advertiser);
  const safeTrigger = escapeHtml(triggerLabel);
  const safeUrl = escapeHtml(productUrl.toString());

  await sendResendEmail({
    from: sender,
    to: [alert.email],
    subject: `Your Fragrance Collect watch: ${product.name.slice(0, 100)}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#222;max-width:580px;margin:auto;padding:24px">
        <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#80662f">Fragrance Collect watch</p>
        <h1 style="font-family:Georgia,serif;font-size:28px;line-height:1.2">${safeProductName}</h1>
        <p>Hello ${safeName},</p>
        <p>${safeTrigger} The current listing is from ${safeRetailer}.</p>
        <p><a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#C9A646;color:#121212;text-decoration:none;border-radius:6px;font-weight:bold">Review current offers</a></p>
        <p style="font-size:12px;color:#666">Price, stock, shipping, and promotion terms can change. Confirm every detail on the retailer site. This one-time watch has been marked complete; you can create it again from product details.</p>
      </div>`
    }, env);
}

async function attestSchema(env) {
  const requiredTables = [
    'users', 'user_sessions', 'user_preferences', 'user_favorites', 'rate_limits',
    'password_reset_tokens', 'email_verification_tokens', 'user_identities',
    'cj_cache', 'cj_sync_status', 'product_observations', 'product_offer_observations',
    'outbound_clicks', 'user_deal_alerts'
  ];
  const requiredIndexes = [
    'idx_users_email_nocase', 'idx_outbound_clicks_user_date',
    'idx_user_deal_alerts_scheduler', 'idx_user_favorites_user_date',
    'idx_cj_cache_updated_at'
  ];
  const requiredTriggers = [
    'users_email_must_be_normalized_insert', 'users_email_must_be_normalized_update',
    'identities_email_must_be_normalized_insert', 'identities_email_must_be_normalized_update'
  ];
  const [objects, userColumns, identityColumns, sessionColumns, resetColumns, verificationColumns] = await Promise.all([
    env.DB.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'index', 'trigger')").all(),
    env.DB.prepare('PRAGMA table_info(users)').all(),
    env.DB.prepare('PRAGMA table_info(user_identities)').all(),
    env.DB.prepare('PRAGMA table_info(user_sessions)').all(),
    env.DB.prepare('PRAGMA table_info(password_reset_tokens)').all(),
    env.DB.prepare('PRAGMA table_info(email_verification_tokens)').all()
  ]);
  const rows = objects.results || [];
  const tableNames = new Set(rows.filter((row) => row.type === 'table').map((row) => row.name));
  const indexNames = new Set(rows.filter((row) => row.type === 'index').map((row) => row.name));
  const triggerNames = new Set(rows.filter((row) => row.type === 'trigger').map((row) => row.name));
  const columns = (result) => new Set((result.results || []).map((row) => row.name));
  const users = columns(userColumns);
  const identities = columns(identityColumns);
  const sessions = columns(sessionColumns);
  const resets = columns(resetColumns);
  const verifications = columns(verificationColumns);
  const ready = requiredTables.every((name) => tableNames.has(name))
    && requiredIndexes.every((name) => indexNames.has(name))
    && requiredTriggers.every((name) => triggerNames.has(name))
    && ['email', 'password_hash', 'email_verified_at'].every((name) => users.has(name))
    && ['provider', 'provider_subject', 'email_verified_at'].every((name) => identities.has(name))
    && ['token', 'expires_at', 'fingerprint'].every((name) => sessions.has(name))
    && ['token_hash', 'expires_at', 'used_at'].every((name) => resets.has(name))
    && ['token_hash', 'expires_at', 'used_at'].every((name) => verifications.has(name));
  return { ready, version: ready ? RELEASE_CONTRACT.schemaVersion : null };
}

async function handleHealthRequest(request, env) {
  const headers = { ...securityHeaders(request.headers.get('Origin'), env), 'Cache-Control': 'no-store' };
  try {
    await env.DB.prepare('SELECT 1 AS healthy').first();
    const schema = await attestSchema(env);
    const cjTokenConfigured = Boolean(env.CJ_PERSONAL_ACCESS_TOKEN || env.CJ_DEV_KEY);
    const services = {
      database: true,
      schema: schema.ready,
      catalog: Boolean(cjTokenConfigured && env.CJ_COMPANY_ID && env.CJ_WEBSITE_ID),
      cjPromotions: Boolean(cjTokenConfigured && env.CJ_COMPANY_ID && env.CJ_WEBSITE_ID),
      cjReporting: Boolean(cjTokenConfigured && env.CJ_COMPANY_ID && (env.ADMIN_USER_IDS || env.ADMIN_EMAILS)),
      email: Boolean(env.RESEND_API_KEY && env.RESEND_FROM && env.CONTACT_RECIPIENT),
      googleAuth: Boolean(env.GOOGLE_CLIENT_ID)
    };
    const requiredServices = ['database', 'schema', 'catalog', 'email', 'googleAuth'];
    const ready = requiredServices.every((service) => services[service]);
    return jsonResponse({
      status: ready ? 'ok' : 'degraded',
      release: RELEASE_CONTRACT,
      schema,
      capabilities: RELEASE_CAPABILITIES,
      services,
      timestamp: new Date().toISOString()
    }, ready ? 200 : 503, headers);
  } catch {
    return jsonResponse({
      status: 'unavailable',
      release: RELEASE_CONTRACT,
      schema: { ready: false, version: null },
      capabilities: RELEASE_CAPABILITIES,
      services: { database: false },
      timestamp: new Date().toISOString()
    }, 503, headers);
  }
}

function handleVersionRequest(request, env) {
  return jsonResponse({
    release: RELEASE_CONTRACT,
    capabilities: RELEASE_CAPABILITIES
  }, 200, {
    ...securityHeaders(request.headers.get('Origin'), env),
    'Cache-Control': 'no-store'
  });
}

// --- CONTACT FORM HANDLER ---
async function handleContactForm(request, env) {
    const origin = request.headers.get('Origin');

    if (!validateSiteOrigin(request, env)) {
        return jsonResponse({ error: 'Unauthorized origin' }, 403, privateSecurityHeaders(origin, env));
    }

    // Rate limiting: 3 contact form submissions per hour per IP
    if (await isRateLimited(env, ipPrincipal(request), 'contact', 3, 60 * 60 * 1000)) {
        return jsonResponse({
            error: 'Too many contact form submissions. Please try again later.',
            type: 'rate_limit',
            retryAfter: '1 hour'
        }, 429, privateSecurityHeaders(origin, env));
    }

    const headers = privateSecurityHeaders(origin, env);

    try {
        const payload = await readJsonBody(request);
        const name = typeof payload.name === 'string' ? payload.name.trim() : '';
        const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
        const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';
        const message = typeof payload.message === 'string' ? payload.message.trim() : '';

        // Subject mapping for better display names
        const subjectMap = {
            'general': 'General Inquiry',
            'product': 'Product Information Request',
            'order': 'Retailer / Purchase Question',
            'feedback': 'Feedback & Suggestions',
            'partnership': 'Partnership Opportunity'
        };

        // Validation with detailed feedback
        if (!name || !email || !subject || !message) {
            const missingFields = [];
            if (!name) missingFields.push('name');
            if (!email) missingFields.push('email');
            if (!subject) missingFields.push('subject');
            if (!message) missingFields.push('message');

            return jsonResponse({
                error: 'Required fields are missing',
                type: 'validation',
                missingFields: missingFields,
                message: `Please fill in the following fields: ${missingFields.join(', ')}`
            }, 400, headers);
        }

        if (!isValidEmail(email)) {
            return jsonResponse({
                error: 'Invalid email format',
                type: 'validation',
                field: 'email',
                message: 'Please enter a valid email address (e.g., name@example.com)'
            }, 400, headers);
        }

        if (name.length < 2) {
            return jsonResponse({
                error: 'Name too short',
                type: 'validation',
                field: 'name',
                message: 'Name must be at least 2 characters long'
            }, 400, headers);
        }

        if (name.length > 100 || email.length > 254 || message.length > 5000) {
            return jsonResponse({
                error: 'One or more fields are too long',
                type: 'validation',
                message: 'Use at most 100 characters for your name and 5,000 characters for your message.'
            }, 400, headers);
        }

        if (message.length < 10) {
            return jsonResponse({
                error: 'Message too short',
                type: 'validation',
                field: 'message',
                message: 'Message must be at least 10 characters long',
                currentLength: message.length,
                requiredLength: 10
            }, 400, headers);
        }

        // Validate subject
        const validSubjects = ['general', 'product', 'order', 'feedback', 'partnership'];
        if (!validSubjects.includes(subject)) {
            return jsonResponse({
                error: 'Invalid subject selection',
                type: 'validation',
                field: 'subject',
                message: 'Please select a valid subject from the dropdown',
                validOptions: validSubjects
            }, 400, headers);
        }

        // Send email via Resend (if configured)
        if (!env.RESEND_API_KEY) {
            return jsonResponse({
                error: 'Contact service is temporarily unavailable.',
                type: 'service_unavailable',
                message: 'Please email support@fragrancecollect.com directly.'
            }, 503, headers);
        }

        const emailResult = await sendContactEmail({
            name,
            email,
            subject,
            message
        }, env);

        if (!emailResult.success) {
            console.error('Contact email delivery failed.');
            if (emailResult.rateLimited) {
              return jsonResponse({
                error: 'Email delivery is temporarily busy. Please try again later.',
                type: 'service_unavailable',
                retryAfter: emailResult.retryAfter
              }, 503, { ...headers, 'Retry-After': String(emailResult.retryAfter) });
            }
            return jsonResponse({
                error: 'Failed to send email. Please try again later.',
                type: 'email_failure',
                message: 'There was an issue sending your message. Please try again in a few minutes or contact us directly at support@fragrancecollect.com'
            }, 502, headers);
        }

        return jsonResponse({
            success: true,
            message: 'Thank you for your message. We will reply as soon as we can.'
        }, 200, headers);

    } catch (error) {
        const bodyResponse = bodyErrorResponse(error, headers);
        if (bodyResponse) return bodyResponse;
        console.error('Error processing contact form:');

        // Provide more specific error information based on error type
        let errorMessage = 'Failed to process contact form';
        let errorType = 'server_error';

        if (error.message.includes('JSON')) {
            errorMessage = 'Invalid form data received';
            errorType = 'invalid_json';
        } else if (error.message.includes('fetch')) {
            errorMessage = 'Network error occurred while processing your request';
            errorType = 'network_error';
        }

        return jsonResponse({
            error: errorMessage,
            type: errorType,
            message: 'Please try again later or contact us directly at support@fragrancecollect.com',
            timestamp: new Date().toISOString()
        }, 500, headers);
    }
}

// Send contact form email via Resend
async function sendContactEmail({ name, email, subject, message }, env) {
    try {
        if (!env.RESEND_API_KEY) {
            return { success: false, error: 'Email service not configured' };
        }

        // Subject mapping for better display names
        const subjectMap = {
            'general': 'General Inquiry',
            'product': 'Product Information Request',
            'order': 'Retailer / Purchase Question',
            'feedback': 'Feedback & Suggestions',
            'partnership': 'Partnership Opportunity'
        };

        const emailSubject = `Fragrance Collect Contact: ${subjectMap[subject] || subject}`;
        const emailHtml = generateContactEmailHtml(name, email, subjectMap[subject], message);

        const sender = env.RESEND_FROM || 'Fragrance Collect <support@fragrancecollect.com>';
        const recipient = env.CONTACT_RECIPIENT || 'support@fragrancecollect.com';

        const data = await sendResendEmail({
            from: sender,
            to: [recipient],
            subject: emailSubject,
            html: emailHtml,
            reply_to: email
        }, env);

        return { success: true, emailId: data.id };

    } catch (error) {
        console.error('Error sending email via Resend:');
        return error instanceof EmailSendBudgetError
          ? { success: false, rateLimited: true, retryAfter: error.retryAfter, error: error.message }
          : { success: false, error: error.message };
    }
}

// Generate professional HTML email template for contact form
function generateContactEmailHtml(name, email, subject, message) {
    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeSubject = escapeHtml(subject || 'General Inquiry');
    const safeMessage = escapeHtml(message);

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>New Contact Form Submission</title>
        </head>
        <body style="font-family: 'Lato', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #C9A646, #D4B85E); padding: 30px; text-align: center; border-radius: 15px 15px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">New Contact Form Submission</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">Fragrance Collect Customer Inquiry</p>
            </div>

            <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 15px 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="background: white; padding: 25px; border-radius: 10px; margin-bottom: 20px;">
                    <h2 style="color: #C9A646; margin: 0 0 20px 0; font-size: 18px;">Customer Information</h2>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; font-weight: 600; color: #333; width: 120px;">Name:</td>
                            <td style="padding: 8px 0; color: #666;">${safeName}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: 600; color: #333;">Email:</td>
                            <td style="padding: 8px 0; color: #666;">
                                <a href="mailto:${safeEmail}" style="color: #C9A646; text-decoration: none;">${safeEmail}</a>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: 600; color: #333;">Subject:</td>
                            <td style="padding: 8px 0; color: #666;">${safeSubject}</td>
                        </tr>
                    </table>
                </div>

                <div style="background: white; padding: 25px; border-radius: 10px;">
                    <h3 style="color: #C9A646; margin: 0 0 15px 0; font-size: 18px;">Message</h3>
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #C9A646;">
                        <p style="margin: 0; color: #333; line-height: 1.6; white-space: pre-wrap;">${safeMessage}</p>
                    </div>
                </div>

                <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef;">
                    <p style="color: #666; font-size: 14px; margin: 0;">
                        This message was sent via the Fragrance Collect contact form.<br>
                        We will respond as soon as we can.
                    </p>
                    <p style="color: #999; font-size: 12px; margin: 15px 0 10px 0;">
                        <a href="mailto:unsubscribe@fragrancecollect.com?subject=Unsubscribe" style="color: #999; text-decoration: underline;">Unsubscribe</a> |
                        <a href="https://fragrancecollect.com/privacy-policy" style="color: #999; text-decoration: underline;">Privacy Policy</a>
                    </p>
                    <p style="color: #bbb; font-size: 11px; margin: 0;">
                        Fragrance Collect<br>
                        Customer Service Department<br>
                        Email: support@fragrancecollect.com
                    </p>
                </div>
            </div>
        </body>
        </html>
    `;
}

// --- ACCOUNT FEATURE FUNCTIONS (Preferences & Favorites) ---

async function handleGetPreferences(request, env) {
    const { user, headers, errorResponse } = await getUserFromRequest(request, env);
    if (errorResponse) return errorResponse;

    try {
        const prefs = await env.DB.prepare(`SELECT * FROM user_preferences WHERE user_id = ?`).bind(user.id).first();
        if (!prefs) {
            return jsonResponse({ success: true, preferences: {} }, 200, headers);
        }

        // Parse JSON strings back to arrays
        const parsedPrefs = {
            ...prefs,
            scent_categories: prefs.scent_categories ? JSON.parse(prefs.scent_categories) : [],
            sensitivities: prefs.sensitivities ? JSON.parse(prefs.sensitivities) : []
        };

        return jsonResponse({ success: true, preferences: parsedPrefs }, 200, headers);
    } catch (error) {
        console.error('Error getting preferences:');
        return jsonResponse({ error: 'Failed to get preferences' }, 500, headers);
    }
}

async function handleUpdatePreferences(request, env) {
    const { user, headers, errorResponse } = await getUserFromRequest(request, env);
    if (errorResponse) return errorResponse;

    try {
        const prefs = await readJsonBody(request);
        const scentCategories = normalizeSelections(prefs.scent_categories, ['woody', 'floral', 'citrus', 'oriental', 'fresh']);
        let sensitivities = normalizeSelections(prefs.sensitivities, ['alcohol', 'synthetic', 'strong-scents', 'none']);
        if (sensitivities.includes('none') && sensitivities.length > 1) sensitivities = ['none'];
        const intensity = normalizeSelection(prefs.intensity, ['light', 'moderate', 'strong']);
        const season = normalizeSelection(prefs.season, ['spring', 'summer', 'fall', 'winter']);
        const occasion = normalizeSelection(prefs.occasion, ['daily', 'professional', 'evening', 'special']);
        const budgetRange = normalizeSelection(prefs.budget_range, ['under-50', '50-100', '100-200', 'over-200']);
        const scentCategoriesJson = JSON.stringify(scentCategories);
        const sensitivitiesJson = JSON.stringify(sensitivities);

        await env.DB.prepare(`
            INSERT INTO user_preferences (user_id, scent_categories, intensity, season, occasion, budget_range, sensitivities, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
                scent_categories = excluded.scent_categories,
                intensity = excluded.intensity,
                season = excluded.season,
                occasion = excluded.occasion,
                budget_range = excluded.budget_range,
                sensitivities = excluded.sensitivities,
                updated_at = CURRENT_TIMESTAMP
        `).bind(user.id, scentCategoriesJson, intensity, season, occasion, budgetRange, sensitivitiesJson).run();

        return jsonResponse({ success: true, message: 'Preferences updated' }, 200, headers);
    } catch (error) {
        const bodyResponse = bodyErrorResponse(error, headers);
        if (bodyResponse) return bodyResponse;
        console.error('Error updating preferences:');
        return jsonResponse({ error: 'Failed to update preferences' }, 500, headers);
    }
}

async function handleUpdateProfile(request, env) {
    const { user, headers, errorResponse } = await getUserFromRequest(request, env);
    if (errorResponse) return errorResponse;

    try {
        const profileData = await readJsonBody(request);
        const name = typeof profileData.name === 'string' ? profileData.name.trim() : '';
        const email = normalizeEmail(profileData.email);

        // Validate required fields
        if (!name || !email) {
            return jsonResponse({ error: 'Name and email are required' }, 400, headers);
        }

        if (name.length > 100) {
            return jsonResponse({ error: 'Name must be 100 characters or fewer' }, 400, headers);
        }

        if (!isValidEmail(email)) {
            return jsonResponse({ error: 'Invalid email format' }, 400, headers);
        }

        if (email !== user.email.toLowerCase()) {
            return jsonResponse({ error: 'Email changes require a separate verification flow' }, 400, headers);
        }

        // Update user profile in database
        await env.DB.prepare(`
            UPDATE users
            SET name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).bind(name, user.id).run();

        return jsonResponse({ success: true, message: 'Profile updated' }, 200, headers);
    } catch (error) {
        const bodyResponse = bodyErrorResponse(error, headers);
        if (bodyResponse) return bodyResponse;
        console.error('Error updating profile:');
        return jsonResponse({ error: 'Failed to update profile' }, 500, headers);
    }
}

async function handleChangePassword(request, env) {
    const { user, headers, errorResponse } = await getUserFromRequest(request, env);
    if (errorResponse) return errorResponse;

    if (await isAnyRateLimited(env, [
      { principal: ipPrincipal(request), endpoint: 'password-change-ip', limit: 8, windowMs: 60 * 60 * 1000 },
      { principal: accountPrincipal(user.id), endpoint: 'password-change-user', limit: 5, windowMs: 60 * 60 * 1000 }
    ])) {
      return jsonResponse({ error: 'Too many password changes. Please try again later.' }, 429, headers);
    }

    try {
        const passwordData = await readJsonBody(request);

        if (typeof passwordData.newPassword !== 'string' || !passwordData.newPassword) {
            return jsonResponse({ error: 'A new password is required.' }, 400, headers);
        }

        const passwordValidation = validatePasswordComplexity(passwordData.newPassword);
        if (!passwordValidation.isValid) {
            return jsonResponse({
                error: 'New password does not meet complexity requirements',
                details: passwordValidation.errors
            }, 400, headers);
        }

        const userRecord = await env.DB.prepare(`
          SELECT u.password_hash, u.email, u.email_verified_at,
                 (SELECT i.provider_subject FROM user_identities i
                  WHERE i.user_id = u.id AND i.provider = 'google'
                    AND i.email_verified_at IS NOT NULL AND i.email = u.email COLLATE NOCASE) AS google_subject
          FROM users u WHERE u.id = ?
        `).bind(user.id).first();

        if (!userRecord) {
            return jsonResponse({ error: 'User not found' }, 404, headers);
        }

        if (userRecord.password_hash) {
          const currentPassword = typeof passwordData.currentPassword === 'string' ? passwordData.currentPassword : '';
          if (!currentPassword) {
            return jsonResponse({ error: 'Current password is required.', code: 'password_reauthentication_required' }, 400, headers);
          }
          if (!(await verifyPasswordRecord(currentPassword, userRecord.password_hash)).valid) {
            return jsonResponse({ error: 'Reauthentication failed.', code: 'reauthentication_failed' }, 401, headers);
          }
        } else {
          const credential = typeof (passwordData.googleCredential || passwordData.credential) === 'string'
            ? (passwordData.googleCredential || passwordData.credential).trim()
            : '';
          if (!credential) {
            return jsonResponse({
              error: 'Reauthenticate with Google before adding a password.',
              code: 'google_reauthentication_required',
              provider: 'google'
            }, 400, headers);
          }
          const payload = await verifyGoogleToken(credential, env.GOOGLE_CLIENT_ID);
          if (!payload || !userRecord.google_subject || payload.sub !== userRecord.google_subject
            || (payload.email_verified !== true && payload.email_verified !== 'true')
            || normalizeEmail(payload.email) !== normalizeEmail(userRecord.email)) {
            return jsonResponse({ error: 'Reauthentication failed.', code: 'reauthentication_failed' }, 401, headers);
          }
        }

        const newPasswordHash = await hashPasswordPBKDF2(passwordData.newPassword);
        const verifiedAt = userRecord.email_verified_at || new Date().toISOString();
        const session = await buildSessionRecord(request, user.id);
        await env.DB.batch([
          env.DB.prepare(`
            UPDATE users SET password_hash = ?, email_verified_at = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(newPasswordHash, verifiedAt, user.id),
          env.DB.prepare(`
            INSERT INTO user_identities (
              id, user_id, provider, provider_subject, email, email_verified_at
            ) VALUES (?, ?, 'password', ?, ?, ?)
            ON CONFLICT(user_id, provider) DO UPDATE SET
              provider_subject = excluded.provider_subject,
              email = excluded.email,
              email_verified_at = excluded.email_verified_at,
              updated_at = CURRENT_TIMESTAMP
          `).bind(crypto.randomUUID(), user.id, normalizeEmail(userRecord.email), normalizeEmail(userRecord.email), verifiedAt),
          env.DB.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').bind(user.id),
          env.DB.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').bind(user.id),
          env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(user.id),
          prepareSessionInsert(env, session)
        ]);
        setSessionCookie(headers, request, env, session.token, SESSION_TTL_SECONDS);

        return jsonResponse({ success: true, message: 'Password changed successfully' }, 200, headers);
    } catch (error) {
        const bodyResponse = bodyErrorResponse(error, headers);
        if (bodyResponse) return bodyResponse;
        console.error('Error changing password:');
        return jsonResponse({ error: 'Failed to change password' }, 500, headers);
    }
}

async function handleGetFavorites(request, env) {
    const { user, headers, errorResponse } = await getUserFromRequest(request, env);
    if (errorResponse) return errorResponse;

    try {
        const { results } = await env.DB.prepare(`SELECT * FROM user_favorites WHERE user_id = ? ORDER BY added_at DESC`).bind(user.id).all();
        return jsonResponse({ success: true, favorites: results || [] }, 200, headers);
    } catch (error) {
        console.error('Error getting favorites:');
        return jsonResponse({ error: 'Failed to get favorites' }, 500, headers);
    }
}

async function handleAddFavorite(request, env) {
    const { user, headers, errorResponse } = await getUserFromRequest(request, env);
    if (errorResponse) return errorResponse;

    if (await isAnyRateLimited(env, [
      { principal: ipPrincipal(request), endpoint: 'favorite-write-ip', limit: 60, windowMs: 60 * 60 * 1000 },
      { principal: accountPrincipal(user.id), endpoint: 'favorite-write-user', limit: 60, windowMs: 60 * 60 * 1000 }
    ])) {
      return jsonResponse({ error: 'Too many favorite changes. Please try again later.' }, 429, headers);
    }

    try {
        const favorite = await readJsonBody(request);
        const fragranceId = normalizeText(favorite.fragrance_id, 200);
        const name = normalizeText(favorite.name, 200);
        const advertiserName = normalizeText(favorite.advertiserName, 200) || null;
        const description = normalizeText(favorite.description, 2000) || null;
        const imageUrl = normalizeHttpsUrl(favorite.imageUrl);
        const productUrl = normalizeHttpsUrl(favorite.productUrl);

        // Ensure the required fields are present
        if (!fragranceId || !name) {
            return jsonResponse({ error: 'fragrance_id and name are required' }, 400, headers);
        }

        const price = normalizeNonNegativeNumber(favorite.price);
        const shippingCost = normalizeNonNegativeNumber(favorite.shippingCost);
        const currency = /^[A-Z]{3}$/.test(favorite.currency || '') ? favorite.currency : null;
        const shippingAvailability = normalizeText(favorite.shipping_availability, 40) || null;

        // Keep the per-account storage bound as an atomic database invariant.
        // Existing favorites can still be refreshed when the collection is full.
        const result = await env.DB.prepare(`
            INSERT INTO user_favorites (id, user_id, fragrance_id, name, advertiserName, description, imageUrl, productUrl, price, currency, shippingCost, shipping_availability)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM user_favorites WHERE user_id = ? AND fragrance_id = ?
            ) OR (
              SELECT COUNT(*) FROM user_favorites WHERE user_id = ?
            ) < ?
            ON CONFLICT(user_id, fragrance_id) DO UPDATE SET
                name = excluded.name,
                advertiserName = excluded.advertiserName,
                description = excluded.description,
                imageUrl = excluded.imageUrl,
                productUrl = excluded.productUrl,
                price = excluded.price,
                currency = excluded.currency,
                shippingCost = excluded.shippingCost,
                shipping_availability = excluded.shipping_availability,
                added_at = CURRENT_TIMESTAMP
        `).bind(
            crypto.randomUUID(),
            user.id,
            fragranceId,
            name,
            advertiserName,
            description,
            imageUrl,
            productUrl,
            price,
            currency,
            shippingCost,
            shippingAvailability,
            user.id,
            fragranceId,
            user.id,
            MAX_FAVORITES
        ).run();

        if (Number(result.meta?.changes || 0) !== 1) {
            return jsonResponse({
              error: `You can save up to ${MAX_FAVORITES} favorites. Remove one before adding another.`
            }, 409, headers);
        }

        return jsonResponse({ success: true, message: 'Favorite added' }, 201, headers);
    } catch (error) {
        const bodyResponse = bodyErrorResponse(error, headers);
        if (bodyResponse) return bodyResponse;
        console.error('Error adding favorite:');
        return jsonResponse({ error: 'Failed to add favorite' }, 500, headers);
    }
}

async function handleDeleteFavorite(request, env) {
    const { user, headers, errorResponse } = await getUserFromRequest(request, env);
    if (errorResponse) return errorResponse;

    try {
        const url = new URL(request.url);
        const fragranceId = normalizeText(decodeURIComponent(url.pathname.split('/').pop() || ''), 200);

        if (!fragranceId) {
            return jsonResponse({ error: 'Fragrance ID is required' }, 400, headers);
        }

        const { success, meta } = await env.DB.prepare(`DELETE FROM user_favorites WHERE user_id = ? AND fragrance_id = ?`).bind(user.id, fragranceId).run();

        if (meta.changes === 0) {
            return jsonResponse({ error: 'Favorite not found or not owned by user' }, 404, headers);
        }

        return jsonResponse({ success: true, message: 'Favorite removed' }, 200, headers);
    } catch (error) {
        console.error('Error deleting favorite:');
        return jsonResponse({ error: 'Failed to delete favorite' }, 500, headers);
    }
}

async function getUserFromRequest(request, env) {
    const origin = request.headers.get('Origin');
    const headers = privateSecurityHeaders(origin, env);

    if (!['GET', 'HEAD'].includes(request.method) && !validateSiteOrigin(request, env)) {
        return { errorResponse: jsonResponse({ error: 'Unauthorized origin' }, 403, headers) };
    }

    const token = getTokenFromRequest(request);

    if (!token) {
        return { errorResponse: jsonResponse({ error: 'Not authenticated' }, 401, headers) };
    }

    const session = await getValidSession(env, token);
    if (!session) {
        setSessionCookie(headers, request, env, '', -1);
        return { errorResponse: jsonResponse({ error: 'Invalid or expired session' }, 401, headers) };
    }

    // Quick validation before proceeding
    if (!await validateSessionSecurity(session, request)) {
       await deleteSession(env, token);
       setSessionCookie(headers, request, env, '', -1);
       return { errorResponse: jsonResponse({ error: 'Session security validation failed' }, 401, headers) };
    }

    // A mailbox-verified legacy row that predates provider identities receives
    // only enough authority to attach its signed Google subject. This avoids
    // silently treating possession of an old email address as a full identity.
    if (!session.has_verified_identity
      && new URL(request.url).pathname !== '/api/user/identities/google') {
      return {
        errorResponse: jsonResponse({
          error: 'Link your verified sign-in provider to finish recovering this legacy account.',
          code: 'identity_link_required',
          provider: 'google'
        }, 403, headers)
      };
    }

    await touchSession(env, token);
    return {
      user: {
        id: session.user_id,
        email: session.email,
        name: session.name,
        emailVerified: Boolean(session.email_verified_at),
        hasVerifiedIdentity: Boolean(session.has_verified_identity),
        hasVerifiedGoogleIdentity: Boolean(session.has_verified_google_identity),
        hasPassword: Boolean(session.password_hash)
      },
      headers
    };
}

async function handleExportUserData(request, env) {
    const { user, headers, errorResponse } = await getUserFromRequest(request, env);
    if (errorResponse) return errorResponse;

    try {
        const [profile, preferences, favorites, alerts, outboundVisits, identities] = await Promise.all([
            env.DB.prepare(`SELECT id, email, name, picture, email_verified_at, created_at, updated_at FROM users WHERE id = ?`).bind(user.id).first(),
            env.DB.prepare(`SELECT scent_categories, intensity, season, occasion, budget_range, sensitivities, created_at, updated_at FROM user_preferences WHERE user_id = ?`).bind(user.id).first(),
            env.DB.prepare(`SELECT fragrance_id, name, advertiserName, description, imageUrl, productUrl, price, currency, shippingCost, shipping_availability, user_notes, added_at FROM user_favorites WHERE user_id = ? ORDER BY added_at DESC`).bind(user.id).all(),
            env.DB.prepare(`SELECT product_key, product_name, alert_type, target_price, currency, country, is_active, last_triggered_at, last_checked_at, created_at, updated_at FROM user_deal_alerts WHERE user_id = ? ORDER BY created_at DESC`).bind(user.id).all(),
            env.DB.prepare(`SELECT product_id, advertiser_id, source, country, created_at FROM outbound_clicks WHERE user_id = ? ORDER BY created_at DESC`).bind(user.id).all(),
            env.DB.prepare(`SELECT provider, provider_subject, email, email_verified_at, created_at, updated_at FROM user_identities WHERE user_id = ? ORDER BY created_at`).bind(user.id).all()
        ]);

        return jsonResponse({
            generatedAt: new Date().toISOString(),
            profile,
            preferences: preferences || null,
            favorites: favorites.results || [],
            identities: identities.results || [],
            dealWatches: alerts.results || [],
            attributedRetailerVisits: outboundVisits.results || []
        }, 200, { ...headers, 'Cache-Control': 'no-store' });
    } catch {
        console.error('User data export failed:');
        return jsonResponse({ error: 'Unable to prepare your data export.' }, 500, headers);
    }
}

function normalizeText(value, maxLength) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
}

function normalizeHttpsUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 2048
          ? url.href
          : null;
    } catch {
        return null;
    }
}

function normalizeCurrency(value) {
    const currency = normalizeText(value, 3).toUpperCase();
    return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function normalizeCatalogPriceAmount(value) {
    const amount = normalizeNonNegativeNumber(value);
    return amount !== null && amount <= 50_000 ? amount : null;
}

function normalizeProductPricing(price, salePrice) {
    const regularAmount = normalizeCatalogPriceAmount(price?.amount);
    const regularCurrency = normalizeCurrency(price?.currency);
    const saleAmount = normalizeCatalogPriceAmount(salePrice?.amount);
    const saleCurrency = normalizeCurrency(salePrice?.currency);

    // A monetary amount without a currency cannot be displayed or compared
    // safely. Likewise, never call a number a discount by comparing unlike
    // currencies from a malformed retailer feed.
    const validRegular = regularAmount !== null && regularCurrency;
    const validSaleOnly = !validRegular && saleAmount !== null && saleCurrency;
    const validDiscount = validRegular && saleAmount !== null && saleCurrency === regularCurrency
        && saleAmount < regularAmount;

    if (validDiscount) {
        return {
            price: saleAmount,
            regularPrice: regularAmount,
            salePrice: saleAmount,
            currency: regularCurrency,
            saleCurrency
        };
    }
    if (validRegular) {
        return {
            price: regularAmount,
            regularPrice: regularAmount,
            salePrice: null,
            currency: regularCurrency,
            saleCurrency: null
        };
    }
    if (validSaleOnly) {
        return {
            price: saleAmount,
            regularPrice: saleAmount,
            salePrice: null,
            currency: saleCurrency,
            saleCurrency: null
        };
    }
    return null;
}

function normalizeProductShipping(shippingPrice) {
    const amount = normalizeNonNegativeNumber(shippingPrice?.amount);
    const currency = normalizeCurrency(shippingPrice?.currency);
    if (amount === 0) return { cost: 0, currency };
    if (amount !== null && amount <= 10_000 && currency) return { cost: amount, currency };
    return { cost: null, currency: null };
}

function normalizeNonNegativeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeSelection(value, allowedValues) {
    return typeof value === 'string' && allowedValues.includes(value) ? value : null;
}

function normalizeSelections(values, allowedValues) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values.filter(value => typeof value === 'string' && allowedValues.includes(value)))];
}

// Pure catalog helpers are exported for deterministic regression tests. They
// are not routed or exposed as Worker API endpoints.
export const __catalogInternals = Object.freeze({
  areFragranceVariantsCompatible,
  attachOfferComparisons,
  buildCJAdvertiserScopes,
  buildCJDiscoveryQueries,
  buildCJProductKeywords,
  calculateFeaturedScore,
  calculateRelevance,
  createCJDiscoveryDeadline,
  createProductIdentity,
  deduplicateProducts,
  executeCJDiscoveryPlan,
  extractFragranceAttributes,
  extractFragranceSize,
  formatProduct,
  isActiveJoinedCJAdvertiser,
  isFragranceProduct,
  isNewRetailProduct,
  matchesCatalogSearchIntent,
  matchesExactCatalogText,
  matchesBrandFilter,
  matchesRawProductBrand,
  normalizeBrandKey,
  normalizeGtins,
  normalizeProductPricing,
  normalizeProductShipping,
  parseCatalogSearchIntent,
  parseFragranceVolume,
  publicCatalogSearchIntent,
  rankProducts,
  resolveRequestedCJPartnerId,
  sanitizePublicCatalogPayload,
  selectAlertProduct,
  summarizeNonPartnerOpportunity
});

/**
 * Decodes a Base64URL encoded string.
 * @param {string} str
 * @returns {string}
 */
function b64UrlDecode(str) {
    if (typeof str !== 'string' || !/^[A-Za-z0-9_-]+$/.test(str) || str.length % 4 === 1) {
      throw new Error('Invalid Base64URL value');
    }
    // Convert Base64URL to Base64 by replacing '-' with '+' and '_' with '/'
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    // Pad with '=' characters if necessary
    const pad = base64.length % 4;
    if (pad) {
        if (pad === 2) base64 += '==';
        else if (pad === 3) base64 += '=';
    }
    return atob(base64);
}

/**
 * Verifies a Google ID token.
 * @param {string} token - The Google ID token.
 * @param {string} clientId - Your Google Client ID.
 * @returns {Promise<object|null>} The token payload if valid, otherwise null.
 */
async function verifyGoogleToken(token, clientId) {
    try {
        if (typeof token !== 'string' || token.length > 8192 || typeof clientId !== 'string' || !clientId) return null;
        // 1. Decode token parts
        const segments = token.split('.');
        if (segments.length !== 3) {
            console.error('Invalid JWT structure');
            return null;
        }
        const [headerB64, payloadB64, signatureB64] = segments;

        const header = JSON.parse(b64UrlDecode(headerB64));
        const payload = JSON.parse(b64UrlDecode(payloadB64));

        // 2. Check basic claims
        if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(header.kid)) {
            console.error('Invalid Google token header.');
            return null;
        }
        if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
            console.error('Invalid Google token issuer.');
            return null;
        }
        if (payload.aud !== clientId) {
            console.error('Invalid Google token audience.');
            return null;
        }
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds
          || !Number.isFinite(payload.iat) || payload.iat > nowSeconds + 300
          || payload.exp - payload.iat > 2 * 60 * 60
          || (Number.isFinite(payload.nbf) && payload.nbf > nowSeconds + 300)
          || typeof payload.sub !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(payload.sub)) {
            console.error('Token expired');
            return null;
        }

        // 3. Verify signature
        const publicKey = await getGooglePublicKey(header.kid);
        if (!publicKey) {
            console.error('Could not fetch the requested Google public key.');
            return null;
        }

        const encoder = new TextEncoder();
        const data = encoder.encode(`${headerB64}.${payloadB64}`);
        const signatureDecoded = b64UrlDecode(signatureB64);
        const signature = new Uint8Array(signatureDecoded.split('').map(c => c.charCodeAt(0)));

        const isValid = await crypto.subtle.verify(
            'RSASSA-PKCS1-v1_5',
            publicKey,
            signature,
            data
        );

        if (!isValid) {
            console.error('Invalid signature');
            return null;
        }

        return payload;
    } catch (error) {
        console.error('Error verifying Google token:');
        return null;
    }
}

/**
 * Fetches and caches Google's public keys for JWT verification.
 * @param {string} kid - The Key ID from the JWT header.
 * @returns {Promise<CryptoKey|null>}
 */
async function getGooglePublicKey(kid) {
    const now = Date.now();
    if (lastKeyFetchTime > 0 && now - lastKeyFetchTime < KEY_CACHE_TTL) {
        // A fresh JWKS set is authoritative for its lifetime. Unknown key IDs
        // are rejected without allowing arbitrary tokens to force a refetch.
        return keyCache.get(kid) || null;
    }

    // Coalesce concurrent cold-start logins into one bounded JWKS fetch.
    if (!keyFetchPromise) {
      keyFetchPromise = refreshGooglePublicKeys().finally(() => {
        keyFetchPromise = null;
      });
    }
    const refreshed = await keyFetchPromise;
    return refreshed ? keyCache.get(kid) || null : null;
}

async function refreshGooglePublicKeys() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GOOGLE_JWKS_TIMEOUT_MS);
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
        signal: controller.signal
      });
      if (!response.ok) throw new Error('Failed to fetch Google certs');

      const { keys } = await response.json();
      if (!Array.isArray(keys) || !keys.length || keys.length > 20) {
        throw new Error('Invalid Google JWKS response');
      }

      const importedKeys = new Map();
      for (const key of keys.filter((entry) => entry.alg === 'RS256' && entry.use === 'sig')) {
        if (key.kty !== 'RSA' || typeof key.kid !== 'string'
          || !/^[A-Za-z0-9_-]{1,200}$/.test(key.kid)
          || typeof key.n !== 'string' || typeof key.e !== 'string') continue;
        const importedKey = await crypto.subtle.importKey(
          'jwk',
          { kty: key.kty, n: key.n, e: key.e, alg: key.alg, kid: key.kid, use: key.use },
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify']
        );
        importedKeys.set(key.kid, importedKey);
      }
      if (!importedKeys.size) throw new Error('Google JWKS contained no usable signing keys');

      keyCache.clear();
      for (const [keyId, key] of importedKeys) keyCache.set(keyId, key);
      lastKeyFetchTime = Date.now();
      return true;
    } catch {
      console.error('Error fetching/caching Google public keys:');
      return false;
    } finally {
      clearTimeout(timeout);
    }
}
