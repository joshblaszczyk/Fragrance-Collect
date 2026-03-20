// Import Resend for email functionality
import { Resend } from 'resend';

// A map to cache Google's public keys.
// Keys are key IDs, values are the imported CryptoKey objects.
const keyCache = new Map();
let lastKeyFetchTime = 0;
const KEY_CACHE_TTL = 3600 * 1000; // 1 hour in milliseconds

// Helper function to resolve CJ links to get actual destination URLs using multiple methods
async function resolveCJLink(cjLink, env, depth = 0) {
  // Prevent infinite recursion
  if (depth > 1) {
    console.log('Max recursion depth reached, returning original link');
    return cjLink;
  }

  try {
    console.log('🔍 Resolving CJ link:', cjLink, `(depth: ${depth})`);

    // Method 1: Try to extract URL from query parameters if present
    try {
      const url = new URL(cjLink);
      if (url.searchParams.has('url')) {
        const extractedUrl = decodeURIComponent(url.searchParams.get('url'));
        console.log('✅ Extracted URL from params:', extractedUrl);
        return extractedUrl;
      }
    } catch (urlError) {
      console.log('Could not parse as URL, trying other methods...');
    }

    // Method 2: Try HEAD request first (faster)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    try {
      console.log('🌐 Making HEAD request to CJ link...');
      const headResponse = await fetch(cjLink, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        }
      });

      clearTimeout(timeoutId);
      const finalUrl = headResponse.url;
      console.log('📍 HEAD request resolved to:', finalUrl);

      // Check if we've reached a non-CJ domain (actual merchant website)
      const cjDomains = ['cj.com', 'anrdoezrs.net', 'tkqlhce.com', 'kqzyfj.com', 'qksrv.net', 'jdoqocy.com', 'dpbolvw.net'];
      const isCjDomain = cjDomains.some(domain => finalUrl.includes(domain));
      
      if (!isCjDomain) {
        console.log('✅ Successfully resolved to merchant website:', finalUrl);
        return finalUrl;
      }

      // If still a CJ domain, try GET request to get the response body
      console.log('🔄 Still CJ domain, trying GET request...');
      const getController = new AbortController();
      const getTimeoutId = setTimeout(() => getController.abort(), 5000);
      
      try {
        const getResponse = await fetch(cjLink, {
          method: 'GET',
          redirect: 'follow',
          signal: getController.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
          }
        });

        clearTimeout(getTimeoutId);
        const getFinalUrl = getResponse.url;
        console.log('📍 GET request resolved to:', getFinalUrl);

        // Check if GET request got us to a merchant site
        const isGetCjDomain = cjDomains.some(domain => getFinalUrl.includes(domain));
        if (!isGetCjDomain) {
          console.log('✅ GET request resolved to merchant website:', getFinalUrl);
          return getFinalUrl;
        }

        // Try to extract the destination from response body
        try {
          const responseText = await getResponse.text();
          console.log('📄 Response body length:', responseText.length);
          
          // Look for common patterns that might contain the destination URL
          const urlPatterns = [
            /window\.location\.href\s*=\s*['"]([^'"]+)['"]/gi,
            /location\.href\s*=\s*['"]([^'"]+)['"]/gi,
            /window\.location\s*=\s*['"]([^'"]+)['"]/gi,
            /location\s*=\s*['"]([^'"]+)['"]/gi,
            /href\s*=\s*['"]([^'"]+)['"]/gi,
            /url\s*=\s*['"]([^'"]+)['"]/gi,
            /redirect\s*=\s*['"]([^'"]+)['"]/gi,
            /destination\s*=\s*['"]([^'"]+)['"]/gi
          ];
          
          for (const pattern of urlPatterns) {
            const matches = responseText.match(pattern);
            if (matches) {
              for (const match of matches) {
                const urlMatch = match.match(/['"]([^'"]+)['"]/);
                if (urlMatch && urlMatch[1]) {
                  const foundUrl = urlMatch[1];
                  console.log('🔍 Found potential URL in response:', foundUrl);
                  
                  // Check if it's not a CJ domain
                  if (!cjDomains.some(domain => foundUrl.includes(domain))) {
                    console.log('✅ Found merchant URL in response body:', foundUrl);
                    return foundUrl;
                  }
                }
              }
            }
          }
        } catch (bodyError) {
          console.log('❌ Could not read response body:', bodyError.message);
        }

      } catch (getError) {
        clearTimeout(getTimeoutId);
        console.log('❌ GET request failed:', getError.message);
      }

    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.log('❌ HEAD request failed:', fetchError.message);
    }

    // If we still can't resolve, return the original link
    console.log('❌ Could not resolve CJ link to merchant website, returning original');
    return cjLink;
  } catch (error) {
    console.error('❌ Error in resolveCJLink:', error);
    return cjLink;
  }
}

// Revenue optimization constants
const REVENUE_CONFIG = {
  TIKTOK_PARTNER_ID: '7563286',
  CJ_WEIGHT: 0.7, // CJ products get 70% weight
  TIKTOK_WEIGHT: 0.3, // TikTok products get 30% weight
  MIN_COMMISSION_RATE: 0.05, // 5% minimum commission
  OPTIMAL_PRICE_RANGE: { min: 50, max: 300 },
  TRENDING_CACHE_DURATION: 300, // 5 minutes for trending
  HOT_SEARCH_CACHE_DURATION: 600, // 10 minutes for hot searches
  BRAND_CACHE_DURATION: 7200, // 2 hours for brand searches
  GENERIC_CACHE_DURATION: 1800, // 30 minutes for generic terms
  SEASONAL_CACHE_DURATION: 3600 // 1 hour for seasonal searches
};

// Commission rates by brand category (example - adjust based on your CJ data)
const COMMISSION_RATES = {
  'luxury': { rate: 0.12, weight: 1.0 },
  'designer': { rate: 0.10, weight: 0.9 },
  'niche': { rate: 0.08, weight: 0.8 },
  'celebrity': { rate: 0.09, weight: 0.85 },
  'seasonal': { rate: 0.07, weight: 0.75 },
  'default': { rate: 0.06, weight: 0.7 }
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    console.log(`[Request] Method: ${request.method}, Path: ${path}`);

    // --- AUTHENTICATION ENDPOINTS ---
    if (path === '/api/signup/email' && request.method === 'POST') {
      return handleEmailSignup(request, env);
    }
    if (path === '/api/login/email' && request.method === 'POST') {
      return handleEmailLogin(request, env);
    }
    if (path === '/api/login/google' && request.method === 'POST') {
        return handleGoogleLogin(request, env);
    }
    if (path === '/api/status' && request.method === 'GET') {
      return handleGetStatus(request, env);
    }
    if (path === '/api/token' && request.method === 'GET') {
        return handleGetToken(request, env);
    }
    if (path === '/api/logout' && request.method === 'POST') {
        return handleLogout(request, env);
    }
    
    // --- API ENDPOINTS ---
    if (path === '/api/products') {
        return handleProductsRequest(request, url, env);
    }
    if (path === '/api/feeds') {
        return handleFeedsRequest(env);
    }
    if (path === '/api/trending') {
        return handleTrendingRequest(env);
    }
    if (path === '/api/analytics') {
        return handleAnalyticsRequest(request, env);
    }
    if (path === '/api/health') {
          return handleHealthRequest(env);
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
        if (path === '/api/user/password' && request.method === 'POST') {
            return handleChangePassword(request, env);
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
    }

    const headers = getSecurityHeaders(request.headers.get('Origin'));
    return new Response('Not Found', { status: 404, headers });
  },
};


