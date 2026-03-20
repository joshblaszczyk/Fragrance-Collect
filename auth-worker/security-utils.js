// =====================================================
// COMPREHENSIVE SECURITY UTILITIES FOR FRAGRANCE COLLECT
// =====================================================

/**
 * SECURITY CONFIGURATION
 */
const SECURITY_CONFIG = {
    // Password settings
    PASSWORD_MIN_LENGTH: 8,
    PASSWORD_REQUIRE_UPPERCASE: true,
    PASSWORD_REQUIRE_LOWERCASE: true,
    PASSWORD_REQUIRE_NUMBERS: true,
    PASSWORD_REQUIRE_SPECIAL: true,
    PASSWORD_HISTORY_COUNT: 5,
    PASSWORD_EXPIRY_DAYS: 90,
    BCRYPT_ROUNDS: 12,

    // Account lockout settings
    MAX_FAILED_ATTEMPTS: 5,
    LOCKOUT_DURATION_MINUTES: 15,
    LOCKOUT_MULTIPLIER: 2, // Each additional failure multiplies lockout time

    // Session settings
    SESSION_TIMEOUT_MINUTES: 30,
    MAX_CONCURRENT_SESSIONS: 3,
    SESSION_ROTATION_ENABLED: true,

    // CSRF settings
    CSRF_TOKEN_EXPIRY_MINUTES: 60,
    CSRF_TOKEN_LENGTH: 32,

    // Rate limiting settings
    RATE_LIMIT_REQUESTS_PER_MINUTE: 60,
    RATE_LIMIT_WINDOW_MINUTES: 1,
    RATE_LIMIT_BLOCK_DURATION_MINUTES: 15,

    // Two-factor settings
    TOTP_ALGORITHM: 'SHA1',
    TOTP_DIGITS: 6,
    TOTP_PERIOD: 30,
    BACKUP_CODE_COUNT: 10,
    BACKUP_CODE_LENGTH: 8,

    // Password reset settings
    PASSWORD_RESET_TOKEN_EXPIRY_MINUTES: 60,
    PASSWORD_RESET_TOKEN_LENGTH: 32,

    // Encryption settings
    ENCRYPTION_ALGORITHM: 'AES-256-GCM',
    KEY_ROTATION_DAYS: 90
};

// =====================================================
// 1. PASSWORD SECURITY FUNCTIONS
// =====================================================

/**
 * Validates password complexity requirements
 * @param {string} password - The password to validate
 * @returns {Object} Validation result with isValid and errors
 */
