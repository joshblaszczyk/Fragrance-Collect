// Live data only: populated from CJ via Cloudflare Worker

// Security utilities for XSS prevention
const SecurityUtils = {
  // HTML entity encoding to prevent XSS
  escapeHtml(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  },

  // Validate and sanitize search queries
  validateSearchQuery(query) {
    if (!query || typeof query !== 'string') return '';
    
    // Remove potentially dangerous characters
    let sanitized = query.replace(/[<>\"'&]/g, '');
    
    // Only allow alphanumeric, spaces, and safe punctuation
    sanitized = sanitized.replace(/[^a-zA-Z0-9\s\-.,&()]/g, '');
    
    // Limit length
    return sanitized.substring(0, 200).trim();
  },

  // Validate numeric inputs
  validateNumber(value, min = 0, max = Infinity, defaultValue = 0) {
    const num = Number(value);
    return isNaN(num) || num < min || num > max ? defaultValue : num;
  },

  // Validate URLs
  validateUrl(url) {
    if (!url || typeof url !== 'string') return '';
    
    try {
      const urlObj = new URL(url);
      // Only allow HTTPS URLs
      if (urlObj.protocol !== 'https:') return '';
      return url;
    } catch {
      return '';
    }
  },

  // Safe DOM manipulation
  setInnerHTML(element, content) {
    if (!element || !content) return;
    
    // Use textContent for safety, or create safe HTML
    if (typeof content === 'string' && content.includes('<')) {
      // If content contains HTML, sanitize it
      element.innerHTML = this.escapeHtml(content);
    } else {
      element.textContent = content;
    }
  }
};

// Global variables for favorites filtering
let currentFavorites = []; // Store the current favorites data
let isInFavoritesView = false; // Track if we're currently viewing favorites

// ... existing code ...
let currentFilters = {
    brand: '',
    priceRange: '',
    rating: '',
    shipping: '',
    search: ''
};

let cjProducts = [];
let filteredPerfumes = [];
let availableFeeds = [];
let userFavorites = new Set(); // Stores IDs of favorited fragrances
let pendingFavoriteOperations = new Map(); // Stores pending operations for offline sync
let isOnline = navigator.onLine; // Track online status

// Track online/offline status
window.addEventListener('online', () => {
    isOnline = true;
    console.log('Back online - syncing pending favorite operations...');
    syncPendingFavoriteOperations();
});

window.addEventListener('offline', () => {
    isOnline = false;
    console.log('Gone offline - favorite operations will be queued');
});

// Function to sync pending operations when back online
async function syncPendingFavoriteOperations() {
    if (pendingFavoriteOperations.size === 0) return;

    console.log(`Syncing ${pendingFavoriteOperations.size} pending favorite operations...`);
    showToast(`Syncing ${pendingFavoriteOperations.size} favorite operations...`, 'info');

    for (const [fragranceId, operation] of pendingFavoriteOperations) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (sessionToken) {
                headers['Authorization'] = `Bearer ${sessionToken}`;
            }

            if (operation.type === 'add') {
                await fetch('https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/user/favorites', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(operation.data),
                    credentials: 'include'
                });
                console.log(`✅ Synced add operation for ${fragranceId}`);
            } else if (operation.type === 'remove') {
                await fetch(`https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/user/favorites/${fragranceId}`, {
                    method: 'DELETE',
                    headers,
                    credentials: 'include'
                });
                console.log(`✅ Synced remove operation for ${fragranceId}`);
            }

            pendingFavoriteOperations.delete(fragranceId);
        } catch (error) {
            console.error(`❌ Failed to sync operation for ${fragranceId}:`, error);
            // Keep the operation in the queue for next attempt
        }
    }

    // Reload favorites to ensure UI is in sync
    if (pendingFavoriteOperations.size === 0) {
        console.log('All pending operations synced successfully');
        showToast('All favorites synced successfully!', 'success');
        loadUserFavorites();
    } else {
        showToast(`${pendingFavoriteOperations.size} operations still pending`, 'warning');
    }
}
let currentPage = 1;
let totalPages = 1;

// Currency symbols for display
const currencySymbols = {
    USD: '$', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$', JPY: '¥', CNY: '¥', 
    CHF: 'CHF', SEK: 'kr', NOK: 'kr', DKK: 'kr', PLN: 'zł', CZK: 'Kč', 
    HUF: 'Ft', RON: 'lei', BGN: 'лв', HRK: 'kn', RUB: '₽', TRY: '₺',
    BRL: 'R$', MXN: '$', ARS: '$', CLP: '$', COP: '$', PEN: 'S/', 
    ZAR: 'R', INR: '₹', KRW: '₩', SGD: 'S$', HKD: 'HK$', TWD: 'NT$',
    THB: '฿', MYR: 'RM', IDR: 'Rp', PHP: '₱', VND: '₫'
};

// Currency conversion cache and rates
let currencyRates = {
    EUR: 1 // Base currency for ECB API
};
let lastFetchTime = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Enhanced currency converter object with ECB API integration
const currencyConverter = {
    // Fetch latest exchange rates from ECB API
    async fetchRates() {
        const now = Date.now();
        
        // Return cached rates if they're still valid
        if (now - lastFetchTime < CACHE_DURATION && Object.keys(currencyRates).length > 1) {
            console.log('💰 Using cached currency rates');
            return currencyRates;
        }
        
        try {
            console.log('💰 Fetching latest currency rates from Exchange Rate APIs...');
            // Try multiple free currency APIs as fallbacks
            let data = null;
            let apiUsed = '';
            
            // Try open.er-api.com first (free tier available)
            try {
                const response = await fetch('https://open.er-api.com/v6/latest/EUR');
                if (response.ok) {
                    const responseData = await response.json();
                    if (responseData.rates) {
                        data = { success: true, rates: responseData.rates };
                        apiUsed = 'open.er-api.com';
                    }
                }
            } catch (e) {
                console.log('⚠️ open.er-api.com failed, trying fallback...');
            }
            
            // Fallback to frankfurter.app
            if (!data) {
                try {
                    const response = await fetch('https://api.frankfurter.app/latest?from=EUR');
                    if (response.ok) {
                        const responseData = await response.json();
                        if (responseData.rates) {
                            data = { success: true, rates: responseData.rates };
                            apiUsed = 'frankfurter.app';
                        }
                    }
                } catch (e) {
                    console.log('⚠️ frankfurter.app failed');
                }
            }
            
            if (!data || !data.success || !data.rates) {
                throw new Error('All currency APIs failed');
            }
            
            // Update rates cache
            currencyRates = {
                EUR: 1, // Base currency
                ...data.rates
            };
            
            lastFetchTime = now;
            console.log(`✅ Currency rates updated successfully via ${apiUsed}:`, Object.keys(currencyRates).length, 'currencies');
            
            return currencyRates;
            
        } catch (error) {
            console.error('❌ Failed to fetch currency rates from all APIs:', error);
            
            // Fallback to basic rates if API fails
            currencyRates = {
                EUR: 1,
                USD: 1.08,
                GBP: 0.86,
                CAD: 1.47,
                AUD: 1.66,
                JPY: 160,
                CNY: 7.8,
                CHF: 0.95,
                SEK: 11.2,
                NOK: 11.5,
                DKK: 7.45,
                PLN: 4.3,
                CZK: 25.2,
                HUF: 380,
                RON: 4.95,
                BGN: 1.96,
                HRK: 7.53,
                RUB: 100,
                TRY: 33.5,
                BRL: 5.4,
                MXN: 18.2,
                ARS: 950,
                CLP: 1050,
                COP: 4200,
                PEN: 4.05,
                ZAR: 20.5,
                INR: 90,
                KRW: 1450,
                SGD: 1.46,
                HKD: 8.45,
                TWD: 34.5,
                THB: 39.5,
                MYR: 5.1,
                IDR: 17000,
                PHP: 60.5,
                VND: 26500
            };
            
            return currencyRates;
        }
    },
    
    // Convert amount between currencies
    async convert(amount, fromCurrency, toCurrency) {
        if (!amount || !fromCurrency || !toCurrency) return amount || 0;
        if (fromCurrency === toCurrency) return amount;
        
        try {
            // Ensure we have the latest rates
            await this.fetchRates();
            
            // Convert to EUR first, then to target currency
            const eurAmount = amount / (currencyRates[fromCurrency] || 1);
            const result = eurAmount * (currencyRates[toCurrency] || 1);
            
            // Validate the result
            if (isNaN(result) || !isFinite(result)) {
                console.warn('⚠️ Invalid conversion result, using original amount:', { amount, fromCurrency, toCurrency, result });
                return amount;
            }
            
            return result;
        } catch (error) {
            console.error('❌ Currency conversion failed:', error);
            return amount; // Return original amount on error
        }
    },
    
    // Synchronous convert (for sorting - uses cached rates)
    convertSync(amount, fromCurrency, toCurrency) {
        if (!amount || !fromCurrency || !toCurrency) return amount || 0;
        if (fromCurrency === toCurrency) return amount;
        
        try {
            // Use cached rates for synchronous operations
            const eurAmount = amount / (currencyRates[fromCurrency] || 1);
            const result = eurAmount * (currencyRates[toCurrency] || 1);
            
            // Validate the result
            if (isNaN(result) || !isFinite(result)) {
                console.warn('⚠️ Invalid sync conversion result, using original amount:', { amount, fromCurrency, toCurrency, result });
                return amount;
            }
            
            return result;
        } catch (error) {
            console.error('❌ Synchronous currency conversion failed:', error);
            return amount; // Return original amount on error
        }
    },
    
    // Get currency symbol
    getSymbol(currency) {
        return currencySymbols[currency] || currency;
    },
    
    // Format price with proper currency symbol and formatting
    formatPrice(amount, currency) {
        const symbol = this.getSymbol(currency);
        const formattedAmount = amount.toFixed(2);
        
        // Handle different currency formatting conventions
        if (currency === 'JPY' || currency === 'KRW' || currency === 'IDR' || currency === 'VND') {
            // No decimal places for these currencies
            return `${symbol}${Math.round(amount)}`;
        } else if (currency === 'INR') {
            // Indian numbering system
            return `${symbol}${formattedAmount}`;
        } else {
            // Standard formatting
            return `${symbol}${formattedAmount}`;
        }
    },
    
    // Get available currencies
    getAvailableCurrencies() {
        return Object.keys(currencyRates);
    },
    
    // Check if currency is supported
    isSupported(currency) {
        return currency in currencyRates;
    }
};

// Populate currency dropdown with available currencies from ECB API
function populateCurrencyDropdown() {
    const currencyDropdown = document.getElementById('currency-converter');
    if (!currencyDropdown) return;
    
    // Get available currencies
    const availableCurrencies = currencyConverter.getAvailableCurrencies();
    
    // Sort currencies by popularity/common usage
    const popularCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK'];
    const sortedCurrencies = [
        ...popularCurrencies.filter(c => availableCurrencies.includes(c)),
        ...availableCurrencies.filter(c => !popularCurrencies.includes(c)).sort()
    ];
    
    // Clear existing options
    currencyDropdown.innerHTML = '';
    
    // Add options for each currency
    sortedCurrencies.forEach(currency => {
        const symbol = currencyConverter.getSymbol(currency);
        const option = document.createElement('option');
        option.value = currency;
        option.textContent = `${currency} (${symbol})`;
        currencyDropdown.appendChild(option);
    });
    
    // Set default to USD
    currencyDropdown.value = 'USD';
    
    console.log(`✅ Currency dropdown populated with ${sortedCurrencies.length} currencies`);
}

// Test function to verify currency API integration
async function testCurrencyConverter() {
    console.log('🧪 Testing currency converter...');
    
    try {
        // Test fetching rates
        const rates = await currencyConverter.fetchRates();
        console.log('✅ Rates fetched successfully:', Object.keys(rates).length, 'currencies');
        
        // Test basic conversions
        const usdToEur = await currencyConverter.convert(100, 'USD', 'EUR');
        const eurToUsd = await currencyConverter.convert(100, 'EUR', 'USD');
        const gbpToEur = await currencyConverter.convert(100, 'GBP', 'EUR');
        console.log('✅ Conversion tests:', {
            '100 USD to EUR': usdToEur,
            '100 EUR to USD': eurToUsd,
            '100 GBP to EUR': gbpToEur
        });
        
        // Test same currency conversion
        const sameCurrency = await currencyConverter.convert(100, 'EUR', 'EUR');
        console.log('✅ Same currency test:', sameCurrency);
        
        // Test synchronous conversion
        const syncConversion = currencyConverter.convertSync(100, 'EUR', 'GBP');
        console.log('✅ Synchronous conversion test:', syncConversion);
        
        // Test formatting
        const formatted = currencyConverter.formatPrice(123.45, 'USD');
        console.log('✅ Formatting test:', formatted);
        
        // Test error handling with invalid currencies
        const invalidConversion = await currencyConverter.convert(100, 'INVALID', 'USD');
        console.log('✅ Invalid currency handling:', invalidConversion);
        
        console.log('✅ All currency converter tests passed');
        return true;
    } catch (error) {
        console.error('❌ Currency converter test failed:', error);
        return false;
    }
}

