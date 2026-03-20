// Universal Header Script for Fragrance Collect
// This script works across all pages and handles navigation appropriately

// Function to update authentication state visibility
function updateAuthStateVisibility() {
    const isLoggedIn = document.body.classList.contains('user-logged-in');
    
    // Update desktop profile menu
    const loggedInItems = document.querySelectorAll('.logged-in-only');
    const loggedOutItems = document.querySelectorAll('.logged-out-only');
    
    loggedInItems.forEach(item => {
        item.style.display = isLoggedIn ? 'block' : 'none';
    });
    
    loggedOutItems.forEach(item => {
        item.style.display = isLoggedIn ? 'none' : 'block';
    });
}

// Listen for authentication state changes
document.addEventListener('DOMContentLoaded', function() {
    // Initial state update
    updateAuthStateVisibility();
    
    // Listen for authentication state changes
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                updateAuthStateVisibility();
            }
        });
    });
    
    observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['class']
    });
});

let isMainPage; // Declare isMainPage in a broader scope

document.addEventListener('DOMContentLoaded', () => {
    const currentPage = window.location.pathname.split('/').pop() || 'main.html';
    isMainPage = currentPage === 'main.html' || currentPage === 'index.html';

    const isMobile = window.innerWidth <= 768; // Updated to match CSS breakpoint
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const mobileNavMenu = document.querySelector('.mobile-nav-menu');
    const mobileMenuClose = document.querySelector('.mobile-menu-close');
    const mobileNavBackdrop = document.querySelector('.mobile-nav-backdrop');

    console.log('Mobile elements found:');
    console.log('- mobileMenuToggle:', mobileMenuToggle);
    console.log('- mobileNavMenu:', mobileNavMenu);
    console.log('- mobileMenuClose:', mobileMenuClose);
    console.log('- mobileNavBackdrop:', mobileNavBackdrop);

    // Mobile sidebar functionality ready
    // Add targeted touch handling to prevent background scroll while allowing sidebar scroll
    if (mobileNavMenu) {
        // Prevent background page scrolling only when touching outside the sidebar content
        document.addEventListener('touchmove', function(e) {
            // Only prevent if sidebar is open and touch is outside sidebar
            if (mobileNavMenu.classList.contains('active')) {
                // Allow scrolling within the sidebar content area
                const sidebarContent = mobileNavMenu.querySelector('.mobile-nav-content');
                if (sidebarContent && !sidebarContent.contains(e.target)) {
                    // Touching outside sidebar content area - prevent scroll
                    e.preventDefault();
                }
            }
        }, { passive: false });
    }

    // PC dropdown functionality (for desktop and mobile)
    const menuDropdown = document.querySelector('.menu-dropdown');
    const megaMenu = document.querySelector('.mega-menu');
    
    // Image Carousel in Mega Menu
    const indicators = document.querySelectorAll('.indicator');
    const images = document.querySelectorAll('.promo-image');
    let currentImageIndex = 0;
    let imageInterval;

    const showImage = (index) => {
        images.forEach((img, i) => {
            img.classList.toggle('active', i === index);
        });
        indicators.forEach((ind, i) => {
            ind.classList.toggle('active', i === index);
        });
    };

    const startCarousel = () => {
        imageInterval = setInterval(() => {
            currentImageIndex = (currentImageIndex + 1) % images.length;
            showImage(currentImageIndex);
        }, 3000); // Change image every 3 seconds
    };

    const stopCarousel = () => {
        clearInterval(imageInterval);
    };

    if (indicators.length > 0 && images.length > 0) {
        indicators.forEach(indicator => {
            indicator.addEventListener('click', () => {
                stopCarousel();
                currentImageIndex = parseInt(indicator.dataset.index);
                showImage(currentImageIndex);
                startCarousel();
            });
        });
        
        const imageCarousel = document.querySelector('.image-carousel');
        if(imageCarousel) {
            imageCarousel.addEventListener('mouseenter', stopCarousel);
            imageCarousel.addEventListener('mouseleave', startCarousel);
        }

        startCarousel();
    }

    // Profile Dropdown Logic
    const profileDropdown = document.querySelector('.profile-dropdown');

    if (profileDropdown) {
        const profileBtn = profileDropdown.querySelector('.profile-btn');
        const profileMenu = profileDropdown.querySelector('.profile-menu');

        // Click Logic for Both Desktop and Mobile
        profileBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Toggle active state for click functionality
            const isActive = profileDropdown.classList.contains('active');
            profileDropdown.classList.toggle('active', !isActive);

            console.log('Profile dropdown toggled:', !isActive);
        });

        // Enhanced hover behavior for desktop
        let hoverTimeout;

        // Mouse enter on dropdown container
        profileDropdown.addEventListener('mouseenter', () => {
            if (window.innerWidth > 768) { // Check on each hover
                clearTimeout(hoverTimeout);
                profileDropdown.classList.add('active');
            }
        });

        // Mouse leave on dropdown container
        profileDropdown.addEventListener('mouseleave', () => {
            if (window.innerWidth > 768) { // Check on each hover
                hoverTimeout = setTimeout(() => {
                    profileDropdown.classList.remove('active');
                }, 150); // Small delay to prevent flickering
            }
        });

        // Universal Click Outside to Close
        document.addEventListener('click', (e) => {
            if (!profileDropdown.contains(e.target)) {
                profileDropdown.classList.remove('active');
            }
        });

        // Handle window resize to adjust behavior
        window.addEventListener('resize', () => {
            // Clear any pending timeouts and close dropdown on mobile
            clearTimeout(hoverTimeout);
            if (window.innerWidth <= 768) {
                profileDropdown.classList.remove('active');
            }
        });

        // Prevent dropdown from interfering with page scroll on mobile
        if (profileMenu) {
            profileMenu.addEventListener('touchstart', (e) => {
                e.stopPropagation(); // Prevent event bubbling on mobile
            });
        }
    }

    // Menu Button Logic - Desktop dropdown vs mobile sidebar
    if (menuDropdown) {
        const menuLink = menuDropdown.querySelector('.menu-link');

        if (menuLink) {
            console.log('Menu link found:', menuLink);
            menuLink.addEventListener('click', (e) => {
                console.log('Menu link clicked by element:', e.target, 'window width:', window.innerWidth);

                // Make sure this is actually the menu link and not another element
                if (e.target !== menuLink && !menuLink.contains(e.target)) {
                    console.log('Click was not on menu link, ignoring');
                    return;
                }

                if (window.innerWidth <= 768) {
                    // Mobile / tablet: open sidebar instead of mega menu
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Mobile detected, opening sidebar...');

                    if (mobileNavMenu) {
                        mobileNavMenu.classList.add('active');
                        console.log('Added active class to mobile nav menu');
                    } else {
                        console.log('Mobile nav menu not found!');
                    }
                    if (mobileMenuToggle) {
                        mobileMenuToggle.classList.add('active');
                        console.log('Added active class to mobile menu toggle');
                    } else {
                        console.log('Mobile menu toggle not found!');
                    }
                    if (mobileNavBackdrop) {
                        mobileNavBackdrop.classList.add('active');
                        console.log('Added active class to mobile nav backdrop');
                    } else {
                        console.log('Mobile nav backdrop not found!');
                    }

                } else {
                    // Desktop: toggle mega menu dropdown
                    e.preventDefault();
                    menuDropdown.classList.toggle('active');
                    console.log('Opening desktop dropdown on', window.innerWidth, 'px screen');
                }
            });

            // Close mega menu when clicking outside on desktop
            document.addEventListener('click', (e) => {
                if (window.innerWidth > 768 && !menuDropdown.contains(e.target)) {
                    menuDropdown.classList.remove('active');
                }
            });
        }
    }

    // Hamburger menu logic - use existing variables

    if (mobileMenuToggle && mobileNavMenu) {
        mobileMenuToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isOpening = !mobileNavMenu.classList.contains('active');
            mobileNavMenu.classList.toggle('active');
            mobileMenuToggle.classList.toggle('active');
            if (mobileNavBackdrop) {
                mobileNavBackdrop.classList.toggle('active');
            }

        });

        const mobileMenuClose = document.querySelector('.mobile-menu-close');
        if (mobileMenuClose) {
            mobileMenuClose.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Closing mobile nav menu');
                mobileNavMenu.classList.remove('active');
                mobileMenuToggle.classList.remove('active');
                if (mobileNavBackdrop) {
                    mobileNavBackdrop.classList.remove('active');
                }

            });
        }
    }

    // Universal click outside handler for mobile sidebar and backdrop click
    if (mobileNavMenu) {
        document.addEventListener('click', function(e) {
            // Don't interfere with search button clicks
            const searchBtn = document.querySelector('.utility-section .search-btn');
            if (searchBtn && (e.target === searchBtn || searchBtn.contains(e.target))) {
                return;
            }

            if (mobileNavMenu.classList.contains('active') && !mobileNavMenu.contains(e.target) && !mobileMenuToggle.contains(e.target)) {
                console.log('Closing mobile nav menu (click outside)');
                mobileNavMenu.classList.remove('active');
                mobileMenuToggle.classList.remove('active');
                if (mobileNavBackdrop) {
                    mobileNavBackdrop.classList.remove('active');
                }

            }
        });

        // Close sidebar when clicking backdrop
        if (mobileNavBackdrop) {
            mobileNavBackdrop.addEventListener('click', function(e) {
                console.log('Closing mobile nav menu (backdrop click)');
                mobileNavMenu.classList.remove('active');
                mobileMenuToggle.classList.remove('active');
                mobileNavBackdrop.classList.remove('active');

            });
        }
    }

    // Header search button functionality (only for header search button, not filter search button)
    const headerSearchBtn = document.querySelector('.utility-section .search-btn');
    if (headerSearchBtn) {
        headerSearchBtn.addEventListener('click', function(e) {
            console.log('Search button clicked - redirecting to browse fragrances');
            e.preventDefault();
            e.stopPropagation(); // Only prevent bubbling, not immediate propagation

            // Always redirect to browse fragrances section on main page
            window.location.href = 'main.html#filter';
        });

        // Light touch event handling to prevent conflicts without blocking functionality
        headerSearchBtn.addEventListener('touchend', function(e) {
            e.stopPropagation(); // Prevent touch event from bubbling
        });
    }

    // Universal navigation link functionality
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            
            // Check if this is the personalized link and handle it separately
            if (href === 'main.html#personalized') {
                if (typeof getPersonalizedRecommendations === 'function') {
                    e.preventDefault();
                    getPersonalizedRecommendations();
                }
                return; // Stop further processing for this link
            }

            // For all other links, perform the standard filter link handling
            if (href.includes('main.html#filter')) {
                e.preventDefault();
                
                if (isMainPage) {
                    // Check if we're in favorites view and need to exit it first
                    const favoritesSection = document.getElementById('favorites');
                    const isInFavoritesView = favoritesSection && favoritesSection.style.display === 'block';
                    
                    if (isInFavoritesView) {
                        // Exit favorites view first
                        if (typeof showMainContentView === 'function') {
                            showMainContentView();
                        }
                        // Small delay to ensure the view switches before scrolling
                        setTimeout(() => {
                            const targetId = href.substring(10); // Remove 'main.html#'
                            const targetSection = document.getElementById(targetId);
                            if (targetSection) {
                                targetSection.scrollIntoView({
                                    behavior: 'smooth',
                                    block: 'start'
                                });
                            }
                        }, 100);
                    } else {
                        // Normal navigation - scroll to section
                        const targetId = href.substring(10); // Remove 'main.html#'
                        const targetSection = document.getElementById(targetId);

                        if (targetSection) {
                            targetSection.scrollIntoView({
                                behavior: 'smooth',
                                block: 'start'
                            });
                        }
                    }
                } else {
                    // On other pages, redirect to main page section
                    window.location.href = href;
                }
            }
        });
    });

    // Universal brand logo functionality
    const brandLogo = document.querySelector('.brand-logo');
    if (brandLogo) {
        brandLogo.addEventListener('click', function(e) {
            e.preventDefault();
            
            if (isMainPage) {
                // Check if we're in favorites view and need to exit it first
                const favoritesSection = document.getElementById('favorites');
                const isInFavoritesView = favoritesSection && favoritesSection.style.display === 'block';
                
                if (isInFavoritesView) {
                    // Exit favorites view first
                    if (typeof showMainContentView === 'function') {
                        showMainContentView();
                    }
                    // Scroll to top of page
                    setTimeout(() => {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }, 100);
                } else {
                    // Normal behavior - scroll to top
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            } else {
                // On other pages, redirect to main page
                window.location.href = 'main.html';
            }
        });
    }

    // Universal favorites button functionality
    const favoritesBtn = document.querySelector('.favorites-btn');
    if (favoritesBtn) {
        favoritesBtn.addEventListener('click', function(e) {
            e.preventDefault();
            
            // Check authentication status first
            if (!isAuthenticated()) {
                // If user is not authenticated, redirect to sign in page
                console.log('User not authenticated, redirecting to sign in page');
                window.location.href = 'auth.html?tab=signin';
                return;
            }
            
            // User is authenticated, proceed with favorites functionality
            if (isMainPage) {
                // On main page, show favorites view which loads from database
                console.log('Showing favorites view on main page');
                if (typeof showFavoritesView === 'function') {
                    showFavoritesView();
                } else {
                    // Fallback to scrolling if function not available
                    const favoritesSection = document.getElementById('favorites');
                    if (favoritesSection) {
                        favoritesSection.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start'
                        });
                    }
                }
            } else {
                // Check if we're on the account page
                const currentPage = window.location.pathname.split('/').pop() || 'main.html';
                if (currentPage === 'account.html') {
                    // On account page, go to account favorites section
                    window.location.href = 'account.html#favorites';
                } else {
                    // On other pages, redirect to account favorites page
                    window.location.href = 'account.html#favorites';
                }
            }
        });
    }

    // Universal mega menu links functionality
    const megaMenuLinks = document.querySelectorAll('.mega-menu a');
    megaMenuLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            const linkText = this.textContent.trim();
            
            e.preventDefault();
            
            if (isMainPage) {
                // On main page, handle different types of links
                handleMegaMenuLink(linkText, href);
            } else {
                // On other pages, redirect to main page with appropriate action
                redirectToMainPage(linkText, href);
            }
        });
    });

    // Universal mobile navigation links functionality
    const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');
    mobileNavLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            const linkText = this.textContent.trim();
            
            if (!href || href === '#') {
                return; // Do nothing for empty links
            }

            e.preventDefault();
            
            // Close the mobile menu
            const mobileNavMenu = document.querySelector('.mobile-nav-menu');
            const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
            const mobileNavBackdrop = document.querySelector('.mobile-nav-backdrop');

            if (mobileNavMenu && mobileNavMenu.classList.contains('active')) {
                mobileNavMenu.classList.remove('active');
                mobileMenuToggle.classList.remove('active');
                if (mobileNavBackdrop) {
                    mobileNavBackdrop.classList.remove('active');
                }
            }
            
            // A small delay allows the menu to animate closed before navigation
            setTimeout(() => {
                if (isMainPage) {
                    handleMegaMenuLink(linkText, href);
                } else {
                    redirectToMainPage(linkText, href);
                }
            }, 150);
        });
    });

    // Add event listeners to collection cards
    const collectionCards = document.querySelectorAll('.collection-card');
    collectionCards.forEach(card => {
        card.addEventListener('click', function(event) {
            const brand = this.dataset.brand;
            if (brand) {
                event.preventDefault();
                performBrandSearch(brand);
            }
        });
    });

    // Handle window resize to switch between mobile/PC behavior
    window.addEventListener('resize', function() {
        const wasMobile = isMobile;
        const nowMobile = window.innerWidth <= 480;

        if (wasMobile !== nowMobile) {
            // Reload the page to reinitialize with new device type
            location.reload();
        }

        // Close mobile menu if switching to desktop
        if (!nowMobile && mobileNavMenu && mobileNavMenu.classList.contains('active')) {
            mobileNavMenu.classList.remove('active');
            mobileMenuToggle.classList.remove('active');
            if (mobileNavBackdrop) {
                mobileNavBackdrop.classList.remove('active');
            }

            // Restore body scrolling when sidebar is closed
            document.body.style.overflow = '';
        }
    });
});

