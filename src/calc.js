// BTL calculation engine — mirrors the Excel workbook exactly.
// Pure functions, no React, so it can be unit-tested against the spreadsheet.

// Monthly repayment mortgage payment (Excel PMT equivalent), returned as a
// positive number. annualRate as decimal (0.055), termYears in years.
export function monthlyMortgagePayment(loan, annualRate, termYears) {
  const r = annualRate / 12;
  const n = termYears * 12;
  if (loan <= 0) return 0;
  if (r === 0) return loan / n;
  return (loan * r) / (1 - Math.pow(1 + r, -n));
}

// Default global assumptions — same starting values as the Assumptions tab.
export const defaultAssumptions = {
  equityReleased: 30000,
  extraSavings: 5000,
  erMonthly: 150,
  depositPct: 0.25,
  rate: 0.055,
  termYears: 25,
  sdltRate: 0.05,
  legal: 1500,
  survey: 600,
  arrangement: 999,
  broker: 500,
  misc: 500,
  agentPct: 0.10,
  insurance: 300,
  maintPct: 0.08,
  voidsPct: 0.05,
  compliance: 200,
  // targets
  targetSelf: 200,
  targetAgent: 100,
  minYield: 0.08,
  maxBudget: 100000,
};

export function totalCapital(a) {
  return a.equityReleased + a.extraSavings;
}

// Compute every figure for one property given the global assumptions.
// `p` holds the per-property inputs (offer, asking, rent, refurb, etc.).
export function analyseProperty(p, a) {
  const offer = num(p.offer);
  const asking = num(p.asking);
  const rent = num(p.rent);
  const refurb = num(p.refurb);

  // A property with no purchase price entered is treated as a blank slate —
  // we don't want fixed costs producing misleading figures on a £0 deal.
  const isEmpty = offer <= 0;

  // Acquisition costs
  const sdlt = offer * a.sdltRate;
  const acqCosts = sdlt + a.legal + a.survey + a.arrangement + a.broker + a.misc + refurb;
  const totalAcqCost = offer + acqCosts;

  // Finance
  const deposit = offer * a.depositPct;
  const loan = offer - deposit;
  const cashIn = deposit + acqCosts;
  const capitalRemaining = totalCapital(a) - cashIn;

  // Income
  const annualRent = rent * 12;

  // Running costs (annual)
  const mortgageAnnual = monthlyMortgagePayment(loan, a.rate, a.termYears) * 12;
  const agentFee = annualRent * a.agentPct;
  const maintenance = annualRent * a.maintPct;
  const voids = annualRent * a.voidsPct;
  const erAnnual = a.erMonthly * 12;

  // Cashflow — equity-release carry cost is included, matching the workbook
  const cashflowSelfAnnual =
    annualRent - mortgageAnnual - a.insurance - maintenance - voids - a.compliance - erAnnual;
  const cashflowSelfPcm = cashflowSelfAnnual / 12;
  const cashflowAgentAnnual = cashflowSelfAnnual - agentFee;
  const cashflowAgentPcm = cashflowAgentAnnual / 12;

  // Returns
  const grossYield = offer > 0 ? annualRent / offer : 0;
  const netYield = totalAcqCost > 0 ? (cashflowSelfAnnual + erAnnual) / totalAcqCost : 0;
  const roi = cashIn > 0 ? cashflowSelfAnnual / cashIn : 0;

  // Target checks
  const hitsSelf = cashflowSelfPcm >= a.targetSelf;
  const hitsAgent = cashflowAgentPcm >= a.targetAgent;
  const hitsYield = grossYield >= a.minYield;
  const withinBudget = offer > 0 && offer <= a.maxBudget;

  return {
    isEmpty,
    offer, asking, rent, refurb,
    sdlt, acqCosts, totalAcqCost,
    deposit, loan, cashIn, capitalRemaining,
    annualRent, mortgageAnnual, agentFee, maintenance, voids, erAnnual,
    cashflowSelfAnnual, cashflowSelfPcm, cashflowAgentAnnual, cashflowAgentPcm,
    grossYield, netYield, roi,
    hitsSelf, hitsAgent, hitsYield, withinBudget,
  };
}

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export const gbp = (v) =>
  (v < 0 ? "-" : "") + "£" + Math.abs(Math.round(v)).toLocaleString("en-GB");

export const pct = (v) => (v * 100).toFixed(1) + "%";