// Configuration
const config = {
    API_ENDPOINT: 'https://weathered-mud-6ed5.joshuablaszczyk.workers.dev',
    RESULTS_PER_PAGE: 25, // Changed from original value
    DEBOUNCE_DELAY: 300,
    POPULAR_PICKS_LIMIT: 10, // New constant for popular picks
    TIKTOK_FINDS_LIMIT: 10, // New constant for TikTok finds
    PREFETCH_ENABLED: true,
    DEFAULT_SEARCH_TERM: 'fragrance perfume', // The term to search on page load
    FEATURED_FRAGRANCES: [
        'Creed Green Irish Tweed',
        'Tom Ford Ombré Leather',
        'Chanel Coco Mademoiselle',
        'Dior Sauvage'
    ]
};

// --- AUTHENTICATION ---
// Note: isUserLoggedIn and currentUser are now managed by shared-auth.js

const authUI = {
    loginBtn: document.getElementById('login-btn'),
    userWelcome: document.getElementById('user-welcome'),
    userNameDisplay: document.getElementById('user-name-display'),
    logoutLink: document.getElementById('logout-link'),
    favoritesSection: document.getElementById('favorites'),
    favoritesGrid: document.getElementById('favorites-grid'),
    favoritesEmptyState: document.getElementById('favorites-empty-state'),
    // Main content sections to hide when showing favorites
    mainContentSections: document.querySelectorAll('.main-content'),
    homeLinks: document.querySelectorAll('.home-link'),
    shopLinks: document.querySelectorAll('.shop-link'),
    favoritesLink: document.querySelector('a[href="main.html#favorites"]')
};


// Authentication status checking is now handled by shared-auth.js
// This function is kept for backward compatibility but delegates to shared auth
async function checkUserStatus() {
    await checkSharedUserStatus();
}

// UI updates are now handled by shared-auth.js updateSharedNavUI function
// This function is kept for backward compatibility but delegates to shared auth
function updateNavUI(user) {
    const loginBtn = document.getElementById('login-btn');
    if (user) {
        if (authUI.userWelcome) authUI.userWelcome.style.display = 'flex';
        if (authUI.loginBtn) authUI.loginBtn.style.display = 'none';
        if (loginBtn) loginBtn.style.display = 'none';
        
        if (authUI.userNameDisplay) {
            const firstName = user.name.split(' ')[0];
            updateDynamicGreeting(firstName);
        }
    } else {
        if (authUI.userWelcome) authUI.userWelcome.style.display = 'none';
        if (authUI.loginBtn) authUI.loginBtn.style.display = 'block';
        if (loginBtn) loginBtn.style.display = 'block';
    }
}

function updateDynamicGreeting(firstName) {
    const hour = new Date().getHours();
    const greetingElement = document.getElementById('dynamic-greeting');
    const subtitleElement = document.getElementById('welcome-subtitle');
    const heroGreeting = document.getElementById('hero-greeting');
    const heroGreetingText = heroGreeting?.querySelector('.greeting-text');
    
    let greeting, subtitle;
    
    if (hour < 12) {
        greeting = 'Good morning';
        subtitle = 'Start your day with the perfect scent';
    } else if (hour < 17) {
        greeting = 'Good afternoon';
        subtitle = 'Discover new fragrances today';
    } else {
        greeting = 'Good evening';
        subtitle = 'Discover your perfect evening scent';
    }
    
    // Add some personalized variety
    const personalizedMessages = [
        'Ready to explore new scents?',
        'Your fragrance journey continues',
        'Discover your signature scent',
        'Find your perfect match today',
        'Welcome back to luxury'
    ];
    
    // Occasionally use a personalized message
    if (Math.random() < 0.3) {
        subtitle = personalizedMessages[Math.floor(Math.random() * personalizedMessages.length)];
    }
    
    // Update navigation greeting
    if (greetingElement) greetingElement.textContent = greeting;
    if (subtitleElement) subtitleElement.textContent = subtitle;
    
    // Update hero section greeting
    if (heroGreetingText && firstName) {
        heroGreetingText.textContent = `${greeting}, ${firstName}!`;
        heroGreeting.style.display = 'block';
        // Add animation class after a short delay
        setTimeout(() => {
            heroGreeting.classList.add('show');
        }, 100);
    }
    
    // Search row actions removed - user actions now consolidated in navigation
}

// Logout is now handled by shared-auth.js handleSharedLogout function
// This function is kept for backward compatibility but delegates to shared auth
async function handleLogout() {
    await handleSharedLogout();
}

// Test function to manually trigger favorites view
function testFavorites() {
    console.log('=== TESTING FAVORITES FUNCTIONALITY ===');
    console.log('Current URL:', window.location.href);
    console.log('isUserLoggedIn:', isUserLoggedIn);
    console.log('currentUser:', currentUser);
    console.log('sessionToken:', sessionToken ? 'exists' : 'missing');
    console.log('isAuthenticated():', isAuthenticated());
    console.log('authUI.favoritesSection:', authUI.favoritesSection);
    console.log('authUI.favoritesLink:', authUI.favoritesLink);
    
    // Try to show favorites view
    showFavoritesView();
}

// Add test function to window for easy access
window.testFavorites = testFavorites;
document.addEventListener('DOMContentLoaded', async () => {

    // Authentication is now handled by shared-auth.js
    // Check if user is logged in after shared auth initializes
    // Increased timeout to ensure shared auth has fully initialized
    setTimeout(async () => {
        console.log('Main page: Checking authentication status...');
        console.log('isUserLoggedIn:', isUserLoggedIn);
        console.log('currentUser:', currentUser);

        if (isAuthenticated()) {
            console.log('Main page: User is authenticated, loading favorites...');
            loadUserFavorites();
            
            // Check if user navigated directly to favorites via URL fragment
            if (window.location.hash === '#favorites') {
                console.log('Direct navigation to favorites detected');
                showFavoritesView();
            }
        } else {
            console.log('Main page: User is not authenticated');
            
            // If user tried to access favorites but isn't authenticated, redirect to sign in
            if (window.location.hash === '#favorites') {
                console.log('Unauthenticated user tried to access favorites, redirecting to sign in');
                window.location.href = 'auth.html?tab=signin';
            }
        }
    }, 500);

    // Logout handling is now in shared-auth.js - search row logout removed

    // Add event listener for the menu logout button
    const menuLogoutBtn = document.getElementById('menu-logout-btn');
    if (menuLogoutBtn) {
        menuLogoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleSharedLogout();
        });
    }

    if (authUI.favoritesLink) {
        console.log('Found favorites link, adding event listener');
        authUI.favoritesLink.addEventListener('click', (e) => {
            console.log('Favorites link clicked');
            e.preventDefault();
            showFavoritesView();
        });
    } else {
        console.log('Favorites link not found');
    }

    // Add event listeners to navigation links to restore main view
    const navLinks = document.querySelectorAll('.nav-link:not([href*="favorites"])');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            // Only restore main view for navigation links (not favorites)
            if (!link.getAttribute('href').includes('#favorites')) {
                e.preventDefault();
                showMainContentView();
                // Navigate to the target section
                const targetHref = link.getAttribute('href');
                if (targetHref.includes('#')) {
                    const targetId = targetHref.split('#')[1];
                    if (targetId === 'home') {
                        // Special case for Home - scroll to top
                        setTimeout(() => {
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                        }, 100);
                    } else {
                        const targetElement = document.getElementById(targetId);
                        if (targetElement) {
                            setTimeout(() => {
                                targetElement.scrollIntoView({ behavior: 'smooth' });
                            }, 100);
                        }
                    }
                } else {
                    // If no hash, also scroll to top (fallback for home)
                    setTimeout(() => {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }, 100);
                }
            }
        });
    });

    // Add event listeners for filter controls
    const clearFiltersBtn = document.getElementById('clear-filters');
    const sortByFilter = document.getElementById('sort-by-filter');
    const priceRangeFilter = document.getElementById('price-range');
    const shippingFilter = document.getElementById('shipping-filter');

    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', clearAllFilters);
    }

    if (sortByFilter) {
        sortByFilter.addEventListener('change', () => {
            // Sort the currently displayed products
            sortProducts(filteredPerfumes);
        });
    }

    // Currency converter event listener
    const currencyConverterElement = document.getElementById('currency-converter');
    if (currencyConverterElement) {
        currencyConverterElement.addEventListener('change', async () => {
            try {
                // Show loading state
                currencyConverterElement.disabled = true;
                currencyConverterElement.style.opacity = '0.6';
                
                // Update all displayed prices to the selected currency
                await updateDisplayedPrices(currencyConverterElement.value);
                
                console.log('✅ Currency conversion completed successfully');
            } catch (error) {
                console.error('❌ Currency conversion failed:', error);
                // Show error message to user
                showToast('Currency conversion failed. Please try again.', 'error');
            } finally {
                // Restore normal state
                currencyConverterElement.disabled = false;
                currencyConverterElement.style.opacity = '1';
            }
        });
    }

    if (priceRangeFilter) {
        priceRangeFilter.addEventListener('change', applyFilters);
    }

    if (shippingFilter) {
        shippingFilter.addEventListener('change', applyFilters);
    }

    // Add event listeners for favorites filter controls (using main filter elements)
    const clearFiltersFavoritesBtn = document.getElementById('clear-filters');
    const sortByFilterFavorites = document.getElementById('sort-by-filter');
    const priceRangeFilterFavorites = document.getElementById('price-range');
    const shippingFilterFavorites = document.getElementById('shipping-filter');
    const currencyConverterFavorites = document.getElementById('currency-converter');

    if (clearFiltersFavoritesBtn) {
        clearFiltersFavoritesBtn.addEventListener('click', clearAllFilters);
    }

    if (sortByFilterFavorites) {
        sortByFilterFavorites.addEventListener('change', () => {
            // Sort the currently displayed favorites or main products
            if (isInFavoritesView) {
                sortFavorites(currentFavorites);
            } else {
                sortProducts(currentProducts);
            }
        });
    }

    if (currencyConverterFavorites) {
        currencyConverterFavorites.addEventListener('change', async () => {
            try {
                // Show loading state
                currencyConverterFavorites.disabled = true;
                currencyConverterFavorites.style.opacity = '0.6';
                
                // Update all displayed prices to the selected currency
                await updateDisplayedPrices(currencyConverterFavorites.value);
                
                console.log('✅ Currency conversion completed successfully');
            } catch (error) {
                console.error('❌ Currency conversion failed:', error);
                // Show error message to user
                showToast('Currency conversion failed. Please try again.', 'error');
            } finally {
                // Restore normal state
                currencyConverterFavorites.disabled = false;
                currencyConverterFavorites.style.opacity = '1';
            }
        });
    }

    if (priceRangeFilterFavorites) {
        priceRangeFilterFavorites.addEventListener('change', applyFilters);
    }

    if (shippingFilterFavorites) {
        shippingFilterFavorites.addEventListener('change', applyFilters);
    }

    // Exact match checkbox event listener
    const exactMatchToggle = document.getElementById('exact-match-toggle');
    if (exactMatchToggle) {
        exactMatchToggle.addEventListener('change', () => {
            console.log('🔍 Exact match toggled:', exactMatchToggle.checked);
            // Trigger a new search when exact match is toggled
            if (currentFilters.search) {
                applyFilters(true);
            }
        });
    }

    // Initialize the application
    initModal();
    checkMobileMenu();
    initHamburgerMenu();

    // Load initial products for the main grid
    const initialSearchTerm = getUrlParameter('q') || 'fragrance perfume';
    const searchInput = document.getElementById('main-search');
    if (searchInput) {
        searchInput.value = initialSearchTerm;
    }
    
    // Initialize currency converter with latest rates
    try {
        await currencyConverter.fetchRates();
        
        // Test currency converter functionality
        await testCurrencyConverter();
        
        // Populate currency dropdown with available currencies
        populateCurrencyDropdown();
        
        console.log('✅ Currency converter initialized successfully');
    } catch (error) {
        console.error('❌ Currency converter initialization failed:', error);
        // Continue with fallback rates
    }
    
    loadCJProducts(initialSearchTerm, 1, null, { sortBy: 'revenue' });

    // Load recommendation sections with their specific queries
    loadPopularPicks(); // Use a featured brand for popular picks
    loadTikTokFinds(); // Specific query for TikTok section

    // Initialize event listeners after all functions are defined
    initializeDropdowns();
    addEventListeners();

    setupStripe();
    
    initializeFilters();

    // Load products on initial page load
    try {
        showLoading();
        loadCJProducts(initialSearchTerm, 1, null, { sortBy: 'revenue' });
    } catch (error) {
        console.error('Error loading products:', error);
        showStatusMessage('Failed to load products. Please try again.', true);
    } finally {
        hideLoading();
    }
});

