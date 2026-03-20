// Secure Authentication Script for Fragrance Collect

// --- CONFIGURATION ---
const WORKER_URL = 'https://weathered-mud-6ed5.joshuablaszczyk.workers.dev';
// Make sure to replace this with your actual Google Client ID
const GOOGLE_CLIENT_ID = "351083759622-fnmbu0am1knlj8ltcps8i7la64dhjpnn.apps.googleusercontent.com"; 

// --- UI ELEMENT SELECTORS ---
const ui = {
    loggedOutView: document.getElementById('logged-out-view'),
    loggedInView: document.getElementById('logged-in-view'),
    userPicture: document.getElementById('user-picture'),
    userName: document.getElementById('user-name'),
    userEmail: document.getElementById('user-email'),
    logoutButton: document.getElementById('logout-button'),
    authStatus: document.getElementById('auth-status'),
    authTabs: document.querySelectorAll('.tab-btn'),
    authForms: document.querySelectorAll('.auth-form'),
    tabsContainer: document.querySelector('.auth-tabs'),
    // Success Modal
    successModal: document.getElementById('success-modal'),
    successUserName: document.getElementById('success-user-name'),
    continueToHomeBtn: document.getElementById('continue-to-home-btn'),
    // Email/Password Form Elements
    signinForm: document.getElementById('signin-form-element'),
    signupForm: document.getElementById('signup-form-element'),
    signupName: document.getElementById('signup-name'),
    signupEmail: document.getElementById('signup-email'),
    signupPassword: document.getElementById('signup-password'),
    signupConfirmPassword: document.getElementById('signup-confirm-password'),
    signinEmail: document.getElementById('signin-email'),
    signinPassword: document.getElementById('signin-password'),
};

// --- CORE FUNCTIONS ---

/**
 * Updates the UI to reflect the user's authentication state.
 * @param {object|null} user - The user object if logged in, null otherwise.
 */
function updateUI(user) {
    if (user) {
        // User is logged in
        ui.loggedOutView.style.display = 'none';
        ui.loggedInView.style.display = 'block';

        ui.userPicture.src = user.picture || 'emblem.png'; // Fallback image
        ui.userPicture.alt = `${user.name || 'User'}'s profile picture`;
        ui.userName.textContent = user.name || 'Welcome';
        ui.userEmail.textContent = user.email || '';

        // Hide the Sign In/Sign Up tabs
        if (ui.tabsContainer) {
            ui.tabsContainer.style.display = 'none';
        }

        // Update shared auth state
        isUserLoggedIn = true;
        currentUser = user;
    } else {
        // User is logged out
        ui.loggedOutView.style.display = 'block';
        ui.loggedInView.style.display = 'none';
        // Show the Sign In/Sign Up tabs
        if (ui.tabsContainer) {
            ui.tabsContainer.style.display = 'flex';
        }

        // Update shared auth state
        isUserLoggedIn = false;
        currentUser = null;
    }
}

/**
 * Displays a status or error message in the UI.
 * @param {string} message - The message to display.
 * @param {boolean} isError - If true, styles the message as an error.
 */
function showStatus(message, isError = false) {
    if (ui.authStatus) {
        ui.authStatus.textContent = message;
        ui.authStatus.className = isError ? 'error-message show' : 'success-message show';
        
        // Hide the message after 5 seconds
        setTimeout(() => {
            ui.authStatus.textContent = '';
            ui.authStatus.className = 'error-message';
        }, 5000);
    }
}


/**
 * Callback function for Google Sign-In. Sends the credential to the backend.
 * @param {object} response - The credential response from Google.
 */
