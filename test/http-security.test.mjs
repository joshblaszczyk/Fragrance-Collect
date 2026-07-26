import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSessionCookie,
  escapeHtml,
  getSecurityHeaders,
  isOriginAllowed
} from '../weathered-mud-6ed5/src/http-security.js';

test('allows only exact production origins supplied by configuration', () => {
  const configured = 'https://fragrancecollect.com,https://www.fragrancecollect.com';
  assert.equal(isOriginAllowed('https://fragrancecollect.com', configured), true);
  assert.equal(isOriginAllowed('https://www.fragrancecollect.com', configured), true);
  assert.equal(isOriginAllowed('https://fragrancecollect.com'), false);
});

test('rejects prefix attacks, opaque origins, and malformed origins', () => {
  assert.equal(isOriginAllowed('https://fragrancecollect.com.attacker.example'), false);
  assert.equal(isOriginAllowed('null'), false);
  assert.equal(isOriginAllowed(undefined), false);
  assert.equal(isOriginAllowed('not a url'), false);
});

test('allows HTTP loopback development origins only with the explicit local opt-in', () => {
  const local = { allowLocalOrigins: true };
  assert.equal(isOriginAllowed('http://localhost:3000'), false);
  assert.equal(isOriginAllowed('http://localhost:3000', '', local), true);
  assert.equal(isOriginAllowed('http://127.0.0.1:8787', '', local), true);
  assert.equal(isOriginAllowed('http://localhost.attacker.example:3000', '', local), false);
});

test('accepts only exact HTTPS origins from environment configuration', () => {
  const configured = 'https://staging.fragrancecollect.com, https://preview.example';
  assert.equal(isOriginAllowed('https://staging.fragrancecollect.com', configured), true);
  assert.equal(isOriginAllowed('https://preview.example', configured), true);
  assert.equal(isOriginAllowed('https://preview.example.attacker.test', configured), false);
  assert.equal(isOriginAllowed('http://preview.example', configured), false);
  assert.equal(isOriginAllowed('https://ignored.example', 'not-a-url'), false);
});

test('only emits credentialed CORS headers for trusted origins', () => {
  const configured = 'https://fragrancecollect.com';
  const allowed = getSecurityHeaders('https://fragrancecollect.com', configured);
  const rejected = getSecurityHeaders('https://fragrancecollect.com.attacker.example', configured);

  assert.equal(allowed['Access-Control-Allow-Origin'], 'https://fragrancecollect.com');
  assert.equal(allowed['Access-Control-Allow-Credentials'], 'true');
  assert.equal(rejected['Access-Control-Allow-Origin'], undefined);
  assert.equal(rejected['Access-Control-Allow-Credentials'], undefined);
});

test('creates a host-only HttpOnly session cookie using seconds', () => {
  const cookie = createSessionCookie('secret token', 86400);

  assert.match(cookie, /^__Host-fragrance_session=secret%20token;/);
  assert.match(cookie, /Max-Age=86400/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.doesNotMatch(cookie, /Partitioned/);
});

test('creates a CHIPS cookie for the cross-site GitHub Pages session', () => {
  const cookie = createSessionCookie('cross-site token', 86400, { partitioned: true });

  assert.match(cookie, /^__Host-fragrance_session=cross-site%20token;/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=None/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Partitioned/);
  assert.doesNotMatch(cookie, /Domain=/);
});

test('escapes contact content before inserting it into HTML email', () => {
  assert.equal(
    escapeHtml(`<a href="https://evil.example">Tom & Jerry's</a>`),
    '&lt;a href=&quot;https://evil.example&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;'
  );
});