// --- SECURITY & UTILITY FUNCTIONS ---

// In-memory request tracker for rate limiting.
const requestTracker = new Map();

/**
 * Checks if an IP address has exceeded the rate limit for a specific endpoint.
 * @param {string} ip - The client IP address.
 * @param {string} endpoint - The endpoint name (e.g., 'login').
 * @param {number} limit - The max number of requests allowed.
 * @param {number} windowMs - The time window in milliseconds.
 * @returns {boolean} - True if the request is rate-limited, false otherwise.
 */
function isRateLimited(ip, endpoint, limit, windowMs) {
    const key = `${ip}:${endpoint}`;
    const now = Date.now();
    
    // Clean up old records and get recent ones
    const records = (requestTracker.get(key) || []).filter(timestamp => (now - timestamp) < windowMs);

    if (records.length >= limit) {
        return true; // Rate limit exceeded
    }

    records.push(now);
    requestTracker.set(key, records);
    return false;
}

/**
 * Validates the format of an email address.
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
    if (!email) return false;
    // A more robust regex for email validation
    return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
}

/**
 * Validates password complexity requirements.
 * @param {string} password
 * @returns {{isValid: boolean, errors: string[]}}
 */
function validatePasswordComplexity(password) {
    const errors = [];
    const minLength = 8;
    
    if (!password || password.length < minLength) {
        errors.push(`Password must be at least ${minLength} characters long.`);
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter.');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter.');
    }
    if (!/\d/.test(password)) {
        errors.push('Password must contain at least one number.');
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
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
 * @returns {Promise<string>} The salt and hash, separated by a colon.
 */
async function hashPasswordPBKDF2(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
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
            iterations: 100000,
            hash: 'SHA-512',
        },
        keyMaterial,
        512
    );
    const hashArray = Array.from(new Uint8Array(derivedBits));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${saltHex}:${hashHex}`;
}

/**
 * Verifies a password against a stored PBKDF2 hash.
 * @param {string} password - The plaintext password to verify.
 * @param {string} storedHash - The stored hash, including the salt.
 * @returns {Promise<boolean>} True if the password is correct.
 */
async function verifyPasswordPBKDF2(password, storedHash) {
    const [saltHex, originalHashHex] = storedHash.split(':');
    if (!saltHex || !originalHashHex) return false;

    const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
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
            iterations: 100000,
            hash: 'SHA-512',
        },
        keyMaterial,
        512
    );
    const hashArray = Array.from(new Uint8Array(derivedBits));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return compareHashes(hashHex, originalHashHex);
}

function compareHashes(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

const ALLOWED_ORIGINS = [ 'https://fragrancecollect.com', 'https://www.fragrancecollect.com', 'https://fragrance-collect.pages.dev', 'https://heart.github.io', 'http://localhost:', 'http://127.0.0.1:', 'file://' ];
function isOriginAllowed(origin) {
    if (!origin || origin === 'null') return true;
    return ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed));
}
function validateSiteOrigin(request) {
    return isOriginAllowed(request.headers.get('Origin'));
}
function getSecurityHeaders(origin) {
    const headers = {
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
    };
    if (isOriginAllowed(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }
    return headers;
}

function handleOptions(request) {
  const origin = request.headers.get('Origin');
  return new Response(null, { headers: getSecurityHeaders(origin) });
}

async function createSession(request, env, userId) {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || 'unknown';
    const sessionFingerprint = await sha512(`${clientIP}:${userAgent}`);
    await cleanupUserSessions(env, userId);
    await env.DB.prepare(`INSERT INTO user_sessions (id, user_id, token, expires_at, client_ip, user_agent, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), userId, token, expiresAt.toISOString(), clientIP, userAgent, sessionFingerprint).run();
    return token;
}

function createCookie(token, maxAge, origin) {
    let cookieString = `session_token=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=None; Secure`;
    return cookieString;
}

function getTokenFromRequest(request) {
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.substring(7);
    const cookieHeader = request.headers.get('Cookie') || '';
    return cookieHeader.match(/session_token=([^;]+)/)?.[1] || null;
}

async function getValidSession(env, token) {
    const session = await env.DB.prepare(`SELECT s.*, u.email, u.name, u.picture FROM user_sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?`).bind(token).first();
    if (!session || new Date(session.expires_at) < new Date()) return null;
    return session;
}

async function validateSessionSecurity(session, request) {
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || 'unknown';
    const currentFingerprint = await sha512(`${clientIP}:${userAgent}`);
    return session.fingerprint === currentFingerprint;
}

async function cleanupUserSessions(env, userId) {
    await env.DB.prepare(`DELETE FROM user_sessions WHERE user_id = ? AND expires_at < CURRENT_TIMESTAMP`).bind(userId).run();
}

async function sha512(str) {
  const buffer = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(str));
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(data, status = 200, headers = {}) {
  const finalHeaders = { ...headers, 'Content-Type': 'application/json' };
  return new Response(JSON.stringify(data), { status, headers: finalHeaders });
}

// --- AUTHENTICATION FUNCTIONS ---

async function handleEmailSignup(request, env) {
    const origin = request.headers.get('Origin');
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown-ip';

    if (isRateLimited(clientIP, 'signup', 10, 60 * 60 * 1000)) { // 10 signups per hour
        return jsonResponse({ error: 'Too many signup attempts. Please try again later.' }, 429, getSecurityHeaders(origin));
    }
    
    if (!validateSiteOrigin(request)) {
        return jsonResponse({ error: 'Unauthorized origin' }, 403, getSecurityHeaders(origin));
    }

    const headers = getSecurityHeaders(origin);
    try {
        const { name, email, password } = await request.json();
        if (!name || !email || !password) return jsonResponse({ error: 'Name, email, and password are required.' }, 400, headers);

        if (!isValidEmail(email)) {
            return jsonResponse({ error: 'Invalid email format.' }, 400, headers);
        }

        const passwordValidation = validatePasswordComplexity(password);
        if (!passwordValidation.isValid) {
            return jsonResponse({ error: 'Password does not meet complexity requirements.', details: passwordValidation.errors }, 400, headers);
        }

        const existingUser = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
        if (existingUser) return jsonResponse({ error: 'A user with this email already exists.' }, 409, headers);
        
        const passwordHash = await hashPasswordPBKDF2(password);
        // 4. Create user in the database
        const userId = crypto.randomUUID();
        await env.DB.prepare(`INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`).bind(userId, name, email, passwordHash).run();

        // 5. Create a session for the new user
        const token = await createSession(request, env, userId);
        headers['Set-Cookie'] = createCookie(token, 24 * 60 * 60 * 1000, request.headers.get('Origin'));

        return jsonResponse({ success: true, user: { id: userId, name, email }, token }, 201, headers);
    } catch (error) {
        console.error('Error during email signup:', error);
        return jsonResponse({ error: 'Signup failed.', details: error.message }, 500, headers);
    }
}

