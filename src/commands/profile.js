const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const queries = require('../database/queries');

function skillTier(rating) {
  if (rating >= 2400) return { name: 'Challenger', emoji: '👑', color: 0xf4c542 };
  if (rating >= 2200) return { name: 'Grandmaster', emoji: '🔴', color: 0xd32f2f };
  if (rating >= 2000) return { name: 'Master', emoji: '🟣', color: 0x9c27b0 };
  if (rating >= 1800) return { name: 'Diamond', emoji: '💎', color: 0x68b8f8 };
  if (rating >= 1600) return { name: 'Emerald', emoji: '🟢', color: 0x1abc70 };
  if (rating >= 1400) return { name: 'Platinum', emoji: '🔵', color: 0x1e88e5 };
  if (rating >= 1200) return { name: 'Gold', emoji: '🟡', color: 0xffd600 };
  if (rating >= 1000) return { name: 'Silver', emoji: '⚪', color: 0xbdbdbd };
  if (rating >= 800)  return { name: 'Bronze', emoji: '🟤', color: 0x8d6e63 };
  return { name: 'Iron', emoji: '⬛', color: 0x616161 };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View an OpenSkill player profile and champion statistics')
    .addUserOption((opt) =>
      opt
        .setName('player')
        .setDescription('Player to look up (default: yourself)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('player') || interaction.user;
    const player = queries.getPlayer(target.id);

    if (!player) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle('❌ Not Linked')
            .setDescription(
              target.id === interaction.user.id
                ? 'You haven\'t linked a Riot account yet. Use `/link` to get started!'
                : `<@${target.id}> hasn't linked a Riot account yet.`
            ),
        ],
        ephemeral: true,
      });
    }

    const totalGames = player.wins + player.losses;
    const isRanked = totalGames >= 5;

    const currentRating = Math.round(player.rating || 1000);
    const peakRating = Math.round(player.peak_rating || player.rating || 1000);
    const tier = isRanked ? skillTier(currentRating) : { name: 'Provisional', emoji: '⚪', color: 0x95a5a6 };
    const winRate = totalGames > 0 ? Math.round((player.wins / totalGames) * 100) : 0;

    // Top champions
    const topChamps = queries.getTopChampionsForPlayer(target.id, 5);
    const champLines = topChamps.map((c) => {
      const kda = `${c.avg_kills}/${c.avg_deaths}/${c.avg_assists}`;
      return `**${c.champion}** — **${c.games}** games, **${c.win_rate}%** WR, *${kda}* KDA`;
    });

    // Recent match history
    const history = queries.getPlayerHistory(target.id, 5);
    const historyLines = history.map((h) => {
      const icon = h.won ? '🟢' : '🔴';
      const deltaText = isRanked
        ? `— **${(h.rating_delta ?? h.elo_delta) >= 0 ? '+' : ''}${Math.round(h.rating_delta ?? h.elo_delta)}** Rating `
        : '';
      const roleName = h.role === 'UTILITY' ? 'SUPPORT' : (h.role || '?');
      return `${icon} **${h.champion || '???'}** (${roleName}) ${deltaText}*(${h.kills}/${h.deaths}/${h.assists})*`;
    });

    // Role stats
    const roleStats = queries.getPlayerRoleStats(target.id);
    const roleLines = roleStats.map((r) => {
      const rWinRate = r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0;
      const roleName = r.role === 'UTILITY' ? 'SUPPORT' : (r.role || '?');
      return `**${roleName}** — ${r.games} games, ${rWinRate}% WR, avg ${r.avg_delta > 0 ? '+' : ''}${r.avg_delta} Rating`;
    });

    const ratingDisplay = isRanked
      ? `**${currentRating}** (Peak: ${peakRating})`
      : `*Unranked (${totalGames}/5)*`;

    const tierDisplay = isRanked
      ? `${tier.emoji} ${tier.name}`
      : '⚪ Provisional (<5 games)';

    const engineDisplay = isRanked
      ? `OpenSkill Bayesian Rating System • Peak: ${peakRating}`
      : `Provisional placement: **${5 - totalGames}** more game${5 - totalGames === 1 ? '' : 's'} needed to reveal rank.`;

    const embed = new EmbedBuilder()
      .setColor(tier.color)
      .setTitle(`${tier.emoji} ${player.riot_name}`)
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: '📊 Rating', value: ratingDisplay, inline: true },
        { name: '🏅 Tier', value: tierDisplay, inline: true },
        { name: '📈 Record', value: `**${player.wins}W** / **${player.losses}L** (${winRate}%)`, inline: true },
        {
          name: '🧠 Rating Engine',
          value: engineDisplay,
          inline: false,
        }
      );

    if (champLines.length > 0) {
      embed.addFields({
        name: '⚔️ Top Champions',
        value: champLines.join('\n'),
      });
    }

    if (historyLines.length > 0) {
      embed.addFields({
        name: '🕐 Recent Matches',
        value: historyLines.join('\n'),
      });
    }

    if (roleLines.length > 0) {
      embed.addFields({
        name: '🎭 Role Breakdown',
        value: roleLines.join('\n'),
      });
    }

    embed.setFooter({ text: `${totalGames} games played • Linked: ${player.created_at}` });

    return interaction.reply({ embeds: [embed] });
  },
};