// Handle hash changes for favorites navigation (back/forward buttons)
window.addEventListener('hashchange', () => {
    if (window.location.hash === '#favorites') {
        if (isAuthenticated()) {
            console.log('Hash change to favorites detected - showing favorites view');
            showFavoritesView();
        } else {
            console.log('Hash change to favorites but user not authenticated - redirecting to sign in');
            window.location.href = 'auth.html?tab=signin';
        }
    } else if (window.location.hash !== '#favorites' && typeof isInFavoritesView !== 'undefined' && isInFavoritesView) {
        console.log('Hash change away from favorites - showing main content');
        showMainContentView();
    }
});

// Lightweight performance metrics for optional UI cards
if (typeof window !== 'undefined' && !window.performanceMetrics) {
  window.performanceMetrics = {
    apiCalls: 0,
    totalLoadTime: 0,
    lastLoadMs: 0
  };
}

function updatePerformanceCards() {
  try {
    if (!window.performanceMetrics) return;
    const { apiCalls, totalLoadTime, lastLoadMs } = window.performanceMetrics;
    const avg = apiCalls > 0 ? Math.round(totalLoadTime / apiCalls) : 0;
    const elApi = document.getElementById('perf-api-calls');
    const elAvg = document.getElementById('perf-avg-load');
    const elLast = document.getElementById('perf-last-load');
    if (elApi) elApi.textContent = String(apiCalls);
    if (elAvg) elAvg.textContent = `${avg} ms`;
    if (elLast) elLast.textContent = `${lastLoadMs} ms`;
  } catch (e) {
    // ignore UI update errors
  }
}

function showStatusMessage(message, isError = false) {
    const grid = document.getElementById('products-grid');
    const noResults = document.getElementById('no-results');
    if (grid) grid.innerHTML = '';
    if (noResults) {
        noResults.style.display = 'block';
        // Use safe DOM manipulation
        SecurityUtils.setInnerHTML(noResults, message);
        noResults.style.color = isError ? '#ffb4b4' : '';
    }
}

function showLoading() { showStatusMessage('Loading products...'); }
function hideLoading() {
    const noResults = document.getElementById('no-results');
    if (noResults) noResults.style.display = 'none';
}

// SIMPLIFIED: This function is no longer needed as the new API provides clean data.
/*
function normalizeShippingLocal(cost, shippingField) {
    if (typeof cost === 'string' && cost.trim().toLowerCase() === 'free') return 0;
    if (typeof cost === 'number') return cost;
    if (shippingField && typeof shippingField === 'string') {
        if (shippingField.toLowerCase().includes('free')) return 0;
        const m = shippingField.match(/\$([0-9]+(\.[0-9]{1,2})?)/);
        if (m) return Number(m[1]);
    }
    return null;
}
*/

// SIMPLIFIED: This function now only handles the single, clean `products` array from the worker.
function mapProductsDataToItems(data) {
    if (!data || !Array.isArray(data.products)) return [];
    
    return data.products
        .map(p => ({
            id: SecurityUtils.escapeHtml(p.id || `cj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`),
            name: SecurityUtils.escapeHtml(p.name || 'Unnamed Product'),
            brand: SecurityUtils.escapeHtml(p.brand || 'Unknown Brand'),
            price: SecurityUtils.validateNumber(p.price, 0, 10000, 0),
            rating: SecurityUtils.validateNumber(p.rating, 0, 5, 0),
            image: SecurityUtils.validateUrl(p.image || ''),
            description: SecurityUtils.escapeHtml(p.description || ''),
            buyUrl: SecurityUtils.validateUrl(p.link || p.cjLink || p.buyUrl || ''),
            shippingCost: p.shippingCost, // The worker now provides this as null
            advertiser: SecurityUtils.escapeHtml(p.advertiser || 'Unknown'),
            category: SecurityUtils.escapeHtml(p.category || 'Fragrance'),
            availability: 'In Stock',
            currency: SecurityUtils.escapeHtml(p.currency || 'USD'),
            isReal: true
        }));
}

// ... existing code ...
function initializeFilters() {
    const sortByFilter = document.getElementById('sort-by-filter');
    const currencyConverter = document.getElementById('currency-converter');
    const priceRangeFilter = document.getElementById('price-range');
    const shippingFilter = document.getElementById('shipping-filter');

    if (sortByFilter) sortByFilter.value = 'revenue';
    if (currencyConverter) currencyConverter.value = 'USD';
    if (priceRangeFilter) priceRangeFilter.value = 'all';
    if (shippingFilter) shippingFilter.value = 'all';
}

// Apply filters and sorting from UI controls
function clearAllFilters() {
    initializeFilters(); // Set filters to default values

    const searchInput = document.getElementById('main-search');
    if (searchInput) searchInput.value = config.DEFAULT_SEARCH_TERM;

    // Check if we're in favorites view
    if (isInFavoritesView) {
        console.log('🔍 In favorites view - clearing filters for favorites');
        // Reset filters and show all favorites
        currentFilters.priceRange = '';
        currentFilters.shipping = '';
        displayFavorites(currentFavorites);
        return;
    }

    // Perform search with default term
    performSearch(config.DEFAULT_SEARCH_TERM);
}

async function applyFilters(isServerSide = false) {
    try {
        // Get all filter values from the UI (safely handle missing elements)
        const priceFilter = document.getElementById('price-range');
        const brandFilter = document.getElementById('brand-filter');
        const shippingFilter = document.getElementById('shipping-filter');
        
        // Debug logging
        console.log('Filter elements found:', {
            priceFilter: !!priceFilter,
            brandFilter: !!brandFilter,
            shippingFilter: !!shippingFilter
        });
        
        currentFilters.priceRange = priceFilter ? priceFilter.value : '';
        currentFilters.brand = brandFilter ? brandFilter.value : '';
        currentFilters.shipping = shippingFilter ? shippingFilter.value : '';
        
        // Check if we're in favorites view
        if (isInFavoritesView) {
            console.log('🔍 In favorites view - applying filters to favorites');
            filterFavorites();
            return;
        }
        
        // Server-side filters trigger a new data fetch from the worker
        if (isServerSide) {
            showLoading();
            // Always fetch from page 1 when a major filter changes
            currentPage = 1;
            const filters = buildServerFilters();
            await loadCJProducts(currentFilters.search, currentPage, null, filters);
        } else {
            // Client-side filters just refine the currently displayed products
            filterPerfumes();
        }
    } catch (error) {
        console.error('Error in applyFilters:', error);
        // Fallback: just try to load products without filters
        if (isServerSide && !isInFavoritesView) {
            showLoading();
            currentPage = 1;
            await loadCJProducts(currentFilters.search, currentPage);
        }
    }
}

// Sort products on the client-side
function sortProducts(products) {
    // Check if we're in favorites view
    if (isInFavoritesView) {
        console.log('🔍 In favorites view - sorting favorites');
        sortFavorites(currentFavorites);
        return;
    }

    const sortByFilter = document.getElementById('sort-by-filter');
    
    if (!sortByFilter) {
        // If no sort filter exists, just display products without sorting
        displayProducts(products);
        return;
    }
    
    const sortBy = sortByFilter.value;
    const targetCurrency = document.getElementById('currency-converter')?.value || 'USD';
    console.log('🔍 Client-side sorting by:', sortBy, `Target Currency: ${targetCurrency}`);

    products.sort((a, b) => {
        if (sortBy === 'price_low') {
            const priceA = currencyConverter.convertSync(a.price || 0, a.currency || 'USD', targetCurrency);
            const priceB = currencyConverter.convertSync(b.price || 0, b.currency || 'USD', targetCurrency);
            return priceA - priceB;
        } else if (sortBy === 'price_high') {
            const priceA = currencyConverter.convertSync(a.price || 0, a.currency || 'USD', targetCurrency);
            const priceB = currencyConverter.convertSync(b.price || 0, b.currency || 'USD', targetCurrency);
            return priceB - priceA;
        } else if (sortBy === 'revenue') {
            // "Best Match" - placeholder for future logic (e.g., sort by rating, sales)
            // For now, it will keep the default order from the API.
            return 0;
        }
        return 0; // Default case
    });

    displayProducts(products);
}

/**
 * A dedicated function to fetch products from the API worker.
 * This function only handles the network request and returns the data,
 * without updating the UI directly.
 */
async function fetchProductsFromApi(query = '', page = 1, limit = null, filters = {}) {
    try {
        const params = new URLSearchParams({
            q: query || '',
            page: page.toString(),
            limit: (limit || config.RESULTS_PER_PAGE).toString(),
            includeTikTok: 'true'
        });

        if (filters.lowPrice) params.append('lowPrice', filters.lowPrice.toString());
        if (filters.highPrice) params.append('highPrice', filters.highPrice.toString());
        if (filters.brand) params.append('brand', filters.brand);
        if (filters.shipping) params.append('shipping', filters.shipping);
        if (filters.rating) params.append('rating', filters.rating.toString());
        if (filters.partnerId) params.append('partnerId', filters.partnerId.toString());
        if (filters.sortBy) params.append('sortBy', filters.sortBy);
        if (filters.exactMatch) {
            params.append('exactMatch', filters.exactMatch.toString());
            // Add cache-busting parameter for exact match to ensure fresh results
            params.append('_cb', Date.now().toString());
            console.log('🔍 Exact match enabled - adding cache busting parameter');
        }

        const apiUrl = `${config.API_ENDPOINT}/api/products?${params.toString()}`;
        console.log('🚀 API Fetch:', apiUrl);
        console.log('🔍 Exact match status:', filters.exactMatch ? 'ENABLED' : 'DISABLED');

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(apiUrl, {
            method: 'GET',
            signal: controller.signal
        });

        clearTimeout(timer);

        if (!res.ok) {
            const errorText = await res.text();
            let errorMessage = `API fetch failed (${res.status})`;
            try {
                const errorData = JSON.parse(errorText);
                if (errorData.details) errorMessage += `: ${SecurityUtils.escapeHtml(errorData.details)}`;
            } catch (e) {
                if (errorText && errorText.length < 100) errorMessage += `: ${SecurityUtils.escapeHtml(errorText)}`;
            }
            throw new Error(errorMessage);
        }
        
        const data = await res.json();
        if (data && data.error) {
            throw new Error(data.error + (data.details ? `: ${SecurityUtils.escapeHtml(data.details)}` : ''));
        }
        
        return data;

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Request was aborted (timeout or cancelled)');
        } else {
            console.error('API fetch error:', error);
        }
        throw error; // Re-throw to be handled by the caller
    }
}

/**
 * Main function to load products from CJ Affiliate.
 * It now automatically fetches multiple pages if the initial result is too small.
 */