async function handleEmailLogin(request, env) {
    const origin = request.headers.get('Origin');
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown-ip';

    if (isRateLimited(clientIP, 'login', 10, 15 * 60 * 1000)) { // 10 login attempts per 15 mins
        return jsonResponse({ error: 'Too many login attempts. Please try again later.' }, 429, getSecurityHeaders(origin));
    }
    
    if (!validateSiteOrigin(request)) {
        return jsonResponse({ error: 'Unauthorized origin' }, 403, getSecurityHeaders(origin));
    }
    const headers = getSecurityHeaders(origin);
    try {
        const { email, password } = await request.json();
        if (!email || !password) return jsonResponse({ error: 'Email and password are required.' }, 400, headers);

        const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
        if (!user || !user.password_hash) return jsonResponse({ error: 'Invalid email or password.' }, 401, headers);
        
        let isValidPassword = false;
        // Check if the hash is in the new PBKDF2 format
        if (user.password_hash.includes(':')) {
            isValidPassword = await verifyPasswordPBKDF2(password, user.password_hash);
        } else {
            // Fallback for old SHA-512 hashes
            const passwordHash = await sha512(password);
            isValidPassword = compareHashes(passwordHash, user.password_hash);

            // If valid, migrate the hash to the new format
            if (isValidPassword) {
                const newHash = await hashPasswordPBKDF2(password);
                await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, user.id).run();
            }
        }

        if (!isValidPassword) {
            return jsonResponse({ error: 'Invalid email or password.' }, 401, headers);
        }

        const token = await createSession(request, env, user.id);
        headers['Set-Cookie'] = createCookie(token, 24 * 60 * 60 * 1000, request.headers.get('Origin'));

        return jsonResponse({ success: true, user: { id: user.id, name: user.name, email: user.email, picture: user.picture }, token }, 200, headers);
    } catch (error) {
        console.error('Error during email login:', error.message);
        return jsonResponse({ error: 'Login failed.', details: error.message }, 500, headers);
    }
}

async function handleGetStatus(request, env) {
    const headers = getSecurityHeaders(request.headers.get('Origin'));
    try {
        const token = getTokenFromRequest(request);
        if (!token) return jsonResponse({ error: 'Not authenticated' }, 401, headers);

        const session = await getValidSession(env, token);
        if (!session) {
            headers['Set-Cookie'] = createCookie('', -1); // Expire cookie
            return jsonResponse({ error: 'Invalid or expired session' }, 401, headers);
        }

        if (!validateSessionSecurity(session, request)) {
            await env.DB.prepare(`DELETE FROM user_sessions WHERE token = ?`).bind(token).run();
            headers['Set-Cookie'] = createCookie('', -1);
            return jsonResponse({ error: 'Session security validation failed' }, 401, headers);
        }

        await env.DB.prepare(`UPDATE user_sessions SET last_activity = CURRENT_TIMESTAMP WHERE token = ?`).bind(token).run();

        return jsonResponse({ success: true, user: { id: session.user_id, email: session.email, name: session.name, picture: session.picture } }, 200, headers);
    } catch (error) {
        console.error('Error getting status:', error);
        return jsonResponse({ error: 'Failed to get user status' }, 500, headers);
    }
}

async function handleGetToken(request, env) {
    const headers = getSecurityHeaders(request.headers.get('Origin'));
    try {
        const token = getTokenFromRequest(request);
        if (!token) return jsonResponse({ error: 'Not authenticated' }, 401, headers);
        const session = await getValidSession(env, token);
        if (!session) return jsonResponse({ error: 'Invalid or expired session' }, 401, headers);
        return jsonResponse({ success: true, token }, 200, headers);
    } catch (error) {
        console.error('Error getting token:', error);
        return jsonResponse({ error: 'Failed to get token' }, 500, headers);
    }
}

async function handleLogout(request, env) {
    const headers = getSecurityHeaders(request.headers.get('Origin'));
    try {
        const token = getTokenFromRequest(request);
        if (token) {
            await env.DB.prepare(`DELETE FROM user_sessions WHERE token = ?`).bind(token).run();
        }
        headers['Set-Cookie'] = createCookie('', -1); // Expire cookie
        return jsonResponse({ success: true, message: 'Logged out' }, 200, headers);
    } catch (error) {
        console.error('Error during logout:', error);
        return jsonResponse({ error: 'Logout failed' }, 500, headers);
    }
}

