const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseConfiguredOrigins(configuredOrigins = '') {
  const trustedOrigins = new Set();
  for (const value of String(configuredOrigins).split(',')) {
    const candidate = value.trim();
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'https:' && parsed.pathname === '/' && !parsed.search && !parsed.hash
        && !parsed.username && !parsed.password) {
        trustedOrigins.add(parsed.origin);
      }
    } catch {
      // Invalid configuration is ignored instead of widening browser access.
    }
  }
  return trustedOrigins;
}

export function isOriginAllowed(origin, configuredOrigins = '', options = {}) {
  if (!origin || origin === 'null') return false;

  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash
      || parsedOrigin.username || parsedOrigin.password) return false;
    if (parseConfiguredOrigins(configuredOrigins).has(parsedOrigin.origin)) return true;

    return options.allowLocalOrigins === true
      && parsedOrigin.protocol === 'http:'
      && LOCAL_HOSTNAMES.has(parsedOrigin.hostname);
  } catch {
    return false;
  }
}

export function getSecurityHeaders(origin, configuredOrigins = '', options = {}) {
  const headers = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };

  if (isOriginAllowed(origin, configuredOrigins, options)) {
    headers['Access-Control-Allow-Origin'] = new URL(origin).origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export function createSessionCookie(token, maxAgeSeconds, options = {}) {
  const encodedToken = encodeURIComponent(token);
  const sameSite = ['Lax', 'Strict', 'None'].includes(options.sameSite) ? options.sameSite : 'Lax';
  return `__Host-fragrance_session=${encodedToken}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=${sameSite}; Secure`;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}
