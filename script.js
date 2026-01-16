'use strict';

/* =========================================================
   Core state
   ========================================================= */

const state = {
  settings: {
    horizonYears: 1,
    population: 1000000,
    currencyLabel: 'local currency units',
    vslMetric: 'vsl',
    vslValue: 5000000
  },
  config: null,
  costs: null,
  derived: null,
  scenarios: []
};

/* =========================================================
   Mixed logit coefficient means and SDs
   (ASC Policy A, ASC Opt-out, scope, exemptions, coverage, lives)
   Coverage coefficients corrected so that 90% ≥ 70% where appropriate.
   ========================================================= */

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

const mxlSDs = {
  AU: {
    mild: {
      ascPolicyA: 1.104,
      ascOptOut: 5.340,
      scopeAll: 1.731,
      exMedRel: 0.443,
      exMedRelPers: 1.254,
      cov70: 0.698,
      cov90: 1.689,
      lives: 0.101
    },
    severe: {
      ascPolicyA: 1.019,
      ascOptOut: 5.021,
      scopeAll: 1.756,
      exMedRel: 0.722,
      exMedRelPers: 1.252,
      cov70: 0.641,
      cov90: 1.548,
      lives: 0.103
    }
  },
  IT: {
    mild: {
      ascPolicyA: 1.560,
      ascOptOut: 4.748,
      scopeAll: 1.601,
      exMedRel: 0.718,
      exMedRelPers: 1.033,
      cov70: 0.615,
      cov90: 1.231,
      lives: 0.080
    },
    severe: {
      ascPolicyA: 1.518,
      ascOptOut: 4.194,
      scopeAll: 1.448,
      exMedRel: 0.575,
      exMedRelPers: 1.082,
      cov70: 0.745,
      cov90: 1.259,
      lives: 0.082
    }
  },
  FR: {
    mild: {
      ascPolicyA: 1.560,
      ascOptOut: 4.138,
      scopeAll: 1.258,
      exMedRel: 0.818,
      exMedRelPers: 0.972,
      cov70: 0.550,
      cov90: 1.193,
      lives: 0.081
    },
    severe: {
      ascPolicyA: 1.601,
      ascOptOut: 3.244,
      scopeAll: 1.403,
      exMedRel: 0.690,
      exMedRelPers: 1.050,
      cov70: 0.548,
      cov90: 1.145,
      lives: 0.085
    }
  }
};

const NUM_MXL_DRAWS = 1000;
const coeffNames = [
  'ascPolicyA',
  'ascOptOut',
  'scopeAll',
  'exMedRel',
  'exMedRelPers',
  'cov70',
  'cov90',
  'lives'
];

let standardNormalDraws = []; // deterministic within session
let bcrChart = null;
let supportChart = null;

/* =========================================================
   Random draws – deterministic set per session
   ========================================================= */

function randStdNormal() {
  // Box–Muller transform
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function generateStandardNormalDraws() {
  standardNormalDraws = new Array(NUM_MXL_DRAWS);
  for (let r = 0; r < NUM_MXL_DRAWS; r++) {
    const obj = {};
    coeffNames.forEach(name => {
      obj[name] = randStdNormal();
    });
    standardNormalDraws[r] = obj;
  }
}

/* =========================================================
   Predicted support from mixed logit
   ========================================================= */

function computeSupportFromMXL(config) {
  const country = config.country || 'AU';
  const outbreak = config.outbreak || 'mild';
  const countryCoefs = mxlCoefs[country];
  const countrySDs = mxlSDs[country];
  if (!countryCoefs || !countrySDs) return null;

  const mean = countryCoefs[outbreak];
  const sd = countrySDs[outbreak];
  if (!mean || !sd) return null;

  const livesPer100k = config.livesPer100k || 0;
  const scope = config.scope || 'highrisk';
  const exemptions = config.exemptions || 'medical';
  const coverage = config.coverage || 0.5;

  let probSum = 0;

  for (let r = 0; r < NUM_MXL_DRAWS; r++) {
    const z = standardNormalDraws[r];

    const beta = {
      ascPolicyA: mean.ascPolicyA + (sd.ascPolicyA || 0) * z.ascPolicyA,
      ascOptOut: mean.ascOptOut + (sd.ascOptOut || 0) * z.ascOptOut,
      scopeAll: mean.scopeAll + (sd.scopeAll || 0) * z.scopeAll,
      exMedRel: mean.exMedRel + (sd.exMedRel || 0) * z.exMedRel,
      exMedRelPers: mean.exMedRelPers + (sd.exMedRelPers || 0) * z.exMedRelPers,
      cov70: mean.cov70 + (sd.cov70 || 0) * z.cov70,
      cov90: mean.cov90 + (sd.cov90 || 0) * z.cov90,
      lives: mean.lives + (sd.lives || 0) * z.lives
    };

    let uMandate = beta.ascPolicyA;
    let uOptOut = beta.ascOptOut;

    if (scope === 'all') {
      uMandate += beta.scopeAll;
    }

    if (exemptions === 'medrel') {
      uMandate += beta.exMedRel;
    } else if (exemptions === 'medrelpers') {
      uMandate += beta.exMedRelPers;
    }

    if (coverage === 0.7) {
      uMandate += beta.cov70;
    } else if (coverage === 0.9) {
      uMandate += beta.cov90;
    }
    // 50% is baseline, so no additional term.

    uMandate += beta.lives * livesPer100k;

    // Two-alternative logit: mandate vs opt-out
    const diff = uMandate - uOptOut;
    const pMandate = 1 / (1 + Math.exp(-diff));
    probSum += pMandate;
  }

  return probSum / NUM_MXL_DRAWS;
}

/* =========================================================
   Initialisation
   ========================================================= */

function init() {
  initTabs();
  initRangeDisplay();
  initTooltips();
  generateStandardNormalDraws();
  updateSettingsFromForm();
  loadFromStorage();
  attachEventHandlers();
  updateAll();
}

document.addEventListener('DOMContentLoaded', init);

/* =========================================================
   Tabs
   ========================================================= */

function initTabs() {
  const links = document.querySelectorAll('.tab-link');
  const tabs = document.querySelectorAll('.tab-content');

  links.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      links.forEach(b => b.classList.remove('active'));
      tabs.forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(tabId).classList.add('active');
    });
  });
}

