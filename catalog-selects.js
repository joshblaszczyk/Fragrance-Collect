(() => {
    'use strict';

    const SELECTOR = 'select:not([data-native-select])';
    const controls = new Map();
    let openControl = null;

    function enhanceSelect(select) {
        if (!(select instanceof HTMLSelectElement) || select.dataset.enhancedSelect === 'true') return;

        const label = select.id ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null;
        const wrappingLabel = select.closest('label');
        const wrappingLabelText = wrappingLabel
            ? [...wrappingLabel.childNodes]
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent.trim())
                .filter(Boolean)
                .join(' ')
            : '';
        const wrapper = document.createElement('div');
        const button = document.createElement('button');
        const value = document.createElement('span');
        const arrow = document.createElement('span');
        const menu = document.createElement('div');
        let typeaheadBuffer = '';
        let typeaheadTimer = null;

        wrapper.className = 'fc-select';
        button.type = 'button';
        button.className = 'fc-select__button';
        button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-expanded', 'false');
        value.className = 'fc-select__value';
        arrow.className = 'fc-select__arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="m3 5.25 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        menu.className = 'fc-select__menu';
        menu.id = `${select.id || `catalog-select-${controls.size + 1}`}-options`;
        menu.setAttribute('role', 'listbox');
        menu.hidden = true;
        button.setAttribute('aria-controls', menu.id);
        const accessibleLabel = label?.textContent.trim() || wrappingLabelText || select.getAttribute('aria-label') || 'Choose an option';
        button.setAttribute('aria-label', select.required ? `${accessibleLabel} (required)` : accessibleLabel);
        button.append(value, arrow);

        select.parentNode.insertBefore(wrapper, select);
        wrapper.append(select, button, menu);
        select.classList.add('fc-native-select');
        select.dataset.enhancedSelect = 'true';
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');

        function optionButtons() {
            return [...menu.querySelectorAll('.fc-select__option:not([disabled])')];
        }

        function resetTypeahead() {
            typeaheadBuffer = '';
            if (typeaheadTimer) window.clearTimeout(typeaheadTimer);
            typeaheadTimer = null;
        }

        function focusTypeaheadMatch(character) {
            const options = optionButtons();
            if (!options.length) return null;

            const nextCharacter = character.toLocaleLowerCase();
            const combined = `${typeaheadBuffer}${nextCharacter}`;
            // Repeated letters cycle through matching options like a native
            // select instead of producing an impossible query such as "sss".
            typeaheadBuffer = [...combined].every((letter) => letter === nextCharacter)
                ? nextCharacter
                : combined;
            if (typeaheadTimer) window.clearTimeout(typeaheadTimer);
            typeaheadTimer = window.setTimeout(resetTypeahead, 700);

            const activeIndex = options.indexOf(document.activeElement);
            const ordered = activeIndex < 0
                ? options
                : [...options.slice(activeIndex + 1), ...options.slice(0, activeIndex + 1)];
            const match = ordered.find((option) => option.textContent.trim().toLocaleLowerCase().startsWith(typeaheadBuffer));
            match?.focus();
            return match || null;
        }

        function sync() {
            const selected = select.selectedOptions[0] || select.options[0];
            value.textContent = selected?.textContent?.trim() || 'Choose';
            button.disabled = select.disabled;
            if (select.validity.valid) {
                button.removeAttribute('aria-invalid');
                wrapper.classList.remove('has-error');
            }
            menu.querySelectorAll('.fc-select__option').forEach((option) => {
                const isSelected = option.dataset.value === select.value;
                option.classList.toggle('is-selected', isSelected);
                option.setAttribute('aria-selected', String(isSelected));
            });
        }

        function close({ restoreFocus = false } = {}) {
            wrapper.classList.remove('is-open');
            wrapper.classList.remove('opens-upward');
            button.setAttribute('aria-expanded', 'false');
            menu.hidden = true;
            resetTypeahead();
            if (openControl === api) openControl = null;
            if (restoreFocus) button.focus();
        }

        function open({ focus = 'selected' } = {}) {
            if (button.disabled) return;
            if (openControl && openControl !== api) openControl.close();
            sync();
            wrapper.classList.add('is-open');
            button.setAttribute('aria-expanded', 'true');
            menu.hidden = false;
            openControl = api;
            window.requestAnimationFrame(() => {
                if (!wrapper.classList.contains('is-open')) return;
                wrapper.classList.remove('opens-upward');
                const buttonRect = button.getBoundingClientRect();
                const dialogRect = wrapper.closest('dialog[open]')?.getBoundingClientRect();
                const boundaryTop = Math.max(12, dialogRect?.top ?? 12);
                const boundaryBottom = Math.min(window.innerHeight - 12, dialogRect?.bottom ?? window.innerHeight - 12);
                const menuHeight = Math.min(menu.scrollHeight, window.innerHeight * 0.55);
                const spaceBelow = boundaryBottom - buttonRect.bottom - 8;
                const spaceAbove = buttonRect.top - boundaryTop - 8;
                if (spaceBelow < menuHeight && spaceAbove > spaceBelow) wrapper.classList.add('opens-upward');
                const options = optionButtons();
                const selected = menu.querySelector('.fc-select__option.is-selected:not([disabled])');
                const focusTarget = focus === 'first'
                    ? options[0]
                    : focus === 'last'
                        ? options.at(-1)
                        : selected || options[0];
                focusTarget?.focus();
            });
        }

        function choose(option) {
            if (!option || option.disabled) return;
            select.value = option.dataset.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            sync();
            close({ restoreFocus: true });
        }

        function moveFocus(current, amount) {
            const options = optionButtons();
            if (!options.length) return;
            const index = Math.max(0, options.indexOf(current));
            options[(index + amount + options.length) % options.length].focus();
        }

        function rebuild() {
            menu.replaceChildren();
            [...select.options].forEach((sourceOption) => {
                const option = document.createElement('button');
                const optionLabel = document.createElement('span');
                const check = document.createElement('span');
                option.type = 'button';
                option.className = 'fc-select__option';
                option.dataset.value = sourceOption.value;
                option.setAttribute('role', 'option');
                option.tabIndex = -1;
                option.disabled = sourceOption.disabled;
                optionLabel.textContent = sourceOption.textContent.trim();
                check.className = 'fc-select__check';
                check.textContent = '✓';
                check.setAttribute('aria-hidden', 'true');
                option.append(optionLabel, check);
                option.addEventListener('click', () => choose(option));
                option.addEventListener('keydown', (event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        moveFocus(option, event.key === 'ArrowDown' ? 1 : -1);
                    } else if (event.key === 'Home' || event.key === 'End') {
                        event.preventDefault();
                        const options = optionButtons();
                        options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
                    } else if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        choose(option);
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        close({ restoreFocus: true });
                    } else if (event.key === 'Tab') {
                        close();
                    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                        event.preventDefault();
                        focusTypeaheadMatch(event.key);
                    }
                });
                menu.appendChild(option);
            });
            sync();
        }

        const api = { close, sync, rebuild };
        controls.set(select, api);

        button.addEventListener('click', () => {
            if (wrapper.classList.contains('is-open')) close({ restoreFocus: true });
            else open();
        });
        button.addEventListener('keydown', (event) => {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
                event.preventDefault();
                open();
            } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                open({ focus: event.key === 'Home' ? 'first' : 'last' });
            } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                open();
                window.requestAnimationFrame(() => focusTypeaheadMatch(event.key));
            }
        });
        select.addEventListener('change', sync);
        select.addEventListener('invalid', (event) => {
            event.preventDefault();
            button.setAttribute('aria-invalid', 'true');
            wrapper.classList.add('has-error');
            button.focus();
        });
        (label || wrappingLabel)?.addEventListener('click', (event) => {
            if (event.target instanceof Element && event.target.closest('.fc-select') === wrapper) return;
            event.preventDefault();
            button.focus();
        });
        select.form?.addEventListener('reset', () => window.requestAnimationFrame(sync));

        new MutationObserver(rebuild).observe(select, { childList: true, subtree: true });
        rebuild();
    }

    function enhanceAll(root = document) {
        if (root instanceof HTMLSelectElement && root.matches(SELECTOR)) enhanceSelect(root);
        root.querySelectorAll?.(SELECTOR).forEach(enhanceSelect);
    }

    function initialize() {
        enhanceAll();
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
                if (node instanceof Element) enhanceAll(node);
            }));
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener('pointerdown', (event) => {
        if (openControl && !event.target.closest('.fc-select')) openControl.close();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && openControl) openControl.close({ restoreFocus: true });
    });

    window.FragranceSelects = Object.freeze({
        enhanceAll,
        syncAll() {
            controls.forEach((control) => control.sync());
        },
        sync(select) {
            controls.get(select)?.sync();
        },
        refresh(select) {
            controls.get(select)?.rebuild();
        }
    });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})();
