// MandEval – main logic

// --- Global state -----------------------------------------------------------

const state = {
    currentConfig: null,
    savedScenarios: [],
    charts: {
        supportChart: null,
        benefitCostChart: null,
        mrsChart: null
    }
};

// Mixed logit mean coefficients by country and outbreak scenario
// Coefficients correspond to Table 3 in the manuscript (means only).
// ASC_A: alternative specific constant for Policy A
// ASC_OPT: alternative specific constant for opt-out ("no mandate")
// Other coefficients are dummy-coded (reference categories described in the paper).
const mxlCoeffs = {
    Australia: {
        mild: {
            ascA: 0.464,
            ascOpt: -0.572,
            scopeAll: -0.319,
            exMedRel: -0.157,
            exMedRelPers: -0.267,
            cov70: 0.171,
            cov90: 0.158,
            lives: 0.072
        },
        severe: {
            ascA: 0.535,
            ascOpt: -0.694,
            scopeAll: 0.190,
            exMedRel: -0.181,
            exMedRelPers: -0.305,
            cov70: 0.371,
            cov90: 0.398,
            lives: 0.079
        }
    },
    Italy: {
        mild: {
            ascA: 0.625,
            ascOpt: -0.238,
            scopeAll: -0.276,
            exMedRel: -0.176,
            exMedRelPers: -0.289,
            cov70: 0.185,
            cov90: 0.148,
            lives: 0.039
        },
        severe: {
            ascA: 0.799,
            ascOpt: -0.463,
            scopeAll: 0.174,
            exMedRel: -0.178,
            exMedRelPers: -0.207,
            cov70: 0.305,
            cov90: 0.515,
            lives: 0.045
        }
    },
    France: {
        mild: {
            ascA: 0.899,
            ascOpt: 0.307,
            scopeAll: -0.160,
            exMedRel: -0.121,
            exMedRelPers: -0.124,
            cov70: 0.232,
            cov90: 0.264,
            lives: 0.049
        },
        severe: {
            ascA: 0.884,
            ascOpt: 0.083,
            scopeAll: -0.019,
            exMedRel: -0.192,
            exMedRelPers: -0.247,
            cov70: 0.267,
            cov90: 0.398,
            lives: 0.052
        }
    }
};

// Precomputed MRS values (lives-saved equivalents) by country and scenario
// These are used for the bar chart; interpretation text is tailored per configuration.
const mrsValues = computeAllMRS();

// --- Utility functions ------------------------------------------------------

function showToast(message, type = "success") {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "toast show " + (type === "success"
        ? "toast-success"
        : type === "warning"
            ? "toast-warning"
            : "toast-error");
    setTimeout(() => {
        toast.classList.remove("show");
    }, 3500);
}

function formatNumber(x, decimals = 0) {
    if (x === null || x === undefined || isNaN(x)) return "–";
    return x.toLocaleString(undefined, {
        maximumFractionDigits: decimals,
        minimumFractionDigits: decimals
    });
}

// --- Tab handling -----------------------------------------------------------

function setupTabs() {
    const buttons = document.querySelectorAll(".tab-btn");
    const panels = document.querySelectorAll(".tab-panel");

    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            const tab = btn.getAttribute("data-tab");
            buttons.forEach(b => b.classList.remove("active"));
            panels.forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById("tab-" + tab).classList.add("active");
        });
    });
}

// --- Settings: VSL and population ------------------------------------------

function applyDefaultVslAndCosts(country) {
    const vslBasisSelect = document.getElementById("settings-vsl-basis");
    const vslValueInput = document.getElementById("settings-vsl-value");
    const vslNote = document.getElementById("settings-vsl-note");

    let central, low, high, note;

    if (country === "Australia") {
        // Based on OBPR guidance, inflated to ~5.4m AUD (recent years).
        central = 5400000;
        low = 4000000;
        high = 6500000;
        note = "Indicative VSL for Australia (AUD, recent OBPR guidance).";
    } else if (country === "France") {
        // French guidance around 3–3.2m EUR.
        central = 3000000;
        low = 2200000;
        high = 3800000;
        note = "Indicative VSL for France (EUR, regulatory impact assessments).";
    } else {
        // Italy – mid-point between 1m and 3m EUR.
        central = 2000000;
        low = 1300000;
        high = 3000000;
        note = "Indicative VSL for Italy (EUR, transport & OECD-based values).";
    }

    const basis = vslBasisSelect.value;
    let chosen;
    if (basis === "low") chosen = low;
    else if (basis === "high") chosen = high;
    else if (basis === "central" || basis === "custom") chosen = central;

    if (basis !== "custom") {
        vslValueInput.value = chosen;
        vslValueInput.readOnly = false;
    }

    vslNote.textContent = note + " You can override with a custom value if needed.";

    // Default costing values by country (simple but realistic scale)
    const setupPerMillionInput = document.getElementById("cost-setup-per-million");
    const adminPerPersonPerYearInput = document.getElementById("cost-admin-per-person-per-year");
    const enforcePerPersonPerYearInput = document.getElementById("cost-enforce-per-person-per-year");
    const commsPerPersonInput = document.getElementById("cost-comms-per-person");
    const otherPerPersonInput = document.getElementById("cost-other-per-person");

    if (country === "Australia") {
        setupPerMillionInput.value = 6000000;     // AUD
        adminPerPersonPerYearInput.value = 10;    // AUD
        enforcePerPersonPerYearInput.value = 6;   // AUD
        commsPerPersonInput.value = 5;            // AUD over period
        otherPerPersonInput.value = 4;            // AUD over period
    } else if (country === "France") {
        setupPerMillionInput.value = 5500000;     // EUR
        adminPerPersonPerYearInput.value = 9;     // EUR
        enforcePerPersonPerYearInput.value = 5;   // EUR
        commsPerPersonInput.value = 5;            // EUR
        otherPerPersonInput.value = 4;            // EUR
    } else {
        setupPerMillionInput.value = 5000000;     // EUR
        adminPerPersonPerYearInput.value = 8;     // EUR
        enforcePerPersonPerYearInput.value = 5;   // EUR
        commsPerPersonInput.value = 4;            // EUR
        otherPerPersonInput.value = 4;            // EUR
    }

    // Update readonly country displays
    document.getElementById("settings-country-display").value = country;
    document.getElementById("costing-country-display").value = country;
}

