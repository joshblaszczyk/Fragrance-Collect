// Size Guide Page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Initialize hamburger menu
    initHamburgerMenu();
    
    // Initialize smooth scrolling
    initSmoothScrolling();
    
    // Initialize size card animations
    initSizeCardAnimations();
    
    // Initialize usage card animations
    initUsageCardAnimations();
    
    // Initialize calculator functionality
    initCalculator();
    
    // Initialize table hover effects
    initTableEffects();
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

// Size Card Animations
function initSizeCardAnimations() {
    const sizeCards = document.querySelectorAll('.size-card');
    
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
    
    sizeCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = `opacity 0.6s ease ${index * 0.1}s, transform 0.6s ease ${index * 0.1}s`;
        observer.observe(card);
    });
}

// Usage Card Animations
function initUsageCardAnimations() {
    const usageCards = document.querySelectorAll('.usage-card');
    
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
    
    usageCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = `opacity 0.6s ease ${index * 0.1}s, transform 0.6s ease ${index * 0.1}s`;
        observer.observe(card);
    });
}

// Calculator Functionality
function initCalculator() {
    const calculateBtn = document.getElementById('calculate-btn');
    const calculatorResult = document.getElementById('calculator-result');
    
    if (calculateBtn && calculatorResult) {
        calculateBtn.addEventListener('click', function() {
            const frequency = document.getElementById('usage-frequency').value;
            const sprays = document.getElementById('sprays-per-use').value;
            const duration = document.getElementById('duration').value;
            
            if (!frequency || !sprays || !duration) {
                showCalculatorError('Please fill in all fields to get a recommendation.');
                return;
            }
            
            // Show loading state
            calculateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calculating...';
            calculateBtn.disabled = true;
            
            // Simulate calculation delay
            setTimeout(() => {
                const recommendation = calculateSizeRecommendation(frequency, sprays, duration);
                showCalculatorResult(recommendation);
                calculateBtn.innerHTML = '<i class="fas fa-calculator"></i> Calculate Recommended Size';
                calculateBtn.disabled = false;
            }, 1500);
        });
    }
}

// Calculate Size Recommendation
function calculateSizeRecommendation(frequency, sprays, duration) {
    // Define usage patterns
    const usagePatterns = {
        daily: 365,
        weekly: 156, // 3 times per week
        occasional: 52, // once per week
        rarely: 12 // once per month
    };
    
    // Define spray amounts (ml per spray)
    const sprayAmounts = {
        '1': 0.1,
        '2': 0.2,
        '3': 0.3,
        '4': 0.4
    };
    
    // Calculate total usage per year
    const usesPerYear = usagePatterns[frequency];
    const mlPerUse = sprayAmounts[sprays];
    const totalMlPerYear = usesPerYear * mlPerUse;
    
    // Calculate required ml based on duration
    const durationMultipliers = {
        '3months': 0.25,
        '6months': 0.5,
        '1year': 1,
        '2years': 2
    };
    
    const requiredMl = totalMlPerYear * durationMultipliers[duration];
    
    // Determine size recommendation
    let recommendation = {
        size: '',
        ml: 0,
        applications: 0,
        reasoning: ''
    };
    
    if (requiredMl <= 5) {
        recommendation = {
            size: 'Sample Size (1-5 ml)',
            ml: 5,
            applications: Math.round(5 / mlPerUse),
            reasoning: 'Perfect for testing new fragrances before committing to a larger size.'
        };
    } else if (requiredMl <= 15) {
        recommendation = {
            size: 'Mini Size (10-15 ml)',
            ml: 15,
            applications: Math.round(15 / mlPerUse),
            reasoning: 'Ideal for travel and occasional use. Great value for your usage pattern.'
        };
    } else if (requiredMl <= 100) {
        recommendation = {
            size: 'Standard Size (50-100 ml)',
            ml: 100,
            applications: Math.round(100 / mlPerUse),
            reasoning: 'The most popular choice. Perfect balance of value and longevity.'
        };
    } else {
        recommendation = {
            size: 'Large Size (125-200 ml)',
            ml: 200,
            applications: Math.round(200 / mlPerUse),
            reasoning: 'For fragrance enthusiasts who want extended use of their favorite scents.'
        };
    }
    
    return {
        ...recommendation,
        frequency: frequency,
        sprays: sprays,
        duration: duration,
        calculatedMl: Math.round(requiredMl)
    };
}

