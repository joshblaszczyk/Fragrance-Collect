const WORKER_URL = window.API_BASE;

const authUI = {
    loggedOutView: document.getElementById('logged-out-view'),
    loggedInView: document.getElementById('logged-in-view'),
    userPicture: document.getElementById('user-picture'),
    userName: document.getElementById('user-name'),
    userEmail: document.getElementById('user-email'),
    tabsContainer: document.querySelector('.auth-tabs'),
    tabs: [...document.querySelectorAll('.tab-btn')],
    forms: [...document.querySelectorAll('.auth-form')],
    status: document.getElementById('auth-status'),
    signinForm: document.getElementById('signin-form-element'),
    signupForm: document.getElementById('signup-form-element'),
    successModal: document.getElementById('success-modal'),
    resetDialog: document.getElementById('password-reset-dialog'),
    resetRequestView: document.getElementById('password-reset-request-view'),
    resetNewView: document.getElementById('password-reset-new-view'),
    resetStatus: document.getElementById('password-reset-status'),
    successTitle: document.getElementById('success-modal-title'),
    successMessage: document.getElementById('success-modal-message'),
    successButton: document.getElementById('continue-to-home-btn')
};

let statusTimer;
let resetToken = '';
let verifyToken = '';
let pendingVerificationEmail = '';
let outcomeAction = 'home';
let googleIdentityInitialized = false;
let googleRenderAttempts = 0;
let googleRenderTimer;
let googleIdentityScriptPromise;
let authCredentialHandoffCleared = true;

function isLocalPreview() {
    return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}

function loadGoogleIdentityScript() {
    if (isLocalPreview() || window.google?.accounts?.id) return Promise.resolve();
    if (googleIdentityScriptPromise) return googleIdentityScriptPromise;

    googleIdentityScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.referrerPolicy = 'no-referrer';
        script.addEventListener('load', resolve, { once: true });
        script.addEventListener('error', () => reject(new Error('Google sign-in is unavailable.')), { once: true });
        document.head.appendChild(script);
    });
    return googleIdentityScriptPromise;
}

function googleButtonWidth(host) {
    return Math.min(400, Math.max(200, Math.floor(host.getBoundingClientRect().width || 320)));
}

function renderGoogleButtons() {
    if (isLocalPreview()) {
        document.querySelectorAll('.google-button-host').forEach((host) => {
            if (host.firstElementChild?.classList.contains('local-google-disabled')) return;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'local-google-disabled';
            button.disabled = true;
            button.textContent = 'Continue with Google on production';
            host.replaceChildren(button);
        });
        return;
    }
    const googleIdentity = window.google?.accounts?.id;
    const clientId = document.querySelector('meta[name="google-signin-client-id"]')?.content;
    if (!googleIdentity || !clientId) {
        if (googleRenderAttempts < 40) {
            googleRenderAttempts += 1;
            window.clearTimeout(googleRenderTimer);
            googleRenderTimer = window.setTimeout(renderGoogleButtons, 150);
        }
        return;
    }

    if (!googleIdentityInitialized) {
        googleIdentity.initialize({
            client_id: clientId,
            callback: handleCredentialResponse,
            ux_mode: 'popup'
        });
        googleIdentityInitialized = true;
    }

    [
        { id: 'google-signin-button', text: 'continue_with' },
        { id: 'google-signup-button', text: 'signup_with' }
    ].forEach(({ id, text }) => {
        const host = document.getElementById(id);
        if (!host || host.closest('[hidden]')) return;
        const width = googleButtonWidth(host);
        if (host.dataset.renderedWidth === String(width) && host.firstElementChild) return;
        host.replaceChildren();
        googleIdentity.renderButton(host, {
            type: 'standard',
            theme: 'filled_black',
            size: 'large',
            text,
            shape: 'rectangular',
            logo_alignment: 'left',
            width
        });
        host.dataset.renderedWidth = String(width);
    });
}