// --- MRS calculations -------------------------------------------------------

function computeAllMRS() {
    const result = {};
    ["Australia", "France", "Italy"].forEach(country => {
        result[country] = {};
        ["mild", "severe"].forEach(scenario => {
            const c = mxlCoeffs[country][scenario];
            const betaLives = c.lives;
            // Attribute-level lives-saved equivalents (per level change)
            result[country][scenario] = {
                scopeAll: -c.scopeAll / betaLives,
                exMedRel: -c.exMedRel / betaLives,
                exMedRelPers: -c.exMedRelPers / betaLives,
                cov70: -c.cov70 / betaLives,
                cov90: -c.cov90 / betaLives
            };
        });
    });
    return result;
}

// Configuration helpers ------------------------------------------------------

function getSelectedScope() {
    const radios = document.querySelectorAll('input[name="config-scope"]');
    for (const r of radios) {
        if (r.checked) return r.value; // "highrisk" or "all"
    }
    return "highrisk";
}

// Predicted public support from mixed logit means
// U(mandate) = ascA + beta_scope*scope + beta_ex*ex + beta_cov*cov + beta_lives*lives
// U(opt-out) = ascOpt
// P = exp(U_m) / (exp(U_m) + exp(U_o))
function computePredictedSupport(country, scenario, scope, exemptions, coverage, livesPer100k) {
    const c = mxlCoeffs[country][scenario];
    if (!c) return null;

    let uMandate = c.ascA;
    let uOpt = c.ascOpt;

    // Scope
    if (scope === "all") {
        uMandate += c.scopeAll;
    }

    // Exemptions
    if (exemptions === "medRel") {
        uMandate += c.exMedRel;
    } else if (exemptions === "medRelPers") {
        uMandate += c.exMedRelPers;
    }

    // Coverage
    if (coverage === 70) {
        uMandate += c.cov70;
    } else if (coverage === 90) {
        uMandate += c.cov90;
    }

    // Expected lives saved attribute
    uMandate += c.lives * livesPer100k;

    const expM = Math.exp(uMandate);
    const expO = Math.exp(uOpt);
    const p = expM / (expM + expO);
    return p;
}

// Compute benefits and costs for the current configuration
function computeEconomics(config) {
    const periodYears = config.periodYears;
    const population = config.population;
    const livesPer100k = config.livesPer100k;
    const vsl = config.vsl;

    // Total lives saved = lives per 100k × (population/100k) × period
    const totalLivesSaved = livesPer100k * (population / 100000) * periodYears;
    const monetaryBenefit = totalLivesSaved * vsl;

    // Costs – convert all cost components to per person over period
    const setupPerMillion = config.costSetupPerMillion;
    const adminPerYear = config.costAdminPerPersonPerYear;
    const enforcePerYear = config.costEnforcePerPersonPerYear;
    const commsPerPerson = config.costCommsPerPerson;
    const otherPerPerson = config.costOtherPerPerson;

    const setupPerPerson = setupPerMillion / 1000000;
    const perPersonOverPeriod =
        setupPerPerson +
        (adminPerYear + enforcePerYear) * periodYears +
        commsPerPerson +
        otherPerPerson;

    const totalCost = perPersonOverPeriod * population;

    let bcr = null;
    let netBenefit = null;
    if (totalCost > 0) {
        bcr = monetaryBenefit / totalCost;
        netBenefit = monetaryBenefit - totalCost;
    }

    return {
        totalLivesSaved,
        monetaryBenefit,
        totalCost,
        netBenefit,
        bcr
    };
}

