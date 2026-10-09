const db = require('./db');
const { fromSeedRating, ordinal: calcOrdinal } = require('../elo/openskill');
const eloEvents = require('../events/eloEvents');

// ──────────────────────────────────────────────
// Prepared Statements
// ──────────────────────────────────────────────
const stmts = {
  // Players
  upsertPlayer: db.prepare(`
    INSERT INTO players (
      discord_id, riot_puuid, riot_name,
      mu, sigma, ordinal, rating, peak_rating, elo, peak_elo
    ) VALUES (
      @discord_id, @riot_puuid, @riot_name,
      @mu, @sigma, @ordinal, @rating, @rating, @rating, @rating
    ) ON CONFLICT(discord_id) DO UPDATE SET
      riot_puuid = COALESCE(@riot_puuid, players.riot_puuid),
      riot_name  = @riot_name
  `),

  updatePlayerPuuid: db.prepare(`
    UPDATE players SET riot_puuid = ? WHERE discord_id = ?
  `),

  updatePlayerRiotName: db.prepare(`
    UPDATE players SET riot_name = ? WHERE discord_id = ?
  `),

  getPlayer: db.prepare(`SELECT * FROM players WHERE discord_id = ?`),
  getPlayerByPuuid: db.prepare(`SELECT * FROM players WHERE riot_puuid = ?`),

  findPlayerByRiotName: db.prepare(`
    SELECT * FROM players
    WHERE LOWER(riot_name) = LOWER(?)
       OR LOWER(riot_name) LIKE LOWER(?) || '#%'
       OR riot_puuid = ?
    LIMIT 1
  `),

  getAllPlayers: db.prepare(`
    SELECT * FROM players
    ORDER BY
      CASE WHEN (wins + losses) >= 5 THEN 1 ELSE 0 END DESC,
      rating DESC,
      ordinal DESC
  `),

  updateSkill: db.prepare(`
    UPDATE players
    SET mu          = @mu,
        sigma       = @sigma,
        ordinal     = @ordinal,
        rating      = @rating,
        peak_rating = MAX(peak_rating, @rating),
        elo         = @rating,
        peak_elo    = MAX(peak_elo, @rating),
        wins        = wins + @win_inc,
        losses      = losses + @loss_inc
    WHERE discord_id = @discord_id
  `),

  setSkill: db.prepare(`
    UPDATE players
    SET mu          = @mu,
        sigma       = @sigma,
        ordinal     = @ordinal,
        rating      = @rating,
        peak_rating = MAX(peak_rating, @rating),
        elo         = @rating,
        peak_elo    = MAX(peak_elo, @rating)
    WHERE discord_id = @discord_id
  `),

  // Matches
  insertMatch: db.prepare(`
    INSERT INTO matches (match_id, recorded_by, game_duration, avg_rating, avg_elo)
    VALUES (@match_id, @recorded_by, @game_duration, @avg_rating, @avg_rating)
  `),

  getMatch: db.prepare(`SELECT * FROM matches WHERE match_id = ?`),

  insertMatchPlayer: db.prepare(`
    INSERT INTO match_players (
      match_id, discord_id, team, role, champion,
      kills, deaths, assists, cs, vision_score,
      damage_dealt, damage_taken, gold_earned,
      won,
      mu_before, mu_after, sigma_before, sigma_after,
      rating_before, rating_after, rating_delta,
      elo_before, elo_after, elo_delta,
      performance_mod
    ) VALUES (
      @match_id, @discord_id, @team, @role, @champion,
      @kills, @deaths, @assists, @cs, @vision_score,
      @damage_dealt, @damage_taken, @gold_earned,
      @won,
      @mu_before, @mu_after, @sigma_before, @sigma_after,
      @rating_before, @rating_after, @rating_delta,
      @rating_before, @rating_after, @rating_delta,
      @performance_mod
    )
  `),

  getMatchPlayers: db.prepare(`
    SELECT mp.*, p.riot_name
    FROM match_players mp
    JOIN players p ON p.discord_id = mp.discord_id
    WHERE mp.match_id = ?
    ORDER BY mp.team, mp.rating_delta DESC
  `),

  getPlayerHistory: db.prepare(`
    SELECT mp.*, m.recorded_at
    FROM match_players mp
    JOIN matches m ON m.match_id = mp.match_id
    WHERE mp.discord_id = ?
    ORDER BY m.recorded_at DESC
    LIMIT ?
  `),

  getRecentMatches: db.prepare(`
    SELECT * FROM matches ORDER BY recorded_at DESC LIMIT ?
  `),

  getPlayerRoleStats: db.prepare(`
    SELECT role,
           COUNT(*) as games,
           SUM(won) as wins,
           ROUND(AVG(rating_delta), 1) as avg_delta,
           ROUND(AVG(kills), 1) as avg_kills,
           ROUND(AVG(deaths), 1) as avg_deaths,
           ROUND(AVG(assists), 1) as avg_assists
    FROM match_players
    WHERE discord_id = ?
    GROUP BY role
    ORDER BY games DESC
  `),

  // Champion stats
  upsertChampionStats: db.prepare(`
    INSERT INTO champion_stats (discord_id, champion, games, wins, total_kills, total_deaths, total_assists)
    VALUES (@discord_id, @champion, 1, @won, @kills, @deaths, @assists)
    ON CONFLICT(discord_id, champion) DO UPDATE SET
      games         = games + 1,
      wins          = wins + excluded.wins,
      total_kills   = total_kills + excluded.total_kills,
      total_deaths  = total_deaths + excluded.total_deaths,
      total_assists = total_assists + excluded.total_assists
  `),

  revertChampionStats: db.prepare(`
    UPDATE champion_stats
    SET games         = MAX(0, games - 1),
        wins          = MAX(0, wins - @won),
        total_kills   = MAX(0, total_kills - @kills),
        total_deaths  = MAX(0, total_deaths - @deaths),
        total_assists = MAX(0, total_assists - @assists)
    WHERE discord_id = @discord_id AND champion = @champion
  `),

  cleanupZeroGamesChampions: db.prepare(`
    DELETE FROM champion_stats WHERE games <= 0
  `),

  getTopChampionsForPlayer: db.prepare(`
    SELECT champion, games, wins,
           ROUND(CAST(wins AS REAL) / games * 100) AS win_rate,
           ROUND(CAST(total_kills AS REAL) / games, 1) AS avg_kills,
           ROUND(CAST(total_deaths AS REAL) / games, 1) AS avg_deaths,
           ROUND(CAST(total_assists AS REAL) / games, 1) AS avg_assists
    FROM champion_stats
    WHERE discord_id = ?
    ORDER BY games DESC, wins DESC
    LIMIT ?
  `),

  getAllTopChampions: db.prepare(`
    WITH RankedChamps AS (
      SELECT discord_id, champion, games, wins,
             ROUND(CAST(wins AS REAL) / games * 100) AS win_rate,
             ROW_NUMBER() OVER (PARTITION BY discord_id ORDER BY games DESC, wins DESC) as rn
      FROM champion_stats
    )
    SELECT discord_id, champion, games, wins, win_rate
    FROM RankedChamps
    WHERE rn <= ?
    ORDER BY discord_id, games DESC, wins DESC
  `),

  getAllPlayerChampionStats: db.prepare(`
    SELECT champion, games, wins,
           ROUND(CAST(wins AS REAL) / games * 100) AS win_rate,
           total_kills, total_deaths, total_assists
    FROM champion_stats
    WHERE discord_id = ?
    ORDER BY games DESC, wins DESC
  `),

  // Recent Matches Form
  getAllRecentMatches: db.prepare(`
    WITH RankedMatches AS (
      SELECT mp.discord_id, mp.won, m.recorded_at,
             ROW_NUMBER() OVER (PARTITION BY mp.discord_id ORDER BY m.recorded_at DESC) as rn
      FROM match_players mp
      JOIN matches m ON m.match_id = mp.match_id
    )
    SELECT discord_id, won, recorded_at, rn
    FROM RankedMatches
    WHERE rn <= ?
    ORDER BY discord_id, rn DESC
  `),

  getPlayerRecentMatches: db.prepare(`
    SELECT mp.won
    FROM match_players mp
    JOIN matches m ON m.match_id = mp.match_id
    WHERE mp.discord_id = ?
    ORDER BY m.recorded_at DESC
    LIMIT ?
  `),

  // Leaderboard Widgets
  saveLeaderboardWidget: db.prepare(`
    INSERT INTO leaderboard_widgets (channel_id, guild_id, message_id, updated_at)
    VALUES (@channel_id, @guild_id, @message_id, datetime('now'))
    ON CONFLICT(channel_id) DO UPDATE SET
      guild_id   = @guild_id,
      message_id = @message_id,
      updated_at = datetime('now')
  `),

  getAllLeaderboardWidgets: db.prepare(`
    SELECT * FROM leaderboard_widgets
  `),

  getLeaderboardWidget: db.prepare(`
    SELECT * FROM leaderboard_widgets WHERE channel_id = ?
  `),

  deleteLeaderboardWidget: db.prepare(`
    DELETE FROM leaderboard_widgets WHERE channel_id = ?
  `),

  // Lobbies
  createLobby: db.prepare(`
    INSERT INTO lobbies (lobby_id, guild_id, channel_id, message_id, owner_id, scheduled_time, title, status)
    VALUES (@lobby_id, @guild_id, @channel_id, @message_id, @owner_id, @scheduled_time, @title, 'open')
  `),

  getLobby: db.prepare(`SELECT * FROM lobbies WHERE lobby_id = ?`),
  getLobbyByMessageId: db.prepare(`SELECT * FROM lobbies WHERE message_id = ?`),

  deleteLobby: db.prepare(`DELETE FROM lobbies WHERE lobby_id = ?`),

  updateLobbyTeams: db.prepare(`
    UPDATE lobbies
    SET teams_json = ?, status = ?
    WHERE lobby_id = ?
  `),

  updateLobbyMessageId: db.prepare(`
    UPDATE lobbies SET message_id = ? WHERE lobby_id = ?
  `),

  // Lobby Players
  getLobbyPlayers: db.prepare(`
    SELECT lp.slot_number, lp.discord_id, lp.joined_at,
           p.riot_name, p.rating, p.wins, p.losses, p.mu, p.sigma
    FROM lobby_players lp
    JOIN players p ON lp.discord_id = p.discord_id
    WHERE lp.lobby_id = ?
    ORDER BY lp.slot_number ASC
  `),

  getLobbyPlayer: db.prepare(`
    SELECT * FROM lobby_players WHERE lobby_id = ? AND discord_id = ?
  `),

  addPlayerToLobby: db.prepare(`
    INSERT INTO lobby_players (lobby_id, slot_number, discord_id)
    VALUES (?, ?, ?)
  `),

  removePlayerFromLobby: db.prepare(`
    DELETE FROM lobby_players WHERE lobby_id = ? AND discord_id = ?
  `),

  getOccupiedSlots: db.prepare(`
    SELECT slot_number FROM lobby_players WHERE lobby_id = ? ORDER BY slot_number ASC
  `),

  // Lobby Waitlist
  addPlayerToWaitlist: db.prepare(`
    INSERT INTO lobby_waitlist (lobby_id, discord_id)
    VALUES (?, ?)
  `),

  removePlayerFromWaitlist: db.prepare(`
    DELETE FROM lobby_waitlist WHERE lobby_id = ? AND discord_id = ?
  `),

  getLobbyWaitlist: db.prepare(`
    SELECT lw.discord_id, lw.joined_at, p.riot_name, p.rating, p.wins, p.losses, p.mu, p.sigma
    FROM lobby_waitlist lw
    JOIN players p ON lw.discord_id = p.discord_id
    WHERE lw.lobby_id = ?
    ORDER BY lw.joined_at ASC
  `),

  getWaitlistPlayer: db.prepare(`
    SELECT * FROM lobby_waitlist WHERE lobby_id = ? AND discord_id = ?
  `),

  getNextWaitlistPlayer: db.prepare(`
    SELECT lw.discord_id, p.riot_name, p.rating
    FROM lobby_waitlist lw
    JOIN players p ON lw.discord_id = p.discord_id
    WHERE lw.lobby_id = ?
    ORDER BY lw.joined_at ASC
    LIMIT 1
  `),
};

