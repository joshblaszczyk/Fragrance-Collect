// =====================================================
// ENHANCED SECURITY HEADERS IMPLEMENTATION
// =====================================================

/**
 * Generates a nonce for CSP
 * @returns {string} Random nonce
 */
function generateCSPNonce() {
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    return btoa(String.fromCharCode(...nonce));
}

/**
 * Enhanced security headers with comprehensive protection
 * @param {string} origin - Request origin for CORS
 * @param {string} nonce - CSP nonce (optional)
 * @returns {HeadersInit} Security headers
 */
function getEnhancedSecurityHeaders(origin, nonce = null) {
    // Generate nonce if not provided
    if (!nonce) {
        nonce = generateCSPNonce();
    }

    // Comprehensive Content Security Policy
    const csp = [
        // Default source restrictions
        "default-src 'self'",
        
        // Script sources with nonce
        `script-src 'self' 'nonce-${nonce}' https://accounts.google.com https://www.googletagmanager.com`,
        
        // Style sources
        "style-src 'self' 'unsafe-inline' https://accounts.google.com https://fonts.googleapis.com https://cdnjs.cloudflare.com",
        
        // Font sources
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        
        // Image sources
        "img-src 'self' data: https: *.googleusercontent.com https://www.google-analytics.com",
        
        // Connect sources for APIs
        "connect-src 'self' https://www.googleapis.com https://weathered-mud-6ed5.joshuablaszczyk.workers.dev",
        
        // Frame sources
        "frame-src 'self' https://accounts.google.com",
        
        // Object sources (blocked for security)
        "object-src 'none'",
        
        // Base URI restrictions
        "base-uri 'self'",
        
        // Form action restrictions
        "form-action 'self'",
        
        // Upgrade insecure requests
        "upgrade-insecure-requests",
        
        // Block mixed content
        "block-all-mixed-content",
        
        // Require trusted types
        "require-trusted-types-for 'script'",
        
        // Trusted types policy
        "trusted-types 'default'"
    ].join('; ');

    // Enhanced security headers
    const headers = {
        // Content Security Policy
        'Content-Security-Policy': csp,
        
        // HTTP Strict Transport Security (HSTS)
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
        
        // Content Type Options
        'X-Content-Type-Options': 'nosniff',
        
        // Frame Options
        'X-Frame-Options': 'DENY',
        
        // XSS Protection
        'X-XSS-Protection': '1; mode=block',
        
        // Referrer Policy
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        
        // Permissions Policy (formerly Feature Policy)
        'Permissions-Policy': [
            'geolocation=()',
            'microphone=()',
            'camera=()',
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
        
        // Clear Site Data (for logout)
        'Clear-Site-Data': '"cache", "cookies", "storage"',
        
        // CORS headers
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin, Accept-Encoding',
        
        // Security headers for API responses
        'X-Permitted-Cross-Domain-Policies': 'none',
        'X-Download-Options': 'noopen',
        'X-DNS-Prefetch-Control': 'off',
        
        // Cache control for sensitive data
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    };

    // Determine allowed origin value
    let allowedOrigin = null;
    if (!origin || origin === 'null' || origin === 'undefined') {
        // Support file:// and other null-origin contexts
        allowedOrigin = 'null';
    } else if (isOriginAllowed(origin)) {
        allowedOrigin = origin;
    }

    if (allowedOrigin) {
        headers['Access-Control-Allow-Origin'] = allowedOrigin;
    } else if (origin) {
        console.log('Origin not allowed for CORS:', origin);
    }

    return headers;
}

/**
 * Gets security headers for different contexts
 * @param {string} context - Context type ('api', 'auth', 'static', 'logout')
 * @param {string} origin - Request origin
 * @returns {HeadersInit} Context-specific security headers
 */
function getContextSecurityHeaders(context, origin) {
    const baseHeaders = getEnhancedSecurityHeaders(origin);
    
    switch (context) {
        case 'api':
            // API endpoints - strict CSP, no inline scripts
            return {
                ...baseHeaders,
                'Content-Security-Policy': baseHeaders['Content-Security-Policy'].replace(
                    "'unsafe-inline'",
                    "'strict-dynamic'"
                ),
                'X-API-Version': '1.0',
                'X-Request-ID': crypto.randomUUID()
            };
            
        case 'auth':
            // Authentication endpoints - allow Google OAuth
            return {
                ...baseHeaders,
                'Content-Security-Policy': baseHeaders['Content-Security-Policy'] + '; frame-ancestors https://accounts.google.com',
                'X-Auth-Context': 'login'
            };
            
        case 'static':
            // Static assets - relaxed CSP for development
            return {
                ...baseHeaders,
                'Cache-Control': 'public, max-age=31536000, immutable',
                'X-Content-Type-Options': 'nosniff'
            };
            
        case 'logout':
            // Logout endpoints - clear all data
            return {
                ...baseHeaders,
                'Clear-Site-Data': '"cache", "cookies", "storage", "executionContexts"',
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            };
            
        default:
            return baseHeaders;
    }
}

/**
 * Validates if origin is allowed
 * @param {string} origin - Origin to validate
 * @returns {boolean} True if origin is allowed
 */
function isOriginAllowed(origin) {
    const allowedOrigins = [
        'https://fragrancecollect.com',
        'https://www.fragrancecollect.com',
        'https://joshuablaszczyk.github.io',
        'http://localhost:3000',
        'http://localhost:8000',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:8000'
    ];
    
    return allowedOrigins.includes(origin);
}

/**
 * Adds security headers to response
 * @param {Response} response - Response to modify
 * @param {string} context - Security context
 * @param {string} origin - Request origin
 * @returns {Response} Response with security headers
 */
function addSecurityHeadersToResponse(response, context = 'api', origin = null) {
    const securityHeaders = getContextSecurityHeaders(context, origin);
    
    // Create new headers object
    const newHeaders = new Headers(response.headers);
    
    // Add security headers
    Object.entries(securityHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
    });
    
    // Return new response with security headers
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
    });
}