// Compute configuration-level lives-saved equivalent vs benchmark
function computeConfigMRS(config) {
    const {country, scenario, scope, exemptions, coverage} = config;
    const c = mxlCoeffs[country][scenario];
    if (!c) return null;

    let deltaV = 0;
    if (scope === "all") deltaV += c.scopeAll;
    if (exemptions === "medRel") deltaV += c.exMedRel;
    if (exemptions === "medRelPers") deltaV += c.exMedRelPers;
    if (coverage === 70) deltaV += c.cov70;
    if (coverage === 90) deltaV += c.cov90;

    const livesEq = -deltaV / c.lives; // lives per 100k
    return livesEq;
}

// --- Charts -----------------------------------------------------------------

function destroyChart(chart) {
    if (chart) {
        chart.destroy();
    }
}

function renderSupportChart(config) {
    const ctx = document.getElementById("supportChart").getContext("2d");
    destroyChart(state.charts.supportChart);
    state.charts.supportChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: ["Predicted support"],
            datasets: [{
                label: "Support (%)",
                data: [config.supportPercent],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {display: false},
                tooltip: {
                    callbacks: {
                        label: (ctx) => ctx.parsed.y.toFixed(1) + "%"
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        callback: (v) => v + "%"
                    }
                }
            }
        }
    });
}

function renderBenefitCostChart(config) {
    const ctx = document.getElementById("benefitCostChart").getContext("2d");
    destroyChart(state.charts.benefitCostChart);

    // Convert to millions for readability
    const benefitM = config.monetaryBenefit / 1e6;
    const costM = config.totalCost / 1e6;

    state.charts.benefitCostChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: ["Monetary benefit", "Total cost"],
            datasets: [{
                label: "Amount (millions)",
                data: [benefitM, costM],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {display: false},
                tooltip: {
                    callbacks: {
                        label: (ctx) => ctx.parsed.y.toFixed(2) + " million"
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: (v) => v + " m"
                    }
                }
            }
        }
    });
}

function renderMRSChart(config) {
    const ctx = document.getElementById("mrsChart").getContext("2d");
    destroyChart(state.charts.mrsChart);

    const {country, scenario} = config;
    const mrs = mrsValues[country][scenario];
    const labels = [
        "Scope: all occupations & public spaces",
        "Exemptions: medical + religious",
        "Exemptions: med + religious + personal belief",
        "Coverage: lift at 70% vs 50%",
        "Coverage: lift at 90% vs 50%"
    ];
    const data = [
        mrs.scopeAll,
        mrs.exMedRel,
        mrs.exMedRelPers,
        mrs.cov70,
        mrs.cov90
    ];

    state.charts.mrsChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "Lives-saved equivalent (per 100,000)",
                data,
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: "y",
            responsive: true,
            plugins: {
                legend: {display: false},
                tooltip: {
                    callbacks: {
                        label: (ctx) => ctx.parsed.x.toFixed(2) + " lives / 100,000"
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        callback: (v) => v
                    }
                }
            }
        }
    });
}

// --- UI updates -------------------------------------------------------------

function updateConfigSummary(config) {
    const el = document.getElementById("config-summary");
    const supportText = isFinite(config.supportPercent)
        ? config.supportPercent.toFixed(1) + "%"
        : "not available";

    const lineScope = config.scope === "all"
        ? "applies to all occupations and public spaces"
        : "is targeted to high-risk occupations only";

    const exText = config.exemptions === "medical"
        ? "medical-only exemptions"
        : config.exemptions === "medRel"
            ? "medical + religious exemptions"
            : "medical + religious + personal-belief exemptions";

    const covText = config.coverage + "% coverage threshold to lift the mandate";

    el.innerHTML = `
        <p><strong>Country:</strong> ${config.country}</p>
        <p><strong>Outbreak scenario:</strong> ${config.scenarioLabel}</p>
        <p><strong>Mandate design:</strong> The mandate ${lineScope}, allows <strong>${exText}</strong>,
           and uses a <strong>${covText}</strong>.</p>
        <p><strong>Expected lives saved:</strong> ${formatNumber(config.livesPer100k, 1)} per 100,000 people.</p>
        <p><strong>Model-based public support:</strong> ${supportText} of people are predicted to support this mandate
           over a “no mandate” option.</p>
        <p><strong>Evaluation period &amp; population:</strong> ${config.periodYears} year(s),
           ${formatNumber(config.population)} people exposed.</p>
    `;
}

