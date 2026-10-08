const fs = require('fs');

/**
 * Parse a .rofl replay file and extract the embedded JSON metadata.
 *
 * ROFL files are binary replay archives with a JSON metadata block
 * embedded near the end of the file. The metadata starts with
 * `{"gameLength":` and contains a `statsJson` field — a JSON-encoded
 * string array of per-player stat objects (one per participant).
 *
 * @param {string|Buffer} input — file path (string) or raw Buffer
 * @returns {{ gameLength: number, players: object[] }}
 */
function parseRofl(input) {
  const buf = Buffer.isBuffer(input) ? input : fs.readFileSync(input);

  // Search for the JSON metadata block from the end of the file backwards
  // (it's near the tail of the binary). The marker is: {"gameLength":
  const marker = Buffer.from('{"gameLength":');
  let jsonStart = -1;

  // Search from the back — the metadata is usually in the last ~200KB
  const searchFrom = Math.max(0, buf.length - 300_000);
  for (let i = searchFrom; i < buf.length - marker.length; i++) {
    if (buf[i] === marker[0] && buf.subarray(i, i + marker.length).equals(marker)) {
      jsonStart = i;
      break;
    }
  }

  if (jsonStart === -1) {
    throw new Error('Could not find JSON metadata in .rofl file. The file may be corrupted or in an unsupported format.');
  }

  // Find the matching closing brace
  let depth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < buf.length; i++) {
    if (buf[i] === 0x7B) depth++;       // {
    else if (buf[i] === 0x7D) {          // }
      depth--;
      if (depth === 0) {
        jsonEnd = i;
        break;
      }
    }
  }

  if (jsonEnd === -1) {
    throw new Error('Malformed JSON metadata in .rofl file — could not find closing brace.');
  }

  const rawJson = buf.subarray(jsonStart, jsonEnd + 1).toString('utf-8');
  const metadata = JSON.parse(rawJson);

  // statsJson is a JSON-encoded string containing an array of player objects
  if (!metadata.statsJson) {
    throw new Error('ROFL metadata is missing the statsJson field.');
  }

  const playerStats = JSON.parse(metadata.statsJson);

  // Normalise each player into a clean object
  const players = playerStats.map((raw) => ({
    puuid: raw.PUUID || '',
    riotName: raw.RIOT_ID_GAME_NAME || '',
    tagLine: raw.RIOT_ID_TAG_LINE || '',
    fullRiotId: raw.RIOT_ID_GAME_NAME && raw.RIOT_ID_TAG_LINE
      ? `${raw.RIOT_ID_GAME_NAME}#${raw.RIOT_ID_TAG_LINE}`
      : raw.NAME || 'Unknown',
    team: parseInt(raw.TEAM, 10),               // 100 = blue, 200 = red
    champion: raw.SKIN || 'Unknown',
    role: (() => {
      const pos = raw.TEAM_POSITION || raw.INDIVIDUAL_POSITION || 'UNKNOWN';
      return pos.toUpperCase() === 'UTILITY' ? 'SUPPORT' : pos.toUpperCase();
    })(),
    won: raw.WIN === 'Win',

    // Core stats
    kills: parseInt(raw.CHAMPIONS_KILLED || '0', 10),
    deaths: parseInt(raw.NUM_DEATHS || '0', 10),
    assists: parseInt(raw.ASSISTS || '0', 10),
    cs: parseInt(raw.MINIONS_KILLED || '0', 10) + parseInt(raw.NEUTRAL_MINIONS_KILLED || '0', 10),
    visionScore: parseInt(raw.VISION_SCORE || '0', 10),
    damageDealt: parseInt(raw.TOTAL_DAMAGE_DEALT_TO_CHAMPIONS || '0', 10),
    damageTaken: parseInt(raw.TOTAL_DAMAGE_TAKEN || '0', 10),
    goldEarned: parseInt(raw.GOLD_EARNED || '0', 10),

    // Extra
    level: parseInt(raw.LEVEL || '0', 10),
    wardsPlaced: parseInt(raw.WARD_PLACED || '0', 10),
    wardsKilled: parseInt(raw.WARD_KILLED || '0', 10),
    doubleKills: parseInt(raw.DOUBLE_KILLS || '0', 10),
    tripleKills: parseInt(raw.TRIPLE_KILLS || '0', 10),
    quadraKills: parseInt(raw.QUADRA_KILLS || '0', 10),
    pentaKills: parseInt(raw.PENTA_KILLS || '0', 10),
  }));

  return {
    gameLength: Math.round(metadata.gameLength / 1000), // ms → seconds
    players,
  };
}

module.exports = { parseRofl };