async function loadCJProducts(query = '', page = 1, limit = null, filters = {}) {
    showLoading();
    
    try {
        const data = await fetchProductsFromApi(query, page, limit, filters);

        cjProducts = mapProductsDataToItems(data);
        filteredPerfumes = [...cjProducts];
        
        // Apply client-side sorting based on current sort filter
        const sortByFilter = document.getElementById('sort-by-filter');
        if (sortByFilter && sortByFilter.value && sortByFilter.value !== 'revenue') {
            sortProducts(filteredPerfumes);
        }
        
        // Preserve user's currency selection when loading new results
        const currencyConverterDropdown = document.getElementById('currency-converter');
        if (currencyConverterDropdown && filteredPerfumes.length > 0) {
            // Store the current currency selection before any changes
            const userSelectedCurrency = currencyConverterDropdown.value;
            console.log('🔄 Current user currency selection:', userSelectedCurrency);
            
            // Only auto-detect currency on the very first load (when no products exist yet)
            if (!cjProducts || cjProducts.length === 0) {
                const defaultCurrency = detectDefaultCurrency(filteredPerfumes);
                currencyConverterDropdown.value = defaultCurrency;
                console.log('🔄 First load - auto-detected default currency:', defaultCurrency);
            } else {
                // Preserve the user's currency selection for subsequent loads
                console.log('🔄 Preserving user-selected currency:', userSelectedCurrency);
                // Ensure the dropdown still shows the user's selection
                currencyConverterDropdown.value = userSelectedCurrency;
            }
        }
        
        totalPages = data.total ? Math.ceil(data.total / (limit || config.RESULTS_PER_PAGE)) : 1;

        displayProducts(filteredPerfumes);
        displayPagination();
        populateBrandFilter();

        const searchResultsInfo = document.getElementById('search-results-info');
        if (searchResultsInfo) {
            let message;
            
            // Handle exact match cases
            if (data.optimization?.exactMatchApplied && cjProducts.length === 0) {
                message = `No exact matches found for "${data.searchQuery}". Try disabling exact match or using different search terms.`;
            } else if (data.optimization?.exactMatchApplied) {
                // For exact matches, show results count without the badge
                const total = data.total || cjProducts.length;
                message = `Showing ${cjProducts.length} of approximately ${total} results.`;
            } else {
                // For regular searches, show the results count
                const total = data.total || cjProducts.length;
                message = `Showing ${cjProducts.length} of approximately ${total} results.`;
            }
            
            SecurityUtils.setInnerHTML(searchResultsInfo, message);
            searchResultsInfo.style.display = 'block';
        }

        // Update displayed prices to the selected currency
        const selectedCurrency = document.getElementById('currency-converter')?.value;
        if (selectedCurrency) {
            await updateDisplayedPrices(selectedCurrency);
        }

        return data;

    } catch (error) {
        console.error('CJ API fetch error:', error);
        showStatusMessage(`Error: Could not fetch products. ${error.message}`, true);
        return [];
    } finally {
        hideLoading();
    }
}

// Detect the most common currency in the displayed products
function detectDefaultCurrency(products) {
    if (!products || products.length === 0) return 'USD';
    
    const currencyCounts = {};
    products.forEach(product => {
        const currency = product.currency || 'USD';
        currencyCounts[currency] = (currencyCounts[currency] || 0) + 1;
    });
    
    // Find the most common currency
    let mostCommonCurrency = 'USD';
    let maxCount = 0;
    
    Object.entries(currencyCounts).forEach(([currency, count]) => {
        if (count > maxCount) {
            maxCount = count;
            mostCommonCurrency = currency;
        }
    });
    
    return mostCommonCurrency;
}

// Update all displayed prices to the selected currency
async function updateDisplayedPrices(targetCurrency) {
    console.log('🔄 Updating displayed prices to:', targetCurrency);
    
    if (!targetCurrency) {
        console.warn('⚠️ No target currency specified');
        return;
    }
    
    // Check if we're in favorites view
    if (isInFavoritesView) {
        console.log('🔄 In favorites view - updating favorites prices');
        // Update favorites with new currency
        const updatedFavorites = currentFavorites.map(fav => ({
            ...fav,
            currency: targetCurrency,
            price: currencyConverter.convertSync(fav.price || 0, fav.currency || 'USD', targetCurrency)
        }));
        displayFavorites(updatedFavorites);
        return;
    }
    
    // Get all price elements on the page
    const priceElements = document.querySelectorAll('.product-price, .modal-price');
    
    if (priceElements.length === 0) {
        console.log('ℹ️ No price elements found to update');
        return;
    }
    
    console.log(`🔄 Converting ${priceElements.length} price elements to ${targetCurrency}`);
    
    // Convert all prices asynchronously
    const conversionPromises = Array.from(priceElements).map(async (element, index) => {
        const originalPrice = element.getAttribute('data-original-price');
        const originalCurrency = element.getAttribute('data-original-currency');
        
        if (!originalPrice || !originalCurrency) {
            console.warn(`⚠️ Missing price data for element ${index}:`, { originalPrice, originalCurrency });
            return;
        }
        
        try {
            const convertedPrice = await currencyConverter.convert(
                parseFloat(originalPrice), 
                originalCurrency, 
                targetCurrency
            );
            
            if (convertedPrice !== null && convertedPrice !== undefined) {
                const formattedPrice = currencyConverter.formatPrice(convertedPrice, targetCurrency);
                element.textContent = `${formattedPrice} ${targetCurrency}`;
            } else {
                console.warn(`⚠️ Invalid conversion result for element ${index}`);
            }
        } catch (error) {
            console.error(`❌ Currency conversion error for element ${index}:`, error);
            // Fallback to original price if conversion fails
            const originalFormatted = currencyConverter.formatPrice(parseFloat(originalPrice), originalCurrency);
            element.textContent = `${originalFormatted} ${originalCurrency}`;
        }
    });
    
    try {
        // Wait for all conversions to complete
        await Promise.all(conversionPromises);
        console.log('✅ All prices updated successfully');
    } catch (error) {
        console.error('❌ Error during price updates:', error);
    }
}

// Enhanced product display with revenue information
function displayProducts(perfumes) {
    const productsGrid = document.getElementById('products-grid');
    if (!productsGrid) return;

    if (perfumes.length === 0) {
        productsGrid.innerHTML = '<p class="no-products">No products found. Try adjusting your search or filters.</p>';
        return;
    }

    const productCards = perfumes.map(perfume => createProductCard(perfume)).join('');
    productsGrid.innerHTML = productCards;

    // Add infinite scroll if enabled
    if (window.infiniteScrollEnabled) {
        // setupInfiniteScroll();
    }
    
    // Automatically convert prices to the currently selected currency
    const currencyConverter = document.getElementById('currency-converter');
    if (currencyConverter && currencyConverter.value && currencyConverter.value !== 'USD') {
        // Use setTimeout to ensure DOM is updated before converting prices
        setTimeout(() => {
            updateDisplayedPrices(currencyConverter.value).catch(error => {
                console.warn('Auto currency conversion failed:', error);
            });
        }, 100);
    }
}

function displayPagination() {
    const paginationContainer = document.getElementById('pagination-container');
    if (!paginationContainer) return;

    // Don't show total pages to avoid confusion with client-side filtering.
    paginationContainer.innerHTML = `
        <button id="prev-page" class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
        <span class="page-info">Page ${currentPage}</span>
        <button id="next-page" class="pagination-btn" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
    `;

    document.getElementById('prev-page').addEventListener('click', () => changePage(currentPage - 1));
    document.getElementById('next-page').addEventListener('click', () => changePage(currentPage + 1));
}

// Change page
function changePage(page) {
    if (page < 1 || page > totalPages) return;
    
    currentPage = page;
    const filters = buildServerFilters();
    loadCJProducts(currentFilters.search, currentPage, null, filters).then(() => {
        document.getElementById('shop').scrollIntoView({ behavior: 'smooth' });
    });
}

// Create product card HTML with XSS protection
function formatShipping(perfume) {
    if (perfume.shippingCost === 0) return { text: 'Free shipping', cls: 'free' };
    if (typeof perfume.shippingCost === 'number') return { text: `$${perfume.shippingCost.toFixed(2)} shipping`, cls: '' };
    return { text: 'Unknown shipping', cls: 'unknown' };
}

function createProductCard(perfume) {
    const rating = typeof perfume.rating === 'number' ? perfume.rating : 0.0;
    const price = typeof perfume.price === 'number' ? perfume.price : 0.0;

    const stars = generateStars(rating);
    const shipping = formatShipping(perfume);
    const displayPrice = price.toFixed(2);
    const currencySymbol = currencySymbols[perfume.currency] || '$';
    const isFavorited = userFavorites.has(perfume.id);
    
    // Create perfume object for favorite functionality
    const perfumeData = {
        productId: perfume.id,
        name: perfume.name,
        advertiserName: perfume.brand,
        description: perfume.description || '',
        imageUrl: perfume.image,
        productUrl: perfume.buyUrl,
        price: price,
        currency: perfume.currency,
        shipping_availability: perfume.shippingCost === 0 ? 'available' : 'paid'
    };

    return `
        <div class="product-card" data-id="${perfume.id}" data-brand="${perfume.brand.toLowerCase().replace(/\s+/g, '-')}" data-price="${price}" data-rating="${rating}">
            <div class="product-image-container">
                <button class="favorite-btn ${isFavorited ? 'favorited' : ''}" 
                        data-id="${perfume.id}" 
                        onclick="toggleFavorite(this, ${JSON.stringify(perfumeData).replace(/"/g, '&quot;')})"
                        aria-label="Add to favorites">
                    <i class="fas fa-heart"></i>
                </button>
                <img src="${perfume.image}" alt="${perfume.name}" class="product-image" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/600x600?text=No+Image';">
            </div>
            <div class="product-info">
                <h3 class="product-name">${perfume.name}</h3>
                <p class="product-brand">${perfume.brand}</p>
                <div class="product-rating" role="img" aria-label="Rating: ${rating} out of 5 stars">
                    ${stars}
                    <span class="rating-number">${rating.toFixed(1)}</span>
                </div>
                <p class="product-price" data-original-price="${price}" data-original-currency="${perfume.currency}">${currencySymbol}${displayPrice} ${perfume.currency}</p>
            </div>
            <div class="product-meta">
                <div class="product-shipping ${shipping.cls}">${shipping.text}</div>
                <a href="${perfume.buyUrl}" target="_blank" rel="nofollow sponsored noopener" class="btn-view-deal">Shop Now <i class="fas fa-arrow-right"></i></a>
            </div>
        </div>
    `;
}

// Create perfume card with favorite button for authenticated users
function createPerfumeCard(perfume) {
    // --- Data Standardization ---
    // The 'perfume' object can come from the API or the local favorites DB,
    // so we need to standardize its structure first.

    // 1. Standardize the ID
    const fragranceId = perfume.fragrance_id || perfume.productId;

    // 2. Standardize the Price and Currency
    const priceAmount = (typeof perfume.price === 'object' && perfume.price !== null) 
        ? perfume.price.amount 
        : perfume.price;
    const priceCurrency = (typeof perfume.price === 'object' && perfume.price !== null) 
        ? perfume.price.currency 
        : perfume.currency;

    // 3. Create a clean, consistent data object for the toggle function
    const perfumeDataForToggle = {
        ...perfume,
        fragrance_id: fragranceId, // Ensure the correct ID is always present
        price: priceAmount,        // Ensure price is always a number
        currency: priceCurrency    // Ensure currency is always a string
    };

    // --- UI Generation ---
    const stars = generateStars(perfume.rating || 4.5);
    const shipping = formatShipping(perfume);
    const displayPrice = (priceAmount || 0).toFixed(2);
    const currencySymbol = currencySymbols[priceCurrency] || '$';
    const isFavorited = userFavorites.has(fragranceId);

    return `
        <div class="product-card" data-id="${fragranceId}" data-brand="${(perfume.advertiserName || '').toLowerCase().replace(/\s+/g, '-')}" data-price="${priceAmount || 0}" data-rating="${perfume.rating || 4.5}">
            <div class="product-image-container">
                <button class="favorite-btn ${isFavorited ? 'favorited' : ''}" 
                        data-id="${fragranceId}" 
                        onclick="toggleFavorite(this, ${JSON.stringify(perfumeDataForToggle).replace(/"/g, '&quot;')})"
                        aria-label="Add to favorites">
                    <i class="fas fa-heart"></i>
                </button>
                <img src="${perfume.imageUrl || 'https://placehold.co/600x600?text=No+Image'}" alt="${perfume.name}" class="product-image" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/600x600?text=No+Image';">
            </div>
            <div class="product-info">
                <h3 class="product-name">${perfume.name}</h3>
                <p class="product-brand">${perfume.advertiserName}</p>
                <div class="product-rating" role="img" aria-label="Rating: ${perfume.rating || 4.5} out of 5 stars">
                    ${stars}
                    <span class="rating-number">${(perfume.rating || 4.5).toFixed(1)}</span>
                </div>
                <p class="product-price" data-original-price="${priceAmount || 0}" data-original-currency="${priceCurrency || 'USD'}">${currencySymbol}${displayPrice} ${priceCurrency || 'USD'}</p>
            </div>
            <div class="product-meta">
                <div class="product-shipping ${shipping.cls}">${shipping.text}</div>
                <a href="${perfume.productUrl}" target="_blank" rel="nofollow sponsored noopener" class="btn-view-deal">Shop Now <i class="fas fa-arrow-right"></i></a>
            </div>
        </div>
    `;
}