function updateHeadlineRecommendation(config) {
    const el = document.getElementById("headline-recommendation");

    const support = config.supportPercent;
    const bcr = config.bcr;
    const netBen = config.netBenefit;

    let supportBand = "";
    let supportPhrase = "";
    if (!isFinite(support)) {
        supportBand = "unknown";
        supportPhrase = "Predicted public support cannot be calculated with the current inputs.";
    } else if (support >= 70) {
        supportBand = "high";
        supportPhrase = `Predicted public support is high at around ${support.toFixed(1)}%.`;
    } else if (support >= 50) {
        supportBand = "moderate";
        supportPhrase = `Predicted public support is moderate at around ${support.toFixed(1)}%.`;
    } else {
        supportBand = "low";
        supportPhrase = `Predicted public support is relatively low at around ${support.toFixed(1)}%.`;
    }

    let econPhrase = "";
    let overall = "";
    if (!isFinite(bcr)) {
        econPhrase = "Benefits and costs are not fully defined under the current cost assumptions.";
        overall = "Overall feasibility cannot yet be assessed; please review and complete the costing inputs.";
    } else if (bcr >= 1.2 && netBen > 0) {
        econPhrase = `Benefits clearly outweigh costs (BCR ≈ ${bcr.toFixed(2)}, net benefit ${formatNumber(netBen, 0)}).`;
        if (supportBand === "high" || supportBand === "moderate") {
            overall = "This configuration offers a strong economic case with acceptable public support.";
        } else {
            overall = "Economically attractive, but political and communication strategies will be crucial given limited support.";
        }
    } else if (bcr >= 1 && netBen >= 0) {
        econPhrase = `Benefits slightly exceed costs (BCR ≈ ${bcr.toFixed(2)}, net benefit ${formatNumber(netBen, 0)}).`;
        overall = "This configuration is marginally favourable on economic grounds; design refinements could improve feasibility.";
    } else {
        econPhrase = `Costs meet or exceed benefits (BCR ≈ ${bcr.toFixed(2)}, net benefit ${formatNumber(netBen, 0)}).`;
        overall = "On current assumptions this design is not economically attractive; either benefits must increase or costs fall.";
    }

    el.innerHTML = `
        <p>${supportPhrase}</p>
        <p>${econPhrase}</p>
        <p>${overall}</p>
    `;
}

// Lives-saved equivalent interpretation text
function updateMRSInterpretation(config, livesEq) {
    const box = document.getElementById("mrs-text");
    const interp = document.getElementById("results-interpretation");
    const {country, scenario} = config;
    const labelScenario = scenario === "mild" ? "mild outbreak" : "severe outbreak";

    const sign = livesEq > 0 ? "reduces" : "increases";
    const livesAbs = Math.abs(livesEq);

    box.innerHTML = `
        <p>
            Relative to a benchmark mandate that is targeted to high-risk occupations, allows medical-only
            exemptions and lifts at 50% coverage, your chosen design is valued as equivalent to a
            <strong>${sign}</strong> in expected lives saved of about
            <strong>${formatNumber(livesAbs, 1)} per 100,000 people</strong> in ${country}
            under a ${labelScenario} scenario.
        </p>
        <p>
            A positive value means the public would, on average, require extra lives saved to accept your design;
            a negative value means your design is preferred even if it saved slightly fewer lives.
        </p>
    `;

    const mrs = mrsValues[country][scenario];

    const scopeMsg = mrs.scopeAll > 0
        ? "Broad, population-wide mandates are less preferred than targeted mandates unless they deliver additional lives saved."
        : "Under this framing, broad mandates become more attractive and can be preferred even without extra lives saved.";

    const exMsg = "Broader exemptions (especially personal-belief exemptions) are consistently seen as costly in lives-saved equivalent terms, reflecting a preference for stricter, more focused exemption rules.";

    const covMsg = "Higher coverage thresholds before lifting mandates (70% and especially 90%) are valued positively, indicating support for keeping mandates in place until high population coverage is reached.";

    interp.innerHTML = `
        <p>
            In <strong>${country}</strong> under a <strong>${labelScenario}</strong> scenario, moving from
            high-risk-only scope to a mandate covering all occupations and public spaces corresponds to a
            lives-saved equivalent of about
            <strong>${formatNumber(mrs.scopeAll, 2)} lives per 100,000</strong>.
        </p>
        <p>
            Allowing medical + religious exemptions is equivalent to about
            <strong>${formatNumber(mrs.exMedRel, 2)} lives per 100,000</strong>, and allowing medical,
            religious and personal-belief exemptions corresponds to roughly
            <strong>${formatNumber(mrs.exMedRelPers, 2)} lives per 100,000</strong>.
            Moving the lifting threshold from 50% to 70% or 90% coverage has lives-saved equivalents of around
            <strong>${formatNumber(mrs.cov70, 2)}</strong> and <strong>${formatNumber(mrs.cov90, 2)}</strong>
            lives per 100,000 respectively.
        </p>
        <p>${scopeMsg}</p>
        <p>${exMsg}</p>
        <p>${covMsg}</p>
    `;
}

