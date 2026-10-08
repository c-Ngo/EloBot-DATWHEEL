const {
  DEFAULTS,
  createRating,
  ordinal,
  toDisplayRating,
  fromSeedRating,
  predictWin,
  rateMatch,
} = require('./openskill');

/**
 * OpenSkill / TrueSkill rating engine with League of Legends role-weighted performance modifiers.
 *
 * Core principles:
 * 1. Bayesian skill estimation tracking player skill mean (mu) and uncertainty (sigma).
 * 2. Team vs team skill aggregation with natural underdog bonuses (less skill gained if favored team wins).
 * 3. Individual performance modifier (up to ±5%) adjusting skill change based on role-weighted stats.
 * 4. Conservative display rating (ordinal = mu - 3*sigma) scaled to standard MMR numbers.
 */

// Maximum personal performance adjustment (±5%)
const MAX_PERFORMANCE_MODIFIER = 0.05;

// ── Role-specific stat weights ──────────────────
const ROLE_WEIGHTS = {
  TOP: {
    kda: 0.25,
    damage_dealt: 0.25,
    damage_taken: 0.20,
    cs: 0.15,
    vision: 0.05,
    gold: 0.10,
  },
  JUNGLE: {
    kda: 0.30,
    damage_dealt: 0.15,
    damage_taken: 0.10,
    cs: 0.15,
    vision: 0.15,
    gold: 0.15,
  },
  MIDDLE: {
    kda: 0.25,
    damage_dealt: 0.30,
    damage_taken: 0.05,
    cs: 0.20,
    vision: 0.05,
    gold: 0.15,
  },
  BOTTOM: {
    kda: 0.25,
    damage_dealt: 0.30,
    damage_taken: 0.05,
    cs: 0.25,
    vision: 0.05,
    gold: 0.10,
  },
  SUPPORT: {
    kda: 0.30,
    damage_dealt: 0.05,
    damage_taken: 0.10,
    cs: 0.00,
    vision: 0.35,
    gold: 0.20,
  },
};
ROLE_WEIGHTS.UTILITY = ROLE_WEIGHTS.SUPPORT;

const DEFAULT_WEIGHTS = {
  kda: 0.30,
  damage_dealt: 0.20,
  damage_taken: 0.10,
  cs: 0.15,
  vision: 0.10,
  gold: 0.15,
};

/**
 * Calculate a z-score-like performance percentile relative to all 10 players.
 *
 * @param {object} playerStats - { kills, deaths, assists, cs, vision_score, damage_dealt, damage_taken, gold_earned }
 * @param {object[]} allPlayerStats - array of all 10 players' stats in the same shape
 * @param {string} role - player's role
 * @returns {number} performance modifier between -0.05 and +0.05
 */
function calculatePerformanceModifier(playerStats, allPlayerStats, role) {
  const normalizedRole = role ? (role.toUpperCase() === 'UTILITY' ? 'SUPPORT' : role.toUpperCase()) : '';
  const weights = ROLE_WEIGHTS[normalizedRole] || DEFAULT_WEIGHTS;

  function percentile(statFn) {
    const values = allPlayerStats.map(statFn).sort((a, b) => a - b);
    const playerVal = statFn(playerStats);
    const rank = values.filter((v) => v < playerVal).length;
    return rank / (values.length - 1 || 1); // 0 = worst, 1 = best
  }

  const kda = (playerStats.kills + playerStats.assists) / Math.max(1, playerStats.deaths);
  const allKdas = allPlayerStats.map(
    (p) => (p.kills + p.assists) / Math.max(1, p.deaths)
  );
  const kdaSorted = [...allKdas].sort((a, b) => a - b);
  const kdaPerc = kdaSorted.filter((v) => v < kda).length / (kdaSorted.length - 1 || 1);

  const dmgPerc = percentile((p) => p.damage_dealt);
  const tankPerc = percentile((p) => p.damage_taken);
  const csPerc = percentile((p) => p.cs);
  const visPerc = percentile((p) => p.vision_score);
  const goldPerc = percentile((p) => p.gold_earned);

  const composite =
    weights.kda * kdaPerc +
    weights.damage_dealt * dmgPerc +
    weights.damage_taken * tankPerc +
    weights.cs * csPerc +
    weights.vision * visPerc +
    weights.gold * goldPerc;

  // Map [0..1] → [-0.05 .. +0.05] (±5% personal performance modifier)
  return (composite - 0.5) * (MAX_PERFORMANCE_MODIFIER * 2);
}

