const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const queries = require('../database/queries');

function skillTier(rating) {
  if (rating >= 2400) return { name: 'Challenger', emoji: '👑' };
  if (rating >= 2200) return { name: 'Grandmaster', emoji: '🔴' };
  if (rating >= 2000) return { name: 'Master', emoji: '🟣' };
  if (rating >= 1800) return { name: 'Diamond', emoji: '💎' };
  if (rating >= 1600) return { name: 'Emerald', emoji: '🟢' };
  if (rating >= 1400) return { name: 'Platinum', emoji: '🔵' };
  if (rating >= 1200) return { name: 'Gold', emoji: '🟡' };
  if (rating >= 1000) return { name: 'Silver', emoji: '⚪' };
  if (rating >= 800)  return { name: 'Bronze', emoji: '🟤' };
  return { name: 'Iron', emoji: '⬛' };
}

const PODIUM_BADGES = ['🥇 #1', '🥈 #2', '🥉 #3'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the OpenSkill / TrueSkill leaderboard with top champions')
    .addBooleanOption((opt) =>
      opt
        .setName('compact')
        .setDescription('Hide champion details for a compact leaderboard view')
        .setRequired(false)
    ),

  async execute(interaction) {
    const compact = interaction.options.getBoolean('compact') ?? false;
    const allPlayers = queries.getAllPlayers();

    if (allPlayers.length === 0) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf1c40f)
            .setDescription(
              [
                '# 🏆 INHOUSE LEADERBOARD 🏆',
                '══════════════════════════════════════════════',
                '*No players linked yet. Use `/link` to get started!*',
                '══════════════════════════════════════════════',
              ].join('\n')
            ),
        ],
      });
    }

    const rankedPlayers = allPlayers.filter((p) => (p.wins + p.losses) >= 5);
    const unrankedPlayers = allPlayers.filter((p) => (p.wins + p.losses) < 5);

    unrankedPlayers.sort((a, b) => {
      const diff = (b.wins + b.losses) - (a.wins + a.losses);
      if (diff !== 0) return diff;
      return (b.rating || 1000) - (a.rating || 1000);
    });

    const players = [...rankedPlayers, ...unrankedPlayers];
    const topChampsMap = queries.getAllTopChampions(3);

    const playerBlocks = players.map((p, i) => {
      const isRanked = (p.wins + p.losses) >= 5;

      if (isRanked) {
        const rank = rankedPlayers.indexOf(p);
        const isPodium = rank < 3;
        const rankTag = isPodium ? PODIUM_BADGES[rank] : `\`#${String(rank + 1).padStart(2, '0')}\``;
        const totalGames = p.wins + p.losses;
        const winRate = `${Math.round((p.wins / totalGames) * 100)}%`;
        const ratingVal = Math.round(p.rating || 1000);
        const tier = skillTier(ratingVal);

        let card = `> ${rankTag}  **${ratingVal} Elo** — **${p.riot_name}** ${tier.emoji}\n> └ 📊 **${p.wins}W ${p.losses}L** (${winRate} WR) • ${tier.name}`;

        if (!compact) {
          const champs = topChampsMap.get(p.discord_id) || [];
          if (champs.length > 0) {
            const champDetails = champs
              .map((c) => `**${c.champion}** ${c.win_rate}% *(${c.games}G)*`)
              .join(' • ');
            card += `\n> └ ⚔️ ${champDetails}`;
          }
        }

        if (rank === 2 && (players.length > 3 || unrankedPlayers.length > 0)) {
          card += '\n> \n> ──────────────────────────────────────────';
        }

        if (i < players.length - 1 && (players[i + 1].wins + players[i + 1].losses) < 5) {
          card += '\n> \n> ──────────────────────────────────────────';
        }

        return card;
      } else {
        const games = p.wins + p.losses;
        return `> ⚪ **${p.riot_name}** — *Unranked (${games}/5)*`;
      }
    });

    const PAGE_SIZE = 5;
    const embeds = [];

    for (let i = 0; i < playerBlocks.length; i += PAGE_SIZE) {
      const chunk = playerBlocks.slice(i, i + PAGE_SIZE).join('\n\n');
      const pageNum = Math.floor(i / PAGE_SIZE) + 1;
      const totalPages = Math.ceil(playerBlocks.length / PAGE_SIZE);

      const headerText =
        i === 0
          ? [
              '# 🏆 INHOUSE LEADERBOARD 🏆',
              '══════════════════════════════════════════════',
              `👥 **Players**: \`${players.length}\`   •   🎮 **Ranked**: \`${rankedPlayers.length}\``,
              '══════════════════════════════════════════════',
              '',
            ].join('\n')
          : '';

      const footerText = [
        '',
        '══════════════════════════════════════════════',
      ].join('\n');

      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setDescription(headerText + chunk + footerText)
        .setFooter({
          text: `Page ${pageNum}/${totalPages} • ${players.length} players tracked • OpenSkill / TrueSkill rating`,
        })
        .setTimestamp();

      embeds.push(embed);
    }

    return interaction.reply({ embeds });
  },
};