/* Range display for lives slider */

function initRangeDisplay() {
  const range = document.getElementById('cfg-lives');
  const span = document.getElementById('cfg-lives-display');
  if (!range || !span) return;

  const update = () => {
    span.textContent = range.value;
  };
  range.addEventListener('input', update);
  update();
}

/* Tooltips */

function initTooltips() {
  const tooltip = document.getElementById('globalTooltip');
  if (!tooltip) return;

  const hide = () => {
    tooltip.classList.add('tooltip-hidden');
    tooltip.textContent = '';
  };

  document.querySelectorAll('[data-tooltip]').forEach(el => {
    el.addEventListener('mouseenter', () => {
      const rect = el.getBoundingClientRect();
      tooltip.textContent = el.getAttribute('data-tooltip') || '';
      tooltip.classList.remove('tooltip-hidden');
      const top = rect.bottom + window.scrollY + 8;
      const left = rect.left + window.scrollX;
      tooltip.style.top = top + 'px';
      tooltip.style.left = left + 'px';
    });
    el.addEventListener('mouseleave', hide);
    el.addEventListener('blur', hide);
  });
}

/* =========================================================
   Storage
   ========================================================= */

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('mandeValScenarios');
    if (raw) {
      state.scenarios = JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Could not load scenarios from storage', e);
  }
}

function saveToStorage() {
  try {
    localStorage.setItem('mandeValScenarios', JSON.stringify(state.scenarios));
  } catch (e) {
    console.warn('Could not save scenarios to storage', e);
  }
}

/* =========================================================
   Event handlers
   ========================================================= */

function attachEventHandlers() {
  const btnApplySettings = document.getElementById('btn-apply-settings');
  const btnApplyConfig = document.getElementById('btn-apply-config');
  const btnSaveScenario = document.getElementById('btn-save-scenario');
  const btnApplyCosts = document.getElementById('btn-apply-costs');

  if (btnApplySettings) {
    btnApplySettings.addEventListener('click', () => {
      applySettingsFromForm();
    });
  }

  if (btnApplyConfig) {
    btnApplyConfig.addEventListener('click', () => {
      applyConfigFromForm();
      updateAll();
      showToast('Configuration applied.', 'success');
    });
  }

  if (btnSaveScenario) {
    btnSaveScenario.addEventListener('click', () => {
      saveScenario();
    });
  }

  if (btnApplyCosts) {
    btnApplyCosts.addEventListener('click', () => {
      applyCostsFromForm();
      updateAll();
      showToast('Costs applied.', 'success');
    });
  }

  const btnCopyBriefing = document.getElementById('btn-copy-briefing');
  if (btnCopyBriefing) {
    btnCopyBriefing.addEventListener('click', () => {
      copyFromTextarea('scenario-briefing-text');
    });
  }

  const btnCopyBriefingTemplate = document.getElementById('btn-copy-briefing-template');
  if (btnCopyBriefingTemplate) {
    btnCopyBriefingTemplate.addEventListener('click', () => {
      copyFromTextarea('briefing-template');
    });
  }

  const btnCopyAiPrompt = document.getElementById('btn-copy-ai-prompt');
  if (btnCopyAiPrompt) {
    btnCopyAiPrompt.addEventListener('click', () => {
      copyFromTextarea('ai-prompt');
    });
  }

  const btnOpenAi = document.getElementById('btn-open-ai');
  if (btnOpenAi) {
    btnOpenAi.addEventListener('click', () => {
      window.open('https://copilot.microsoft.com/', '_blank');
    });
  }

  // Export buttons
  const btnExportExcel = document.getElementById('btn-export-excel');
  const btnExportCsv = document.getElementById('btn-export-csv');
  const btnExportPdf = document.getElementById('btn-export-pdf');
  const btnExportWord = document.getElementById('btn-export-word');
  const btnClearStorage = document.getElementById('btn-clear-storage');

  if (btnExportExcel) {
    btnExportExcel.addEventListener('click', () => exportScenarios('excel'));
  }
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => exportScenarios('csv'));
  }
  if (btnExportPdf) {
    btnExportPdf.addEventListener('click', () => exportScenarios('pdf'));
  }
  if (btnExportWord) {
    btnExportWord.addEventListener('click', () => exportScenarios('word'));
  }
  if (btnClearStorage) {
    btnClearStorage.addEventListener('click', () => {
      state.scenarios = [];
      saveToStorage();
      rebuildScenariosTable();
      updateScenarioBriefingCurrent();
      showToast('All saved scenarios cleared from this browser.', 'warning');
    });
  }
}

/* =========================================================
   Settings & configuration
   ========================================================= */

function updateSettingsFromForm() {
  const horizon = parseFloat(document.getElementById('setting-horizon').value) || 1;
  const pop = parseFloat(document.getElementById('setting-population').value) || 0;
  const currency = document.getElementById('setting-currency').value || 'local currency units';
  const metric = document.getElementById('setting-vsl-metric').value || 'vsl';
  const vslVal = parseFloat(document.getElementById('setting-vsl').value) || 0;

  state.settings = {
    horizonYears: horizon,
    population: pop,
    currencyLabel: currency,
    vslMetric: metric,
    vslValue: vslVal
  };
}

function applySettingsFromForm() {
  updateSettingsFromForm();
  if (state.config) {
    state.derived = computeDerived(state.settings, state.config, state.costs);
  }
  updateAll();
  showToast('Settings applied.', 'success');
}