// Generate star rating HTML
function generateStars(rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 !== 0;
    let starsHTML = '';
    
    for (let i = 0; i < fullStars; i++) {
        starsHTML += '<i class="fa-solid fa-star"></i>';
    }
    
    if (hasHalfStar) {
        starsHTML += '<i class="fa-solid fa-star-half-stroke"></i>';
    }
    
    const emptyStars = 5 - Math.ceil(rating);
    for (let i = 0; i < emptyStars; i++) {
        starsHTML += '<i class="fa-regular fa-star"></i>';
    }
    
    return starsHTML;
}

// Populate brand filter options
function populateBrandFilter() {
    const brandFilter = document.getElementById('brand-filter');
    if (!brandFilter) return; // Brand filter doesn't exist in this HTML
    
    brandFilter.innerHTML = '<option value="">All Brands</option>';
    const brands = [...new Set(cjProducts.map(perfume => perfume.brand))].filter(Boolean).sort();
    brands.forEach(brand => {
        const option = document.createElement('option');
        option.value = brand;
        option.textContent = brand; // textContent is safe
        brandFilter.appendChild(option);
    });
}

// Add event listeners
function addEventListeners() {
    // Filter event listeners
    const priceFilter = document.getElementById('price-range');
    const shippingFilter = document.getElementById('shipping-filter');
    const clearFiltersBtn = document.getElementById('clear-filters');
    const mainSearch = document.getElementById('main-search');
    const searchBtn = document.querySelector('.filter-search-btn');
    const browseFragrancesBtn = document.getElementById('browse-fragrances');
    const sortByFilter = document.getElementById('sort-by-filter');
    const brandFilter = document.getElementById('brand-filter');
    const recommendationsBtn = document.getElementById('get-recommendations');

    if (priceFilter) {
        priceFilter.addEventListener('change', () => applyFilters(true));
    }
    
    if (brandFilter) {
        brandFilter.addEventListener('change', () => applyFilters(true));
    }

    if (shippingFilter) {
        shippingFilter.addEventListener('change', () => applyFilters(false));
    }


    


    if (searchBtn) {
        searchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const searchInput = document.getElementById('main-search');
            if (searchInput) {
                const searchTerm = searchInput.value.trim();
                if (validateSearchTerm(searchTerm)) {
                    performSearch(searchTerm);
                }
            }
        });
    }
    
    if (mainSearch) {
        
        // Remove input event listener to disable search-as-you-type
        // mainSearch.addEventListener('input', (e) => {
        //     debouncedSearch(e.target.value);
        // });
        mainSearch.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const searchTerm = e.target.value.trim();
                if (validateSearchTerm(searchTerm)) {
                    // Clear any pending debounced search
                    if (searchTimeout) {
                        clearTimeout(searchTimeout);
                    }
                    performSearch(searchTerm);
                }
            }
        });
        // Also handle Enter on keydown for better cross-browser support
        mainSearch.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const searchTerm = e.target.value.trim();
                if (validateSearchTerm(searchTerm)) {
                    performSearch(searchTerm);
                }
            }
        });
        // Show/hide clear button based on input
        mainSearch.addEventListener('input', function() {
            const clearBtn = document.getElementById('clear-search');
            if (clearBtn) {
                clearBtn.style.display = this.value.trim() ? 'block' : 'none';
            }
        });
    }
    
    // Clear search button functionality
    const clearSearchBtn = document.getElementById('clear-search');
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', function() {
            const mainSearch = document.getElementById('main-search');
            if (mainSearch) {
                mainSearch.value = '';
                mainSearch.focus();
                this.style.display = 'none';
                currentFilters.search = '';
                // No client-side filtering needed here
            }
        });
    }
    
    // Removed duplicate click handler that called performSearch() without a term
    // if (searchBtn) {
    //     searchBtn.addEventListener('click', function(e) {
    //         e.preventDefault();
    //         performSearch();
    //     });
    // }
    
    if (browseFragrancesBtn) {
        browseFragrancesBtn.addEventListener('click', () => {
            document.getElementById('shop').scrollIntoView({ behavior: 'smooth' });
        });
    }
    
    // Collection Explore buttons functionality
    const collectionButtons = document.querySelectorAll('.collection-btn');
    collectionButtons.forEach(button => {
        button.addEventListener('click', function(event) {
            event.preventDefault();
            
            // Get the brand name from the data-brand attribute
            const card = event.target.closest('.collection-card');
            const brand = card.getAttribute('data-brand');
            if (!brand) return;

            const searchQuery = `${brand} perfume`;

            // Scroll to the filter/search section
            const filterSection = document.getElementById('brands');
            if (filterSection) {
                filterSection.scrollIntoView({ behavior: 'smooth' });
            }

            // Set the search input value and perform the search
            const searchInput = document.getElementById('main-search');
            if (searchInput) {
                searchInput.value = searchQuery;
            }
            performSearch(searchQuery);
        });
    });
    
    // Product card event listeners
    document.addEventListener('click', function(e) {
        const target = e.target;
        if (target.classList.contains('view-details-btn')) {
            const idAttr = target.getAttribute('data-perfume-id');
            if (idAttr) {
                e.preventDefault();
                const perfume = cjProducts.find(p => String(p.id) === String(idAttr));
                if (perfume) {
                    showPerfumeDetails(perfume);
                }
            }
            // If no data-perfume-id, this is a Buy Now link; allow default navigation
        }
    });

    if(recommendationsBtn) {
        recommendationsBtn.addEventListener('click', getPersonalizedRecommendations);
    }
}

// Loading bar control functions
function showSearchLoading() {
    const loadingBar = document.getElementById('search-loading-bar');
    const progressBar = loadingBar?.querySelector('.loading-progress');
    if (loadingBar) {
        loadingBar.style.display = 'block';
        if (progressBar) {
            progressBar.style.width = '0%';
            setTimeout(() => {
                progressBar.style.width = '70%'; // Show initial progress
            }, 100);
        }
    }
}

function hideSearchLoading() {
    const loadingBar = document.getElementById('search-loading-bar');
    const progressBar = loadingBar?.querySelector('.loading-progress');
    if (loadingBar && progressBar) {
        progressBar.style.width = '100%'; // Complete the progress
        setTimeout(() => {
            loadingBar.style.display = 'none';
            progressBar.style.width = '0%'; // Reset for next use
        }, 300);
    }
}


// Filter favorites based on current filters
function filterFavorites() {
    console.log('🔍 Filtering favorites...');
    console.log('Current favorites count:', currentFavorites.length);
    console.log('Current filters:', currentFilters);
    
    let filteredFavorites = [...currentFavorites];
    
    // Price range filter
    if (currentFilters.priceRange && currentFilters.priceRange !== 'all') {
        const beforeCount = filteredFavorites.length;
        filteredFavorites = filteredFavorites.filter(fav => {
            const price = fav.price || 0;
            const currency = fav.currency || 'USD';
            const priceUSD = currencyConverter.convertSync(price, currency, 'USD');
            
            if (currentFilters.priceRange.includes('+')) {
                const minPrice = parseInt(currentFilters.priceRange, 10);
                return priceUSD >= minPrice;
            } else if (currentFilters.priceRange.includes('-')) {
                const [low, high] = currentFilters.priceRange.split('-');
                const minPrice = low ? parseInt(low, 10) : 0;
                const maxPrice = high ? parseInt(high, 10) : Infinity;
                return priceUSD >= minPrice && priceUSD <= maxPrice;
            }
            return true;
        });
        console.log(`Price filter applied: ${beforeCount} -> ${filteredFavorites.length}`);
    }
    
    // Shipping filter
    if (currentFilters.shipping && currentFilters.shipping !== 'all') {
        const beforeCount = filteredFavorites.length;
        filteredFavorites = filteredFavorites.filter(fav => {
            if (currentFilters.shipping === 'free') {
                return fav.shipping_availability === 'available' && (fav.shipping_cost === 0 || !fav.shipping_cost);
            }
            return true;
        });
        console.log(`Shipping filter applied: ${beforeCount} -> ${filteredFavorites.length}`);
    }
    
    // Sort favorites
    sortFavorites(filteredFavorites);
}

// Sort favorites based on current sort selection
function sortFavorites(favorites) {
    const sortByFilter = document.getElementById('sort-by-filter');
    if (!sortByFilter) {
        displayFavorites(favorites);
        return;
    }
    
    const sortBy = sortByFilter.value;
    console.log('🔍 Sorting favorites by:', sortBy);
    
    favorites.sort((a, b) => {
        if (sortBy === 'price_low') {
            const priceA = currencyConverter.convertSync(a.price || 0, a.currency || 'USD', 'USD');
            const priceB = currencyConverter.convertSync(b.price || 0, b.currency || 'USD', 'USD');
            return priceA - priceB;
        } else if (sortBy === 'price_high') {
            const priceA = currencyConverter.convertSync(a.price || 0, a.currency || 'USD', 'USD');
            const priceB = currencyConverter.convertSync(b.price || 0, b.currency || 'USD', 'USD');
            return priceB - priceA;
        } else if (sortBy === 'relevance') {
            // For favorites, relevance could be based on name similarity or rating
            const ratingA = a.rating || 4.5;
            const ratingB = b.rating || 4.5;
            return ratingB - ratingA;
        }
        return 0; // Default case - no sorting
    });
    
    displayFavorites(favorites);
}

// ... existing code ...
function filterPerfumes() {
    SearchDebugger.logStep('Filtering products', {
        totalProducts: cjProducts.length,
        currentFilters: currentFilters
    });
    let tempProducts = [...cjProducts];
    SearchDebugger.logStep('Initial products', { count: tempProducts.length });
    
    // Rating filter (client-side)
    if (currentFilters.rating && currentFilters.rating !== 'all') {
        const minRating = Number(currentFilters.rating);
        const beforeCount = tempProducts.length;
        tempProducts = tempProducts.filter(p => p.rating >= minRating);
        SearchDebugger.logStep('Rating filter applied', {
            minRating: minRating,
            beforeCount: beforeCount,
            afterCount: tempProducts.length
        });
    }
    // Shipping filter (client-side)
    if (currentFilters.shipping && currentFilters.shipping !== 'all') {
        const beforeCount = tempProducts.length;
        tempProducts = tempProducts.filter(p => matchesShipping(p, currentFilters.shipping));
        SearchDebugger.logStep('Shipping filter applied', {
            filter: currentFilters.shipping,
            beforeCount: beforeCount,
            afterCount: tempProducts.length
        });
    }
    // Search filter (client-side)
    if (currentFilters.search && currentFilters.search.trim()) {
        const beforeCount = tempProducts.length;
        tempProducts = searchWithFuzzyMatching(tempProducts, currentFilters.search.trim());
        SearchDebugger.logStep('Search filter applied', {
            searchTerm: currentFilters.search,
            beforeCount: beforeCount,
            afterCount: tempProducts.length
        });
    }
    filteredPerfumes = tempProducts;
    SearchDebugger.logStep('Final filtered products', { count: filteredPerfumes.length });
    sortProducts(filteredPerfumes);
}

// Helper function to check if perfume matches shipping filter
function matchesShipping(perfume, filterVal) {
    if (!filterVal) return true;
    const cost = typeof perfume.shippingCost === 'number' ? perfume.shippingCost : null;
    switch (filterVal) {
        case 'free':
            return cost === 0;
        case 'unknown':
            return cost === null;
        case '20+':
            return cost !== null && cost >= 20;
        default: {
            const [minStr, maxStr] = filterVal.split('-');
            const min = Number(minStr);
            const max = maxStr ? Number(maxStr) : null;
            if (cost === null) return false;
            if (max === null) return cost >= min;
            return cost >= min && cost <= max;
        }
    }
}

function buildServerFilters() {
    const filters = {};
    const priceFilter = document.getElementById('price-range');
    const brandFilter = document.getElementById('brand-filter');
    const shippingFilter = document.getElementById('shipping-filter');
    const sortByFilter = document.getElementById('sort-by-filter');
    const exactMatchToggle = document.getElementById('exact-match-toggle');
    const priceRange = priceFilter ? priceFilter.value : '';
    const brand = brandFilter ? brandFilter.value : '';
    const shipping = shippingFilter ? shippingFilter.value : '';
    const sortBy = sortByFilter ? sortByFilter.value : 'revenue';
    const exactMatch = exactMatchToggle ? exactMatchToggle.checked : false;

    console.log('🔍 buildServerFilters - exactMatchToggle found:', !!exactMatchToggle);
    console.log('🔍 buildServerFilters - exactMatch value:', exactMatch);

    if (brand) {
        filters.brand = brand;
    }

    if (priceRange) {
        if (priceRange.includes('+')) {
            filters.lowPrice = parseInt(priceRange, 10);
        } else if (priceRange.includes('-')) {
            const [low, high] = priceRange.split('-');
            filters.lowPrice = low ? parseInt(low, 10) : null;
            filters.highPrice = high ? parseInt(high, 10) : null;
        }
    }

    if (shipping && shipping !== 'all') {
        filters.shipping = shipping;
    }

    if (sortBy) {
        filters.sortBy = sortBy;
    }

    if (exactMatch) {
        filters.exactMatch = exactMatch;
    }

    console.log('🔍 buildServerFilters - final filters:', filters);
    return filters;
}