// Show Calculator Result
function showCalculatorResult(data) {
    const calculatorResult = document.getElementById('calculator-result');
    
    const resultHTML = `
        <div class="calculator-result-content">
            <div class="result-header">
                <i class="fas fa-check-circle"></i>
                <h3>Your Perfect Size</h3>
            </div>
            <div class="result-details">
                <div class="result-size">
                    <h4>${data.size}</h4>
                    <p class="size-amount">${data.ml} ml</p>
                </div>
                <div class="result-stats">
                    <div class="stat">
                        <span class="stat-label">Applications:</span>
                        <span class="stat-value">${data.applications}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Your Usage:</span>
                        <span class="stat-value">${data.frequency} (${data.sprays} sprays)</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Duration:</span>
                        <span class="stat-value">${data.duration}</span>
                    </div>
                </div>
                <div class="result-reasoning">
                    <p>${data.reasoning}</p>
                </div>
            </div>
        </div>
    `;
    
    calculatorResult.innerHTML = resultHTML;
    
    // Add result styles
    addCalculatorResultStyles();
}

// Show Calculator Error
function showCalculatorError(message) {
    const calculatorResult = document.getElementById('calculator-result');
    
    calculatorResult.innerHTML = `
        <div class="calculator-error">
            <i class="fas fa-exclamation-triangle"></i>
            <p>${message}</p>
        </div>
    `;
}

// Table Effects
function initTableEffects() {
    const tableRows = document.querySelectorAll('.conversion-table tbody tr');
    
    tableRows.forEach((row, index) => {
        row.style.opacity = '0';
        row.style.transform = 'translateX(-20px)';
        row.style.transition = `opacity 0.6s ease ${index * 0.1}s, transform 0.6s ease ${index * 0.1}s`;
        
        // Trigger animation when table comes into view
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateX(0)';
                }
            });
        }, { threshold: 0.1 });
        
        observer.observe(row);
    });
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

// Add calculator result styles
function addCalculatorResultStyles() {
    if (!document.getElementById('calculator-result-styles')) {
        const style = document.createElement('style');
        style.id = 'calculator-result-styles';
        style.textContent = `
            .calculator-result-content {
                color: var(--warm-white);
                text-align: center;
            }
            
            .result-header {
                margin-bottom: 2rem;
            }
            
            .result-header i {
                font-size: 3rem;
                color: #4CAF50;
                margin-bottom: 1rem;
                display: block;
            }
            
            .result-header h3 {
                font-family: 'Playfair Display', serif;
                font-size: 1.8rem;
                color: var(--warm-white);
                margin-bottom: 0;
            }
            
            .result-size {
                margin-bottom: 2rem;
                padding: 1.5rem;
                background: rgba(18, 18, 18, 0.3);
                border: 2px solid var(--antique-gold);
                border-radius: 10px;
            }
            
            .result-size h4 {
                font-family: 'Playfair Display', serif;
                font-size: 1.3rem;
                color: var(--antique-gold);
                margin-bottom: 0.5rem;
            }
            
            .size-amount {
                font-size: 1.5rem;
                color: var(--warm-white);
                font-weight: 600;
            }
            
            .result-stats {
                margin-bottom: 2rem;
            }
            
            .stat {
                display: flex;
                justify-content: space-between;
                margin-bottom: 0.75rem;
                padding: 0.5rem 0;
                border-bottom: 1px solid rgba(201, 166, 70, 0.2);
            }
            
            .stat:last-child {
                border-bottom: none;
            }
            
            .stat-label {
                color: rgba(245, 240, 230, 0.8);
                font-weight: 500;
            }
            
            .stat-value {
                color: var(--antique-gold);
                font-weight: 600;
            }
            
            .result-reasoning {
                background: rgba(18, 18, 18, 0.3);
                border: 1px solid rgba(201, 166, 70, 0.3);
                border-radius: 10px;
                padding: 1rem;
            }
            
            .result-reasoning p {
                color: rgba(245, 240, 230, 0.9);
                line-height: 1.6;
                margin: 0;
            }
            
            .calculator-error {
                text-align: center;
                color: #ff6b6b;
            }
            
            .calculator-error i {
                font-size: 3rem;
                margin-bottom: 1rem;
                display: block;
            }
            
            .calculator-error p {
                font-size: 1rem;
            }
        `;
        document.head.appendChild(style);
    }
}

// Page load animation
window.addEventListener('load', function() {
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.5s ease';
    
    setTimeout(() => {
        document.body.style.opacity = '1';
    }, 100);
});

// Size card hover effects
document.addEventListener('DOMContentLoaded', function() {
    const sizeCards = document.querySelectorAll('.size-card');
    
    sizeCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-5px) scale(1.02)';
        });
        
        card.addEventListener('mouseleave', function() {
            if (this.classList.contains('featured')) {
                this.style.transform = 'scale(1.05)';
            } else {
                this.style.transform = 'translateY(0) scale(1)';
            }
        });
    });
});

// Usage card hover effects
document.addEventListener('DOMContentLoaded', function() {
    const usageCards = document.querySelectorAll('.usage-card');
    
    usageCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-5px) scale(1.02)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0) scale(1)';
        });
    });
}); 