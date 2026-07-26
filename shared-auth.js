let isUserLoggedIn = false;
let currentUser = null;

function safeProfilePicture(value) {
    if (typeof value !== 'string' || !value) return '';
    try {
        const url = new URL(value, window.location.href);
        return url.protocol === 'https:' || url.origin === window.location.origin ? url.href : '';
    } catch {
        return '';
    }
}

function updateSharedNavUI(user) {
    currentUser = user || null;
    isUserLoggedIn = Boolean(currentUser);
    document.body.classList.toggle('user-logged-in', isUserLoggedIn);

    const profileButton = document.querySelector('.profile-btn');
    let profileImage = profileButton?.querySelector('.profile-img');
    const picture = safeProfilePicture(currentUser?.picture);
    if (profileButton) {
        const name = String(currentUser?.name || '').trim();
        profileButton.setAttribute('aria-label', name ? `Open profile menu for ${name}` : 'Open profile menu');
    }
    if (profileButton && picture) {
        if (!profileImage) {
            profileImage = document.createElement('img');
            profileImage.className = 'profile-img';
            profileButton.appendChild(profileImage);
        }
        profileImage.src = picture;
        profileImage.alt = '';
    } else {
        profileImage?.remove();
    }

    if (isUserLoggedIn && typeof updateDynamicGreeting === 'function') {
        const firstName = String(currentUser.name || '').trim().split(/\s+/)[0];
        if (firstName) updateDynamicGreeting(firstName);
    }

    document.dispatchEvent(new CustomEvent('fragrance:auth-change', {
        detail: { user: currentUser }
    }));
}

async function checkSharedUserStatus() {
    try {
        const response = await fetch(`${window.API_BASE}/api/status`, {
            method: 'GET',
            credentials: 'include',
            headers: { Accept: 'application/json' }
        });
        const data = await response.json().catch(() => ({}));
        updateSharedNavUI(response.ok && data.success ? data.user : null);
    } catch {
        updateSharedNavUI(null);
    }
    return currentUser;
}

async function handleSharedLogout() {
    try {
        await fetch(`${window.API_BASE}/api/logout`, {
            method: 'POST',
            credentials: 'include',
            headers: { Accept: 'application/json' }
        });
    } finally {
        updateSharedNavUI(null);
        window.location.assign('auth.html');
    }
}

function isAuthenticated() {
    return isUserLoggedIn;
}

function getCurrentUser() {
    return currentUser;
}

document.addEventListener('DOMContentLoaded', () => {
    checkSharedUserStatus();
    document.getElementById('menu-logout-btn')?.addEventListener('click', (event) => {
        event.preventDefault();
        handleSharedLogout();
    });
});