function applyConfigFromForm() {
  const country = document.getElementById('cfg-country').value;
  const outbreak = document.getElementById('cfg-outbreak').value;
  const scope = document.getElementById('cfg-scope').value;
  const exemptions = document.getElementById('cfg-exemptions').value;
  const coverage = parseFloat(document.getElementById('cfg-coverage').value);
  const livesPer100k = parseFloat(document.getElementById('cfg-lives').value);

  state.config = {
    country,
    outbreak,
    scope,
    exemptions,
    coverage,
    livesPer100k
  };

  state.derived = computeDerived(state.settings, state.config, state.costs);
}

function applyCostsFromForm() {
  const itSystems = parseFloat(document.getElementById('cost-it-systems').value) || 0;
  const comms = parseFloat(document.getElementById('cost-communications').value) || 0;
  const enforcement = parseFloat(document.getElementById('cost-enforcement').value) || 0;
  const compensation = parseFloat(document.getElementById('cost-compensation').value) || 0;
  const admin = parseFloat(document.getElementById('cost-admin').value) || 0;
  const other = parseFloat(document.getElementById('cost-other').value) || 0;

  state.costs = {
    itSystems,
    comms,
    enforcement,
    compensation,
    admin,
    other
  };

  state.derived = computeDerived(state.settings, state.config, state.costs);
}

/* =========================================================
   Derived metrics
   ========================================================= */

function computeDerived(settings, config, costs) {
  if (!config) return null;

  const pop = settings.population || 0;
  const vsl = settings.vslValue || 0;
  const livesPer100k = config.livesPer100k || 0;

  const livesTotal = (livesPer100k / 100000) * pop;
  const benefitMonetary = livesTotal * vsl;

  const costTotal = costs
    ? (costs.itSystems || 0) +
      (costs.comms || 0) +
      (costs.enforcement || 0) +
      (costs.compensation || 0) +
      (costs.admin || 0) +
      (costs.other || 0)
    : 0;

  const netBenefit = benefitMonetary - costTotal;
  const bcr = costTotal > 0 ? benefitMonetary / costTotal : null;

  const support = computeSupportFromMXL(config);

  return {
    livesTotal,
    benefitMonetary,
    costTotal,
    netBenefit,
    bcr,
    support
  };
}

/* =========================================================
   Updating the UI
   ========================================================= */

function updateAll() {
  if (state.config && !state.derived) {
    state.derived = computeDerived(state.settings, state.config, state.costs);
  }

  updateConfigSummary();
  updateCostSummary();
  updateResultsSummary();
  rebuildScenariosTable();
  updateBriefingTemplate();
  updateAiPrompt();
  updateScenarioBriefingCurrent();
}

function updateConfigSummary() {
  const elCountry = document.getElementById('summary-country');
  const elOutbreak = document.getElementById('summary-outbreak');
  const elScope = document.getElementById('summary-scope');
  const elExemptions = document.getElementById('summary-exemptions');
  const elCoverage = document.getElementById('summary-coverage');
  const elLives = document.getElementById('summary-lives');
  const elSupport = document.getElementById('summary-support');
  const elHeadline = document.getElementById('headlineRecommendation');

  if (!state.config || !state.derived) {
    if (elCountry) elCountry.textContent = '–';
    if (elOutbreak) elOutbreak.textContent = '–';
    if (elScope) elScope.textContent = '–';
    if (elExemptions) elExemptions.textContent = '–';
    if (elCoverage) elCoverage.textContent = '–';
    if (elLives) elLives.textContent = '–';
    if (elSupport) elSupport.textContent = '–';
    if (elHeadline) {
      elHeadline.textContent =
        'No configuration applied yet. Configure country, outbreak scenario and design, then click “Apply configuration” to see a summary.';
    }
    return;
  }

  const c = state.config;
  const d = state.derived;

  if (elCountry) elCountry.textContent = countryLabel(c.country);
  if (elOutbreak) elOutbreak.textContent = outbreakLabel(c.outbreak);
  if (elScope) elScope.textContent = scopeLabel(c.scope);
  if (elExemptions) elExemptions.textContent = exemptionsLabel(c.exemptions);
  if (elCoverage) elCoverage.textContent = coverageLabel(c.coverage);
  if (elLives) elLives.textContent = `${c.livesPer100k.toFixed(1)} per 100,000`;
  if (elSupport) elSupport.textContent = formatPercent((d.support || 0) * 100);

  if (elHeadline) {
    const supp = (d.support || 0) * 100;
    const bcr = d.bcr;
    const cur = state.settings.currencyLabel;

    let rating;
    if (supp >= 70 && bcr && bcr >= 1) {
      rating = 'This mandate option combines high predicted public support with a beneficial benefit–cost profile.';
    } else if (supp >= 60 && bcr && bcr >= 1) {
      rating = 'This mandate option has broadly favourable support and a positive benefit–cost profile.';
    } else if (supp < 50 && (!bcr || bcr < 1)) {
      rating = 'This mandate option has limited predicted support and a weak benefit–cost profile – it may be difficult to justify without mitigation measures.';
    } else {
      rating = 'This mandate option involves trade-offs between public support and the economic valuation of lives saved.';
    }

    const costText = d.costTotal > 0
      ? `Indicative implementation cost is about ${formatCurrency(d.costTotal, cur)}.`
      : 'Implementation costs have not yet been entered, so the benefit–cost profile is incomplete.';

    elHeadline.textContent =
      `${rating} Predicted public support is approximately ${formatPercent(supp)}. ` +
      `The monetary valuation of lives saved is about ${formatCurrency(d.benefitMonetary, cur)}. ${costText}`;
  }
}

