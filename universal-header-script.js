const SELECTORS = {
    focusable: 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    loggedIn: '.logged-in-only',
    loggedOut: '.logged-out-only'
};

const SUPPORT_PATHS = new Set([
    '/customer-service.html',
    '/contact.html',
    '/size-guide.html',
    '/faq.html',
    '/terms-of-service.html',
    '/privacy-policy.html'
]);

function preparePrimaryNavigation() {
    const menuButton = document.querySelector('.menu-dropdown .menu-link');

    document.querySelectorAll('.main-nav .nav-link').forEach((link) => {
        let label = link.querySelector('.nav-link-label');
        if (!label) {
            const textNodes = [...link.childNodes]
                .filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            const text = textNodes.map((node) => node.textContent.trim()).join(' ');
            label = document.createElement('span');
            label.className = 'nav-link-label';
            label.textContent = text;
            textNodes.forEach((node) => node.remove());
            link.insertBefore(label, link.firstChild);
        }

        if (link === menuButton) label.textContent = 'Support';
    });

    if (menuButton) {
        menuButton.setAttribute('aria-label', 'Open support and site navigation');
    }

    const mobileContent = document.querySelector('.mobile-nav-content');
    const supportSection = [...document.querySelectorAll('.mobile-nav-section')]
        .find((section) => section.querySelector('h4')?.textContent.trim() === 'Customer Service');
    if (mobileContent && supportSection) {
        const firstSection = mobileContent.querySelector('.mobile-nav-section');
        supportSection.querySelector('h4').textContent = 'Support & information';
        if (firstSection !== supportSection) mobileContent.insertBefore(supportSection, firstSection);
    }
}

function setAuthVisibility() {
    const loggedIn = document.body.classList.contains('user-logged-in');
    document.querySelectorAll(SELECTORS.loggedIn).forEach((element) => {
        element.hidden = !loggedIn;
    });
    document.querySelectorAll(SELECTORS.loggedOut).forEach((element) => {
        element.hidden = loggedIn;
    });
}

function initializeCarousel() {
    const carousel = document.querySelector('.image-carousel');
    const images = [...document.querySelectorAll('.promo-image')];
    const indicators = [...document.querySelectorAll('.indicator')];
    if (!carousel || images.length < 2 || indicators.length !== images.length) return;

    const carouselRegion = carousel.closest('.mega-menu-image');
    carouselRegion?.setAttribute('aria-hidden', 'true');

    let activeIndex = 0;
    let intervalId;
    let mediaReady = false;
    let mediaHydration;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function show(index) {
        activeIndex = index;
        images.forEach((image, imageIndex) => {
            image.classList.toggle('active', imageIndex === index);
            image.setAttribute('aria-hidden', String(imageIndex !== index));
        });
        indicators.forEach((indicator, indicatorIndex) => {
            const selected = indicatorIndex === index;
            indicator.classList.toggle('active', selected);
            if (carouselRegion) indicator.removeAttribute('aria-pressed');
            else indicator.setAttribute('aria-pressed', String(selected));
        });
    }

    function stop() {
        window.clearInterval(intervalId);
    }

    function start() {
        stop();
        if (mediaReady && !reducedMotion && !document.hidden) {
            intervalId = window.setInterval(() => show((activeIndex + 1) % images.length), 5000);
        }
    }

    function hydrateMedia() {
        if (mediaHydration) return mediaHydration;
        mediaHydration = Promise.allSettled(images.map((image) => {
            if (!image.hasAttribute('src') && image.dataset.src) {
                image.loading = 'eager';
                image.src = image.dataset.src;
                delete image.dataset.src;
            }
            return image.decode();
        })).then(() => {
            mediaReady = true;
            start();
        });
        return mediaHydration;
    }

    indicators.forEach((indicator, index) => {
        if (carouselRegion) {
            indicator.tabIndex = -1;
        } else {
            indicator.setAttribute('role', 'button');
            indicator.tabIndex = 0;
            indicator.setAttribute('aria-label', `Show image ${index + 1}`);
            indicator.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    show(index);
                    start();
                }
            });
        }
        indicator.addEventListener('click', () => {
            void hydrateMedia().then(() => {
                show(index);
                start();
            });
        });
    });

    carousel.addEventListener('mouseenter', () => {
        void hydrateMedia();
        stop();
    });
    carousel.addEventListener('mouseleave', start);
    carousel.addEventListener('focusin', () => {
        void hydrateMedia();
        stop();
    });
    carousel.addEventListener('focusout', start);
    document.addEventListener('visibilitychange', start);
    show(0);
    return hydrateMedia;
}