async function handleGoogleLogin(request, env) {
    const origin = request.headers.get('Origin');
    const headers = getSecurityHeaders(origin);

    try {
        const { token } = await request.json();
        if (!token) {
            return jsonResponse({ error: 'Google token is required.' }, 400, headers);
        }

        // 1. Verify the token
        const payload = await verifyGoogleToken(token, env.GOOGLE_CLIENT_ID);
        if (!payload) {
            return jsonResponse({ error: 'Invalid Google token.' }, 401, headers);
        }

        // 2. Check if user exists, or create a new one
        const { email, name, picture } = payload;
        let user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();

        let userId;
        if (user) {
            userId = user.id;
            // Optionally, update user's name and picture from Google profile
            if (user.name !== name || user.picture !== picture) {
                await env.DB.prepare('UPDATE users SET name = ?, picture = ? WHERE id = ?')
                            .bind(name, picture, userId)
                            .run();
            }
        } else {
            // Create new user
            userId = crypto.randomUUID();
            await env.DB.prepare('INSERT INTO users (id, email, name, picture, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
                        .bind(userId, email, name, picture)
                        .run();
            user = { id: userId, email, name, picture };
        }
        
        // 3. Create a session
        const sessionToken = await createSession(request, env, userId);
        headers['Set-Cookie'] = createCookie(sessionToken, 24 * 60 * 60 * 1000, origin);

        return jsonResponse({
            success: true,
            user: { id: userId, name, email, picture },
            token: sessionToken
        }, 200, headers);

    } catch (error) {
        console.error('Error during Google login:', error);
        return jsonResponse({ error: 'Google login failed.', details: error.message }, 500, headers);
    }
}


// --- API FUNCTIONS ---

async function handleProductsRequest(request, url, env) {
  const { searchParams } = new URL(url);
  const query = searchParams.get('q') || '';
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const offset = (page - 1) * limit;
  const lowPrice = parseFloat(searchParams.get('lowPrice')) || null;
  const highPrice = parseFloat(searchParams.get('highPrice')) || null;
  const partnerId = searchParams.get('partnerId') || null;
  const includeTikTok = searchParams.get('includeTikTok') !== 'false';
  const sortBy = searchParams.get('sortBy') || 'revenue';
  const brandFilter = searchParams.get('brand') || null;
  const exactMatch = searchParams.get('exactMatch') === 'true';

  console.log('💸 Revenue-optimized search initiated:', { query, limit, page, sortBy, exactMatch });
  console.log('🔍 Exact match mode:', exactMatch ? 'ENABLED' : 'DISABLED');

  try {
    const cjProducts = await searchCJStore(query, 250, 0, lowPrice, highPrice, partnerId, env, exactMatch);
    console.log(`✅ CJ Store: Found ${cjProducts.length} products`);
    
    let tiktokProducts = [];
    if (includeTikTok && !partnerId) {
      tiktokProducts = await searchTikTokStore(query, 100, 0, lowPrice, highPrice, env, exactMatch);
      console.log(`🎵 TikTok Shop: Found ${tiktokProducts.length} products`);
    }

    if (cjProducts.length === 0 && tiktokProducts.length > 0) {
      console.log('🔄 Smart fallback: Using TikTok results as primary');
      tiktokProducts = await searchTikTokStore(query, 200, 0, lowPrice, highPrice, env);
    }

    const allProducts = [...cjProducts, ...tiktokProducts];
    const deduplicatedProducts = deduplicateProducts(allProducts);
    
    let filteredProducts = deduplicatedProducts;
    if (exactMatch && query) {
        console.log('🔍 Applying STRICT exact match filtering for query:', query);
        const queryLower = query.toLowerCase().trim();
        const queryWords = queryLower.split(/\s+/).filter(word => word.length > 0);
        
        filteredProducts = deduplicatedProducts.filter(product => {
            const title = (product.title || product.name || '').toLowerCase();
            const brand = (product.brand || '').toLowerCase();
            const description = (product.description || '').toLowerCase();
            
            const allText = `${title} ${brand} ${description}`;
            
            return queryWords.every(queryWord => allText.includes(queryWord));
        });
        console.log(`🔍 STRICT exact match filtering: ${deduplicatedProducts.length} -> ${filteredProducts.length} products`);
    }
    
    const optimizedProducts = optimizeForRevenue(filteredProducts, query, sortBy, brandFilter, REVENUE_CONFIG, COMMISSION_RATES);
    console.log('🔥 About to call formatProductForRevenue for', optimizedProducts.length, 'products');
    const products = (await Promise.all(optimizedProducts.map(p => formatProductForRevenue(p, query, REVENUE_CONFIG, COMMISSION_RATES, env)))).filter(Boolean);
    console.log('🔥 After formatProductForRevenue, got', products.length, 'products');

    const total = products.length;
    const paginatedProducts = products.slice(offset, offset + limit);
    const revenueMetrics = calculateRevenueMetrics(paginatedProducts, cjProducts.length, tiktokProducts.length);

    const responseData = {
      products: paginatedProducts,
      total,
      page,
      limit,
      hasMore: total > (offset + limit),
      searchQuery: query,
      filters: { lowPrice, highPrice, partnerId, includeTikTok, sortBy, brandFilter, exactMatch },
      revenue: revenueMetrics,
      sources: {
        cj: cjProducts.length,
        tiktok: tiktokProducts.length,
        total: filteredProducts.length
      },
      optimization: {
        strategy: 'revenue-maximization',
        commissionWeighting: 'CJ-70%-TikTok-30%',
        smartFallback: cjProducts.length === 0 && tiktokProducts.length > 0,
        exactMatchApplied: exactMatch && query
      },
    };

    const headers = {
      ...getSecurityHeaders(request.headers.get('Origin')),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    };
    return jsonResponse(responseData, 200, headers);

  } catch (error) {
    console.error('Error fetching products:', error);
    return jsonResponse({ error: 'Failed to fetch products from stores', details: error.message }, 500, getSecurityHeaders(request.headers.get('Origin')));
  }
}

async function searchCJStore(query, limit, offset, lowPrice, highPrice, partnerId, env, exactMatch = false) {
  const gqlQuery = buildShoppingProductsQuery(!!partnerId);
  const keywords = query ? (exactMatch ? [query] : query.split(/\s+/).filter(k => k.length > 0)) : ['fragrance'];

  const gqlVariables = {
    companyId: env.CJ_COMPANY_ID,
    keywords: keywords,
    limit: Math.min(limit, 500),
    offset,
    websiteId: env.CJ_WEBSITE_ID,
    lowPrice,
    highPrice,
    partnerIds: partnerId ? [partnerId] : null
  };

  const gqlData = await fetchCJProducts(gqlQuery, gqlVariables, env);
  const allProducts = gqlData.data?.shoppingProducts?.resultList || [];

  // Filter to only include fragranceShop.com products (unless specific partnerId is requested)
  if (!partnerId) {
    const filteredProducts = allProducts.filter(product => {
      const advertiserName = product.advertiserName?.toLowerCase() || '';
      return advertiserName.includes('fragranceshop') || advertiserName.includes('fragrance shop');
    });
    console.log(`🔍 Filtered CJ products: ${allProducts.length} -> ${filteredProducts.length} (fragranceShop.com only)`);
    return filteredProducts;
  }

  return allProducts;
}

async function searchTikTokStore(query, limit, offset, lowPrice, highPrice, env, exactMatch = false) {
  try {
    const gqlQuery = buildShoppingProductsQuery(true);
    const keywords = query ? (exactMatch ? [query] : query.split(/\s+/).filter(k => k.length > 0)) : ['viral perfume', 'trending fragrance'];

    const gqlVariables = {
      companyId: env.CJ_COMPANY_ID,
      keywords: keywords,
      limit: Math.min(limit, 200),
      offset,
      websiteId: env.CJ_WEBSITE_ID,
      lowPrice,
      highPrice,
      partnerIds: [REVENUE_CONFIG.TIKTOK_PARTNER_ID]
    };
    
    const gqlData = await fetchCJProducts(gqlQuery, gqlVariables, env);
    const products = gqlData.data?.shoppingProducts?.resultList || [];
    
    // Debug TikTok products from API
    if (products.length > 0) {
      console.log('🎵 TikTok API Response Debug:', {
        totalProducts: products.length,
        sampleProduct: {
          id: products[0].id,
          title: products[0].title,
          advertiserName: products[0].advertiserName,
          price: products[0].price,
          currency: products[0].price?.currency,
          amount: products[0].price?.amount
        }
      });
    }
    
    return products;
  } catch (error) {
    console.error('TikTok Store search failed:', error);
    return [];
  }
}

async function fetchCJProducts(gqlQuery, variables, env) {
  if (!env.CJ_DEV_KEY) {
      throw new Error("CJ_DEV_KEY is not configured in environment secrets.");
  }
  const gqlRes = await fetch('https://ads.api.cj.com/query', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.CJ_DEV_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gqlQuery, variables })
  });

  if (!gqlRes.ok) {
    const errorText = await gqlRes.text();
    console.error('CJ API HTTP Error:', gqlRes.status, errorText);
    throw new Error(`CJ API Error ${gqlRes.status}: ${errorText}`);
  }

  const gqlData = await gqlRes.json();
  if (gqlData.errors) {
    console.error('CJ GraphQL Errors:', JSON.stringify(gqlData.errors, null, 2));
    throw new Error(`CJ GraphQL Error: ${JSON.stringify(gqlData.errors)}`);
  }

  return gqlData;
}

function buildShoppingProductsQuery(includePartnerIds) {
  const varDecl = includePartnerIds ? ", $partnerIds: [ID!]" : "";
  const argUse = includePartnerIds ? ", partnerIds: $partnerIds" : "";
  return `
    query shoppingProducts($companyId: ID!, $keywords: [String!], $limit: Int!, $offset: Int!, $websiteId: ID!, $lowPrice: Float, $highPrice: Float${varDecl}) {
      shoppingProducts(companyId: $companyId, keywords: $keywords, limit: $limit, offset: $offset, lowPrice: $lowPrice, highPrice: $highPrice${argUse}) {
        totalCount
        resultList {
          id
          title
          brand
          price { amount currency }
          imageLink
          advertiserName
          advertiserId
          description
          productType
          link
          shipping { price { amount currency } }
          linkCode(pid: $websiteId) {
            clickUrl
          }
        }
      }
    }
  `;
}