async function requestJson(path, options) {
    const response = await fetch(`${WORKER_URL}${path}`, {
        credentials: 'include',
        ...options,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(options?.headers || {})
        }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const fallback = path === '/api/password/forgot' && response.status === 404
            ? 'Password reset is temporarily unavailable. Please contact support@fragrancecollect.com.'
            : 'The request could not be completed.';
        const error = new Error(data.error || fallback);
        error.code = data.code || '';
        error.verificationRequired = Boolean(data.verificationRequired);
        error.recoveryEmail = typeof data.recoveryEmail === 'string' ? data.recoveryEmail : '';
        throw error;
    }
    return data;
}

async function confirmBrowserSession(expectedUser) {
    const response = await fetch(`${WORKER_URL}/api/status`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success || !data.user
        || String(data.user.id || '') !== String(expectedUser?.id || '')) {
        updateSharedNavUI(null);
        updateAuthPage(null);
        throw new Error('This browser blocked the secure cross-site session cookie. Use a current browser or allow partitioned cookies for this site, then try again.');
    }
    return data.user;
}

function setButtonBusy(button, busy, busyText = 'Working...') {
    if (!button) return;
    if (busy) {
        button.dataset.originalText = button.textContent;
        button.textContent = busyText;
    } else if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
    }
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
}

function showStatus(message, isError = false) {
    if (!authUI.status) return;
    window.clearTimeout(statusTimer);
    authUI.status.textContent = message;
    authUI.status.className = isError ? 'error-message show' : 'success-message show';
    authUI.status.setAttribute('role', isError ? 'alert' : 'status');
    statusTimer = window.setTimeout(() => {
        authUI.status.textContent = '';
        authUI.status.className = 'error-message';
    }, 7000);
}

function showOutcome({ title, message, buttonText, action = 'home' }) {
    authUI.successTitle.textContent = title;
    authUI.successMessage.textContent = message;
    authUI.successButton.textContent = buttonText;
    outcomeAction = action;
    if (!authUI.successModal.open) authUI.successModal.showModal();
    authUI.successModal.classList.add('show');
    authUI.successButton.focus();
}

function signupNeedsVerification(data) {
    return Boolean(
        data?.pendingVerification
        || data?.verificationPending
        || data?.requiresVerification
        || data?.verificationRequired
        || data?.status === 'pending_verification'
    );
}

function setVerificationResend(email = '') {
    pendingVerificationEmail = email;
    const button = document.getElementById('resend-verification-button');
    if (button) button.hidden = !email;
}

function showFieldError(id, message) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message;
    element.classList.add('show');
    element.setAttribute('role', 'alert');
    const input = document.querySelector(`[aria-describedby~="${id}"]`);
    input?.setAttribute('aria-invalid', 'true');
}

function clearFieldErrors(form) {
    form?.querySelectorAll('.error-message').forEach((element) => {
        element.textContent = '';
        element.classList.remove('show');
        element.removeAttribute('role');
    });
    form?.querySelectorAll('[aria-invalid="true"]').forEach((input) => input.removeAttribute('aria-invalid'));
}

function passwordErrors(password) {
    const errors = [];
    if (password.length < 8) errors.push('at least 8 characters');
    if (!/[A-Z]/.test(password)) errors.push('an uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('a lowercase letter');
    if (!/\d/.test(password)) errors.push('a number');
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(password)) errors.push('a symbol');
    return errors;
}

function updateAuthPage(user) {
    const loggedIn = Boolean(user);
    authUI.loggedOutView.hidden = loggedIn;
    authUI.loggedInView.hidden = !loggedIn;
    authUI.tabsContainer.hidden = loggedIn;
    if (!loggedIn) return;

    authUI.userPicture.src = safeProfilePicture(user.picture) || 'assets/images/emblem-96.webp';
    authUI.userPicture.alt = user.picture ? `${user.name || 'User'} profile picture` : 'Fragrance Collect emblem';
    authUI.userName.textContent = user.name || 'Welcome';
    authUI.userEmail.textContent = user.email || '';
}

