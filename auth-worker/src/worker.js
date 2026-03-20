// A map to cache Google's public keys.
// Keys are key IDs, values are the imported CryptoKey objects.
const keyCache = new Map();
let lastKeyFetchTime = 0;
const KEY_CACHE_TTL = 3600 * 1000; // 1 hour in milliseconds

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    const url = new URL(request.url);
    
    // Note: The '/verify' endpoint is kept for JWT validation if needed elsewhere,
    // but the primary login flow now uses '/login'.
    if (url.pathname === '/verify' && request.method === 'POST') {
      return handleVerificationRequest(request, env);
    }
    
    if (url.pathname === '/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }
    
    if (url.pathname === '/logout' && request.method === 'POST') {
      return handleLogout(request, env);
    }
    
        if (url.pathname === '/status' && request.method === 'GET') {
        return handleGetStatus(request, env);
    }
    if (url.pathname === '/token' && request.method === 'GET') {
        return handleGetToken(request, env);
    }

    if (url.pathname === '/signup/email' && request.method === 'POST') {
      return handleEmailSignup(request, env);
    }

    if (url.pathname === '/login/email' && request.method === 'POST') {
      return handleEmailLogin(request, env);
    }

    // --- NEW ACCOUNT FEATURE ENDPOINTS ---
    if (url.pathname === '/api/user/preferences' && request.method === 'GET') {
        return handleGetPreferences(request, env);
    }
    if (url.pathname === '/api/user/preferences' && request.method === 'POST') {
        return handleUpdatePreferences(request, env);
    }
    if (url.pathname === '/api/user/favorites' && request.method === 'GET') {
        return handleGetFavorites(request, env);
    }
    if (url.pathname === '/api/user/favorites' && request.method === 'POST') {
        return handleAddFavorite(request, env);
    }
    if (url.pathname.startsWith('/api/user/favorites/') && request.method === 'DELETE') {
        return handleDeleteFavorite(request, env);
    }

    const headers = getSecurityHeaders(request.headers.get('Origin'));
    return new Response('Not Found', { status: 404, headers });
  },
};

async function handleVerificationRequest(request, env) {
  const origin = request.headers.get('Origin');
  const headers = getSecurityHeaders(origin);
  try {
    const { token } = await request.json();
    const CLIENT_ID = env.GOOGLE_CLIENT_ID;

    if (!token) {
      return jsonResponse({ error: 'Token is required' }, 400, headers);
    }

    // 1. Decode JWT to get header and payload
    const { header, payload, signature } = decodeJwt(token);

    // 2. Get the appropriate Google public key to verify the token's signature
    const publicKey = await getGooglePublicKey(header.kid);
    if (!publicKey) {
      return jsonResponse({ error: 'Could not retrieve public key for verification' }, 500, headers);
    }
    
    // 3. Verify the token's signature
    const isValidSignature = await verifySignature(publicKey, signature, token);
    if (!isValidSignature) {
      return jsonResponse({ error: 'Invalid token signature' }, 401, headers);
    }

    // 4. Verify the token's claims
    verifyClaims(payload, CLIENT_ID);

    const user = {
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
    };

    return jsonResponse({ success: true, user }, 200, headers);

  } catch (error) {
    return jsonResponse({ error: 'Token verification failed', details: error.message }, 401, headers);
  }
}

// --- JWT Verification Steps ---

/**
 * Fetches Google's public keys for verifying JWTs. Caches them for performance.
 * @param {string} kid The Key ID from the JWT header.
 * @returns {Promise<CryptoKey|null>}
 */
async function getGooglePublicKey(kid) {
  const now = Date.now();
  if (now - lastKeyFetchTime > KEY_CACHE_TTL) {
    keyCache.clear(); // Clear cache if it's expired
  }

  if (keyCache.has(kid)) {
    return keyCache.get(kid);
  }

  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!response.ok) throw new Error('Failed to fetch Google certs');
    const certs = await response.json();

    for (const key of certs.keys) {
      const importedKey = await crypto.subtle.importKey(
        'jwk',
        key,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        true,
        ['verify']
      );
      keyCache.set(key.kid, importedKey);
    }
    lastKeyFetchTime = Date.now();
  } catch (error) {
    console.error('Error fetching/importing Google public keys:', error);
    return null;
  }
  
  return keyCache.get(kid) || null;
}

/**
 * Verifies the JWT's signature using the Web Crypto API.
 */