function optimizeForRevenue(products, query, sortBy, brandFilter, REVENUE_CONFIG, COMMISSION_RATES) {
  let filtered = products.filter(p => {
    if (brandFilter && p.brand?.toLowerCase() !== brandFilter.toLowerCase()) return false;
    return true;
  });

  filtered = filtered.map(p => ({
    ...p,
    revenueScore: calculateRevenueScore(p, query, REVENUE_CONFIG, COMMISSION_RATES),
    commissionRate: getCommissionRate(p, COMMISSION_RATES),
    trendingScore: calculateTrendingScore(p)
  }));

  switch (sortBy) {
    case 'revenue':
      return filtered.sort((a, b) => b.revenueScore - a.revenueScore);
    case 'commission':
      return filtered.sort((a, b) => b.commissionRate - a.commissionRate);
    case 'trending':
      return filtered.sort((a, b) => b.trendingScore - a.trendingScore);
    case 'price_low':
      return filtered.sort((a, b) => parseFloat(a.price?.amount || 0) - parseFloat(b.price?.amount || 0));
    case 'price_high':
      return filtered.sort((a, b) => parseFloat(b.price?.amount || 0) - parseFloat(a.price?.amount || 0));
    default: // relevance
      return filtered.sort((a, b) => calculateRelevance(b, query) - calculateRelevance(a, query));
  }
}

function calculateRevenueScore(product, query, REVENUE_CONFIG, COMMISSION_RATES) {
  let score = 0;
  const commissionRate = getCommissionRate(product, COMMISSION_RATES);
  score += commissionRate * 100;

  const price = parseFloat(product.price?.amount || 0);
  if (price >= REVENUE_CONFIG.OPTIMAL_PRICE_RANGE.min && price <= REVENUE_CONFIG.OPTIMAL_PRICE_RANGE.max) {
    score += 50;
  }

  const brandCategory = getBrandCategory(product);
  const categoryWeight = COMMISSION_RATES[brandCategory]?.weight || COMMISSION_RATES.default.weight;
  score *= categoryWeight;

  if (query) {
    const relevance = calculateRelevance(product, query);
    score += relevance * 0.3;
  }

  if (product.advertiserName?.includes('TikTok')) {
    score *= REVENUE_CONFIG.TIKTOK_WEIGHT;
  } else {
    score *= REVENUE_CONFIG.CJ_WEIGHT;
  }
  return score;
}

function getCommissionRate(product, COMMISSION_RATES) {
  if (!product.linkCode?.clickUrl) return 0;
  const brandCategory = getBrandCategory(product);
  return COMMISSION_RATES[brandCategory]?.rate || COMMISSION_RATES.default.rate;
}

function getBrandCategory(product) {
  const brand = product.brand?.toLowerCase() || '';
  const title = product.title?.toLowerCase() || '';
  if (brand.includes('luxury') || title.includes('luxury')) return 'luxury';
  if (brand.includes('designer') || title.includes('designer')) return 'designer';
  if (brand.includes('niche') || title.includes('niche')) return 'niche';
  if (brand.includes('celebrity') || title.includes('celebrity')) return 'celebrity';
  if (title.includes('limited') || title.includes('seasonal')) return 'seasonal';
  return 'default';
}

function calculateTrendingScore(product) {
  let score = 0;
  const title = product.title?.toLowerCase() || '';
  if (title.includes('viral') || title.includes('trending')) score += 30;
  if (title.includes('tiktok') || title.includes('social media')) score += 25;
  if (title.includes('limited edition')) score += 20;
  if (title.includes('new') || title.includes('2024')) score += 15;
  return score;
}

function calculateRelevance(product, query) {
  if (!query) return 0;
  const queryLower = query.toLowerCase();
  const titleLower = product.title?.toLowerCase() || '';
  const brandLower = product.brand?.toLowerCase() || '';
  let score = 0;
  if (titleLower.includes(queryLower)) score += 100;
  if (brandLower.includes(queryLower)) score += 80;
  const queryWords = queryLower.split(/\s+/);
  queryWords.forEach(word => {
    if (titleLower.includes(word)) score += 20;
    if (brandLower.includes(word)) score += 15;
  });
  return score;
}

function constructProductUrl(product, cleanAdvertiserName) {
  const productId = product.id;
  const productTitle = product.title || '';
  
  // Create URL-friendly slug from product title
  const urlSlug = productTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .substring(0, 100); // Limit length
  
  // Try different URL patterns based on known advertiser patterns
  switch (cleanAdvertiserName) {
    case 'shein':
      // SHEIN uses product IDs in URLs
      return `https://www.shein.com/product/${productId}`;
    
    case 'watchmaxx':
      // Watchmaxx uses product IDs
      return `https://www.watchmaxx.com/product/${productId}`;
    
    case 'yvessaintlaurentbeautyysl':
    case 'yslbeauty':
      // YSL Beauty uses product IDs
      return `https://www.yslbeautyus.com/product/${productId}`;
    
    case 'giorgioarmanibeauty':
      // Giorgio Armani Beauty uses product IDs
      return `https://www.giorgioarmanibeauty-usa.com/product/${productId}`;
    
    case 'revolve':
      // REVOLVE uses product IDs
      return `https://www.revolve.com/product/${productId}`;
    
    case 'fwrd':
      // FWRD uses product IDs
      return `https://www.fwrd.com/product/${productId}`;
    
    case 'fragrancexcom':
      // FragranceX uses product IDs
      return `https://www.fragrancex.com/product/${productId}`;
    
    case 'notinocouk':
      // Notino uses product IDs
      return `https://www.notino.co.uk/product/${productId}`;
    
    default:
      // For unknown advertisers, try a generic product URL pattern
      if (urlSlug && productId) {
        return `https://www.${cleanAdvertiserName}.com/product/${urlSlug}-${productId}`;
      } else if (urlSlug) {
        return `https://www.${cleanAdvertiserName}.com/product/${urlSlug}`;
      } else {
        // Fallback to search URL
        return `https://www.${cleanAdvertiserName}.com/search?q=${encodeURIComponent(productTitle)}`;
      }
  }
}

