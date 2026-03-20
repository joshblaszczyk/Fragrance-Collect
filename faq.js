// FAQ Page JavaScript
document.addEventListener('DOMContentLoaded', function() {
    const faqItems = document.querySelectorAll('.faq-item');
    const faqSearch = document.getElementById('faq-search');
    const faqAccordion = document.getElementById('faq-accordion');

    // Accordion functionality
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        const answer = item.querySelector('.faq-answer');
        const icon = item.querySelector('.faq-icon i');

        question.addEventListener('click', function() {
            const isActive = item.classList.contains('active');
            
            // Close all other items
            faqItems.forEach(otherItem => {
                if (otherItem !== item) {
                    otherItem.classList.remove('active');
                    const otherAnswer = otherItem.querySelector('.faq-answer');
                    const otherIcon = otherItem.querySelector('.faq-icon i');
                    otherAnswer.style.maxHeight = '0';
                    otherIcon.style.transform = 'rotate(0deg)';
                }
            });

            // Toggle current item
            if (isActive) {
                item.classList.remove('active');
                answer.style.maxHeight = '0';
                icon.style.transform = 'rotate(0deg)';
            } else {
                item.classList.add('active');
                // Use a large value to ensure content is fully visible
                answer.style.maxHeight = '2000px';
                icon.style.transform = 'rotate(45deg)';
            }
        });

        // Keyboard accessibility
        question.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                question.click();
            }
        });
    });

    // Search functionality
    if (faqSearch) {
        faqSearch.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase().trim();
            
            faqItems.forEach(item => {
                const question = item.querySelector('.faq-question h3').textContent.toLowerCase();
                const answer = item.querySelector('.faq-answer p').textContent.toLowerCase();
                const matches = question.includes(searchTerm) || answer.includes(searchTerm);
                
                if (searchTerm === '' || matches) {
                    item.style.display = 'block';
                    item.classList.remove('hidden');
                    item.classList.add('visible');
                    
                    // Add a small delay for smooth animation
                    setTimeout(() => {
                        item.style.opacity = '1';
                        item.style.transform = 'translateY(0)';
                    }, 50);
                } else {
                    item.style.opacity = '0';
                    item.style.transform = 'translateY(-10px)';
                    
                    setTimeout(() => {
                        item.style.display = 'none';
                        item.classList.add('hidden');
                        item.classList.remove('visible');
                    }, 300);
                }
            });
        });

        // Clear search when clicking the search icon
        const searchIcon = document.querySelector('.search-icon');
        if (searchIcon) {
            searchIcon.addEventListener('click', function() {
                faqSearch.value = '';
                faqSearch.dispatchEvent(new Event('input'));
                faqSearch.focus();
            });
        }
    }

    // Smooth scroll to FAQ section when navigating from other pages
    if (window.location.hash === '#faq') {
        const faqSection = document.querySelector('.faq-section');
        if (faqSection) {
            setTimeout(() => {
                faqSection.scrollIntoView({ 
                    behavior: 'smooth',
                    block: 'start'
                });
            }, 100);
        }
    }

    // Add loading animation for FAQ items
    function animateFAQItems() {
        faqItems.forEach((item, index) => {
            item.style.opacity = '0';
            item.style.transform = 'translateY(20px)';
            
            setTimeout(() => {
                item.style.transition = 'all 0.6s ease';
                item.style.opacity = '1';
                item.style.transform = 'translateY(0)';
            }, index * 100);
        });
    }

    // Initialize animations
    animateFAQItems();

    // Add hover effects for better user experience
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        
        question.addEventListener('mouseenter', function() {
            if (!item.classList.contains('active')) {
                this.style.background = 'rgba(75, 46, 57, 0.3)';
            }
        });
        
        question.addEventListener('mouseleave', function() {
            if (!item.classList.contains('active')) {
                this.style.background = 'rgba(75, 46, 57, 0.1)';
            }
        });
    });

    // Add focus management for accessibility
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        
        question.addEventListener('focus', function() {
            this.style.outline = '2px solid var(--antique-gold)';
            this.style.outlineOffset = '-2px';
        });
        
        question.addEventListener('blur', function() {
            this.style.outline = 'none';
        });
    });

    // Add smooth transitions for search results
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Debounced search for better performance
    const debouncedSearch = debounce(function(searchTerm) {
        // Search logic is already handled in the main input event listener
    }, 300);

    if (faqSearch) {
        faqSearch.addEventListener('input', function() {
            debouncedSearch(this.value);
        });
    }
}); 