async function verifySignature(publicKey, signature, token) {
  const tokenParts = token.split('.');
  const dataToVerify = new TextEncoder().encode(tokenParts[0] + '.' + tokenParts[1]);
  return await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    publicKey,
    signature,
    dataToVerify
  );
}

/**
 * Verifies the claims of the JWT payload.
 */
function verifyClaims(payload, audience) {
  // Issuer must be from Google
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw new Error(`Invalid issuer: ${payload.iss}`);
  }

  // Audience must match your app's Client ID
  if (payload.aud !== audience) {
    throw new Error(`Invalid audience: ${payload.aud}`);
  }

  // Token must not be expired
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error('Token has expired');
  }

  return true;
}

// --- Database & Authentication Functions ---

/**
 * Handles user login after Google JWT verification and creates a secure session.
 */
async function handleLogin(request, env) {
  // Validate request origin for security
  const origin = request.headers.get('Origin');
  if (!validateSiteOrigin(request)) {
    console.warn('Login attempt from unauthorized origin:', origin || request.headers.get('Referer'));
    // Still set CORS headers even for unauthorized requests to prevent CORS errors
    const headers = getSecurityHeaders(origin);
    return jsonResponse({ error: 'Unauthorized origin' }, 403, headers);
  }

  const headers = getSecurityHeaders(env.ALLOWED_ORIGIN || 'https://fragrancecollect.com');
  const redirectUrl = `${env.ALLOWED_ORIGIN || 'https://fragrancecollect.com'}/auth.html`;

  try {
    const contentType = request.headers.get('content-type') || '';
    let credential;

    if (contentType.includes('application/json')) {
        // Handles calls from the frontend if needed
        const body = await request.json();
        credential = body.credential;
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
        // Handles the redirect POST from Google
        const formData = await request.formData();
        credential = formData.get('credential');
    }

    if (!credential) {
        return jsonResponse({ error: 'Google credential is required' }, 400, headers);
    }

    // 1. Verify the Google JWT
    const { header, payload, signature } = decodeJwt(credential);
    const publicKey = await getGooglePublicKey(header.kid);
    if (!publicKey) {
        return jsonResponse({ error: 'Could not retrieve public key' }, 500, headers);
    }
    const isValidSignature = await verifySignature(publicKey, signature, credential);
    if (!isValidSignature) {
        return jsonResponse({ error: 'Invalid token signature' }, 401, headers);
    }
    verifyClaims(payload, env.GOOGLE_CLIENT_ID);

    // 2. User data from payload
    const { sub: id, email, name, picture } = payload;
    
    // 3. Create or update the user in the database
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, picture) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, picture=excluded.picture, updated_at=CURRENT_TIMESTAMP`
    ).bind(id, email, name, picture).run();

    // 4. Create a secure session with fingerprinting
    const sessionId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    // Get client fingerprinting data for session security
    const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || 'unknown';
    const sessionFingerprint = await generateSessionFingerprint(clientIP, userAgent);

    // Clean up old sessions before creating new one
    await cleanupUserSessions(env, id, token);

    await env.DB.prepare(
        `INSERT INTO user_sessions (id, user_id, token, expires_at, client_ip, user_agent, fingerprint, last_activity) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(sessionId, id, token, expiresAt.toISOString(), clientIP, userAgent, sessionFingerprint).run();

    // 5. Set the session token in a secure, HttpOnly cookie
    // **FIX:** Configure cookie properly for cross-origin requests
    const originUrl = request.headers.get('Origin') ? new URL(request.headers.get('Origin')) : null;
    let cookieString = `session_token=${token}; Expires=${expiresAt.toUTCString()}; Path=/; HttpOnly`;

    // Handle cross-origin cookie setting
    if (originUrl) {
        // For local development (localhost, 127.0.0.1, file://)
        if (originUrl.hostname === '127.0.0.1' || originUrl.hostname === 'localhost' || originUrl.protocol === 'file:') {
            // Don't set Domain for localhost to avoid issues
            cookieString += '; SameSite=None; Secure';
        } else if (originUrl.hostname.includes('workers.dev') || originUrl.hostname.includes('pages.dev')) {
            // For Cloudflare domains
            cookieString += '; SameSite=None; Secure';
        } else if (originUrl.hostname.includes('github.io')) {
            // For GitHub Pages
            cookieString += '; SameSite=None; Secure';
        } else {
            // For other production domains
            cookieString += '; SameSite=None; Secure';
        }
    } else {
        // Fallback for requests without Origin header
        cookieString += '; SameSite=None; Secure';
    }

    headers['Set-Cookie'] = cookieString;
    
    // 6. Redirect the user back to the auth page with success status and user's first name.
    const firstName = name.split(' ')[0];
    const successRedirectUrl = new URL(redirectUrl);
    successRedirectUrl.searchParams.set('status', 'success');
    successRedirectUrl.searchParams.set('name', firstName);

    return new Response(null, {
        status: 302,
        headers: {
            ...headers,
            'Location': successRedirectUrl.toString(),
        }
    });

  } catch (error) {
    console.error('Error during login:', error.message);
    const errorRedirectUrl = new URL(redirectUrl);
    errorRedirectUrl.searchParams.set('error', 'login_failed');
    // Sanitize and pass the specific error reason for debugging
    const reason = error.message.replace(/[^a-zA-Z0-9_]/g, '_');
    errorRedirectUrl.searchParams.set('reason', reason);
    return new Response(null, {
        status: 302,
        headers: {
            ...headers,
            'Location': errorRedirectUrl.toString(),
        }
    });
  }
}