// Briefing text for emails / reports
function updateBriefingText(config) {
    const textarea = document.getElementById("results-briefing-text");

    const supportText = isFinite(config.supportPercent)
        ? `${config.supportPercent.toFixed(1)}%`
        : "not available";

    const econPart = isFinite(config.bcr)
        ? `Monetary benefits are estimated at ${formatNumber(config.monetaryBenefit, 0)}, compared with total mandate costs of ${formatNumber(config.totalCost, 0)}, yielding a net benefit of ${formatNumber(config.netBenefit, 0)} and a benefit–cost ratio (BCR) of ${config.bcr.toFixed(2)}.`
        : `Economic benefits and costs cannot yet be fully quantified because some cost inputs are missing or zero.`;

    const txt = `
Over a ${config.periodYears}-year evaluation period, we assessed a vaccine mandate in ${config.country} under a ${config.scenarioLabel.toLowerCase()} scenario. The mandate is ${config.scope === "all" ? "broad, covering all occupations and public spaces" : "targeted to high-risk occupations"}, allows ${config.exemptions === "medical" ? "medical-only exemptions" : config.exemptions === "medRel" ? "medical and religious exemptions" : "medical, religious and personal-belief exemptions"}, and is lifted once ${config.coverage}% of the population is vaccinated.

Under the current assumptions, the mandate is expected to save around ${formatNumber(config.totalLivesSaved, 0)} lives in the exposed population (corresponding to ${formatNumber(config.livesPer100k, 1)} lives saved per 100,000 people). Using a value per life saved of ${formatNumber(config.vsl, 0)}, this translates into substantial aggregate health benefits.

Model-based estimates from the MandEval discrete choice experiment suggest that approximately ${supportText} of respondents would support this mandate over a “no mandate” option in the selected outbreak context. ${econPart}

Taken together, these results indicate that the proposed mandate design offers ${config.bcr >= 1 && config.netBenefit > 0 ? "a favourable" : "a mixed"} balance between effectiveness, public acceptability and economic value. Decision-makers can adjust the scope, exemption rules or lifting threshold within the tool to explore alternative designs and their implications for public support, lives saved and value for money.
    `.trim();

    textarea.value = txt;
}

// --- Saved scenarios --------------------------------------------------------

function addScenarioToTable() {
    const tbody = document.getElementById("savedScenariosTableBody");
    tbody.innerHTML = "";
    state.savedScenarios.forEach((sc, index) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>
                <input type="radio" name="selectedScenario" value="${index}">
            </td>
            <td>${sc.name}</td>
            <td>${sc.country}</td>
            <td>${sc.scenarioLabel}</td>
            <td>${sc.scope === "all" ? "All occupations & public spaces" : "High-risk only"}</td>
            <td>${
                sc.exemptions === "medical"
                    ? "Medical only"
                    : sc.exemptions === "medRel"
                        ? "Medical + religious"
                        : "Medical + religious + personal"
            }</td>
            <td>${sc.coverage}%</td>
            <td>${formatNumber(sc.livesPer100k, 1)}</td>
            <td>${isFinite(sc.supportPercent) ? sc.supportPercent.toFixed(1) : "–"}</td>
            <td>${isFinite(sc.bcr) ? sc.bcr.toFixed(2) : "–"}</td>
        `;
        tbody.appendChild(tr);
    });
}

function getSelectedScenario() {
    const radios = document.querySelectorAll('input[name="selectedScenario"]');
    let idx = null;
    radios.forEach(r => {
        if (r.checked) idx = parseInt(r.value, 10);
    });
    if (idx === null || idx < 0 || idx >= state.savedScenarios.length) return null;
    return state.savedScenarios[idx];
}

// --- Exports & AI prompt ----------------------------------------------------

function generateScenarioSummary(sc) {
    const supportText = isFinite(sc.supportPercent)
        ? sc.supportPercent.toFixed(1) + "%"
        : "not available";

    const econPart = isFinite(sc.bcr)
        ? `Benefit–cost ratio (BCR): ${sc.bcr.toFixed(2)}; net benefit: ${formatNumber(sc.netBenefit, 0)}.`
        : `BCR and net benefit not available – some cost inputs are zero or missing.`;

    return `
Scenario name: ${sc.name}
Country: ${sc.country}
Outbreak scenario: ${sc.scenarioLabel}
Mandate scope: ${sc.scope === "all" ? "All occupations and public spaces" : "High-risk occupations only"}
Exemptions: ${
        sc.exemptions === "medical"
            ? "Medical only"
            : sc.exemptions === "medRel"
                ? "Medical + religious"
                : "Medical + religious + personal-belief"
    }
Coverage threshold to lift mandate: ${sc.coverage}% vaccinated
Expected lives saved per 100,000 people: ${sc.livesPer100k.toFixed(1)}
Population exposed: ${formatNumber(sc.population, 0)}
Evaluation period: ${sc.periodYears} year(s)
Total lives saved over period: ${formatNumber(sc.totalLivesSaved, 0)}
Value per life saved (VSL basis): ${formatNumber(sc.vsl, 0)}
Total monetary benefit: ${formatNumber(sc.monetaryBenefit, 0)}
Total mandate-related cost: ${formatNumber(sc.totalCost, 0)}
Model-based public support (MandEval mixed logit): ${supportText}
${econPart}
    `.trim();
}

function exportScenarioAsPlainPdf(sc, brief = false) {
    // Basic export using jsPDF if available; fallback to a text download
    const summary = generateScenarioSummary(sc);
    if (typeof window.jspdf !== "undefined" || typeof window.jsPDF !== "undefined") {
        const {jsPDF} = window.jspdf || window;
        const doc = new jsPDF();
        const marginLeft = 14;
        const marginTop = 16;
        const maxWidth = 180;
        let y = marginTop;

        const title = brief ? "MandEval – Brief Scenario Summary" : "MandEval – Scenario Summary";
        doc.setFontSize(14);
        doc.text(title, marginLeft, y);
        y += 8;

        doc.setFontSize(10);
        const lines = doc.splitTextToSize(summary, maxWidth);
        lines.forEach(line => {
            if (y > 280) {
                doc.addPage();
                y = marginTop;
            }
            doc.text(line, marginLeft, y);
            y += 5;
        });

        if (brief) {
            // Page 2: enablers and risks
            doc.addPage();
            y = marginTop;
            doc.setFontSize(12);
            doc.text("Enablers and risks (for discussion)", marginLeft, y);
            y += 8;
            doc.setFontSize(10);

            const enablers = [];
            if (isFinite(sc.supportPercent) && sc.supportPercent >= 60) {
                enablers.push("Relatively high predicted public support in this context.");
            } else {
                enablers.push("Mandate design can be communicated as evidence-based and proportionate.");
            }
            if (isFinite(sc.bcr) && sc.bcr >= 1) {
                enablers.push("Economic benefits are at least as large as costs.");
            }
            enablers.push("Design features can be adjusted (scope, exemptions, lifting threshold) to respond to stakeholder feedback.");

            const risks = [];
            if (isFinite(sc.supportPercent) && sc.supportPercent < 50) {
                risks.push("Limited predicted public support; risk of political or social resistance.");
            }
            if (isFinite(sc.bcr) && sc.bcr < 1) {
                risks.push("On current assumptions, the mandate may not be cost-effective.");
            }
            risks.push("Implementation capacity (verification, enforcement, communication) may constrain scaling.");

            const bulletLines = [
                "Enablers:",
                ...enablers.map(e => "- " + e),
                "",
                "Risks:",
                ...risks.map(r => "- " + r)
            ];
            bulletLines.forEach(line => {
                if (y > 280) {
                    doc.addPage();
                    y = marginTop;
                }
                doc.text(line, marginLeft, y);
                y += 5;
            });
        }

        const fileName = brief
            ? `MandEval_${sc.name}_brief.pdf`
            : `MandEval_${sc.name}.pdf`;
        doc.save(fileName);
        showToast("PDF export generated.", "success");
    } else {
        // Fallback: download as .txt with a .pdf-ish name
        const blob = new Blob([summary], {type: "text/plain"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = brief
            ? `MandEval_${sc.name}_brief.txt`
            : `MandEval_${sc.name}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast("Simple text export generated (PDF library not available).", "warning");
    }
}