function initializeHeader(hydrateCarouselMedia) {
    const mobileToggle = document.querySelector('.mobile-menu-toggle');
    const mobileMenu = document.querySelector('.mobile-nav-menu');
    const mobileClose = mobileMenu?.querySelector('.mobile-menu-close');
    const backdrop = document.querySelector('.mobile-nav-backdrop');
    const menuDropdown = document.querySelector('.menu-dropdown');
    const menuButton = menuDropdown?.querySelector('.menu-link');
    const desktopMenu = menuDropdown?.querySelector('.mega-menu');
    const profileDropdown = document.querySelector('.profile-dropdown');
    const profileButton = profileDropdown?.querySelector('.profile-btn');
    const profileMenu = profileDropdown?.querySelector('.profile-menu');
    let lastFocusedElement = null;
    let profileCloseTimer = 0;

    function setDesktopMenu(open) {
        if (open) void hydrateCarouselMedia?.();
        menuDropdown?.classList.toggle('active', open);
        menuButton?.setAttribute('aria-expanded', String(open));
        desktopMenu?.setAttribute('aria-hidden', String(!open));
    }

    function setProfileMenu(open) {
        profileDropdown?.classList.toggle('active', open);
        syncProfileMenuState();
    }

    function syncProfileMenuState() {
        const open = Boolean(
            profileDropdown?.classList.contains('active')
            || profileDropdown?.classList.contains('hover-open')
        );
        profileButton?.setAttribute('aria-expanded', String(open));
        profileMenu?.setAttribute('aria-hidden', String(!open));
    }

    function setDesktopHoverState(open) {
        if (menuDropdown?.classList.contains('active')) return;
        menuButton?.setAttribute('aria-expanded', String(open));
        desktopMenu?.setAttribute('aria-hidden', String(!open));
    }

    function setProfileHoverState(open) {
        profileDropdown?.classList.toggle('hover-open', open);
        syncProfileMenuState();
    }

    function cancelProfileClose() {
        window.clearTimeout(profileCloseTimer);
        profileCloseTimer = 0;
    }

    function scheduleProfileClose() {
        cancelProfileClose();
        profileCloseTimer = window.setTimeout(() => {
            if (profileDropdown?.contains(document.activeElement)) return;
            setProfileHoverState(false);
        }, 220);
    }

    function closeProfileMenu() {
        cancelProfileClose();
        setProfileHoverState(false);
        setProfileMenu(false);
    }

    function setMobileMenu(open, restoreFocus = true) {
        if (!mobileMenu || !mobileToggle) return;
        mobileMenu.classList.toggle('active', open);
        mobileToggle.classList.toggle('active', open);
        mobileToggle.setAttribute('aria-expanded', String(open));
        mobileToggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
        mobileMenu.setAttribute('aria-hidden', String(!open));
        mobileMenu.inert = !open;
        backdrop?.classList.toggle('active', open);
        document.body.classList.toggle('menu-open', open);

        if (open) {
            lastFocusedElement = document.activeElement;
            const focusCloseButton = () => {
                if (mobileMenu.classList.contains('active')) mobileClose?.focus();
            };
            mobileMenu.addEventListener('transitionend', focusCloseButton, { once: true });
            window.setTimeout(focusCloseButton, 350);
        } else if (restoreFocus && lastFocusedElement instanceof HTMLElement) {
            lastFocusedElement.focus();
        }
    }

    menuButton?.addEventListener('click', (event) => {
        event.stopPropagation();
        closeProfileMenu();
        setDesktopMenu(!menuDropdown.classList.contains('active'));
    });
    menuButton?.addEventListener('focus', () => {
        void hydrateCarouselMedia?.();
    });

    profileButton?.addEventListener('click', (event) => {
        event.stopPropagation();
        setDesktopMenu(false);
        if (profileDropdown.classList.contains('active')) {
            closeProfileMenu();
        } else {
            setProfileMenu(true);
        }
    });

    menuDropdown?.addEventListener('mouseenter', () => {
        void hydrateCarouselMedia?.();
        setDesktopHoverState(true);
    });
    menuDropdown?.addEventListener('mouseleave', () => setDesktopHoverState(false));
    profileDropdown?.addEventListener('mouseenter', () => {
        cancelProfileClose();
        setProfileHoverState(true);
    });
    profileDropdown?.addEventListener('mouseleave', scheduleProfileClose);
    profileDropdown?.addEventListener('focusin', () => {
        cancelProfileClose();
        setProfileHoverState(true);
    });
    profileDropdown?.addEventListener('focusout', (event) => {
        if (!profileDropdown.contains(event.relatedTarget)) scheduleProfileClose();
    });

    mobileToggle?.addEventListener('click', (event) => {
        event.stopPropagation();
        setMobileMenu(!mobileMenu.classList.contains('active'));
    });
    mobileClose?.addEventListener('click', () => setMobileMenu(false));
    backdrop?.addEventListener('click', () => setMobileMenu(false));
    mobileMenu?.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => setMobileMenu(false, false));
    });

    document.addEventListener('click', (event) => {
        if (menuDropdown && !menuDropdown.contains(event.target)) setDesktopMenu(false);
        if (profileDropdown && !profileDropdown.contains(event.target)) closeProfileMenu();
    });

    document.addEventListener('focusin', (event) => {
        if (menuDropdown && !menuDropdown.contains(event.target)) setDesktopMenu(false);
        if (profileDropdown && !profileDropdown.contains(event.target)) closeProfileMenu();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (mobileMenu?.classList.contains('active')) setMobileMenu(false);
            setDesktopMenu(false);
            closeProfileMenu();
            return;
        }

        if (event.key !== 'Tab' || !mobileMenu?.classList.contains('active')) return;
        const focusable = [...mobileMenu.querySelectorAll(SELECTORS.focusable)]
            .filter((element) => !element.hidden && element.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 1100) setMobileMenu(false, false);
    });

    const headerSearch = document.querySelector('.utility-section > .search-btn');
    headerSearch?.addEventListener('click', () => {
        window.location.assign('/#filter');
    });

    const favoritesButton = document.querySelector('.favorites-btn');
    favoritesButton?.addEventListener('click', (event) => {
        const authenticated = typeof isAuthenticated === 'function' && isAuthenticated();
        if (!authenticated) {
            event.preventDefault();
            window.location.assign('auth.html?tab=signin');
            return;
        }

        const page = window.location.pathname.split('/').pop();
        if ((!page || page === 'main.html' || page === 'index.html') && typeof showFavoritesView === 'function') {
            event.preventDefault();
            showFavoritesView();
        }
    });

    setMobileMenu(false, false);
    setDesktopMenu(false);
    closeProfileMenu();
}

