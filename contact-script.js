document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('contactForm');
  const subject = document.getElementById('subject');
  const modal = document.getElementById('successModal');
  const modalPanel = modal?.querySelector('.modal-content');
  const closeButton = modal?.querySelector('.close-button');
  let previouslyFocusedElement = null;
  let inertSiblings = [];

  function updateSubjectStyle() {
    subject?.classList.toggle('select-placeholder', !subject.value);
  }

  function showMessage(message) {
    form?.parentElement?.querySelector('.form-message')?.remove();

    const messageElement = document.createElement('p');
    messageElement.className = 'form-message error-message';
    messageElement.setAttribute('role', 'alert');
    messageElement.tabIndex = -1;
    messageElement.textContent = message;
    form?.before(messageElement);
    messageElement.focus({ preventScroll: true });
  }

  function openModal(returnFocusTo) {
    if (!modal || !closeButton) return;
    previouslyFocusedElement = returnFocusTo || document.activeElement;
    modal.hidden = false;
    modal.classList.add('is-open');
    document.body.classList.add('modal-open');
    inertSiblings = [...document.body.children]
      .filter((element) => element !== modal && !element.inert);
    inertSiblings.forEach((element) => { element.inert = true; });
    closeButton.focus();
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.classList.remove('is-open');
    document.body.classList.remove('modal-open');
    inertSiblings.forEach((element) => { element.inert = false; });
    inertSiblings = [];
    previouslyFocusedElement?.focus?.();
  }

  function trapModalFocus(event) {
    if (event.key === 'Escape') {
      closeModal();
      return;
    }

    if (event.key !== 'Tab' || !modalPanel) return;
    const focusable = [...modalPanel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.disabled && !element.hidden);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  subject?.addEventListener('change', updateSubjectStyle);
  updateSubjectStyle();

  closeButton?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  modal?.addEventListener('keydown', trapModalFocus);

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    form.parentElement?.querySelector('.form-message')?.remove();

    if (!form.reportValidity()) return;

    const values = Object.fromEntries(new FormData(form));
    const submitButton = form.querySelector('.submit-btn');
    const submitLabel = submitButton?.querySelector('span');
    const originalLabel = submitLabel?.textContent || 'Send Message';

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
    }
    if (submitLabel) submitLabel.textContent = 'Sending…';

    try {
      const response = await fetch(`${window.API_BASE}/api/contact`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });
      const result = await readJson(response);

      if (!response.ok || !result.success) {
        throw new Error(result.error || result.message || 'We could not send your message. Please try again.');
      }

      form.reset();
      updateSubjectStyle();
      openModal(submitButton);
    } catch (error) {
      const isNetworkFailure = error instanceof TypeError;
      showMessage(isNetworkFailure
        ? 'We could not reach the support service. Check your connection and try again.'
        : error.message);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
      }
      if (submitLabel) submitLabel.textContent = originalLabel;
    }
  });
});
