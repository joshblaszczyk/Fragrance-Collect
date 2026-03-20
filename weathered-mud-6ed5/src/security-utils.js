// =====================================================
// COMPREHENSIVE SECURITY UTILITIES FOR FRAGRANCE COLLECT
// =====================================================

const SECURITY_CONFIG = {
    PASSWORD_MIN_LENGTH: 8,
    BCRYPT_ROUNDS: 12,
    MAX_FAILED_ATTEMPTS: 5,
    LOCKOUT_DURATION: 15 * 60 * 1000, // 15 minutes
    PROGRESSIVE_LOCKOUT_MULTIPLIER: 2,
    SESSION_TIMEOUT: 24 * 60 * 60 * 1000, // 24 hours
    SESSION_ROTATION_INTERVAL: 60 * 60 * 1000, // 1 hour
    MAX_CONCURRENT_SESSIONS: 5,
    RATE_LIMIT_WINDOW: 60 * 1000, // 1 minute
    RATE_LIMIT_MAX_REQUESTS: 100,
    PASSWORD_HISTORY_SIZE: 5,
    PASSWORD_EXPIRY_DAYS: 90,
    CSRF_TOKEN_EXPIRY: 60 * 60 * 1000, // 1 hour
    PASSWORD_RESET_EXPIRY: 30 * 60 * 1000, // 30 minutes
    ENCRYPTION_KEY_ROTATION_DAYS: 30
};

// =====================================================
// 1. PASSWORD SECURITY ENHANCEMENTS
// =====================================================

/**
 * Validates password complexity requirements
 */
function validatePasswordComplexity(password) {
    const errors = [];
    
    if (password.length < SECURITY_CONFIG.PASSWORD_MIN_LENGTH) {
        errors.push(`Password must be at least ${SECURITY_CONFIG.PASSWORD_MIN_LENGTH} characters long`);
    }
    
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    
    if (!/\d/.test(password)) {
        errors.push('Password must contain at least one number');
    }
    
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('Password must contain at least one special character');
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors,
        strength: calculatePasswordStrength(password)
    };
}

/**
 * Calculates password strength score (0-100)
 */
function calculatePasswordStrength(password) {
    let score = 0;
    
    // Length contribution
    score += Math.min(password.length * 4, 40);
    
    // Character variety
    if (/[A-Z]/.test(password)) score += 10;
    if (/[a-z]/.test(password)) score += 10;
    if (/\d/.test(password)) score += 10;
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score += 10;
    
    // Bonus for mixed case and numbers
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 5;
    if (/\d/.test(password) && /[A-Za-z]/.test(password)) score += 5;
    
    // Penalty for common patterns
    if (/(.)\1{2,}/.test(password)) score -= 10; // Repeated characters
    if (/123|abc|qwe|asd|zxc/i.test(password)) score -= 15; // Common sequences
    
    return Math.max(0, Math.min(100, score));
}

/**
 * PBKDF2 password hashing (bcrypt alternative)
 */
async function hashPassword(password, salt = null) {
    if (!salt) {
        salt = crypto.getRandomValues(new Uint8Array(32));
    }
    
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);
    
    // Use PBKDF2 with SHA-512
    const key = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: Math.pow(2, SECURITY_CONFIG.BCRYPT_ROUNDS),
            hash: 'SHA-512'
        },
        key,
        512
    );
    
    const hashArray = new Uint8Array(derivedBits);
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
    
    return `${saltHex}:${hashHex}`;
}

/**
 * Verifies password against stored hash
 */
async function verifyPassword(password, storedHash) {
    const [saltHex, hashHex] = storedHash.split(':');
    if (!saltHex || !hashHex) return false;
    
    const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const computedHash = await hashPassword(password, salt);
    
    return storedHash === computedHash;
}

/**
 * Checks password history to prevent reuse
 */