/**
 * Creates a secure JSON response
 * @param {Object} data - Response data
 * @param {number} status - HTTP status code
 * @param {string} context - Security context
 * @param {string} origin - Request origin
 * @returns {Response} Secure JSON response
 */
function createSecureJSONResponse(data, status = 200, context = 'api', origin = null) {
    const securityHeaders = getContextSecurityHeaders(context, origin);
    
    return new Response(JSON.stringify(data), {
        status: status,
        headers: {
            'Content-Type': 'application/json',
            ...securityHeaders
        }
    });
}

/**
 * Creates a secure error response
 * @param {string} message - Error message
 * @param {number} status - HTTP status code
 * @param {string} context - Security context
 * @param {string} origin - Request origin
 * @returns {Response} Secure error response
 */
function createSecureErrorResponse(message, status = 400, context = 'api', origin = null) {
    // Sanitize error message for production
    const sanitizedMessage = process.env.NODE_ENV === 'production' 
        ? 'An error occurred' 
        : message;
    
    return createSecureJSONResponse(
        { error: sanitizedMessage },
        status,
        context,
        origin
    );
}

/**
 * Validates request security
 * @param {Request} request - Request to validate
 * @returns {Object} Validation result
 */
function validateRequestSecurity(request) {
    const issues = [];
    
    // Check for suspicious headers
    const suspiciousHeaders = [
        'X-Forwarded-Host',
        'X-Original-URL',
        'X-Rewrite-URL'
    ];
    
    suspiciousHeaders.forEach(header => {
        if (request.headers.get(header)) {
            issues.push(`Suspicious header detected: ${header}`);
        }
    });
    
    // Check for suspicious user agents
    const userAgent = request.headers.get('User-Agent') || '';
    const suspiciousUserAgents = [
        'sqlmap',
        'nikto',
        'nmap',
        'wget',
        'curl',
        'python-requests'
    ];
    
    suspiciousUserAgents.forEach(agent => {
        if (userAgent.toLowerCase().includes(agent)) {
            issues.push(`Suspicious user agent detected: ${agent}`);
        }
    });
    
    // Check for suspicious content types
    const contentType = request.headers.get('Content-Type') || '';
    if (contentType.includes('multipart/form-data') && !contentType.includes('boundary')) {
        issues.push('Invalid multipart content type');
    }
    
    return {
        isValid: issues.length === 0,
        issues: issues
    };
}

/**
 * Logs security events
 * @param {string} event - Security event
 * @param {Object} details - Event details
 * @param {Request} request - Request object
 */
function logSecurityEvent(event, details, request) {
    const securityLog = {
        timestamp: new Date().toISOString(),
        event: event,
        details: details,
        request: {
            method: request.method,
            url: request.url,
            ip: request.headers.get('CF-Connecting-IP') || 'unknown',
            userAgent: request.headers.get('User-Agent') || 'unknown',
            origin: request.headers.get('Origin') || 'unknown'
        }
    };
    
    console.log('SECURITY EVENT:', JSON.stringify(securityLog, null, 2));
}

// Export security header functions
export {
    generateCSPNonce,
    getEnhancedSecurityHeaders,
    getContextSecurityHeaders,
    isOriginAllowed,
    addSecurityHeadersToResponse,
    createSecureJSONResponse,
    createSecureErrorResponse,
    validateRequestSecurity,
    logSecurityEvent
};