function switchTab(tabName, updateUrl = true) {
    const safeTab = tabName === 'signup' ? 'signup' : 'signin';
    authUI.tabsContainer.dataset.activeTab = safeTab;
    authUI.tabs.forEach((tab) => {
        const active = tab.dataset.tab === safeTab;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
    });
    authUI.forms.forEach((form) => {
        const active = form.id === `${safeTab}-form`;
        form.classList.toggle('active', active);
        form.setAttribute('aria-hidden', String(!active));
        form.hidden = !active;
    });
    if (updateUrl) {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', safeTab);
        window.history.replaceState({}, '', url);
    }
    window.requestAnimationFrame(renderGoogleButtons);
}

function showResetDialog(mode) {
    const isNewPassword = mode === 'reset';
    authUI.resetRequestView.hidden = isNewPassword;
    authUI.resetNewView.hidden = !isNewPassword;
    authUI.resetDialog.setAttribute('aria-labelledby', isNewPassword ? 'password-reset-new-title' : 'password-reset-title');
    authUI.resetStatus.textContent = '';
    if (!authUI.resetDialog.open) authUI.resetDialog.showModal();
    window.requestAnimationFrame(() => {
        document.getElementById(isNewPassword ? 'password-reset-new' : 'password-reset-email')?.focus();
    });
}

async function submitSignin(event) {
    event.preventDefault();
    clearFieldErrors(authUI.signinForm);
    const email = document.getElementById('signin-email').value.trim();
    const password = document.getElementById('signin-password').value;
    if (!email || !password) {
        if (!email) showFieldError('signin-email-error', 'Enter your email address.');
        if (!password) showFieldError('signin-password-error', 'Enter your password.');
        authUI.signinForm.querySelector('[aria-invalid="true"]')?.focus();
        return;
    }

    const button = event.submitter;
    setButtonBusy(button, true, 'Signing in...');
    try {
        const data = await requestJson('/api/login/email', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        const confirmedUser = await confirmBrowserSession(data.user);
        setVerificationResend('');
        updateSharedNavUI(confirmedUser);
        updateAuthPage(confirmedUser);
        showStatus('Signed in successfully.');
    } catch (error) {
        if (error.verificationRequired || error.code === 'email_verification_required') {
            setVerificationResend(email);
            showOutcome({
                title: 'Verify your email',
                message: 'Open the verification link in your inbox before signing in. You can request a fresh link from the sign-in form.',
                buttonText: 'Return to sign in',
                action: 'signin'
            });
        } else {
            showStatus(error.message, true);
        }
    } finally {
        setButtonBusy(button, false);
    }
}

async function submitSignup(event) {
    event.preventDefault();
    clearFieldErrors(authUI.signupForm);
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirmation = document.getElementById('signup-confirm-password').value;
    const errors = passwordErrors(password);
    if (errors.length) {
        showFieldError('signup-password-error', `Include ${errors.join(', ')}.`);
        document.getElementById('signup-password')?.focus();
        return;
    }
    if (password !== confirmation) {
        showFieldError('signup-confirm-password-error', 'Passwords do not match.');
        document.getElementById('signup-confirm-password')?.focus();
        return;
    }

    const button = event.submitter;
    setButtonBusy(button, true, 'Creating account...');
    try {
        const data = await requestJson('/api/signup/email', {
            method: 'POST',
            body: JSON.stringify({ name, email, password })
        });
        if (signupNeedsVerification(data)) {
            authUI.signupForm.reset();
            setVerificationResend(email);
            updateSharedNavUI(null);
            updateAuthPage(null);
            showOutcome({
                title: 'Check your inbox',
                message: data.message || `We sent a one-time verification link to ${email}. Open it to finish creating your account.`,
                buttonText: 'Return to sign in',
                action: 'signin'
            });
            return;
        }
        if (!data.user) throw new Error('The account response was incomplete. Please try again.');
        const confirmedUser = await confirmBrowserSession(data.user);
        updateSharedNavUI(confirmedUser);
        updateAuthPage(confirmedUser);
        const firstName = String(confirmedUser.name || 'there').split(/\s+/)[0];
        showOutcome({
            title: 'Account created',
            message: `Welcome, ${firstName}. Your account is ready.`,
            buttonText: 'Continue to home'
        });
    } catch (error) {
        showStatus(error.message, true);
    } finally {
        setButtonBusy(button, false);
    }
}

async function submitResetRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = document.getElementById('password-reset-email').value.trim();
    const button = event.submitter;
    setButtonBusy(button, true, 'Sending...');
    authUI.resetStatus.textContent = '';
    try {
        const data = await requestJson('/api/password/forgot', {
            method: 'POST',
            body: JSON.stringify({ email })
        });
        authUI.resetStatus.textContent = data.message;
        form.reset();
    } catch (error) {
        authUI.resetStatus.textContent = error.message;
    } finally {
        setButtonBusy(button, false);
    }
}