async function handleCredentialResponse(response) {
    showStatus('Verifying your credentials...');
    try {
        const res = await fetch(`${WORKER_URL}/api/login/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: response.credential }),
        });

        const data = await res.json();

        if (res.ok && data.success) {
            showStatus('Login successful! Welcome.');
            
            if (data.token) {
                localStorage.setItem('session_token', data.token);
            }
            
            updateSharedNavUI(data.user);
            updateUI(data.user);

        } else {
            throw new Error(data.details || data.error || 'Google login failed. Please try again.');
        }
    } catch (error) {
        console.error('Google login process error:', error);
        showStatus(error.message, true);
        updateUI(null);
    }
}

/**
 * Checks the user's login status by calling the /status endpoint.
 */
async function checkUserStatus() {
    // This function is now redundant, as shared-auth.js handles the initial status check.
    // The shared script will call updateSharedNavUI, which is all we need for the nav bar.
    // The auth-script will handle the visibility of the login/logout forms.
}

/**
 * Handles user logout by calling the /logout endpoint.
 */
async function logout() {
    showStatus('Signing out...');
    try {
        const res = await fetch(`${WORKER_URL}/api/logout`, { 
            method: 'POST',
            credentials: 'include'
        });
        const data = await res.json();

        if (res.ok && data.success) {
            // Clear localStorage
            localStorage.removeItem('session_token');
            
            // Update global auth state if available
            if (typeof isUserLoggedIn !== 'undefined') {
                isUserLoggedIn = false;
                currentUser = null;
                sessionToken = null;
            }
            
            showStatus('You have been signed out successfully.');
            updateSharedNavUI(null); // Use shared function
            
            // Redirect to clear any cached state
            setTimeout(() => {
                window.location.href = 'auth.html';
            }, 1000);
        } else {
            throw new Error(data.error || 'Logout failed.');
        }
    } catch (error) {
        console.error('Logout error:', error);
        showStatus(error.message, true);
    }
}

/**
 * Handles the submission of the email sign-up form.
 */
async function handleEmailSignup(event) {
    event.preventDefault();
    clearErrors('signup');

    const name = ui.signupName.value.trim();
    const email = ui.signupEmail.value.trim();
    const password = ui.signupPassword.value;
    const confirmPassword = ui.signupConfirmPassword.value;

    // --- Validation ---
    let hasErrors = false;
    if (!name) {
        showError('signup-name-error', 'Full name is required.');
        hasErrors = true;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError('signup-email-error', 'A valid email is required.');
        hasErrors = true;
    }
    if (password.length < 8) {
        showError('signup-password-error', 'Password must be at least 8 characters.');
        hasErrors = true;
    }
    if (password !== confirmPassword) {
        showError('signup-confirm-password-error', 'Passwords do not match.');
        hasErrors = true;
    }
    if (hasErrors) return;

    showStatus('Creating your account...');
    try {
        const res = await fetch(`${WORKER_URL}/api/signup/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showStatus('Account created successfully! Welcome.');
            updateSharedNavUI(data.user); // Use shared function
        } else {
            throw new Error(data.error || 'Could not create account.');
        }
    } catch (error) {
        showStatus(error.message, true);
    }
}

/**
 * Handles the submission of the email sign-in form.
 */
async function handleEmailLogin(event) {
    event.preventDefault();
    clearErrors('signin');
    const email = ui.signinEmail.value.trim();
    const password = ui.signinPassword.value;

    if (!email || !password) {
        showError('signin-email-error', 'Email and password are required.');
        return;
    }

    showStatus('Signing you in...');
    try {
        const res = await fetch(`${WORKER_URL}/api/login/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const data = await res.json();

        if (res.ok && data.success) {
            showStatus('Sign in successful!');
            updateSharedNavUI(data.user); // Use shared function
            
            // Add a small delay to ensure session is established
            setTimeout(async () => {
                try {
                    const verifyRes = await fetch(`${WORKER_URL}/api/status`, { credentials: 'include' });
                    const verifyData = await verifyRes.json();
                    if (!verifyData.success) {
                        console.warn('Session verification failed after email login');
                    }
                } catch (error) {
                    console.error('Session verification error after email login:', error);
                }
            }, 100);
        } else {
            throw new Error(data.error || 'Sign-in failed.');
        }
    } catch (error) {
        showStatus(error.message, true);
    }
}


// --- UTILITY FUNCTIONS ---
function showError(elementId, message) {
    const errorElement = document.getElementById(elementId);
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.classList.add('show');
    }
}

function clearErrors(formType) {
    const errorElements = document.querySelectorAll(`#${formType}-form .error-message`);
    errorElements.forEach(element => {
        element.textContent = '';
        element.classList.remove('show');
    });
}


// --- INITIALIZATION ---

/**
 * Initializes the Google Sign-In buttons.
 */
function initializeGoogleSignIn() {
    if (typeof google === 'undefined') {
        console.error('Google GSI script not loaded.');
        showStatus('Could not load Google Sign-In.', true);
        return;
    }

    google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse
    });

    // Render the Sign In button
    const signInButton = document.getElementById('g_id_signin');
    if (signInButton) {
        google.accounts.id.renderButton(signInButton, { 
            theme: "filled_black", 
            size: "large", 
            text: "continue_with", 
            shape: "rectangular",
            width: "380"
        });
    }
    
    // Render the Sign Up button
    const signUpButton = document.getElementById('g_id_signup');
    if (signUpButton) {
         google.accounts.id.renderButton(signUpButton, { 
            theme: "filled_black", 
            size: "large", 
            text: "signup_with", 
            shape: "rectangular",
            width: "380"
        });
    }
}


