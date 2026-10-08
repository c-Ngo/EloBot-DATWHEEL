const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const queries = require('../database/queries');
const { updateAllLeaderboardWidgets } = require('../widgets/leaderboardWidget');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setelo')
    .setDescription('Manually adjust a player\'s skill rating (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((opt) =>
      opt.setName('player').setDescription('Player to adjust').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('rating')
        .setDescription('New skill rating value')
        .setMinValue(0)
        .setMaxValue(5000)
        .setRequired(true)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('player');
    const newRating = interaction.options.getInteger('rating');

    const player = queries.getPlayer(target.id);
    if (!player) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setDescription(`<@${target.id}> hasn't linked a Riot account yet.`),
        ],
        ephemeral: true,
      });
    }

    const oldRating = Math.round(player.rating || 1000);
    queries.setRating(target.id, newRating);

    // Auto-update persistent leaderboard widgets
    updateAllLeaderboardWidgets(interaction.client).catch((err) => {
      console.error('[setelo] Error updating leaderboard widgets:', err);
    });

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00cc88)
          .setTitle('⚙️ Rating Updated')
          .setDescription(
            `**${player.riot_name}**'s rating has been changed.\n\n` +
            `${oldRating} → **${newRating}** (${newRating >= oldRating ? '+' : ''}${newRating - oldRating})`
          )
          .setFooter({ text: `Set by ${interaction.user.displayName}` }),
      ],
    });
  },
};