/**
 * Handles user logout by removing the session from the DB and clearing the cookie.
 */
async function handleLogout(request, env) {
    const origin = request.headers.get('Origin');
    const headers = getSecurityHeaders(origin);

    try {
        const cookieHeader = request.headers.get('Cookie') || '';
        const cookies = Object.fromEntries(cookieHeader.split(';').map(c => c.trim().split('=')));
        const token = cookies.session_token;

        if (token) {
            await env.DB.prepare(`DELETE FROM user_sessions WHERE token = ?`).bind(token).run();
        }

        // Clear the cookie by setting its expiration date to the past
        headers['Set-Cookie'] = `session_token=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; Secure; SameSite=Lax`;

        return jsonResponse({ success: true, message: 'Logged out successfully' }, 200, headers);
    } catch (error) {
        console.error('Error during logout:', error);
        return jsonResponse({ error: 'Logout failed' }, 500, headers);
    }
}

/**
 * Gets user status by validating the session cookie.
 */
async function handleGetStatus(request, env) {
    const origin = request.headers.get('Origin');
    const headers = getSecurityHeaders(origin);

    try {
        const cookieHeader = request.headers.get('Cookie') || '';
        const cookies = Object.fromEntries(cookieHeader.split(';').map(c => c.trim().split('=')));
        let token = cookies.session_token;

        // If no cookie token, try Authorization header (cross-origin requests)
        if (!token) {
            const authHeader = request.headers.get('Authorization');
            if (authHeader && authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            }
        }

        if (!token) {
            return jsonResponse({ error: 'Not authenticated' }, 401, headers);
        }

        const session = await env.DB.prepare(
            `SELECT s.*, u.id, u.email, u.name, u.picture 
             FROM user_sessions s JOIN users u ON s.user_id = u.id 
             WHERE s.token = ?`
        ).bind(token).first();

        if (!session || new Date(session.expires_at) < new Date()) {
            // If session is expired or invalid, clear the cookie
            headers['Set-Cookie'] = `session_token=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; Secure; SameSite=Lax`;
            return jsonResponse({ error: 'Invalid or expired session' }, 401, headers);
        }

        // Validate session security (check for potential hijacking)
        if (!validateSessionSecurity(session, request)) {
            console.warn(`Session security validation failed for user ${session.id} in status check`);
            // Invalidate the suspicious session and clear cookie
            await env.DB.prepare(`DELETE FROM user_sessions WHERE token = ?`).bind(token).run();
            headers['Set-Cookie'] = `session_token=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; Secure; SameSite=Lax`;
            return jsonResponse({ error: 'Session security validation failed' }, 401, headers);
        }

        // Update last activity timestamp
        await env.DB.prepare(
            `UPDATE user_sessions SET last_activity = CURRENT_TIMESTAMP WHERE token = ?`
        ).bind(token).run();

        return jsonResponse({
            success: true,
            user: {
                id: session.id,
                email: session.email,
                name: session.name,
                picture: session.picture,
            },
        }, 200, headers);

    } catch (error) {
        console.error('Error getting status:', error);
        return jsonResponse({ error: 'Failed to get user status' }, 500, headers);
    }
}

/**
 * Gets the session token for cross-origin requests (using cookies)
 */