function updateCostSummary() {
  const elTotal = document.getElementById('summary-cost-total');
  const elMain = document.getElementById('summary-cost-main');
  const cur = state.settings.currencyLabel;

  if (!state.costs) {
    if (elTotal) elTotal.textContent = '–';
    if (elMain) elMain.textContent = '–';
    return;
  }

  const c = state.costs;
  const components = [
    { key: 'itSystems', label: 'Digital systems & infrastructure', value: c.itSystems || 0 },
    { key: 'comms', label: 'Communications & public information', value: c.comms || 0 },
    { key: 'enforcement', label: 'Enforcement & compliance', value: c.enforcement || 0 },
    { key: 'compensation', label: 'Adverse-event monitoring & compensation', value: c.compensation || 0 },
    { key: 'admin', label: 'Administration & programme management', value: c.admin || 0 },
    { key: 'other', label: 'Other mandate-specific costs', value: c.other || 0 }
  ];

  const total = components.reduce((acc, x) => acc + x.value, 0);
  let main = components[0];
  components.forEach(comp => {
    if (comp.value > main.value) main = comp;
  });

  if (elTotal) elTotal.textContent = formatCurrency(total, cur);
  if (elMain) elMain.textContent = total > 0 ? `${main.label} (${formatCurrency(main.value, cur)})` : '–';
}

function updateResultsSummary() {
  const d = state.derived;
  const c = state.config;
  const settings = state.settings;
  const cur = settings.currencyLabel;
  const elLivesTotal = document.getElementById('result-lives-total');
  const elBenefit = document.getElementById('result-benefit-monetary');
  const elCost = document.getElementById('result-cost-total');
  const elNet = document.getElementById('result-net-benefit');
  const elBcr = document.getElementById('result-bcr');
  const elSupport = document.getElementById('result-support');
  const elNarrative = document.getElementById('resultsNarrative');

  if (!d || !c) {
    if (elLivesTotal) elLivesTotal.textContent = '–';
    if (elBenefit) elBenefit.textContent = '–';
    if (elCost) elCost.textContent = '–';
    if (elNet) elNet.textContent = '–';
    if (elBcr) elBcr.textContent = '–';
    if (elSupport) elSupport.textContent = '–';
    if (elNarrative) {
      elNarrative.textContent =
        'Apply a configuration and, if possible, enter costs to see a narrative summary of cost–benefit performance and model-based public support for the mandate.';
    }
    updateMRSSection(null, null);
    updateCharts(null, null);
    return;
  }

  if (elLivesTotal) elLivesTotal.textContent = `${d.livesTotal.toFixed(1)} lives`;
  if (elBenefit) elBenefit.textContent = formatCurrency(d.benefitMonetary, cur);
  if (elCost) elCost.textContent = d.costTotal > 0 ? formatCurrency(d.costTotal, cur) : 'Not yet entered';
  if (elNet) elNet.textContent = formatCurrency(d.netBenefit, cur);
  if (elBcr) elBcr.textContent = d.bcr != null ? d.bcr.toFixed(2) : '–';
  if (elSupport) elSupport.textContent = formatPercent((d.support || 0) * 100);

  if (elNarrative) {
    const supp = (d.support || 0) * 100;
    const suppText = `Predicted public support for this configuration is approximately ${formatPercent(supp)}.`;
    const costText = d.costTotal > 0
      ? `Total implementation cost is around ${formatCurrency(d.costTotal, cur)}, generating an estimated benefit–cost ratio of ${d.bcr != null ? d.bcr.toFixed(2) : '–'}.`
      : 'Implementation costs have not been entered, so only benefits and support can be interpreted at this stage.';
    const benefitText = `The DCE-based expected lives saved parameter implies about ${d.livesTotal.toFixed(1)} lives saved in the exposed population, valued at approximately ${formatCurrency(d.benefitMonetary, cur)}.`;
    elNarrative.textContent = `${suppText} ${benefitText} ${costText}`;
  }

  updateMRSSection(c, d);
  updateCharts(d, settings);
}

/* =========================================================
   MRS section (lives-saved equivalents)
   ========================================================= */