async function formatProductForRevenue(p, query, REVENUE_CONFIG, COMMISSION_RATES, env) {
  const clickUrl = p.linkCode?.clickUrl;
  const productLink = p.link; // The actual product landing page URL from CJ
  
  if (!p.imageLink) return null;

  let price = parseFloat(p.price?.amount || 0);
  const commissionRate = getCommissionRate(p, COMMISSION_RATES);
  
  // Flag TikTok pricing issues - CJ may provide inaccurate prices for TikTok products
  if (p.advertiserName?.includes('TikTok')) {
    console.warn('⚠️ TikTok Product - CJ Price May Be Inaccurate:', {
      id: p.id,
      title: p.title,
      advertiserName: p.advertiserName,
      cjReportedPrice: price,
      currency: p.price?.currency,
      note: 'CJ pricing for TikTok products may not match actual TikTok Shop prices'
    });
  }
  
  // Debug TikTok pricing issues
  if (p.advertiserName?.includes('TikTok')) {
    console.log('🎵 TikTok Product Debug:', {
      id: p.id,
      title: p.title,
      advertiserName: p.advertiserName,
      rawPrice: p.price,
      parsedPrice: price,
      currency: p.price?.currency,
      priceAmount: p.price?.amount,
      priceAmountType: typeof p.price?.amount,
      priceAmountString: String(p.price?.amount)
    });
    
    // Check for potential currency conversion issues
    if (price > 100) {
      console.warn('🚨 HIGH TikTok Price Detected - Possible Currency Issue:', {
        id: p.id,
        title: p.title,
        price: price,
        currency: p.price?.currency,
        rawPrice: p.price,
        possibleConversion: price / 5.22 // Check if it's ~5x too high (CNY to USD)
      });
    }
    
    // Validate TikTok prices - flag suspicious prices
    if (price > 10000 || price < 0.01) {
      console.warn('🚨 SUSPICIOUS TikTok Price Detected:', {
        id: p.id,
        title: p.title,
        price: price,
        currency: p.price?.currency,
        rawPrice: p.price
      });
    }
  }
  
  // Filter out products with obviously wrong prices (likely data errors)
  if (price > 50000 || price < 0) {
    console.log('❌ FILTERED: Product with invalid price:', {
      id: p.id,
      title: p.title,
      price: price,
      currency: p.price?.currency,
      advertiser: p.advertiserName
    });
    return null;
  }
  
  // Determine the final link to use for clicks
  let finalClickUrl;
  let hasCommission = false;
  
  // Priority order: CJ affiliate link > CJ product link > constructed URL
  if (clickUrl) {
    // Use CJ affiliate link for commission tracking (best option)
    finalClickUrl = clickUrl;
    hasCommission = true;
    console.log('✅ Using CJ affiliate link for commission tracking:', clickUrl);
  } else if (productLink) {
    // Use CJ's product landing page URL (good fallback - no commission but direct product link)
    finalClickUrl = productLink;
    hasCommission = false;
    console.log('✅ Using CJ product landing page URL (no commission):', productLink);
  } else {
    // If no CJ link available, try to construct a better product URL
    console.log('⚠️ No CJ link available for:', p.id, '- constructing direct product URL');
    
    const advertiserName = p.advertiserName?.toLowerCase();
    const cleanAdvertiserName = advertiserName?.replace(/[^a-z0-9]/g, '');
    
    if (cleanAdvertiserName) {
      // Try to construct a more specific product URL based on advertiser patterns
      finalClickUrl = constructProductUrl(p, cleanAdvertiserName);
      hasCommission = false;
      console.log('✅ Constructed product URL:', finalClickUrl);
    } else {
      console.log('❌ Cannot construct merchant URL - no advertiser name');
      return null; // Skip products we can't link to
    }
  }
  
  return {
    id: p.id,
    name: p.title,
    brand: p.brand || p.advertiserName,
    price: price,
    image: p.imageLink,
    shippingCost: parseFloat(p.shipping?.price?.amount || 0),
    buyUrl: finalClickUrl, // The actual clickable link (CJ affiliate link if available, otherwise CJ product link, otherwise constructed URL)
    link: finalClickUrl, // The actual clickable link (CJ affiliate link if available, otherwise CJ product link, otherwise constructed URL)
    cjLink: clickUrl, // Original CJ affiliate link (null if not available)
    productLink: productLink, // CJ's product landing page URL (null if not available)
    advertiserId: p.advertiserId, // Advertiser ID from CJ
    description: p.description, // Product description from CJ
    productType: p.productType, // Product type from CJ
    advertiser: p.advertiserName,
    currency: p.price?.currency || 'USD',
    revenue: {
      commissionRate: hasCommission ? commissionRate : 0,
      estimatedCommission: hasCommission ? (price * commissionRate) : 0,
      hasCommission: hasCommission,
      revenueScore: calculateRevenueScore(p, query, REVENUE_CONFIG, COMMISSION_RATES)
    },
    relevance: calculateRelevance(p, query)
  };
}

function calculateRevenueMetrics(products, cjCount, tiktokCount) {
  const totalProducts = products.length;
  if (totalProducts === 0) return { totalProducts: 0 };
  const totalValue = products.reduce((sum, p) => sum + (p.price || 0), 0);
  const avgCommission = products.reduce((sum, p) => sum + (p.revenue?.commissionRate || 0), 0) / totalProducts;
  const estimatedTotalCommission = products.reduce((sum, p) => sum + (p.revenue?.estimatedCommission || 0), 0);
  return {
    totalProducts,
    totalValue: totalValue.toFixed(2),
    avgCommissionRate: (avgCommission * 100).toFixed(2) + '%',
    estimatedTotalCommission: estimatedTotalCommission.toFixed(2),
    sources: { cj: cjCount, tiktok: tiktokCount }
  };
}