async function handleGetToken(request, env) {
    const origin = request.headers.get('Origin');
    const headers = getSecurityHeaders(origin);

    try {
        console.log('handleGetToken called from origin:', origin);
        const cookieHeader = request.headers.get('Cookie') || '';
        console.log('Cookie header:', cookieHeader);
        
        const cookies = Object.fromEntries(cookieHeader.split(';').map(c => c.trim().split('=')));
        const token = cookies.session_token;
        console.log('Extracted token:', token ? 'present' : 'missing');

        if (!token) {
            console.log('No session token found in cookies');
            return jsonResponse({ error: 'Not authenticated' }, 401, headers);
        }

        // Validate the session exists and is valid
        const session = await env.DB.prepare(
            `SELECT s.expires_at FROM user_sessions s WHERE s.token = ?`
        ).bind(token).first();

        if (!session || new Date(session.expires_at) < new Date()) {
            console.log('Session invalid or expired');
            return jsonResponse({ error: 'Invalid or expired session' }, 401, headers);
        }

        console.log('Token retrieved successfully');
        return jsonResponse({ success: true, token }, 200, headers);

    } catch (error) {
        console.error('Error getting token:', error);
        return jsonResponse({ error: 'Failed to get token' }, 500, headers);
    }
}

// --- NEW ACCOUNT FEATURE HANDLERS ---

/**
 * Middleware to get the authenticated user from a session token.
 */