async function resendVerificationEmail() {
    if (!pendingVerificationEmail) return;
    const button = document.getElementById('resend-verification-button');
    setButtonBusy(button, true, 'Sending...');
    try {
        const data = await requestJson('/api/signup/verification/resend', {
            method: 'POST',
            body: JSON.stringify({ email: pendingVerificationEmail })
        });
        showStatus(data.message || 'If the address is eligible, a new verification link is on its way.');
    } catch (error) {
        showStatus(error.message, true);
    } finally {
        setButtonBusy(button, false);
    }
}

async function submitNewPassword(event) {
    event.preventDefault();
    const password = document.getElementById('password-reset-new').value;
    const confirmation = document.getElementById('password-reset-confirm').value;
    const errors = passwordErrors(password);
    if (errors.length) {
        authUI.resetStatus.textContent = `Include ${errors.join(', ')}.`;
        return;
    }
    if (password !== confirmation) {
        authUI.resetStatus.textContent = 'Passwords do not match.';
        return;
    }

    const button = event.submitter;
    setButtonBusy(button, true, 'Saving...');
    try {
        const data = await requestJson('/api/password/reset', {
            method: 'POST',
            body: JSON.stringify({ token: resetToken, password })
        });
        authUI.resetStatus.textContent = data.message;
        resetToken = '';
        // Resetting a password revokes every session, including a Google
        // session that may still be represented in this page's in-memory UI.
        updateSharedNavUI(null);
        updateAuthPage(null);
        window.setTimeout(() => {
            authUI.resetDialog.close();
            switchTab('signin', false);
            document.getElementById('signin-email')?.focus();
        }, 1200);
    } catch (error) {
        authUI.resetStatus.textContent = error.message;
    } finally {
        setButtonBusy(button, false);
    }
}

async function verifyEmailAddress() {
    if (!verifyToken) return;
    showStatus('Verifying your email address...');
    try {
        const data = await requestJson('/api/signup/verify', {
            method: 'POST',
            body: JSON.stringify({ token: verifyToken })
        });
        verifyToken = '';
        setVerificationResend('');
        if (data.user) {
            const confirmedUser = await confirmBrowserSession(data.user);
            data.user = confirmedUser;
            updateSharedNavUI(confirmedUser);
            updateAuthPage(confirmedUser);
        } else {
            updateSharedNavUI(null);
            updateAuthPage(null);
            switchTab('signin', false);
        }
        showStatus(data.message || 'Your email is verified.');
        const identityLinkRequired = data.user?.identityLinkRequired === true;
        showOutcome({
            title: identityLinkRequired ? 'Email verified — one step remains' : 'Email verified',
            message: identityLinkRequired
                ? 'Continue to Account Settings and confirm the same Google account to finish securing this recovered account.'
                : data.message || (data.user
                ? 'Your account is ready and you are signed in.'
                : 'Your account is ready. Sign in to continue.'),
            buttonText: identityLinkRequired ? 'Link Google securely' : (data.user ? 'Continue to home' : 'Continue to sign in'),
            action: identityLinkRequired ? 'account-link' : (data.user ? 'home' : 'signin')
        });
    } catch (error) {
        showStatus(error.message, true);
    }
}

