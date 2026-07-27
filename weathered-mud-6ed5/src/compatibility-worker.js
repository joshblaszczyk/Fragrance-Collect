import hardenedWorker from './integrated-worker.js';
import { getSecurityHeaders, isOriginAllowed } from './http-security.js';

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;
const LEGACY_HEADER = 'Authorization';
const PRODUCTION_SITE_ORIGIN = 'https://fragrancecollect.com';
const PRODUCTION_API_ORIGIN = 'https://weathered-mud-6ed5.joshuablaszczyk.workers.dev';
const BRIDGE_HARD_STOP_MS = Date.parse('2026-07-27T12:00:00Z');

function bridgeIsActive(request, env) {
  const expiresAt = Date.parse(String(env.LEGACY_BROWSER_AUTH_BRIDGE_UNTIL || ''));
  if (!Number.isFinite(expiresAt) || expiresAt > BRIDGE_HARD_STOP_MS || Date.now() >= expiresAt) return false;
  try {
    return new URL(request.url).origin === PRODUCTION_API_ORIGIN
      && request.headers.get('Origin') === PRODUCTION_SITE_ORIGIN
      && isOriginAllowed(PRODUCTION_SITE_ORIGIN, env.ALLOWED_ORIGIN || '');
  } catch {
    return false;
  }
}

function bridgeOriginIsAllowed(request, env) {
  return bridgeIsActive(request, env);
}

function isLegacyBearerPath(path) {
  return path === '/api/token'
    || path === '/api/status'
    || path === '/api/logout'
    || path.startsWith('/api/user/');
}

function bridgeHeaders(request, env, sourceHeaders = null) {
  const headers = new Headers(getSecurityHeaders(
    request.headers.get('Origin'),
    env.ALLOWED_ORIGIN || ''
  ));
  if (sourceHeaders) {
    const overlay = new Headers(sourceHeaders);
    overlay.forEach((value, name) => {
      if (name.toLowerCase() !== 'set-cookie') headers.set(name, value);
    });
    for (const cookie of responseCookies(overlay)) headers.append('Set-Cookie', cookie);
  }
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, Authorization');
  headers.set('Access-Control-Max-Age', '300');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Fragrance-Release-Bridge', 'active');
  return headers;
}

function readCookieToken(request) {
  const cookie = String(request.headers.get('Cookie') || '');
  const encoded = cookie.split(';').map((part) => part.trim()).find((part) => (
    part.startsWith('__Host-fragrance_session=')
  ))?.slice('__Host-fragrance_session='.length);
  if (!encoded) return null;
  try {
    const token = decodeURIComponent(encoded);
    return SESSION_TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
}

function readBearerToken(request) {
  const authorization = String(request.headers.get(LEGACY_HEADER) || '');
  const match = authorization.match(/^Bearer\s+([A-Za-z0-9_-]{40,100})$/i);
  return match?.[1] || null;
}

function requestWithBearerCookie(request, token) {
  const headers = new Headers(request.headers);
  headers.delete(LEGACY_HEADER);
  const preservedCookies = String(headers.get('Cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith('__Host-fragrance_session='));
  preservedCookies.push(`__Host-fragrance_session=${encodeURIComponent(token)}`);
  headers.set('Cookie', preservedCookies.join('; '));
  return new Request(request, { headers });
}

function responseCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = headers.get('Set-Cookie');
  return combined ? [combined] : [];
}

function copyResponseHeaders(response) {
  const headers = new Headers();
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'set-cookie') headers.append(name, value);
  });
  for (const cookie of responseCookies(response.headers)) headers.append('Set-Cookie', cookie);
  return headers;
}

function tokenFromSessionCookie(response) {
  for (const cookie of responseCookies(response.headers)) {
    const match = cookie.match(/(?:^|,\s*)__Host-fragrance_session=([^;,\s]+)/);
    if (!match) continue;
    try {
      const token = decodeURIComponent(match[1]);
      if (SESSION_TOKEN_PATTERN.test(token)) return token;
    } catch {
      // Ignore malformed response cookies and keep the hardened response.
    }
  }
  return null;
}

function legacyPreflight(request, env) {
  const requestedMethod = String(request.headers.get('Access-Control-Request-Method') || '').toUpperCase();
  const requestedHeaders = String(request.headers.get('Access-Control-Request-Headers') || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!bridgeOriginIsAllowed(request, env)) {
    return new Response(null, { status: 403, headers: getSecurityHeaders(null, env.ALLOWED_ORIGIN || '') });
  }
  if (!['GET', 'POST', 'DELETE'].includes(requestedMethod)) {
    return new Response(null, { status: 405, headers: bridgeHeaders(request, env) });
  }
  if (requestedHeaders.some((value) => !['authorization', 'content-type', 'x-csrf-token'].includes(value))) {
    return new Response(null, { status: 403, headers: bridgeHeaders(request, env) });
  }
  return new Response(null, { status: 204, headers: bridgeHeaders(request, env) });
}

async function legacyTokenResponse(request, env, ctx) {
  const token = readCookieToken(request);
  if (!token) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: bridgeHeaders(request, env, { 'Content-Type': 'application/json' })
    });
  }

  const statusUrl = new URL(request.url);
  statusUrl.pathname = '/api/status';
  statusUrl.search = '';
  const statusResponse = await hardenedWorker.fetch(new Request(statusUrl, {
    method: 'GET',
    headers: request.headers
  }), env, ctx);
  if (!statusResponse.ok) return statusResponse;

  const headers = bridgeHeaders(request, env, copyResponseHeaders(statusResponse));
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify({ success: true, token }), { status: 200, headers });
}

async function addLegacyLoginToken(request, env, response) {
  if (!response.ok || !bridgeOriginIsAllowed(request, env)) return response;
  const token = tokenFromSessionCookie(response);
  if (!token) return response;

  const body = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') return response;
  const headers = bridgeHeaders(request, env, copyResponseHeaders(response));
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify({ ...body, token }), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    if (!bridgeIsActive(request, env)) return hardenedWorker.fetch(request, env, ctx);

    const url = new URL(request.url);
    const requestedHeaders = String(request.headers.get('Access-Control-Request-Headers') || '').toLowerCase();
    if (request.method === 'OPTIONS' && requestedHeaders.split(',').some((value) => value.trim() === 'authorization')) {
      if (!isLegacyBearerPath(url.pathname)) {
        return new Response(null, { status: 403, headers: getSecurityHeaders(null, env.ALLOWED_ORIGIN || '') });
      }
      return legacyPreflight(request, env);
    }

    if (url.pathname === '/api/token' && request.method === 'GET') {
      if (!bridgeOriginIsAllowed(request, env)) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: getSecurityHeaders(null, env.ALLOWED_ORIGIN || '')
        });
      }
      return legacyTokenResponse(request, env, ctx);
    }

    const bearerToken = !readCookieToken(request)
      && isLegacyBearerPath(url.pathname)
      && bridgeOriginIsAllowed(request, env)
      ? readBearerToken(request)
      : null;
    const forwardedRequest = bearerToken ? requestWithBearerCookie(request, bearerToken) : request;
    const response = await hardenedWorker.fetch(forwardedRequest, env, ctx);

    if (['/api/login/email', '/api/login/google'].includes(url.pathname) && request.method === 'POST') {
      return addLegacyLoginToken(request, env, response);
    }
    return response;
  },

  scheduled(controller, env, ctx) {
    return hardenedWorker.scheduled(controller, env, ctx);
  }
};
