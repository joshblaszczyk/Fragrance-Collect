document.addEventListener('DOMContentLoaded', () => {

    const ui = {
        sidebarLinks: document.querySelectorAll('.account-sidebar nav a'),
        panels: document.querySelectorAll('.account-panel'),
        preferencesForm: document.getElementById('preferences-form'),
        favoritesGrid: document.getElementById('favorites-grid'),
        alertsList: document.getElementById('alerts-list'),
        profileForm: document.getElementById('profile-form'),
        deletionDialog: document.getElementById('account-deletion-dialog'),
        deletionForm: document.getElementById('account-deletion-form'),
        deletionPasswordGroup: document.getElementById('account-deletion-password-group'),
        deletionPassword: document.getElementById('account-deletion-password'),
        deletionConfirmation: document.getElementById('account-deletion-confirmation'),
        deletionGoogle: document.getElementById('account-deletion-google'),
        deletionStatus: document.getElementById('account-deletion-status'),
        deletionSubmit: document.getElementById('account-deletion-submit')
    };

    let user = null;
    let deletionUsesGoogle = false;
    let deletionGoogleCredential = '';
    let passwordSetupGoogleCredential = '';
    let accountGoogleInitialized = false;
    let googleLinkRenderAttempts = 0;
    let googleLinkRenderTimer;
    let deletionGoogleRenderAttempts = 0;
    let deletionGoogleRenderTimer;
    let passwordSetupGoogleRenderAttempts = 0;
    let passwordSetupGoogleRenderTimer;

    function hasGoogleIdentity() {
        return user?.hasGoogleIdentity === true;
    }

    function googleConfirmationBlockedLocally() {
        const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
        return isLocal && window.google?.accounts?.id?.__fragranceTestHarness !== true;
    }

    function showNotification(message, type = 'success', duration = 4000) {
        document.querySelector('.notification')?.remove();
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.setAttribute('role', type === 'error' ? 'alert' : 'status');
        notification.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

        const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
        const contentElement = document.createElement('div');
        contentElement.className = 'notification-content';
        const iconElement = document.createElement('div');
        iconElement.className = 'notification-icon';
        iconElement.setAttribute('aria-hidden', 'true');
        iconElement.textContent = icon;
        const messageElement = document.createElement('div');
        messageElement.className = 'notification-message';
        messageElement.textContent = String(message);
        const closeElement = document.createElement('button');
        closeElement.className = 'notification-close';
        closeElement.type = 'button';
        closeElement.setAttribute('aria-label', 'Dismiss notification');
        closeElement.textContent = '×';
        contentElement.append(iconElement, messageElement, closeElement);
        notification.appendChild(contentElement);
        document.body.appendChild(notification);
        requestAnimationFrame(() => notification.classList.add('is-visible'));

        const dismiss = () => {
            notification.classList.remove('is-visible');
            notification.addEventListener('transitionend', () => notification.remove(), { once: true });
            setTimeout(() => notification.remove(), 350);
        };
        closeElement.addEventListener('click', dismiss);
        setTimeout(dismiss, duration);
    }

    async function init() {
        await waitForSharedAuth();
        await checkUserStatus();
        if (!user) {
            window.location.href = 'auth.html';
            return;
        }
        setupEventListeners();
        loadUserProfile();
        if (!user.identityLinkRequired) {
            loadPreferences();
            loadFavorites();
            loadAlerts();
        }
        if (user.identityLinkRequired) {
            switchPanel('profile');
            window.history.replaceState(null, '', '#profile');
            showNotification('Finish securing this recovered account by linking the verified Google sign-in below.', 'info', 7000);
        } else {
            handleInitialTab();
        }
    }

    async function waitForSharedAuth() {
        let attempts = 0;
        const maxAttempts = 50;

        await new Promise(resolve => setTimeout(resolve, 500));

        while (attempts < maxAttempts) {
            if (typeof getCurrentUser === 'function') {
                const sharedUser = getCurrentUser();
                if (sharedUser) {
                    user = sharedUser;
                    return;
                }
            }

            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
    }

    async function checkUserStatus() {
        if (user) {
            return;
        }

        try {
            const response = await fetch(`${window.API_BASE}/api/status`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });
            const data = await response.json();
            if (data.success && data.user) {
                user = data.user;
            }
        } catch (error) {
            console.error('Error checking user status:', error);
        }
    }

    async function refreshUserStatus() {
        const response = await fetch(`${window.API_BASE}/api/status`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            credentials: 'include'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success || !data.user) {
            throw new Error(data.error || 'Unable to refresh your sign-in methods.');
        }
        user = data.user;
        if (typeof updateSharedNavUI === 'function') updateSharedNavUI(user);
        updateHeaderDisplay();
        renderConnectedSignInMethods();
        return user;
    }

    function setupEventListeners() {
        ui.sidebarLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = link.getAttribute('href').substring(1);
                if (user?.identityLinkRequired && targetId !== 'profile') {
                    showNotification('Link Google in Profile & Settings before opening other account areas.', 'info', 5000);
                    document.getElementById('google-link-controls')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return;
                }
                switchPanel(targetId);
                window.history.pushState(null, '', `#${targetId}`);
            });
        });

        if (ui.preferencesForm) {
            ui.preferencesForm.addEventListener('submit', handlePreferencesSubmit);
        }
        const logoutBtn = document.getElementById('account-logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', handleAccountLogout);
        }
        document.getElementById('export-data-btn')?.addEventListener('click', handleDataExport);
        document.getElementById('delete-account-button')?.addEventListener('click', openAccountDeletionDialog);
        document.getElementById('account-deletion-close')?.addEventListener('click', closeAccountDeletionDialog);
        document.getElementById('account-deletion-cancel')?.addEventListener('click', closeAccountDeletionDialog);
        ui.deletionForm?.addEventListener('submit', handleAccountDeletion);
        ui.deletionConfirmation?.addEventListener('input', updateDeletionSubmitState);
        ui.deletionPassword?.addEventListener('input', updateDeletionSubmitState);
        ui.deletionDialog?.addEventListener('click', (event) => {
            if (event.target === ui.deletionDialog) closeAccountDeletionDialog();
        });
        ui.deletionDialog?.addEventListener('close', resetAccountDeletionDialog);
        window.addEventListener('hashchange', handleInitialTab);
    }

    async function handleDataExport(event) {
        const button = event.currentTarget;
        const label = button.querySelector('span');
        const originalText = label.textContent;
        button.disabled = true;
        label.textContent = 'Preparing download…';

        try {
            const response = await fetch(`${window.API_BASE}/api/user/export`, {
                credentials: 'include',
                headers: { Accept: 'application/json' }
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const message = response.status === 404
                    ? 'Data export is not available on the selected API release.'
                    : data.error || 'Unable to prepare your data export.';
                throw new Error(message);
            }

            const downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = `fragrance-collect-data-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
            showNotification('Your data export is ready.', 'success');
        } catch (error) {
            showNotification(error.message, 'error');
        } finally {
            button.disabled = false;
            label.textContent = originalText;
        }
    }

    function setDeletionStatus(message = '', isError = false) {
        if (!ui.deletionStatus) return;
        ui.deletionStatus.textContent = message;
        ui.deletionStatus.classList.toggle('is-error', isError);
        ui.deletionStatus.setAttribute('role', isError ? 'alert' : 'status');
    }

    function updateDeletionSubmitState() {
        if (!ui.deletionSubmit) return;
        const confirmed = ui.deletionConfirmation.value === 'DELETE';
        const hasIdentityProof = deletionUsesGoogle
            ? Boolean(deletionGoogleCredential)
            : Boolean(ui.deletionPassword.value);
        ui.deletionSubmit.disabled = !confirmed || !hasIdentityProof;
    }

    function showGoogleDeletionReauthentication() {
        deletionUsesGoogle = true;
        deletionGoogleCredential = '';
        ui.deletionPasswordGroup.hidden = true;
        ui.deletionPassword.required = false;
        ui.deletionPassword.value = '';
        ui.deletionGoogle.hidden = false;
        updateDeletionSubmitState();
        renderDeletionGoogleButton();
    }

    function handleAccountGoogleCredential(response) {
        const deletionActive = Boolean(ui.deletionDialog?.open && !ui.deletionGoogle.hidden);
        const linkControls = document.getElementById('google-link-controls');
        const linkingActive = Boolean(linkControls && !linkControls.hidden && !hasGoogleIdentity());
        if (!response?.credential) {
            if (deletionActive) {
                setDeletionStatus('Google did not return an identity confirmation. Please try again.', true);
            } else if (linkingActive) {
                setGoogleLinkStatus('Google did not return an identity confirmation. Please try again.', true);
            } else {
                setPasswordSetupStatus('Google did not return an identity confirmation. Please try again.', true);
            }
            return;
        }

        if (deletionActive) {
            deletionGoogleCredential = response.credential;
            setDeletionStatus('Google identity confirmed. Review the warning, type DELETE, and continue.');
            updateDeletionSubmitState();
            ui.deletionConfirmation.focus();
            return;
        }

        if (linkingActive) {
            linkGoogleIdentity(response.credential);
            return;
        }

        passwordSetupGoogleCredential = response.credential;
        const setupFields = document.getElementById('password-setup-fields');
        if (!setupFields) return;
        setupFields.hidden = false;
        setPasswordSetupStatus('Google identity confirmed. Create your Fragrance Collect password below.');
        document.getElementById('password-setup-new')?.focus();
    }

    function renderDeletionGoogleButton() {
        const host = document.getElementById('account-deletion-google-button');
        if (!host || ui.deletionGoogle.hidden) return;
        if (googleConfirmationBlockedLocally()) {
            setDeletionStatus('Google confirmation requires an authorized production origin. Open your account on fragrancecollect.com to complete deletion.', true);
            return;
        }

        const googleIdentity = window.google?.accounts?.id;
        const clientId = document.querySelector('meta[name="google-signin-client-id"]')?.content;
        if (!googleIdentity || !clientId) {
            if (deletionGoogleRenderAttempts < 40) {
                deletionGoogleRenderAttempts += 1;
                window.clearTimeout(deletionGoogleRenderTimer);
                deletionGoogleRenderTimer = window.setTimeout(renderDeletionGoogleButton, 150);
            } else {
                setDeletionStatus('Google confirmation could not be loaded. Check your connection and try again.', true);
            }
            return;
        }

        if (!accountGoogleInitialized) {
            googleIdentity.initialize({
                client_id: clientId,
                callback: handleAccountGoogleCredential,
                ux_mode: 'popup'
            });
            accountGoogleInitialized = true;
        }

        host.replaceChildren();
        googleIdentity.renderButton(host, {
            type: 'standard',
            theme: 'filled_black',
            size: 'large',
            text: 'continue_with',
            shape: 'rectangular',
            logo_alignment: 'left',
            width: Math.min(400, Math.max(220, Math.floor(host.getBoundingClientRect().width || 320)))
        });
    }

    function setGoogleLinkStatus(message = '', isError = false) {
        const status = document.getElementById('google-link-status');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('is-error', isError);
        status.setAttribute('role', isError ? 'alert' : 'status');
    }

    function renderGoogleLinkButton() {
        const host = document.getElementById('google-link-button');
        const controls = document.getElementById('google-link-controls');
        if (!host || !controls || controls.hidden || hasGoogleIdentity()) return;
        if (googleConfirmationBlockedLocally()) {
            setGoogleLinkStatus('Google linking requires an authorized production origin. Open fragrancecollect.com to connect this sign-in method.');
            return;
        }

        const googleIdentity = window.google?.accounts?.id;
        const clientId = document.querySelector('meta[name="google-signin-client-id"]')?.content;
        if (!googleIdentity || !clientId) {
            if (googleLinkRenderAttempts < 40) {
                googleLinkRenderAttempts += 1;
                window.clearTimeout(googleLinkRenderTimer);
                googleLinkRenderTimer = window.setTimeout(renderGoogleLinkButton, 150);
            } else {
                setGoogleLinkStatus('Google sign-in could not be loaded. Check your connection and try again.', true);
            }
            return;
        }

        if (!accountGoogleInitialized) {
            googleIdentity.initialize({
                client_id: clientId,
                callback: handleAccountGoogleCredential,
                ux_mode: 'popup'
            });
            accountGoogleInitialized = true;
        }
        host.replaceChildren();
        googleIdentity.renderButton(host, {
            type: 'standard',
            theme: 'filled_black',
            size: 'large',
            text: 'continue_with',
            shape: 'rectangular',
            logo_alignment: 'left',
            width: Math.min(400, Math.max(220, Math.floor(host.getBoundingClientRect().width || 320)))
        });
    }

    async function linkGoogleIdentity(credential) {
        const controls = document.getElementById('google-link-controls');
        const passwordInput = document.getElementById('google-link-current-password');
        const host = document.getElementById('google-link-button');
        const currentPassword = passwordInput?.value || '';
        if (user?.hasPassword && !currentPassword) {
            setGoogleLinkStatus('Enter your current password before continuing with Google.', true);
            passwordInput?.setAttribute('aria-invalid', 'true');
            passwordInput?.focus();
            return;
        }

        passwordInput?.removeAttribute('aria-invalid');
        controls?.setAttribute('aria-busy', 'true');
        host?.setAttribute('aria-disabled', 'true');
        setGoogleLinkStatus('Confirming this Google account…');
        try {
            const body = { credential };
            if (user?.hasPassword) body.currentPassword = currentPassword;
            const response = await fetch(`${window.API_BASE}/api/user/identities/google`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (data.code === 'password_reauthentication_required' || data.code === 'reauthentication_failed') {
                    passwordInput?.setAttribute('aria-invalid', 'true');
                    passwordInput?.focus();
                }
                throw new Error(data.error || 'Unable to link Google to this account.');
            }

            if (passwordInput) passwordInput.value = '';
            const wasIdentityRestricted = user.identityLinkRequired === true;
            user.hasGoogleIdentity = true;
            user.identityLinkRequired = false;
            try {
                await refreshUserStatus();
            } catch {
                renderConnectedSignInMethods();
            }
            if (wasIdentityRestricted) {
                loadPreferences();
                loadFavorites();
                loadAlerts();
            }
            setGoogleLinkStatus(data.message || 'Google is connected to your account.');
            showNotification(data.message || 'Google is now connected to your account.', 'success', 6000);
        } catch (error) {
            setGoogleLinkStatus(error.message, true);
        } finally {
            controls?.removeAttribute('aria-busy');
            host?.removeAttribute('aria-disabled');
        }
    }

    function renderConnectedSignInMethods() {
        const googleConnected = hasGoogleIdentity();
        const passwordConnected = user?.hasPassword === true;
        const googleBadge = document.getElementById('google-method-status');
        const googleDescription = document.getElementById('google-method-description');
        const passwordBadge = document.getElementById('password-method-status');
        const passwordDescription = document.getElementById('password-method-description');
        const controls = document.getElementById('google-link-controls');
        const passwordGroup = document.getElementById('google-link-password-group');
        const setupNote = document.getElementById('password-provider-note');
        const changeSection = document.getElementById('password-change-section');
        const recoveryNotice = document.getElementById('identity-recovery-notice');
        const profileName = document.getElementById('profile-name');
        const profileUpdateButton = document.getElementById('profile-update-button');
        if (!googleBadge || !passwordBadge || !controls) return;

        googleBadge.textContent = googleConnected ? 'Connected' : 'Not connected';
        googleBadge.classList.toggle('is-connected', googleConnected);
        googleDescription.textContent = googleConnected
            ? `Google can securely sign in to ${user.email}.`
            : `Connect the Google account verified for ${user.email}.`;
        passwordBadge.textContent = passwordConnected ? 'Connected' : 'Not set';
        passwordBadge.classList.toggle('is-connected', passwordConnected);
        passwordDescription.textContent = passwordConnected
            ? 'A Fragrance Collect password is active.'
            : (googleConnected
                ? 'Optional: create a Fragrance Collect password below.'
                : 'Connect Google to finish recovering this account.');

        controls.hidden = googleConnected;
        passwordGroup.hidden = !passwordConnected;
        if (setupNote) setupNote.hidden = passwordConnected || !googleConnected;
        if (changeSection) changeSection.hidden = !passwordConnected;
        if (recoveryNotice) recoveryNotice.hidden = user?.identityLinkRequired !== true;
        if (profileName) profileName.readOnly = user?.identityLinkRequired === true;
        if (profileUpdateButton) profileUpdateButton.hidden = user?.identityLinkRequired === true;

        window.clearTimeout(googleLinkRenderTimer);
        if (!googleConnected) {
            googleLinkRenderAttempts = 0;
            renderGoogleLinkButton();
        } else if (!passwordConnected) {
            renderPasswordSetupGoogleButton();
        }
    }

    function resetAccountDeletionDialog() {
        window.clearTimeout(deletionGoogleRenderTimer);
        ui.deletionForm?.reset();
        deletionGoogleCredential = '';
        deletionGoogleRenderAttempts = 0;
        setDeletionStatus('');
        if (ui.deletionSubmit) {
            ui.deletionSubmit.disabled = true;
            ui.deletionSubmit.removeAttribute('aria-busy');
            ui.deletionSubmit.textContent = 'Delete permanently';
        }
    }

    function openAccountDeletionDialog() {
        resetAccountDeletionDialog();
        deletionUsesGoogle = user?.hasPassword === false;
        ui.deletionPasswordGroup.hidden = deletionUsesGoogle;
        ui.deletionPassword.required = !deletionUsesGoogle;
        ui.deletionGoogle.hidden = !deletionUsesGoogle;
        if (!ui.deletionDialog.open) ui.deletionDialog.showModal();
        if (deletionUsesGoogle) renderDeletionGoogleButton();
        window.requestAnimationFrame(() => {
            const target = deletionUsesGoogle
                ? document.getElementById('account-deletion-google-button')
                : ui.deletionPassword;
            target?.focus();
        });
    }

    function closeAccountDeletionDialog() {
        if (ui.deletionDialog?.open) ui.deletionDialog.close();
    }

    async function handleAccountDeletion(event) {
        event.preventDefault();
        if (ui.deletionConfirmation.value !== 'DELETE') {
            setDeletionStatus('Type DELETE exactly to confirm permanent account deletion.', true);
            ui.deletionConfirmation.focus();
            return;
        }

        const body = { confirmation: 'DELETE' };
        if (deletionUsesGoogle) body.googleCredential = deletionGoogleCredential;
        else body.currentPassword = ui.deletionPassword.value;

        ui.deletionSubmit.disabled = true;
        ui.deletionSubmit.setAttribute('aria-busy', 'true');
        ui.deletionSubmit.textContent = 'Deleting account…';
        setDeletionStatus('');
        try {
            const response = await fetch(`${window.API_BASE}/api/user/account`, {
                method: 'DELETE',
                credentials: 'include',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (data.code === 'google_reauthentication_required') {
                    showGoogleDeletionReauthentication();
                    setDeletionStatus(data.error || 'Confirm your identity with Google to continue.', true);
                    return;
                }
                if (data.code === 'password_reauthentication_required') {
                    deletionUsesGoogle = false;
                    ui.deletionGoogle.hidden = true;
                    ui.deletionPasswordGroup.hidden = false;
                    ui.deletionPassword.required = true;
                    setDeletionStatus(data.error || 'Enter your current password to continue.', true);
                    ui.deletionPassword.focus();
                    return;
                }
                if (data.code === 'reauthentication_failed' && deletionUsesGoogle) {
                    deletionGoogleCredential = '';
                    renderDeletionGoogleButton();
                }
                throw new Error(data.error || 'Unable to delete your account.');
            }

            if (typeof updateSharedNavUI === 'function') updateSharedNavUI(null);
            closeAccountDeletionDialog();
            showNotification(data.message || 'Your account has been deleted.', 'success', 6000);
            window.setTimeout(() => window.location.replace('/'), 900);
        } catch (error) {
            setDeletionStatus(error.message, true);
        } finally {
            if (ui.deletionDialog?.open) {
                ui.deletionSubmit.removeAttribute('aria-busy');
                ui.deletionSubmit.textContent = 'Delete permanently';
                updateDeletionSubmitState();
            }
        }
    }

    function setupProfileFormEventListeners() {
        if (ui.profileForm) {
            ui.profileForm.addEventListener('submit', handleProfileSubmit);

            const changePasswordBtn = document.getElementById('change-password-btn');
            const cancelPasswordBtn = document.getElementById('cancel-password-btn');
            const passwordToggleHeader = document.getElementById('password-change-header');

            if (changePasswordBtn) {
                changePasswordBtn.addEventListener('click', handlePasswordChange);
            }
            if (cancelPasswordBtn) {
                cancelPasswordBtn.addEventListener('click', handlePasswordCancel);
            }
            if (passwordToggleHeader) {
                passwordToggleHeader.addEventListener('click', togglePasswordSection);
            }
            document.getElementById('password-setup-submit')
                ?.addEventListener('click', handlePasswordSetup);
            document.getElementById('google-link-current-password')
                ?.addEventListener('keydown', (event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    setGoogleLinkStatus('Continue with the Google button to confirm and link this sign-in method.');
                });

            setupPasswordValidation();
        }
    }

    function switchPanel(targetId) {
        const validTarget = [...ui.panels].some((panel) => panel.id === targetId) ? targetId : 'profile';
        ui.panels.forEach(panel => {
            const isActive = panel.id === validTarget;
            panel.classList.toggle('active', isActive);
            panel.hidden = !isActive;
        });
        ui.sidebarLinks.forEach(link => {
            const isActive = link.getAttribute('href') === `#${validTarget}`;
            link.classList.toggle('active', isActive);
            if (isActive) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
    }

    function handleInitialTab() {
        const hash = window.location.hash.substring(1);
        if (hash) {
            switchPanel(hash);
        } else {
            switchPanel('profile');
        }
    }

    async function loadUserProfile() {
        if (!ui.profileForm) return;

        ui.profileForm.innerHTML = `
            <div class="form-group">
                <label for="profile-name">Full Name</label>
                <input type="text" id="profile-name" name="name" autocomplete="name" maxlength="100" required>
            </div>
            <div class="form-group">
                <label for="profile-email">Email</label>
                <input type="email" id="profile-email" name="email" autocomplete="email" aria-describedby="profile-email-note" required readonly>
                <small id="profile-email-note">Email cannot be changed</small>
            </div>
            <div class="form-group">
                <span class="form-label">Profile Picture</span>
                <div class="current-picture">
                    <img src="assets/images/emblem-96.webp" alt="" id="current-picture">
                </div>
                <small>Profile pictures are managed by your connected sign-in provider.</small>
            </div>
            <button type="submit" class="btn" id="profile-update-button">Update Profile</button>

            <section class="connected-methods" aria-labelledby="connected-methods-title">
                <div class="connected-methods__heading">
                    <div>
                        <p class="connected-methods__eyebrow">Account security</p>
                        <h2 id="connected-methods-title">Connected sign-in methods</h2>
                    </div>
                    <i class="fas fa-shield-alt connected-methods__shield" aria-hidden="true"></i>
                </div>
                <p class="connected-methods__intro">Use more than one verified method to keep access to this account. A Google identity is linked only after you sign in here and confirm the same email.</p>
                <div class="identity-recovery-notice" id="identity-recovery-notice" hidden>
                    <i class="fas fa-link" aria-hidden="true"></i>
                    <p><strong>Finish account recovery.</strong> Your email is verified. Connect the same Google account below before changing profile data or opening saved account areas.</p>
                </div>

                <div class="sign-in-method-list">
                    <article class="sign-in-method">
                        <div class="sign-in-method__icon" aria-hidden="true"><i class="fab fa-google"></i></div>
                        <div class="sign-in-method__copy">
                            <div class="sign-in-method__title-row">
                                <h3>Google</h3>
                                <span class="sign-in-method__status" id="google-method-status">Checking…</span>
                            </div>
                            <p id="google-method-description">Checking this sign-in method.</p>
                        </div>
                    </article>

                    <article class="sign-in-method">
                        <div class="sign-in-method__icon" aria-hidden="true"><i class="fas fa-key"></i></div>
                        <div class="sign-in-method__copy">
                            <div class="sign-in-method__title-row">
                                <h3>Email and password</h3>
                                <span class="sign-in-method__status" id="password-method-status">Checking…</span>
                            </div>
                            <p id="password-method-description">Checking this sign-in method.</p>
                        </div>
                    </article>
                </div>

                <div class="google-link-controls" id="google-link-controls" hidden>
                    <div class="form-group google-link-password" id="google-link-password-group" hidden>
                        <label for="google-link-current-password">Confirm your current password</label>
                        <input type="password" id="google-link-current-password" autocomplete="current-password" maxlength="200" aria-describedby="google-link-password-help google-link-status">
                        <small id="google-link-password-help">Required before adding a new sign-in method.</small>
                    </div>
                    <div id="google-link-button" class="google-link-button"></div>
                    <p class="google-link-disclosure">Google must verify the same email shown on this profile. Linking never merges accounts by email alone.</p>
                    <p id="google-link-status" class="google-link-status" role="status" aria-live="polite"></p>
                </div>
            </section>

            <div class="password-provider-note" id="password-provider-note" hidden>
                <p>You currently sign in with Google. Confirm with the same Google account before creating an optional Fragrance Collect password.</p>
                <div id="password-setup-google-button" class="password-setup-google-button"></div>
                <div id="password-setup-fields" class="password-setup-fields" hidden>
                    <div class="form-group">
                        <label for="password-setup-new">New password</label>
                        <input type="password" id="password-setup-new" autocomplete="new-password" minlength="8" maxlength="200">
                    </div>
                    <div class="form-group">
                        <label for="password-setup-confirm">Confirm new password</label>
                        <input type="password" id="password-setup-confirm" autocomplete="new-password" maxlength="200">
                    </div>
                    <button type="button" class="btn btn-secondary" id="password-setup-submit">Create password</button>
                </div>
                <p id="password-setup-status" class="password-setup-status" role="status" aria-live="polite"></p>
            </div>

            <div class="password-change-section" id="password-change-section">
                <button type="button" class="password-change-header" id="password-change-header" aria-expanded="false" aria-controls="password-change-content">
                    <span class="password-change-title">
                        <i class="fas fa-lock" aria-hidden="true"></i>
                        <span>Change Password</span>
                    </span>
                    <span class="password-change-toggle">
                        <i class="fas fa-chevron-down" id="password-toggle-icon" aria-hidden="true"></i>
                    </span>
                </button>

                <div class="password-change-content" id="password-change-content" hidden>
                    <div class="password-change-info">
                        <i class="fas fa-info-circle" aria-hidden="true"></i>
                        <span>Update your password to keep your account secure</span>
                    </div>

                    <div class="form-group">
                        <label for="current-password">
                            <i class="fas fa-key" aria-hidden="true"></i>
                            Current Password
                        </label>
                        <input type="password" id="current-password" name="currentPassword" autocomplete="current-password" maxlength="200">
                    </div>

                    <div class="form-group">
                        <label for="new-password">
                            <i class="fas fa-shield-alt" aria-hidden="true"></i>
                            New Password
                        </label>
                        <input type="password" id="new-password" name="newPassword" autocomplete="new-password" minlength="8" maxlength="200" aria-describedby="password-strength-text password-requirements">
                        <div class="password-strength-indicator">
                            <div class="strength-bar" aria-hidden="true"></div>
                            <span class="strength-text" id="password-strength-text" role="status" aria-live="polite">Password strength</span>
                        </div>
                        <small id="password-requirements">Use at least 8 characters with uppercase, lowercase, a number, and a symbol.</small>
                    </div>

                    <div class="form-group">
                        <label for="confirm-password">
                            <i class="fas fa-check-circle" aria-hidden="true"></i>
                            Confirm New Password
                        </label>
                        <input type="password" id="confirm-password" name="confirmPassword" autocomplete="new-password" maxlength="200" aria-describedby="password-match-text">
                        <div class="password-match-indicator" role="status" aria-live="polite">
                            <i class="fas fa-circle" id="password-match-icon" aria-hidden="true"></i>
                            <span id="password-match-text">Enter the new password again.</span>
                        </div>
                    </div>

                    <div class="password-change-actions">
                        <button type="button" id="change-password-btn" class="btn btn-password-change">
                            <i class="fas fa-lock" aria-hidden="true"></i>
                            <span>Change Password</span>
                        </button>
                        <button type="button" id="cancel-password-btn" class="btn btn-cancel">
                            <i class="fas fa-times" aria-hidden="true"></i>
                            <span>Cancel</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        ui.profileForm.querySelector('#profile-name').value = user.name || '';
        ui.profileForm.querySelector('#profile-email').value = user.email || '';
        const profilePicture = safeHttpsUrl(user.picture);
        const currentPicture = ui.profileForm.querySelector('#current-picture');
        currentPicture.src = profilePicture || 'assets/images/emblem-96.webp';
        currentPicture.alt = profilePicture ? `${user.name || 'User'} profile picture` : '';
        updateHeaderDisplay();
        setupProfileFormEventListeners();
        renderConnectedSignInMethods();
    }

    function updateHeaderDisplay() {
        const headerProfileImg = document.getElementById('header-profile-picture');
        const headerUserName = document.getElementById('header-user-name');

        if (headerProfileImg) {
            const profilePicture = safeHttpsUrl(user.picture);
            headerProfileImg.src = profilePicture || 'assets/images/emblem-96.webp';
            headerProfileImg.alt = profilePicture ? `${user.name || 'User'} profile picture` : '';
        }

        if (headerUserName) {
            headerUserName.textContent = `Welcome, ${user.name || 'User'}`;
        }
    }

    async function handlePasswordChange() {
        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;

        const currentPasswordInput = document.getElementById('current-password');
        const newPasswordInput = document.getElementById('new-password');
        const confirmPasswordInput = document.getElementById('confirm-password');
        [currentPasswordInput, newPasswordInput, confirmPasswordInput]
            .forEach((input) => input.removeAttribute('aria-invalid'));

        if (!currentPassword || !newPassword || !confirmPassword) {
            showNotification('Please fill in all password fields.', 'error');
            const firstEmptyInput = [currentPasswordInput, newPasswordInput, confirmPasswordInput]
                .find((input) => !input.value);
            firstEmptyInput?.setAttribute('aria-invalid', 'true');
            firstEmptyInput?.focus();
            return;
        }

        if (!isComplexPassword(newPassword)) {
            showNotification('Use at least 8 characters with uppercase, lowercase, a number, and a symbol.', 'error');
            newPasswordInput.setAttribute('aria-invalid', 'true');
            newPasswordInput.focus();
            return;
        }

        if (newPassword !== confirmPassword) {
            showNotification('New passwords do not match.', 'error');
            confirmPasswordInput.setAttribute('aria-invalid', 'true');
            confirmPasswordInput.focus();
            return;
        }

        const changePasswordBtn = document.getElementById('change-password-btn');
        const changePasswordLabel = changePasswordBtn.querySelector('span');
        const originalText = changePasswordLabel.textContent;

        changePasswordLabel.textContent = 'Changing Password…';
        changePasswordBtn.disabled = true;
        changePasswordBtn.setAttribute('aria-busy', 'true');

        const passwordData = {
            currentPassword: currentPassword,
            newPassword: newPassword
        };


        const headers = { 'Content-Type': 'application/json' };


        try {
            const response = await fetch(`${window.API_BASE}/api/user/password`, {
                method: 'POST',
                headers: headers,
                credentials: 'include',
                body: JSON.stringify(passwordData),
            });


            if (response.ok) {
                const responseData = await response.json();

                if (responseData.success) {
                    showNotification('Password changed successfully!', 'success');
                    clearPasswordFields();
                    togglePasswordSection();
                } else {
                    showNotification(`Failed to change password: ${responseData.error || 'Unknown error'}`, 'error');
                }
            } else {
                const errorText = await response.text();

                let errorMessage = `Failed to change password: ${response.status} ${response.statusText}`;
                try {
                    const errorData = JSON.parse(errorText);
                    if (errorData.error) {
                        errorMessage = errorData.error;
                    }
                } catch {}
                showNotification(errorMessage, 'error', 6000);
            }
        } catch (error) {
            console.error('Error changing password:', error);
            showNotification('Error changing password. Please check your connection and try again.', 'error');
        } finally {
            changePasswordLabel.textContent = originalText;
            changePasswordBtn.disabled = false;
            changePasswordBtn.removeAttribute('aria-busy');
        }
    }

    function setPasswordSetupStatus(message = '', isError = false) {
        const status = document.getElementById('password-setup-status');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('is-error', isError);
        status.setAttribute('role', isError ? 'alert' : 'status');
    }

    function renderPasswordSetupGoogleButton() {
        const host = document.getElementById('password-setup-google-button');
        if (!host) return;
        if (googleConfirmationBlockedLocally()) {
            setPasswordSetupStatus('Google confirmation requires an authorized production origin. Use fragrancecollect.com to add a password.', true);
            return;
        }

        const googleIdentity = window.google?.accounts?.id;
        const clientId = document.querySelector('meta[name="google-signin-client-id"]')?.content;
        if (!googleIdentity || !clientId) {
            if (passwordSetupGoogleRenderAttempts < 40) {
                passwordSetupGoogleRenderAttempts += 1;
                window.clearTimeout(passwordSetupGoogleRenderTimer);
                passwordSetupGoogleRenderTimer = window.setTimeout(renderPasswordSetupGoogleButton, 150);
            } else {
                setPasswordSetupStatus('Google confirmation could not be loaded. Check your connection and try again.', true);
            }
            return;
        }

        if (!accountGoogleInitialized) {
            googleIdentity.initialize({
                client_id: clientId,
                callback: handleAccountGoogleCredential,
                ux_mode: 'popup'
            });
            accountGoogleInitialized = true;
        }
        host.replaceChildren();
        googleIdentity.renderButton(host, {
            type: 'standard',
            theme: 'filled_black',
            size: 'large',
            text: 'continue_with',
            shape: 'rectangular',
            logo_alignment: 'left',
            width: Math.min(400, Math.max(220, Math.floor(host.getBoundingClientRect().width || 320)))
        });
    }

    async function handlePasswordSetup() {
        const button = document.getElementById('password-setup-submit');
        const newPassword = document.getElementById('password-setup-new')?.value || '';
        const confirmation = document.getElementById('password-setup-confirm')?.value || '';
        if (!passwordSetupGoogleCredential) {
            setPasswordSetupStatus('Confirm your identity with Google first.', true);
            renderPasswordSetupGoogleButton();
            return;
        }
        if (!isComplexPassword(newPassword)) {
            setPasswordSetupStatus('Use 8 or more characters with uppercase, lowercase, a number, and a symbol.', true);
            document.getElementById('password-setup-new')?.focus();
            return;
        }
        if (newPassword !== confirmation) {
            setPasswordSetupStatus('Passwords do not match.', true);
            document.getElementById('password-setup-confirm')?.focus();
            return;
        }

        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        const originalText = button.textContent;
        button.textContent = 'Creating password…';
        try {
            const response = await fetch(`${window.API_BASE}/api/user/password`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    newPassword,
                    googleCredential: passwordSetupGoogleCredential
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (data.code === 'google_reauthentication_required' || data.code === 'reauthentication_failed') {
                    passwordSetupGoogleCredential = '';
                    document.getElementById('password-setup-fields').hidden = true;
                    renderPasswordSetupGoogleButton();
                }
                throw new Error(data.error || 'Unable to create your password.');
            }

            passwordSetupGoogleCredential = '';
            user.hasPassword = true;
            document.getElementById('password-setup-new').value = '';
            document.getElementById('password-setup-confirm').value = '';
            renderConnectedSignInMethods();
            showNotification(data.message || 'Your Fragrance Collect password is ready.', 'success', 6000);
        } catch (error) {
            setPasswordSetupStatus(error.message, true);
        } finally {
            button.disabled = false;
            button.removeAttribute('aria-busy');
            button.textContent = originalText;
        }
    }

    function togglePasswordSection() {
        const content = document.getElementById('password-change-content');
        const icon = document.getElementById('password-toggle-icon');
        const header = document.getElementById('password-change-header');
        const willOpen = content.hidden;

        content.hidden = !willOpen;
        header.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) {
            icon.classList.remove('fa-chevron-down');
            icon.classList.add('fa-chevron-up');
            window.requestAnimationFrame(() => document.getElementById('current-password')?.focus());
        } else {
            icon.classList.remove('fa-chevron-up');
            icon.classList.add('fa-chevron-down');
            clearPasswordFields();
        }
    }

    function isComplexPassword(password) {
        return password.length >= 8
            && /[a-z]/.test(password)
            && /[A-Z]/.test(password)
            && /\d/.test(password)
            && /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    }

    function handlePasswordCancel() {
        clearPasswordFields();
        togglePasswordSection();
    }

    function clearPasswordFields() {
        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';
        document.querySelectorAll('#password-change-content [aria-invalid="true"]')
            .forEach((input) => input.removeAttribute('aria-invalid'));
        updatePasswordStrength('');
        updatePasswordMatch('', '');
    }

    function setupPasswordValidation() {
        const newPasswordInput = document.getElementById('new-password');
        const confirmPasswordInput = document.getElementById('confirm-password');

        if (newPasswordInput) {
            newPasswordInput.addEventListener('input', function() {
                updatePasswordStrength(this.value);
                const confirmValue = document.getElementById('confirm-password').value;
                if (confirmValue) {
                    updatePasswordMatch(this.value, confirmValue);
                }
            });
        }

        if (confirmPasswordInput) {
            confirmPasswordInput.addEventListener('input', function() {
                const newPasswordValue = document.getElementById('new-password').value;
                updatePasswordMatch(newPasswordValue, this.value);
            });
        }
    }

    function updatePasswordStrength(password) {
        const strengthBar = document.querySelector('.strength-bar');
        const strengthText = document.querySelector('.strength-text');

        if (!strengthBar || !strengthText) return;

        let strength = 0;
        let strengthLabel = '';

        if (password.length >= 8) strength += 1;
        if (password.match(/[a-z]/)) strength += 1;
        if (password.match(/[A-Z]/)) strength += 1;
        if (password.match(/[0-9]/)) strength += 1;
        if (password.match(/[^a-zA-Z0-9]/)) strength += 1;

        switch (strength) {
            case 0:
            case 1:
                strengthLabel = 'Very Weak';
                break;
            case 2:
                strengthLabel = 'Weak';
                break;
            case 3:
                strengthLabel = 'Fair';
                break;
            case 4:
                strengthLabel = 'Good';
                break;
            case 5:
                strengthLabel = 'Strong';
                break;
        }

        strengthBar.className = `strength-bar strength-${strength}`;
        strengthText.textContent = password ? `Password strength: ${strengthLabel}` : 'Password strength';
    }

    function updatePasswordMatch(newPassword, confirmPassword) {
        const matchIcon = document.getElementById('password-match-icon');
        const matchText = document.getElementById('password-match-text');

        if (!matchIcon || !matchText) return;

        if (!confirmPassword) {
            matchIcon.className = 'fas fa-circle';
            matchText.textContent = 'Enter the new password again.';
            matchText.parentElement.className = 'password-match-indicator';
            return;
        }

        if (newPassword === confirmPassword) {
            matchIcon.className = 'fas fa-check';
            matchText.textContent = 'Passwords match';
            matchText.parentElement.className = 'password-match-indicator is-match';
        } else {
            matchIcon.className = 'fas fa-times';
            matchText.textContent = 'Passwords don\'t match';
            matchText.parentElement.className = 'password-match-indicator is-mismatch';
        }
    }

    async function handleAccountLogout() {
        showSignOutConfirmation();
    }

    function showSignOutConfirmation() {
        const previouslyFocusedElement = document.activeElement;
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'signout-modal-overlay';
        modalOverlay.innerHTML = `
            <div class="signout-modal" role="dialog" aria-modal="true" aria-labelledby="signout-dialog-title" aria-describedby="signout-dialog-description">
                <div class="signout-modal-header">
                    <div class="signout-modal-icon">
                        <i class="fas fa-sign-out-alt" aria-hidden="true"></i>
                    </div>
                    <h2 id="signout-dialog-title">Sign Out</h2>
                </div>

                <div class="signout-modal-content">
                    <p id="signout-dialog-description">Are you sure you want to sign out?</p>
                    <div class="signout-modal-details">
                        <div class="signout-detail-item">
                            <i class="fas fa-user" aria-hidden="true"></i>
                            <span>You'll need to sign in again to access your account</span>
                        </div>
                        <div class="signout-detail-item">
                            <i class="fas fa-heart" aria-hidden="true"></i>
                            <span>Your favorites will be saved for next time</span>
                        </div>
                    </div>
                </div>

                <div class="signout-modal-actions">
                    <button type="button" class="btn btn-cancel-signout" id="cancel-signout-btn">
                        <i class="fas fa-times" aria-hidden="true"></i>
                        <span>Stay Signed In</span>
                    </button>
                    <button type="button" class="btn btn-confirm-signout" id="confirm-signout-btn">
                        <i class="fas fa-sign-out-alt" aria-hidden="true"></i>
                        <span>Yes, Sign Out</span>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modalOverlay);
        document.body.classList.add('modal-open');
        const inertSiblings = [...document.body.children]
            .filter((element) => element !== modalOverlay && !element.inert);
        inertSiblings.forEach((element) => { element.inert = true; });

        const cancelBtn = document.getElementById('cancel-signout-btn');
        const confirmBtn = document.getElementById('confirm-signout-btn');
        const dialog = modalOverlay.querySelector('.signout-modal');

        const closeModal = () => {
            document.removeEventListener('keydown', handleDialogKeydown);
            document.body.classList.remove('modal-open');
            inertSiblings.forEach((element) => { element.inert = false; });
            modalOverlay.remove();
            previouslyFocusedElement?.focus?.();
        };

        const handleDialogKeydown = (event) => {
            if (event.key === 'Escape') {
                closeModal();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = [...dialog.querySelectorAll('button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        cancelBtn.addEventListener('click', closeModal);

        confirmBtn.addEventListener('click', async () => {
            confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Signing Out...</span>';
            confirmBtn.disabled = true;
            confirmBtn.setAttribute('aria-busy', 'true');

            try {
                await performSignOut();
                closeModal();
            } catch (error) {
                console.error('Error signing out:', error);
                showNotification('Error signing out. Please try again.', 'error');
                confirmBtn.innerHTML = '<i class="fas fa-sign-out-alt" aria-hidden="true"></i><span>Yes, Sign Out</span>';
                confirmBtn.disabled = false;
                confirmBtn.removeAttribute('aria-busy');
            }
        });

        modalOverlay.addEventListener('click', (event) => {
            if (event.target === modalOverlay) closeModal();
        });
        document.addEventListener('keydown', handleDialogKeydown);
        cancelBtn.focus();
    }

    async function performSignOut() {
        try {
            const response = await fetch(`${window.API_BASE}/api/logout`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!response.ok) throw new Error(`Sign out failed (${response.status})`);
            if (typeof isUserLoggedIn !== 'undefined') {
                isUserLoggedIn = false;
                currentUser = null;
            }

            window.location.href = 'auth.html';
        } catch (error) {
            showNotification('We could not securely sign you out. Check your connection and try again.', 'error');
        }
    }

    async function loadPreferences() {
        try {
            const headers = { 'Content-Type': 'application/json' };

            const response = await fetch(`${window.API_BASE}/api/user/preferences`, {
                method: 'GET',
                headers: headers,
                credentials: 'include'
            });

            const data = await response.json();

            if (data.success && data.preferences) {
                populatePreferencesForm(data.preferences);
            }
        } catch (error) {
            console.error('Error loading preferences:', error);
        }
    }

    function populatePreferencesForm(prefs) {
        const form = ui.preferencesForm;
        if (!form) {
            console.error('[Prefs] Preferences form not found in the DOM.');
            return;
        }

        const categories = Array.isArray(prefs.scent_categories) ? prefs.scent_categories : [];
        form.querySelectorAll('input[name="scent_categories"]').forEach(checkbox => {
            checkbox.checked = categories.includes(checkbox.value);
        });

        if (prefs.intensity) {
            const intensitySelect = form.querySelector('#intensity');
            if (intensitySelect) intensitySelect.value = prefs.intensity;
        }

        if (prefs.season) {
            const seasonSelect = form.querySelector('#season');
            if (seasonSelect) seasonSelect.value = prefs.season;
        }

        if (prefs.occasion) {
            const occasionSelect = form.querySelector('#occasion');
            if (occasionSelect) occasionSelect.value = prefs.occasion;
        }

        if (prefs.budget_range) {
            const budgetSelect = form.querySelector('#budget_range');
            if (budgetSelect) budgetSelect.value = prefs.budget_range;
        }

        const sensitivities = Array.isArray(prefs.sensitivities) ? prefs.sensitivities : [];
        form.querySelectorAll('input[name="sensitivities"]').forEach(checkbox => {
            checkbox.checked = sensitivities.includes(checkbox.value);
        });

        window.FragranceSelects?.syncAll();
    }

    async function handleProfileSubmit(e) {
        e.preventDefault();

        const submitButton = e.target.querySelector('button[type="submit"]');
        const originalText = submitButton.textContent;

        submitButton.textContent = 'Updating...';
        submitButton.disabled = true;
        submitButton.setAttribute('aria-busy', 'true');

        const formData = new FormData(ui.profileForm);
        const profileData = {
            name: formData.get('name'),
            email: formData.get('email')
        };


        const headers = { 'Content-Type': 'application/json' };


        try {
            const response = await fetch(`${window.API_BASE}/api/user/profile`, {
                method: 'POST',
                headers: headers,
                credentials: 'include',
                body: JSON.stringify(profileData),
            });


            if (response.ok) {
                const responseData = await response.json();

                if (responseData.success) {
                    showNotification('Profile updated successfully!', 'success');
                    user.name = profileData.name;
                    user.email = profileData.email;
                    updateHeaderDisplay();
                } else {
                    showNotification(`Failed to update profile: ${responseData.error || 'Unknown error'}`, 'error');
                }
            } else {
                showNotification(`Failed to update profile: ${response.status} ${response.statusText}`, 'error');
            }
        } catch (error) {
            console.error('Error updating profile:', error);
            showNotification('Error updating profile. Please check your connection and try again.', 'error');
        } finally {
            submitButton.textContent = originalText;
            submitButton.disabled = false;
            submitButton.removeAttribute('aria-busy');
        }
    }

    async function handlePreferencesSubmit(e) {
        e.preventDefault();

        const submitButton = e.target.querySelector('button[type="submit"]');
        const originalText = submitButton.textContent;

        submitButton.textContent = 'Saving...';
        submitButton.disabled = true;
        submitButton.setAttribute('aria-busy', 'true');

        const formData = new FormData(ui.preferencesForm);
        const preferences = {
            scent_categories: formData.getAll('scent_categories'),
            intensity: formData.get('intensity'),
            season: formData.get('season') || '',
            occasion: formData.get('occasion') || '',
            budget_range: formData.get('budget_range') || '',
            sensitivities: formData.getAll('sensitivities') || []
        };

        const headers = { 'Content-Type': 'application/json' };


        try {
            const response = await fetch(`${window.API_BASE}/api/user/preferences`, {
                method: 'POST',
                headers: headers,
                credentials: 'include',
                body: JSON.stringify(preferences),
            });


            if (response.ok) {
                const responseData = await response.json();

                if (responseData.success) {
                    showNotification('Fragrance preferences saved successfully!', 'success');
                } else {
                    showNotification(`Failed to save preferences: ${responseData.error || 'Unknown error'}`, 'error');
                }
            } else {
                const errorText = await response.text();

                let errorMessage = `Failed to save preferences: ${response.status} ${response.statusText}`;
                try {
                    const errorData = JSON.parse(errorText);
                    if (errorData.error) {
                        errorMessage = errorData.error;
                    }
                } catch {}
                showNotification(errorMessage, 'error', 6000);
            }
        } catch (error) {
            console.error('Error saving preferences:', error);
            showNotification('Error saving preferences. Please check your connection and try again.', 'error');
        } finally {
            submitButton.textContent = originalText;
            submitButton.disabled = false;
            submitButton.removeAttribute('aria-busy');
        }
    }

    async function loadFavorites() {
        if (!ui.favoritesGrid) return;
        ui.favoritesGrid.replaceChildren();
        ui.favoritesGrid.setAttribute('aria-busy', 'true');

        const emptyState = document.getElementById('favorites-empty-state');

        try {
            const headers = { 'Content-Type': 'application/json' };

            const response = await fetch(`${window.API_BASE}/api/user/favorites`, {
                method: 'GET',
                headers: headers,
                credentials: 'include'
            });
            const data = await response.json();

            if (data.success && data.favorites && data.favorites.length > 0) {
                if (emptyState) emptyState.hidden = true;
                ui.favoritesGrid.hidden = false;

                data.favorites.forEach(fav => {
                    const item = document.createElement('div');
                    item.className = 'favorite-item';

                    const rawPrice = typeof fav.price === 'string' ? fav.price.trim() : fav.price;
                    const numericPrice = Number(rawPrice);
                    const currency = typeof fav.currency === 'string' ? fav.currency.trim().toUpperCase() : '';
                    const hasPrice = rawPrice !== '' && rawPrice !== null && rawPrice !== undefined
                        && Number.isFinite(numericPrice) && numericPrice >= 0 && /^[A-Z]{3}$/.test(currency);
                    const priceMarkup = hasPrice
                        ? `<p class="favorite-price">${escapeHtml(`${numericPrice.toFixed(2)} ${currency}`)}</p>`
                        : '';
                    const imageUrl = safeHttpsUrl(fav.imageUrl) || 'assets/images/emblem-96.webp';
                    const productUrl = safeHttpsUrl(fav.productUrl);
                    const savedName = typeof fav.name === 'string' ? fav.name.trim() : '';
                    const advertiserName = typeof fav.advertiserName === 'string' ? fav.advertiserName.trim() : '';
                    const fragranceName = escapeHtml(savedName || 'Saved fragrance');
                    const brandMarkup = advertiserName
                        ? `<p class="favorite-brand">${escapeHtml(advertiserName)}</p>`
                        : '';
                    const dealAction = productUrl
                        ? `<a href="${productUrl}" target="_blank" rel="nofollow sponsored noopener" class="btn btn-sm">View retailer offer</a>`
                        : '<p class="favorite-offer-note favorite-brand" role="status">No retailer link was saved for this item.</p>';

                    item.innerHTML = `
                        <div class="favorite-card">
                            <div class="favorite-image">
                                <img src="${imageUrl}" alt="${fragranceName}" width="300" height="300" loading="lazy" decoding="async">
                            </div>
                            <div class="favorite-info">
                                <h3 class="favorite-name">${fragranceName}</h3>
                                ${brandMarkup}
                                ${priceMarkup}
                                <div class="favorite-actions">
                                    ${dealAction}
                                    <button class="btn btn-sm btn-secondary favorite-remove-btn" type="button">
                                        <i class="fas fa-heart-broken" aria-hidden="true"></i> Remove
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                    const image = item.querySelector('img');
                    image.addEventListener('error', () => {
                        image.src = 'assets/images/emblem-96.webp';
                    }, { once: true });
                    const removeButton = item.querySelector('.favorite-remove-btn');
                    removeButton.addEventListener('click', () => removeFavorite(String(fav.fragrance_id), removeButton));
                    ui.favoritesGrid.appendChild(item);
                });
            } else {
                if (emptyState) {
                    emptyState.hidden = false;
                    ui.favoritesGrid.hidden = true;
                } else {
                    ui.favoritesGrid.innerHTML = '<p class="no-favorites">You haven\'t added any favorites yet. <a href="/">Browse fragrances</a> to get started!</p>';
                }
            }
        } catch (error) {
            console.error('Error loading favorites:', error);
            if (emptyState) emptyState.hidden = true;
            ui.favoritesGrid.hidden = false;
            ui.favoritesGrid.innerHTML = '<p class="error" role="alert">Error loading favorites. Please try again later.</p>';
        } finally {
            ui.favoritesGrid.removeAttribute('aria-busy');
        }
    }

    async function removeFavorite(fragranceId, buttonElement) {
        if (!confirm('Remove this fragrance from your favorites?')) return;

        try {
            const headers = {};

            const response = await fetch(`${window.API_BASE}/api/user/favorites/${encodeURIComponent(fragranceId)}`, {
                method: 'DELETE',
                headers,
                credentials: 'include'
            });

            if (response.ok) {
                const favoriteCard = buttonElement.closest('.favorite-item');
                if (favoriteCard) {
                    favoriteCard.classList.add('is-removing');
                    setTimeout(() => {
                        favoriteCard.remove();
                        if (ui.favoritesGrid.children.length === 0) {
                            const emptyState = document.getElementById('favorites-empty-state');
                            if (emptyState) {
                                emptyState.hidden = false;
                                ui.favoritesGrid.hidden = true;
                            }
                        }
                    }, 300);
                }
                showNotification('Removed from favorites', 'success');
            } else {
                throw new Error('Failed to remove favorite');
            }
        } catch (error) {
            console.error('Error removing favorite:', error);
            showNotification('Error removing favorite. Please try again.', 'error');
        }
    }

    function formatAlertPrice(value, currency) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return '';
        try {
            return new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency: /^[A-Z]{3}$/.test(currency || '') ? currency : 'USD'
            }).format(amount);
        } catch {
            return `${amount.toFixed(2)} ${currency || 'USD'}`;
        }
    }

    async function loadAlerts() {
        if (!ui.alertsList) return;
        const emptyState = document.getElementById('alerts-empty-state');
        ui.alertsList.setAttribute('aria-busy', 'true');
        ui.alertsList.innerHTML = '<p>Loading your watches…</p>';
        if (emptyState) emptyState.hidden = true;
        try {
            const response = await fetch(`${window.API_BASE}/api/user/alerts`, {
                credentials: 'include',
                headers: { Accept: 'application/json' }
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Unable to load deal watches.');
            const alerts = Array.isArray(data.alerts) ? data.alerts : [];
            ui.alertsList.replaceChildren();
            if (!alerts.length) {
                ui.alertsList.hidden = true;
                if (emptyState) emptyState.hidden = false;
                return;
            }
            ui.alertsList.hidden = false;
            alerts.forEach((alert) => {
                const item = document.createElement('article');
                item.className = 'account-alert-item';
                const alertType = {
                    price_drop: 'Price watch',
                    back_in_stock: 'Stock watch',
                    deal: 'Promotion watch'
                }[alert.alert_type] || 'Deal watch';
                const target = Number(alert.is_active) === 0
                    ? `Triggered${alert.last_triggered_at ? ` on ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(alert.last_triggered_at))}` : ''}`
                    : alert.alert_type === 'price_drop'
                    ? `At or below ${formatAlertPrice(alert.target_price, alert.currency)}`
                    : alert.alert_type === 'back_in_stock' ? 'When listed in stock' : 'When a promotion is found';
                const created = alert.created_at ? new Date(alert.created_at) : null;
                const createdLabel = created && !Number.isNaN(created.getTime())
                    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(created)
                    : '';
                item.innerHTML = `
                    <div class="account-alert-icon" aria-hidden="true"><i class="fas fa-bell"></i></div>
                    <div class="account-alert-copy">
                        <span>${escapeHtml(alertType)}</span>
                        <h3>${escapeHtml(alert.product_name || 'Saved fragrance')}</h3>
                        <p>${escapeHtml(target)}${createdLabel ? ` · Saved ${escapeHtml(createdLabel)}` : ''}</p>
                    </div>
                    <button type="button" class="btn btn-secondary account-alert-remove">Remove</button>`;
                item.querySelector('.account-alert-remove').addEventListener('click', (event) => removeAlert(String(alert.id || ''), event.currentTarget));
                ui.alertsList.appendChild(item);
            });
        } catch (error) {
            ui.alertsList.hidden = false;
            ui.alertsList.innerHTML = `<p class="error" role="alert">${escapeHtml(error.message || 'Unable to load deal watches.')}</p>`;
        } finally {
            ui.alertsList.removeAttribute('aria-busy');
        }
    }

    async function removeAlert(alertId, button) {
        if (!alertId || !confirm('Remove this deal watch?')) return;
        button.disabled = true;
        try {
            const response = await fetch(`${window.API_BASE}/api/user/alerts/${encodeURIComponent(alertId)}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: { Accept: 'application/json' }
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Unable to remove this watch.');
            button.closest('.account-alert-item')?.remove();
            if (!ui.alertsList.querySelector('.account-alert-item')) {
                ui.alertsList.hidden = true;
                const emptyState = document.getElementById('alerts-empty-state');
                if (emptyState) emptyState.hidden = false;
            }
            showNotification('Deal watch removed.', 'success');
        } catch (error) {
            button.disabled = false;
            showNotification(error.message, 'error');
        }
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>'"]/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        })[character]);
    }

    function safeHttpsUrl(value) {
        if (typeof value !== 'string' || !value) return null;
        try {
            const url = new URL(value, window.location.href);
            return url.protocol === 'https:' ? url.href : null;
        } catch {
            return null;
        }
    }

    init();
});
