// Contact Page JavaScript Functionality
document.addEventListener('DOMContentLoaded', function() {
    const contactForm = document.getElementById('contactForm');
    const formInputs = document.querySelectorAll('.form-input, .form-select, .form-textarea');
    const successModal = document.getElementById('successModal');
    const closeButton = document.querySelector('.close-button');
    const subjectSelect = document.getElementById('subject');

    // Function to style the subject placeholder
    function styleSubjectPlaceholder() {
        if (subjectSelect.value === "") {
            subjectSelect.classList.add('select-placeholder');
        } else {
            subjectSelect.classList.remove('select-placeholder');
        }
    }

    // Initial check for placeholder
    if (subjectSelect) {
        styleSubjectPlaceholder();
        subjectSelect.addEventListener('change', styleSubjectPlaceholder);
    }

    // Modal event listeners
    if (closeButton) {
        closeButton.addEventListener('click', function() {
            successModal.style.display = 'none';
        });
    }

    window.addEventListener('click', function(event) {
        if (event.target == successModal) {
            successModal.style.display = 'none';
        }
    });
    
    // Form validation and submission
    if (contactForm) {
        console.log('🔧 Contact form initialized and ready for submissions');

        contactForm.addEventListener('submit', async function(e) {
            console.log('📝 Contact form submission started');
            e.preventDefault();

            // Get form data
            const formData = new FormData(contactForm);
            const name = formData.get('name');
            const email = formData.get('email');
            const subject = formData.get('subject');
            const message = formData.get('message');

            console.log('📋 Form data collected:', {
                name: name ? '✓ Provided' : '✗ Missing',
                email: email ? '✓ Provided' : '✗ Missing',
                subject: subject ? `✓ "${subject}"` : '✗ Missing',
                messageLength: message ? `${message.length} characters` : '✗ Missing'
            });
            
            // Basic validation
            console.log('🔍 Starting form validation...');

            if (!name || !email || !subject || !message) {
                console.log('❌ Validation failed: Missing required fields');
                console.log('   Missing fields:', {
                    name: !name,
                    email: !email,
                    subject: !subject,
                    message: !message
                });
                showMessage('Please fill in all required fields.', 'error');
                return;
            }

            if (!isValidEmail(email)) {
                console.log('❌ Validation failed: Invalid email format');
                console.log('   Email provided:', email);
                showMessage('Please enter a valid email address.', 'error');
                return;
            }

            console.log('✅ Basic validation passed');
            console.log('📤 Starting form submission process...');
            
            // Simulate form submission
            const submitBtn = contactForm.querySelector('.submit-btn');
            const originalText = submitBtn.innerHTML;
            
            // Show loading state
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
            submitBtn.disabled = true;

            console.log('⏳ Form submission in progress...');
            console.log('   Button state: Disabled and showing loading spinner');

            try {
                // Send form data to Cloudflare Worker API
                const apiBase = window.API_BASE || '';
                console.log('📤 Sending to API endpoint:', `${apiBase}/api/contact`);
                const response = await fetch(`${apiBase}/api/contact`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name,
                        email,
                        subject,
                        message
                    })
                });

                console.log('📡 API Response status:', response.status);

                const result = await response.json();
                console.log('📋 API Response data:', result);

                if (response.ok && result.success) {
                    console.log('✅ Email sent successfully via Resend API');

                    // Show success modal instead of inline message
                    successModal.style.display = 'block';

                    // Reset form
                    contactForm.reset();
                    console.log('🔄 Form reset completed');

                    // Log successful submission
                    console.log('📊 EMAIL SENT SUCCESSFULLY:', {
                        timestamp: new Date().toISOString(),
                        emailId: result.emailId,
                        formData: {
                            name,
                            email,
                            subject,
                            messageLength: message.length,
                            messagePreview: message.substring(0, 50) + (message.length > 50 ? '...' : '')
                        },
                        verification: result.verification,
                        technical: {
                            userAgent: navigator.userAgent,
                            url: window.location.href,
                            apiResponseTime: 'successful'
                        }
                    });

                    console.log('🎉 Contact form email sent successfully!');

                } else {
                    // Handle API errors
                    console.error('❌ API Error:', result);

                    let errorMessage = result.message || result.error || 'Failed to send message. Please try again.';

                    if (result.type === 'rate_limit') {
                        errorMessage = `⏰ ${errorMessage} (${result.retryAfter})`;
                        console.log('🚫 Rate limit exceeded');
                    } else if (result.type === 'validation') {
                        if (result.field) {
                            errorMessage = `❌ ${result.field}: ${errorMessage}`;
                        } else if (result.missingFields) {
                            errorMessage = `❌ Missing fields: ${result.missingFields.join(', ')}`;
                        }
                        console.log('📝 Validation error:', result);
                    } else if (result.type === 'email_failure') {
                        errorMessage = `📧 ${errorMessage}`;
                        console.log('📧 Email sending failed:', result.reason);
                    }

                    showMessage(errorMessage, 'error');
                    console.log('❌ Form submission failed');
                }

            } catch (error) {
                console.error('🚨 Network/API Error:', error);
                showMessage('Network error. Please check your connection and try again.', 'error');
                console.log('❌ Form submission failed due to network error');
            } finally {
                // Always reset button state
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
                console.log('🔘 Button reset to original state:', originalText);
            }
        });

        console.log('🎯 Contact form event listener attached and ready');
    } else {
        console.log('❌ Contact form not found on page');
    }
    
    // Email validation function with logging
    function isValidEmail(email) {
        console.log(`🔍 Validating email: "${email}"`);

        if (!email) {
            console.log('❌ Email validation failed: Empty email');
            return false;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const isValid = emailRegex.test(email);

        console.log(`📧 Email validation result: ${isValid ? '✅ Valid' : '❌ Invalid'}`);

        if (!isValid) {
            console.log('   Email format check failed - missing @ or proper domain');
        }

        return isValid;
    }
    
    // Message display function with logging
    function showMessage(message, type) {
        console.log(`💬 Showing ${type} message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);

        // Remove existing messages
        const existingMessage = document.querySelector('.message');
        if (existingMessage) {
            console.log('🗑️ Removing existing message');
            existingMessage.remove();
        }

        // Create message element
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        messageDiv.textContent = message;

        // Insert before form
        const formTitle = document.querySelector('.form-title');
        if (formTitle) {
            formTitle.parentNode.insertBefore(messageDiv, formTitle.nextSibling);
            console.log('📍 Message inserted into DOM');
        } else {
            console.log('⚠️ Form title not found, message may not be visible');
        }

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.remove();
                console.log('🗑️ Message auto-removed after 5 seconds');
            }
        }, 5000);

        console.log('⏰ Message will auto-hide in 5 seconds');
    }
    
    // Input focus effects with logging
    console.log('🎨 Setting up form field interactions...');

    formInputs.forEach(input => {
        const fieldName = input.name || input.id || 'unknown-field';
        console.log(`   Field "${fieldName}" interaction handlers attached`);

        input.addEventListener('focus', function() {
            console.log(`📝 User focused on "${fieldName}" field`);
            this.parentElement.classList.add('focused');
        });

        input.addEventListener('blur', function() {
            console.log(`📝 User left "${fieldName}" field`);
            this.parentElement.classList.remove('focused');
        });

        // Add floating label effect
        if (input.value) {
            input.parentElement.classList.add('has-value');
        }

        input.addEventListener('input', function() {
            const hasContent = this.value.length > 0;
            console.log(`✏️ User typing in "${fieldName}": ${hasContent ? 'has content' : 'empty'}`);

            if (hasContent) {
                this.parentElement.classList.add('has-value');
            } else {
                this.parentElement.classList.remove('has-value');
            }
        });
    });

    console.log('✅ Form field interactions setup complete');
    
    // Contact item hover effects
    const contactItems = document.querySelectorAll('.contact-item');
    contactItems.forEach(item => {
        item.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-2px)';
        });
        
        item.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });
    
    // FAQ item interactions
    const faqItems = document.querySelectorAll('.faq-item');
    faqItems.forEach(item => {
        item.addEventListener('click', function() {
            // Toggle active state
            const isActive = this.classList.contains('active');
            
            // Remove active from all items
            faqItems.forEach(faq => faq.classList.remove('active'));
            
            // Add active to clicked item if it wasn't active
            if (!isActive) {
                this.classList.add('active');
            }
        });
    });
    
    // Social links hover effects
    const socialLinks = document.querySelectorAll('.social-link');
    socialLinks.forEach(link => {
        link.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-3px) scale(1.1)';
        });
        
        link.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0) scale(1)';
        });
    });
    
    // Smooth scrolling for navigation links
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            
            // Only handle internal links
            if (href.startsWith('#')) {
                e.preventDefault();
                const targetSection = document.querySelector(href);
                
                if (targetSection) {
                    targetSection.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            }
        });
    });
    
    // Add loading animation for page elements
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);
    
    // Observe elements for fade-in animation
    const fadeElements = document.querySelectorAll('.contact-form-section, .contact-info-section, .faq-item');
    
    fadeElements.forEach(element => {
        element.style.opacity = '0';
        element.style.transform = 'translateY(30px)';
        element.style.transition = 'opacity 0.6s ease-in-out, transform 0.6s ease-in-out';
        observer.observe(element);
    });
    
    // Contact form field validation
    const emailInput = document.getElementById('email');
    if (emailInput) {
        emailInput.addEventListener('blur', function() {
            if (this.value && !isValidEmail(this.value)) {
                this.style.borderColor = '#ff6b6b';
                showFieldError(this, 'Please enter a valid email address');
            } else {
                this.style.borderColor = '';
                removeFieldError(this);
            }
        });
    }
    
    const nameInput = document.getElementById('name');
    if (nameInput) {
        nameInput.addEventListener('blur', function() {
            if (this.value && this.value.length < 2) {
                this.style.borderColor = '#ff6b6b';
                showFieldError(this, 'Name must be at least 2 characters long');
            } else {
                this.style.borderColor = '';
                removeFieldError(this);
            }
        });
    }
    
    const messageInput = document.getElementById('message');
    if (messageInput) {
        messageInput.addEventListener('blur', function() {
            if (this.value && this.value.length < 10) {
                this.style.borderColor = '#ff6b6b';
                showFieldError(this, 'Message must be at least 10 characters long');
            } else {
                this.style.borderColor = '';
                removeFieldError(this);
            }
        });
    }
    
    // Field error display functions
    function showFieldError(field, message) {
        removeFieldError(field);
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'field-error';
        errorDiv.textContent = message;
        errorDiv.style.color = '#ff6b6b';
        errorDiv.style.fontSize = '0.8rem';
        errorDiv.style.marginTop = '0.3rem';
        
        field.parentNode.appendChild(errorDiv);
    }
    
    function removeFieldError(field) {
        const existingError = field.parentNode.querySelector('.field-error');
        if (existingError) {
            existingError.remove();
        }
    }
    
    // Add CSS for success/error messages
    const style = document.createElement('style');
    style.textContent = `
        .success-message {
            background: linear-gradient(135deg, #4CAF50, #45a049);
            color: white;
            padding: 1rem 2rem;
            border-radius: 10px;
            text-align: center;
            margin-bottom: 2rem;
            animation: slideIn 0.5s ease-in-out;
        }
        
        .error-message {
            background: linear-gradient(135deg, #ff6b6b, #ee5a52);
            color: white;
            padding: 1rem 2rem;
            border-radius: 10px;
            text-align: center;
            margin-bottom: 2rem;
            animation: slideIn 0.5s ease-in-out;
        }
        
        .faq-item.active {
            border-color: var(--antique-gold);
            background: rgba(75, 46, 57, 0.5);
        }
        
        .form-group.focused .form-label {
            color: var(--antique-gold);
        }
        
        .form-group.has-value .form-label {
            color: var(--antique-gold);
        }
    `;
    document.head.appendChild(style);
}); 