function setNavigationSemantics() {
    document.querySelectorAll('.mega-menu-column h3, .mobile-nav-header h3, .mobile-nav-section h4')
        .forEach((heading) => heading.setAttribute('role', 'presentation'));

    const currentPath = window.location.pathname;
    const menuButton = document.querySelector('.menu-dropdown .menu-link');
    if (SUPPORT_PATHS.has(currentPath)) menuButton?.setAttribute('aria-current', 'page');
    else menuButton?.removeAttribute('aria-current');

    document.querySelectorAll('.mega-menu a, .mobile-nav-menu a, .footer-links a').forEach((link) => {
        const target = new URL(link.href, window.location.href);
        const isCurrentPage = target.origin === window.location.origin
            && target.pathname === currentPath
            && !target.search
            && !target.hash;
        if (isCurrentPage) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
}

function scrollToCatalogState() {
    const parameters = new URLSearchParams(window.location.search);
    const hasCatalogState = ['q', 'scent', 'brand', 'type', 'collection']
        .some((parameter) => parameters.has(parameter));
    if (!hasCatalogState) return;
    const target = document.getElementById(window.location.hash === '#collections' ? 'collections' : 'filter');
    window.setTimeout(() => target?.scrollIntoView({ block: 'start' }), 150);
}

document.addEventListener('DOMContentLoaded', () => {
    preparePrimaryNavigation();
    setNavigationSemantics();
    setAuthVisibility();
    const hydrateCarouselMedia = initializeCarousel();
    initializeHeader(hydrateCarouselMedia);
    scrollToCatalogState();

    new MutationObserver(setAuthVisibility).observe(document.body, {
        attributes: true,
        attributeFilter: ['class']
    });
});