// Function to handle mega menu links on main page
function handleMegaMenuLink(linkText, href) {
    // Handle Main Navigation Links
    const mainNavActions = {
        'Home': () => handleMainPageNavigation('main.html#home'),
        'Explore': () => handleMainPageNavigation('main.html#viral-tiktok-finds'),
        'Collections': () => handleMainPageNavigation('main.html#collections'),
        'Personalized': () => handleMainPageNavigation('main.html#personalized'),
        'Top Picks': () => performTopPicksSearch()
    };

    if (mainNavActions[linkText]) {
        mainNavActions[linkText]();
        return;
    }
    
    // Handle scent links - use search functionality
    const scentLinks = ['Floral', 'Woody', 'Oriental', 'Fresh', 'Citrus'];
    if (scentLinks.includes(linkText)) {
        performScentSearch(linkText);
        return;
    }
    
    // Handle brand links - use search functionality
    const brandLinks = ['Chanel', 'Dior', 'Creed', 'Tom Ford'];
    if (brandLinks.includes(linkText)) {
        performBrandSearch(linkText);
        return;
    }
    
    // Handle collection links - use search functionality
    const collectionLinks = ['Designer', 'Niche', 'Vintage', 'Seasonal'];
    if (collectionLinks.includes(linkText)) {
        performCollectionSearch(linkText);
        return;
    }
    
    // Handle customer service links - navigate to respective pages
    const customerServiceLinks = {
        'Customer Service': 'customer-service.html',
        'Contact Us': 'contact.html',
        'Size Guide': 'size-guide.html',
        'FAQ': 'faq.html',
        'Terms of Service': 'terms-of-service.html',
        'Privacy Policy': 'privacy-policy.html'
    };
    
    if (customerServiceLinks[linkText]) {
        window.location.href = customerServiceLinks[linkText];
        return;
    }
    
    // Fallback for any other links
    if (href && href.startsWith('main.html#')) {
        handleMainPageNavigation(href);
        return;
    }
    
    // If no other handler caught it, just navigate
    if (href) {
        window.location.href = href;
    }
}

