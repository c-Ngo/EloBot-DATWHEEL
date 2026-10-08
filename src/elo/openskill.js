/**
 * Pure JavaScript implementation of the OpenSkill / TrueSkill (Weng-Lin) rating algorithm.
 * Based on Weng & Lin (2011): "A Bayesian Approximation Method for Online Ranking"
 * Patent-free, zero-dependency, compatible with all Node.js versions.
 */

// ── Default Constants ───────────────────────────
const DEFAULTS = {
  MU: 25.0,                         // Initial skill mean
  SIGMA: 25.0 / 3.0,                // Initial uncertainty (~8.333)
  BETA: 25.0 / 6.0,                 // Skill difference scale (~4.167)
  TAU: 25.0 / 300.0,                // Additive dynamics / uncertainty drift (~0.0833)
  Z: 3.0,                           // 99.7% confidence multiplier for ordinal (mu - z * sigma)
  KAPPA: 1e-4,                      // Minimum variance floor
  SCALE_BASE: 1000,                 // Base display rating (MMR)
  SCALE_MULT: 40,                   // Multiplier per ordinal unit for display rating
};

// ── Math Helpers ────────────────────────────────
const SQRT_2 = Math.SQRT2;
const SQRT_2PI = Math.sqrt(2 * Math.PI);

/**
 * Standard Normal Probability Density Function (PDF)
 */
function pdf(x) {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/**
 * Error Function (erf) approximation (Abramowitz & Stegun 7.1.26, max error < 1.5e-7)
 */
function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  const a = Math.abs(x);

  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;

  const t = 1.0 / (1.0 + p * a);
  const y = 1.0 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-a * a);

  return sign * y;
}

/**
 * Standard Normal Cumulative Distribution Function (CDF): Phi(x)
 */
function cdf(x) {
  return 0.5 * (1.0 + erf(x / SQRT_2));
}

// ── Core OpenSkill Functions ────────────────────

/**
 * Create or validate a player rating object { mu, sigma }.
 */
function createRating(init = {}) {
  return {
    mu: typeof init.mu === 'number' ? init.mu : DEFAULTS.MU,
    sigma: typeof init.sigma === 'number' ? init.sigma : DEFAULTS.SIGMA,
  };
}

/**
 * Calculate conservative ordinal rating: mu - Z * sigma.
 * Represents a 99.7% confidence lower bound of true skill.
 */
function ordinal(rating, z = DEFAULTS.Z) {
  const mu = typeof rating.mu === 'number' ? rating.mu : DEFAULTS.MU;
  const sigma = typeof rating.sigma === 'number' ? rating.sigma : DEFAULTS.SIGMA;
  return mu - z * sigma;
}

/**
 * Convert OpenSkill (mu, sigma) to an intuitive display MMR (e.g. ~1000 base).
 */
function toDisplayRating(rating) {
  const ord = ordinal(rating);
  return Math.round(DEFAULTS.SCALE_BASE + ord * DEFAULTS.SCALE_MULT);
}

/**
 * Convert a seed rating (e.g. 1000, 1200) into initial (mu, sigma).
 */
function fromSeedRating(seedRating) {
  const ratingVal = typeof seedRating === 'number' ? seedRating : DEFAULTS.SCALE_BASE;
  const delta = (ratingVal - DEFAULTS.SCALE_BASE) / DEFAULTS.SCALE_MULT;
  return {
    mu: Math.max(5.0, DEFAULTS.MU + delta),
    sigma: DEFAULTS.SIGMA,
  };
}

/**
 * Predict win probability of Team 1 vs Team 2 in TrueSkill / OpenSkill.
 *
 * @param {Array<{mu: number, sigma: number}>} team1
 * @param {Array<{mu: number, sigma: number}>} team2
 * @returns {number} probability between 0 and 1 that Team 1 wins
 */
function predictWin(team1, team2, beta = DEFAULTS.BETA) {
  const mu1 = team1.reduce((sum, p) => sum + p.mu, 0);
  const mu2 = team2.reduce((sum, p) => sum + p.mu, 0);
  const sigSq1 = team1.reduce((sum, p) => sum + p.sigma * p.sigma, 0);
  const sigSq2 = team2.reduce((sum, p) => sum + p.sigma * p.sigma, 0);

  const denom = Math.sqrt(sigSq1 + sigSq2 + 2 * beta * beta);
  return cdf((mu1 - mu2) / denom);
}

