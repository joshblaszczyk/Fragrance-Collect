import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const DEPLOYED_API_ORIGIN = 'https://weathered-mud-6ed5.joshuablaszczyk.workers.dev';

async function runSiteConfig(location) {
  const source = await read('site-config.js');
  const replaced = [];
  const domReadyListeners = [];
  const storage = new Map([['session_token', 'obsolete-browser-token']]);
  const localStorage = {
    getItem(name) {
      return storage.has(name) ? storage.get(name) : null;
    },
    removeItem(name) {
      storage.delete(name);
    },
    setItem(name, value) {
      storage.set(name, String(value));
    }
  };
  const window = {
    location: { ...location },
    history: {
      state: { marker: true },
      replaceState(state, _title, url) {
        this.state = state;
        replaced.push(url);
      }
    },
    localStorage,
    matchMedia: () => ({ matches: true }),
    setTimeout,
    clearTimeout
  };
  const document = {
    readyState: 'loading',
    addEventListener(name, listener) {
      domReadyListeners.push({ name, listener });
    },
    querySelector: () => null,
    querySelectorAll: () => []
  };
  vm.runInNewContext(source, {
    window,
    document,
    localStorage,
    URLSearchParams,
    Promise,
    performance
  });
  return { window, replaced, domReadyListeners };
}

test('GitHub Pages runtime uses the exact deployed Worker and removes one-time credentials', async () => {
  const { window, replaced } = await runSiteConfig({
    hostname: 'fragrancecollect.com',
    protocol: 'https:',
    origin: 'https://fragrancecollect.com',
    pathname: '/auth.html',
    search: '?tab=signin&reset_token=reset-secret&verify_token=verify-secret',
    hash: '#account'
  });

  assert.equal(window.API_BASE, DEPLOYED_API_ORIGIN);
  assert.equal(window.CATALOG_API_BASE, DEPLOYED_API_ORIGIN);
  assert.equal(window.localStorage.getItem('session_token'), null);
  assert.deepEqual(replaced, ['/auth.html?tab=signin#account']);
  assert.equal(Object.getOwnPropertyDescriptor(window, 'consumeFragranceAuthCredential')?.configurable, true);
  assert.equal(window.consumeFragranceAuthCredential('reset_token'), 'reset-secret');
  assert.equal(window.consumeFragranceAuthCredential('reset_token'), '');
  assert.equal(window.consumeFragranceAuthCredential('verify_token'), 'verify-secret');
  assert.equal(Reflect.deleteProperty(window, 'consumeFragranceAuthCredential'), true);
  assert.equal(window.consumeFragranceAuthCredential, undefined);
});

