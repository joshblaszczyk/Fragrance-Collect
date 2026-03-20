// =====================================================
// ENHANCED SECURITY HEADERS IMPLEMENTATION
// =====================================================

/**
 * Generates a cryptographically secure nonce for CSP
 */
function generateCSPNonce() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Gets enhanced security headers with dynamic CSP
 */
function getEnhancedSecurityHeaders(origin, nonce = null) {
    if (!nonce) {
        nonce = generateCSPNonce();
    }

    const headers = {
        // Content Security Policy with nonce
        'Content-Security-Policy': [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'nonce-" + nonce + "' https://accounts.google.com https://www.gstatic.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: https: http:",
            "connect-src 'self' https://api.cj.com https://api.tiktok.com https://open.er-api.com https://frankfurter.app https://api.cloudflare.com",
            "frame-src 'self' https://accounts.google.com",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            "upgrade-insecure-requests"
        ].join('; '),

        // HTTP Strict Transport Security
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',

        // Permissions Policy
        'Permissions-Policy': [
            'camera=()',
            'microphone=()',
            'geolocation=()',
            'payment=()',
            'usb=()',
            'magnetometer=()',
            'gyroscope=()',
            'accelerometer=()',
            'ambient-light-sensor=()',
            'autoplay=()',
            'encrypted-media=()',
            'picture-in-picture=()',
            'publickey-credentials-get=()',
            'screen-wake-lock=()',
            'sync-xhr=()',
            'web-share=()',
            'xr-spatial-tracking=()'
        ].join(', '),

        // Cross-Origin headers
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin',

        // XSS Protection
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',

        // Referrer Policy
        'Referrer-Policy': 'strict-origin-when-cross-origin',

        // Cache Control for sensitive endpoints
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    };

    // Add CORS headers if origin is provided or use allowed origin
    if (origin) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With, X-CSRF-Token';
        headers['Access-Control-Allow-Credentials'] = 'true';
        headers['Access-Control-Max-Age'] = '86400';
    } else {
        // Fallback CORS headers for when no origin is provided
        headers['Access-Control-Allow-Origin'] = '*';
        headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With, X-CSRF-Token';
        headers['Access-Control-Max-Age'] = '86400';
    }

    return headers;
}

/**
 * Gets context-specific security headers
 */
function getContextSecurityHeaders(context, origin) {
    const baseHeaders = getEnhancedSecurityHeaders(origin);
    
    switch (context) {
        case 'api':
            return {
                ...baseHeaders,
                'Content-Type': 'application/json',
                'X-Content-Type-Options': 'nosniff'
            };
        
        case 'auth':
            return {
                ...baseHeaders,
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': 'Thu, 01 Jan 1970 00:00:00 GMT'
            };
        
        case 'static':
            return {
                ...baseHeaders,
                'Cache-Control': 'public, max-age=31536000, immutable',
                'X-Content-Type-Options': 'nosniff'
            };
        
        default:
            return baseHeaders;
    }
}

/**
 * Adds security headers to a response
 */
function addSecurityHeadersToResponse(response, context = 'api', origin = null) {
    const securityHeaders = getContextSecurityHeaders(context, origin);
    
    for (const [key, value] of Object.entries(securityHeaders)) {
        response.headers.set(key, value);
    }
    
    return response;
}

/**
 * Creates a secure JSON response with security headers
 */
function createSecureJSONResponse(data, status = 200, context = 'api', origin = null) {
    const response = new Response(JSON.stringify(data), {
        status: status,
        headers: {
            'Content-Type': 'application/json'
        }
    });
    
    return addSecurityHeadersToResponse(response, context, origin);
}

/**
 * Validates request security
 */
function validateRequestSecurity(request) {
    const issues = [];
    
    // Check for suspicious headers (only for non-GET requests)
    if (request.method !== 'GET') {
        // Only check for truly suspicious headers, not legitimate Cloudflare headers
        const suspiciousHeaders = ['x-forwarded-proto'];
        for (const header of suspiciousHeaders) {
            if (request.headers.get(header)) {
                issues.push(`Suspicious header detected: ${header}`);
            }
        }
    }
    
    // Check content type for POST requests
    if (request.method === 'POST') {
        const contentType = request.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            issues.push('Invalid content type for POST request');
        }
    }
    
    // Check request size (basic protection)
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 1024 * 1024) { // 1MB limit
        issues.push('Request too large');
    }
    
    return {
        isValid: issues.length === 0,
        issues: issues
    };
}

/**
 * Sanitizes response data for security
 */
function sanitizeResponseData(data) {
    if (typeof data !== 'object' || data === null) {
        return data;
    }
    
    const sanitized = {};
    
    for (const [key, value] of Object.entries(data)) {
        // Remove sensitive fields
        if (['password', 'password_hash', 'salt', 'token', 'secret'].includes(key.toLowerCase())) {
            continue;
        }
        
        // Sanitize nested objects
        if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeResponseData(value);
        } else {
            sanitized[key] = value;
        }
    }
    
    return sanitized;
}

/**
 * Creates error response with security headers
 */
function createSecureErrorResponse(error, status = 500, context = 'api', origin = null) {
    // Sanitize error message for production
    const sanitizedError = {
        error: 'An error occurred',
        status: status
    };
    
    // Include more details in development
    if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        sanitizedError.details = error.message;
        sanitizedError.stack = error.stack;
    }
    
    return createSecureJSONResponse(sanitizedError, status, context, origin);
}

// =====================================================
// EXPORTS
// =====================================================

export {
    generateCSPNonce,
    getEnhancedSecurityHeaders,
    getContextSecurityHeaders,
    addSecurityHeadersToResponse,
    createSecureJSONResponse,
    validateRequestSecurity,
    sanitizeResponseData,
    createSecureErrorResponse
};