// Function to handle mega menu links on other pages
function redirectToMainPage(linkText, href) {
    // Handle Main Navigation Links
    const mainNavRedirects = {
        'Home': 'main.html#home',
        'Explore': 'main.html#viral-tiktok-finds',
        'Collections': 'main.html#collections',
        'Personalized': 'main.html#personalized',
        'Top Picks': 'main.html?search=top+rated+perfume#filter'
    };

    if (mainNavRedirects[linkText]) {
        window.location.href = mainNavRedirects[linkText];
        return;
    }

    // Handle scent links
    const scentLinks = ['Floral', 'Woody', 'Oriental', 'Fresh', 'Citrus'];
    if (scentLinks.includes(linkText)) {
        window.location.href = `main.html?scent=${linkText.toLowerCase()}#filter`;
        return;
    }
    
    // Handle brand links
    const brandLinks = ['Chanel', 'Dior', 'Creed', 'Tom Ford'];
    if (brandLinks.includes(linkText)) {
        window.location.href = `main.html?brand=${linkText.toLowerCase().replace(' ', '-')}#filter`;
        return;
    }
    
    // Handle collection links
    const collectionLinks = ['Designer', 'Niche', 'Vintage', 'Seasonal'];
    if (collectionLinks.includes(linkText)) {
        window.location.href = `main.html?collection=${linkText.toLowerCase()}#filter`;
        return;
    }
    
    // Handle customer service links
    const customerServiceLinks = {
        'Customer Service': 'customer-service.html',
        'Contact Us': 'contact.html',
        'Size Guide': 'size-guide.html',
        'FAQ': 'faq.html',
        'Terms of Service': 'terms-of-service.html',
        'Privacy Policy': 'privacy-policy.html'
    };
    
    if (customerServiceLinks[linkText]) {
        window.location.href = customerServiceLinks[linkText];
        return;
    }
    
    // Fallback
    if (href) {
        window.location.href = href;
    }
}

