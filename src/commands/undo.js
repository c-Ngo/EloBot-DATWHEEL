const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const queries = require('../database/queries');
const db = require('../database/db');
const { updateAllLeaderboardWidgets } = require('../widgets/leaderboardWidget');
const eloEvents = require('../events/eloEvents');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('undo')
    .setDescription('Undo a recorded match (admin only — reverts OpenSkill ratings and champion stats)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((opt) =>
      opt.setName('match_id').setDescription('Match ID to undo (e.g. EUW1-8005104108)').setRequired(true)
    ),

  async execute(interaction) {
    const matchId = interaction.options.getString('match_id');
    const match = queries.getMatch(matchId);

    if (!match) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setDescription(`Match \`${matchId}\` not found in the database.`),
        ],
        ephemeral: true,
      });
    }

    const players = queries.getMatchPlayers(matchId);

    // Revert skill ratings and win/loss for each player
    const deleteMatchPlayers = db.prepare('DELETE FROM match_players WHERE match_id = ?');
    const deleteMatch = db.prepare('DELETE FROM matches WHERE match_id = ?');
    const revertSkill = db.prepare(`
      UPDATE players
      SET mu          = @mu_before,
          sigma       = @sigma_before,
          ordinal     = @mu_before - 3.0 * @sigma_before,
          rating      = @rating_before,
          elo         = @rating_before,
          wins        = MAX(0, wins - @win_dec),
          losses      = MAX(0, losses - @loss_dec)
      WHERE discord_id = @discord_id
    `);

    db.transaction(() => {
      for (const p of players) {
        // 1. Revert OpenSkill ratings
        revertSkill.run({
          discord_id: p.discord_id,
          mu_before: p.mu_before,
          sigma_before: p.sigma_before,
          rating_before: p.rating_before ?? p.elo_before,
          win_dec: p.won ? 1 : 0,
          loss_dec: p.won ? 0 : 1,
        });

        // 2. Revert champion stats
        queries.revertChampionStats(
          p.discord_id,
          p.champion,
          p.won,
          p.kills,
          p.deaths,
          p.assists
        );
      }

      deleteMatchPlayers.run(matchId);
      deleteMatch.run(matchId);
    })();

    // Auto-update persistent leaderboard widgets
    eloEvents.emit('eloChange', { type: 'undo', matchId });
    updateAllLeaderboardWidgets(interaction.client).catch((err) => {
      console.error('[undo] Error updating leaderboard widgets:', err);
    });

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xffaa00)
          .setTitle('⏪ Match Undone')
          .setDescription(
            `Match \`${matchId}\` has been removed and all OpenSkill rating/champion changes reverted.\n\n` +
            `**${players.length}** players restored to their previous ratings.`
          )
          .setFooter({ text: `Undone by ${interaction.user.displayName}` }),
      ],
    });
  },
};
