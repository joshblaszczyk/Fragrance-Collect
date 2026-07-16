// Customer Service Page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Initialize hamburger menu
    initHamburgerMenu();
    
    // Initialize smooth scrolling
    initSmoothScrolling();
    
    // Initialize service card animations
    initServiceCardAnimations();
    
    // Initialize contact method hover effects
    initContactMethodEffects();
});

// Hamburger Menu Functionality
function initHamburgerMenu() {
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');
    
    if (hamburger && navMenu) {
        hamburger.addEventListener('click', function() {
            hamburger.classList.toggle('active');
            navMenu.classList.toggle('active');
        });
        
        // Close menu when clicking on a link
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                hamburger.classList.remove('active');
                navMenu.classList.remove('active');
            });
        });
    }
}

// Smooth Scrolling
function initSmoothScrolling() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

// Service Card Animations
function initServiceCardAnimations() {
    const serviceCards = document.querySelectorAll('.service-card');
    
    // Intersection Observer for fade-in animations
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });
    
    serviceCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = `opacity 0.6s ease ${index * 0.1}s, transform 0.6s ease ${index * 0.1}s`;
        observer.observe(card);
    });
}

// Contact Method Hover Effects
function initContactMethodEffects() {
    const contactMethods = document.querySelectorAll('.contact-method');
    
    contactMethods.forEach(method => {
        method.addEventListener('mouseenter', function() {
            this.style.transform = 'translateX(10px) scale(1.02)';
        });
        
        method.addEventListener('mouseleave', function() {
            this.style.transform = 'translateX(0) scale(1)';
        });
    });
}

// Service Button Click Handlers
document.addEventListener('DOMContentLoaded', function() {
    const serviceButtons = document.querySelectorAll('.service-btn');
    
    serviceButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            // Add click animation
            this.style.transform = 'scale(0.95)';
            setTimeout(() => {
                this.style.transform = '';
            }, 150);
            
            // Handle specific button actions
            const buttonText = this.textContent.trim();
            
            switch(buttonText) {
                case 'Get Help Now':
                    // Redirect to contact page
                    window.location.href = 'contact.html';
                    break;
                case 'Book Consultation':
                    // Redirect to contact page with consultation subject
                    window.location.href = 'contact.html?subject=consultation';
                    break;
                case 'Learn More':
                    // Show detailed information for the specific service
                    const serviceCard = this.closest('.service-card');
                    const serviceTitle = serviceCard.querySelector('h3').textContent;
                    showServiceDetails(serviceTitle);
                    break;
                case 'Our Promise':
                    // Show authenticity guarantee details
                    showAuthenticityPromise();
                    break;
                default:
                    // Default action for other buttons
                    console.log('Service button clicked:', buttonText);
            }
        });
    });
});