async function getAuthenticatedUser(request, env) {
    // Try to get token from cookie first (same-origin requests)
    const cookieHeader = request.headers.get('Cookie') || '';
    const cookies = Object.fromEntries(cookieHeader.split(';').map(c => c.trim().split('=')));
    let token = cookies.session_token;

    // If no cookie token, try Authorization header (cross-origin requests)
    if (!token) {
        const authHeader = request.headers.get('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }
    }

    if (!token) {
        return null;
    }

    const session = await env.DB.prepare(
        `SELECT s.*, u.id, u.email, u.name 
         FROM user_sessions s JOIN users u ON s.user_id = u.id 
         WHERE s.token = ? AND s.expires_at > CURRENT_TIMESTAMP`
    ).bind(token).first();

    if (!session) {
        return null;
    }

    // Validate session security (check for potential hijacking)
    if (!validateSessionSecurity(session, request)) {
        console.warn(`Session security validation failed for user ${session.id}`);
        // Invalidate the suspicious session
        await env.DB.prepare(`DELETE FROM user_sessions WHERE token = ?`).bind(token).run();
        return null;
    }

    // Update last activity timestamp
    await env.DB.prepare(
        `UPDATE user_sessions SET last_activity = CURRENT_TIMESTAMP WHERE token = ?`
    ).bind(token).run();

    return { id: session.id, email: session.email, name: session.name }; // Returns user object or null
}

async function handleGetPreferences(request, env) {
    const user = await getAuthenticatedUser(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const prefs = await env.DB.prepare('SELECT * FROM user_preferences WHERE user_id = ?').bind(user.id).first();
    
    return jsonResponse({ success: true, preferences: prefs || {} });
}

async function handleUpdatePreferences(request, env) {
    const user = await getAuthenticatedUser(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const prefs = await request.json();
    
    await env.DB.prepare(
        `INSERT INTO user_preferences (user_id, scent_categories, intensity, season, occasion, budget_range, sensitivities) 
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           scent_categories=excluded.scent_categories,
           intensity=excluded.intensity,
           season=excluded.season,
           occasion=excluded.occasion,
           budget_range=excluded.budget_range,
           sensitivities=excluded.sensitivities,
           updated_at=CURRENT_TIMESTAMP`
    ).bind(user.id, JSON.stringify(prefs.scent_categories || []), prefs.intensity, prefs.season, prefs.occasion, prefs.budget_range, prefs.sensitivities).run();

    return jsonResponse({ success: true, message: 'Preferences updated.' });
}

async function handleGetFavorites(request, env) {
    const origin = request.headers.get('Origin');
    const headers = getSecurityHeaders(origin);
    
    const user = await getAuthenticatedUser(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401, headers);

    const { results } = await env.DB.prepare('SELECT * FROM user_favorites WHERE user_id = ? ORDER BY added_at DESC').bind(user.id).all();

    return jsonResponse({ success: true, favorites: results || [] }, 200, headers);
}

async function handleAddFavorite(request, env) {
    const origin = request.headers.get('Origin');
    const headers = getSecurityHeaders(origin);
    
    const user = await getAuthenticatedUser(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401, headers);

    const fav = await request.json();
    if (!fav || !fav.fragrance_id || !fav.name) {
        return jsonResponse({ error: 'Fragrance ID and name are required' }, 400, headers);
    }

    const favoriteId = crypto.randomUUID();

    try {
        await env.DB.prepare(
            `INSERT INTO user_favorites (id, user_id, fragrance_id, name, advertiserName, description, imageUrl, productUrl, price, currency, shipping_availability) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            favoriteId, user.id, fav.fragrance_id, fav.name, fav.advertiserName, 
            fav.description, fav.imageUrl, fav.productUrl, fav.price, 
            fav.currency, fav.shipping_availability
        ).run();
    } catch (e) {
        if (e.message.includes('UNIQUE constraint failed')) {
            return jsonResponse({ success: true, message: 'Already in favorites.' }, 200, headers);
        }
        console.error('Failed to add favorite:', e);
        return jsonResponse({ error: 'Failed to add favorite.' }, 500, headers);
    }
    
    return jsonResponse({ success: true, message: 'Added to favorites.', favorite_id: favoriteId }, 201, headers);
}

async function handleDeleteFavorite(request, env) {
    const origin = request.headers.get('Origin');
    const headers = getSecurityHeaders(origin);
    
    const user = await getAuthenticatedUser(request, env);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401, headers);

    const url = new URL(request.url);
    const fragranceId = url.pathname.split('/').pop();

    if (!fragranceId) return jsonResponse({ error: 'Fragrance ID is required in URL' }, 400, headers);

    await env.DB.prepare(
        'DELETE FROM user_favorites WHERE user_id = ? AND fragrance_id = ?'
    ).bind(user.id, fragranceId).run();

    return jsonResponse({ success: true, message: 'Removed from favorites.' }, 200, headers);
}


/**
 * Handles user sign-up with email and password.
 */
async function handleEmailSignup(request, env) {
    // Validate request origin for security
    const origin = request.headers.get('Origin');
    if (!validateSiteOrigin(request)) {
        console.warn('Email signup attempt from unauthorized origin:', origin || request.headers.get('Referer'));
        // Still set CORS headers even for unauthorized requests to prevent CORS errors
        const headers = getSecurityHeaders(origin);
        return jsonResponse({ error: 'Unauthorized origin' }, 403, headers);
    }

    const headers = getSecurityHeaders(origin);
    try {
        const { name, email, password } = await request.json();

        if (!name || !email || !password) {
            return jsonResponse({ error: 'Name, email, and password are required.' }, 400, headers);
        }

        // Check if user already exists
        const existingUser = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
        if (existingUser) {
            return jsonResponse({ error: 'A user with this email already exists.' }, 409, headers);
        }
        
        // Hash the password
        const passwordHash = await sha512(password);
        const userId = crypto.randomUUID();

        // Store the new user
        await env.DB.prepare(
            `INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)`
        ).bind(userId, name, email, passwordHash).run();
        
        // Create a session for the new user
        const sessionId = crypto.randomUUID();
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        // Get client fingerprinting data for session security
        const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
        const userAgent = request.headers.get('User-Agent') || 'unknown';
        const sessionFingerprint = await generateSessionFingerprint(clientIP, userAgent);

        // Clean up old sessions before creating new one
        await cleanupUserSessions(env, userId, token);

        await env.DB.prepare(
            `INSERT INTO user_sessions (id, user_id, token, expires_at, client_ip, user_agent, fingerprint, last_activity) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        ).bind(sessionId, userId, token, expiresAt.toISOString(), clientIP, userAgent, sessionFingerprint).run();

            // **FIX:** Configure cookie properly for cross-origin requests
    const originUrl = request.headers.get('Origin') ? new URL(request.headers.get('Origin')) : null;
    let cookieString = `session_token=${token}; Expires=${expiresAt.toUTCString()}; Path=/; HttpOnly`;

    // Handle cross-origin cookie setting
    if (originUrl) {
        // For local development (localhost, 127.0.0.1, file://)
        if (originUrl.hostname === '127.0.0.1' || originUrl.hostname === 'localhost' || originUrl.protocol === 'file:') {
            // Don't set Domain for localhost to avoid issues
            cookieString += '; SameSite=None; Secure';
        } else if (originUrl.hostname.includes('workers.dev') || originUrl.hostname.includes('pages.dev')) {
            // For Cloudflare domains
            cookieString += '; SameSite=None; Secure';
        } else if (originUrl.hostname.includes('github.io')) {
            // For GitHub Pages
            cookieString += '; SameSite=None; Secure';
        } else {
            // For other production domains
            cookieString += '; SameSite=None; Secure';
        }
    } else {
        // Fallback for requests without Origin header
        cookieString += '; SameSite=None; Secure';
    }

        headers['Set-Cookie'] = cookieString;

        // Also include token in response for localStorage fallback
        const responseData = { 
            success: true, 
            user: { id: userId, name, email },
            token: token // Include token for localStorage storage
        };
        return jsonResponse(responseData, 201, headers);

    } catch (error) {
        console.error('Error during email signup:', error);
        return jsonResponse({ error: 'Signup failed.', details: error.message }, 500, headers);
    }
}

/**
 * Handles user login with email and password.
 */
async function handleEmailLogin(request, env) {
    // Validate request origin for security
    const origin = request.headers.get('Origin');
    if (!validateSiteOrigin(request)) {
        console.warn('Email login attempt from unauthorized origin:', origin || request.headers.get('Referer'));
        // Still set CORS headers even for unauthorized requests to prevent CORS errors
        const headers = getSecurityHeaders(origin);
        return jsonResponse({ error: 'Unauthorized origin' }, 403, headers);
    }

    const headers = getSecurityHeaders(origin);
    try {
        const { email, password } = await request.json();

        if (!email || !password) {
            return jsonResponse({ error: 'Email and password are required.' }, 400, headers);
        }

        const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
        if (!user || !user.password_hash) {
            return jsonResponse({ error: 'Invalid email or password.' }, 401, headers);
        }
        
        const passwordHash = await sha512(password);
        
        // Constant-time comparison to prevent timing attacks
        if (passwordHash.length !== user.password_hash.length) {
          return jsonResponse({ error: 'Invalid email or password.' }, 401, headers);
        }

        let diff = 0;
        for (let i = 0; i < passwordHash.length; i++) {
            diff |= passwordHash.charCodeAt(i) ^ user.password_hash.charCodeAt(i);
        }

        if (diff !== 0) {
            return jsonResponse({ error: 'Invalid email or password.' }, 401, headers);
        }

        const sessionId = crypto.randomUUID();
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        // Get client fingerprinting data for session security
        const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
        const userAgent = request.headers.get('User-Agent') || 'unknown';
        const sessionFingerprint = await generateSessionFingerprint(clientIP, userAgent);

        // Clean up old sessions before creating new one
        await cleanupUserSessions(env, user.id, token);

        await env.DB.prepare(
            `INSERT INTO user_sessions (id, user_id, token, expires_at, client_ip, user_agent, fingerprint, last_activity) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        ).bind(sessionId, user.id, token, expiresAt.toISOString(), clientIP, userAgent, sessionFingerprint).run();

            // **FIX:** Configure cookie properly for both local development and production
    const originUrl = request.headers.get('Origin') ? new URL(request.headers.get('Origin')) : null;
    let cookieString = `session_token=${token}; Expires=${expiresAt.toUTCString()}; Path=/; HttpOnly`;

    // Handle cross-origin cookie setting
    if (originUrl) {
        // For local development (localhost, 127.0.0.1, file://)
        if (originUrl.hostname === '127.0.0.1' || originUrl.hostname === 'localhost' || originUrl.protocol === 'file:') {
            // Don't set Domain for localhost to avoid issues
            cookieString += '; SameSite=None; Secure';
        } else if (originUrl.hostname.includes('workers.dev') || originUrl.hostname.includes('pages.dev')) {
            // For Cloudflare domains
            cookieString += '; SameSite=None; Secure';
        } else if (originUrl.hostname.includes('github.io')) {
            // For GitHub Pages
            cookieString += '; SameSite=None; Secure';
        } else {
            // For other production domains
            cookieString += '; SameSite=None; Secure';
        }
    } else {
        // Fallback for requests without Origin header
        cookieString += '; SameSite=None; Secure';
    }

        headers['Set-Cookie'] = cookieString;

        // **FIX:** Return a JSON response instead of a redirect
        // Also include token in response for localStorage fallback
        const responseData = {
            success: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                picture: user.picture
            },
            token: token // Include token for localStorage storage
        };
        return jsonResponse(responseData, 200, headers);

    } catch (error) {
        console.error('Error during email login:', error.message);
        return jsonResponse({ error: 'Login failed.', details: error.message }, 500, headers);
    }
}


// --- Password Hashing Utilities ---

/**
 * Hashes a string using SHA-512.
 * @param {string} str The string to hash.
 * @returns {Promise<string>} The hex-encoded hash.
 */
async function sha512(str) {
  const buffer = await crypto.subtle.digest(
    'SHA-512',
    new TextEncoder().encode(str)
  );
  const hashArray = Array.from(new Uint8Array(buffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

// --- Utility Functions ---

/**
 * Allowed origins for CORS - only these domains can make requests to the auth worker
 */
const ALLOWED_ORIGINS = [
    'https://fragrancecollect.com',
    'https://www.fragrancecollect.com',
    'https://fragrance-collect.pages.dev', // Cloudflare Pages preview
    'https://fragrance-collect.github.io', // GitHub Pages repo
    'https://heart.github.io', // GitHub Pages user domain
    'https://heart.github.io/Fragrance-Collect', // GitHub Pages project
    'https://heart.github.io/fragrance-collect', // GitHub Pages project (lowercase)
    'http://localhost:3000', // Local development
    'http://localhost:8080', // Local development
    'http://localhost:5000', // Local development
    'http://localhost:8000', // Local development
    'http://127.0.0.1:3000', // Local development
    'http://127.0.0.1:8080', // Local development
    'http://127.0.0.1:5000', // Local development
    'http://127.0.0.1:8000', // Local development
    'http://localhost:5500', // VS Code Live Server
    'http://localhost:4000', // Jekyll default
    'http://localhost:4001', // Alternative Jekyll
    'http://localhost:5173', // Vite dev server
    'http://localhost:5174', // Alternative Vite
    'http://localhost:3001', // React dev server alternative
    'http://localhost:8001', // Alternative development
    'http://127.0.0.1:5500', // VS Code Live Server
    'http://127.0.0.1:4000', // Jekyll default
    'http://127.0.0.1:5173', // Vite dev server
    'http://127.0.0.1:5174', // Alternative Vite
    'http://127.0.0.1:3001', // React dev server alternative
    'http://127.0.0.1:8001', // Alternative development
    'https://localhost:3000', // HTTPS localhost
    'https://localhost:8080', // HTTPS localhost
    'https://localhost:5000', // HTTPS localhost
    'https://localhost:8000', // HTTPS localhost
    'https://127.0.0.1:3000', // HTTPS localhost
    'https://127.0.0.1:8080', // HTTPS localhost
    'https://127.0.0.1:5000', // HTTPS localhost
    'https://127.0.0.1:8000', // HTTPS localhost
    'https://localhost:5500', // HTTPS VS Code Live Server
    'https://localhost:5173', // HTTPS Vite
    'https://localhost:5174', // HTTPS Alternative Vite
    'file://', // For local file testing
    null, // For direct navigation
    undefined // For direct navigation
];

/**
 * Validates if the origin is allowed to make requests
 */
function isOriginAllowed(origin) {
    if (!origin || origin === 'null' || origin === 'undefined') {
        console.log('No origin provided, allowing for direct navigation');
        return true; // Allow direct navigation
    }

    // Allow file:// protocol for local file testing
    if (origin.startsWith('file://')) {
        console.log('File protocol allowed for local testing:', origin);
        return true;
    }

    // Allow localhost and 127.0.0.1 with any port (HTTP and HTTPS)
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        console.log('Localhost/127.0.0.1 origin allowed:', origin);
        return true;
    }

    // Allow any GitHub Pages domain
    if (origin.includes('.github.io')) {
        console.log('GitHub Pages origin allowed:', origin);
        return true;
    }

    // Allow Cloudflare Pages domains
    if (origin.includes('.pages.dev')) {
        console.log('Cloudflare Pages origin allowed:', origin);
        return true;
    }

    // Allow common development ports on any localhost-like domain
    try {
        const url = new URL(origin);
        const commonDevPorts = ['3000', '3001', '4000', '4001', '5000', '5173', '5174', '5500', '8000', '8001', '8080'];
        if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.includes('localhost')) &&
            commonDevPorts.includes(url.port)) {
            console.log('Common dev port allowed:', origin);
            return true;
        }
    } catch (e) {
        // Invalid URL, continue with normal checks
    }

    // Check against allowed origins list
    const isAllowed = ALLOWED_ORIGINS.includes(origin);
    console.log('Origin check result:', origin, 'allowed:', isAllowed);
    return isAllowed;
}

/**
 * Validates the request origin and referrer for additional security
 */
function validateSiteOrigin(request) {
    const origin = request.headers.get('Origin');
    const referer = request.headers.get('Referer');
    
    // Log for debugging
    console.log('Origin validation - Origin:', origin, 'Referer:', referer);
    
    // For non-CORS requests, check referer
    if (!origin && referer) {
        try {
            const refererUrl = new URL(referer);
            const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
            console.log('Checking referer origin:', refererOrigin);
            return isOriginAllowed(refererOrigin);
        } catch (e) {
            console.log('Failed to parse referer:', e.message);
            return false;
        }
    }
    
    // For CORS requests, check origin
    if (origin) {
        console.log('Checking origin:', origin, 'Allowed:', isOriginAllowed(origin));
        return isOriginAllowed(origin);
    }
    
    // No origin or referer - allow for direct navigation
    console.log('No origin or referer - allowing for direct navigation');
    return true; // More permissive for now
}

/**
 * Creates a standard set of security headers for all responses.
 * @param {string} origin - The request's origin for CORS.
 * @returns {HeadersInit}
 */
function getSecurityHeaders(origin) {
    const csp = [
        "default-src 'self'",
        "script-src 'self' https://accounts.google.com 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://accounts.google.com https://fonts.googleapis.com https://cdnjs.cloudflare.com",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "img-src 'self' data: https: *.googleusercontent.com",
        "connect-src 'self' https://www.googleapis.com",
        "frame-src 'self' https://accounts.google.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ].join('; ');

    const headers = {
        'Content-Security-Policy': csp,
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    };

    // Determine allowed origin value
    let allowedOrigin = null;
    if (!origin || origin === 'null' || origin === 'undefined') {
        // Support file:// and other null-origin contexts
        allowedOrigin = 'null';
    } else if (isOriginAllowed(origin)) {
        allowedOrigin = origin;
    }

    if (allowedOrigin) {
        headers['Access-Control-Allow-Origin'] = allowedOrigin;
    } else if (origin) {
        console.log('Origin not allowed for CORS:', origin);
    }

    return headers;
}

/**
 * Decodes a JWT into its three parts without verifying the signature.
 */
function decodeJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT structure');
  }
  const header = JSON.parse(decodeBase64Url(parts[0]));
  const payload = JSON.parse(decodeBase64Url(parts[1]));
  const signature = base64UrlToArrayBuffer(parts[2]);
  
  return { header, payload, signature };
}

function decodeBase64Url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return atob(str);
}

function base64UrlToArrayBuffer(base64Url) {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

function handleOptions(request) {
  const origin = request.headers.get('Origin');
  const headers = getSecurityHeaders(origin);

  if (
    origin !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    // Proper CORS preflight request
    return new Response(null, { headers });
  } else {
    // Fallback for non-CORS preflight requests
    const fallbackHeaders = {
      ...headers,
      Allow: 'GET, POST, OPTIONS'
    };
    return new Response(null, { headers: fallbackHeaders });
  }
}

// --- SECURITY FUNCTIONS ---

/**
 * Generate a session fingerprint for additional security
 */
async function generateSessionFingerprint(clientIP, userAgent) {
    const data = `${clientIP}:${userAgent}:${Date.now()}`;
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate session security by checking IP and User-Agent
 */
function validateSessionSecurity(session, request) {
    const currentIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const currentUserAgent = request.headers.get('User-Agent') || 'unknown';
    
    // Allow some flexibility for mobile networks and proxy changes
    // But flag suspicious changes
    const ipChanged = session.client_ip && session.client_ip !== currentIP;
    const userAgentChanged = session.user_agent && session.user_agent !== currentUserAgent;
    
    // If both IP and User-Agent changed, it's likely session hijacking
    if (ipChanged && userAgentChanged) {
        console.warn(`Suspicious session activity: IP changed from ${session.client_ip} to ${currentIP}, UA changed`);
        return false;
    }
    
    return true;
}

/**
 * Clean up expired and old sessions for a user (prevent session accumulation)
 */
async function cleanupUserSessions(env, userId, keepCurrentToken = null) {
    // Keep only the 3 most recent sessions per user, plus the current one
    const query = `
        DELETE FROM user_sessions 
        WHERE user_id = ? 
        AND token != COALESCE(?, '') 
        AND (expires_at < CURRENT_TIMESTAMP 
             OR id NOT IN (
                 SELECT id FROM user_sessions 
                 WHERE user_id = ? 
                 ORDER BY last_activity DESC 
                 LIMIT 3
             ))
    `;
    
    await env.DB.prepare(query).bind(userId, keepCurrentToken, userId).run();
}

function jsonResponse(data, status = 200, headers = {}) {
  const finalHeaders = {
      ...headers,
      'Content-Type': 'application/json'
  };
  return new Response(JSON.stringify(data), { status, headers: finalHeaders });
}
