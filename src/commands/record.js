const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const { parseRofl } = require('../rofl/parser');
const queries = require('../database/queries');
const { calculateSkillChanges } = require('../elo/engine');
const { updateAllLeaderboardWidgets } = require('../widgets/leaderboardWidget');

const POSITION_MAP = {
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MIDDLE: 'MIDDLE',
  BOTTOM: 'BOTTOM',
  UTILITY: 'SUPPORT',
  SUPPORT: 'SUPPORT',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('record')
    .setDescription('Record a custom match from a .rofl replay file and generate a scoreboard summary')
    .addAttachmentOption((opt) =>
      opt
        .setName('file')
        .setDescription('Attach the .rofl replay file from Documents/League of Legends/Replays')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const attachment = interaction.options.getAttachment('file');

    // ── 1. Validate file extension ──
    if (!attachment.name.toLowerCase().endsWith('.rofl')) {
      return interaction.editReply({
        embeds: [
          errorEmbed(
            'Invalid file type. Please upload a `.rofl` replay file from your `Documents/League of Legends/Replays` folder.'
          ),
        ],
      });
    }

    // ── 2. Download and parse .rofl file ──
    let replayData;
    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new Error(`Failed to download replay attachment: HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      replayData = parseRofl(buffer);
    } catch (err) {
      console.error('[record] Error parsing ROFL:', err);
      return interaction.editReply({
        embeds: [
          errorEmbed(
            `Failed to parse replay file:\n\`\`\`${err.message}\`\`\`\nMake sure the file is a valid and uncorrupted League of Legends replay.`
          ),
        ],
      });
    }

    const { gameLength, players: replayPlayers } = replayData;

    if (!replayPlayers || replayPlayers.length !== 10) {
      return interaction.editReply({
        embeds: [
          errorEmbed(
            `Expected 10 players in replay, but found ${replayPlayers ? replayPlayers.length : 0}. Only full 5v5 custom matches can be recorded.`
          ),
        ],
      });
    }

    // ── 3. Determine match ID ──
    const baseName = path.basename(attachment.name, path.extname(attachment.name));
    const matchId = baseName || `match_${Date.now()}`;

    const existingMatch = queries.getMatch(matchId);
    if (existingMatch) {
      return interaction.editReply({
        embeds: [errorEmbed(`Match \`${matchId}\` has already been recorded.`)],
      });
    }

    // ── 4. Match replay players to registered Discord accounts ──
    const matched = [];
    const unlinked = [];

    for (const rp of replayPlayers) {
      const dbPlayer = queries.findPlayerByRiot(rp.riotName, rp.tagLine, rp.puuid);
      if (!dbPlayer) {
        unlinked.push(rp);
      } else {
        matched.push({
          replay: rp,
          player: dbPlayer,
        });
      }
    }

    if (unlinked.length > 0) {
      const unlinkedList = unlinked
        .map((u) => `• **${u.fullRiotId}** (${u.champion} — ${u.team === 100 ? 'Blue' : 'Red'})`)
        .join('\n');

      return interaction.editReply({
        embeds: [
          errorEmbed(
            `The following players in the replay have not linked their Riot accounts to Discord:\n\n${unlinkedList}\n\nAsk them to run \`/link riot_id:<GameName#TagLine>\` before recording this match.`
          ),
        ],
      });
    }

    // ── 5. Separate into Blue (100) and Red (200) teams ──
    const blueTeam = matched.filter((m) => m.replay.team === 100);
    const redTeam = matched.filter((m) => m.replay.team === 200);

    if (blueTeam.length !== 5 || redTeam.length !== 5) {
      return interaction.editReply({
        embeds: [
          errorEmbed(
            `Replay must have exactly 5 players per team (Found Blue: ${blueTeam.length}, Red: ${redTeam.length}).`
          ),
        ],
      });
    }

    // ── 6. Build team data for OpenSkill engine ──
    function buildEngineData(teamEntries) {
      return teamEntries.map(({ replay, player }) => ({
        discord_id: player.discord_id,
        mu: player.mu ?? 25.0,
        sigma: player.sigma ?? 8.333333,
        role: POSITION_MAP[replay.role] || replay.role || 'UNKNOWN',
        won: replay.won,
        replay,
        player,
        stats: {
          kills: replay.kills,
          deaths: replay.deaths,
          assists: replay.assists,
          cs: replay.cs,
          vision_score: replay.visionScore,
          damage_dealt: replay.damageDealt,
          damage_taken: replay.damageTaken,
          gold_earned: replay.goldEarned,
        },
      }));
    }

    const team1Data = buildEngineData(blueTeam);
    const team2Data = buildEngineData(redTeam);

    const blueWon = team1Data[0].won;
    const winningTeam = blueWon ? 1 : 2;

    // ── 7. Calculate OpenSkill / TrueSkill changes ──
    const { results: skillResults, winProbBlue, winProbRed } = calculateSkillChanges(
      team1Data,
      team2Data,
      winningTeam
    );
    const skillMap = new Map(skillResults.map((r) => [r.discord_id, r]));

    // ── 8. Persist in a single database transaction ──
    const allTeamData = [...team1Data, ...team2Data];
    const avgRating =
      allTeamData.reduce((s, p) => s + (p.player.rating || 1000), 0) / allTeamData.length;

    queries.transaction(() => {
      queries.insertMatch(matchId, interaction.user.id, gameLength, Math.round(avgRating));

      for (const td of allTeamData) {
        const sr = skillMap.get(td.discord_id);
        const rp = td.replay;

        // Auto-save PUUID if newly discovered
        if (!td.player.riot_puuid && rp.puuid) {
          queries.updatePlayerPuuid(td.discord_id, rp.puuid);
        }

        // Auto-update Riot ID if player changed their name
        if (rp.fullRiotId && rp.fullRiotId !== 'Unknown' && td.player.riot_name !== rp.fullRiotId) {
          queries.updatePlayerRiotName(td.discord_id, rp.fullRiotId);
        }

        queries.insertMatchPlayer({
          match_id: matchId,
          discord_id: td.discord_id,
          team: rp.team,
          role: td.role,
          champion: rp.champion,
          kills: rp.kills,
          deaths: rp.deaths,
          assists: rp.assists,
          cs: rp.cs,
          vision_score: rp.visionScore,
          damage_dealt: rp.damageDealt,
          damage_taken: rp.damageTaken,
          gold_earned: rp.goldEarned,
          won: sr.won ? 1 : 0,
          mu_before: sr.muBefore,
          mu_after: sr.muAfter,
          sigma_before: sr.sigmaBefore,
          sigma_after: sr.sigmaAfter,
          rating_before: sr.ratingBefore,
          rating_after: sr.ratingAfter,
          rating_delta: sr.ratingDelta,
          performance_mod: sr.performanceMod,
        });

        // Update player OpenSkill rating
        queries.updateSkill(
          td.discord_id,
          sr.muAfter,
          sr.sigmaAfter,
          sr.ordinalAfter,
          sr.ratingAfter,
          sr.won
        );

        // Update champion statistics
        queries.upsertChampionStats(
          td.discord_id,
          rp.champion,
          sr.won,
          rp.kills,
          rp.deaths,
          rp.assists
        );
      }
    });

    // ── Auto-update persistent leaderboard widgets ──
    updateAllLeaderboardWidgets(interaction.client).catch((err) => {
      console.error('[record] Error updating leaderboard widgets:', err);
    });

    // ── 9. Build game scoreboard summary ──
    const minutes = Math.floor(gameLength / 60);
    const seconds = gameLength % 60;
    const matchAvgRating = Math.round(avgRating);
    const blueAvgRating = Math.round(
      team1Data.reduce((s, p) => s + (p.player.rating || 1000), 0) / team1Data.length
    );
    const redAvgRating = Math.round(
      team2Data.reduce((s, p) => s + (p.player.rating || 1000), 0) / team2Data.length
    );

    /**
     * Build clean monospace scoreboard table:
     * Columns: Player | Champion | Elo +/- | Final Elo
     */
    function buildTeamScoreboard(teamData, teamName, teamEmoji, isWinner, teamAvgElo) {
      const header = isWinner
        ? `${teamEmoji} **${teamName} (VICTORY)** 🏆 • Avg: **${teamAvgElo} Elo**`
        : `${teamEmoji} **${teamName} (DEFEAT)** • Avg: **${teamAvgElo} Elo**`;

      const colPlayer = 'Player'.padEnd(14);
      const colChamp = 'Champion'.padEnd(12);
      const colDelta = 'Elo +/-'.padStart(12);
      const colFinal = 'Final Elo'.padStart(10);
      const divider = '─'.repeat(51);

      const tableHeader = `${colPlayer} ${colChamp} ${colDelta} ${colFinal}`;
      const rows = teamData.map((td) => {
        const sr = skillMap.get(td.discord_id);
        const rp = td.replay;

        const deltaVal = sr.ratingDelta;
        const perfVal = sr.perfRatingDelta ?? 0;
        const deltaSign = deltaVal >= 0 ? '+' : '';
        const perfSign = perfVal >= 0 ? '+' : '';
        const deltaWithPerf = `${deltaSign}${deltaVal}(${perfSign}${perfVal})`;
        const deltaStr = deltaWithPerf.padStart(12);
        const finalStr = String(sr.ratingAfter).padStart(10);

        const nameStr = (td.player.riot_name.length > 14
          ? td.player.riot_name.slice(0, 13) + '…'
          : td.player.riot_name
        ).padEnd(14);

        const champStr = (rp.champion.length > 12
          ? rp.champion.slice(0, 11) + '…'
          : rp.champion
        ).padEnd(12);

        return `${nameStr} ${champStr} ${deltaStr} ${finalStr}`;
      });

      return `${header}\n\`\`\`text\n${tableHeader}\n${divider}\n${rows.join('\n')}\n\`\`\``;
    }

    // Identify MVP from winning side
    const winningTeamData = blueWon ? team1Data : team2Data;
    let mvpTd = winningTeamData[0];
    let maxPerf = -Infinity;
    for (const td of winningTeamData) {
      const sr = skillMap.get(td.discord_id);
      if (sr && sr.performanceMod > maxPerf) {
        maxPerf = sr.performanceMod;
        mvpTd = td;
      }
    }
    const mvpSr = skillMap.get(mvpTd.discord_id);
    const mvpDeltaVal = mvpSr.ratingDelta;
    const mvpPerfVal = mvpSr.perfRatingDelta ?? 0;
    const mvpDeltaSign = mvpDeltaVal >= 0 ? '+' : '';
    const mvpPerfSign = mvpPerfVal >= 0 ? '+' : '';
    const mvpDeltaStr = `${mvpDeltaSign}${mvpDeltaVal}(${mvpPerfSign}${mvpPerfVal})`;
    const mvpLine = `⭐ **Match MVP**: **${mvpTd.player.riot_name}** (<@${mvpTd.discord_id}>) as **${mvpTd.replay.champion}** (${mvpDeltaStr} Elo → ${mvpSr.ratingAfter})`;

    // Mention tags for easy profile clicking
    const blueMentions = team1Data.map((td) => `<@${td.discord_id}>`).join(' ');
    const redMentions = team2Data.map((td) => `<@${td.discord_id}>`).join(' ');

    const embed = new EmbedBuilder()
      .setColor(blueWon ? 0x5865f2 : 0xff4444)
      .setTitle(`📊 Game Scoreboard Summary — \`${matchId}\``)
      .setDescription(
        `⏱️ **Duration**: ${minutes}m ${seconds}s • **Match Avg**: ${matchAvgRating} Elo\n` +
        `⚖️ **Team Avg**: 🔵 Blue **${blueAvgRating} Elo** vs 🔴 Red **${redAvgRating} Elo**\n` +
        `🎲 **Pre-Match Odds**: Blue ${winProbBlue}% vs Red ${winProbRed}%\n` +
        `${mvpLine}\n\n` +
        buildTeamScoreboard(team1Data, 'Blue Side', '🔵', blueWon, blueAvgRating) +
        `👥 ${blueMentions}\n\n` +
        buildTeamScoreboard(team2Data, 'Red Side', '🔴', !blueWon, redAvgRating) +
        `👥 ${redMentions}`
      )
      .setFooter({ text: `Recorded by ${interaction.user.displayName} • Replay: ${attachment.name}` })
      .setTimestamp();

    return interaction.editReply({
      content: `🎮 **Match Scoreboard Summary Recorded** for \`${matchId}\``,
      embeds: [embed],
    });
  },
};

function errorEmbed(description) {
  return new EmbedBuilder()
    .setColor(0xff4444)
    .setTitle('❌ Error')
    .setDescription(description);
}