/**
 * Rate a 2-team match using the Weng-Lin Plackett-Luce Bayesian model.
 *
 * @param {Array<{mu: number, sigma: number}>} team1 - Blue side players
 * @param {Array<{mu: number, sigma: number}>} team2 - Red side players
 * @param {number} winningTeam - 1 (Team 1 won) or 2 (Team 2 won)
 * @param {object} [options] - Optional parameter overrides (beta, tau, etc.)
 * @returns {{ team1: Array<{mu: number, sigma: number}>, team2: Array<{mu: number, sigma: number}> }}
 */
function rateMatch(team1, team2, winningTeam, options = {}) {
  const beta = options.beta ?? DEFAULTS.BETA;
  const tau = options.tau ?? DEFAULTS.TAU;
  const kappa = options.kappa ?? DEFAULTS.KAPPA;

  const tauSq = tau * tau;
  const betaSq = beta * beta;

  // 1. Apply uncertainty dynamics drift (tau)
  const procTeam1 = team1.map((p) => ({
    mu: p.mu,
    sigma: Math.sqrt(p.sigma * p.sigma + tauSq),
  }));
  const procTeam2 = team2.map((p) => ({
    mu: p.mu,
    sigma: Math.sqrt(p.sigma * p.sigma + tauSq),
  }));

  // 2. Team aggregate means and variances
  const mu1 = procTeam1.reduce((s, p) => s + p.mu, 0);
  const mu2 = procTeam2.reduce((s, p) => s + p.mu, 0);
  const sigSq1 = procTeam1.reduce((s, p) => s + p.sigma * p.sigma, 0);
  const sigSq2 = procTeam2.reduce((s, p) => s + p.sigma * p.sigma, 0);

  // 3. Match scale c
  const c = Math.sqrt(sigSq1 + sigSq2 + 2 * betaSq);

  // 4. Plackett-Luce logistic probabilities
  const team1Won = winningTeam === 1;
  const winnerMu = team1Won ? mu1 : mu2;
  const loserMu = team1Won ? mu2 : mu1;

  const eWin = Math.exp(winnerMu / c);
  const eLose = Math.exp(loserMu / c);
  const sumE = eWin + eLose;

  const pWin = eWin / sumE;
  const pLose = eLose / sumE; // 1 - pWin

  // Omega (mean delta factor) and Delta (variance shrinking factor)
  // Winner update factors
  const omegaWinTeam = (team1Won ? sigSq1 : sigSq2) / c * (1 - pWin);
  const deltaWinTeam = (team1Won ? sigSq1 : sigSq2) / (c * c) * pWin * (1 - pWin) * (Math.sqrt(team1Won ? sigSq1 : sigSq2) / c);

  // Loser update factors
  const omegaLoseTeam = -((team1Won ? sigSq2 : sigSq1) / c) * (1 - pWin);
  const deltaLoseTeam = (team1Won ? sigSq2 : sigSq1) / (c * c) * pWin * (1 - pWin) * (Math.sqrt(team1Won ? sigSq2 : sigSq1) / c);

  function updateTeamPlayers(procPlayers, teamSigSq, omegaTeam, deltaTeam) {
    return procPlayers.map((p) => {
      const pSigSq = p.sigma * p.sigma;
      const weight = pSigSq / teamSigSq;

      const newMu = p.mu + weight * omegaTeam;
      const newSigSq = pSigSq * Math.max(1.0 - weight * deltaTeam, kappa);

      return {
        mu: newMu,
        sigma: Math.sqrt(newSigSq),
      };
    });
  }

  const updatedTeam1 = team1Won
    ? updateTeamPlayers(procTeam1, sigSq1, omegaWinTeam, deltaWinTeam)
    : updateTeamPlayers(procTeam1, sigSq1, omegaLoseTeam, deltaLoseTeam);

  const updatedTeam2 = !team1Won
    ? updateTeamPlayers(procTeam2, sigSq2, omegaWinTeam, deltaWinTeam)
    : updateTeamPlayers(procTeam2, sigSq2, omegaLoseTeam, deltaLoseTeam);

  return {
    team1: updatedTeam1,
    team2: updatedTeam2,
    winProbTeam1: cdf((mu1 - mu2) / c),
  };
}

module.exports = {
  DEFAULTS,
  createRating,
  ordinal,
  toDisplayRating,
  fromSeedRating,
  predictWin,
  rateMatch,
  cdf,
  pdf,
  erf,
};