function updateMRSSection(config, derived) {
  const tableBody = document.querySelector('#mrs-table tbody');
  const mrsNarr = document.getElementById('mrsNarrative');
  if (!tableBody) return;

  tableBody.innerHTML = '';

  if (!config) {
    if (mrsNarr) {
      mrsNarr.textContent =
        'Configure a mandate to see how changes in scope, exemptions or coverage compare to changes in expected lives saved. Positive values indicate changes that reduce acceptability; negative values indicate changes that increase acceptability.';
    }
    return;
  }

  const coefs = mxlCoefs[config.country || 'AU'][config.outbreak || 'mild'];
  const betaLives = coefs.lives || 0;
  if (!betaLives) {
    if (mrsNarr) {
      mrsNarr.textContent =
        'Lives-saved equivalents (MRS) are not available because the lives-saved coefficient is missing in the current setting.';
    }
    return;
  }

  const rows = [];

  if (config.scope === 'all') {
    const mrsScope = -coefs.scopeAll / betaLives;
    rows.push({
      attribute: 'Broader scope: high-risk occupations → all occupations & public spaces',
      value: mrsScope,
      interpretation:
        mrsScope >= 0
          ? `This change is as costly in terms of public acceptability as reducing expected lives saved by about ${mrsScope.toFixed(
              1
            )} per 100,000 people.`
          : `This change increases acceptability, similar to gaining about ${Math.abs(mrsScope).toFixed(
              1
            )} extra lives saved per 100,000 people.`
    });
  }

  if (config.exemptions === 'medrel') {
    const mrsExMedRel = -coefs.exMedRel / betaLives;
    rows.push({
      attribute: 'Broader exemptions: medical only → medical + religious',
      value: mrsExMedRel,
      interpretation:
        mrsExMedRel >= 0
          ? `Moving to medical + religious exemptions is viewed as restrictive as losing about ${mrsExMedRel.toFixed(
              1
            )} expected lives saved per 100,000.`
          : `Moving to medical + religious exemptions is viewed as favourable, similar to gaining about ${Math.abs(
              mrsExMedRel
            ).toFixed(1)} expected lives saved per 100,000.`
    });
  } else if (config.exemptions === 'medrelpers') {
    const mrsExMedRelPers = -coefs.exMedRelPers / betaLives;
    rows.push({
      attribute: 'Broader exemptions: medical only → medical + religious + personal belief',
      value: mrsExMedRelPers,
      interpretation:
        mrsExMedRelPers >= 0
          ? `Allowing medical, religious and personal belief exemptions is viewed as restrictive as losing about ${mrsExMedRelPers.toFixed(
              1
            )} expected lives saved per 100,000.`
          : `Allowing medical, religious and personal belief exemptions is viewed as favourable, similar to gaining about ${Math.abs(
              mrsExMedRelPers
            ).toFixed(1)} expected lives saved per 100,000.`
    });
  }

  if (config.coverage === 0.7) {
    const mrsCov = -coefs.cov70 / betaLives;
    rows.push({
      attribute: 'Higher lifting threshold: 50% → 70% vaccinated',
      value: mrsCov,
      interpretation:
        mrsCov >= 0
          ? `Raising the lifting threshold to 70% is as demanding in preference terms as losing about ${mrsCov.toFixed(
              1
            )} expected lives saved per 100,000.`
          : `Raising the lifting threshold to 70% is viewed as beneficial, similar to gaining about ${Math.abs(
              mrsCov
            ).toFixed(1)} expected lives saved per 100,000.`
    });
  } else if (config.coverage === 0.9) {
    const mrsCov = -coefs.cov90 / betaLives;
    rows.push({
      attribute: 'Higher lifting threshold: 50% → 90% vaccinated',
      value: mrsCov,
      interpretation:
        mrsCov >= 0
          ? `Raising the lifting threshold to 90% is as demanding as losing about ${mrsCov.toFixed(
              1
            )} expected lives saved per 100,000.`
          : `Raising the lifting threshold to 90% is viewed as beneficial, similar to gaining about ${Math.abs(
              mrsCov
            ).toFixed(1)} expected lives saved per 100,000.`
    });
  }

  rows.forEach(row => {
    const tr = document.createElement('tr');
    const tdAttr = document.createElement('td');
    const tdVal = document.createElement('td');
    const tdInterp = document.createElement('td');

    tdAttr.textContent = row.attribute;
    tdVal.textContent = row.value.toFixed(1);
    tdInterp.textContent = row.interpretation;

    tr.appendChild(tdAttr);
    tr.appendChild(tdVal);
    tr.appendChild(tdInterp);
    tableBody.appendChild(tr);
  });

  if (mrsNarr) {
    if (rows.length === 0) {
      mrsNarr.textContent =
        'Under the current configuration there is no attribute change to contrast, so lives-saved equivalents (MRS) are not displayed.';
    } else {
      mrsNarr.textContent =
        'Lives-saved equivalents interpret how strongly people care about mandate design features in terms of “extra lives saved per 100,000 people”. Positive values reflect changes that reduce acceptability; negative values reflect changes that increase acceptability.';
    }
  }
}

/* =========================================================
   Charts
   ========================================================= */

function updateCharts(derived, settings) {
  const ctxBcr = document.getElementById('chart-bcr');
  const ctxSupport = document.getElementById('chart-support');

  if (!ctxBcr || !ctxSupport) return;

  if (bcrChart) bcrChart.destroy();
  if (supportChart) supportChart.destroy();

  if (!derived) return;

  const cur = settings.currencyLabel;

  bcrChart = new Chart(ctxBcr, {
    type: 'bar',
    data: {
      labels: ['Benefit', 'Cost', 'Net benefit'],
      datasets: [
        {
          label: `Values (${cur})`,
          data: [
            derived.benefitMonetary || 0,
            derived.costTotal || 0,
            derived.netBenefit || 0
          ]
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${formatCurrency(ctx.parsed.y, cur)}`
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: value => formatShortCurrency(value, cur)
          }
        }
      }
    }
  });

  supportChart = new Chart(ctxSupport, {
    type: 'bar',
    data: {
      labels: ['Predicted public support'],
      datasets: [
        {
          label: 'Support (%)',
          data: [((derived.support || 0) * 100).toFixed(1)]
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.y.toFixed(1)}%`
          }
        }
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: {
            callback: value => `${value}%`
          }
        }
      }
    }
  });
}

/* =========================================================
   Scenarios & exports
   ========================================================= */

function saveScenario() {
  if (!state.config || !state.derived) {
    showToast('Please apply a configuration before saving a scenario.', 'warning');
    return;
  }

  const s = {
    id: state.scenarios.length + 1,
    timestamp: new Date().toISOString(),
    settings: { ...state.settings },
    config: { ...state.config },
    costs: state.costs ? { ...state.costs } : null,
    derived: { ...state.derived }
  };

  state.scenarios.push(s);
  saveToStorage();
  rebuildScenariosTable();
  populateScenarioBriefing(s);
  showToast('Scenario saved.', 'success');
}