module.exports = {
  // ── Player helpers ──────────────────────────
  upsertPlayer(discordId, puuid, riotName, seedRating = 1000) {
    const { mu, sigma } = fromSeedRating(seedRating);
    const ord = calcOrdinal({ mu, sigma });
    const res = stmts.upsertPlayer.run({
      discord_id: discordId,
      riot_puuid: puuid || null,
      riot_name: riotName,
      mu,
      sigma,
      ordinal: ord,
      rating: seedRating,
    });
    eloEvents.emit('eloChange', { type: 'upsertPlayer', discordId });
    return res;
  },

  updatePlayerPuuid(discordId, puuid) {
    return stmts.updatePlayerPuuid.run(puuid, discordId);
  },

  updatePlayerRiotName(discordId, riotName) {
    return stmts.updatePlayerRiotName.run(riotName, discordId);
  },

  getPlayer(discordId) {
    return stmts.getPlayer.get(discordId);
  },

  getPlayerByPuuid(puuid) {
    if (!puuid) return null;
    return stmts.getPlayerByPuuid.get(puuid);
  },

  findPlayerByRiot(riotName, tagLine, puuid) {
    if (puuid) {
      const match = stmts.getPlayerByPuuid.get(puuid);
      if (match) return match;
    }
    if (riotName && tagLine) {
      const full = `${riotName}#${tagLine}`;
      const match = stmts.findPlayerByRiotName.get(full, riotName, puuid || '');
      if (match) return match;
    }
    if (riotName) {
      const match = stmts.findPlayerByRiotName.get(riotName, riotName, puuid || '');
      if (match) return match;
    }
    return null;
  },

  getAllPlayers() {
    return stmts.getAllPlayers.all();
  },

  updateSkill(discordId, mu, sigma, ordinalVal, ratingVal, won) {
    const res = stmts.updateSkill.run({
      discord_id: discordId,
      mu,
      sigma,
      ordinal: ordinalVal,
      rating: ratingVal,
      win_inc: won ? 1 : 0,
      loss_inc: won ? 0 : 1,
    });
    eloEvents.emit('eloChange', { type: 'updateSkill', discordId });
    return res;
  },

  updateElo(discordId, newRating, won) {
    // Backward compatibility helper
    const player = this.getPlayer(discordId);
    const mu = player ? player.mu : 25.0;
    const sigma = player ? player.sigma : 8.333333;
    const ord = player ? player.ordinal : 0.0;
    return this.updateSkill(discordId, mu, sigma, ord, newRating, won);
  },

  setRating(discordId, newRating) {
    const { mu, sigma } = fromSeedRating(newRating);
    const ord = calcOrdinal({ mu, sigma });
    const res = stmts.setSkill.run({
      discord_id: discordId,
      mu,
      sigma,
      ordinal: ord,
      rating: newRating,
    });
    eloEvents.emit('eloChange', { type: 'setRating', discordId, newRating });
    return res;
  },

  setElo(discordId, elo) {
    return this.setRating(discordId, elo);
  },

  // ── Match helpers ───────────────────────────
  insertMatch(matchId, recordedBy, gameDuration, avgRating) {
    return stmts.insertMatch.run({
      match_id: matchId,
      recorded_by: recordedBy,
      game_duration: gameDuration,
      avg_rating: avgRating,
    });
  },

  getMatch(matchId) {
    return stmts.getMatch.get(matchId);
  },

  insertMatchPlayer(data) {
    return stmts.insertMatchPlayer.run(data);
  },

  getMatchPlayers(matchId) {
    return stmts.getMatchPlayers.all(matchId);
  },

  getPlayerHistory(discordId, limit = 10) {
    return stmts.getPlayerHistory.all(discordId, limit);
  },

  getRecentMatches(limit = 10) {
    return stmts.getRecentMatches.all(limit);
  },

  getPlayerRoleStats(discordId) {
    return stmts.getPlayerRoleStats.all(discordId);
  },

  // ── Champion stats helpers ───────────────────
  upsertChampionStats(discordId, champion, won, kills, deaths, assists) {
    return stmts.upsertChampionStats.run({
      discord_id: discordId,
      champion,
      won: won ? 1 : 0,
      kills,
      deaths,
      assists,
    });
  },

  revertChampionStats(discordId, champion, won, kills, deaths, assists) {
    stmts.revertChampionStats.run({
      discord_id: discordId,
      champion,
      won: won ? 1 : 0,
      kills,
      deaths,
      assists,
    });
    stmts.cleanupZeroGamesChampions.run();
  },

  getTopChampionsForPlayer(discordId, limit = 3) {
    return stmts.getTopChampionsForPlayer.all(discordId, limit);
  },

  getAllTopChampions(limit = 3) {
    const rows = stmts.getAllTopChampions.all(limit);
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.discord_id)) {
        map.set(row.discord_id, []);
      }
      map.get(row.discord_id).push(row);
    }
    return map;
  },

  getAllPlayerChampionStats(discordId) {
    return stmts.getAllPlayerChampionStats.all(discordId);
  },

  getAllRecentForms(limit = 5) {
    const rows = stmts.getAllRecentMatches.all(limit);
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.discord_id)) {
        map.set(row.discord_id, []);
      }
      map.get(row.discord_id).push(row.won === 1);
    }
    return map;
  },

  getPlayerRecentForm(discordId, limit = 5) {
    const rows = stmts.getPlayerRecentMatches.all(discordId, limit);
    return rows.reverse().map((r) => r.won === 1);
  },

  // ── Leaderboard widget helpers ────────────────
  saveLeaderboardWidget(channelId, guildId, messageId) {
    return stmts.saveLeaderboardWidget.run({
      channel_id: channelId,
      guild_id: guildId || null,
      message_id: messageId,
    });
  },

  getAllLeaderboardWidgets() {
    return stmts.getAllLeaderboardWidgets.all();
  },

  getLeaderboardWidget(channelId) {
    return stmts.getLeaderboardWidget.get(channelId);
  },

  deleteLeaderboardWidget(channelId) {
    return stmts.deleteLeaderboardWidget.run(channelId);
  },

  // ── Lobby helpers ────────────────────────────
  createLobby(data) {
    return stmts.createLobby.run(data);
  },

  getLobby(lobbyId) {
    return stmts.getLobby.get(lobbyId);
  },

  getLobbyByMessageId(messageId) {
    return stmts.getLobbyByMessageId.get(messageId);
  },

  deleteLobby(lobbyId) {
    return stmts.deleteLobby.run(lobbyId);
  },

  updateLobbyTeams(lobbyId, teamsJson, status = 'randomized') {
    return stmts.updateLobbyTeams.run(teamsJson, status, lobbyId);
  },

  updateLobbyMessageId(lobbyId, messageId) {
    return stmts.updateLobbyMessageId.run(messageId, lobbyId);
  },

  clearLobbyTeams(lobbyId) {
    return stmts.updateLobbyTeams.run(null, 'open', lobbyId);
  },

  getLobbyPlayers(lobbyId) {
    return stmts.getLobbyPlayers.all(lobbyId);
  },

  getLobbyPlayer(lobbyId, discordId) {
    return stmts.getLobbyPlayer.get(lobbyId, discordId);
  },

  addPlayerToLobby(lobbyId, discordId, slotNumber) {
    return stmts.addPlayerToLobby.run(lobbyId, slotNumber, discordId);
  },

  removePlayerFromLobby(lobbyId, discordId) {
    return stmts.removePlayerFromLobby.run(lobbyId, discordId);
  },

  getNextAvailableSlot(lobbyId) {
    const rows = stmts.getOccupiedSlots.all(lobbyId);
    const occupied = new Set(rows.map((r) => r.slot_number));
    for (let i = 1; i <= 10; i++) {
      if (!occupied.has(i)) return i;
    }
    return null;
  },

  // ── Waitlist helpers ─────────────────────────
  addPlayerToWaitlist(lobbyId, discordId) {
    return stmts.addPlayerToWaitlist.run(lobbyId, discordId);
  },

  removePlayerFromWaitlist(lobbyId, discordId) {
    return stmts.removePlayerFromWaitlist.run(lobbyId, discordId);
  },

  getLobbyWaitlist(lobbyId) {
    return stmts.getLobbyWaitlist.all(lobbyId);
  },

  getWaitlistPlayer(lobbyId, discordId) {
    return stmts.getWaitlistPlayer.get(lobbyId, discordId);
  },

  popNextWaitlistPlayer(lobbyId) {
    const next = stmts.getNextWaitlistPlayer.get(lobbyId);
    if (next) {
      stmts.removePlayerFromWaitlist.run(lobbyId, next.discord_id);
      return next;
    }
    return null;
  },

  transaction(fn) {
    return db.transaction(fn)();
  },
};