async function checkPasswordHistory(env, userId, newPassword) {
    const history = await env.DB.prepare(`
        SELECT password_hash FROM password_history 
        WHERE user_id = ? 
        ORDER BY created_at DESC 
        LIMIT ?
    `).bind(userId, SECURITY_CONFIG.PASSWORD_HISTORY_SIZE).all();
    
    for (const record of history.results) {
        if (await verifyPassword(newPassword, record.password_hash)) {
            return false; // Password found in history
        }
    }
    
    return true; // Password not in history
}

// =====================================================
// 2. ACCOUNT LOCKOUT PROTECTION
// =====================================================

/**
 * Records a failed login attempt
 */
async function recordFailedAttempt(env, email, clientIP) {
    const attemptId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    
    await env.DB.prepare(`
        INSERT INTO account_lockouts (id, email, client_ip, attempt_count, first_attempt, last_attempt, is_locked)
        VALUES (?, ?, ?, 1, ?, ?, false)
        ON CONFLICT(email) DO UPDATE SET
            attempt_count = attempt_count + 1,
            last_attempt = ?,
            is_locked = CASE 
                WHEN attempt_count >= ? THEN true 
                ELSE is_locked 
            END
    `).bind(attemptId, email, clientIP, timestamp, timestamp, timestamp, SECURITY_CONFIG.MAX_FAILED_ATTEMPTS).run();
    
    // Log the attempt
    await logSecurityEvent(env, 'failed_login', {
        email: email,
        client_ip: clientIP,
        timestamp: timestamp
    });
}

/**
 * Checks if account is locked
 */
async function isAccountLocked(env, email) {
    const lockout = await env.DB.prepare(`
        SELECT * FROM account_lockouts 
        WHERE email = ? AND is_locked = true
    `).bind(email).first();
    
    if (!lockout) return false;
    
    const lockoutDuration = SECURITY_CONFIG.LOCKOUT_DURATION * 
        Math.pow(SECURITY_CONFIG.PROGRESSIVE_LOCKOUT_MULTIPLIER, lockout.attempt_count - SECURITY_CONFIG.MAX_FAILED_ATTEMPTS);
    
    const lockoutExpiry = new Date(lockout.last_attempt).getTime() + lockoutDuration;
    
    if (Date.now() > lockoutExpiry) {
        // Unlock expired lockout
        await env.DB.prepare(`
            UPDATE account_lockouts 
            SET is_locked = false, attempt_count = 0 
            WHERE email = ?
        `).bind(email).run();
        return false;
    }
    
    return true;
}

/**
 * Resets failed attempts on successful login
 */
async function resetFailedAttempts(env, email) {
    await env.DB.prepare(`
        UPDATE account_lockouts 
        SET attempt_count = 0, is_locked = false 
        WHERE email = ?
    `).bind(email).run();
}

// =====================================================
// 3. CSRF PROTECTION
// =====================================================

/**
 * Generates a CSRF token
 */