// --- EVENT LISTENERS ---

document.addEventListener('DOMContentLoaded', () => {
    // The shared-auth.js script now handles the initial status check automatically.
    // We just need to handle the visibility of the login forms based on the shared state.

    // Handle post-login redirect messages
    handlePostLogin();

    // Handle URL parameters for tab switching
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    
    // Set initial tab based on URL parameter
    if (tabParam === 'signup') {
        switchToTab('signup');
    } else {
        switchToTab('signin'); // Default to signin
    }

    // Tab switching logic
    ui.authTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const activeTab = tab.dataset.tab;
            switchToTab(activeTab);
        });
    });
    
    // Function to switch tabs
    function switchToTab(tabName) {
        // Update active button state
        ui.authTabs.forEach(t => t.classList.remove('active'));
        const activeTabButton = document.querySelector(`[data-tab="${tabName}"]`);
        if (activeTabButton) {
            activeTabButton.classList.add('active');
        }
        
        // Show the correct form
        ui.authForms.forEach(form => {
            if (form.id === `${tabName}-form`) {
                form.classList.add('active');
            } else {
                form.classList.remove('active');
            }
        });
        
        // Update URL without page reload
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('tab', tabName);
        window.history.replaceState({}, '', newUrl);
    }

    // Logout button in the main content (not the nav bar)
    if (ui.logoutButton) {
        ui.logoutButton.addEventListener('click', logout);
    }
    
    // --- Email/Password Form Submission ---
    if (ui.signinForm) {
        ui.signinForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = ui.signinEmail.value;
            const password = ui.signinPassword.value;
            
            showStatus('Signing in...');
            try {
                const res = await fetch(`${WORKER_URL}/api/login/email`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password }),
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    showStatus('Login successful!');
                    
                    // Store token in localStorage for cross-origin fallback
                    if (data.token) {
                        localStorage.setItem('session_token', data.token);
                        console.log('Token stored in localStorage for cross-origin support');
                    }
                    
                    updateSharedNavUI(data.user); // Use shared function
                    
                    // Session establishment verification
                    setTimeout(async () => {
                        try {
                            const verifyRes = await fetch(`${WORKER_URL}/api/status`, { credentials: 'include' });
                            const verifyData = await verifyRes.json();
                            if (!verifyData.success) {
                                console.warn('Session verification failed after form login');
                            }
                        } catch (error) {
                            console.error('Session verification error after form login:', error);
                        }
                    }, 100);

                    // Update the main content UI, separate from shared nav
                    if (data.user) {
                         ui.loggedOutView.style.display = 'none';
                         ui.loggedInView.style.display = 'block';
                         ui.userPicture.src = data.user.picture || 'emblem.png';
                         ui.userName.textContent = data.user.name || 'Welcome';
                         ui.userEmail.textContent = data.user.email || '';
                         if (ui.tabsContainer) ui.tabsContainer.style.display = 'none';
                    }

                } else {
                    throw new Error(data.error || 'Failed to sign in.');
                }
            } catch (error) {
                showStatus(error.message, true);
            }
        });
    }

    if (ui.signupForm) {
        ui.signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = ui.signupName.value;
            const email = ui.signupEmail.value;
            const password = ui.signupPassword.value;
            const confirmPassword = ui.signupConfirmPassword.value;

            if (password !== confirmPassword) {
                showStatus('Passwords do not match.', true);
                return;
            }

            showStatus('Creating account...');
            try {
                const res = await fetch(`${WORKER_URL}/api/signup/email`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, password }),
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    // Store token in localStorage for cross-origin fallback
                    if (data.token) {
                        localStorage.setItem('session_token', data.token);
                        console.log('Token stored in localStorage for cross-origin support');
                    }
                    
                    showSuccessModal(data.user.name);
                    updateSharedNavUI(data.user); // Use shared function
                } else {
                    throw new Error(data.error || 'Failed to sign up.');
                }
            } catch (error) {
                showStatus(error.message, true);
            }
        });
    }

    if (ui.continueToHomeBtn) {
        ui.continueToHomeBtn.addEventListener('click', async () => {
            // Add loading state to button
            ui.continueToHomeBtn.disabled = true;
            ui.continueToHomeBtn.textContent = 'Loading...';

            // Wait a moment for the session to be fully established
            await new Promise(resolve => setTimeout(resolve, 500));

            // Verify the session is working before redirecting
            try {
                const statusCheck = await fetch(`${WORKER_URL}/api/status`, { credentials: 'include' });
                const statusData = await statusCheck.json();

                if (statusData.success && statusData.user) {
                    // Update shared auth state before redirect
                    isUserLoggedIn = true;
                    currentUser = statusData.user;

                    // Session verified, safe to redirect
                    window.location.href = 'main.html';
                } else {
                    // Session not working, try again
                    showStatus('Please wait, completing login...', false);
                    setTimeout(() => {
                        window.location.href = 'main.html';
                    }, 1000);
                }
            } catch (error) {
                console.error('Session verification failed:', error);
                // Fallback: redirect anyway
                window.location.href = 'main.html';
            }
        });
    }
});