function deduplicateProducts(products) {
  const seen = new Map();
  return products.filter(product => {
    const key = `${product.title?.toLowerCase()}-${product.brand?.toLowerCase()}-${product.price?.amount}`;
    if (seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });
}

async function handleHealthRequest(env) {
  return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
}

async function handleFeedsRequest(env) {
  const query = `query productFeeds($companyId: ID!) { productFeeds(companyId: $companyId) { resultList { adId feedName advertiserId productCount lastUpdated advertiserName } } }`;
  const gqlData = await fetchCJProducts(query, { companyId: env.CJ_COMPANY_ID }, env);
  return jsonResponse(gqlData.data.productFeeds.resultList || []);
}

async function handleTrendingRequest(env) {
  return jsonResponse({ trending: ['luxury perfume', 'designer fragrance', 'viral perfume', 'limited edition'] });
}

async function handleAnalyticsRequest(request, env) {
  return jsonResponse({ message: 'Analytics endpoint - coming soon' });
}


// --- CONTACT FORM HANDLER ---
async function handleContactForm(request, env) {
    const origin = request.headers.get('Origin');
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown-ip';

    // Rate limiting: 3 contact form submissions per hour per IP
    if (isRateLimited(clientIP, 'contact', 3, 60 * 60 * 1000)) {
        return jsonResponse({
            error: 'Too many contact form submissions. Please try again later.',
            type: 'rate_limit',
            retryAfter: '1 hour'
        }, 429, getSecurityHeaders(origin));
    }

    if (!validateSiteOrigin(request)) {
        return jsonResponse({ error: 'Unauthorized origin' }, 403, getSecurityHeaders(origin));
    }

    const headers = getSecurityHeaders(origin);

    try {
        const { name, email, subject, message } = await request.json();

        // Subject mapping for better display names
        const subjectMap = {
            'general': 'General Inquiry',
            'product': 'Product Information Request',
            'order': 'Order Status Inquiry',
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
            console.warn('RESEND_API_KEY not configured - skipping email send');
            return jsonResponse({
                success: true,
                message: 'Your message has been sent.',
                emailId: 'demo-mode',
                verification: {
                    status: 'demo',
                    timestamp: new Date().toISOString(),
                    recipient: 'support@fragrancecollect.com',
                    subject: `Fragrance Collect Contact: ${subjectMap[subject] || subject}`,
                    estimatedDelivery: 'Demo mode - no email sent'
                }
            }, 200, headers);
        }

        const emailResult = await sendContactEmail({
            name,
            email,
            subject,
            message
        }, env);

        if (!emailResult.success) {
            console.error('Failed to send contact email:', emailResult.error);
            return jsonResponse({
                error: 'Failed to send email. Please try again later.',
                type: 'email_failure',
                reason: emailResult.error,
                message: 'There was an issue sending your message. Please try again in a few minutes or contact us directly at support@fragrancecollect.com'
            }, 500, headers);
        }

        console.log('Contact form email sent successfully:', { name, email, subject, emailId: emailResult.emailId });

        return jsonResponse({
            success: true,
            message: 'Thank you for your message! We\'ll get back to you within 24 hours.',
            emailId: emailResult.emailId,
            verification: {
                status: 'sent',
                timestamp: new Date().toISOString(),
                recipient: 'support@fragrancecollect.com',
                subject: `Fragrance Collect Contact: ${subjectMap[subject] || subject}`,
                estimatedDelivery: 'within 5 minutes'
            }
        }, 200, headers);

    } catch (error) {
        console.error('Error processing contact form:', error);

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
            console.error('RESEND_API_KEY not configured');
            return { success: false, error: 'Email service not configured' };
        }

        // Subject mapping for better display names
        const subjectMap = {
            'general': 'General Inquiry',
            'product': 'Product Information Request',
            'order': 'Order Status Inquiry',
            'feedback': 'Feedback & Suggestions',
            'partnership': 'Partnership Opportunity'
        };

        const emailSubject = `Fragrance Collect Contact: ${subjectMap[subject] || subject}`;
        const emailHtml = generateContactEmailHtml(name, email, subjectMap[subject], message);

        // Initialize Resend with API key
        console.log('🔑 RESEND_API_KEY available:', !!env.RESEND_API_KEY);
        console.log('🔑 RESEND_API_KEY length:', env.RESEND_API_KEY ? env.RESEND_API_KEY.length : 'undefined');
        console.log('🔑 RESEND_API_KEY starts with:', env.RESEND_API_KEY ? env.RESEND_API_KEY.substring(0, 10) + '...' : 'undefined');

        if (!env.RESEND_API_KEY) {
            throw new Error('RESEND_API_KEY is not configured in environment');
        }

        if (!env.RESEND_API_KEY.startsWith('re_')) {
            console.error('❌ RESEND_API_KEY does not start with re_ - invalid format');
            throw new Error('Invalid RESEND_API_KEY format');
        }

        console.log('🔧 Initializing Resend client...');
        const resend = new Resend(env.RESEND_API_KEY);
        console.log('✅ Resend client initialized');

        // Send email directly to personal address while domain verifies
        console.log('📧 From:', 'Fragrance Collect <onboarding@resend.dev>');
        console.log('📧 To:', 'joshuablaszczyk@gmail.com');
        console.log('📧 Subject:', emailSubject);

        const { data, error } = await resend.emails.send({
            from: 'Fragrance Collect <onboarding@resend.dev>', // Resend's verified domain
            to: ['joshuablaszczyk@gmail.com'], // Send directly to personal email
            subject: emailSubject,
            html: emailHtml,
            reply_to: email
        });

        if (error) {
            console.error('❌ Resend API error:', JSON.stringify(error, null, 2));
            console.error('❌ Error type:', typeof error);
            console.error('❌ Error message:', error ? error.message : 'undefined error');
            console.error('❌ Full error object:', error);
            const errorMsg = error && error.message ? error.message : 'Unknown Resend error';
            return { success: false, error: `Resend error: ${errorMsg}` };
        }

        console.log('Email sent successfully via Resend:', data.id);
        return { success: true, emailId: data.id };

    } catch (error) {
        console.error('Error sending email via Resend:', error);
        return { success: false, error: error.message };
    }
}

// Generate professional HTML email template for contact form
function generateContactEmailHtml(name, email, subject, message) {
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
                            <td style="padding: 8px 0; color: #666;">${name}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: 600; color: #333;">Email:</td>
                            <td style="padding: 8px 0; color: #666;">
                                <a href="mailto:${email}" style="color: #C9A646; text-decoration: none;">${email}</a>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: 600; color: #333;">Subject:</td>
                            <td style="padding: 8px 0; color: #666;">${subject}</td>
                        </tr>
                    </table>
                </div>

                <div style="background: white; padding: 25px; border-radius: 10px;">
                    <h3 style="color: #C9A646; margin: 0 0 15px 0; font-size: 18px;">Message</h3>
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #C9A646;">
                        <p style="margin: 0; color: #333; line-height: 1.6; white-space: pre-wrap;">${message}</p>
                    </div>
                </div>

                <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef;">
                    <p style="color: #666; font-size: 14px; margin: 0;">
                        This message was sent via the Fragrance Collect contact form.<br>
                        We aim to respond to all inquiries within 24 hours.
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
        
        console.log('Retrieved preferences for user:', user.id);
        console.log('Raw preferences:', prefs);
        console.log('Parsed preferences:', parsedPrefs);
        
        return jsonResponse({ success: true, preferences: parsedPrefs }, 200, headers);
    } catch (error) {
        console.error('Error getting preferences:', error);
        return jsonResponse({ error: 'Failed to get preferences' }, 500, headers);
    }
}

async function handleUpdatePreferences(request, env) {
    const { user, headers, errorResponse } = await getUserFromRequest(request, env);
    if (errorResponse) return errorResponse;

    try {
        const prefs = await request.json();
        
        // Convert arrays to JSON strings for database storage
        const scentCategoriesJson = JSON.stringify(prefs.scent_categories || []);
        const sensitivitiesJson = JSON.stringify(prefs.sensitivities || []);
        
        console.log('Updating preferences for user:', user.id);
        console.log('Preferences data:', prefs);
        console.log('Scent categories JSON:', scentCategoriesJson);
        console.log('Sensitivities JSON:', sensitivitiesJson);
        
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
        `).bind(user.id, scentCategoriesJson, prefs.intensity, prefs.season, prefs.occasion, prefs.budget_range, sensitivitiesJson).run();

        return jsonResponse({ success: true, message: 'Preferences updated' }, 200, headers);
    } catch (error) {
        console.error('Error updating preferences:', error);
        return jsonResponse({ error: 'Failed to update preferences' }, 500, headers);
    }
}

async function handleUpdateProfile(request, env) {
    const { user, headers, errorResponse } = await getUserFromRequest(request, env);
    if (errorResponse) return errorResponse;

    try {
        const profileData = await request.json();
        
        console.log('Updating profile for user:', user.id);
        console.log('Profile data:', profileData);
        
        // Validate required fields
        if (!profileData.name || !profileData.email) {
            return jsonResponse({ error: 'Name and email are required' }, 400, headers);
        }
        
        // Update user profile in database
        await env.DB.prepare(`
            UPDATE users 
            SET name = ?, email = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).bind(profileData.name, profileData.email, user.id).run();

        console.log('Profile updated successfully for user:', user.id);
        return jsonResponse({ success: true, message: 'Profile updated' }, 200, headers);
    } catch (error) {
        console.error('Error updating profile:', error);
        return jsonResponse({ error: 'Failed to update profile' }, 500, headers);
    }
}

