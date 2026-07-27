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

function createSavedItemsMenu(favoritesButton) {
    if (!favoritesButton) return {};
    const existingDropdown = favoritesButton.closest('.saved-items-dropdown');
    if (existingDropdown) {
        return {
            dropdown: existingDropdown,
            menu: existingDropdown.querySelector('.saved-items-menu'),
            status: existingDropdown.querySelector('.saved-items-menu__status')
        };
    }

    const dropdown = document.createElement('div');
    dropdown.className = 'saved-items-dropdown';
    const menu = document.createElement('div');
    menu.className = 'saved-items-menu';
    menu.id = 'saved-items-menu';
    menu.setAttribute('aria-hidden', 'true');
    menu.setAttribute('aria-label', 'Saved items');
    menu.inert = true;

    const heading = document.createElement('div');
    heading.className = 'saved-items-menu__heading';
    const eyebrow = document.createElement('span');
    eyebrow.textContent = 'Your collection';
    const title = document.createElement('strong');
    title.textContent = 'Saved items';
    heading.append(eyebrow, title);
    menu.appendChild(heading);

    const createAction = ({ destination, icon, title: actionTitle, description }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'saved-items-menu__item';
        button.dataset.savedDestination = destination;

        const iconWrap = document.createElement('span');
        iconWrap.className = 'saved-items-menu__icon';
        iconWrap.setAttribute('aria-hidden', 'true');
        const iconElement = document.createElement('i');
        iconElement.className = `fas ${icon}`;
        iconWrap.appendChild(iconElement);

        const copy = document.createElement('span');
        copy.className = 'saved-items-menu__copy';
        const label = document.createElement('strong');
        label.textContent = actionTitle;
        const detail = document.createElement('span');
        detail.textContent = description;
        copy.append(label, detail);

        const arrow = document.createElement('i');
        arrow.className = 'fas fa-arrow-right saved-items-menu__arrow';
        arrow.setAttribute('aria-hidden', 'true');
        button.append(iconWrap, copy, arrow);
        menu.appendChild(button);
        return button;
    };

    createAction({
        destination: 'favorites',
        icon: 'fa-heart',
        title: 'Favorite fragrances',
        description: 'Review the offers you saved'
    });
    createAction({
        destination: 'watches',
        icon: 'fa-bell',
        title: 'Deal watches',
        description: 'Price, stock, and promotion alerts'
    });
    createAction({
        destination: 'browse',
        icon: 'fa-compass',
        title: 'Browse fragrances',
        description: 'Find something new to save'
    });

    const status = document.createElement('p');
    status.className = 'saved-items-menu__status';
    menu.appendChild(status);

    const parent = favoritesButton.parentNode;
    parent.insertBefore(dropdown, favoritesButton);
    dropdown.append(favoritesButton, menu);
    favoritesButton.setAttribute('aria-label', 'Open saved items');
    favoritesButton.setAttribute('aria-haspopup', 'true');
    favoritesButton.setAttribute('aria-controls', menu.id);
    favoritesButton.setAttribute('aria-expanded', 'false');
    return { dropdown, menu, status };
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
    const favoritesButton = document.querySelector('.favorites-btn');
    const savedItems = createSavedItemsMenu(favoritesButton);
    const savedDropdown = savedItems.dropdown;
    const savedMenu = savedItems.menu;
    const savedMenuStatus = savedItems.status;
    let lastFocusedElement = null;
    let profileCloseTimer = 0;
    let authHydrated = false;
    let pendingHeartActivation = false;

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

    function setSavedMenu(open, restoreFocus = false) {
        if (!savedDropdown || !savedMenu || !favoritesButton) return;
        const authenticated = typeof isAuthenticated === 'function' && isAuthenticated();
        savedDropdown.classList.toggle('active', open);
        favoritesButton.setAttribute('aria-expanded', String(open));
        favoritesButton.setAttribute('aria-label', open ? 'Close saved items' : 'Open saved items');
        savedMenu.setAttribute('aria-hidden', String(!open));
        savedMenu.inert = !open;
        if (savedMenuStatus) {
            savedMenuStatus.textContent = authenticated
                ? 'Choose an area to manage.'
                : 'Sign in to access saved items.';
        }
        if (!open && restoreFocus) favoritesButton.focus();
    }

    function revealHomeFavorites() {
        const page = window.location.pathname.split('/').pop();
        const onHomePage = !page || page === 'main.html' || page === 'index.html';
        if (!onHomePage || typeof showFavoritesView !== 'function') return false;
        if (window.location.hash !== '#favorites') {
            window.history.pushState({ ...window.history.state, catalogView: 'favorites' }, '', '#favorites');
        }
        showFavoritesView({ reveal: true });
        return true;
    }

    document.addEventListener('fragrance:auth-change', (event) => {
        authHydrated = true;
        favoritesButton?.removeAttribute('aria-busy');
        if (savedDropdown?.classList.contains('active')) setSavedMenu(true);
        if (!pendingHeartActivation) return;
        pendingHeartActivation = false;
        if (event.detail?.user && revealHomeFavorites()) {
            setSavedMenu(false);
            return;
        }
        setSavedMenu(true);
    });

    function openSavedDestination(destination) {
        if (destination === 'browse') {
            setSavedMenu(false);
            window.location.assign('/main.html#shop');
            return;
        }
        const authenticated = typeof isAuthenticated === 'function' && isAuthenticated();
        setSavedMenu(false);
        if (!authenticated) {
            window.location.assign('/auth.html?tab=signin');
            return;
        }

        if (destination === 'watches') {
            window.location.assign('/account.html#alerts');
            return;
        }

        if (revealHomeFavorites()) return;
        window.location.assign('/main.html#favorites');
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
        setSavedMenu(false);
        setDesktopMenu(!menuDropdown.classList.contains('active'));
    });
    menuButton?.addEventListener('focus', () => {
        void hydrateCarouselMedia?.();
    });

    profileButton?.addEventListener('click', (event) => {
        event.stopPropagation();
        setDesktopMenu(false);
        setSavedMenu(false);
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
        setSavedMenu(false);
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
        if (savedDropdown && !savedDropdown.contains(event.target)) setSavedMenu(false);
    });

    document.addEventListener('focusin', (event) => {
        if (menuDropdown && !menuDropdown.contains(event.target)) setDesktopMenu(false);
        if (profileDropdown && !profileDropdown.contains(event.target)) closeProfileMenu();
        if (savedDropdown && !savedDropdown.contains(event.target)) setSavedMenu(false);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (mobileMenu?.classList.contains('active')) setMobileMenu(false);
            setDesktopMenu(false);
            closeProfileMenu();
            setSavedMenu(false, savedDropdown?.classList.contains('active'));
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

    favoritesButton?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setDesktopMenu(false);
        closeProfileMenu();
        if (!authHydrated) {
            pendingHeartActivation = !pendingHeartActivation;
            favoritesButton.setAttribute('aria-busy', String(pendingHeartActivation));
            setSavedMenu(pendingHeartActivation);
            if (pendingHeartActivation && savedMenuStatus) {
                savedMenuStatus.textContent = 'Checking your saved items…';
            }
            return;
        }
        const authenticated = typeof isAuthenticated === 'function' && isAuthenticated();
        if (authenticated && revealHomeFavorites()) {
            setSavedMenu(false);
            return;
        }
        const opening = !savedDropdown?.classList.contains('active');
        setSavedMenu(opening);
    });
    favoritesButton?.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        setSavedMenu(true);
        const firstSavedItem = savedMenu?.querySelector('.saved-items-menu__item');
        // Chromium can reject focus in the same task that removes an
        // ancestor's inert state. Wait for the updated focusability tree, and
        // do not steal focus if the menu was closed in the meantime.
        window.requestAnimationFrame(() => {
            if (!savedDropdown?.classList.contains('active') || savedMenu?.inert) return;
            firstSavedItem?.focus();
        });
    });
    savedMenu?.addEventListener('click', (event) => {
        const action = event.target.closest('.saved-items-menu__item');
        if (!action) return;
        openSavedDestination(action.dataset.savedDestination);
    });

    setMobileMenu(false, false);
    setDesktopMenu(false);
    closeProfileMenu();
    setSavedMenu(false);
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