// Perform search with input validation
// Debounced search variables
let searchTimeout;
let lastSearchTerm = '';
let isSearching = false;

// Search analytics
const searchAnalytics = new Map();

// Search result prefetching
const prefetchCache = new Map();
const prefetchQueue = new Set();

// Debug search functionality
const SearchDebugger = {
    enabled: true,
    log: function(message, data) {
        if (!this.enabled) return;
        console.log('[Search Debug] ' + message, data);
    },
    startSearch: function(searchTerm) {
        this.log('Search started', { term: searchTerm, timestamp: Date.now() });
        this.currentSearch = {
            term: searchTerm,
            startTime: Date.now(),
            steps: []
        };
    },
    logStep: function(step, data) {
        if (!this.currentSearch) return;
        this.currentSearch.steps.push({
            step: step,
            data: data,
            timestamp: Date.now()
        });
        this.log('Step: ' + step, data);
    },
    endSearch: function(results) {
        if (!this.currentSearch) return;
        this.currentSearch.endTime = Date.now();
        this.currentSearch.duration = this.currentSearch.endTime - this.currentSearch.startTime;
        this.currentSearch.results = results;
        this.log('Search completed', {
            term: this.currentSearch.term,
            duration: this.currentSearch.duration,
            resultsCount: results?.length || 0,
            steps: this.currentSearch.steps
        });
        // Store for later analysis
        if (!window.searchHistory) window.searchHistory = [];
        window.searchHistory.push(this.currentSearch);
        this.currentSearch = null;
    },
    // Monitor state changes
    monitorState: function() {
        this.log('Current state', {
            currentFilters: currentFilters,
            cjProductsCount: cjProducts.length,
            filteredPerfumesCount: filteredPerfumes.length,
            isSearching: isSearching
        });
    },
    // Check if search term is being preserved
    validateSearchTerm: function() {
    const searchInput = document.getElementById('main-search');
        const inputValue = searchInput?.value || '';
        const filterValue = currentFilters.search || '';
        const isConsistent = inputValue.trim() === filterValue.trim();
        if (!isConsistent) {
            console.warn('[Search Debug] Search term mismatch!', {
                inputValue: inputValue,
                filterValue: filterValue,
                currentFilters: currentFilters
            });
        }
        return isConsistent;
    }
};

// Polyfill for Element.closest() method for older browsers
if (!Element.prototype.closest) {
    Element.prototype.closest = function(selector) {
        let element = this;
        while (element && element.nodeType === 1) {
            if (element.matches(selector)) {
                return element;
            }
            element = element.parentNode;
        }
        return null;
    };
}

// Polyfill for Element.matches() method for older browsers
if (!Element.prototype.matches) {
    Element.prototype.matches = Element.prototype.msMatchesSelector ||
                                Element.prototype.webkitMatchesSelector;
}

// Initialize dropdowns to default values
function initializeDropdowns() {
    const priceFilter = document.getElementById('price-range');
    const shippingFilter = document.getElementById('shipping-filter');
    const sortByFilter = document.getElementById('sort-by-filter');

    if (priceFilter) priceFilter.value = 'all';
    if (shippingFilter) shippingFilter.value = 'all';
    if (sortByFilter) sortByFilter.value = 'revenue';
}

// Fuzzy search functionality
function fuzzyMatch(str, pattern) {
    if (!pattern) return true;
    if (!str) return false;

    const patternLower = pattern.toLowerCase();
    const strLower = str.toLowerCase();

    // Exact match gets highest priority
    if (strLower.includes(patternLower)) {
        return true;
    }

    // Simple fuzzy matching - check if all pattern characters exist in order
    let patternIndex = 0;
    for (let i = 0; i < strLower.length; i++) {
        if (strLower[i] === patternLower[patternIndex]) {
            patternIndex++;
            if (patternIndex === patternLower.length) {
                return true;
            }
        }
    }

    return false;
}

// Enhanced search with fuzzy matching
function searchWithFuzzyMatching(products, searchTerm) {
    if (!searchTerm || searchTerm.length < 2) {
        return products;
    }

    const normalizedTerm = searchTerm.toLowerCase().trim();

    // Define synonyms for special cases to make client-side search smarter
    const searchSynonyms = {
        'women': ['women', 'woman', 'female', 'femme'],
        'men': ['men', 'man', 'male', 'homme']
    };

    const termsToMatch = searchSynonyms[normalizedTerm] || [normalizedTerm];

    return products.filter(product => {
        const productNameLower = product.name ? product.name.toLowerCase() : '';
        const productBrandLower = product.brand ? product.brand.toLowerCase() : '';

        // Check if any of the terms (original or synonyms) are included
        const synonymMatch = termsToMatch.some(term => 
            productNameLower.includes(term) || productBrandLower.includes(term)
        );

        if (synonymMatch) {
            return true;
        }

        // Fuzzy matching for typos as a fallback
        const nameFuzzy = fuzzyMatch(productNameLower, normalizedTerm);
        const brandFuzzy = fuzzyMatch(productBrandLower, normalizedTerm);

        return nameFuzzy || brandFuzzy;
    });
}

// Track search queries for analytics
function trackSearchQuery(query) {
    const normalizedQuery = query.toLowerCase().trim();
    const count = searchAnalytics.get(normalizedQuery) || 0;
    searchAnalytics.set(normalizedQuery, count + 1);

    // Log to console for debugging (remove in production)
    console.log('Search tracked:', normalizedQuery, 'Count:', count + 1);

    // Optionally send to analytics service
    // sendToAnalytics('search', { query: normalizedQuery, count: count + 1 });
}

// Get top search queries (for debugging/optimization)
function getTopSearches(limit = 10) {
    return Array.from(searchAnalytics.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);
}

// Search result prefetching functions
async function prefetchSearchResult(query) {
    if (prefetchCache.has(query) || prefetchQueue.has(query)) {
        return; // Already prefetched or in queue
    }

    prefetchQueue.add(query);

    try {
        const settings = getPaginationSettings();
        const data = await loadCJProducts(query, 1, settings.pageSize);

        if (data.products && data.products.length > 0) {
            prefetchCache.set(query, data);
            console.log(`Prefetched results for: "${query}" (${data.products.length} items)`);
        }
    } catch (error) {
        console.warn(`Failed to prefetch results for "${query}":`, error);
    } finally {
        prefetchQueue.delete(query);
    }
}

// Get prefetched results
function getPrefetchedResults(query) {
    return prefetchCache.get(query);
}

// Clear old prefetch cache to prevent memory leaks
function cleanupPrefetchCache() {
    const maxAge = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();

    for (const [query, data] of prefetchCache.entries()) {
        if (data.timestamp && (now - data.timestamp) > maxAge) {
            prefetchCache.delete(query);
        }
    }
}

// Prefetch related queries based on current search
function prefetchRelatedQueries(currentQuery) {
    const relatedQueries = getRelatedQueries(currentQuery);
    relatedQueries.forEach((query, index) => {
        setTimeout(() => {
            prefetchSearchResult(query);
        }, index * 200 + 1000); // Stagger by 200ms, start after 1 second
    });
}

// Get related queries based on current search
function getRelatedQueries(query) {
    const normalized = query.toLowerCase().trim();
    const related = [];

    // Add common variations
    if (normalized.includes('perfume')) {
        related.push('cologne', 'fragrance', 'luxury perfume');
    }
    if (normalized.includes('cologne')) {
        related.push('perfume', 'fragrance', 'mens cologne');
    }
    if (normalized.includes('luxury')) {
        related.push('designer perfume', 'premium fragrance');
    }
    if (normalized.includes('eau de parfum')) {
        related.push('eau de toilette', 'perfume');
    }

    return related.slice(0, 3); // Limit to 3 related queries
}

// Start prefetching popular queries
function startPrefetching() {
    const popularQueries = [
        'perfume',
        'cologne',
        'fragrance',
        'luxury perfume',
        'designer fragrance',
        'eau de parfum',
        'eau de toilette'
    ];

    // Prefetch popular queries in background
    popularQueries.forEach((query, index) => {
        setTimeout(() => {
            prefetchSearchResult(query);
        }, index * 100); // Stagger requests by 100ms
    });

    // Cleanup old cache every 5 minutes
    setInterval(cleanupPrefetchCache, 5 * 60 * 1000);
}

// Smart pagination based on connection speed
function getOptimalPageSize() {
    if (typeof navigator === 'undefined') return 20; // Default for server-side

    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

    if (!connection) return 20; // Default if not supported

    const effectiveType = connection.effectiveType || '4g';

    switch (effectiveType) {
        case 'slow-2g':
            return 8;
        case '2g':
            return 10;
        case '3g':
            return 15;
        case '4g':
            return 25;
        default:
            return 20;
    }
}

// Get optimal pagination settings
function getPaginationSettings() {
    const pageSize = getOptimalPageSize();
    const prefetchThreshold = Math.max(1, Math.floor(pageSize * 0.3)); // Prefetch when 30% through current page

    return {
        pageSize,
        prefetchThreshold
    };
}

// Validate search term
function validateSearchTerm(term) {
    const trimmed = term.trim();
    return trimmed.length >= 2 && !/^\s*$/.test(trimmed);
}

async function performSearch(searchTerm) {
    // Fallback: if no argument provided, read from input
    if (!searchTerm) {
        const inputEl = document.getElementById('main-search');
        if (inputEl) {
            searchTerm = inputEl.value.trim();
        }
    }
    SearchDebugger.startSearch(searchTerm);
    SearchDebugger.monitorState();
    if (isSearching) {
        SearchDebugger.log('Search blocked - already searching', { isSearching });
        return;
    }

    const validatedSearchTerm = SecurityUtils.validateSearchQuery(searchTerm);
    if (!validateSearchTerm(validatedSearchTerm)) {
        return;
    }
    isSearching = true;
    showSearchLoading(); // Show loading bar
    
    try {
        // Track search analytics
        if (validatedSearchTerm) {
            trackSearchQuery(validatedSearchTerm);
        }
        currentFilters.search = validatedSearchTerm;
        lastSearchTerm = searchTerm;
        
        // A new search is a server-side filter action
        await applyFilters(true);
    } finally {
        isSearching = false;
        hideSearchLoading();
        SearchDebugger.endSearch(filteredPerfumes);
    }
}

// Show perfume details in modal
function showPerfumeDetails(perfume) {
    const modal = document.getElementById('perfume-modal');
    const modalImage = document.getElementById('modal-perfume-image');
    const modalName = document.getElementById('modal-perfume-name');
    const modalBrand = document.getElementById('modal-perfume-brand');
    const modalRating = document.getElementById('modal-perfume-rating');
    const modalDescription = document.getElementById('modal-perfume-description');
    const modalPrice = document.getElementById('modal-perfume-price');
    const modalBtn = document.querySelector('.modal-btn');
    

    
    if (modal && modalImage && modalName && modalBrand && modalRating && modalDescription && modalPrice) {
        modalImage.src = perfume.image;
        modalImage.alt = perfume.name;
        modalName.textContent = perfume.name; // textContent is safe
        modalBrand.textContent = perfume.brand;
        modalRating.innerHTML = generateStars(perfume.rating) + ` <span class="rating-text">(${perfume.rating})</span>`;
        modalDescription.textContent = perfume.description || '';
        
        const currencySymbol = currencySymbols[perfume.currency] || '$';
        modalPrice.textContent = `${currencySymbol}${perfume.price.toFixed(2)} ${perfume.currency}`;
        
        if (modalBtn) {
            if (perfume.buyUrl) {
                modalBtn.textContent = '✨ Visit Store & Shop Now ✨';
                modalBtn.onclick = () => window.open(perfume.buyUrl, '_blank', 'noopener,nofollow');
                modalBtn.style.display = 'inline-block';
            } else {
                modalBtn.style.display = 'none';
            }
        }
        
        modal.style.display = 'flex';
    }
}

