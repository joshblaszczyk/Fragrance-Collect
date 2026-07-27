(() => {
    'use strict';

    const apiBase = (window.API_BASE || '').replace(/\/$/, '');
    const dashboard = document.getElementById('admin-dashboard');
    const accessState = document.getElementById('admin-access-state');
    const notice = document.getElementById('admin-notice');
    const range = document.getElementById('report-range');
    let termsLoaded = false;
    let advertisersLoaded = false;

    const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
    const money = (value) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
    const integer = (value) => new Intl.NumberFormat().format(Number(value) || 0);
    const dateTime = (value) => {
        if (!value) return 'Never';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? 'Unknown' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    };

    async function request(path, options = {}) {
        const response = await fetch(`${apiBase}${path}`, {
            credentials: 'include',
            headers: { Accept: 'application/json', ...(options.headers || {}) },
            ...options
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(payload.error || `Request failed (${response.status})`);
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function showNotice(message) {
        notice.textContent = message;
        notice.hidden = false;
        clearTimeout(showNotice.timeout);
        showNotice.timeout = setTimeout(() => { notice.hidden = true; }, 4500);
    }

    function showAccessError(error) {
        dashboard.hidden = true;
        accessState.hidden = false;
        if (error.status === 401) {
            accessState.innerHTML = '<h2>Sign in required</h2><p>This private workspace requires an authenticated Fragrance Collect account. <a href="auth.html?tab=signin">Sign in and return here</a>.</p>';
        } else if (error.status === 403) {
            accessState.innerHTML = '<h2>Administrator access not granted</h2><p>Your account is signed in, but its email is not listed in the Worker’s <code>ADMIN_EMAILS</code> secret. No reporting data was exposed.</p>';
        } else {
            accessState.innerHTML = `<h2>Reporting unavailable</h2><p>${escape(error.message || 'The CJ reporting service could not be loaded.')}</p>`;
        }
    }

    function metric(label, value, note) {
        return `<article class="admin-metric"><span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(note)}</small></article>`;
    }

    function renderMetrics(data) {
        const totals = data.commissions?.totals || {};
        document.getElementById('admin-metrics').innerHTML = [
            metric('Commission', money(totals.commissionUsd), `${integer(totals.actions)} reported actions`),
            metric('Sales value', money(totals.salesUsd), 'CJ-reported order value'),
            metric('Average order', money(totals.averageOrderUsd), 'Across reported actions'),
            metric('Corrections', integer(totals.corrected), 'Corrected or non-original records'),
            metric('Cross-device', integer(totals.crossDevice), 'Attributed cross-device actions')
        ].join('');
        document.getElementById('admin-metrics').removeAttribute('aria-busy');
    }

    function renderChart(rows, days) {
        const chart = document.getElementById('commission-chart');
        const values = (rows || []).slice(-31);
        if (!values.length) {
            chart.innerHTML = '<p class="admin-empty">No commission actions were returned for this range.</p>';
            return;
        }
        const maximum = Math.max(...values.map((row) => Number(row.commissionUsd) || 0), 0.01);
        chart.innerHTML = values.map((row, index) => {
            const amount = Number(row.commissionUsd) || 0;
            const height = Math.max((amount / maximum) * 100, amount ? 3 : 1);
            const level = Math.max(0, Math.min(20, Math.round(height / 5)));
            const showLabel = values.length <= 14 || index % Math.ceil(values.length / 8) === 0;
            return `<div class="chart-column" title="${escape(row.day)}: ${escape(money(amount))}"><i class="chart-level-${level}"></i>${showLabel ? `<span>${escape(String(row.day || '').slice(5))}</span>` : ''}</div>`;
        }).join('');
        document.getElementById('chart-range').textContent = `${days} days · ${values.length} active days`;
    }

    function renderLocalHealth(local) {
        const clicks = local?.clicks || {};
        const observations = local?.observations || {};
        const rows = [
            ['Outbound visits', integer(clicks.total)],
            ['Products visited', integer(clicks.products)],
            ['Retailers visited', integer(clicks.advertisers)],
            ['Daily observations', integer(observations.total)],
            ['Products observed', integer(observations.products)],
            ['Active deal watches', integer(local?.activeAlerts)],
            ['Latest observation', dateTime(observations.latest)]
        ];
        document.getElementById('local-health').innerHTML = rows.map(([name, value]) => `<div><dt>${escape(name)}</dt><dd>${escape(value)}</dd></div>`).join('');
    }

    function renderAdvertiserPerformance(rows) {
        const tbody = document.getElementById('advertiser-performance');
        const values = (rows || []).slice(0, 30);
        tbody.innerHTML = values.length ? values.map((row) => `<tr><td>${escape(row.advertiser)}</td><td>${integer(row.actions)}</td><td>${money(row.salesUsd)}</td><td>${money(row.commissionUsd)}</td></tr>`).join('') : '<tr class="admin-empty-row"><td colspan="4">No advertiser actions in this range.</td></tr>';
    }

    function renderRecent(rows) {
        const tbody = document.getElementById('recent-actions');
        const values = rows || [];
        tbody.innerHTML = values.length ? values.map((row) => `<tr><td data-label="Date">${escape(String(row.eventDate || '').slice(0, 10) || 'Unknown')}</td><td data-label="Advertiser">${escape(row.advertiser || 'Unknown')}</td><td data-label="Status">${escape(row.validationStatus || row.status || 'Unknown')}${row.corrected ? ' · corrected' : ''}</td><td data-label="Sale">${money(row.saleAmountUsd)}</td><td data-label="Commission">${money(row.commissionUsd)}</td><td data-label="Country">${escape(row.country || '—')}</td></tr>`).join('') : '<tr class="admin-empty-row"><td colspan="6">No recent commission actions.</td></tr>';
    }

    function renderSync(rows) {
        const target = document.getElementById('sync-status');
        const values = rows || [];
        target.innerHTML = values.length ? values.map((row) => `<div class="sync-row"><strong>${escape(String(row.source || '').replace(/-/g, ' '))}</strong><span>${integer(row.record_count)} records</span><small>${escape(dateTime(row.last_success_at))}</small><small class="${row.last_error ? 'is-error' : ''}">${escape(row.last_error || 'Healthy')}</small></div>`).join('') : '<p class="admin-empty">No scheduled sync status has been recorded yet.</p>';
    }

    async function loadSummary() {
        const button = document.getElementById('refresh-report');
        button.disabled = true;
        button.textContent = 'Refreshing…';
        try {
            const days = range.value;
            const data = await request(`/api/admin/cj/summary?days=${encodeURIComponent(days)}`);
            accessState.hidden = true;
            dashboard.hidden = false;
            renderMetrics(data);
            renderChart(data.commissions?.byDay, days);
            renderLocalHealth(data.local);
            renderAdvertiserPerformance(data.commissions?.byAdvertiser);
            renderRecent(data.commissions?.recent);
            renderSync(data.sync);
            document.getElementById('admin-updated').textContent = `Updated ${dateTime(new Date().toISOString())}`;
            if (data.commissions?.pagination?.truncated) {
                showNotice(`The CJ report reached its ${data.commissions.pagination.pagesFetched}-page safety limit. Narrow the date range for complete totals.`);
            }
        } catch (error) {
            showAccessError(error);
        } finally {
            button.disabled = false;
            button.textContent = 'Refresh report';
        }
    }

    function renderTerms(data) {
        const target = document.getElementById('terms-content');
        const contracts = Array.isArray(data.resultList) ? data.resultList : [];
        if (!contracts.length) {
            target.innerHTML = '<p class="admin-empty">No program terms were returned for joined advertisers.</p>';
            return;
        }
        target.innerHTML = contracts.map((contract) => {
            const program = contract.programTerms || {};
            const actionTerms = Array.isArray(program.actionTerms) ? program.actionTerms : program.actionTerms ? [program.actionTerms] : [];
            const actions = actionTerms.map((action) => {
                const commissions = Array.isArray(action.commissions) ? action.commissions : action.commissions ? [action.commissions] : [];
                const incentives = Array.isArray(action.performanceIncentives) ? action.performanceIncentives : action.performanceIncentives ? [action.performanceIncentives] : [];
                const rateText = commissions.map((commission) => {
                    const rate = commission.rate || {};
                    const situation = commission.situation?.name ? ` · ${commission.situation.name}` : '';
                    return `${rate.value ?? '—'} ${rate.type || ''}${rate.currency ? ` ${rate.currency}` : ''}${situation}`.trim();
                }).join(', ') || 'Not listed';
                const itemLists = commissions.map((commission) => commission.itemList).filter((item) => item?.id);
                const itemListMarkup = itemLists.length
                    ? itemLists.map((item) => `<button type="button" class="admin-item-list-button" data-item-list-id="${escape(item.id)}">${escape(item.name || item.id)}</button>`).join('')
                    : 'None';
                return `<dl><div><dt>Tracker</dt><dd>${escape(action.actionTracker?.name || 'Unnamed')}</dd></div><div><dt>Referral period</dt><dd>${escape(action.referralPeriod ?? 'Not listed')}</dd></div><div><dt>Locking</dt><dd>${escape(`${action.lockingMethod?.type || 'Not listed'}${action.lockingMethod?.durationInDays ? ` · ${action.lockingMethod.durationInDays} days` : ''}`)}</dd></div><div><dt>Commission</dt><dd>${escape(rateText)}</dd></div><div><dt>Item lists</dt><dd>${itemListMarkup}</dd></div><div><dt>Incentives</dt><dd>${escape(incentives.length ? `${incentives.length} tier(s)` : 'None listed')}</dd></div></dl>`;
            }).join('');
            return `<details class="term-card"><summary><strong>${escape(program.name || `Advertiser ${contract.advertiserId}`)}</strong><span>${escape(contract.status || 'Unknown')} · ${escape(contract.startTime ? String(contract.startTime).slice(0, 10) : 'No start date')}</span></summary><div class="term-body">${actions || '<p class="admin-empty">No action terms returned.</p>'}</div></details>`;
        }).join('');
    }

    async function loadTerms() {
        const button = document.getElementById('load-terms');
        button.disabled = true;
        button.textContent = 'Loading…';
        try {
            const data = await request('/api/admin/cj/program-terms');
            renderTerms(data);
            termsLoaded = true;
        } catch (error) {
            document.getElementById('terms-content').innerHTML = `<p class="admin-empty">${escape(error.message)}</p>`;
        } finally {
            button.disabled = false;
            button.textContent = termsLoaded ? 'Reload terms' : 'Load program terms';
        }
    }

    function renderAdvertiserDiagnostics(data) {
        const tbody = document.getElementById('advertiser-diagnostics');
        const advertisers = Array.isArray(data.advertisers) ? data.advertisers : [];
        tbody.innerHTML = advertisers.length ? advertisers.map((advertiser) => `<tr><td>${escape(advertiser.name)}</td><td>${escape(advertiser.relationshipStatus || 'Unknown')}</td><td>${escape(advertiser.category?.child || advertiser.category?.parent || '—')}</td><td>${money(advertiser.sevenDayEpc)}</td><td>${money(advertiser.threeMonthEpc)}</td><td>${advertiser.mobileTrackingCertified ? 'Certified' : advertiser.mobileSupported ? 'Supported' : 'Not listed'}</td></tr>`).join('') : '<tr class="admin-empty-row"><td colspan="6">No joined advertisers were returned.</td></tr>';
    }

    async function loadAdvertisers() {
        const button = document.getElementById('load-advertisers');
        button.disabled = true;
        button.textContent = 'Loading…';
        try {
            const data = await request('/api/admin/cj/advertisers');
            renderAdvertiserDiagnostics(data);
            advertisersLoaded = true;
        } catch (error) {
            document.getElementById('advertiser-diagnostics').innerHTML = `<tr class="admin-empty-row"><td colspan="6">${escape(error.message)}</td></tr>`;
        } finally {
            button.disabled = false;
            button.textContent = advertisersLoaded ? 'Reload advertisers' : 'Load advertisers';
        }
    }

    async function loadItemList(itemListId) {
        const dialog = document.getElementById('item-list-dialog');
        const content = document.getElementById('item-list-content');
        content.innerHTML = '<p class="admin-empty">Loading item list…</p>';
        dialog.showModal();
        try {
            const data = await request(`/api/admin/cj/item-list?id=${encodeURIComponent(itemListId)}`);
            const list = data.itemList || {};
            const records = Array.isArray(list.items?.records) ? list.items.records : [];
            document.getElementById('item-list-title').textContent = list.name || 'Item list';
            content.innerHTML = records.length
                ? `<div class="admin-table-wrap" tabindex="0" aria-label="Commission item list"><table><thead><tr><th>Item</th><th>SKU</th></tr></thead><tbody>${records.map((item) => `<tr><td>${escape(item.name || 'Unnamed item')}</td><td>${escape(item.sku || '—')}</td></tr>`).join('')}</tbody></table></div>${list.items?.nextPage ? '<p class="admin-empty">More items are available from CJ; this view shows the first page.</p>' : ''}`
                : '<p class="admin-empty">This item list contains no returned records.</p>';
        } catch (error) {
            content.innerHTML = `<p class="admin-empty">${escape(error.message)}</p>`;
        }
    }

    async function syncCJ() {
        const button = document.getElementById('sync-cj');
        button.disabled = true;
        button.textContent = 'Syncing…';
        try {
            await request('/api/admin/cj/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            showNotice('CJ advertiser and promotion reference data synced.');
            await loadSummary();
        } catch (error) {
            showNotice(error.message || 'CJ sync failed.');
        } finally {
            button.disabled = false;
            button.textContent = 'Sync reference data';
        }
    }

    function switchTab(tab) {
        document.querySelectorAll('[data-admin-tab]').forEach((button) => {
            const active = button.dataset.adminTab === tab;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', String(active));
            button.tabIndex = active ? 0 : -1;
        });
        document.querySelectorAll('[data-admin-panel]').forEach((panel) => {
            const active = panel.dataset.adminPanel === tab;
            panel.hidden = !active;
            panel.classList.toggle('is-active', active);
        });
        if (tab === 'terms' && !termsLoaded) loadTerms();
        if (tab === 'advertisers' && !advertisersLoaded) loadAdvertisers();
    }

    const tabButtons = [...document.querySelectorAll('[data-admin-tab]')];
    tabButtons.forEach((button, index) => {
        button.addEventListener('click', () => switchTab(button.dataset.adminTab));
        button.addEventListener('keydown', (event) => {
            let nextIndex = null;
            if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabButtons.length;
            if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = tabButtons.length - 1;
            if (nextIndex === null) return;
            event.preventDefault();
            const next = tabButtons[nextIndex];
            switchTab(next.dataset.adminTab);
            next.focus();
        });
    });
    document.getElementById('refresh-report').addEventListener('click', loadSummary);
    range.addEventListener('change', loadSummary);
    document.getElementById('sync-cj').addEventListener('click', syncCJ);
    document.getElementById('load-terms').addEventListener('click', loadTerms);
    document.getElementById('load-advertisers').addEventListener('click', loadAdvertisers);
    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-item-list-id]');
        if (button) loadItemList(button.dataset.itemListId);
    });
    const itemListDialog = document.getElementById('item-list-dialog');
    document.getElementById('close-item-list').addEventListener('click', () => itemListDialog.close());
    itemListDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        itemListDialog.close();
    });

    loadSummary();
})();