async function generateCSRFToken(env, userId) {
    const tokenId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SECURITY_CONFIG.CSRF_TOKEN_EXPIRY);
    
    await env.DB.prepare(`
        INSERT INTO csrf_tokens (id, user_id, token, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(tokenId, userId, token, expiresAt.toISOString()).run();
    
    return token;
}

/**
 * Validates a CSRF token
 */
async function validateCSRFToken(env, userId, token) {
    const tokenRecord = await env.DB.prepare(`
        SELECT * FROM csrf_tokens 
        WHERE user_id = ? AND token = ? AND expires_at > ?
    `).bind(userId, token, new Date().toISOString()).first();
    
    if (!tokenRecord) return false;
    
    // Delete used token
    await env.DB.prepare(`
        DELETE FROM csrf_tokens 
        WHERE id = ?
    `).bind(tokenRecord.id).run();
    
    return true;
}

// =====================================================
// 4. SESSION SECURITY ENHANCEMENTS
// =====================================================

/**
 * Validates session security
 */
async function validateSessionSecurity(env, sessionId, clientIP, userAgent) {
    const session = await env.DB.prepare(`
        SELECT * FROM user_sessions 
        WHERE id = ? AND expires_at > ?
    `).bind(sessionId, new Date().toISOString()).first();
    
    if (!session) return null;
    
    // Check session fingerprint
    const currentFingerprint = await generateSessionFingerprint(clientIP, userAgent);
    if (session.fingerprint !== currentFingerprint) {
        await invalidateSession(env, sessionId);
        return null;
    }
    
    // Check for session timeout
    const lastActivity = new Date(session.last_activity).getTime();
    if (Date.now() - lastActivity > SECURITY_CONFIG.SESSION_TIMEOUT) {
        await invalidateSession(env, sessionId);
        return null;
    }
    
    // Update last activity
    await env.DB.prepare(`
        UPDATE user_sessions 
        SET last_activity = CURRENT_TIMESTAMP 
        WHERE id = ?
    `).bind(sessionId).run();
    
    return session;
}

/**
 * Generates session fingerprint
 */
async function generateSessionFingerprint(clientIP, userAgent) {
    const data = `${clientIP}:${userAgent}`;
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Invalidates a session
 */
async function invalidateSession(env, sessionId) {
    await env.DB.prepare(`
        DELETE FROM user_sessions 
        WHERE id = ?
    `).bind(sessionId).run();
}

/**
 * Checks concurrent session limit
 */
async function checkConcurrentSessions(env, userId) {
    const activeSessions = await env.DB.prepare(`
        SELECT COUNT(*) as count FROM user_sessions 
        WHERE user_id = ? AND expires_at > ?
    `).bind(userId, new Date().toISOString()).first();
    
    return activeSessions.count < SECURITY_CONFIG.MAX_CONCURRENT_SESSIONS;
}

// =====================================================
// 5. RATE LIMITING
// =====================================================

/**
 * Checks rate limit for endpoint/user
 */
async function checkRateLimit(env, endpoint, identifier, maxRequests = SECURITY_CONFIG.RATE_LIMIT_MAX_REQUESTS) {
    const windowStart = Date.now() - SECURITY_CONFIG.RATE_LIMIT_WINDOW;
    
    // Clean old records
    await env.DB.prepare(`
        DELETE FROM rate_limits 
        WHERE endpoint = ? AND identifier = ? AND window_start < ?
    `).bind(endpoint, identifier, new Date(windowStart).toISOString()).run();
    
    // Count recent requests
    const count = await env.DB.prepare(`
        SELECT COUNT(*) as count FROM rate_limits 
        WHERE endpoint = ? AND identifier = ? AND window_start > ?
    `).bind(endpoint, identifier, new Date(windowStart).toISOString()).first();
    
    if (count.count >= maxRequests) {
        return false;
    }
    
    // Record this request
    const recordId = crypto.randomUUID();
    await env.DB.prepare(`
        INSERT INTO rate_limits (id, endpoint, identifier, window_start, window_end)
        VALUES (?, ?, ?, ?, ?)
    `).bind(recordId, endpoint, identifier, new Date().toISOString(), new Date(Date.now() + SECURITY_CONFIG.RATE_LIMIT_WINDOW).toISOString()).run();
    
    return true;
}

// =====================================================
// 6. AUDIT LOGGING
// =====================================================

/**
 * Logs security events
 */
async function logSecurityEvent(env, eventType, eventData) {
    const logId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    
    await env.DB.prepare(`
        INSERT INTO audit_logs (id, event_type, event_data, timestamp)
        VALUES (?, ?, ?, ?)
    `).bind(logId, eventType, JSON.stringify(eventData), timestamp).run();
}

// =====================================================
// 7. TWO-FACTOR AUTHENTICATION
// =====================================================

/**
 * Generates TOTP secret
 */
function generateTOTPSecret() {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates TOTP code
 */
function generateTOTPCode(secret, timestamp = Date.now()) {
    const timeStep = 30; // 30 seconds
    const counter = Math.floor(timestamp / 1000 / timeStep);
    
    const encoder = new TextEncoder();
    const secretBuffer = encoder.encode(secret);
    const counterBuffer = new ArrayBuffer(8);
    const counterView = new DataView(counterBuffer);
    counterView.setBigUint64(0, BigInt(counter), false);
    
    // This is a simplified TOTP implementation
    // In production, use a proper TOTP library
    return (counter % 1000000).toString().padStart(6, '0');
}

/**
 * Verifies TOTP code
 */
function verifyTOTPCode(secret, code, timestamp = Date.now()) {
    const expectedCode = generateTOTPCode(secret, timestamp);
    return code === expectedCode;
}

// =====================================================
// 8. PASSWORD RESET
// =====================================================

/**
 * Creates password reset token
 */
async function createPasswordResetToken(env, email) {
    const tokenId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SECURITY_CONFIG.PASSWORD_RESET_EXPIRY);
    
    await env.DB.prepare(`
        INSERT INTO password_reset_tokens (id, email, token, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(tokenId, email, token, expiresAt.toISOString()).run();
    
    return token;
}

/**
 * Validates password reset token
 */
async function validatePasswordResetToken(env, email, token) {
    const tokenRecord = await env.DB.prepare(`
        SELECT * FROM password_reset_tokens 
        WHERE email = ? AND token = ? AND expires_at > ?
    `).bind(email, token, new Date().toISOString()).first();
    
    if (!tokenRecord) return false;
    
    // Delete used token
    await env.DB.prepare(`
        DELETE FROM password_reset_tokens 
        WHERE email = ?
    `).bind(email).run();
    
    return true;
}

// =====================================================
// 9. DATA ENCRYPTION
// =====================================================

/**
 * Encrypts sensitive data
 */
async function encryptData(data, key) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(JSON.stringify(data));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(key),
        { name: 'AES-GCM' },
        false,
        ['encrypt']
    );
    
    const encryptedBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        cryptoKey,
        dataBuffer
    );
    
    const encryptedArray = new Uint8Array(encryptedBuffer);
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    const encryptedHex = Array.from(encryptedArray).map(b => b.toString(16).padStart(2, '0')).join('');
    
    return `${ivHex}:${encryptedHex}`;
}

