const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const queries = require('../database/queries');
const { toDisplayRating } = require('../elo/openskill');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('match')
    .setDescription('View the scoreboard summary of a recorded match')
    .addStringOption((opt) =>
      opt.setName('match_id').setDescription('Match ID (e.g. EUW1-8005104108)').setRequired(true)
    ),

  async execute(interaction) {
    const matchId = interaction.options.getString('match_id');

    const match = queries.getMatch(matchId);
    if (!match) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setDescription(`Match \`${matchId}\` has not been recorded.`),
        ],
        ephemeral: true,
      });
    }

    const players = queries.getMatchPlayers(matchId);
    const blue = players.filter((p) => p.team === 100);
    const red = players.filter((p) => p.team === 200);
    const blueWon = blue.length > 0 && blue[0].won;

    const duration = match.game_duration || 0;
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    const avgRating = Math.round(match.avg_rating ?? match.avg_elo ?? 1000);

    const blueAvg = blue.length > 0
      ? Math.round(blue.reduce((s, p) => s + (p.rating_before ?? p.elo_before ?? 1000), 0) / blue.length)
      : avgRating;
    const redAvg = red.length > 0
      ? Math.round(red.reduce((s, p) => s + (p.rating_before ?? p.elo_before ?? 1000), 0) / red.length)
      : avgRating;

    function buildTeamScoreboard(teamPlayers, name, emoji, won, teamAvg) {
      const header = won
        ? `${emoji} **${name} (VICTORY)** 🏆 • Avg: **${teamAvg} Elo**`
        : `${emoji} **${name} (DEFEAT)** • Avg: **${teamAvg} Elo**`;

      const colPlayer = 'Player'.padEnd(14);
      const colChamp = 'Champion'.padEnd(12);
      const colDelta = 'Elo +/-'.padStart(12);
      const colFinal = 'Final Elo'.padStart(10);
      const divider = '─'.repeat(51);

      const tableHeader = `${colPlayer} ${colChamp} ${colDelta} ${colFinal}`;
      const rows = teamPlayers.map((p) => {
        const deltaVal = Math.round(p.rating_delta ?? p.elo_delta);
        const deltaSign = deltaVal >= 0 ? '+' : '';

        // Calculate performance rating delta if mu before/after and performance_mod are stored
        let perfRatingDelta = 0;
        const perfMod = p.performance_mod || 0;
        if (perfMod !== 0 && p.mu_before != null && p.mu_after != null && p.sigma_after != null) {
          const deltaMu = p.mu_after - p.mu_before;
          const baseDeltaMu = p.won ? deltaMu / (1 + perfMod) : deltaMu / (1 - perfMod);
          const baseMuAfter = Math.max(1.0, p.mu_before + baseDeltaMu);
          const baseRatingAfter = toDisplayRating({ mu: baseMuAfter, sigma: p.sigma_after });
          const baseRatingDelta = baseRatingAfter - Math.round(p.rating_before ?? p.elo_before ?? 1000);
          perfRatingDelta = Math.round(deltaVal - baseRatingDelta);
        }

        const perfSign = perfRatingDelta >= 0 ? '+' : '';
        const deltaWithPerf = `${deltaSign}${deltaVal}(${perfSign}${perfRatingDelta})`;
        const deltaStr = deltaWithPerf.padStart(12);
        const finalVal = Math.round(p.rating_after ?? p.elo_after);
        const finalStr = String(finalVal).padStart(10);

        const nameStr = (p.riot_name.length > 14
          ? p.riot_name.slice(0, 13) + '…'
          : p.riot_name
        ).padEnd(14);

        const champ = p.champion || 'Unknown';
        const champStr = (champ.length > 12
          ? champ.slice(0, 11) + '…'
          : champ
        ).padEnd(12);

        return `${nameStr} ${champStr} ${deltaStr} ${finalStr}`;
      });

      return `${header}\n\`\`\`text\n${tableHeader}\n${divider}\n${rows.join('\n')}\n\`\`\``;
    }

    const blueMentions = blue.map((p) => `<@${p.discord_id}>`).join(' ');
    const redMentions = red.map((p) => `<@${p.discord_id}>`).join(' ');

    const embed = new EmbedBuilder()
      .setColor(blueWon ? 0x5865f2 : 0xff4444)
      .setTitle(`📊 Game Scoreboard Summary — \`${matchId}\``)
      .setDescription(
        `⏱️ **Duration**: ${minutes}m ${seconds}s • **Match Avg**: ${avgRating} Elo\n` +
        `⚖️ **Team Avg**: 🔵 Blue **${blueAvg} Elo** vs 🔴 Red **${redAvg} Elo**\n\n` +
        buildTeamScoreboard(blue, 'Blue Side', '🔵', blueWon, blueAvg) +
        `👥 ${blueMentions}\n\n` +
        buildTeamScoreboard(red, 'Red Side', '🔴', !blueWon, redAvg) +
        `👥 ${redMentions}`
      )
      .setFooter({ text: `Recorded by <@${match.recorded_by}> • ${match.recorded_at}` });

    return interaction.reply({ embeds: [embed] });
  },
};