/**
 * Calculate OpenSkill / TrueSkill rating changes for all players in a match.
 *
 * @param {object[]} team1 - array of { discord_id, mu, sigma, role, stats: {...} }
 * @param {object[]} team2 - same shape
 * @param {number} winningTeam - 1 or 2
 * @returns {{ results: object[], winProbBlue: number, winProbRed: number }}
 */
function calculateSkillChanges(team1, team2, winningTeam) {
  const team1Ratings = team1.map((p) => createRating({ mu: p.mu, sigma: p.sigma }));
  const team2Ratings = team2.map((p) => createRating({ mu: p.mu, sigma: p.sigma }));

  // Pre-match win probability
  const winProbBlue = predictWin(team1Ratings, team2Ratings);
  const winProbRed = 1.0 - winProbBlue;

  // Run Weng-Lin / TrueSkill Bayesian update
  const { team1: updatedT1, team2: updatedT2 } = rateMatch(
    team1Ratings,
    team2Ratings,
    winningTeam
  );

  const allStats = [...team1, ...team2].map((p) => p.stats);
  const results = [];

  function processPlayer(player, originalRating, bayesianRating, teamNum) {
    const won = teamNum === winningTeam;
    const oldMu = originalRating.mu;
    const oldSigma = originalRating.sigma;

    const baseDeltaMu = bayesianRating.mu - oldMu;
    const perfMod = calculatePerformanceModifier(player.stats, allStats, player.role);

    // Apply performance modifier:
    // If won, positive perfMod boosts gain; negative perfMod reduces gain
    // If lost, positive perfMod cushions loss; negative perfMod deepens loss
    const adjustedDeltaMu = won
      ? baseDeltaMu * (1 + perfMod)
      : baseDeltaMu * (1 - perfMod);

    const newMu = Math.max(1.0, oldMu + adjustedDeltaMu);
    const newSigma = bayesianRating.sigma;

    const ordBefore = ordinal({ mu: oldMu, sigma: oldSigma });
    const ordAfter = ordinal({ mu: newMu, sigma: newSigma });
    const ordDelta = ordAfter - ordBefore;

    const ratingBefore = toDisplayRating({ mu: oldMu, sigma: oldSigma });
    const ratingAfter = toDisplayRating({ mu: newMu, sigma: newSigma });
    const ratingDelta = ratingAfter - ratingBefore;

    results.push({
      discord_id: player.discord_id,
      // OpenSkill / TrueSkill primitives
      muBefore: Math.round(oldMu * 100) / 100,
      muAfter: Math.round(newMu * 100) / 100,
      muDelta: Math.round((newMu - oldMu) * 100) / 100,
      sigmaBefore: Math.round(oldSigma * 100) / 100,
      sigmaAfter: Math.round(newSigma * 100) / 100,
      ordinalBefore: Math.round(ordBefore * 100) / 100,
      ordinalAfter: Math.round(ordAfter * 100) / 100,
      ordinalDelta: Math.round(ordDelta * 100) / 100,

      // Scaled Display MMR
      ratingBefore,
      ratingAfter,
      ratingDelta,

      // Backward compatibility aliases
      eloBefore: ratingBefore,
      eloAfter: ratingAfter,
      eloDelta: ratingDelta,

      performanceMod: Math.round(perfMod * 1000) / 1000,
      won,
    });
  }

  team1.forEach((p, idx) => processPlayer(p, team1Ratings[idx], updatedT1[idx], 1));
  team2.forEach((p, idx) => processPlayer(p, team2Ratings[idx], updatedT2[idx], 2));

  return {
    results,
    winProbBlue: Math.round(winProbBlue * 100),
    winProbRed: Math.round(winProbRed * 100),
  };
}

module.exports = {
  calculateSkillChanges,
  calculateEloChanges: (t1, t2, w) => calculateSkillChanges(t1, t2, w).results,
  calculatePerformanceModifier,
  MAX_PERFORMANCE_MODIFIER,
  ROLE_WEIGHTS,
  DEFAULTS,
  createRating,
  ordinal,
  toDisplayRating,
  fromSeedRating,
  predictWin,
};