async function handleCredentialResponse(response) {
    showStatus('Verifying your Google account...');
    try {
        const data = await requestJson('/api/login/google', {
            method: 'POST',
            body: JSON.stringify({ token: response.credential })
        });
        const confirmedUser = await confirmBrowserSession(data.user);
        setVerificationResend('');
        updateSharedNavUI(confirmedUser);
        updateAuthPage(confirmedUser);
        showStatus('Signed in successfully.');
    } catch (error) {
        if (error.code === 'account_link_required') {
            setVerificationResend('');
            showOutcome({
                title: 'Sign in before linking Google',
                message: 'This email already belongs to a Fragrance Collect account. Sign in with its password, then connect Google from Account Settings.',
                buttonText: 'Continue to sign in',
                action: 'signin'
            });
            return;
        }
        if (error.code === 'legacy_verification_required' && error.recoveryEmail) {
            setVerificationResend(error.recoveryEmail);
            showOutcome({
                title: 'Verify your email first',
                message: 'For your security, verify the mailbox using the link we sent. After verification, Account Settings will ask you to explicitly connect Google.',
                buttonText: 'Return to sign in',
                action: 'signin'
            });
            return;
        }
        showStatus(error.message, true);
    }
}
window.handleCredentialResponse = handleCredentialResponse;