test('runtime does not build a client redirect from the current browser URL', async () => {
  const runtime = await read('site-config.js');
  assert.doesNotMatch(runtime, /window\.location\.replace\s*\(/);
});

test('localhost uses the unified Wrangler origin without a cross-origin escape hatch', async () => {
  const { window, replaced } = await runSiteConfig({
    hostname: 'localhost',
    protocol: 'http:',
    origin: 'http://localhost:8787',
    pathname: '/',
    search: '?api=deployed&catalog=deployed',
    hash: ''
  });
  assert.equal(window.API_BASE, 'http://localhost:8787');
  assert.equal(window.CATALOG_API_BASE, 'http://localhost:8787');
  assert.deepEqual(replaced, []);
});

test('fragment credentials are captured once and scrubbed without rewriting unrelated anchors', async () => {
  const fragmentResult = await runSiteConfig({
    hostname: 'fragrancecollect.com',
    protocol: 'https:',
    origin: 'https://fragrancecollect.com',
    pathname: '/auth.html',
    search: '?tab=signin&reset_token=legacy-reset',
    hash: '#verify_token=fragment-verify&section=security'
  });
  assert.deepEqual(fragmentResult.replaced, ['/auth.html?tab=signin#section=security']);
  assert.equal(fragmentResult.window.consumeFragranceAuthCredential('verify_token'), 'fragment-verify');
  assert.equal(fragmentResult.window.consumeFragranceAuthCredential('reset_token'), 'legacy-reset');

  const anchorResult = await runSiteConfig({
    hostname: 'fragrancecollect.com',
    protocol: 'https:',
    origin: 'https://fragrancecollect.com',
    pathname: '/account.html',
    search: '',
    hash: '#privacy'
  });
  assert.deepEqual(anchorResult.replaced, []);
});

test('non-auth pages scrub credential-shaped URLs without exposing a global reader', async () => {
  const { window, replaced } = await runSiteConfig({
    hostname: 'fragrancecollect.com',
    protocol: 'https:',
    origin: 'https://fragrancecollect.com',
    pathname: '/account.html',
    search: '?reset_token=should-not-be-readable&tab=profile',
    hash: '#verify_token=also-not-readable&security'
  });
  assert.deepEqual(replaced, ['/account.html?tab=profile#security=']);
  assert.equal(window.consumeFragranceAuthCredential, undefined);
});

test('auth flow strips secrets early and implements verification lifecycle', async () => {
  const [html, script] = await Promise.all([read('auth.html'), read('auth-script.js')]);
  const referrerIndex = html.indexOf('<meta name="referrer" content="strict-origin-when-cross-origin">');
  assert.ok(referrerIndex >= 0);
  assert.doesNotMatch(html, /<script\b[^>]+accounts\.google\.com\/gsi\/client/);
  assert.match(html, /<script type="module" src="auth-script\.js"><\/script>/);
  assert.match(script, /resetToken = consumeCredential\('reset_token'\)/);
  assert.match(script, /verifyToken = consumeCredential\('verify_token'\)/);
  assert.match(script, /delete window\.consumeFragranceAuthCredential/);
  assert.match(script, /authCredentialHandoffCleared/);
  assert.match(script, /if \(!authCredentialHandoffCleared\)/);
  assert.match(script, /function loadGoogleIdentityScript\(\)/);
  assert.match(script, /script\.referrerPolicy = 'strict-origin-when-cross-origin'/);
  assert.match(script, /loadGoogleIdentityScript\(\)\s*\.then/);
  assert.match(script, /if \(resetToken \|\| verifyToken\) return/);
  assert.match(script, /\/api\/signup\/verify/);
  assert.match(script, /\/api\/signup\/verification\/resend/);
  assert.match(script, /pendingVerification/);
  assert.match(script, /account_link_required/);
  assert.match(script, /legacy_verification_required/);
  assert.match(script, /identityLinkRequired/);
  assert.match(html, /id="success-modal-secondary"/);
  assert.match(html, /id="password-reset-start-over"/);
  assert.match(script, /function setResetStatus\(/);
  assert.match(script, /rememberPendingGoogleLink\(error\.recoveryEmail\)/);
  assert.match(script, /intent\.email === normalizedEmail/);
});

test('Google Identity pages disclose only the origin while other pages retain no-referrer', async () => {
  const rootEntries = await readdir(new URL('..', import.meta.url));
  const htmlFiles = rootEntries.filter((file) => file.endsWith('.html'));
  for (const file of htmlFiles) {
    const html = await read(file);
    const expected = ['auth.html', 'account.html'].includes(file)
      ? 'strict-origin-when-cross-origin'
      : 'no-referrer';
    assert.match(html, new RegExp(`<meta name="referrer" content="${expected}">`), file);
  }
  const account = await read('account.html');
  assert.match(
    account,
    /<script[^>]+accounts\.google\.com\/gsi\/client[^>]+referrerpolicy="strict-origin-when-cross-origin"/
  );
});

test('auth outcomes use compact dark dialogs with explicit recovery actions', async () => {
  const [html, css, sharedCss, script] = await Promise.all([
    read('auth.html'), read('auth-styles.css'), read('styles.css'), read('auth-script.js')
  ]);
  assert.match(css, /\.success-modal\s*\{[\s\S]*?width:\s*min\(calc\(100% - 32px\), 620px\)/);
  assert.doesNotMatch(css, /\.success-modal\s*\{[^}]*height:\s*100%/s);
  assert.match(css, /\.success-modal\[data-tone="notice"\]/);
  assert.match(html, /id="success-modal-close"/);
  assert.match(script, /secondaryAction:\s*'reset'/);
  assert.match(script, /error\.status = response\.status/);
  assert.match(script, /if the link is no longer valid, request a new one/);
  assert.match(script, /resetStatus\.scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.match(sharedCss, /\.auth-dialog\s*\{[^}]*margin:\s*auto/s);
});

test('API-capable pages allow only the exact deployed Worker in connect-src', async () => {
  const apiPages = [
    'main.html',
    'auth.html',
    'account.html',
    'admin.html',
    'contact.html',
    'customer-service.html',
    'faq.html',
    'privacy-policy.html',
    'size-guide.html',
    'terms-of-service.html'
  ];
  for (const file of apiPages) {
    const html = await read(file);
    const csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1] || '';
    const connectSrc = csp.match(/(?:^|;)\s*connect-src\s+([^;]+)/i)?.[1] || '';
    assert.match(connectSrc, new RegExp(`(?:^|\\s)${DEPLOYED_API_ORIGIN.replaceAll('.', '\\.')}(?:\\s|$)`), file);
    assert.doesNotMatch(connectSrc, /https:\/\/\*\.workers\.dev/i, file);
    const workerOrigins = [...new Set(connectSrc.match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev/gi) || [])];
    assert.deepEqual(workerOrigins, [DEPLOYED_API_ORIGIN], file);
    assert.doesNotMatch(html, /upgrade-insecure-requests/, file);
  }
});

test('versioned third-party icon styles carry subresource integrity metadata', async () => {
  const rootEntries = await readdir(new URL('..', import.meta.url));
  const htmlFiles = rootEntries.filter((file) => file.endsWith('.html'));
  let protectedStylesheets = 0;
  for (const file of htmlFiles) {
    const html = await read(file);
    for (const [tag] of html.matchAll(/<link\b[^>]*href="https:\/\/cdnjs\.cloudflare\.com\/[^>]+>/g)) {
      protectedStylesheets += 1;
      assert.match(tag, /integrity="sha384-[A-Za-z0-9+/=]+"/, file);
      assert.match(tag, /crossorigin="anonymous"/, file);
      assert.match(tag, /referrerpolicy="no-referrer"/, file);
    }
  }
  assert.ok(protectedStylesheets >= 9);
});

test('Worker preview response policy prevents framing and avoids caching account pages', async () => {
  const [headers, build] = await Promise.all([read('_headers'), read('scripts/build-site.mjs')]);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /Cross-Origin-Opener-Policy: same-origin-allow-popups/);
  assert.match(headers, /\/auth\.html[\s\S]*?Cache-Control: private, no-store/);
  assert.match(headers, /\/account\.html[\s\S]*?Cache-Control: private, no-store/);
  assert.doesNotMatch(headers, /preload/i);
  assert.doesNotMatch(headers, /upgrade-insecure-requests/);
  assert.match(build, /'_headers'/);
});

test('hero loads one responsive image first and defers decoded crossfade assets', async () => {
  const [html, css, runtime] = await Promise.all([
    read('main.html'),
    read('styles.css'),
    read('site-config.js')
  ]);
  assert.equal((html.match(/data-hero-slide/g) || []).length, 4);
  assert.equal((html.match(/<img data-src="assets\/images\/(?:tom-ford|dior|chanel)-hero-desktop\.webp"/g) || []).length, 3);
  assert.match(html, /creed-hero-desktop\.avif/);
  assert.match(html, /tom-ford-hero-desktop\.avif/);
  assert.doesNotMatch(css, /\.slide-(?:creed|tom-ford|dior|chanel)\s*\{\s*background-image/);
  assert.match(css, /\.slide\.is-active/);
  assert.match(runtime, /await image\.decode\(\)/);
  assert.match(runtime, /await waitForIdle\(\)/);
  assert.match(runtime, /slideshow\.classList\.add\('is-playing'\)/);
  assert.match(css, /animation: fadeSlideshow 24s/);

  const imageDirectory = new URL('../assets/images/', import.meta.url);
  const desktopAvif = (await readdir(imageDirectory)).filter((file) => file.endsWith('-hero-desktop.avif'));
  assert.equal(desktopAvif.length, 4);
  const totalBytes = (await Promise.all(desktopAvif.map((file) => stat(new URL(file, imageDirectory)))))
    .reduce((sum, metadata) => sum + metadata.size, 0);
  assert.ok(totalBytes < 200_000, `desktop AVIF set is ${totalBytes} bytes`);
});

test('account deletion and provider password setup require fresh identity proof', async () => {
  const [html, script] = await Promise.all([read('account.html'), read('account.js')]);
  assert.doesNotMatch(html, /mailto:[^"']*deletion/i);
  assert.match(html, /id="account-deletion-dialog"/);
  assert.match(html, /Type <strong>DELETE<\/strong>/);
  assert.match(script, /method: 'DELETE'/);
  assert.match(script, /\/api\/user\/account/);
  assert.match(script, /google_reauthentication_required/);
  assert.match(script, /currentPassword/);
  assert.match(script, /googleCredential/);
  assert.match(script, /\/api\/user\/password/);
  assert.match(script, /\/api\/user\/identities\/google/);
  assert.match(script, /id="google-link-current-password"/);
  assert.match(script, /hasGoogleIdentity/);
  assert.match(script, /await refreshUserStatus\(\)/);
  assert.doesNotMatch(
    `${html}\n${script}`,
    /<div[^>]+id="(?:google-link-button|password-setup-google-button|account-deletion-google-button)"[^>]+aria-label=/,
    'Generic Google button hosts must not carry prohibited ARIA labels.'
  );
  assert.doesNotMatch(script, /handlePasswordSetup[\s\S]{0,1200}\/api\/password\/forgot/);
});
