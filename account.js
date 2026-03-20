document.addEventListener('DOMContentLoaded', () => {
    console.log('Account.js: DOM loaded, starting initialization...');
    
    const ui = {
        sidebarLinks: document.querySelectorAll('.account-sidebar nav a'),
        panels: document.querySelectorAll('.account-panel'),
        preferencesForm: document.getElementById('preferences-form'),
        favoritesGrid: document.getElementById('favorites-grid'),
        profileForm: document.getElementById('profile-form'),
    };

    let user = null;

    // Professional notification system
    function showNotification(message, type = 'success', duration = 4000) {
        // Remove any existing notifications
        const existingNotification = document.querySelector('.notification');
        if (existingNotification) {
            existingNotification.remove();
        }

        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        
        // Set icon based on type
        const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
        
        notification.innerHTML = `
            <div class="notification-content">
                <div class="notification-icon">${icon}</div>
                <div class="notification-message">${message}</div>
                <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;

        // Add styles
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white;
            padding: 0;
            border-radius: 8px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
            transform: translateX(100%);
            transition: transform 0.3s ease-in-out;
            max-width: 400px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        // Add content styles
        const content = notification.querySelector('.notification-content');
        content.style.cssText = `
            display: flex;
            align-items: center;
            padding: 16px 20px;
            gap: 12px;
        `;

        // Add icon styles
        const iconEl = notification.querySelector('.notification-icon');
        iconEl.style.cssText = `
            font-size: 20px;
            font-weight: bold;
            flex-shrink: 0;
        `;

        // Add message styles
        const messageEl = notification.querySelector('.notification-message');
        messageEl.style.cssText = `
            flex: 1;
            font-size: 14px;
            line-height: 1.4;
        `;

        // Add close button styles
        const closeBtn = notification.querySelector('.notification-close');
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: white;
            font-size: 18px;
            cursor: pointer;
            padding: 0;
            margin-left: 8px;
            opacity: 0.8;
            transition: opacity 0.2s;
        `;
        closeBtn.addEventListener('mouseenter', () => closeBtn.style.opacity = '1');
        closeBtn.addEventListener('mouseleave', () => closeBtn.style.opacity = '0.8');

        // Add to page
        document.body.appendChild(notification);

        // Animate in
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 10);

        // Auto remove
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.transform = 'translateX(100%)';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.remove();
                    }
                }, 300);
            }
        }, duration);
    }

    async function init() {
        console.log('Account.js: Starting init...');
        // Wait for shared auth to initialize first
        await waitForSharedAuth();
        await checkUserStatus();
        console.log('Account.js: User check complete, user:', user);
        if (!user) {
            console.log('Account.js: No user found, redirecting to auth...');
            window.location.href = 'auth.html';
            return;
        }
        console.log('Account.js: User found, setting up page...');
        setupEventListeners();
        loadUserProfile();
        loadPreferences();
        loadFavorites();
        handleInitialTab();
    }

    async function waitForSharedAuth() {
        console.log('Account.js: Waiting for shared auth...');
        // Wait for shared auth to complete its initialization
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds max wait
        
        // Give shared-auth.js a moment to initialize
        await new Promise(resolve => setTimeout(resolve, 500));
        
        while (attempts < maxAttempts) {
            if (typeof getCurrentUser === 'function') {
                const sharedUser = getCurrentUser();
                console.log('Account.js: getCurrentUser returned:', sharedUser);
                if (sharedUser) {
                    console.log('Shared auth user found:', sharedUser);
                    user = sharedUser;
                    return;
                }
            } else {
                console.log('Account.js: getCurrentUser function not available yet, attempt:', attempts);
            }
            
            // Wait 100ms before next attempt
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        console.log('Shared auth not available after waiting');
    }

    async function checkUserStatus() {
        // If we already have user from shared auth, use it
        if (user) {
            console.log('Using user from shared auth:', user);
            return;
        }

        try {
            // Fallback to direct API call
            const response = await fetch('https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/status', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });
            const data = await response.json();
            if (data.success && data.user) {
                user = data.user;
                console.log('User found via API:', user);
            }
        } catch (error) {
            console.error('Error checking user status:', error);
        }
    }

    function setupEventListeners() {
        ui.sidebarLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = link.getAttribute('href').substring(1);
                switchPanel(targetId);
                window.history.pushState(null, '', `#${targetId}`);
            });
        });

        // Setup listeners for static forms and buttons once.
        if (ui.preferencesForm) {
            ui.preferencesForm.addEventListener('submit', handlePreferencesSubmit);
            console.log('Preferences form submit listener added');
        }
        const logoutBtn = document.getElementById('account-logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', handleAccountLogout);
            console.log('Logout button listener added');
        }
    }

    // This function now ONLY handles listeners for the dynamic profile form content
    function setupProfileFormEventListeners() {
        console.log('Setting up profile form event listeners...');
        
        // The profile form content is dynamic, so we re-attach listeners after it's built.
        if (ui.profileForm) {
            // The form element itself is not replaced, only its content.
            // We can attach the listener directly.
            ui.profileForm.addEventListener('submit', handleProfileSubmit);
            console.log('Profile form submit listener added');
            
            // Add profile picture upload event listener
            const profilePictureInput = document.getElementById('profile-picture');
            if (profilePictureInput) {
                profilePictureInput.addEventListener('change', handleProfilePictureUpload);
                console.log('Profile picture upload listener added');
            }
            
            // Add password change event listeners
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
            
            // Add password validation listeners
            setupPasswordValidation();
        } else {
            console.log('Profile form not found');
        }
    }

    function switchPanel(targetId) {
        ui.panels.forEach(panel => {
            panel.classList.toggle('active', panel.id === targetId);
        });
        ui.sidebarLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === `#${targetId}`);
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
        
        // Populate profile form with user data
        ui.profileForm.innerHTML = `
            <div class="form-group">
                <label for="profile-name">Full Name</label>
                <input type="text" id="profile-name" name="name" value="${user.name || ''}" required>
            </div>
            <div class="form-group">
                <label for="profile-email">Email</label>
                <input type="email" id="profile-email" name="email" value="${user.email || ''}" required readonly>
                <small>Email cannot be changed</small>
            </div>
            <div class="form-group">
                <label for="profile-picture">Profile Picture</label>
                <input type="file" id="profile-picture" name="picture" accept="image/*">
                <div class="current-picture">
                    <img src="${user.picture || 'emblem.png'}" alt="Profile Picture" id="current-picture">
                </div>
            </div>
            <button type="submit" class="btn">Update Profile</button>
            
            <div class="password-change-section">
                <div class="password-change-header" id="password-change-header">
                    <div class="password-change-title">
                        <i class="fas fa-lock"></i>
                        <span>Change Password</span>
                    </div>
                    <div class="password-change-toggle">
                        <i class="fas fa-chevron-down" id="password-toggle-icon"></i>
                    </div>
                </div>
                
                <div class="password-change-content" id="password-change-content" style="display: none;">
                    <div class="password-change-info">
                        <i class="fas fa-info-circle"></i>
                        <span>Update your password to keep your account secure</span>
                    </div>
                    
                    <div class="form-group">
                        <label for="current-password">
                            <i class="fas fa-key"></i>
                            Current Password
                        </label>
                        <input type="password" id="current-password" name="currentPassword" placeholder="Enter your current password">
                    </div>
                    
                    <div class="form-group">
                        <label for="new-password">
                            <i class="fas fa-shield-alt"></i>
                            New Password
                        </label>
                        <input type="password" id="new-password" name="newPassword" placeholder="Enter your new password" minlength="8">
                        <div class="password-strength-indicator">
                            <div class="strength-bar"></div>
                            <span class="strength-text">Password strength</span>
                        </div>
                        <small>Password must be at least 8 characters long</small>
                    </div>
                    
                    <div class="form-group">
                        <label for="confirm-password">
                            <i class="fas fa-check-circle"></i>
                            Confirm New Password
                        </label>
                        <input type="password" id="confirm-password" name="confirmPassword" placeholder="Confirm your new password">
                        <div class="password-match-indicator">
                            <i class="fas fa-times" id="password-match-icon"></i>
                            <span id="password-match-text">Passwords don't match</span>
                        </div>
                    </div>
                    
                    <div class="password-change-actions">
                        <button type="button" id="change-password-btn" class="btn btn-password-change">
                            <i class="fas fa-lock"></i>
                            <span>Change Password</span>
                        </button>
                        <button type="button" id="cancel-password-btn" class="btn btn-cancel">
                            <i class="fas fa-times"></i>
                            <span>Cancel</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Update header display
        updateHeaderDisplay();
        
        // Set up form event listeners after the dynamic profile form is populated
        setupProfileFormEventListeners();
    }

    function updateHeaderDisplay() {
        const headerProfileImg = document.getElementById('header-profile-picture');
        const headerUserName = document.getElementById('header-user-name');
        
        if (headerProfileImg) {
            headerProfileImg.src = user.picture || 'emblem.png';
            headerProfileImg.alt = `${user.name || 'User'}'s Profile Picture`;
        }
        
        if (headerUserName) {
            headerUserName.textContent = `Welcome, ${user.name || 'User'}`;
        }
    }

    async function handleProfilePictureUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            showNotification('Please select a valid image file.', 'error');
            return;
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            showNotification('Image file size must be less than 5MB.', 'error');
            return;
        }

        try {
            // Create a preview
            const reader = new FileReader();
            reader.onload = function(e) {
                const currentPicture = document.getElementById('current-picture');
                const headerProfileImg = document.getElementById('header-profile-picture');
                
                if (currentPicture) {
                    currentPicture.src = e.target.result;
                }
                if (headerProfileImg) {
                    headerProfileImg.src = e.target.result;
                }
            };
            reader.readAsDataURL(file);

            // Upload the file
            const formData = new FormData();
            formData.append('picture', file);

            const response = await fetch('https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/user/profile-picture', {
                method: 'POST',
                credentials: 'include',
                body: formData,
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.picture_url) {
                    user.picture = data.picture_url;
                    showNotification('Profile picture updated successfully!', 'success');
                }
            } else {
                showNotification('Failed to upload profile picture. Please try again.', 'error');
            }
        } catch (error) {
            console.error('Error uploading profile picture:', error);
            showNotification('Error uploading profile picture. Please try again.', 'error');
        }
    }

    async function handlePasswordChange() {
        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        
        // Validate inputs
        if (!currentPassword || !newPassword || !confirmPassword) {
            showNotification('Please fill in all password fields.', 'error');
            return;
        }
        
        if (newPassword.length < 8) {
            showNotification('New password must be at least 8 characters long.', 'error');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            showNotification('New passwords do not match.', 'error');
            return;
        }
        
        const changePasswordBtn = document.getElementById('change-password-btn');
        const originalText = changePasswordBtn.textContent;
        
        // Show loading state
        changePasswordBtn.textContent = 'Changing Password...';
        changePasswordBtn.disabled = true;
        
        const passwordData = {
            currentPassword: currentPassword,
            newPassword: newPassword
        };
        
        console.log('Password change data:', passwordData);
        
        // Get session token from localStorage
        const sessionToken = localStorage.getItem('session_token');
        const headers = { 'Content-Type': 'application/json' };
        
        // Include session token in headers if available
        if (sessionToken) {
            headers['Authorization'] = `Bearer ${sessionToken}`;
            console.log('Including session token in password change request');
        }
        
        console.log('Request headers:', headers);
        
        try {
            const response = await fetch('https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/user/password', {
                method: 'POST',
                headers: headers,
                credentials: 'include',
                body: JSON.stringify(passwordData),
            });
            
            console.log('Password change response status:', response.status);
            
            if (response.ok) {
                const responseData = await response.json();
                console.log('Password change response data:', responseData);
                
                if (responseData.success) {
                    showNotification('Password changed successfully!', 'success');
                    // Clear the password fields and close section
                    clearPasswordFields();
                    togglePasswordSection();
                } else {
                    showNotification(`Failed to change password: ${responseData.error || 'Unknown error'}`, 'error');
                }
            } else {
                const errorText = await response.text();
                console.log('Password change error response:', errorText);
                
                let errorMessage = `Failed to change password: ${response.status} ${response.statusText}`;
                try {
                    const errorData = JSON.parse(errorText);
                    if (errorData.error) {
                        errorMessage = errorData.error;
                    }
                } catch (e) {
                    errorMessage += `\n\nRaw error: ${errorText}`;
                }
                showNotification(errorMessage, 'error', 6000);
            }
        } catch (error) {
            console.error('Error changing password:', error);
            showNotification('Error changing password. Please check your connection and try again.', 'error');
        } finally {
            // Restore button state
            changePasswordBtn.textContent = originalText;
            changePasswordBtn.disabled = false;
        }
    }

    function togglePasswordSection() {
        const content = document.getElementById('password-change-content');
        const icon = document.getElementById('password-toggle-icon');
        
        if (content.style.display === 'none') {
            content.style.display = 'block';
            icon.classList.remove('fa-chevron-down');
            icon.classList.add('fa-chevron-up');
        } else {
            content.style.display = 'none';
            icon.classList.remove('fa-chevron-up');
            icon.classList.add('fa-chevron-down');
            // Clear password fields when closing
            clearPasswordFields();
        }
    }

    function handlePasswordCancel() {
        clearPasswordFields();
        togglePasswordSection();
    }

    function clearPasswordFields() {
        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';
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
        let strengthColor = '';
        
        if (password.length >= 8) strength += 1;
        if (password.match(/[a-z]/)) strength += 1;
        if (password.match(/[A-Z]/)) strength += 1;
        if (password.match(/[0-9]/)) strength += 1;
        if (password.match(/[^a-zA-Z0-9]/)) strength += 1;
        
        switch (strength) {
            case 0:
            case 1:
                strengthLabel = 'Very Weak';
                strengthColor = '#ff4444';
                break;
            case 2:
                strengthLabel = 'Weak';
                strengthColor = '#ff8800';
                break;
            case 3:
                strengthLabel = 'Fair';
                strengthColor = '#ffbb00';
                break;
            case 4:
                strengthLabel = 'Good';
                strengthColor = '#88cc00';
                break;
            case 5:
                strengthLabel = 'Strong';
                strengthColor = '#44aa44';
                break;
        }
        
        strengthBar.style.width = `${(strength / 5) * 100}%`;
        strengthBar.style.backgroundColor = strengthColor;
        strengthText.textContent = password ? `Password strength: ${strengthLabel}` : 'Password strength';
    }

    function updatePasswordMatch(newPassword, confirmPassword) {
        const matchIcon = document.getElementById('password-match-icon');
        const matchText = document.getElementById('password-match-text');
        
        if (!matchIcon || !matchText) return;
        
        if (!confirmPassword) {
            matchIcon.className = 'fas fa-times';
            matchText.textContent = 'Passwords don\'t match';
            matchText.style.color = '#ff4444';
            return;
        }
        
        if (newPassword === confirmPassword) {
            matchIcon.className = 'fas fa-check';
            matchText.textContent = 'Passwords match';
            matchText.style.color = '#44aa44';
        } else {
            matchIcon.className = 'fas fa-times';
            matchText.textContent = 'Passwords don\'t match';
            matchText.style.color = '#ff4444';
        }
    }

    async function handleAccountLogout() {
        showSignOutConfirmation();
    }

    function showSignOutConfirmation() {
        // Create modal overlay
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'signout-modal-overlay';
        modalOverlay.innerHTML = `
            <div class="signout-modal">
                <div class="signout-modal-header">
                    <div class="signout-modal-icon">
                        <i class="fas fa-sign-out-alt"></i>
                    </div>
                    <h3>Sign Out</h3>
                </div>
                
                <div class="signout-modal-content">
                    <p>Are you sure you want to sign out?</p>
                    <div class="signout-modal-details">
                        <div class="signout-detail-item">
                            <i class="fas fa-user"></i>
                            <span>You'll need to sign in again to access your account</span>
                        </div>
                        <div class="signout-detail-item">
                            <i class="fas fa-heart"></i>
                            <span>Your favorites will be saved for next time</span>
                        </div>
                    </div>
                </div>
                
                <div class="signout-modal-actions">
                    <button class="btn btn-cancel-signout" id="cancel-signout-btn">
                        <i class="fas fa-times"></i>
                        <span>Stay Signed In</span>
                    </button>
                    <button class="btn btn-confirm-signout" id="confirm-signout-btn">
                        <i class="fas fa-sign-out-alt"></i>
                        <span>Yes, Sign Out</span>
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modalOverlay);
        
        // Add event listeners
        const cancelBtn = document.getElementById('cancel-signout-btn');
        const confirmBtn = document.getElementById('confirm-signout-btn');
        const overlay = modalOverlay;
        
        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(modalOverlay);
        });
        
        confirmBtn.addEventListener('click', async () => {
            // Show loading state
            confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Signing Out...</span>';
            confirmBtn.disabled = true;
            
            try {
                await performSignOut();
                document.body.removeChild(modalOverlay);
            } catch (error) {
                console.error('Error signing out:', error);
                showNotification('Error signing out. Please try again.', 'error');
                // Restore button state
                confirmBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i><span>Yes, Sign Out</span>';
                confirmBtn.disabled = false;
            }
        });
        
        // Close modal when clicking overlay
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(modalOverlay);
            }
        });
        
        // Close modal with Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                document.body.removeChild(modalOverlay);
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }

    async function performSignOut() {
        try {
            // Use the same logout endpoint as shared-auth.js
            await fetch('https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/logout', {
                method: 'POST',
                credentials: 'include'
            });
        } finally {
            // Clear local storage and update auth state
            localStorage.removeItem('session_token');
            
            // Update global auth state if available
            if (typeof isUserLoggedIn !== 'undefined') {
                isUserLoggedIn = false;
                currentUser = null;
                sessionToken = null;
            }
            
            // Always redirect, even if server call fails
            window.location.href = 'auth.html';
        }
    }

    async function loadPreferences() {
        try {
            console.log('[Prefs] Attempting to load user preferences...');
            // Get session token from localStorage
            const sessionToken = localStorage.getItem('session_token');
            const headers = { 'Content-Type': 'application/json' };
            
            // Include session token in headers if available
            if (sessionToken) {
                headers['Authorization'] = `Bearer ${sessionToken}`;
            }

            const response = await fetch('https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/user/preferences', {
                method: 'GET',
                headers: headers,
                credentials: 'include'
            });

            const data = await response.json();
            console.log('[Prefs] API response received:', data);
            
            if (data.success && data.preferences) {
                console.log('[Prefs] Preferences found, calling populate function.');
                // Populate the form with existing data
                populatePreferencesForm(data.preferences);
            } else {
                console.log('[Prefs] No preferences found in API response or request was not successful.');
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
        
        console.log('[Prefs] Populating preferences form with data:', prefs);
        
        // Scent categories
        const categories = Array.isArray(prefs.scent_categories) ? prefs.scent_categories : [];
        form.querySelectorAll('input[name="scent_categories"]').forEach(checkbox => {
            checkbox.checked = categories.includes(checkbox.value);
        });

        // Intensity
        if (prefs.intensity) {
            const intensitySelect = form.querySelector('#intensity');
            if (intensitySelect) intensitySelect.value = prefs.intensity;
        }
        
        // Season
        if (prefs.season) {
            const seasonSelect = form.querySelector('#season');
            if (seasonSelect) seasonSelect.value = prefs.season;
        }
        
        // Occasion
        if (prefs.occasion) {
            const occasionSelect = form.querySelector('#occasion');
            if (occasionSelect) occasionSelect.value = prefs.occasion;
        }
        
        // Budget range
        if (prefs.budget_range) {
            const budgetSelect = form.querySelector('#budget_range');
            if (budgetSelect) budgetSelect.value = prefs.budget_range;
        }
        
        // Sensitivities
        const sensitivities = Array.isArray(prefs.sensitivities) ? prefs.sensitivities : [];
        form.querySelectorAll('input[name="sensitivities"]').forEach(checkbox => {
            checkbox.checked = sensitivities.includes(checkbox.value);
        });
        
        console.log('Preferences form populated successfully');
    }

    async function handleProfileSubmit(e) {
        e.preventDefault();
        console.log('Profile submit triggered');
        
        const submitButton = e.target.querySelector('button[type="submit"]');
        const originalText = submitButton.textContent;
        
        // Show loading state
        submitButton.textContent = 'Updating...';
        submitButton.disabled = true;
        
        const formData = new FormData(ui.profileForm);
        const profileData = {
            name: formData.get('name'),
            email: formData.get('email')
        };

        console.log('Profile data to submit:', profileData);
        console.log('Profile data JSON:', JSON.stringify(profileData));

        // Get session token from localStorage
        const sessionToken = localStorage.getItem('session_token');
        const headers = { 'Content-Type': 'application/json' };
        
        // Include session token in headers if available
        if (sessionToken) {
            headers['Authorization'] = `Bearer ${sessionToken}`;
            console.log('Including session token in profile request');
        }
        
        console.log('Request headers:', headers);

        try {
            const response = await fetch('https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/user/profile', {
                method: 'POST',
                headers: headers,
                credentials: 'include',
                body: JSON.stringify(profileData),
            });
            
            console.log('Profile update response status:', response.status);
            
            if (response.ok) {
                const responseData = await response.json();
                console.log('Profile update response data:', responseData);
                
                if (responseData.success) {
                    showNotification('Profile updated successfully!', 'success');
                    // Update the user object
                    user.name = profileData.name;
                    user.email = profileData.email;
                    // Update header display
                    updateHeaderDisplay();
                } else {
                    showNotification(`Failed to update profile: ${responseData.error || 'Unknown error'}`, 'error');
                }
            } else {
                const errorText = await response.text();
                console.log('Profile update error response:', errorText);
                showNotification(`Failed to update profile: ${response.status} ${response.statusText}`, 'error');
            }
        } catch (error) {
            console.error('Error updating profile:', error);
            showNotification('Error updating profile. Please check your connection and try again.', 'error');
        } finally {
            // Restore button state
            submitButton.textContent = originalText;
            submitButton.disabled = false;
        }
    }

    async function handlePreferencesSubmit(e) {
        e.preventDefault();
        console.log('Preferences submit triggered');
        
        const submitButton = e.target.querySelector('button[type="submit"]');
        const originalText = submitButton.textContent;
        
        // Show loading state
        submitButton.textContent = 'Saving...';
        submitButton.disabled = true;
        
        const formData = new FormData(ui.preferencesForm);
        const preferences = {
            scent_categories: formData.getAll('scent_categories'),
            intensity: formData.get('intensity'),
            season: formData.get('season') || '',
            occasion: formData.get('occasion') || '',
            budget_range: formData.get('budget_range') || '',
            sensitivities: formData.getAll('sensitivities') || []
        };

        // Validate and clean the data
        if (!preferences.scent_categories || preferences.scent_categories.length === 0) {
            preferences.scent_categories = [];
        }
        if (!preferences.intensity) {
            preferences.intensity = '';
        }
        if (!preferences.sensitivities || preferences.sensitivities.length === 0) {
            preferences.sensitivities = [];
        }

        console.log('Preferences data to submit:', preferences);
        console.log('Preferences data JSON:', JSON.stringify(preferences));
        console.log('FormData entries:');
        for (let [key, value] of formData.entries()) {
            console.log(`${key}: ${value}`);
        }

        // Get session token from localStorage
        const sessionToken = localStorage.getItem('session_token');
        const headers = { 'Content-Type': 'application/json' };
        
        // Include session token in headers if available
        if (sessionToken) {
            headers['Authorization'] = `Bearer ${sessionToken}`;
            console.log('Including session token in preferences request');
        }
        
        console.log('Request headers:', headers);

        try {
            const response = await fetch('https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/user/preferences', {
                method: 'POST',
                headers: headers,
                credentials: 'include',
                body: JSON.stringify(preferences),
            });
            
            console.log('Preferences save response status:', response.status);
            
            if (response.ok) {
                const responseData = await response.json();
                console.log('Preferences save response data:', responseData);
                
                if (responseData.success) {
                    showNotification('Fragrance preferences saved successfully!', 'success');
                } else {
                    showNotification(`Failed to save preferences: ${responseData.error || 'Unknown error'}`, 'error');
                }
            } else {
                const errorText = await response.text();
                console.log('Preferences save error response:', errorText);
                console.log('Response status:', response.status);
                console.log('Response statusText:', response.statusText);
                
                let errorMessage = `Failed to save preferences: ${response.status} ${response.statusText}`;
                try {
                    const errorData = JSON.parse(errorText);
                    if (errorData.error) {
                        errorMessage += `\n\nDetails: ${errorData.error}`;
                    }
                } catch (e) {
                    errorMessage += `\n\nRaw error: ${errorText}`;
                }
                showNotification(errorMessage, 'error', 6000);
            }
        } catch (error) {
            console.error('Error saving preferences:', error);
            showNotification('Error saving preferences. Please check your connection and try again.', 'error');
        } finally {
            // Restore button state
            submitButton.textContent = originalText;
            submitButton.disabled = false;
        }
    }

    async function loadFavorites() {
        if (!ui.favoritesGrid) return;
        ui.favoritesGrid.innerHTML = ''; // Clear existing
        
        const emptyState = document.getElementById('favorites-empty-state');
        
        try {
            // Get session token from localStorage
            const sessionToken = localStorage.getItem('session_token');
            const headers = { 'Content-Type': 'application/json' };
            
            // Include session token in headers if available
            if (sessionToken) {
                headers['Authorization'] = `Bearer ${sessionToken}`;
                console.log('Including session token in favorites load request');
            }

            const response = await fetch('https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/user/favorites', {
                method: 'GET',
                headers: headers,
                credentials: 'include'
            });
            const data = await response.json();
            
            if (data.success && data.favorites && data.favorites.length > 0) {
                if (emptyState) emptyState.style.display = 'none';
                
                data.favorites.forEach(fav => {
                    // Use correct field names from database schema
                    const item = document.createElement('div');
                    item.className = 'favorite-item';
                    
                    // Create a proper product card similar to main page
                    const price = fav.price ? `$${fav.price} ${fav.currency || 'USD'}` : 'Price unavailable';
                    const imageUrl = fav.imageUrl || 'emblem.png';
                    const productUrl = fav.productUrl || '#';
                    const advertiserName = fav.advertiserName || 'Unknown Brand';
                    
                    item.innerHTML = `
                        <div class="favorite-card">
                            <div class="favorite-image">
                                <img src="${imageUrl}" alt="${fav.name}" onerror="this.src='emblem.png'">
                            </div>
                            <div class="favorite-info">
                                <h4 class="favorite-name">${fav.name}</h4>
                                <p class="favorite-brand">${advertiserName}</p>
                                <p class="favorite-price">${price}</p>
                                <div class="favorite-actions">
                                    <a href="${productUrl}" target="_blank" rel="nofollow sponsored noopener" class="btn btn-sm">Shop Now</a>
                                    <button class="btn btn-sm btn-secondary" onclick="removeFavorite('${fav.fragrance_id}', this)">
                                        <i class="fas fa-heart-broken"></i> Remove
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                    ui.favoritesGrid.appendChild(item);
                });
            } else {
                // Show empty state
                if (emptyState) {
                    emptyState.style.display = 'block';
                    ui.favoritesGrid.style.display = 'none';
                } else {
                    ui.favoritesGrid.innerHTML = '<p class="no-favorites">You haven\'t added any favorites yet. <a href="main.html">Browse fragrances</a> to get started!</p>';
                }
            }
        } catch (error) {
            console.error('Error loading favorites:', error);
            if (emptyState) emptyState.style.display = 'none';
            ui.favoritesGrid.innerHTML = '<p class="error">Error loading favorites. Please try again later.</p>';
        }
    }

    // Function to remove a favorite
    async function removeFavorite(fragranceId, buttonElement) {
        if (!confirm('Remove this fragrance from your favorites?')) return;
        
        try {
            const sessionToken = localStorage.getItem('session_token');
            const headers = {};
            if (sessionToken) {
                headers['Authorization'] = `Bearer ${sessionToken}`;
            }

            const response = await fetch(`https://weathered-mud-6ed5.joshuablaszczyk.workers.dev/api/user/favorites/${fragranceId}`, {
                method: 'DELETE',
                headers,
                credentials: 'include'
            });

            if (response.ok) {
                // Remove the item from the UI
                const favoriteCard = buttonElement.closest('.favorite-item');
                if (favoriteCard) {
                    favoriteCard.style.transition = 'opacity 0.3s ease';
                    favoriteCard.style.opacity = '0';
                    setTimeout(() => {
                        favoriteCard.remove();
                        // Check if grid is now empty
                        if (ui.favoritesGrid.children.length === 0) {
                            const emptyState = document.getElementById('favorites-empty-state');
                            if (emptyState) {
                                emptyState.style.display = 'block';
                                ui.favoritesGrid.style.display = 'none';
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

    // Make removeFavorite available globally for onclick handlers
    window.removeFavorite = removeFavorite;

    // Add navigation functionality between account sections
    function initAccountNavigation() {
        const navLinks = document.querySelectorAll('.account-sidebar nav a');
        const panels = document.querySelectorAll('.account-panel');

        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                
                // Remove active class from all links and panels
                navLinks.forEach(l => l.classList.remove('active'));
                panels.forEach(p => p.classList.remove('active'));
                
                // Add active class to clicked link
                link.classList.add('active');
                
                // Show corresponding panel
                const targetId = link.getAttribute('href').substring(1); // Remove #
                const targetPanel = document.getElementById(targetId);
                if (targetPanel) {
                    targetPanel.classList.add('active');
                    
                    // Load favorites if navigating to favorites section
                    if (targetId === 'favorites') {
                        console.log('Loading favorites section...');
                        loadFavorites();
                    }
                }
            });
        });

        // Handle URL hash navigation (for direct links and browser back/forward)
        function handleHashChange() {
            const hash = window.location.hash.substring(1); // Remove #
            if (hash) {
                // Find and activate the corresponding nav link
                const targetLink = document.querySelector(`.account-sidebar nav a[href="#${hash}"]`);
                if (targetLink) {
                    // Remove active from all
                    navLinks.forEach(l => l.classList.remove('active'));
                    panels.forEach(p => p.classList.remove('active'));
                    
                    // Activate target
                    targetLink.classList.add('active');
                    const targetPanel = document.getElementById(hash);
                    if (targetPanel) {
                        targetPanel.classList.add('active');
                        
                        // Load favorites if navigating to favorites section
                        if (hash === 'favorites') {
                            console.log('Loading favorites section via hash change...');
                            loadFavorites();
                        }
                    }
                }
            }
        }

        // Listen for hash changes
        window.addEventListener('hashchange', handleHashChange);
        
        // Handle initial load if there's a hash
        handleHashChange();
    }

    // Initialize account navigation
    initAccountNavigation();

    init();
});