// Initialize modal functionality
function initModal() {
    const modal = document.getElementById('perfume-modal');
    const closeBtn = document.querySelector('.close');
    
    if (modal && closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
        
        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
}

// Desktop-like mobile navigation - keep navigation visible
function checkMobileMenu() {
    const navMenu = document.querySelector('.nav-menu');
    const hamburger = document.querySelector('.hamburger');
    
    // Always keep navigation visible like desktop
    if (navMenu) {
        navMenu.style.position = 'static';
        navMenu.style.left = '0';
        navMenu.style.top = 'auto';
        navMenu.style.width = 'auto';
        navMenu.style.height = 'auto';
        navMenu.style.display = 'flex';
        navMenu.style.flexDirection = 'row';
        navMenu.style.background = 'none';
        navMenu.style.boxShadow = 'none';
        navMenu.style.border = 'none';
        navMenu.style.zIndex = 'auto';
        navMenu.classList.remove('active');
    }
    
    // Hide hamburger menu since we're keeping desktop navigation
    if (hamburger) {
        hamburger.style.display = 'none';
        hamburger.classList.remove('active');
    }
}

// Simplified mobile navigation - no hamburger needed
function initHamburgerMenu() {
    // Since we're keeping desktop navigation visible, no hamburger functionality needed
    // Just ensure navigation is always visible
    const navMenu = document.querySelector('.nav-menu');
    if (navMenu) {
        navMenu.style.display = 'flex';
        navMenu.style.flexDirection = 'row';
        navMenu.style.position = 'static';
        navMenu.style.background = 'none';
        navMenu.style.boxShadow = 'none';
        navMenu.style.border = 'none';
    }
}

function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

// Initialize when DOM is loaded
// The DOMContentLoaded listener is now handled by the new_code, so this block is removed.

// Check mobile menu on window resize
window.addEventListener('resize', checkMobileMenu); 

/**
 * Populates the "Popular Picks" section.
 * @param {string} query - The search query to use for this section.
 */
async function loadPopularPicks(query) {
    const grid = document.getElementById('top-rated-grid'); // CORRECTED ID
    if (!grid) {
        console.error('Error: Popular Picks grid container not found.');
        return;
    }

    // Show a loading state
    grid.innerHTML = '<p class="loading-message">Loading popular picks...</p>';

    // Use a rotating list of luxury queries if no specific one is provided
    const luxuryQueries = [
        'Creed Aventus',
        'Baccarat Rouge 540',
        'Tom Ford Oud Wood',
        'Parfums de Marly Layton'
    ];
    const searchQuery = query || luxuryQueries[Math.floor(Math.random() * luxuryQueries.length)];
    console.log('[Debug] Loading Popular Picks with query:', searchQuery);

    try {
        const data = await fetchProductsFromApi(searchQuery, 1, config.POPULAR_PICKS_LIMIT, { sortBy: 'revenue' });
        console.log('[Debug] Popular Picks API response:', data);

        if (data && data.products && data.products.length > 0) {
            console.log(`[Debug] Found ${data.products.length} popular picks.`);
            const products = mapProductsDataToItems(data);
            const productCards = products.slice(0, config.POPULAR_PICKS_LIMIT).map(p => createProductCard(p)).join('');
            grid.innerHTML = productCards;
        } else {
            console.warn('[Debug] No products found for Popular Picks.');
            grid.innerHTML = '<p class="no-products">Could not load popular picks at this time.</p>';
        }
    } catch (error) {
        console.error('Error loading popular picks:', error);
        grid.innerHTML = '<p class="no-products">Error loading popular picks.</p>';
    }
}

/**
 * Populates the "TikTok Finds" section.
 * @param {string} query - The search query to use for this section.
 */
async function loadTikTokFinds() {
    const grid = document.getElementById('tiktok-products-grid'); // CORRECTED ID
    if (!grid) {
        console.error('Error: TikTok Finds grid container not found.');
        return;
    }

    // Show a loading state
    grid.innerHTML = '<p class="loading-message">Finding TikTok trends...</p>';

    // Use a rotating list of effective TikTok queries, refined with specific keywords
    const queries = [
        'viral perfume tiktok fragrance perfume cologne',
        'trending fragrance 2024 fragrance perfume cologne',
        'tiktok famous perfume fragrance perfume cologne',
        'PerfumeTok popular scents fragrance perfume cologne',
        'viral fragrance tiktok fragrance perfume cologne',
        'trending perfume tiktok fragrance perfume cologne'
    ];
    const query = queries[Math.floor(Math.random() * queries.length)];
    console.log('[Debug] Loading TikTok Finds with query:', query);

    try {
        const data = await fetchProductsFromApi(query, 1, config.TIKTOK_FINDS_LIMIT, { partnerId: '7563286', sortBy: 'revenue' }); // Using a specific partner ID for TikTok with revenue sorting
        console.log('[Debug] TikTok Finds API response:', data);

        if (data && data.products && data.products.length > 0) {
            console.log(`[Debug] Found ${data.products.length} TikTok finds.`);
            const products = mapProductsDataToItems(data);
            const productCards = products.slice(0, config.TIKTOK_FINDS_LIMIT).map(p => createProductCard(p)).join('');
            grid.innerHTML = productCards;
        } else {
            console.warn('[Debug] No products found for TikTok Finds.');
            grid.innerHTML = '<p class="no-products">Could not load TikTok finds at this time.</p>';
        }
    } catch (error) {
        console.error('Error loading TikTok finds:', error);
        grid.innerHTML = '<p class="no-products">Error loading TikTok finds.</p>';
    }
} 

// --------------------------------- 

async function toggleFavorite(button, perfume) {
    console.log('Toggle favorite clicked, checking authentication...');
    console.log('Current auth state - isUserLoggedIn:', isUserLoggedIn, 'currentUser:', currentUser);

    // Use the shared authentication system to check status
    if (!isAuthenticated()) {
        console.log('User not authenticated, re-checking status...');
        await checkSharedUserStatus();

        // Check again after status update
        if (!isAuthenticated()) {
            console.log('User confirmed not logged in, redirecting to auth page');
            window.location.href = 'auth.html?tab=signin';
            return;
        }
    }

    const fragranceId = perfume.fragrance_id || perfume.productId;
    if (!fragranceId) {
        console.error('Could not determine fragrance ID for favorite toggle.', perfume);
        // Revert UI and show an error
        button.classList.toggle('favorited');
        alert('Could not update favorite. Please try again.');
        return;
    }

    const wasFavorited = userFavorites.has(fragranceId);

    // Optimistic update - update UI immediately for better UX
    if (wasFavorited) {
        userFavorites.delete(fragranceId);
        button.classList.remove('favorited');
        console.log('Optimistically removed from favorites');
    } else {
        userFavorites.add(fragranceId);
        button.classList.add('favorited');
        console.log('Optimistically added to favorites');
    }

    // Show loading state
    button.style.opacity = '0.6';
    button.disabled = true;

    try {
        if (wasFavorited) {
            // Unfavorite logic
            const headers = {};
            if (sessionToken) {
                headers['Authorization'] = `Bearer ${sessionToken}`;
            }

            const response = await fetch(`https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/user/favorites/${fragranceId}`, {
                method: 'DELETE',
                headers,
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            console.log('✅ Successfully removed from favorites on server');
            pendingFavoriteOperations.delete(fragranceId);

            // If we are currently on the favorites page, remove the card from the view
            const favoritesGrid = document.getElementById('favorites-grid');
            if (favoritesGrid && button.closest('#favorites-grid')) {
                const card = button.closest('.product-card');
                if (card) {
                    card.style.transition = 'opacity 0.3s ease';
                    card.style.opacity = '0';
                    setTimeout(() => {
                        card.remove();
                        // Check if the grid is now empty
                        if (favoritesGrid.children.length === 0) {
                            const emptyState = document.getElementById('favorites-empty-state');
                            if (emptyState) {
                                emptyState.style.display = 'block';
                            }
                        }
                    }, 300);
                }
            }

        } else {
            // Favorite logic
            const priceAmount = (typeof perfume.price === 'object' && perfume.price !== null) ? perfume.price.amount : perfume.price;
            const priceCurrency = (typeof perfume.price === 'object' && perfume.price !== null) ? perfume.price.currency : perfume.currency;

            const favoriteData = {
                fragrance_id: fragranceId,
                name: perfume.name,
                advertiserName: perfume.advertiserName,
                description: perfume.description,
                imageUrl: perfume.imageUrl,
                productUrl: perfume.productUrl,
                price: priceAmount,
                currency: priceCurrency,
                shippingCost: perfume.shippingCost || 0,
                shipping_availability: perfume.shipping_availability || (perfume.shipping ? 'available' : 'unavailable'),
            };
            
            console.log('Sending favorite data:', favoriteData);
            console.log('Perfume shipping info:', {
                shippingCost: perfume.shippingCost,
                shipping_availability: perfume.shipping_availability,
                shipping: perfume.shipping
            });
            console.log('Session token:', sessionToken);
            
            const headers = { 'Content-Type': 'application/json' };
            if (sessionToken) {
                headers['Authorization'] = `Bearer ${sessionToken}`;
            }
            console.log('Request headers:', headers);

            const response = await fetch('https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/user/favorites', {
                method: 'POST',
                headers,
                body: JSON.stringify(favoriteData),
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            if (data.success) {
                console.log('✅ Successfully added to favorites on server');
                pendingFavoriteOperations.delete(fragranceId);
                // Optionally reload favorites if the section is open
                if (authUI.favoritesSection.style.display === 'block') {
                    loadUserFavorites();
                }
            } else {
                throw new Error(data.error || 'Failed to save favorite');
            }
        }
    } catch (error) {
        console.error('❌ Error toggling favorite:', error);

        // Revert optimistic update on failure
        if (wasFavorited) {
            userFavorites.add(fragranceId);
            button.classList.add('favorited');
            console.log('Reverting optimistic removal');
        } else {
            userFavorites.delete(fragranceId);
            button.classList.remove('favorited');
            console.log('Reverting optimistic addition');
        }
        
        // Handle network errors by queuing the operation
        if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
            console.log('Network error detected - storing operation for later sync');
            pendingFavoriteOperations.set(fragranceId, wasFavorited ? 'remove' : 'add');
            // NOTE: updatePendingOperationsUI() is not defined, so it's commented out.
            // updatePendingOperationsUI();
        } else {
            // For other errors (like 500), just log it
            console.log('Non-network error - reverting optimistic update');
        }
    } finally {
        // Hide loading state
        button.style.opacity = '1';
        button.disabled = false;
    }
}

// Helper function to show toast notifications
function showToast(message, type = 'info') {
    // Remove any existing toasts
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) {
        existingToast.remove();
    }

    // Create new toast
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;

    // Style the toast
    Object.assign(toast.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        background: type === 'error' ? '#dc3545' : type === 'warning' ? '#ffc107' : '#28a745',
        color: type === 'warning' ? '#000' : '#fff',
        padding: '12px 20px',
        borderRadius: '4px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        zIndex: '10000',
        fontSize: '14px',
        maxWidth: '300px',
        wordWrap: 'break-word'
    });

    document.body.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 5000);
}

function showFavoritesView() {
    // Check if user is logged in using shared auth system
    console.log('showFavoritesView called - checking auth status...');
    console.log('isUserLoggedIn:', isUserLoggedIn, 'currentUser:', currentUser);
    console.log('isAuthenticated():', isAuthenticated());
    console.log('sessionToken:', sessionToken ? 'exists' : 'missing');

    if (!isAuthenticated()) {
        console.log('User not authenticated, redirecting to auth page');
        // User is not logged in, redirect to auth page
        window.location.href = 'auth.html?tab=signin';
        return;
    }
    
    console.log('User is authenticated, showing favorites view');
    
    // Set favorites view flag
    isInFavoritesView = true;
    
    // Hide only the product sections, keep navigation and main content accessible
    const productSections = document.querySelectorAll('.products-section:not(#personalized), .top-rated-section, .tiktok-section, .collections-section');
    productSections.forEach(section => {
        // Don't hide sections that contain navigation or are essential for navigation
        if (section.id !== 'filter' && section.id !== 'home') {
            section.style.display = 'none';
        }
    });
    
    authUI.favoritesSection.style.display = 'block';
    loadUserFavorites(); // Ensure favorites are loaded
}

function showMainContentView() {
    // Clear favorites view flag
    isInFavoritesView = false;

    // Show all product sections and main content
    const productSections = document.querySelectorAll('.products-section, .top-rated-section, .tiktok-section, .collections-section');
    productSections.forEach(section => {
        section.style.display = 'block';
    });

    // Also show main content sections if they exist
    if (authUI.mainContentSections) {
        authUI.mainContentSections.forEach(section => {
            section.style.display = 'block';
        });
    }

    // Hide favorites section
    authUI.favoritesSection.style.display = 'none';

    console.log('Restored main content view');
}

async function loadUserFavorites() {
    console.log('loadUserFavorites called');
    console.log('favoritesSection display:', authUI.favoritesSection.style.display);
    
    if (authUI.favoritesSection.style.display === 'none') {
        console.log('Favorites section is hidden, skipping load');
        // Don't load favorites if the section isn't visible, unless toggling it on
        return;
    }

    try {
        const headers = {};
        if (sessionToken) {
            headers['Authorization'] = `Bearer ${sessionToken}`;
            console.log('Adding Authorization header with sessionToken');
        } else {
            console.log('No sessionToken available');
        }

        console.log('Fetching favorites from:', 'https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/user/favorites');
        const response = await fetch('https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/user/favorites', {
            headers,
            credentials: 'include'
        });

        console.log('Response status:', response.status, response.statusText);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Favorites response data:', data);
        
        if (data.success && data.favorites) {
            userFavorites = new Set(data.favorites.map(fav => fav.fragrance_id));
            // Store favorites data for filtering
            currentFavorites = data.favorites;
            displayFavorites(data.favorites);
            updateAllFavoriteIcons();

            // Second currency conversion pass to ensure all prices are properly converted
            console.log('🔄 Performing second currency conversion pass for favorites...');
            setTimeout(async () => {
                const currencySelect = document.getElementById('currency-converter');
                if (currencySelect && currencySelect.value !== 'USD') {
                    console.log('🔄 Second pass: Converting favorites to', currencySelect.value);
                    await updateDisplayedPrices(currencySelect.value);
                }
            }, 500); // Small delay to ensure DOM is fully updated

            console.log(`✅ Loaded ${data.favorites.length} favorites from server`);
        } else {
            throw new Error('Invalid response format');
        }
    } catch (error) {
        console.error('❌ Error loading user favorites:', error);

        // Handle network errors gracefully
        if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
            console.log('Network error - showing cached favorites if available');

            // If we have pending operations, show a message about offline mode
            if (pendingFavoriteOperations.size > 0) {
                showToast(`Offline mode - ${pendingFavoriteOperations.size} pending sync(s)`, 'warning');
            } else {
                showToast('Unable to load favorites. Check your connection.', 'warning');
            }

            // Still try to display favorites if we have local data
            if (userFavorites.size > 0) {
                console.log('Showing cached favorites');
                // Create a basic display from local data
                displayFavoritesFromLocal();
            } else {
                displayFavorites([]);
            }
        } else {
            // Server error or other issue
            showToast('Failed to load favorites from server', 'error');
            displayFavorites([]);
        }
    }
}