function rebuildScenariosTable() {
  const tbody = document.querySelector('#scenarios-table tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!state.scenarios.length) return;

  state.scenarios.forEach((s, idx) => {
    const tr = document.createElement('tr');

    const d = s.derived;
    const c = s.config;
    const cur = s.settings.currencyLabel;

    const cells = [
      idx + 1,
      countryLabel(c.country),
      outbreakLabel(c.outbreak),
      scopeLabel(c.scope),
      exemptionsLabel(c.exemptions),
      coverageLabel(c.coverage),
      c.livesPer100k.toFixed(1),
      d ? d.livesTotal.toFixed(1) : '–',
      d ? formatShortCurrency(d.benefitMonetary, cur) : '–',
      d ? formatShortCurrency(d.costTotal, cur) : '–',
      d ? formatShortCurrency(d.netBenefit, cur) : '–',
      d && d.bcr != null ? d.bcr.toFixed(2) : '–',
      d ? formatPercent((d.support || 0) * 100) : '–'
    ];

    cells.forEach(val => {
      const td = document.createElement('td');
      td.textContent = val;
      tr.appendChild(td);
    });

    tr.addEventListener('click', () => {
      populateScenarioBriefing(s);
    });

    tbody.appendChild(tr);
  });
}

function populateScenarioBriefing(scenario) {
  const txt = document.getElementById('scenario-briefing-text');
  if (!txt) return;
  const c = scenario.config;
  const d = scenario.derived;
  const cur = scenario.settings.currencyLabel;

  const supp = (d.support || 0) * 100;

  const text =
    `Country: ${countryLabel(c.country)}; outbreak scenario: ${outbreakLabel(c.outbreak)}.\n` +
    `Mandate scope: ${scopeLabel(c.scope)}; exemption policy: ${exemptionsLabel(
      c.exemptions
    )}; coverage threshold to lift mandate: ${coverageLabel(c.coverage)}.\n` +
    `Expected lives saved: ${c.livesPer100k.toFixed(
      1
    )} per 100,000 people, implying around ${d.livesTotal.toFixed(
      1
    )} lives saved in the exposed population.\n` +
    `Monetary benefit of lives saved (using the chosen value-per-life metric): ${formatCurrency(
      d.benefitMonetary,
      cur
    )}.\n` +
    `Total implementation cost (as entered): ${formatCurrency(d.costTotal, cur)}, giving a net benefit of ${formatCurrency(
      d.netBenefit,
      cur
    )} and a benefit–cost ratio of ${d.bcr != null ? d.bcr.toFixed(2) : 'not yet defined'}.\n` +
    `Model-based predicted public support for this mandate is approximately ${formatPercent(supp)}.\n` +
    `Interpretation: This summary can be pasted directly into emails or briefing documents and should be read alongside qualitative, ethical and legal considerations that are not captured in the DCE or the simple economic valuation used here.`;

  txt.value = text;
}

function updateScenarioBriefingCurrent() {
  const txt = document.getElementById('scenario-briefing-text');
  if (!txt) return;

  if (!state.config || !state.derived) {
    txt.value =
      'Once you apply a configuration (and optionally enter costs), this box will show a short, plain-language summary of the current scenario ready to copy into emails or reports.';
    return;
  }

  const c = state.config;
  const d = state.derived;
  const cur = state.settings.currencyLabel;
  const supp = (d.support || 0) * 100;

  const text =
    `Current configuration – ${countryLabel(c.country)}, ${outbreakLabel(c.outbreak)}.\n` +
    `Scope: ${scopeLabel(c.scope)}; exemptions: ${exemptionsLabel(
      c.exemptions
    )}; coverage threshold: ${coverageLabel(c.coverage)}.\n` +
    `Expected lives saved: ${c.livesPer100k.toFixed(
      1
    )} per 100,000 people, ≈${d.livesTotal.toFixed(1)} lives saved in the exposed population.\n` +
    `Monetary value of lives saved: ${formatCurrency(d.benefitMonetary, cur)}.\n` +
    `Implementation cost (if entered): ${formatCurrency(d.costTotal, cur)}; net benefit: ${formatCurrency(
      d.netBenefit,
      cur
    )}; BCR: ${d.bcr != null ? d.bcr.toFixed(2) : 'not yet defined'}.\n` +
    `Predicted public support: ${formatPercent(supp)}.\n` +
    `Use this text as a starting point and add context on feasibility, distributional impacts and ethical considerations.`;

  txt.value = text;
}

/* Exports */

function exportScenarios(kind) {
  if (!state.scenarios.length) {
    showToast('No scenarios to export.', 'warning');
    return;
  }

  const header = [
    'id',
    'country',
    'outbreak',
    'scope',
    'exemptions',
    'coverage',
    'lives_per_100k',
    'lives_total',
    'benefit',
    'cost',
    'net_benefit',
    'bcr',
    'support',
    'currency',
    'timestamp'
  ];

  const rows = state.scenarios.map(s => {
    const c = s.config;
    const d = s.derived || {};
    const cur = s.settings.currencyLabel;
    return [
      s.id,
      countryLabel(c.country),
      outbreakLabel(c.outbreak),
      scopeLabel(c.scope),
      exemptionsLabel(c.exemptions),
      coverageLabel(c.coverage),
      c.livesPer100k,
      d.livesTotal || '',
      d.benefitMonetary || '',
      d.costTotal || '',
      d.netBenefit || '',
      d.bcr != null ? d.bcr : '',
      (d.support || 0),
      cur,
      s.timestamp
    ];
  });

  const csvLines = [
    header.join(','),
    ...rows.map(r => r.map(v => (typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v)).join(','))
  ];
  const csvContent = csvLines.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  if (kind === 'csv' || kind === 'excel') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = kind === 'excel' ? 'mandeval_scenarios.xlsx.csv' : 'mandeval_scenarios.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast(
      kind === 'excel'
        ? 'Scenarios exported as CSV (Excel-readable).'
        : 'Scenarios exported as CSV.',
      'success'
    );
    return;
  }

  if (kind === 'pdf') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mandeval_scenarios_summary.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Summary data exported as CSV for use in PDF/reporting tools.', 'success');
    return;
  }

  if (kind === 'word') {
    exportScenariosAsWord();
    return;
  }
}