function exportScenarioAsWord(sc) {
    const summary = generateScenarioSummary(sc);
    const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>MandEval Scenario</title></head>
<body>
<h2>MandEval – Scenario summary</h2>
<pre style="font-family: 'Segoe UI', sans-serif; font-size: 11pt;">${summary}</pre>
</body>
</html>
    `.trim();

    const blob = new Blob([html], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `MandEval_${sc.name}.doc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("Word document exported.", "success");
}

function generateAiPrompt(sc) {
    const summary = generateScenarioSummary(sc);
    return `
You are assisting with the interpretation of a vaccine mandate decision analysis tool (MandEval). The tool combines discrete choice experiment (DCE) evidence on public preferences with epidemiological and costing assumptions.

Please read the scenario summary below and then:
1. Explain in clear, non-technical language how the public is likely to view this mandate design (support, concerns, perceived fairness).
2. Comment on the trade-offs between scope, exemptions, lifting threshold and expected lives saved.
3. Comment on the economic case (benefits, costs, net benefit, BCR) and any distributional or equity issues that may arise.
4. Suggest 3–5 practical messaging points or design refinements that could improve both acceptability and value for money.

Scenario summary:
${summary}
    `.trim();
}

// --- Event handlers ---------------------------------------------------------

function handleApplyConfiguration() {
    const country = document.getElementById("config-country").value;
    const scenarioValue = document.getElementById("config-outbreak").value;
    const scenarioLabel = scenarioValue === "mild" ? "Mild outbreak" : "Severe outbreak";
    const scope = getSelectedScope();
    const exemptions = document.getElementById("config-exemptions").value;
    const coverage = parseInt(document.getElementById("config-coverage").value, 10);
    const livesPer100k = parseFloat(document.getElementById("config-lives").value) || 0;

    const periodYears = parseInt(document.getElementById("settings-period").value, 10) || 1;
    const population = parseFloat(document.getElementById("settings-population").value) || 0;
    const vslBasis = document.getElementById("settings-vsl-basis").value;
    const vsl = parseFloat(document.getElementById("settings-vsl-value").value) || 0;

    const costSetupPerMillion = parseFloat(document.getElementById("cost-setup-per-million").value) || 0;
    const costAdminPerPersonPerYear = parseFloat(document.getElementById("cost-admin-per-person-per-year").value) || 0;
    const costEnforcePerPersonPerYear = parseFloat(document.getElementById("cost-enforce-per-person-per-year").value) || 0;
    const costCommsPerPerson = parseFloat(document.getElementById("cost-comms-per-person").value) || 0;
    const costOtherPerPerson = parseFloat(document.getElementById("cost-other-per-person").value) || 0;

    const support = computePredictedSupport(country, scenarioValue, scope, exemptions, coverage, livesPer100k);
    const supportPercent = support != null ? support * 100 : NaN;

    const econ = computeEconomics({
        periodYears,
        population,
        livesPer100k,
        vsl,
        costSetupPerMillion,
        costAdminPerPersonPerYear,
        costEnforcePerPersonPerYear,
        costCommsPerPerson,
        costOtherPerPerson
    });

    const config = {
        name: `${country}-${scenarioLabel}-${Date.now()}`,
        country,
        scenario: scenarioValue,
        scenarioLabel,
        scope,
        exemptions,
        coverage,
        livesPer100k,
        periodYears,
        population,
        vsl,
        supportPercent,
        totalLivesSaved: econ.totalLivesSaved,
        monetaryBenefit: econ.monetaryBenefit,
        totalCost: econ.totalCost,
        netBenefit: econ.netBenefit,
        bcr: econ.bcr,
        costSetupPerMillion,
        costAdminPerPersonPerYear,
        costEnforcePerPersonPerYear,
        costCommsPerPerson,
        costOtherPerPerson
    };

    state.currentConfig = config;

    updateConfigSummary(config);
    updateHeadlineRecommendation(config);

    // KPI cards
    document.getElementById("kpi-lives-per-100k").textContent = formatNumber(livesPer100k, 1);
    document.getElementById("kpi-total-lives").textContent = formatNumber(econ.totalLivesSaved, 0);
    document.getElementById("kpi-support").textContent = isFinite(supportPercent)
        ? supportPercent.toFixed(1) + "%"
        : "–";
    document.getElementById("kpi-benefit").textContent = formatNumber(econ.monetaryBenefit, 0);
    document.getElementById("kpi-cost").textContent = formatNumber(econ.totalCost, 0);
    document.getElementById("kpi-net-bcr").textContent = isFinite(econ.bcr)
        ? `${formatNumber(econ.netBenefit, 0)} (BCR ${econ.bcr.toFixed(2)})`
        : "–";

    // Charts
    renderSupportChart(config);
    renderBenefitCostChart({
        monetaryBenefit: econ.monetaryBenefit,
        totalCost: econ.totalCost
    });

    // Config-level MRS and attribute-level MRS
    const livesEq = computeConfigMRS(config);
    updateMRSInterpretation(config, livesEq);
    renderMRSChart(config);

    // Briefing text
    updateBriefingText(config);

    showToast("Configuration applied.", "success");
}

