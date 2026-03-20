// Shared Authentication Script for All Pages
// This script provides session persistence across all pages

// Global authentication state
let isUserLoggedIn = false;
let currentUser = null;
let sessionToken = null;

// Common UI elements for authentication (adjust selectors per page as needed)
const sharedAuthUI = {
    menuActions: null,
    menuProfileBtn: null,
    menuLogoutBtn: null,

    // Initialize UI elements (call this from each page)
    init() {
        this.menuActions = document.querySelector('.menu-actions');
        this.menuProfileBtn = document.getElementById('menu-profile-btn');
        this.menuLogoutBtn = document.getElementById('menu-logout-btn');
    }
};

// Get session token for cross-origin requests
async function getSessionToken() {
    try {
        console.log('Attempting to get session token...');
        
        // First try to get token from localStorage (fallback for blocked cookies)
        const localToken = localStorage.getItem('session_token');
        if (localToken) {
            console.log('Found session token in localStorage');
            sessionToken = localToken;
            return localToken;
        }
        
        const response = await fetch('https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/token?v=2', {
            method: 'GET',
            credentials: 'include'
        });

        console.log('Token response status:', response.status);
        console.log('Token response headers:', [...response.headers.entries()]);

        const data = await response.json();
        console.log('Token response data:', data);

        if (response.status === 401) {
            console.log('401 Unauthorized - No valid session token found');
            console.log('This could mean:');
            console.log('1. User is not logged in');
            console.log('2. Session has expired');
            console.log('3. Cookie was not set properly during login');
            return null;
        }

        if (data.success && data.token) {
            sessionToken = data.token;
            // Store token in localStorage as fallback
            localStorage.setItem('session_token', data.token);
            console.log('Session token retrieved successfully and stored in localStorage');
            return data.token;
        } else {
            console.log('Failed to get session token:', data.error);
        }
    } catch (error) {
        console.error('Error getting session token:', error);
        
        // If network fails, try localStorage as last resort
        const localToken = localStorage.getItem('session_token');
        if (localToken) {
            console.log('Network failed, using localStorage token as fallback');
            sessionToken = localToken;
            return localToken;
        }
    }
    return null;
}

// Check user authentication status
async function checkSharedUserStatus() {
    try {
        console.log('Checking shared user status...');
        
        // First try direct status check with cookies (for same-origin or if cookies work)
        let response = await fetch('https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/status?v=2', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });
        
        console.log('Initial status response:', response.status);
        let data = await response.json();
        console.log('Initial status data:', data);
        
        // If that fails, try to get session token and retry
        if (!data.success && !sessionToken) {
            console.log('Initial status failed, trying to get session token...');
            await getSessionToken();
            
            if (sessionToken) {
                console.log('Retrying status check with token...');
                const headers = { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionToken}`
                };
                
                response = await fetch('https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/status?v=2', {
                    method: 'GET',
                    headers,
                    credentials: 'include'
                });
                
                console.log('Token-based status response:', response.status);
                data = await response.json();
                console.log('Token-based status data:', data);
            }
        }
        
        if (data.success && data.user) {
            console.log('User is logged in:', data.user.name);
            isUserLoggedIn = true;
            currentUser = data.user;
            updateSharedNavUI(data.user);
        } else {
            console.log('User is not logged in:', data.error);
            isUserLoggedIn = false;
            sessionToken = null; // Clear invalid token
            currentUser = null;
            updateSharedNavUI(null);
        }
    } catch (error) {
        console.error('Error checking authentication status:', error);
        isUserLoggedIn = false;
        sessionToken = null; // Clear token on error
        currentUser = null;
        updateSharedNavUI(null);
    }
}

// Update navigation UI based on authentication status
function updateSharedNavUI(user) {
    console.log('updateSharedNavUI called with user:', user);

    if (user) {
        // User is logged in
        isUserLoggedIn = true;
        currentUser = user;
        document.body.classList.add('user-logged-in');
        console.log('Setting isUserLoggedIn to true and adding .user-logged-in class');

        // Ensure menu actions are visible and login button is hidden
        if (sharedAuthUI.menuActions) {
            sharedAuthUI.menuActions.style.display = 'flex';
        }
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            loginBtn.style.display = 'none';
        }

        // Update profile picture in navigation if user has one
        if (sharedAuthUI.menuProfileBtn && user.picture) {
            // Create a profile picture element if it doesn't exist
            let profileImg = sharedAuthUI.menuProfileBtn.querySelector('.profile-img');
            if (!profileImg) {
                profileImg = document.createElement('img');
                profileImg.className = 'profile-img';
                profileImg.style.cssText = `
                    width: 100%;
                    height: 100%;
                    border-radius: 50%;
                    object-fit: cover;
                    position: absolute;
                    top: 0;
                    left: 0;
                `;
                sharedAuthUI.menuProfileBtn.appendChild(profileImg);
            }
            profileImg.src = user.picture;
            profileImg.alt = `${user.name || 'User'}'s Profile Picture`;
        }

        // Call updateDynamicGreeting if it exists (for hero greeting)
        if (typeof updateDynamicGreeting === 'function') {
            const firstName = user.name.split(' ')[0];
            updateDynamicGreeting(firstName);
        }
    } else {
        // User is logged out
        isUserLoggedIn = false;
        currentUser = null;
        document.body.classList.remove('user-logged-in');
        console.log('Setting isUserLoggedIn to false and removing .user-logged-in class');

        // Ensure login button is visible and menu actions are hidden
        if (sharedAuthUI.menuActions) {
            sharedAuthUI.menuActions.style.display = 'none';
        }
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            loginBtn.style.display = 'flex';
        }

        // Remove profile picture from navigation
        if (sharedAuthUI.menuProfileBtn) {
            const profileImg = sharedAuthUI.menuProfileBtn.querySelector('.profile-img');
            if (profileImg) {
                profileImg.remove();
            }
        }
    }
}

// Handle logout functionality
async function handleSharedLogout() {
    try {
        await fetch('https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/logout', {
            method: 'POST',
            credentials: 'include'
        });
    } finally {
        // Always update UI and redirect, even if server call fails
        isUserLoggedIn = false;
        currentUser = null;
        sessionToken = null;
        
        // Clear localStorage tokens
        localStorage.removeItem('session_token');
        
        updateSharedNavUI(null);
        // Call page-specific UI update if it exists
        if (typeof updateNavUI === 'function') {
            updateNavUI(null);
        }
        window.location.href = 'auth.html';
    }
}

// Initialize shared authentication on page load
function initSharedAuth() {
    console.log('🔄 Initializing shared auth...');
    // Initialize UI elements
    sharedAuthUI.init();
    
    // Check authentication status
    checkSharedUserStatus();
    
    // Add logout event listener if logout button exists in the nav
    if (sharedAuthUI.menuLogoutBtn) {
        sharedAuthUI.menuLogoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleSharedLogout();
        });
    }
    console.log('✅ Shared auth initialization complete');
}

// Auto-initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🔄 Shared auth DOMContentLoaded event fired');
    initSharedAuth();
});

// Utility function to check if user is authenticated (for other scripts to use)
function isAuthenticated() {
    return isUserLoggedIn && currentUser !== null;
}

// Get current user data
function getCurrentUser() {
    return currentUser;
}

// Get session token for API calls
function getAuthToken() {
    return sessionToken;
}