// Show service details modal
function showServiceDetails(serviceTitle) {
    const modal = document.createElement('div');
    modal.className = 'service-modal';
    modal.innerHTML = `
        <div class="service-modal-content">
            <span class="service-modal-close">&times;</span>
            <h2>${serviceTitle}</h2>
            <div class="service-modal-body">
                ${getServiceDetails(serviceTitle)}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Close modal functionality
    const closeBtn = modal.querySelector('.service-modal-close');
    closeBtn.onclick = function() {
        document.body.removeChild(modal);
    };
    
    // Close modal when clicking outside
    modal.onclick = function(e) {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    };
    
    // Add animation
    setTimeout(() => {
        modal.style.opacity = '1';
        modal.querySelector('.service-modal-content').style.transform = 'scale(1)';
    }, 10);
}

// Get service details content
function getServiceDetails(serviceTitle) {
    switch(serviceTitle) {
        case 'Gift Services':
            return `
                <h3>Gifting Made Easy</h3>
                <p>Many of the retailers we link to offer gift options at checkout. Here's what to look for when buying a fragrance as a gift:</p>
                <ul>
                    <li><strong>Gift Wrapping:</strong> Most luxury retailers offer premium gift wrapping — select it on their checkout page</li>
                    <li><strong>Personalized Messages:</strong> Look for a gift-message field when you complete your order at the retailer</li>
                    <li><strong>Special Packaging:</strong> Many brands ship in signature presentation boxes</li>
                    <li><strong>Gift Sets & Certificates:</strong> We help you find gift sets and retailer gift cards worth comparing</li>
                    <li><strong>Delivery Options:</strong> Compare express and standard shipping across retailers before you buy</li>
                </ul>
                <p><strong>Tip:</strong> Gift wrapping and delivery options vary by retailer — check the details on their site before completing your purchase.</p>
            `;
        case 'Personal Consultation':
            return `
                <h3>Expert Fragrance Consultation</h3>
                <p>Discover your perfect signature scent with our certified fragrance experts:</p>
                <ul>
                    <li><strong>Virtual Consultations:</strong> Online sessions via video call</li>
                    <li><strong>Fragrance Profiling:</strong> Detailed analysis of your preferences and lifestyle</li>
                    <li><strong>Seasonal Recommendations:</strong> Curated selections for different occasions</li>
                    <li><strong>Retailer Guidance:</strong> We help you find the best retailer and price once you've chosen a scent</li>
                    <li><strong>Follow-up Support:</strong> Ongoing assistance with your fragrance journey</li>
                </ul>
                <p><strong>Duration:</strong> 45-60 minutes | <strong>Cost:</strong> $75 (a one-time consultation fee)</p>
            `;
        case 'Authenticity Guarantee':
            return `
                <h3>Shop With Confidence</h3>
                <p>We only list fragrances from retailers we've vetted as authorized, authentic sellers:</p>
                <ul>
                    <li><strong>Vetted Retailers:</strong> We feature retailers that are authorized to sell the brands they carry</li>
                    <li><strong>Authorized Sources:</strong> Our links lead to sellers who source directly from brands or authorized distributors</li>
                    <li><strong>Retailer Guarantees:</strong> The retailers we list back their products with their own authenticity guarantees</li>
                    <li><strong>Transparent Listings:</strong> Every listing shows the retailer so you always know who you're buying from</li>
                    <li><strong>Price Comparison:</strong> Compare offers across trusted sellers before you buy</li>
                </ul>
                <p><strong>Our Commitment:</strong> We only surface listings from reputable, authorized retailers, so you can shop with confidence wherever you choose to buy.</p>
            `;
        default:
            return `<p>Detailed information about ${serviceTitle} will be available soon.</p>`;
    }
}

// Show authenticity promise modal
function showAuthenticityPromise() {
    showServiceDetails('Authenticity Guarantee');
}

// Show info message
function showInfoMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'info-message';
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--deep-plum);
        color: var(--warm-white);
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 1000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (document.body.contains(messageDiv)) {
                document.body.removeChild(messageDiv);
            }
        }, 300);
    }, 3000);
}

// Dynamic navbar background on scroll
window.addEventListener('scroll', function() {
    const navbar = document.querySelector('.navbar');
    if (navbar) {
        if (window.scrollY > 50) {
            navbar.style.background = 'rgba(18, 18, 18, 0.95)';
            navbar.style.backdropFilter = 'blur(10px)';
        } else {
            navbar.style.background = 'rgba(18, 18, 18, 0.8)';
            navbar.style.backdropFilter = 'blur(5px)';
        }
    }
});

// Search functionality
document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.querySelector('.search-input');
    const searchBtn = document.querySelector('.search-btn');
    
    if (searchInput && searchBtn) {
        searchBtn.addEventListener('click', function() {
            const query = searchInput.value.trim();
            if (query) {
                // Redirect to main page with search query
                window.location.href = `main.html?search=${encodeURIComponent(query)}`;
            }
        });
        
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                const query = this.value.trim();
                if (query) {
                    window.location.href = `main.html?search=${encodeURIComponent(query)}`;
                }
            }
        });
    }
});

// Page load animation
window.addEventListener('load', function() {
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.5s ease';
    
    setTimeout(() => {
        document.body.style.opacity = '1';
    }, 100);
});

// Service card click effects
document.addEventListener('DOMContentLoaded', function() {
    const serviceCards = document.querySelectorAll('.service-card');
    
    serviceCards.forEach(card => {
        card.addEventListener('click', function(e) {
            // Don't trigger if clicking on the button
            if (e.target.classList.contains('service-btn')) {
                return;
            }
            
            // Add ripple effect
            const ripple = document.createElement('div');
            ripple.style.position = 'absolute';
            ripple.style.borderRadius = '50%';
            ripple.style.background = 'rgba(201, 166, 70, 0.3)';
            ripple.style.transform = 'scale(0)';
            ripple.style.animation = 'ripple 0.6s linear';
            ripple.style.left = (e.clientX - this.offsetLeft) + 'px';
            ripple.style.top = (e.clientY - this.offsetTop) + 'px';
            ripple.style.width = ripple.style.height = '20px';
            
            this.appendChild(ripple);
            
            setTimeout(() => {
                ripple.remove();
            }, 600);
        });
    });
});

// Add ripple animation to CSS
const style = document.createElement('style');
style.textContent = `
    @keyframes ripple {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style); 