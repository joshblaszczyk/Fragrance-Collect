document.addEventListener('DOMContentLoaded', () => {
  const calculatorForm = document.getElementById('size-calculator');
  const result = document.getElementById('calculator-result');
  const frequencySelect = document.getElementById('usage-frequency');
  const spraysSelect = document.getElementById('sprays-per-use');
  const durationSelect = document.getElementById('duration');

  if (!calculatorForm || !result || !frequencySelect || !spraysSelect || !durationSelect) return;

  const usesPerYear = {
    daily: 365,
    weekly: 130,
    occasional: 24,
    rarely: 12
  };
  const durationInYears = {
    '3months': 0.25,
    '6months': 0.5,
    '1year': 1,
    '2years': 2
  };
  const durationLabels = {
    '3months': '3 months',
    '6months': '6 months',
    '1year': '1 year',
    '2years': '2 years'
  };
  const frequencyLabels = {
    daily: 'daily',
    weekly: '2–3 times per week',
    occasional: 'about twice per month',
    rarely: 'about once per month'
  };

  function chooseBottle(requiredMl) {
    const sizes = [
      { limit: 5, ml: 5, label: 'Sample or decant' },
      { limit: 15, ml: 15, label: 'Travel size' },
      { limit: 50, ml: 50, label: '50 ml bottle' },
      { limit: 100, ml: 100, label: '100 ml bottle' },
      { limit: 200, ml: 200, label: 'Large bottle' }
    ];
    return sizes.find(({ limit }) => requiredMl <= limit) || {
      ml: Math.ceil(requiredMl / 100) * 100,
      label: 'More than one full bottle'
    };
  }

  function replaceResult(children, className) {
    result.replaceChildren(...children);
    result.className = `calculator-result ${className}`;
    window.requestAnimationFrame(() => result.focus({ preventScroll: true }));
  }

  function showError(message) {
    const icon = document.createElement('i');
    icon.className = 'fas fa-exclamation-triangle';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('p');
    text.textContent = message;
    const wrapper = document.createElement('div');
    wrapper.className = 'calculator-error';
    wrapper.append(icon, text);
    replaceResult([wrapper], 'has-error');
  }

  function createStat(label, value) {
    const row = document.createElement('div');
    row.className = 'stat';
    const labelElement = document.createElement('span');
    labelElement.className = 'stat-label';
    labelElement.textContent = label;
    const valueElement = document.createElement('span');
    valueElement.className = 'stat-value';
    valueElement.textContent = value;
    row.append(labelElement, valueElement);
    return row;
  }

  function showRecommendation({ bottle, requiredMl, sprays, frequency, duration }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'calculator-result-content';

    const heading = document.createElement('h3');
    heading.textContent = 'Estimated bottle size';

    const size = document.createElement('div');
    size.className = 'result-size';
    const sizeName = document.createElement('h4');
    sizeName.textContent = bottle.label;
    const amount = document.createElement('p');
    amount.className = 'size-amount';
    amount.textContent = `${bottle.ml} ml`;
    size.append(sizeName, amount);

    const stats = document.createElement('div');
    stats.className = 'result-stats';
    stats.append(
      createStat('Estimated need', `${requiredMl.toFixed(1)} ml`),
      createStat('Usage', `${frequencyLabels[frequency]}, ${sprays} spray${sprays === 1 ? '' : 's'} each time`),
      createStat('Target duration', durationLabels[duration])
    );

    const note = document.createElement('p');
    note.className = 'result-reasoning';
    note.textContent = 'This estimate assumes 0.1 ml per spray. Actual atomizer output and usage vary, so consider sizing down when trying an unfamiliar fragrance.';

    wrapper.append(heading, size, stats, note);
    replaceResult([wrapper], 'has-result');
  }

  calculatorForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const frequency = frequencySelect.value;
    const sprays = Number(spraysSelect.value);
    const duration = durationSelect.value;
    if (!usesPerYear[frequency] || !sprays || !durationInYears[duration]) {
      showError('Choose a value in all three fields to calculate an estimate.');
      return;
    }

    const requiredMl = usesPerYear[frequency] * sprays * 0.1 * durationInYears[duration];
    showRecommendation({
      bottle: chooseBottle(requiredMl),
      requiredMl,
      sprays,
      frequency,
      duration
    });
  });
});
