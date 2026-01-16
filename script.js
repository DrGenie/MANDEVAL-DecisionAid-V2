
(function(){
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const STORAGE_SCENARIOS = 'MANDEVAL_SCENARIOS';
  const STORAGE_SETTINGS = 'MANDEVAL_SETTINGS';

  const state = {
    settings: {
      horizon: '1 year',
      currencyLabel: 'local currency units',
      vslScheme: 'vsl',
      vslValue: 0
    },
    config: null,
    costs: null,
    scenarios: [],
    charts: {
      mrsChart: null
    }
  };

  /* Mixed logit mean coefficients for each country and outbreak scenario
     Order is: Australia mild, Australia severe, Italy mild, Italy severe, France mild, France severe
  */
  const mxlCoefs = {
    AU: {
      mild: {
        ascPolicyA: 0.464,
        ascOptOut: -0.572,
        scopeAll: -0.319,
        exMedRel: -0.157,
        exMedRelPers: -0.267,
        cov70: 0.171,
        cov90: 0.158,
        lives: 0.072
      },
      severe: {
        ascPolicyA: 0.535,
        ascOptOut: -0.694,
        scopeAll: 0.190,
        exMedRel: -0.181,
        exMedRelPers: -0.305,
        cov70: 0.371,
        cov90: 0.398,
        lives: 0.079
      }
    },
    IT: {
      mild: {
        ascPolicyA: 0.625,
        ascOptOut: -0.238,
        scopeAll: -0.276,
        exMedRel: -0.176,
        exMedRelPers: -0.289,
        cov70: 0.185,
        cov90: 0.148,
        lives: 0.039
      },
      severe: {
        ascPolicyA: 0.799,
        ascOptOut: -0.463,
        scopeAll: 0.174,
        exMedRel: -0.178,
        exMedRelPers: -0.207,
        cov70: 0.305,
        cov90: 0.515,
        lives: 0.045
      }
    },
    FR: {
      mild: {
        ascPolicyA: 0.899,
        ascOptOut: 0.307,
        scopeAll: -0.160,
        exMedRel: -0.121,
        exMedRelPers: -0.124,
        cov70: 0.232,
        cov90: 0.264,
        lives: 0.049
      },
      severe: {
        ascPolicyA: 0.884,
        ascOptOut: 0.083,
        scopeAll: -0.019,
        exMedRel: -0.192,
        exMedRelPers: -0.247,
        cov70: 0.267,
        cov90: 0.398,
        lives: 0.052
      }
    }
  };

  /* Helpers */

  function showToast(message, type){
    const container = $('#toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type === 'success' ? 'toast-success' : type === 'warning' ? 'toast-warning' : 'toast-error');
    toast.innerHTML = `
      <span>${escapeHtml(message)}</span>
      <button type="button" aria-label="Dismiss">&times;</button>
    `;
    container.appendChild(toast);
    const btn = toast.querySelector('button');
    btn.addEventListener('click', () => {
      container.removeChild(toast);
    });
    setTimeout(() => {
      if (toast.parentElement === container){
        container.removeChild(toast);
      }
    }, 4500);
  }

  function escapeHtml(str){
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMoney(value){
    if (value == null || isNaN(value)) return '–';
    const v = Number(value);
    if (!isFinite(v)) return '–';
    const abs = Math.abs(v);
    let fmt = v.toFixed(0);
    if (abs >= 1e9){
      fmt = (v / 1e9).toFixed(2) + ' bn';
    } else if (abs >= 1e6){
      fmt = (v / 1e6).toFixed(2) + ' m';
    } else if (abs >= 1e3){
      fmt = (v / 1e3).toFixed(1) + ' k';
    }
    return fmt;
  }

  function formatPercent(value){
    if (value == null || isNaN(value)) return '–';
    const v = Number(value);
    return v.toFixed(1) + '%';
  }

  function countryLabel(code){
    if (code === 'AU') return 'Australia';
    if (code === 'FR') return 'France';
    if (code === 'IT') return 'Italy';
    return 'Not set';
  }

  function outbreakLabel(code){
    return code === 'severe' ? 'Severe outbreak' : 'Mild outbreak';
  }

  function scopeLabel(code){
    return code === 'all'
      ? 'All occupations and public spaces'
      : 'High-risk occupations only';
  }

  function exemptionsLabel(code){
    if (code === 'medrel') return 'Medical + religious';
    if (code === 'medrelpers') return 'Medical + religious + personal belief';
    return 'Medical only';
  }

  function coverageLabel(value){
    const pct = Number(value) * 100;
    return pct.toFixed(0) + '% vaccinated';
  }

  function saveSettingsToState(){
    const horizon = $('#setting-horizon').value || '1 year';
    const currencyLabel = $('#setting-currency').value || 'local currency units';
    const vslScheme = $('#setting-vsl-scheme').value || 'vsl';
    const vslValue = Number($('#setting-vsl-value').value) || 0;

    state.settings = { horizon, currencyLabel, vslScheme, vslValue };
    persistSettings();
    showToast('Settings updated.', 'success');
    updateDerivedAndUI();
  }

  function persistSettings(){
    try {
      localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(state.settings));
    } catch(e){
      // ignore
    }
  }

  function loadSettings(){
    try {
      const raw = localStorage.getItem(STORAGE_SETTINGS);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (!obj) return;
      state.settings = Object.assign({}, state.settings, obj);
    } catch(e){
      // ignore parse error
    }
  }

  function syncSettingsForm(){
    $('#setting-horizon').value = state.settings.horizon || '1 year';
    $('#setting-currency').value = state.settings.currencyLabel || 'local currency units';
    $('#setting-vsl-scheme').value = state.settings.vslScheme || 'vsl';
    $('#setting-vsl-value').value = state.settings.vslValue != null ? state.settings.vslValue : 0;
  }

  function applyConfigFromForm(){
    const country = $('#cfg-country').value;
    const outbreak = $('#cfg-outbreak').value;
    const scope = $('#cfg-scope').value;
    const exemptions = $('#cfg-exemptions').value;
    const coverage = parseFloat($('#cfg-coverage').value || '0.5');
    const popMillions = Number($('#cfg-pop').value) || 0;
    const livesPer100k = Number($('#cfg-lives').value) || 0;

    if (!country){
      showToast('Please select a country.', 'warning');
      return;
    }
    if (!mxlCoefs[country] || !mxlCoefs[country][outbreak]){
      showToast('No preference estimates found for this country and outbreak scenario.', 'error');
      return;
    }

    state.config = {
      country,
      outbreak,
      scope,
      exemptions,
      coverage,
      popMillions,
      livesPer100k
    };

    updateConfigSummary();
    updateDerivedAndUI();
    showToast('Configuration applied.', 'success');
  }

  function updateConfigSummary(){
    const empty = $('#cfg-summary-empty');
    const panel = $('#cfg-summary-panel');

    if (!state.config){
      if (empty) empty.hidden = false;
      if (panel) panel.hidden = true;
      $('#headline-text').textContent =
        'Apply a configuration to see a concise recommendation that combines predicted public support, mandate design features, indicative costs, benefits and expected public support.';
      return;
    }

    const c = state.config;
    if (empty) empty.hidden = true;
    if (panel) panel.hidden = false;

    $('#cfg-summary-country').textContent = countryLabel(c.country);
    $('#cfg-summary-outbreak').textContent = outbreakLabel(c.outbreak);
    $('#cfg-summary-pop').textContent = c.popMillions.toFixed(1) + ' million';
    $('#cfg-summary-scope').textContent = scopeLabel(c.scope);
    $('#cfg-summary-exemptions').textContent = exemptionsLabel(c.exemptions);
    $('#cfg-summary-coverage').textContent = coverageLabel(c.coverage);
    $('#cfg-summary-lives').textContent = c.livesPer100k.toFixed(1) + ' per 100,000';

    const support = computeSupportFromMXL(c);
    if (!isNaN(support)){
      $('#cfg-summary-support').textContent = formatPercent(support * 100);
    } else {
      $('#cfg-summary-support').textContent = '–';
    }

    updateHeadlineRecommendation(support);
  }

  function computeSupportFromMXL(cfg){
    if (!cfg || !cfg.country || !cfg.outbreak) return NaN;
    const countryCoefs = mxlCoefs[cfg.country];
    if (!countryCoefs) return NaN;
    const p = countryCoefs[cfg.outbreak];
    if (!p) return NaN;

    // Construct Xβ term shared by both mandate alternatives
    let xb = 0;
    if (cfg.scope === 'all') xb += p.scopeAll;
    if (cfg.exemptions === 'medrel') xb += p.exMedRel;
    else if (cfg.exemptions === 'medrelpers') xb += p.exMedRelPers;

    if (Math.abs(cfg.coverage - 0.7) < 1e-6) xb += p.cov70;
    else if (Math.abs(cfg.coverage - 0.9) < 1e-6) xb += p.cov90;

    xb += p.lives * cfg.livesPer100k;

    const uA = p.ascPolicyA + xb;
    const uB = xb; // Policy B as reference with same attributes
    const uN = p.ascOptOut; // no-mandate alternative

    const maxU = Math.max(uA, uB, uN);
    const expA = Math.exp(uA - maxU);
    const expB = Math.exp(uB - maxU);
    const expN = Math.exp(uN - maxU);
    const denom = expA + expB + expN;
    if (denom === 0 || !isFinite(denom)) return NaN;

    const probMandate = (expA + expB) / denom;
    return probMandate;
  }

  function updateHeadlineRecommendation(support){
    const p = $('#headline-text');
    if (!p || !state.config) return;

    const derived = computeDerived();
    const bcr = derived ? derived.bcr : null;
    const supPct = !isNaN(support) ? support * 100 : NaN;

    let text = '';

    if (derived && bcr != null && !isNaN(supPct)){
      if (bcr >= 1 && supPct >= 70){
        text =
          'This mandate design appears both cost-effective (benefit–cost ratio above 1) and likely to attract high public support. ' +
          'It can be considered a strong candidate, subject to operational feasibility and equity considerations.';
      } else if (bcr >= 1 && supPct < 70){
        text =
          'This mandate design appears cost-effective (benefit–cost ratio above 1) but model-based support is moderate. ' +
          'Additional communication, engagement, or targeted adjustments may be needed for stable implementation.';
      } else if (bcr < 1 && supPct >= 70){
        text =
          'This mandate design is predicted to receive relatively high public support but does not appear cost-effective under current cost and benefit assumptions. ' +
          'Revisiting cost estimates, targeting, or alternative designs may improve value for money.';
      } else {
        text =
          'Under current assumptions, this mandate design is neither clearly cost-effective nor strongly supported. ' +
          'It may be better used as a reference scenario while more promising options are explored.';
      }
    } else {
      text =
        'Apply a configuration and enter cost and benefit settings to receive a concise recommendation that combines predicted public support, mandate design features, costs and benefits.';
    }

    p.textContent = text;
  }

  function applyCostsFromForm(){
    if (!state.config){
      showToast('Please apply a configuration before entering costs.', 'warning');
      return;
    }
    const admin = Number($('#cost-admin').value) || 0;
    const comm = Number($('#cost-comm').value) || 0;
    const enforce = Number($('#cost-enforce').value) || 0;
    const it = Number($('#cost-it').value) || 0;
    const support = Number($('#cost-support').value) || 0;
    const total = admin + comm + enforce + it + support;

    state.costs = { admin, comm, enforce, it, support, total };

    updateCostSummary();
    updateDerivedAndUI();
    showToast('Costs applied.', 'success');
  }

  function updateCostSummary(){
    if (!state.costs || !state.config){
      $('#cost-total').textContent = '–';
      $('#cost-per-100k').textContent = '–';
      $('#cost-per-1m').textContent = '–';
      return;
    }
    const total = state.costs.total;
    const pop = state.config.popMillions || 0;
    const perPerson = pop > 0 ? total / (pop * 1e6) : NaN;
    const per100k = perPerson * 1e5;
    const per1m = perPerson * 1e6;

    $('#cost-total').textContent = formatMoney(total) + ' ' + state.settings.currencyLabel;
    $('#cost-per-100k').textContent = isNaN(per100k) ? '–' : formatMoney(per100k) + ' ' + state.settings.currencyLabel;
    $('#cost-per-1m').textContent = isNaN(per1m) ? '–' : formatMoney(per1m) + ' ' + state.settings.currencyLabel;
  }

  function computeDerived(){
    if (!state.config) return null;
    const cfg = state.config;
    const settings = state.settings || {};

    const pop = cfg.popMillions || 0;
    const livesPer100k = cfg.livesPer100k || 0;
    const livesTotal = livesPer100k * (pop * 10); // 10 × 100k blocks per million people

    const vsl = Number(settings.vslValue) || 0;
    const totalBenefit = livesTotal * vsl;

    const totalCost = state.costs ? (state.costs.total || 0) : 0;
    const netBenefit = totalBenefit - totalCost;
    const bcr = totalCost > 0 ? (totalBenefit / totalCost) : null;

    const support = computeSupportFromMXL(cfg);

    return {
      livesTotal,
      totalBenefit,
      netBenefit,
      bcr,
      support
    };
  }

  function updateResultsSummary(){
    const derived = computeDerived();
    if (!derived){
      $('#result-bcr').textContent = '–';
      $('#result-net-benefit').textContent = '–';
      $('#result-support').textContent = '–';
      $('#result-lives-total').textContent = '–';
      return;
    }

    if (derived.bcr != null && isFinite(derived.bcr)){
      $('#result-bcr').textContent = derived.bcr.toFixed(2);
    } else {
      $('#result-bcr').textContent = '–';
    }
    $('#result-net-benefit').textContent = formatMoney(derived.netBenefit) + ' ' + state.settings.currencyLabel;
    $('#result-support').textContent = !isNaN(derived.support) ? formatPercent(derived.support * 100) : '–';
    $('#result-lives-total').textContent = derived.livesTotal.toFixed(1);
  }

  function computeMRSRows(){
    if (!state.config) return [];
    const cfg = state.config;
    const countryCoefs = mxlCoefs[cfg.country];
    if (!countryCoefs) return [];
    const p = countryCoefs[cfg.outbreak];
    if (!p || !p.lives) return [];

    const rows = [];

    if (cfg.scope === 'all'){
      const value = -p.scopeAll / p.lives;
      rows.push({
        label: 'Scope: high-risk occupations → all occupations and public spaces',
        value
      });
    }

    if (cfg.exemptions === 'medrel'){
      const value = -p.exMedRel / p.lives;
      rows.push({
        label: 'Exemptions: medical only → medical + religious',
        value
      });
    } else if (cfg.exemptions === 'medrelpers'){
      const value = -p.exMedRelPers / p.lives;
      rows.push({
        label: 'Exemptions: medical only → medical + religious + personal belief',
        value
      });
    }

    if (Math.abs(cfg.coverage - 0.7) < 1e-6){
      const value = -p.cov70 / p.lives;
      rows.push({
        label: 'Coverage threshold: 50% → 70% population vaccinated',
        value
      });
    } else if (Math.abs(cfg.coverage - 0.9) < 1e-6){
      const value = -p.cov90 / p.lives;
      rows.push({
        label: 'Coverage threshold: 50% → 90% population vaccinated',
        value
      });
    }

    return rows;
  }

  function updateMRSSection(){
    const tbody = $('#mrs-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const rows = computeMRSRows();
    if (!rows.length){
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      tr.innerHTML = '<td colspan="3">Apply a configuration to see lives-saved equivalents for the chosen design.</td>';
      tbody.appendChild(tr);
      if (state.charts.mrsChart){
        state.charts.mrsChart.destroy();
        state.charts.mrsChart = null;
      }
      return;
    }

    rows.forEach(r => {
      const tr = document.createElement('tr');
      let interpretation = '';
      if (r.value > 0){
        interpretation =
          'This change reduces utility by an amount equivalent to losing approximately ' +
          Math.abs(r.value).toFixed(2) + ' expected lives saved per 100,000 people.';
      } else if (r.value < 0){
        interpretation =
          'This change increases utility by an amount equivalent to gaining approximately ' +
          Math.abs(r.value).toFixed(2) + ' expected lives saved per 100,000 people.';
      } else {
        interpretation = 'No change relative to the reference level for this attribute in the model.';
      }
      tr.innerHTML = `
        <td>${escapeHtml(r.label)}</td>
        <td>${r.value.toFixed(2)}</td>
        <td>${escapeHtml(interpretation)}</td>
      `;
      tbody.appendChild(tr);
    });

    updateMRSChart(rows);
  }

  function updateMRSChart(rows){
    const ctx = $('#mrsChart');
    if (!ctx) return;

    const labels = rows.map(r => r.label);
    const data = rows.map(r => r.value);

    if (state.charts.mrsChart){
      state.charts.mrsChart.destroy();
      state.charts.mrsChart = null;
    }

    state.charts.mrsChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'MRS (lives saved per 100,000)',
          data,
          backgroundColor: data.map(v => v >= 0 ? 'rgba(220, 38, 38, 0.8)' : 'rgba(22, 163, 74, 0.8)')
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(ctx){
                return ctx.parsed.y.toFixed(2) + ' lives per 100,000';
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              display: false
            }
          },
          y: {
            title: {
              display: true,
              text: 'Lives saved per 100,000'
            }
          }
        }
      }
    });
  }

  function saveScenario(){
    if (!state.config){
      showToast('Please apply a configuration first.', 'warning');
      return;
    }
    if (!state.costs){
      showToast('Please apply costs before saving a scenario.', 'warning');
      return;
    }

    const derived = computeDerived();
    if (!derived){
      showToast('Unable to compute derived results for this configuration.', 'error');
      return;
    }

    const id = Date.now();
    const cfg = state.config;
    const s = {
      id,
      label: countryLabel(cfg.country) + ' – ' + outbreakLabel(cfg.outbreak) +
        ' – ' + (cfg.livesPer100k.toFixed(0)) + ' lives/100k',
      country: cfg.country,
      outbreak: cfg.outbreak,
      scope: cfg.scope,
      exemptions: cfg.exemptions,
      coverage: cfg.coverage,
      popMillions: cfg.popMillions,
      livesPer100k: cfg.livesPer100k,
      totalCost: state.costs.total || 0,
      livesTotal: derived.livesTotal,
      totalBenefit: derived.totalBenefit,
      netBenefit: derived.netBenefit,
      bcr: derived.bcr,
      support: derived.support,
      settings: Object.assign({}, state.settings)
    };

    state.scenarios.push(s);
    persistScenarios();
    rebuildScenariosTable();
    rebuildResultsTable();
    showToast('Scenario saved.', 'success');
  }

  function persistScenarios(){
    try {
      localStorage.setItem(STORAGE_SCENARIOS, JSON.stringify(state.scenarios));
    } catch(e){
      // ignore
    }
  }

  function loadScenarios(){
    try {
      const raw = localStorage.getItem(STORAGE_SCENARIOS);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)){
        state.scenarios = arr;
      }
    } catch(e){
      // ignore
    }
  }

  function rebuildScenariosTable(){
    const tbody = $('#scenarios-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!state.scenarios.length){
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      tr.innerHTML = '<td colspan="10">No scenarios saved yet.</td>';
      tbody.appendChild(tr);
      return;
    }

    state.scenarios.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(s.label)}</td>
        <td>${escapeHtml(countryLabel(s.country))}</td>
        <td>${escapeHtml(outbreakLabel(s.outbreak))}</td>
        <td>${escapeHtml(scopeLabel(s.scope))}</td>
        <td>${escapeHtml(exemptionsLabel(s.exemptions))}</td>
        <td>${escapeHtml(coverageLabel(s.coverage))}</td>
        <td>${s.bcr != null ? s.bcr.toFixed(2) : '–'}</td>
        <td>${formatMoney(s.netBenefit)} ${escapeHtml(state.settings.currencyLabel)}</td>
        <td>${!isNaN(s.support) ? formatPercent(s.support * 100) : '–'}</td>
        <td><button type="button" class="btn-ghost btn-remove-scenario" data-id="${s.id}">Remove</button></td>
      `;
      tbody.appendChild(tr);
    });

    $$('.btn-remove-scenario').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-id'));
        state.scenarios = state.scenarios.filter(s => s.id !== id);
        persistScenarios();
        rebuildScenariosTable();
        rebuildResultsTable();
        showToast('Scenario removed.', 'success');
      });
    });
  }

  function rebuildResultsTable(){
    const tbody = $('#results-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!state.scenarios.length){
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      tr.innerHTML = '<td colspan="10">No saved scenarios yet. Configure a mandate and click <strong>Save scenario</strong>.</td>';
      tbody.appendChild(tr);
      return;
    }

    const ranked = state.scenarios.slice().sort((a, b) => {
      const bcrA = a.bcr != null ? a.bcr : -Infinity;
      const bcrB = b.bcr != null ? b.bcr : -Infinity;
      if (bcrB !== bcrA) return bcrB - bcrA;
      const supA = !isNaN(a.support) ? a.support : -Infinity;
      const supB = !isNaN(b.support) ? b.support : -Infinity;
      return supB - supA;
    });

    ranked.forEach((s, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${escapeHtml(s.label)}</td>
        <td>${escapeHtml(countryLabel(s.country))}</td>
        <td>${escapeHtml(outbreakLabel(s.outbreak))}</td>
        <td>${escapeHtml(scopeLabel(s.scope))}</td>
        <td>${escapeHtml(exemptionsLabel(s.exemptions))}</td>
        <td>${escapeHtml(coverageLabel(s.coverage))}</td>
        <td>${s.bcr != null ? s.bcr.toFixed(2) : '–'}</td>
        <td>${formatMoney(s.netBenefit)} ${escapeHtml(state.settings.currencyLabel)}</td>
        <td>${!isNaN(s.support) ? formatPercent(s.support * 100) : '–'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function updateBriefingText(){
    const area = $('#briefing-text');
    if (!area) return;

    if (!state.config){
      area.value = 'Configure a mandate scenario and apply costs to generate briefing text.';
      return;
    }

    const cfg = state.config;
    const settings = state.settings;
    const derived = computeDerived();

    const currency = settings.currencyLabel || 'local currency units';
    const horizon = settings.horizon || '1 year';

    const parts = [];

    parts.push(
      `Context: ${countryLabel(cfg.country)} under a ${outbreakLabel(cfg.outbreak).toLowerCase()} scenario ` +
      `over a ${horizon} horizon.`
    );
    parts.push(
      `Mandate design: scope is ${scopeLabel(cfg.scope).toLowerCase()}, with ${exemptionsLabel(cfg.exemptions).toLowerCase()} ` +
      `exemptions and the mandate lifted once ${coverageLabel(cfg.coverage)} is reached.`
    );
    parts.push(
      `Epidemiological impact: the mandate is assumed to save about ${cfg.livesPer100k.toFixed(1)} lives per 100,000 people, ` +
      `which translates to approximately ${derived ? derived.livesTotal.toFixed(1) : '–'} lives saved in the population ` +
      `covered (${cfg.popMillions.toFixed(1)} million people).`
    );

    if (derived){
      parts.push(
        `Cost–benefit: under current settings, total implementation cost is estimated at ` +
        `${formatMoney(state.costs ? state.costs.total : 0)} ${currency}. The monetary value of lives saved is ` +
        `${formatMoney(derived.totalBenefit)} ${currency}, giving a benefit–cost ratio of ` +
        `${derived.bcr != null && isFinite(derived.bcr) ? derived.bcr.toFixed(2) : 'not yet defined'}.`
      );
      if (!isNaN(derived.support)){
        parts.push(
          `Public support: based on the mixed logit estimates, the predicted probability that members of the public ` +
          `choose a mandate like this over no mandate is about ${formatPercent(derived.support * 100)}.`
        );
      }
    }

    if (state.scenarios.length){
      const ranked = state.scenarios.slice().sort((a, b) => {
        const bcrA = a.bcr != null ? a.bcr : -Infinity;
        const bcrB = b.bcr != null ? b.bcr : -Infinity;
        if (bcrB !== bcrA) return bcrB - bcrA;
        const supA = !isNaN(a.support) ? a.support : -Infinity;
        const supB = !isNaN(b.support) ? b.support : -Infinity;
        return supB - supA;
      }).slice(0, 3);

      if (ranked.length){
        parts.push('Top candidate mandate options (by benefit–cost ratio and support):');
        ranked.forEach((s, idx) => {
          parts.push(
            `${idx + 1}. ${countryLabel(s.country)}, ${outbreakLabel(s.outbreak).toLowerCase()}, ` +
            `${scopeLabel(s.scope).toLowerCase()}, ${exemptionsLabel(s.exemptions).toLowerCase()}, ` +
            `${coverageLabel(s.coverage)}, BCR ${s.bcr != null ? s.bcr.toFixed(2) : '–'}, ` +
            `predicted support ${!isNaN(s.support) ? formatPercent(s.support * 100) : '–'}.`
          );
        });
      }
    }

    area.value = parts.join('\n\n');
  }

  function buildAiPrompt(){
    const settings = state.settings;
    const cfg = state.config;
    const derived = computeDerived();

    const lines = [];
    lines.push('You are assisting a public health policy team that is evaluating COVID-19 vaccine mandates.');
    lines.push('');
    if (cfg){
      lines.push('CURRENT MANDATE CONFIGURATION');
      lines.push(`- Country: ${countryLabel(cfg.country)}`);
      lines.push(`- Outbreak scenario: ${outbreakLabel(cfg.outbreak)}`);
      lines.push(`- Scope: ${scopeLabel(cfg.scope)}`);
      lines.push(`- Exemption policy: ${exemptionsLabel(cfg.exemptions)}`);
      lines.push(`- Coverage threshold to lift mandate: ${coverageLabel(cfg.coverage)}`);
      lines.push(`- Population covered: ${cfg.popMillions.toFixed(1)} million people`);
      lines.push(`- Expected lives saved: ${cfg.livesPer100k.toFixed(1)} per 100,000 people`);
    }
    lines.push('');
    lines.push('SETTINGS');
    lines.push(`- Analysis horizon: ${settings.horizon}`);
    lines.push(`- Currency label: ${settings.currencyLabel}`);
    lines.push(`- Measure for value per life saved: ${settings.vslScheme}`);
    lines.push(`- Value per life saved: ${settings.vslValue}`);
    lines.push('');
    if (derived){
      lines.push('COST–BENEFIT SUMMARY FOR CURRENT CONFIGURATION');
      lines.push(`- Total implementation cost: ${formatMoney(state.costs ? state.costs.total : 0)} ${settings.currencyLabel}`);
      lines.push(`- Estimated total lives saved: ${derived.livesTotal.toFixed(1)}`);
      lines.push(`- Monetary benefit of lives saved: ${formatMoney(derived.totalBenefit)} ${settings.currencyLabel}`);
      lines.push(`- Benefit–cost ratio (BCR): ${derived.bcr != null && isFinite(derived.bcr) ? derived.bcr.toFixed(2) : 'not yet defined'}`);
      if (!isNaN(derived.support)){
        lines.push(`- Predicted public support: ${formatPercent(derived.support * 100)}`);
      }
    }
    if (state.scenarios.length){
      lines.push('');
      lines.push('TOP SAVED SCENARIOS (ranked by BCR and support):');
      const ranked = state.scenarios.slice().sort((a, b) => {
        const bcrA = a.bcr != null ? a.bcr : -Infinity;
        const bcrB = b.bcr != null ? b.bcr : -Infinity;
        if (bcrB !== bcrA) return bcrB - bcrA;
        const supA = !isNaN(a.support) ? a.support : -Infinity;
        const supB = !isNaN(b.support) ? b.support : -Infinity;
        return supB - supA;
      }).slice(0, 5);
      ranked.forEach((s, idx) => {
        lines.push(
          `${idx + 1}. ${countryLabel(s.country)}, ${outbreakLabel(s.outbreak)}, ` +
          `${scopeLabel(s.scope)}, ${exemptionsLabel(s.exemptions)}, ${coverageLabel(s.coverage)}, ` +
          `BCR ${s.bcr != null ? s.bcr.toFixed(2) : '–'}, support ${!isNaN(s.support) ? formatPercent(s.support * 100) : '–'}.`
        );
      });
    }
    lines.push('');
    lines.push('TASK FOR YOU:');
    lines.push('Provide a short, clear briefing note for senior decision-makers that explains:');
    lines.push('- the mandate design and assumptions;');
    lines.push('- the expected epidemiological impact (lives saved);');
    lines.push('- the cost–benefit profile (including BCR);');
    lines.push('- the predicted level of public support; and');
    lines.push('- which scenario or scenarios appear most suitable, and why, with any important caveats.');

    return lines.join('\n');
  }

  function copyTextToClipboard(text){
    if (!navigator.clipboard){
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
      } catch(e){
        // ignore
      }
      document.body.removeChild(ta);
      return;
    }
    navigator.clipboard.writeText(text).catch(() => {
      // ignore
    });
  }

  function exportScenariosExcel(){
    if (!state.scenarios.length){
      showToast('No scenarios to export.', 'warning');
      return;
    }
    if (typeof XLSX === 'undefined'){
      showToast('Excel export library is not available in this browser.', 'error');
      return;
    }

    const rows = state.scenarios.map((s, idx) => ({
      Rank: idx + 1,
      Label: s.label,
      Country: countryLabel(s.country),
      Outbreak: outbreakLabel(s.outbreak),
      Scope: scopeLabel(s.scope),
      Exemptions: exemptionsLabel(s.exemptions),
      Coverage: coverageLabel(s.coverage),
      PopulationMillions: s.popMillions,
      LivesPer100k: s.livesPer100k,
      LivesTotal: s.livesTotal,
      TotalCost: s.totalCost,
      TotalBenefit: s.totalBenefit,
      NetBenefit: s.netBenefit,
      BCR: s.bcr,
      PredictedSupport: s.support
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Scenarios');
    XLSX.writeFile(wb, 'mandeval_scenarios.xlsx');
    showToast('Excel file downloaded.', 'success');
  }

  function exportScenariosCsv(){
    if (!state.scenarios.length){
      showToast('No scenarios to export.', 'warning');
      return;
    }
    const header = [
      'Rank','Label','Country','Outbreak','Scope','Exemptions','Coverage',
      'PopulationMillions','LivesPer100k','LivesTotal',
      'TotalCost','TotalBenefit','NetBenefit','BCR','PredictedSupport'
    ];
    const lines = [header.join(',')];
    const ranked = state.scenarios.slice().sort((a, b) => {
      const bcrA = a.bcr != null ? a.bcr : -Infinity;
      const bcrB = b.bcr != null ? b.bcr : -Infinity;
      if (bcrB !== bcrA) return bcrB - bcrA;
      const supA = !isNaN(a.support) ? a.support : -Infinity;
      const supB = !isNaN(b.support) ? b.support : -Infinity;
      return supB - supA;
    });
    ranked.forEach((s, idx) => {
      const row = [
        idx + 1,
        '"' + s.label.replace(/"/g, '""') + '"',
        '"' + countryLabel(s.country) + '"',
        '"' + outbreakLabel(s.outbreak) + '"',
        '"' + scopeLabel(s.scope) + '"',
        '"' + exemptionsLabel(s.exemptions) + '"',
        '"' + coverageLabel(s.coverage) + '"',
        s.popMillions,
        s.livesPer100k,
        s.livesTotal,
        s.totalCost,
        s.totalBenefit,
        s.netBenefit,
        s.bcr != null ? s.bcr.toFixed(4) : '',
        !isNaN(s.support) ? (s.support * 100).toFixed(2) : ''
      ];
      lines.push(row.join(','));
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mandeval_scenarios.csv';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('CSV file downloaded.', 'success');
  }

  function exportSummaryPdf(){
    if (!state.scenarios.length){
      showToast('No scenarios to export.', 'warning');
      return;
    }
    if (typeof window.jspdf === 'undefined' && typeof window.jsPDF === 'undefined'){
      showToast('PDF export library is not available in this browser.', 'error');
      return;
    }
    const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
    const doc = new jsPDF();

    const settings = state.settings;

    doc.setFontSize(14);
    doc.text('MANDEVAL – Vaccine mandate scenarios', 14, 18);
    doc.setFontSize(11);
    doc.text('Summary of saved scenarios (top ranked first)', 14, 26);

    const ranked = state.scenarios.slice().sort((a, b) => {
      const bcrA = a.bcr != null ? a.bcr : -Infinity;
      const bcrB = b.bcr != null ? b.bcr : -Infinity;
      if (bcrB !== bcrA) return bcrB - bcrA;
      const supA = !isNaN(a.support) ? a.support : -Infinity;
      const supB = !isNaN(b.support) ? b.support : -Infinity;
      return supB - supA;
    }).slice(0, 10);

    let y = 34;
    doc.setFontSize(10);
    ranked.forEach((s, idx) => {
      const line1 =
        `${idx + 1}. ${countryLabel(s.country)}, ${outbreakLabel(s.outbreak)}, ` +
        `${scopeLabel(s.scope)}, ${exemptionsLabel(s.exemptions)}, ${coverageLabel(s.coverage)}.`;
      const line2 =
        `   BCR ${s.bcr != null ? s.bcr.toFixed(2) : '–'}, net benefit ${formatMoney(s.netBenefit)} ${settings.currencyLabel}, ` +
        `predicted support ${!isNaN(s.support) ? formatPercent(s.support * 100) : '–'}.`;

      doc.text(line1, 14, y);
      y += 5;
      doc.text(line2, 14, y);
      y += 6;
      if (y > 270){
        doc.addPage();
        y = 20;
      }
    });

    doc.save('mandeval_summary.pdf');
    showToast('PDF summary downloaded.', 'success');
  }

  function exportBriefingWord(){
    const briefing = $('#briefing-text') ? $('#briefing-text').value : '';
    if (!briefing || !briefing.trim()){
      showToast('No briefing text available to export.', 'warning');
      return;
    }
    const html =
      '<html><head><meta charset="UTF-8"><title>MANDEVAL briefing</title></head><body>' +
      '<h1>MANDEVAL – Vaccine mandate briefing</h1>' +
      '<pre style="font-family:Segoe UI,system-ui,-apple-system,sans-serif;font-size:11pt;white-space:pre-wrap;">' +
      escapeHtml(briefing) +
      '</pre></body></html>';

    const blob = new Blob([html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mandeval_briefing.doc';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Word briefing downloaded.', 'success');
  }

  function clearStorage(){
    try {
      localStorage.removeItem(STORAGE_SCENARIOS);
    } catch(e){
      // ignore
    }
    state.scenarios = [];
    rebuildScenariosTable();
    rebuildResultsTable();
    showToast('Saved scenarios cleared from this browser.', 'success');
  }

  function initTabs(){
    const links = $$('.tab-link');
    const panels = $$('.tab-panel');
    links.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        links.forEach(b => b.classList.toggle('active', b === btn));
        panels.forEach(p => p.classList.toggle('active', p.id === tabId));
      });
    });
  }

  function initRangeDisplay(){
    const range = $('#cfg-lives');
    const span = $('#cfg-lives-display');
    if (!range || !span) return;
    const update = () => {
      span.textContent = Number(range.value || 0).toFixed(0);
    };
    range.addEventListener('input', update);
    update();
  }

  function updateDerivedAndUI(){
    updateConfigSummary();
    updateCostSummary();
    updateResultsSummary();
    updateMRSSection();
    updateBriefingText();
  }

  function init(){
    initTabs();
    initRangeDisplay();

    loadSettings();
    syncSettingsForm();
    loadScenarios();
    rebuildScenariosTable();
    rebuildResultsTable();
    updateDerivedAndUI();

    const btnSettings = $('#btn-save-settings');
    if (btnSettings){
      btnSettings.addEventListener('click', saveSettingsToState);
    }

    const btnApplyConfig = $('#btn-apply-config');
    if (btnApplyConfig){
      btnApplyConfig.addEventListener('click', applyConfigFromForm);
    }

    const btnSaveScenario = $('#btn-save-scenario');
    if (btnSaveScenario){
      btnSaveScenario.addEventListener('click', saveScenario);
    }

    const btnApplyCosts = $('#btn-apply-costs');
    if (btnApplyCosts){
      btnApplyCosts.addEventListener('click', applyCostsFromForm);
    }

    const btnCopyBriefing = $('#btn-copy-briefing');
    if (btnCopyBriefing){
      btnCopyBriefing.addEventListener('click', () => {
        const txt = $('#briefing-text') ? $('#briefing-text').value : '';
        if (!txt || !txt.trim()){
          showToast('No briefing text to copy yet.', 'warning');
          return;
        }
        copyTextToClipboard(txt);
        showToast('Briefing text copied to clipboard.', 'success');
      });
    }

    const btnCopilot = $('#btn-open-copilot');
    if (btnCopilot){
      btnCopilot.addEventListener('click', () => {
        const prompt = buildAiPrompt();
        copyTextToClipboard(prompt);
        window.open('https://copilot.microsoft.com/', '_blank', 'noopener');
        showToast('Prompt copied. Copilot opened in a new window.', 'success');
      });
    }

    const btnChatGPT = $('#btn-open-chatgpt');
    if (btnChatGPT){
      btnChatGPT.addEventListener('click', () => {
        const prompt = buildAiPrompt();
        copyTextToClipboard(prompt);
        window.open('https://chat.openai.com/', '_blank', 'noopener');
        showToast('Prompt copied. ChatGPT opened in a new window.', 'success');
      });
    }

    const btnExportExcel = $('#btn-export-excel');
    if (btnExportExcel){
      btnExportExcel.addEventListener('click', exportScenariosExcel);
    }

    const btnExportCsv = $('#btn-export-csv');
    if (btnExportCsv){
      btnExportCsv.addEventListener('click', exportScenariosCsv);
    }

    const btnExportPdf = $('#btn-export-pdf');
    if (btnExportPdf){
      btnExportPdf.addEventListener('click', exportSummaryPdf);
    }

    const btnExportWord = $('#btn-export-word');
    if (btnExportWord){
      btnExportWord.addEventListener('click', exportBriefingWord);
    }

    const btnClearStorage = $('#btn-clear-storage');
    if (btnClearStorage){
      btnClearStorage.addEventListener('click', clearStorage);
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
