document.addEventListener('DOMContentLoaded', () => {
    const items = [...document.querySelectorAll('.faq-item')];
    const search = document.getElementById('faq-search');
    const noResults = document.getElementById('faq-no-results');

    function setExpanded(item, expanded) {
        const question = item.querySelector('.faq-question');
        const answer = item.querySelector('.faq-answer');
        item.classList.toggle('active', expanded);
        question.setAttribute('aria-expanded', String(expanded));
        answer.hidden = !expanded;
    }

    items.forEach((item) => {
        item.querySelector('.faq-question').addEventListener('click', () => {
            const shouldOpen = !item.classList.contains('active');
            items.forEach((otherItem) => setExpanded(otherItem, otherItem === item && shouldOpen));
        });
    });

    search?.addEventListener('input', () => {
        const query = search.value.trim().toLocaleLowerCase();
        let visibleCount = 0;
        items.forEach((item) => {
            const matches = !query || item.textContent.toLocaleLowerCase().includes(query);
            item.hidden = !matches;
            if (matches) visibleCount += 1;
        });
        noResults.hidden = visibleCount !== 0;
    });

    if (window.location.hash === '#faq') {
        document.querySelector('.faq-section')?.scrollIntoView({ block: 'start' });
    }
});