function exportScenariosAsWord() {
  // Simple HTML-for-Word document with headings and lists
  const title = 'MANDEVAL – Vaccine Mandate Scenario Briefings';
  const now = new Date().toLocaleString();

  let html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1f2933; }
  h1 { font-size: 16pt; margin-bottom: 4pt; }
  h2 { font-size: 13pt; margin-top: 12pt; margin-bottom: 4pt; }
  h3 { font-size: 11pt; margin-top: 8pt; margin-bottom: 3pt; }
  p { margin: 2pt 0; }
  ul { margin: 0 0 4pt 18pt; padding: 0; }
  li { margin: 0 0 2pt 0; }
  .meta { font-size: 9pt; color: #6b7280; margin-bottom: 8pt; }
  .section { margin-bottom: 10pt; }
  .label { font-weight: bold; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">Generated on ${escapeHtml(now)}. Each scenario is based on mixed logit preference estimates and user-entered settings in the MANDEVAL tool.</p>
`;

  state.scenarios.forEach(s => {
    const c = s.config;
    const d = s.derived || {};
    const set = s.settings || state.settings;
    const cur = set.currencyLabel;
    const supp = (d.support || 0) * 100;

    html += `<div class="section">`;
    html += `<h2>Scenario ${s.id}: ${escapeHtml(countryLabel(c.country))} – ${escapeHtml(outbreakLabel(c.outbreak))}</h2>`;
    html += `<p><span class="label">Time stamp:</span> ${escapeHtml(s.timestamp)}</p>`;

    html += `<h3>Mandate configuration</h3><ul>`;
    html += `<li><span class="label">Scope:</span> ${escapeHtml(scopeLabel(c.scope))}</li>`;
    html += `<li><span class="label">Exemptions:</span> ${escapeHtml(exemptionsLabel(c.exemptions))}</li>`;
    html += `<li><span class="label">Coverage requirement to lift mandate:</span> ${escapeHtml(coverageLabel(c.coverage))}</li>`;
    html += `<li><span class="label">Expected lives saved:</span> ${c.livesPer100k.toFixed(1)} per 100,000 people</li>`;
    html += `<li><span class="label">Population covered:</span> ${set.population.toLocaleString()} people</li>`;
    html += `</ul>`;

    html += `<h3>Epidemiological benefit and monetary valuation</h3><ul>`;
    html += `<li><span class="label">Total lives saved (approx.):</span> ${d.livesTotal ? d.livesTotal.toFixed(1) : '–'} lives</li>`;
    html += `<li><span class="label">Value per life saved:</span> ${formatCurrency(set.vslValue, cur)}</li>`;
    html += `<li><span class="label">Monetary benefit of lives saved:</span> ${formatCurrency(d.benefitMonetary || 0, cur)}</li>`;
    html += `</ul>`;

    html += `<h3>Costs and benefit–cost profile</h3><ul>`;
    html += `<li><span class="label">Total implementation cost (as entered):</span> ${formatCurrency(d.costTotal || 0, cur)}</li>`;
    html += `<li><span class="label">Net benefit (benefit – cost):</span> ${formatCurrency(d.netBenefit || 0, cur)}</li>`;
    html += `<li><span class="label">Benefit–cost ratio (BCR):</span> ${d.bcr != null ? d.bcr.toFixed(2) : 'not yet defined'}</li>`;
    html += `</ul>`;

    html += `<h3>Model-based public support</h3><ul>`;
    html += `<li><span class="label">Predicted public support:</span> ${formatPercent(supp)}</li>`;
    html += `</ul>`;

    html += `<h3>Interpretation (for policy discussion)</h3>`;
    html += `<p>This scenario combines the model-based estimate of public support with a simple valuation of lives saved and indicative implementation costs. `;
    html += `Predicted support of ${formatPercent(supp)} should be interpreted as an indicative acceptance level under the stated outbreak scenario and mandate design, not as a forecast. `;
    html += `Net benefit and the benefit–cost ratio summarise the trade-off between epidemiological benefit and implementation cost, but do not capture important `;
    html += `ethical, legal, distributional or political considerations. These figures should therefore be read alongside qualitative judgments and stakeholder input.</p>`;
    html += `</div>`;
  });

  html += `<p class="meta">Note: All figures depend on the assumptions entered into MANDEVAL (population, value per life saved, cost inputs). For formal regulatory appraisal, the underlying data and assumptions should be checked and documented in a technical annex.</p>`;
  html += `</body></html>`;

  const blobDoc = new Blob([html], {
    type: 'application/msword;charset=utf-8;'
  });
  const url = URL.createObjectURL(blobDoc);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mandeval_scenarios_briefing.doc';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Word briefing downloaded (ready to print or edit).', 'success');
}

/* =========================================================
   Briefing & AI prompt
   ========================================================= */

function updateBriefingTemplate() {
  const el = document.getElementById('briefing-template');
  if (!el) return;

  if (!state.config || !state.derived) {
    el.value =
      'Apply a configuration and enter costs to auto-populate a briefing template based on the current scenario.';
    return;
  }

  const c = state.config;
  const d = state.derived;
  const s = state.settings;
  const supp = (d.support || 0) * 100;
  const cur = s.currencyLabel;

  const text =
    `Purpose\n` +
    `Summarise the expected public support, epidemiological benefits and indicative economic value of a specific COVID-19 vaccine mandate configuration in ${countryLabel(
      c.country
    )} under a ${outbreakLabel(c.outbreak).toLowerCase()} scenario.\n\n` +
    `Mandate configuration\n` +
    `• Country: ${countryLabel(c.country)}\n` +
    `• Outbreak scenario: ${outbreakLabel(c.outbreak)}\n` +
    `• Mandate scope: ${scopeLabel(c.scope)}\n` +
    `• Exemption policy: ${exemptionsLabel(c.exemptions)}\n` +
    `• Coverage requirement to lift mandate: ${coverageLabel(c.coverage)}\n` +
    `• Expected lives saved: ${c.livesPer100k.toFixed(1)} per 100,000 people\n\n` +
    `Epidemiological benefit and monetary valuation\n` +
    `• Exposed population: ${s.population.toLocaleString()} people\n` +
    `• Total lives saved (model input × population): ${d.livesTotal.toFixed(1)}\n` +
    `• Value per life saved (VSL or related metric): ${formatCurrency(s.vslValue, cur)}\n` +
    `• Monetary value of lives saved: ${formatCurrency(d.benefitMonetary, cur)}\n\n` +
    `Costs and benefit–cost profile\n` +
    `• Total implementation cost (as entered): ${formatCurrency(d.costTotal, cur)}\n` +
    `• Net benefit (benefit – cost): ${formatCurrency(d.netBenefit, cur)}\n` +
    `• Benefit–cost ratio (BCR): ${d.bcr != null ? d.bcr.toFixed(2) : 'not yet defined'}\n\n` +
    `Model-based public support\n` +
    `• Predicted public support for this mandate configuration: ${formatPercent(
      supp
    )}\n\n` +
    `Interpretation (to be tailored)\n` +
    `This configuration appears to offer ${d.bcr != null && d.bcr >= 1 ? 'a favourable' : 'an uncertain'} balance between epidemiological benefit and implementation cost, with predicted public support at around ${formatPercent(
      supp
    )}. These results should be interpreted alongside distributional, ethical and legal considerations that are not captured in the DCE or the simple economic valuation used here.`;

  el.value = text;
}

function updateAiPrompt() {
  const el = document.getElementById('ai-prompt');
  if (!el) return;

  if (!state.config || !state.derived) {
    el.value =
      'Apply a configuration and enter costs to auto-generate an AI prompt for Copilot or ChatGPT based on the current scenario.';
    return;
  }

  const c = state.config;
  const d = state.derived;
  const s = state.settings;
  const supp = (d.support || 0) * 100;
  const cur = s.currencyLabel;

  const prompt =
    `You are helping a public health policy team design a COVID-19 vaccine mandate.\n\n` +
    `CURRENT MANDATE CONFIGURATION\n` +
    `- Country: ${countryLabel(c.country)}\n` +
    `- Outbreak scenario: ${outbreakLabel(c.outbreak)}\n` +
    `- Scope: ${scopeLabel(c.scope)}\n` +
    `- Exemption policy: ${exemptionsLabel(c.exemptions)}\n` +
    `- Coverage threshold to lift mandate: ${coverageLabel(c.coverage)}\n` +
    `- Expected lives saved: ${c.livesPer100k.toFixed(1)} per 100,000 people\n\n` +
    `SETTINGS\n` +
    `- Analysis horizon: ${s.horizonYears} year(s)\n` +
    `- Population covered: ${s.population.toLocaleString()} people\n` +
    `- Currency label: ${cur}\n` +
    `- Value per life saved (VSL or related metric): ${formatCurrency(s.vslValue, cur)}\n\n` +
    `COST–BENEFIT SUMMARY FOR CURRENT CONFIGURATION\n` +
    `- Total implementation cost: ${formatCurrency(d.costTotal, cur)}\n` +
    `- Estimated total lives saved: ${d.livesTotal.toFixed(1)}\n` +
    `- Monetary benefit of lives saved: ${formatCurrency(d.benefitMonetary, cur)}\n` +
    `- Net benefit: ${formatCurrency(d.netBenefit, cur)}\n` +
    `- Benefit–cost ratio (BCR): ${d.bcr != null ? d.bcr.toFixed(2) : 'not yet defined'}\n` +
    `- Predicted public support (from mixed logit model): ${formatPercent(supp)}\n\n` +
    `TASK FOR YOU:\n` +
    `Draft a short, neutral and clear policy briefing that:\n` +
    `1. Summarises this mandate option in plain language.\n` +
    `2. Highlights the trade-offs between public health impact, costs and public support.\n` +
    `3. Flags key uncertainties or assumptions.\n` +
    `4. Suggests up to three points for ministers or senior officials to consider when comparing this option with alternatives.\n\n` +
    `Use British spelling and keep the tone suitable for a government briefing.`;

  el.value = prompt;
}

/* =========================================================
   Toasts
   ========================================================= */

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';

  if (type === 'success') toast.classList.add('toast-success');
  else if (type === 'warning') toast.classList.add('toast-warning');
  else if (type === 'error') toast.classList.add('toast-error');

  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.remove();
    }, 500);
  }, 4500);
}

/* =========================================================
   Formatting helpers
   ========================================================= */

function formatCurrency(value, currencyLabel) {
  const v = typeof value === 'number' ? value : 0;
  if (!isFinite(v)) return `${currencyLabel} ?`;
  const abs = Math.abs(v);
  let formatted;
  if (abs >= 1e9) {
    formatted = (v / 1e9).toFixed(2) + ' B';
  } else if (abs >= 1e6) {
    formatted = (v / 1e6).toFixed(2) + ' M';
  } else if (abs >= 1e3) {
    formatted = (v / 1e3).toFixed(1) + ' K';
  } else {
    formatted = v.toFixed(0);
  }
  return `${currencyLabel} ${formatted}`;
}

function formatShortCurrency(value, currencyLabel) {
  const v = typeof value === 'number' ? value : 0;
  const abs = Math.abs(v);
  if (!isFinite(v)) return '?';
  if (abs >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

function formatPercent(value) {
  if (value == null || !isFinite(value)) return '–';
  return `${value.toFixed(1)}%`;
}

function countryLabel(code) {
  if (code === 'AU') return 'Australia';
  if (code === 'FR') return 'France';
  if (code === 'IT') return 'Italy';
  return code || '–';
}

function outbreakLabel(code) {
  if (code === 'mild') return 'Mild / endemic';
  if (code === 'severe') return 'Severe outbreak';
  return code || '–';
}

function scopeLabel(code) {
  if (code === 'highrisk') return 'High-risk occupations only';
  if (code === 'all') return 'All occupations & public spaces';
  return code || '–';
}

function exemptionsLabel(code) {
  if (code === 'medical') return 'Medical only';
  if (code === 'medrel') return 'Medical + religious';
  if (code === 'medrelpers') return 'Medical + religious + personal belief';
  return code || '–';
}

function coverageLabel(val) {
  if (val === 0.5 || String(val) === '0.5') return '50% population vaccinated';
  if (val === 0.7 || String(val) === '0.7') return '70% population vaccinated';
  if (val === 0.9 || String(val) === '0.9') return '90% population vaccinated';
  return String(val);
}

function copyFromTextarea(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = el.value || '';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showToast('Text copied to clipboard.', 'success'),
      () => fallbackCopy(el)
    );
  } else {
    fallbackCopy(el);
  }
}

function fallbackCopy(el) {
  el.select();
  el.setSelectionRange(0, 99999);
  document.execCommand('copy');
  showToast('Text copied to clipboard.', 'success');
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