// Function to perform scent search
function performScentSearch(scent) {
    const searchInput = document.getElementById('main-search');
    if (searchInput) {
        searchInput.value = `${scent} fragrances`;
        searchInput.focus();
        
        // Scroll to search section
        const filterSection = document.getElementById('filter');
        if (filterSection) {
            filterSection.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
        
        // Trigger search if performSearch function exists
        if (typeof performSearch === 'function') {
            setTimeout(() => {
                performSearch(`${scent} fragrances`);
            }, 500);
        }
    }
}

// Function to perform brand search
function performBrandSearch(brand) {
    const searchInput = document.getElementById('main-search');
    if (searchInput) {
        searchInput.value = `${brand} perfume`;
        searchInput.focus();
        
        // Scroll to search section
        const filterSection = document.getElementById('filter');
        if (filterSection) {
            filterSection.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
        
        // Trigger search if performSearch function exists
        if (typeof performSearch === 'function') {
            setTimeout(() => {
                performSearch(`${brand} perfume`);
            }, 500);
        }
    }
}

// Function to perform collection search
function performCollectionSearch(collection) {
    const searchInput = document.getElementById('main-search');
    if (searchInput) {
        // Map collection names to search terms
        const collectionSearchTerms = {
            'Designer': 'designer perfume',
            'Niche': 'niche fragrance',
            'Vintage': 'vintage perfume',
            'Seasonal': 'seasonal fragrance'
        };
        
        const searchTerm = collectionSearchTerms[collection] || `${collection.toLowerCase()} perfume`;
        searchInput.value = searchTerm;
        searchInput.focus();
        
        // Scroll to search section
        const filterSection = document.getElementById('filter');
        if (filterSection) {
            filterSection.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
        
        // Trigger search if performSearch function exists
        if (typeof performSearch === 'function') {
            setTimeout(() => {
                performSearch(searchTerm);
            }, 500);
        }
    }
}

// Function to perform top picks search
function performTopPicksSearch() {
    const searchInput = document.getElementById('main-search');
    if (searchInput) {
        const searchTerm = 'top rated perfume';
        searchInput.value = searchTerm;
        searchInput.focus();
        
        // Scroll to search section
        const filterSection = document.getElementById('filter');
        if (filterSection) {
            filterSection.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
        
        // Trigger search if performSearch function exists
        if (typeof performSearch === 'function') {
            setTimeout(() => {
                performSearch(searchTerm);
            }, 500);
        }
    }
}

// Function to scroll to collections section
function scrollToCollections() {
    const collectionsSection = document.getElementById('collections');
    if (collectionsSection) {
        collectionsSection.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }
}

// Function to handle main page navigation with filters
function handleMainPageNavigation(href) {
    // Get URL parameters
    const urlParams = new URLSearchParams(href.split('?')[1] || '');
    const hash = href.split('#')[1] || '';

    // Handle scent filtering
    const scent = urlParams.get('scent');
    if (scent && hash.includes('filter')) {
        // Scroll to filter section and apply scent filter
        const filterSection = document.getElementById('filter');
        if (filterSection) {
            setTimeout(() => {
                filterSection.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });

                // Apply scent filter
                const searchInput = document.getElementById('main-search');
                if (searchInput) {
                    searchInput.value = scent + ' fragrances';
                    searchInput.focus();

                    // Trigger search if there's a search function
                    const searchForm = searchInput.closest('form');
                    if (searchForm) {
                        console.log('Filtering by scent:', scent);
                    }
                }
            }, 500);
        }
    }

    // Handle collection filtering
    const collectionType = urlParams.get('type');
    if (collectionType && hash.includes('collections')) {
        const collectionsSection = document.getElementById('collections');
        if (collectionsSection) {
            setTimeout(() => {
                collectionsSection.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
                console.log('Filtering by collection type:', collectionType);
            }, 500);
        }
    }

    // Handle brand filtering
    const brand = urlParams.get('brand');
    if (brand && hash.includes('filter')) {
        const filterSection = document.getElementById('filter');
        if (filterSection) {
            setTimeout(() => {
                filterSection.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
                console.log('Filtering by brand:', brand);
            }, 500);
        }
    }

    // Handle viral tiktok finds
    if (hash.includes('viral-tiktok-finds')) {
        const viralTikTokSection = document.getElementById('viral-tiktok-finds');
        if (viralTikTokSection) {
            setTimeout(() => {
                viralTikTokSection.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
                console.log('Scrolled to Viral TikTok Finds section');
            }, 500);
        }
    }

    // Handle simple hash navigation (no parameters)
    if (!scent && !collectionType && !brand && hash) {
        const targetSection = document.getElementById(hash);
        if (targetSection) {
            setTimeout(() => {
                targetSection.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }, 500);
        }
    }
}

// Handle filter links on page load (only for main page)
function handleFilterLinks() {
    const currentPage = window.location.pathname.split('/').pop() || 'main.html';
    const isMainPageOnLoad = currentPage === 'main.html' || currentPage === 'index.html';
    
    if (!isMainPageOnLoad) return;

    // Get URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash;

    console.log('handleFilterLinks triggered', { urlParams: urlParams.toString(), hash });

    // Handle search term from URL
    const searchTerm = urlParams.get('search');
    if (searchTerm && hash.includes('#filter')) {
        const filterSection = document.getElementById('filter');
        if (filterSection) {
            setTimeout(() => {
                filterSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                const searchInput = document.getElementById('main-search');
                if (searchInput) {
                    searchInput.value = decodeURIComponent(searchTerm.replace(/\+/g, ' '));
                    searchInput.focus();
                    if (typeof performSearch === 'function') {
                        performSearch(searchInput.value);
                    }
                }
            }, 500);
        }
        return; // Prioritize search term over other filters
    }

    // Handle scent filtering
    const scent = urlParams.get('scent');
    if (scent && hash.includes('#filter')) {
        // Scroll to filter section and apply scent filter
        const filterSection = document.getElementById('filter');
        if (filterSection) {
            setTimeout(() => {
                filterSection.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });

                // Apply scent filter
                const searchInput = document.getElementById('main-search');
                if (searchInput) {
                    searchInput.value = scent + ' fragrances';
                    searchInput.focus();

                    // Trigger search if there's a search function
                    const searchForm = searchInput.closest('form');
                    if (searchForm) {
                        console.log('Filtering by scent:', scent);
                    }
                }
            }, 500);
        }
    }

    // Handle collection filtering
    const collection = urlParams.get('collection');
    if (collection && hash.includes('#filter')) {
        const filterSection = document.getElementById('filter');
        if (filterSection) {
            setTimeout(() => {
                filterSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                const searchInput = document.getElementById('main-search');
                if (searchInput) {
                    console.log('Applying collection filter:', collection);
                    const collectionSearchTerms = {
                        'designer': 'designer perfume',
                        'niche': 'niche fragrance',
                        'vintage': 'vintage perfume',
                        'seasonal': 'seasonal fragrance'
                    };
                    const searchTerm = collectionSearchTerms[collection] || `${collection} perfume`;
                    searchInput.value = searchTerm;
                    searchInput.focus();
                    if (typeof performSearch === 'function') {
                        performSearch(searchTerm);
                    }
                }
            }, 500);
        }
    }

    // Handle brand filtering
    const brand = urlParams.get('brand');
    if (brand && hash.includes('#filter')) {
        const filterSection = document.getElementById('filter');
        if (filterSection) {
            setTimeout(() => {
                filterSection.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
                console.log('Filtering by brand:', brand);
            }, 500);
        }
    }

    // Handle viral tiktok finds
    if (hash.includes('#viral-tiktok-finds')) {
        const viralTikTokSection = document.getElementById('viral-tiktok-finds');
        if (viralTikTokSection) {
            setTimeout(() => {
                viralTikTokSection.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
                console.log('Scrolled to Viral TikTok Finds section');
            }, 500);
        }
    }
}

// Handle filter links on page load
document.addEventListener('DOMContentLoaded', handleFilterLinks);

// Also handle when URL changes (for SPA-like behavior)
window.addEventListener('hashchange', handleFilterLinks);