/**
 * Checks for URL parameters on page load to show success messages
 * and then redirects to the main page.
 */
function handlePostLogin() {
    const urlParams = new URLSearchParams(window.location.search);
    const status = urlParams.get('status');
    const name = urlParams.get('name');

    if (status === 'success' && name) {
        // For Google redirect, show the success modal
        showSuccessModal(name);
    }
}

/**
 * Displays the success modal with the user's name.
 * @param {string} name - The user's name to display.
 */
function showSuccessModal(name) {
    // Hide all auth forms
    ui.loggedOutView.style.display = 'none';

    // Set the user's name
    if (ui.successUserName) {
        ui.successUserName.textContent = name.split(' ')[0]; // Show first name
    }

    // Show the modal
    if (ui.successModal) {
        ui.successModal.classList.add('show');
    }
}

/**
 * Initializes Google Sign-In services.
 * This function should be called after the Google script has loaded.
 */
function initializeGoogleSignIn() {
    if (typeof google === 'undefined') {
        console.error('Google GSI script not loaded.');
        showStatus('Could not load Google Sign-In.', true);
        return;
    }

    google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse
    });

    // Render the Sign In button
    const signInButton = document.getElementById('g_id_signin');
    if (signInButton) {
        google.accounts.id.renderButton(signInButton, { 
            theme: "filled_black", 
            size: "large", 
            text: "continue_with", 
            shape: "rectangular",
            width: "380"
        });
    }
    
    // Render the Sign Up button
    const signUpButton = document.getElementById('g_id_signup');
    if (signUpButton) {
         google.accounts.id.renderButton(signUpButton, { 
            theme: "filled_black", 
            size: "large", 
            text: "signup_with", 
            shape: "rectangular",
            width: "380"
        });
    }
} 