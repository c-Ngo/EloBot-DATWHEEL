const config = require('../config');

const PLATFORM_TO_REGION = {
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas', oc1: 'americas',
  kr: 'asia', jp1: 'asia',
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe',
  ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
};

/**
 * Lightweight Riot API client — no external HTTP library needed.
 * Uses native fetch (Node 18+).
 */
class RiotAPI {
  constructor() {
    this.apiKey = config.riotApiKey;
    this.defaultPlatform = config.riotPlatform;
  }

  // ── Internal ──────────────────────────────────

  _regionForPlatform(platform) {
    return PLATFORM_TO_REGION[platform] || config.riotRegion;
  }

  async _fetch(url) {
    const res = await fetch(url, {
      headers: { 'X-Riot-Token': this.apiKey },
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
      console.warn(`[RiotAPI] Rate limited — retrying in ${retryAfter}s`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this._fetch(url);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Riot API ${res.status}: ${body} — ${url}`);
    }

    return res.json();
  }

  // ── Account ───────────────────────────────────

  /**
   * Resolve a Riot ID (GameName#TagLine) to a PUUID.
   * Uses the regional routing value (americas/europe/asia/sea).
   */
  async getAccountByRiotId(gameName, tagLine, platform) {
    const region = this._regionForPlatform(platform || this.defaultPlatform);
    const url = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    return this._fetch(url);
  }

  // ── Summoner ──────────────────────────────────

  async getSummonerByPuuid(puuid, platform) {
    platform = platform || this.defaultPlatform;
    const url = `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`;
    return this._fetch(url);
  }

  // ── Match ─────────────────────────────────────

  /**
   * Get recent match IDs for a player.
   * @param {string} puuid
   * @param {number} count - number of match IDs (max 100)
   * @param {string} [platform]
   */
  async getMatchIds(puuid, count = 10, platform) {
    const region = this._regionForPlatform(platform || this.defaultPlatform);
    const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`;
    return this._fetch(url);
  }

  /**
   * Get full match data by match ID.
   */
  async getMatch(matchId, platform) {
    const region = this._regionForPlatform(platform || this.defaultPlatform);
    const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
    return this._fetch(url);
  }
}

module.exports = new RiotAPI();