async function handleChangePassword(request, env) {
    const { user, headers, errorResponse } = await getUserFromRequest(request, env);
    if (errorResponse) return errorResponse;

    try {
        const passwordData = await request.json();
        
        console.log('Changing password for user:', user.id);
        
        // Validate required fields
        if (!passwordData.currentPassword || !passwordData.newPassword) {
            return jsonResponse({ error: 'Current password and new password are required' }, 400, headers);
        }
        
        // Validate new password length
        if (passwordData.newPassword.length < 8) {
            return jsonResponse({ error: 'New password must be at least 8 characters long' }, 400, headers);
        }
        
        // Get user's current password hash from database
        const userRecord = await env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`).bind(user.id).first();
        
        if (!userRecord) {
            return jsonResponse({ error: 'User not found' }, 404, headers);
        }
        
        // Verify current password
        let isCurrentPasswordValid = false;
        if (userRecord.password_hash.includes(':')) {
            // PBKDF2 hash format
            isCurrentPasswordValid = await verifyPasswordPBKDF2(passwordData.currentPassword, userRecord.password_hash);
        } else {
            // Legacy hash format (fallback)
            const passwordHash = await hashPasswordPBKDF2(passwordData.currentPassword);
            isCurrentPasswordValid = compareHashes(passwordHash, userRecord.password_hash);
        }
        
        if (!isCurrentPasswordValid) {
            return jsonResponse({ error: 'Current password is incorrect' }, 400, headers);
        }
        
        // Hash new password using PBKDF2
        const newPasswordHash = await hashPasswordPBKDF2(passwordData.newPassword);
        
        // Update password in database
        await env.DB.prepare(`
            UPDATE users 
            SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).bind(newPasswordHash, user.id).run();

        console.log('Password changed successfully for user:', user.id);
        return jsonResponse({ success: true, message: 'Password changed successfully' }, 200, headers);
    } catch (error) {
        console.error('Error changing password:', error);
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
        console.error('Error getting favorites:', error);
        return jsonResponse({ error: 'Failed to get favorites' }, 500, headers);
    }
}

async function handleAddFavorite(request, env) {
    const { user, headers, errorResponse } = await getUserFromRequest(request, env);
    if (errorResponse) return errorResponse;

    try {
        const favorite = await request.json();
        
        // Ensure the required fields are present
        if (!favorite.fragrance_id || !favorite.name) {
            return jsonResponse({ error: 'fragrance_id and name are required' }, 400, headers);
        }

        // Sanitize input by converting undefined to null for optional fields
        const price = favorite.price === undefined ? null : favorite.price;
        const shippingCost = favorite.shippingCost === undefined ? null : favorite.shippingCost;

        await env.DB.prepare(`
            INSERT INTO user_favorites (id, user_id, fragrance_id, name, advertiserName, description, imageUrl, productUrl, price, currency, shippingCost, shipping_availability)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            favorite.fragrance_id,
            favorite.name,
            favorite.advertiserName || null,
            favorite.description || null,
            favorite.imageUrl || null,
            favorite.productUrl || null,
            price,
            favorite.currency || null,
            shippingCost,
            favorite.shipping_availability || null
        ).run();

        return jsonResponse({ success: true, message: 'Favorite added' }, 201, headers);
    } catch (error) {
        console.error('Error adding favorite:', error);
        return jsonResponse({ error: 'Failed to add favorite', details: error.message }, 500, headers);
    }
}

async function handleDeleteFavorite(request, env) {
    const { user, headers, errorResponse } = await getUserFromRequest(request, env);
    if (errorResponse) return errorResponse;

    try {
        const url = new URL(request.url);
        const fragranceId = url.pathname.split('/').pop();

        if (!fragranceId) {
            return jsonResponse({ error: 'Fragrance ID is required' }, 400, headers);
        }

        const { success, meta } = await env.DB.prepare(`DELETE FROM user_favorites WHERE user_id = ? AND fragrance_id = ?`).bind(user.id, fragranceId).run();

        if (meta.changes === 0) {
            return jsonResponse({ error: 'Favorite not found or not owned by user' }, 404, headers);
        }

        return jsonResponse({ success: true, message: 'Favorite removed' }, 200, headers);
    } catch (error) {
        console.error('Error deleting favorite:', error);
        return jsonResponse({ error: 'Failed to delete favorite' }, 500, headers);
    }
}

async function getUserFromRequest(request, env) {
    const origin = request.headers.get('Origin');
    const headers = getSecurityHeaders(origin);
    const token = getTokenFromRequest(request);

    if (!token) {
        return { errorResponse: jsonResponse({ error: 'Not authenticated' }, 401, headers) };
    }

    const session = await getValidSession(env, token);
    if (!session) {
        headers['Set-Cookie'] = createCookie('', -1);
        return { errorResponse: jsonResponse({ error: 'Invalid or expired session' }, 401, headers) };
    }
    
    // Quick validation before proceeding
    if (!validateSessionSecurity(session, request)) {
       await env.DB.prepare(`DELETE FROM user_sessions WHERE token = ?`).bind(token).run();
       headers['Set-Cookie'] = createCookie('', -1);
       return { errorResponse: jsonResponse({ error: 'Session security validation failed' }, 401, headers) };
    }

    return { user: { id: session.user_id }, headers };
}

/**
 * Decodes a Base64URL encoded string.
 * @param {string} str 
 * @returns {string}
 */
function b64UrlDecode(str) {
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
        // 1. Decode token parts
        const [headerB64, payloadB64, signatureB64] = token.split('.');
        if (!headerB64 || !payloadB64 || !signatureB64) {
            console.error('Invalid JWT structure');
            return null;
        }
        
        const header = JSON.parse(b64UrlDecode(headerB64));
        const payload = JSON.parse(b64UrlDecode(payloadB64));

        // 2. Check basic claims
        if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
            console.error('Invalid issuer:', payload.iss);
            return null;
        }
        if (payload.aud !== clientId) {
            console.error('Invalid audience:', payload.aud);
            return null;
        }
        if (payload.exp * 1000 < Date.now()) {
            console.error('Token expired');
            return null;
        }

        // 3. Verify signature
        const publicKey = await getGooglePublicKey(header.kid);
        if (!publicKey) {
            console.error('Could not fetch Google public key for kid:', header.kid);
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
        console.error('Error verifying Google token:', error);
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
    if (keyCache.has(kid) && (now - lastKeyFetchTime < KEY_CACHE_TTL)) {
        return keyCache.get(kid);
    }

    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
        if (!response.ok) throw new Error('Failed to fetch Google certs');
        
        const { keys } = await response.json();
        
        // Clear old keys and update cache
        keyCache.clear();
        for (const key of keys) {
            const jwk = {
                kty: key.kty,
                n: key.n,
                e: key.e,
                alg: key.alg,
                kid: key.kid,
                use: key.use,
            };
            const importedKey = await crypto.subtle.importKey(
                'jwk',
                jwk,
                { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
                true,
                ['verify']
            );
            keyCache.set(key.kid, importedKey);
        }
        
        lastKeyFetchTime = now;
        return keyCache.get(kid) || null;
        
    } catch (error) {
        console.error('Error fetching/caching Google public keys:', error);
        return null;
    }
}