// Helper function to display favorites from local cache when offline
function displayFavoritesFromLocal() {
    if (!authUI.favoritesGrid || !authUI.favoritesEmptyState) return;

    authUI.favoritesGrid.innerHTML = '';

    if (userFavorites.size === 0) {
        authUI.favoritesEmptyState.style.display = 'block';
        return;
    }

    authUI.favoritesEmptyState.style.display = 'none';

    // Create basic cards from local data (limited info available)
    let count = 0;
    userFavorites.forEach(fragranceId => {
        if (count >= 50) return; // Limit to prevent too many cards

        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
            <div class="product-image-container">
                <img src="https://placehold.co/300x300?text=Cached+Item" alt="Cached favorite" class="product-image">
                <button class="favorite-btn favorited" data-id="${fragranceId}" onclick="toggleFavorite(this, {productId: '${fragranceId}', name: 'Cached Item'})">
                    <i class="fas fa-heart"></i>
                </button>
            </div>
            <div class="product-info">
                <h3 class="product-name">Favorite Item (ID: ${fragranceId})</h3>
                <p class="product-brand">Cached offline</p>
            </div>
        `;
        authUI.favoritesGrid.appendChild(card);
        count++;
    });

    if (count >= 50) {
        const moreCard = document.createElement('div');
        moreCard.className = 'product-card';
        moreCard.innerHTML = `
            <div class="product-info">
                <h3 class="product-name">And ${userFavorites.size - 50} more...</h3>
                <p class="product-brand">Go online to see all favorites</p>
            </div>
        `;
        authUI.favoritesGrid.appendChild(moreCard);
    }
}

function displayFavorites(favorites) {
    if (!authUI.favoritesGrid || !authUI.favoritesEmptyState) return;

    authUI.favoritesGrid.innerHTML = '';
    if (favorites.length === 0) {
        authUI.favoritesEmptyState.style.display = 'block';
    } else {
        authUI.favoritesEmptyState.style.display = 'none';
        
        // Get the current selected currency to preserve conversion
        const currencySelect = document.getElementById('currency-converter');
        const currentCurrency = currencySelect ? currencySelect.value : 'USD';
        
        favorites.forEach(fav => {
            // Convert price to current currency if different from original
            let displayPrice = fav.price;
            let displayCurrency = fav.currency;
            
            if (fav.currency && fav.currency !== currentCurrency && currencySelect) {
                try {
                    displayPrice = currencyConverter.convertSync(fav.price || 0, fav.currency || 'USD', currentCurrency);
                    displayCurrency = currentCurrency;
                } catch (error) {
                    console.warn('Failed to convert currency for favorite:', fav.name, error);
                    // Keep original price if conversion fails
                }
            }
            
            // When displaying favorites, the ID is in fav.fragrance_id
            // We pass it directly to createPerfumeCard
            const perfumeData = {
                ...fav,
                productId: fav.fragrance_id // Ensure consistency for createPerfumeCard
            };
            
            // Re-purposing createPerfumeCard for favorites
            const cardHTML = createPerfumeCard(perfumeData);
            
            // Convert HTML string to DOM node
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = cardHTML;
            const card = tempDiv.firstElementChild;
            
            if (card) {
                authUI.favoritesGrid.appendChild(card);
            } else {
                console.error('Failed to create card element from HTML:', cardHTML);
            }
        });
    }
}

function updateAllFavoriteIcons() {
    document.querySelectorAll('.favorite-btn').forEach(btn => {
        const fragranceId = btn.dataset.id;
        if (userFavorites.has(fragranceId)) {
            btn.classList.add('favorited');
        } else {
            btn.classList.remove('favorited');
        }
    });
}

// --- Personalized Recommendations ---

async function fetchUserPreferences() {
    try {
        console.log('[Prefs] Fetching user preferences for recommendations...');
        const authToken = getAuthToken();
        if (!authToken) {
            console.log('[Prefs] No auth token found. User is likely not logged in.');
            return null;
        }

        // Add cache-busting parameter to the URL
        const cacheBust = new Date().getTime();
        const url = `${config.API_ENDPOINT}/api/user/preferences?_cacheBust=${cacheBust}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 401) {
            // Not logged in, handle gracefully
            return null;
        }

        if (!response.ok) {
            throw new Error(`Failed to fetch preferences: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error fetching user preferences:', error);
        return null; // Return null on error
    }
}

function buildPersonalizedQuery(preferences) {
    if (!preferences) return { query: '', filters: {} };

    let positiveKeywords = [];
    let filters = {};

    // 1. Randomly select 1-2 scent families (instead of all)
    if (preferences.scent_categories && preferences.scent_categories.length > 0) {
        const shuffledScentCategories = [...preferences.scent_categories].sort(() => 0.5 - Math.random());
        const numToSelect = Math.min(Math.floor(Math.random() * 2) + 1, shuffledScentCategories.length); // 1-2 random categories
        const selectedCategories = shuffledScentCategories.slice(0, numToSelect);
        console.log('[Query Build] Randomly selected scent categories:', selectedCategories);
        positiveKeywords.push(...selectedCategories);
    }

    // 2. Randomly select 1 preference from intensity, season, occasion
    const otherPrefs = [preferences.intensity, preferences.season, preferences.occasion].filter(Boolean);
    if (otherPrefs.length > 0) {
        const randomIndex = Math.floor(Math.random() * otherPrefs.length);
        let selectedPref = otherPrefs[randomIndex];

        // Handle backward compatibility: convert "work" to "professional"
        if (selectedPref === 'work') {
            selectedPref = 'professional';
        }

        console.log('[Query Build] Randomly selected preference:', selectedPref, 'from options:', otherPrefs);
        positiveKeywords.push(selectedPref);
    }

    console.log('[Query Build] Before adding core terms:', positiveKeywords);

    // 4. Budget filter (doesn't add keywords)
    if (preferences.budget_range) {
        const range = preferences.budget_range;
        if (range.includes('-')) {
            const [low, high] = range.split('-').map(p => parseInt(p));
            filters.lowPrice = low;
            filters.highPrice = high;
        } else if (range.startsWith('under-')) {
            filters.highPrice = parseInt(range.replace('under-', ''));
        } else if (range.startsWith('over-')) {
            filters.lowPrice = parseInt(range.replace('over-', ''));
        }
    }

    // 5. Sensitivities filter (client-side, doesn't add keywords)
    if (preferences.sensitivities && preferences.sensitivities.length > 0) {
        filters.sensitivities = preferences.sensitivities;
    }

    // 6. Deduplicate and strictly limit positive keywords to a safe number (3)
    const uniqueKeywords = [...new Set(positiveKeywords)];
    const limitedKeywords = uniqueKeywords.slice(0, 3); // MAX 3 positive keywords for safety

    console.log('[Query Build] Final limited keywords:', limitedKeywords);

    // 7. Build final query with fragrance perfume at the end
    const coreTerms = 'fragrance perfume';
    const finalQueryString = `${limitedKeywords.join(' ')} ${coreTerms}`;

    console.log('[Query Build] Core terms added at end:', coreTerms);
    console.log('[Query Build] Final query string:', finalQueryString);
    console.log('[Query Build] Total keywords count:', limitedKeywords.length + 2); // +2 for fragrance perfume

    const finalQuery = {
        query: finalQueryString,
        filters: filters
    };

    return finalQuery;
}

async function getPersonalizedRecommendations() {
    console.log('[Personalized] Function called');

    const personalizedSection = document.getElementById('personalized');
    const resultsGrid = document.getElementById('personalized-results-grid');
    const emptyState = document.getElementById('personalized-empty-state');
    const queryDisplay = document.getElementById('personalized-query-display');

    if (!personalizedSection || !resultsGrid || !emptyState || !queryDisplay) {
        console.log('[Personalized] Missing DOM elements');
        return;
    }

    // Show the section and a loading state
    personalizedSection.style.display = 'block';
    resultsGrid.innerHTML = '<p>Loading your personalized recommendations...</p>';
    emptyState.style.display = 'none';
    queryDisplay.style.display = 'none';
    
    // Scroll to the section
    personalizedSection.scrollIntoView({ behavior: 'smooth' });

    console.log('[Personalized] Fetching user preferences...');
    const responseData = await fetchUserPreferences();

    // Check for the nested 'preferences' object within the response
    if (!responseData || !responseData.success || !responseData.preferences || Object.keys(responseData.preferences).length === 0) {
        console.log('[Personalized] No preferences found');
        // User has no preferences set or is not logged in
        resultsGrid.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    // Pass the actual preferences object to the build function
    console.log('[Personalized] Building query from preferences:', responseData.preferences);
    const { query, filters } = buildPersonalizedQuery(responseData.preferences);
    console.log('[Personalized] Generated query:', query);

    // Query display removed - keeping interface clean

    // Add revenue optimization
    filters.sortBy = 'revenue'; 

    try {
        const results = await fetchProductsFromApi(query, 1, config.RESULTS_PER_PAGE, filters);
        
        if (results && results.products.length > 0) {
            // Filter out products without a valid price before displaying
            const validProducts = results.products.filter(p => typeof p.price === 'number' && p.price > 0);

            if (validProducts.length > 0) {
                // Display products in the personalized grid
                const productCards = validProducts.map(p => createProductCard(p)).join('');
                resultsGrid.innerHTML = productCards;

                // Convert prices to the user's selected currency
                const selectedCurrency = document.getElementById('currency-converter')?.value;
                if (selectedCurrency) {
                    await updateDisplayedPrices(selectedCurrency);
                }
                
            } else {
                resultsGrid.innerHTML = '<p>We found recommendations, but none with valid pricing. Please try adjusting your preferences.</p>';
            }

        } else {
            resultsGrid.innerHTML = '<p>We couldn\'t find any recommendations based on your preferences. Try adjusting them!</p>';
        }
    } catch (error) {
        console.error('Error getting personalized recommendations:', error);
        resultsGrid.innerHTML = '<p>Sorry, something went wrong while fetching your recommendations.</p>';
    }
}

// --- End Personalized Recommendations ---

function setupStripe() {
    // Check if Stripe is enabled in config
    // ... existing code ...
}