function handleSaveScenario() {
    if (!state.currentConfig) {
        showToast("Please apply a configuration before saving a scenario.", "warning");
        return;
    }

    const cfg = state.currentConfig;

    // Simple, readable name
    const name = `${cfg.country} – ${cfg.scenarioLabel} – ${cfg.scope === "all" ? "Population-wide" : "High-risk"} – ${cfg.coverage}%`;

    const scenario = {
        ...cfg,
        name
    };

    state.savedScenarios.push(scenario);
    addScenarioToTable();
    showToast("Scenario saved.", "success");
}

function handleCopyBriefing() {
    const text = document.getElementById("results-briefing-text").value || "";
    if (!navigator.clipboard) {
        showToast("Clipboard not available in this browser.", "warning");
        return;
    }
    navigator.clipboard.writeText(text)
        .then(() => showToast("Briefing text copied.", "success"))
        .catch(() => showToast("Unable to copy briefing text.", "error"));
}

function handleExportStandardPdf() {
    const sc = getSelectedScenario();
    if (!sc) {
        showToast("Please select a scenario first.", "warning");
        return;
    }
    exportScenarioAsPlainPdf(sc, false);
}

function handleExportBriefPdf() {
    const sc = getSelectedScenario();
    if (!sc) {
        showToast("Please select a scenario first.", "warning");
        return;
    }
    exportScenarioAsPlainPdf(sc, true);
}

function handleExportWord() {
    const sc = getSelectedScenario();
    if (!sc) {
        showToast("Please select a scenario first.", "warning");
        return;
    }
    exportScenarioAsWord(sc);
}

function handleCopyAiPrompt() {
    const sc = getSelectedScenario() || state.currentConfig;
    if (!sc) {
        showToast("Apply a configuration or select a saved scenario first.", "warning");
        return;
    }
    const prompt = generateAiPrompt(sc);
    if (!navigator.clipboard) {
        showToast("Clipboard not available in this browser.", "warning");
        return;
    }
    navigator.clipboard.writeText(prompt)
        .then(() => showToast("AI interpretation prompt copied.", "success"))
        .catch(() => showToast("Unable to copy AI prompt.", "error"));
}