document.addEventListener('DOMContentLoaded', () => {
    const parameters = new URLSearchParams(window.location.search);
    const initialHash = window.location.hash;
    const hashBody = initialHash.startsWith('#?') ? initialHash.slice(2) : initialHash.slice(1);
    const fragmentParameters = new URLSearchParams(hashBody);
    const fragmentContainsCredential = ['reset_token', 'verify_token']
        .some((name) => fragmentParameters.has(name));
    const consumeCredential = typeof window.consumeFragranceAuthCredential === 'function'
        ? window.consumeFragranceAuthCredential
        : (name) => (fragmentContainsCredential ? fragmentParameters.get(name) : '') || parameters.get(name) || '';
    resetToken = consumeCredential('reset_token');
    verifyToken = consumeCredential('verify_token');
    // The handoff exists only for this first-party module. Do not leave a
    // credential reader available when Google Identity is requested below.
    if (typeof window.consumeFragranceAuthCredential === 'function') {
        try {
            authCredentialHandoffCleared = delete window.consumeFragranceAuthCredential;
        } catch {
            authCredentialHandoffCleared = false;
        }
    }
    authCredentialHandoffCleared = authCredentialHandoffCleared
        && typeof window.consumeFragranceAuthCredential !== 'function';

    // Defensive fallback for a page where site-config.js was blocked: never
    // leave one-time credentials in history after this script has read them.
    if (parameters.has('reset_token') || parameters.has('verify_token') || fragmentContainsCredential) {
        parameters.delete('reset_token');
        parameters.delete('verify_token');
        if (fragmentContainsCredential) {
            fragmentParameters.delete('reset_token');
            fragmentParameters.delete('verify_token');
        }
        const safeSearch = parameters.toString();
        const remainingFragment = fragmentContainsCredential ? fragmentParameters.toString() : '';
        const safeHash = fragmentContainsCredential
            ? (remainingFragment ? `#${initialHash.startsWith('#?') ? '?' : ''}${remainingFragment}` : '')
            : initialHash;
        window.history.replaceState(
            window.history.state,
            '',
            `${window.location.pathname}${safeSearch ? `?${safeSearch}` : ''}${safeHash}`
        );
    }
    switchTab(parameters.get('tab'), false);
    updateAuthPage(getCurrentUser());
    document.querySelectorAll('[data-local-google-note]').forEach((note) => {
        note.hidden = !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
    });
    if (authCredentialHandoffCleared) {
        loadGoogleIdentityScript()
            .then(() => {
                googleRenderAttempts = 0;
                renderGoogleButtons();
            })
            .catch((error) => {
                // Google sign-in is optional; password sign-in remains usable.
                showStatus(error.message, true);
            });
    } else {
        // Never load a third-party auth script if a one-time credential cannot
        // be removed from the page realm.
        showStatus('Google sign-in is temporarily unavailable. You can still use email and password.', true);
    }

    authUI.tabs.forEach((tab) => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        tab.addEventListener('keydown', (event) => {
            const currentIndex = authUI.tabs.indexOf(tab);
            let nextIndex = null;
            if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % authUI.tabs.length;
            if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + authUI.tabs.length) % authUI.tabs.length;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = authUI.tabs.length - 1;
            if (nextIndex === null) return;
            event.preventDefault();
            authUI.tabs[nextIndex].focus();
            switchTab(authUI.tabs[nextIndex].dataset.tab);
        });
    });
    authUI.signinForm?.addEventListener('submit', submitSignin);
    authUI.signupForm?.addEventListener('submit', submitSignup);
    document.getElementById('password-reset-request-form')?.addEventListener('submit', submitResetRequest);
    document.getElementById('password-reset-form')?.addEventListener('submit', submitNewPassword);
    document.getElementById('forgot-password-button')?.addEventListener('click', () => {
        document.getElementById('password-reset-email').value = document.getElementById('signin-email').value;
        showResetDialog('request');
    });
    document.getElementById('resend-verification-button')?.addEventListener('click', resendVerificationEmail);
    document.getElementById('password-reset-close')?.addEventListener('click', () => authUI.resetDialog.close());
    authUI.successModal?.addEventListener('close', () => authUI.successModal.classList.remove('show'));
    authUI.successModal?.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        authUI.successModal.close();
    });
    authUI.successModal?.addEventListener('click', (event) => {
        if (event.target === authUI.successModal) authUI.successModal.close();
    });
    document.getElementById('logout-button')?.addEventListener('click', handleSharedLogout);
    document.getElementById('auth-home-button')?.addEventListener('click', () => window.location.assign('/'));
    authUI.successButton?.addEventListener('click', () => {
        if (outcomeAction === 'home') {
            window.location.assign('/');
            return;
        }
        if (outcomeAction === 'account-link') {
            window.location.assign('/account.html#profile');
            return;
        }
        authUI.successModal.close();
        switchTab('signin');
        if (pendingVerificationEmail) {
            document.getElementById('signin-email').value = pendingVerificationEmail;
        }
        document.getElementById('signin-email')?.focus();
    });

    document.querySelectorAll('.password-toggle').forEach((button) => {
        button.addEventListener('click', () => {
            const input = button.parentElement.querySelector('input');
            const showing = input.type === 'text';
            input.type = showing ? 'password' : 'text';
            button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
            button.setAttribute('aria-pressed', String(!showing));
            button.querySelector('i')?.classList.toggle('fa-eye-slash', !showing);
            button.querySelector('i')?.classList.toggle('fa-eye', showing);
        });
    });

    document.addEventListener('fragrance:auth-change', (event) => updateAuthPage(event.detail.user));
    if (resetToken) showResetDialog('reset');
    else if (verifyToken) verifyEmailAddress();
});

window.addEventListener('resize', () => {
    window.clearTimeout(googleRenderTimer);
    googleRenderTimer = window.setTimeout(renderGoogleButtons, 160);
});