function validatePasswordComplexity(password) {
    const errors = [];
    
    if (password.length < SECURITY_CONFIG.PASSWORD_MIN_LENGTH) {
        errors.push(`Password must be at least ${SECURITY_CONFIG.PASSWORD_MIN_LENGTH} characters long`);
    }
    
    if (SECURITY_CONFIG.PASSWORD_REQUIRE_UPPERCASE && !/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    
    if (SECURITY_CONFIG.PASSWORD_REQUIRE_LOWERCASE && !/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    
    if (SECURITY_CONFIG.PASSWORD_REQUIRE_NUMBERS && !/\d/.test(password)) {
        errors.push('Password must contain at least one number');
    }
    
    if (SECURITY_CONFIG.PASSWORD_REQUIRE_SPECIAL && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('Password must contain at least one special character');
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

/**
 * Generates a secure salt for password hashing
 * @returns {string} Base64 encoded salt
 */
function generateSalt() {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return btoa(String.fromCharCode(...salt));
}

/**
 * Hashes a password using bcrypt-like approach with salt
 * @param {string} password - The password to hash
 * @param {string} salt - The salt to use (optional, will generate if not provided)
 * @returns {Promise<Object>} Object containing hash and salt
 */
async function hashPassword(password, salt = null) {
    if (!salt) {
        salt = generateSalt();
    }
    
    // Use PBKDF2 as a bcrypt alternative (Cloudflare Workers don't support bcrypt)
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    const saltBuffer = encoder.encode(salt);
    
    const key = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    
    const hashBuffer = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: saltBuffer,
            iterations: Math.pow(2, SECURITY_CONFIG.BCRYPT_ROUNDS),
            hash: 'SHA-512'
        },
        key,
        512
    );
    
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return {
        hash: hash,
        salt: salt
    };
}

/**
 * Verifies a password against a stored hash
 * @param {string} password - The password to verify
 * @param {string} storedHash - The stored hash
 * @param {string} salt - The salt used for the stored hash
 * @returns {Promise<boolean>} True if password matches
 */
async function verifyPassword(password, storedHash, salt) {
    const { hash } = await hashPassword(password, salt);
    
    // Constant-time comparison to prevent timing attacks
    if (hash.length !== storedHash.length) {
        return false;
    }
    
    let diff = 0;
    for (let i = 0; i < hash.length; i++) {
        diff |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
    }
    
    return diff === 0;
}

/**
 * Checks if password has been used recently
 * @param {Object} env - Cloudflare environment
 * @param {string} userId - User ID
 * @param {string} password - Password to check
 * @returns {Promise<boolean>} True if password was recently used
 */
async function isPasswordRecentlyUsed(env, userId, password) {
    const passwordHistory = await env.DB.prepare(
        `SELECT password_hash, salt FROM password_history 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT ?`
    ).bind(userId, SECURITY_CONFIG.PASSWORD_HISTORY_COUNT).all();
    
    for (const record of passwordHistory.results) {
        if (await verifyPassword(password, record.password_hash, record.salt)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Stores password hash in history
 * @param {Object} env - Cloudflare environment
 * @param {string} userId - User ID
 * @param {string} passwordHash - Password hash
 * @param {string} salt - Salt used
 */
async function storePasswordInHistory(env, userId, passwordHash, salt) {
    const historyId = crypto.randomUUID();
    
    await env.DB.prepare(
        `INSERT INTO password_history (id, user_id, password_hash, salt) 
         VALUES (?, ?, ?, ?)`
    ).bind(historyId, userId, passwordHash, salt).run();
    
    // Clean up old password history entries
    await env.DB.prepare(
        `DELETE FROM password_history 
         WHERE user_id = ? 
         AND id NOT IN (
             SELECT id FROM password_history 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT ?
         )`
    ).bind(userId, userId, SECURITY_CONFIG.PASSWORD_HISTORY_COUNT).run();
}

// =====================================================
// 2. ACCOUNT LOCKOUT FUNCTIONS
// =====================================================

/**
 * Records a failed login attempt
 * @param {Object} env - Cloudflare environment
 * @param {string} email - User email
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - User agent
 * @returns {Promise<Object>} Lockout information
 */
async function recordFailedLoginAttempt(env, email, ipAddress, userAgent) {
    const now = new Date();
    
    // Check for existing failed attempts
    const existingAttempts = await env.DB.prepare(
        `SELECT * FROM failed_login_attempts 
         WHERE email = ? AND ip_address = ? 
         AND (locked_until IS NULL OR locked_until < ?)`
    ).bind(email, ipAddress, now.toISOString()).first();
    
    if (existingAttempts) {
        // Update existing record
        const newAttemptCount = existingAttempts.attempt_count + 1;
        const lockoutDuration = SECURITY_CONFIG.LOCKOUT_DURATION_MINUTES * 
                               Math.pow(SECURITY_CONFIG.LOCKOUT_MULTIPLIER, newAttemptCount - 1);
        const lockedUntil = new Date(now.getTime() + lockoutDuration * 60 * 1000);
        
        await env.DB.prepare(
            `UPDATE failed_login_attempts 
             SET attempt_count = ?, last_attempt_at = ?, locked_until = ? 
             WHERE id = ?`
        ).bind(newAttemptCount, now.toISOString(), lockedUntil.toISOString(), existingAttempts.id).run();
        
        return {
            isLocked: newAttemptCount >= SECURITY_CONFIG.MAX_FAILED_ATTEMPTS,
            attemptsRemaining: Math.max(0, SECURITY_CONFIG.MAX_FAILED_ATTEMPTS - newAttemptCount),
            lockedUntil: newAttemptCount >= SECURITY_CONFIG.MAX_FAILED_ATTEMPTS ? lockedUntil : null
        };
    } else {
        // Create new record
        const attemptId = crypto.randomUUID();
        const lockedUntil = new Date(now.getTime() + SECURITY_CONFIG.LOCKOUT_DURATION_MINUTES * 60 * 1000);
        
        await env.DB.prepare(
            `INSERT INTO failed_login_attempts 
             (id, email, ip_address, user_agent, attempt_count, first_attempt_at, last_attempt_at, locked_until) 
             VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
        ).bind(attemptId, email, ipAddress, userAgent, now.toISOString(), now.toISOString(), lockedUntil.toISOString()).run();
        
        return {
            isLocked: false,
            attemptsRemaining: SECURITY_CONFIG.MAX_FAILED_ATTEMPTS - 1,
            lockedUntil: null
        };
    }
}

/**
 * Checks if an account is locked
 * @param {Object} env - Cloudflare environment
 * @param {string} email - User email
 * @param {string} ipAddress - IP address
 * @returns {Promise<Object>} Lockout status
 */
async function checkAccountLockout(env, email, ipAddress) {
    const now = new Date();
    
    const lockoutRecord = await env.DB.prepare(
        `SELECT * FROM failed_login_attempts 
         WHERE email = ? AND ip_address = ? AND locked_until > ?`
    ).bind(email, ipAddress, now.toISOString()).first();
    
    if (lockoutRecord) {
        return {
            isLocked: true,
            lockedUntil: lockoutRecord.locked_until,
            attemptsRemaining: 0
        };
    }
    
    return {
        isLocked: false,
        lockedUntil: null,
        attemptsRemaining: SECURITY_CONFIG.MAX_FAILED_ATTEMPTS
    };
}

/**
 * Clears failed login attempts for successful login
 * @param {Object} env - Cloudflare environment
 * @param {string} email - User email
 * @param {string} ipAddress - IP address
 */
async function clearFailedLoginAttempts(env, email, ipAddress) {
    await env.DB.prepare(
        `DELETE FROM failed_login_attempts 
         WHERE email = ? AND ip_address = ?`
    ).bind(email, ipAddress).run();
}

// =====================================================
// 3. CSRF PROTECTION FUNCTIONS
// =====================================================

/**
 * Generates a CSRF token
 * @param {string} userId - User ID
 * @returns {string} CSRF token
 */
function generateCSRFToken(userId) {
    const tokenData = `${userId}:${Date.now()}:${crypto.randomUUID()}`;
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(tokenData);
    
    // Use SHA-256 for token generation
    return crypto.subtle.digest('SHA-256', dataBuffer).then(hashBuffer => {
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, SECURITY_CONFIG.CSRF_TOKEN_LENGTH);
    });
}

/**
 * Stores a CSRF token in the database
 * @param {Object} env - Cloudflare environment
 * @param {string} userId - User ID
 * @param {string} token - CSRF token
 * @returns {Promise<string>} Token ID
 */
async function storeCSRFToken(env, userId, token) {
    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SECURITY_CONFIG.CSRF_TOKEN_EXPIRY_MINUTES * 60 * 1000);
    
    await env.DB.prepare(
        `INSERT INTO csrf_tokens (id, user_id, token, expires_at) 
         VALUES (?, ?, ?, ?)`
    ).bind(tokenId, userId, token, expiresAt.toISOString()).run();
    
    return tokenId;
}

/**
 * Validates a CSRF token
 * @param {Object} env - Cloudflare environment
 * @param {string} userId - User ID
 * @param {string} token - CSRF token
 * @returns {Promise<boolean>} True if token is valid
 */
async function validateCSRFToken(env, userId, token) {
    const now = new Date();
    
    const tokenRecord = await env.DB.prepare(
        `SELECT * FROM csrf_tokens 
         WHERE user_id = ? AND token = ? AND expires_at > ? AND used = FALSE`
    ).bind(userId, token, now.toISOString()).first();
    
    return !!tokenRecord;
}

/**
 * Marks a CSRF token as used
 * @param {Object} env - Cloudflare environment
 * @param {string} userId - User ID
 * @param {string} token - CSRF token
 */
async function markCSRFTokenAsUsed(env, userId, token) {
    await env.DB.prepare(
        `UPDATE csrf_tokens 
         SET used = TRUE 
         WHERE user_id = ? AND token = ?`
    ).bind(userId, token).run();
}

// =====================================================
// 4. SESSION SECURITY FUNCTIONS
// =====================================================

/**
 * Creates a secure session with enhanced security
 * @param {Object} env - Cloudflare environment
 * @param {string} userId - User ID
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - User agent
 * @returns {Promise<Object>} Session information
 */
async function createSecureSession(env, userId, ipAddress, userAgent) {
    const sessionId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SECURITY_CONFIG.SESSION_TIMEOUT_MINUTES * 60 * 1000);
    const fingerprint = await generateSessionFingerprint(ipAddress, userAgent);
    
    // Check concurrent sessions limit
    const activeSessions = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM user_sessions 
         WHERE user_id = ? AND expires_at > ?`
    ).bind(userId, new Date().toISOString()).first();
    
    if (activeSessions.count >= SECURITY_CONFIG.MAX_CONCURRENT_SESSIONS) {
        // Remove oldest session
        await env.DB.prepare(
            `DELETE FROM user_sessions 
             WHERE user_id = ? AND id = (
                 SELECT id FROM user_sessions 
                 WHERE user_id = ? 
                 ORDER BY created_at ASC 
                 LIMIT 1
             )`
        ).bind(userId, userId).run();
    }
    
    // Create new session
    await env.DB.prepare(
        `INSERT INTO user_sessions 
         (id, user_id, token, expires_at, client_ip, user_agent, fingerprint, last_activity) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(sessionId, userId, token, expiresAt.toISOString(), ipAddress, userAgent, fingerprint, new Date().toISOString()).run();
    
    // Log session creation
    await logSessionEvent(env, sessionId, 'login', ipAddress, userAgent);
    
    return {
        sessionId: sessionId,
        token: token,
        expiresAt: expiresAt
    };
}

/**
 * Validates session security
 * @param {Object} env - Cloudflare environment
 * @param {string} sessionId - Session ID
 * @param {string} ipAddress - Current IP address
 * @param {string} userAgent - Current user agent
 * @returns {Promise<boolean>} True if session is secure
 */
async function validateSessionSecurity(env, sessionId, ipAddress, userAgent) {
    const session = await env.DB.prepare(
        `SELECT * FROM user_sessions WHERE id = ?`
    ).bind(sessionId).first();
    
    if (!session) {
        return false;
    }
    
    // Check if session has expired
    if (new Date(session.expires_at) < new Date()) {
        await logSessionEvent(env, sessionId, 'expired', ipAddress, userAgent);
        return false;
    }
    
    // Check fingerprint
    const currentFingerprint = await generateSessionFingerprint(ipAddress, userAgent);
    if (session.fingerprint !== currentFingerprint) {
        await logSessionEvent(env, sessionId, 'suspicious', ipAddress, userAgent, {
            reason: 'fingerprint_mismatch',
            expected: session.fingerprint,
            actual: currentFingerprint
        });
        return false;
    }
    
    // Update last activity
    await env.DB.prepare(
        `UPDATE user_sessions 
         SET last_activity = ? 
         WHERE id = ?`
    ).bind(new Date().toISOString(), sessionId).run();
    
    return true;
}

/**
 * Logs session events
 * @param {Object} env - Cloudflare environment
 * @param {string} sessionId - Session ID
 * @param {string} eventType - Event type
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - User agent
 * @param {Object} details - Additional details
 */
async function logSessionEvent(env, sessionId, eventType, ipAddress, userAgent, details = {}) {
    const eventId = crypto.randomUUID();
    
    await env.DB.prepare(
        `INSERT INTO session_events 
         (id, session_id, event_type, ip_address, user_agent, details) 
         VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(eventId, sessionId, eventType, ipAddress, userAgent, JSON.stringify(details)).run();
}

// =====================================================
// 5. RATE LIMITING FUNCTIONS
// =====================================================

/**
 * Checks rate limiting for an endpoint
 * @param {Object} env - Cloudflare environment
 * @param {string} identifier - Rate limit identifier (IP or user:endpoint)
 * @param {string} endpoint - API endpoint
 * @returns {Promise<Object>} Rate limit status
 */
async function checkRateLimit(env, identifier, endpoint) {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + SECURITY_CONFIG.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000);
    
    // Clean up expired rate limit records
    await env.DB.prepare(
        `DELETE FROM rate_limits 
         WHERE window_end < ?`
    ).bind(now.toISOString()).run();
    
    // Check for existing rate limit record
    const rateLimitRecord = await env.DB.prepare(
        `SELECT * FROM rate_limits 
         WHERE identifier = ? AND endpoint = ? AND window_end > ?`
    ).bind(identifier, endpoint, now.toISOString()).first();
    
    if (rateLimitRecord) {
        // Check if blocked
        if (rateLimitRecord.blocked_until && new Date(rateLimitRecord.blocked_until) > now) {
            return {
                allowed: false,
                blocked: true,
                blockedUntil: rateLimitRecord.blocked_until,
                remainingRequests: 0
            };
        }
        
        // Check request count
        if (rateLimitRecord.request_count >= SECURITY_CONFIG.RATE_LIMIT_REQUESTS_PER_MINUTE) {
            const blockedUntil = new Date(now.getTime() + SECURITY_CONFIG.RATE_LIMIT_BLOCK_DURATION_MINUTES * 60 * 1000);
            
            await env.DB.prepare(
                `UPDATE rate_limits 
                 SET blocked_until = ? 
                 WHERE id = ?`
            ).bind(blockedUntil.toISOString(), rateLimitRecord.id).run();
            
            return {
                allowed: false,
                blocked: true,
                blockedUntil: blockedUntil.toISOString(),
                remainingRequests: 0
            };
        }
        
        // Increment request count
        await env.DB.prepare(
            `UPDATE rate_limits 
             SET request_count = request_count + 1 
             WHERE id = ?`
        ).bind(rateLimitRecord.id).run();
        
        return {
            allowed: true,
            blocked: false,
            remainingRequests: SECURITY_CONFIG.RATE_LIMIT_REQUESTS_PER_MINUTE - rateLimitRecord.request_count - 1
        };
    } else {
        // Create new rate limit record
        const rateLimitId = crypto.randomUUID();
        
        await env.DB.prepare(
            `INSERT INTO rate_limits 
             (id, identifier, endpoint, request_count, window_start, window_end) 
             VALUES (?, ?, ?, 1, ?, ?)`
        ).bind(rateLimitId, identifier, endpoint, now.toISOString(), windowEnd.toISOString()).run();
        
        return {
            allowed: true,
            blocked: false,
            remainingRequests: SECURITY_CONFIG.RATE_LIMIT_REQUESTS_PER_MINUTE - 1
        };
    }
}

// =====================================================
// 6. AUDIT LOGGING FUNCTIONS
// =====================================================

/**
 * Logs an audit event
 * @param {Object} env - Cloudflare environment
 * @param {string} userId - User ID (null for anonymous)
 * @param {string} action - Action performed
 * @param {string} resourceType - Type of resource affected
 * @param {string} resourceId - ID of resource affected
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - User agent
 * @param {Object} details - Additional details
 * @param {boolean} success - Whether action was successful
 */
async function logAuditEvent(env, userId, action, resourceType, resourceId, ipAddress, userAgent, details = {}, success = true) {
    const auditId = crypto.randomUUID();
    
    await env.DB.prepare(
        `INSERT INTO audit_logs 
         (id, user_id, action, resource_type, resource_id, ip_address, user_agent, details, success) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(auditId, userId, action, resourceType, resourceId, ipAddress, userAgent, JSON.stringify(details), success).run();
}

// =====================================================
// 7. TWO-FACTOR AUTHENTICATION FUNCTIONS
// =====================================================

/**
 * Generates TOTP secret key
 * @returns {string} Base32 encoded secret
 */
function generateTOTPSecret() {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let result = '';
    
    for (let i = 0; i < bytes.length; i++) {
        result += base32Chars[bytes[i] % 32];
    }
    
    return result;
}

/**
 * Generates backup codes
 * @returns {Array<string>} Array of backup codes
 */
function generateBackupCodes() {
    const codes = [];
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    
    for (let i = 0; i < SECURITY_CONFIG.BACKUP_CODE_COUNT; i++) {
        let code = '';
        for (let j = 0; j < SECURITY_CONFIG.BACKUP_CODE_LENGTH; j++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        codes.push(code);
    }
    
    return codes;
}

/**
 * Validates TOTP code
 * @param {string} secret - TOTP secret
 * @param {string} code - TOTP code to validate
 * @param {number} window - Time window tolerance
 * @returns {boolean} True if code is valid
 */
function validateTOTPCode(secret, code, window = 1) {
    const now = Math.floor(Date.now() / 1000);
    const period = SECURITY_CONFIG.TOTP_PERIOD;
    
    for (let i = -window; i <= window; i++) {
        const time = now + (i * period);
        const expectedCode = generateTOTPCode(secret, time);
        if (expectedCode === code) {
            return true;
        }
    }
    
    return false;
}

/**
 * Generates TOTP code for a specific time
 * @param {string} secret - TOTP secret
 * @param {number} time - Unix timestamp
 * @returns {string} TOTP code
 */
function generateTOTPCode(secret, time) {
    // This is a simplified TOTP implementation
    // In production, use a proper TOTP library
    const period = SECURITY_CONFIG.TOTP_PERIOD;
    const counter = Math.floor(time / period);
    
    // Convert secret to bytes
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let binary = '';
    for (let i = 0; i < secret.length; i++) {
        const char = secret[i];
        const index = base32Chars.indexOf(char);
        if (index === -1) continue;
        binary += index.toString(2).padStart(5, '0');
    }
    
    // Convert counter to bytes
    const counterBytes = new ArrayBuffer(8);
    const view = new DataView(counterBytes);
    view.setBigUint64(0, BigInt(counter), false);
    
    // Generate HMAC (simplified)
    const hmac = crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(binary),
        { name: 'HMAC', hash: 'SHA1' },
        false,
        ['sign']
    ).then(key => {
        return crypto.subtle.sign('HMAC', key, counterBytes);
    });
    
    // Extract code from HMAC
    return hmac.then(signature => {
        const offset = signature[signature.length - 1] & 0xf;
        const code = ((signature[offset] & 0x7f) << 24) |
                    ((signature[offset + 1] & 0xff) << 16) |
                    ((signature[offset + 2] & 0xff) << 8) |
                    (signature[offset + 3] & 0xff);
        
        return (code % Math.pow(10, SECURITY_CONFIG.TOTP_DIGITS)).toString().padStart(SECURITY_CONFIG.TOTP_DIGITS, '0');
    });
}

// =====================================================
// 8. PASSWORD RESET FUNCTIONS
// =====================================================

/**
 * Generates password reset token
 * @param {string} userId - User ID
 * @returns {string} Reset token
 */
function generatePasswordResetToken(userId) {
    const tokenData = `${userId}:${Date.now()}:${crypto.randomUUID()}`;
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(tokenData);
    
    return crypto.subtle.digest('SHA-256', dataBuffer).then(hashBuffer => {
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, SECURITY_CONFIG.PASSWORD_RESET_TOKEN_LENGTH);
    });
}

/**
 * Stores password reset token
 * @param {Object} env - Cloudflare environment
 * @param {string} userId - User ID
 * @param {string} token - Reset token
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - User agent
 * @returns {Promise<string>} Token ID
 */
async function storePasswordResetToken(env, userId, token, ipAddress, userAgent) {
    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SECURITY_CONFIG.PASSWORD_RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);
    
    await env.DB.prepare(
        `INSERT INTO password_reset_tokens 
         (id, user_id, token, expires_at, ip_address, user_agent) 
         VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(tokenId, userId, token, expiresAt.toISOString(), ipAddress, userAgent).run();
    
    return tokenId;
}

/**
 * Validates password reset token
 * @param {Object} env - Cloudflare environment
 * @param {string} token - Reset token
 * @returns {Promise<Object|null>} Token record or null if invalid
 */
async function validatePasswordResetToken(env, token) {
    const now = new Date();
    
    const tokenRecord = await env.DB.prepare(
        `SELECT * FROM password_reset_tokens 
         WHERE token = ? AND expires_at > ? AND used = FALSE`
    ).bind(token, now.toISOString()).first();
    
    return tokenRecord || null;
}

/**
 * Marks password reset token as used
 * @param {Object} env - Cloudflare environment
 * @param {string} token - Reset token
 */
async function markPasswordResetTokenAsUsed(env, token) {
    await env.DB.prepare(
        `UPDATE password_reset_tokens 
         SET used = TRUE 
         WHERE token = ?`
    ).bind(token).run();
}

// =====================================================
// 9. ENCRYPTION FUNCTIONS
// =====================================================

/**
 * Generates encryption key
 * @returns {Promise<Object>} Key data
 */
async function generateEncryptionKey() {
    const key = await crypto.subtle.generateKey(
        {
            name: SECURITY_CONFIG.ENCRYPTION_ALGORITHM,
            length: 256
        },
        true,
        ['encrypt', 'decrypt']
    );
    
    const exportedKey = await crypto.subtle.exportKey('raw', key);
    const keyData = btoa(String.fromCharCode(...new Uint8Array(exportedKey)));
    
    return {
        key: key,
        keyData: keyData
    };
}

/**
 * Encrypts data
 * @param {string} data - Data to encrypt
 * @param {CryptoKey} key - Encryption key
 * @returns {Promise<string>} Encrypted data (base64)
 */
async function encryptData(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedData = new TextEncoder().encode(data);
    
    const encryptedBuffer = await crypto.subtle.encrypt(
        {
            name: SECURITY_CONFIG.ENCRYPTION_ALGORITHM,
            iv: iv
        },
        key,
        encodedData
    );
    
    const encryptedArray = new Uint8Array(encryptedBuffer);
    const combined = new Uint8Array(iv.length + encryptedArray.length);
    combined.set(iv);
    combined.set(encryptedArray, iv.length);
    
    return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts data
 * @param {string} encryptedData - Encrypted data (base64)
 * @param {CryptoKey} key - Encryption key
 * @returns {Promise<string>} Decrypted data
 */
async function decryptData(encryptedData, key) {
    const combined = new Uint8Array(atob(encryptedData).split('').map(char => char.charCodeAt(0)));
    const iv = combined.slice(0, 12);
    const encryptedArray = combined.slice(12);
    
    const decryptedBuffer = await crypto.subtle.decrypt(
        {
            name: SECURITY_CONFIG.ENCRYPTION_ALGORITHM,
            iv: iv
        },
        key,
        encryptedArray
    );
    
    return new TextDecoder().decode(decryptedBuffer);
}

// =====================================================
// 10. UTILITY FUNCTIONS
// =====================================================

/**
 * Gets client IP address from request
 * @param {Request} request - Request object
 * @returns {string} IP address
 */
function getClientIP(request) {
    return request.headers.get('CF-Connecting-IP') || 
           request.headers.get('X-Forwarded-For') || 
           request.headers.get('X-Real-IP') || 
           'unknown';
}

/**
 * Gets user agent from request
 * @param {Request} request - Request object
 * @returns {string} User agent
 */
function getUserAgent(request) {
    return request.headers.get('User-Agent') || 'unknown';
}

/**
 * Sanitizes input data
 * @param {string} input - Input to sanitize
 * @returns {string} Sanitized input
 */
function sanitizeInput(input) {
    if (typeof input !== 'string') {
        return '';
    }
    
    // Remove potentially dangerous characters
    return input.replace(/[<>\"'&]/g, '');
}

/**
 * Validates email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if email is valid
 */
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Generates random string
 * @param {number} length - Length of string
 * @returns {string} Random string
 */
function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Export all security functions
export {
    // Password security
    validatePasswordComplexity,
    generateSalt,
    hashPassword,
    verifyPassword,
    isPasswordRecentlyUsed,
    storePasswordInHistory,
    
    // Account lockout
    recordFailedLoginAttempt,
    checkAccountLockout,
    clearFailedLoginAttempts,
    
    // CSRF protection
    generateCSRFToken,
    storeCSRFToken,
    validateCSRFToken,
    markCSRFTokenAsUsed,
    
    // Session security
    createSecureSession,
    validateSessionSecurity,
    logSessionEvent,
    
    // Rate limiting
    checkRateLimit,
    
    // Audit logging
    logAuditEvent,
    
    // Two-factor authentication
    generateTOTPSecret,
    generateBackupCodes,
    validateTOTPCode,
    generateTOTPCode,
    
    // Password reset
    generatePasswordResetToken,
    storePasswordResetToken,
    validatePasswordResetToken,
    markPasswordResetTokenAsUsed,
    
    // Encryption
    generateEncryptionKey,
    encryptData,
    decryptData,
    
    // Utilities
    getClientIP,
    getUserAgent,
    sanitizeInput,
    validateEmail,
    generateRandomString,
    
    // Configuration
    SECURITY_CONFIG
};
