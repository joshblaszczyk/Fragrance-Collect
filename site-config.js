(() => {
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const isLocal = localHosts.has(window.location.hostname);
  const deployedSiteHosts = new Set(['fragrancecollect.com', 'www.fragrancecollect.com']);
  const deployedApiOrigin = 'https://weathered-mud-6ed5.joshuablaszczyk.workers.dev';
  // Retire the browser-readable bearer token used by the legacy Pages build.
  // Authentication is cookie-only; leaving the obsolete value behind would
  // unnecessarily preserve a historical credential on upgraded browsers.
  try {
    window.localStorage.removeItem('session_token');
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
  if (window.location.protocol !== 'https:' && !isLocal) {
    window.location.replace(`https:${window.location.href.substring(window.location.protocol.length)}`);
    return;
  }
  const initialParameters = new URLSearchParams(window.location.search);
  const initialHash = window.location.hash;
  const hashBody = initialHash.startsWith('#?')
    ? initialHash.slice(2)
    : initialHash.slice(1);
  const fragmentParameters = new URLSearchParams(hashBody);
  const fragmentContainsCredential = ['reset_token', 'verify_token']
    .some((name) => fragmentParameters.has(name));

  // Authentication links carry one-time credentials. Capture them before any
  // third-party script can observe the address bar, then remove them from the
  // URL, browser history, copied links, and referrer data. The auth page can
  // consume each value once without persisting it in web storage.
  const oneTimeCredentials = new Map();
  ['reset_token', 'verify_token'].forEach((name) => {
    const value = fragmentContainsCredential
      ? fragmentParameters.get(name) || initialParameters.get(name)
      : initialParameters.get(name);
    if (value) oneTimeCredentials.set(name, value);
    initialParameters.delete(name);
    if (fragmentContainsCredential) fragmentParameters.delete(name);
  });
  if (oneTimeCredentials.size || fragmentContainsCredential) {
    const safeSearch = initialParameters.toString();
    const remainingFragment = fragmentContainsCredential ? fragmentParameters.toString() : '';
    const safeHash = fragmentContainsCredential
      ? (remainingFragment ? `#${initialHash.startsWith('#?') ? '?' : ''}${remainingFragment}` : '')
      : initialHash;
    const safeUrl = `${window.location.pathname}${safeSearch ? `?${safeSearch}` : ''}${safeHash}`;
    window.history.replaceState(window.history.state, '', safeUrl);
  }
  // Only the first-party auth module may receive a one-time credential. Other
  // pages still strip token-shaped URLs, but do not expose a global reader to
  // their own integrations (including Google Identity on Account Settings).
  const isAuthPage = /^\/auth(?:\.html)?\/$/i.test(`${window.location.pathname}/`);
  if (isAuthPage && oneTimeCredentials.size > 0) {
    Object.defineProperty(window, 'consumeFragranceAuthCredential', {
      configurable: true,
      enumerable: false,
      writable: false,
      value(name) {
        const value = oneTimeCredentials.get(name) || '';
        oneTimeCredentials.delete(name);
        return value;
      }
    });
  }

  // GitHub Pages serves the production frontend while the Cloudflare Worker
  // owns API routes. Local development continues to use the current origin so
  // Wrangler can serve the site and API together without a remote dependency.
  const apiOrigin = deployedSiteHosts.has(window.location.hostname)
    ? deployedApiOrigin
    : window.location.origin;
  window.API_BASE = apiOrigin;
  window.CATALOG_API_BASE = apiOrigin;
  window.FRAGRANCE_RUNTIME = Object.freeze({
    localSite: isLocal,
    apiChannel: isLocal ? 'local-current' : 'deployed',
    catalogChannel: isLocal ? 'local-current' : 'deployed'
  });

  function waitForIdle() {
    return new Promise((resolve) => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(resolve, { timeout: 1200 });
      } else {
        window.setTimeout(resolve, 300);
      }
    });
  }

  async function hydrateHeroSlide(slide) {
    if (slide.dataset.heroLoaded === 'true') return true;
    if (slide.dataset.heroFailed === 'true') return false;

    const image = slide.querySelector('img');
    if (!image) return false;
    slide.querySelectorAll('source[data-srcset]').forEach((source) => {
      source.srcset = source.dataset.srcset;
      delete source.dataset.srcset;
    });
    if (image.dataset.src) {
      image.loading = 'eager';
      image.src = image.dataset.src;
      delete image.dataset.src;
    }

    const loaded = await new Promise((resolve) => {
      const finish = (success) => {
        image.removeEventListener('load', handleLoad);
        image.removeEventListener('error', handleError);
        resolve(success);
      };
      const handleLoad = () => finish(true);
      const handleError = () => finish(false);

      if (image.complete) {
        finish(image.naturalWidth > 0);
        return;
      }
      image.addEventListener('load', handleLoad, { once: true });
      image.addEventListener('error', handleError, { once: true });
    });

    if (!loaded) {
      slide.dataset.heroFailed = 'true';
      return false;
    }
    try {
      await image.decode();
    } catch {
      // A completed image can still reject decode() in older browsers. It is
      // safe to display when naturalWidth confirms the resource is available.
    }
    slide.dataset.heroLoaded = 'true';
    return image.naturalWidth > 0;
  }

  async function initializeHeroSlideshow() {
    const slideshow = document.querySelector('.hero-slideshow');
    const slides = [...document.querySelectorAll('[data-hero-slide]')];
    if (!slideshow || slides.length < 1) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    slides.forEach((slide, index) => slide.classList.toggle('is-active', index === 0));
    await hydrateHeroSlide(slides[0]);
    if (reducedMotion || slides.length < 2) return;

    // Protect the first paint: secondary artwork is not requested by the HTML
    // parser. Warm and decode it only after the browser has an idle window, then
    // start the timeline once every crossfade target is guaranteed ready.
    await waitForIdle();
    for (const slide of slides.slice(1)) {
      if (!(await hydrateHeroSlide(slide))) return;
    }
    if (!slideshow.isConnected) return;

    slideshow.classList.add('is-playing');
    // The static first frame is already visible while assets warm. Start the
    // CSS timeline at its fully visible point to avoid a one-frame black flash.
    slides.forEach((slide) => {
      slide.getAnimations?.().forEach((animation) => {
        animation.currentTime = 1200;
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeHeroSlideshow, { once: true });
  } else {
    initializeHeroSlideshow();
  }
})();
