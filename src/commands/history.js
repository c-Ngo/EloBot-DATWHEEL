const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const queries = require('../database/queries');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('View recent match history and rating changes')
    .addUserOption((opt) =>
      opt
        .setName('player')
        .setDescription('Player to look up (default: yourself)')
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('count')
        .setDescription('Number of matches to show (default: 10)')
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('player') || interaction.user;
    const count = interaction.options.getInteger('count') ?? 10;

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

    const history = queries.getPlayerHistory(target.id, count);
    if (history.length === 0) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x888888)
            .setTitle(`📜 Match History — ${player.riot_name}`)
            .setDescription('No matches recorded yet.'),
        ],
      });
    }

    const lines = history.map((h, i) => {
      const icon = h.won ? '🟢 W' : '🔴 L';
      const deltaVal = Math.round(h.rating_delta ?? h.elo_delta);
      const delta = deltaVal >= 0 ? `+${deltaVal}` : `${deltaVal}`;
      const afterVal = Math.round(h.rating_after ?? h.elo_after);
      const kda = `${h.kills}/${h.deaths}/${h.assists}`;
      const date = (h.recorded_at || '').split('T')[0] || (h.recorded_at || '').split(' ')[0];
      const roleName = h.role === 'UTILITY' ? 'SUPPORT' : (h.role || '?');
      return `\`${String(i + 1).padStart(2, ' ')}.\` ${icon} **${h.champion || '?'}** (${roleName}) — ${kda} — **${delta}** Rating → ${afterVal}  *${date}*`;
    });

    const currentRating = Math.round(player.rating || player.elo || 1000);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📜 Match History — ${player.riot_name}`)
      .setDescription(lines.join('\n'))
      .setThumbnail(target.displayAvatarURL({ size: 128 }))
      .setFooter({ text: `Current Rating: ${currentRating} • ${player.wins}W ${player.losses}L • OpenSkill` });

    return interaction.reply({ embeds: [embed] });
  },
};