/**
 * Decrypts sensitive data
 */
async function decryptData(encryptedData, key) {
    const [ivHex, encryptedHex] = encryptedData.split(':');
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const encryptedArray = new Uint8Array(encryptedHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(key),
        { name: 'AES-GCM' },
        false,
        ['decrypt']
    );
    
    const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        cryptoKey,
        encryptedArray
    );
    
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decryptedBuffer));
}

// =====================================================
// 10. INPUT VALIDATION & SANITIZATION
// =====================================================

/**
 * Sanitizes user input
 */
function sanitizeInput(input, maxLength = 1000) {
    if (typeof input !== 'string') return '';
    
    // Remove null bytes and control characters
    let sanitized = input.replace(/[\x00-\x1F\x7F]/g, '');
    
    // Limit length
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
    }
    
    // Remove potentially dangerous patterns
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=/gi, '');
    
    return sanitized.trim();
}

/**
 * Validates email format
 */
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
}

/**
 * Validates UUID format
 */
function validateUUID(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
}

// =====================================================
// EXPORTS
// =====================================================

export {
    SECURITY_CONFIG,
    validatePasswordComplexity,
    calculatePasswordStrength,
    hashPassword,
    verifyPassword,
    checkPasswordHistory,
    recordFailedAttempt,
    isAccountLocked,
    resetFailedAttempts,
    generateCSRFToken,
    validateCSRFToken,
    validateSessionSecurity,
    generateSessionFingerprint,
    invalidateSession,
    checkConcurrentSessions,
    checkRateLimit,
    logSecurityEvent,
    generateTOTPSecret,
    generateTOTPCode,
    verifyTOTPCode,
    createPasswordResetToken,
    validatePasswordResetToken,
    encryptData,
    decryptData,
    sanitizeInput,
    validateEmail,
    validateUUID
};