function handleOpenCopilot() {
    window.open("https://copilot.microsoft.com/", "_blank");
}

function handleOpenChatgpt() {
    window.open("https://chat.openai.com/", "_blank");
}

// Lives-slider two-way binding
function setupLivesSliderBinding() {
    const slider = document.getElementById("config-lives");
    const input = document.getElementById("config-lives-input");

    slider.addEventListener("input", () => {
        input.value = slider.value;
    });

    input.addEventListener("input", () => {
        let val = parseFloat(input.value);
        if (isNaN(val)) val = 0;
        if (val < parseFloat(slider.min)) val = parseFloat(slider.min);
        if (val > parseFloat(slider.max)) val = parseFloat(slider.max);
        slider.value = val;
    });
}

// Default scenarios – one per country, severe outbreak, population-wide, medical-only, 90% coverage
function seedDefaultScenarios() {
    const countries = ["Australia", "France", "Italy"];
    countries.forEach(country => {
        const scenarioValue = "severe";
        const scenarioLabel = "Severe outbreak";
        const scope = "all";
        const exemptions = "medical";
        const coverage = 90;
        const livesPer100k = 40; // top of DCE range
        const periodYears = parseInt(document.getElementById("settings-period").value, 10) || 3;
        const population = 1000000;

        // Temporarily set country to pick VSL and costs
        applyDefaultVslAndCosts(country);
        const vsl = parseFloat(document.getElementById("settings-vsl-value").value) || 0;

        const costSetupPerMillion = parseFloat(document.getElementById("cost-setup-per-million").value) || 0;
        const costAdminPerPersonPerYear = parseFloat(document.getElementById("cost-admin-per-person-per-year").value) || 0;
        const costEnforcePerPersonPerYear = parseFloat(document.getElementById("cost-enforce-per-person-per-year").value) || 0;
        const costCommsPerPerson = parseFloat(document.getElementById("cost-comms-per-person").value) || 0;
        const costOtherPerPerson = parseFloat(document.getElementById("cost-other-per-person").value) || 0;

        const support = computePredictedSupport(country, scenarioValue, scope, exemptions, coverage, livesPer100k);
        const supportPercent = support != null ? support * 100 : NaN;

        const econ = computeEconomics({
            periodYears,
            population,
            livesPer100k,
            vsl,
            costSetupPerMillion,
            costAdminPerPersonPerYear,
            costEnforcePerPersonPerYear,
            costCommsPerPerson,
            costOtherPerPerson
        });

        const sc = {
            name: `${country} – Severe – Population-wide – 90%`,
            country,
            scenario: scenarioValue,
            scenarioLabel,
            scope,
            exemptions,
            coverage,
            livesPer100k,
            periodYears,
            population,
            vsl,
            supportPercent,
            totalLivesSaved: econ.totalLivesSaved,
            monetaryBenefit: econ.monetaryBenefit,
            totalCost: econ.totalCost,
            netBenefit: econ.netBenefit,
            bcr: econ.bcr,
            costSetupPerMillion,
            costAdminPerPersonPerYear,
            costEnforcePerPersonPerYear,
            costCommsPerPerson,
            costOtherPerPerson
        };

        state.savedScenarios.push(sc);
    });

    addScenarioToTable();
}

// --- Initialisation ---------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    setupTabs();
    setupLivesSliderBinding();

    // Country / settings linkage
    const countrySelect = document.getElementById("config-country");
    const vslBasisSelect = document.getElementById("settings-vsl-basis");

    countrySelect.addEventListener("change", () => {
        applyDefaultVslAndCosts(countrySelect.value);
    });

    vslBasisSelect.addEventListener("change", () => {
        applyDefaultVslAndCosts(countrySelect.value);
    });

    // Initial defaults for Australia
    applyDefaultVslAndCosts("Australia");

    // Buttons
    document.getElementById("applyConfigBtn").addEventListener("click", handleApplyConfiguration);
    document.getElementById("saveScenarioBtn").addEventListener("click", handleSaveScenario);
    document.getElementById("copyBriefingBtn").addEventListener("click", handleCopyBriefing);

    document.getElementById("exportStandardPdfBtn").addEventListener("click", handleExportStandardPdf);
    document.getElementById("exportBriefPdfBtn").addEventListener("click", handleExportBriefPdf);
    document.getElementById("exportWordBtn").addEventListener("click", handleExportWord);

    document.getElementById("copyAiPromptBtn").addEventListener("click", handleCopyAiPrompt);
    document.getElementById("openCopilotBtn").addEventListener("click", handleOpenCopilot);
    document.getElementById("openChatgptBtn").addEventListener("click", handleOpenChatgpt);

    // Seed default scenarios
    seedDefaultScenarios();

    showToast("MandEval tool loaded. Configure a mandate and click Apply configuration.", "success");
});
