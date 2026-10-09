const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const queries = require('../database/queries');
const eloEvents = require('../events/eloEvents');

const PAGE_SIZE = 5;
const RANK_EMOJIS = ['🥇', '🥈', '🥉'];

let globalClient = null;
let debounceTimer = null;

function setWidgetClient(client) {
  globalClient = client;
}

function notifyEloChange(client = null) {
  const targetClient = client || globalClient;
  if (!targetClient) return;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    updateAllLeaderboardWidgets(targetClient).catch((err) => {
      console.error('Error auto-updating leaderboard widgets on Elo change:', err);
    });
  }, 100);
}

// Automatically subscribe to any Elo/rating change in the bot
eloEvents.on('eloChange', () => {
  notifyEloChange();
});

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

function getRankBadge(rank) {
  const tag = `\`#${String(rank + 1).padStart(2, '0')}\``;
  if (rank === 0) return `🥇 ${tag}`;
  if (rank === 1) return `🥈 ${tag}`;
  if (rank === 2) return `🥉 ${tag}`;
  return `🔹 ${tag}`;
}

/**
 * Builds the embed and navigation buttons for the leaderboard widget at the given page.
 * @param {number} [requestedPage=0] - 0-indexed page number
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
function createLeaderboardWidgetPayload(requestedPage = 0) {
  const allPlayers = queries.getAllPlayers();
  const rankedPlayers = allPlayers.filter((p) => (p.wins + p.losses) >= 5);
  const unrankedPlayers = allPlayers.filter((p) => (p.wins + p.losses) < 5);

  unrankedPlayers.sort((a, b) => {
    const diff = (b.wins + b.losses) - (a.wins + a.losses);
    if (diff !== 0) return diff;
    return (b.rating || 1000) - (a.rating || 1000);
  });

  const players = [...rankedPlayers, ...unrankedPlayers];
  const totalPages = Math.max(1, Math.ceil(players.length / PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, totalPages - 1));

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTimestamp();

  if (players.length === 0) {
    embed
      .setDescription(
        [
          '# 🏆 INHOUSE LEADERBOARD 🏆',
          '══════════════════════════════════════════════',
          '*No players linked yet! Use `/link` to join the standings.*',
          '══════════════════════════════════════════════',
        ].join('\n')
      )
      .setFooter({ text: 'Auto-updates on match records' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('lb_widget:refresh:0')
        .setLabel('Refresh')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
  }

  // Get top 3 champions for all players
  const topChampsMap = queries.getAllTopChampions(3);
  const recentFormsMap = queries.getAllRecentForms(5);

  const startIdx = page * PAGE_SIZE;
  const pagePlayers = players.slice(startIdx, startIdx + PAGE_SIZE);

  const headerLines = [
    '# 🏆 INHOUSE LEADERBOARD 🏆',
    '══════════════════════════════════════════════',
    `👥 **Players**: \`${players.length}\`   •   🎮 **Ranked**: \`${rankedPlayers.length}\``,
    '══════════════════════════════════════════════',
    '',
  ];

  const cardLines = pagePlayers.map((p, i) => {
    const isRanked = (p.wins + p.losses) >= 5;
    const form = recentFormsMap.get(p.discord_id) || [];
    const formCircles = form.map((won) => (won ? '🟢' : '🔴')).join('');

    if (isRanked) {
      const globalRank = rankedPlayers.indexOf(p);
      const rankBadge = getRankBadge(globalRank);
      const ratingVal = Math.round(p.rating || 1000);
      const tier = skillTier(ratingVal);
      const totalGames = p.wins + p.losses;
      const winRate = `${Math.round((p.wins / totalGames) * 100)}%`;

      const champs = topChampsMap.get(p.discord_id) || [];
      const champText =
        champs.length > 0
          ? champs.map((c) => `**${c.champion}** ${c.win_rate}% *(${c.games}G)*`).join(' • ')
          : '*No champion data available*';

      const lines = [
        `> ${rankBadge}  **${ratingVal} Elo** — **${p.riot_name}** ${tier.emoji}`,
        `> └ 📊 **${p.wins}W ${p.losses}L** (${winRate} WR) • ${tier.name}`,
      ];

      if (formCircles) {
        lines.push(`> └ 🎮 **Recent**: ${formCircles}`);
      }

      lines.push(`> └ ⚔️ ${champText}`);

      let card = lines.join('\n');

      // Add visual divider after podium (ranks 1-3)
      if (globalRank === 2 && (pagePlayers.length > 3 || unrankedPlayers.length > 0)) {
        card += '\n> \n> ──────────────────────────────────────────';
      }

      // If next player on this page is unranked, add divider
      if (i < pagePlayers.length - 1 && (pagePlayers[i + 1].wins + pagePlayers[i + 1].losses) < 5) {
        card += '\n> \n> ──────────────────────────────────────────';
      }

      return card;
    } else {
      // Unranked player (<5 games played)
      const games = p.wins + p.losses;
      const unrankedLines = [
        `> ⚪ **${p.riot_name}** — *Unranked (${games}/5)*`,
      ];
      if (formCircles) {
        unrankedLines.push(`> └ 🎮 **Recent**: ${formCircles}`);
      }
      return unrankedLines.join('\n');
    }
  });

  const footerBanner = [
    '',
    '══════════════════════════════════════════════',
  ];

  embed
    .setDescription([...headerLines, cardLines.join('\n\n'), ...footerBanner].join('\n'))
    .setFooter({
      text: `Page ${page + 1}/${totalPages} • Season 2026 • Recent: 🟢W 🔴L (past 5) • OpenSkill Engine`,
    });

  const components = [];

  if (totalPages === 1) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('lb_widget:status:0')
        .setLabel('Page 1 of 1')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('lb_widget:refresh:0')
        .setLabel('Refresh')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary)
    );
    components.push(row);
  } else {
    // Row 1: Primary sequential navigation (Previous, Page Counter, Next)
    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`lb_widget:prev:${page - 1}`)
        .setLabel('Previous')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('lb_widget:status:current')
        .setLabel(`Page ${page + 1} of ${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`lb_widget:next:${page + 1}`)
        .setLabel('Next')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page >= totalPages - 1)
    );

    // Row 2: Direct jump controls & live refresh (Top 5, Last Page, Refresh)
    const jumpRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('lb_widget:first:0')
        .setLabel('Top 5')
        .setEmoji('⏮️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`lb_widget:last:${totalPages - 1}`)
        .setLabel('Last Page')
        .setEmoji('⏭️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId(`lb_widget:refresh:${page}`)
        .setLabel('Refresh')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary)
    );

    components.push(navRow, jumpRow);
  }

  return { embeds: [embed], components };
}

/**
 * Handles button interactions for the leaderboard widget.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleLeaderboardWidgetInteraction(interaction) {
  if (!interaction.isButton()) return;
  const parts = interaction.customId.split(':');
  // Format: lb_widget:<action>:<page>
  const action = parts[1];
  const pageArg = parts[2];

  if (action === 'noop' || action === 'status') {
    return interaction.deferUpdate().catch(() => {});
  }

  let targetPage = parseInt(pageArg, 10);
  if (isNaN(targetPage)) targetPage = 0;

  try {
    const payload = createLeaderboardWidgetPayload(targetPage);
    await interaction.update(payload);
  } catch (err) {
    console.error('Error handling leaderboard widget button interaction:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate().catch(() => {});
    }
  }
}

/**
 * Refreshes all active persistent leaderboard widgets across channels/guilds.
 * @param {import('discord.js').Client} [client]
 */
async function updateAllLeaderboardWidgets(client = null) {
  const activeClient = client || globalClient;
  if (!activeClient) return;
  if (typeof activeClient.isReady === 'function' && !activeClient.isReady()) return;

  const widgets = queries.getAllLeaderboardWidgets();
  if (!widgets || widgets.length === 0) return;

  // Render fresh Top 5 payload
  const payload = createLeaderboardWidgetPayload(0);

  for (const w of widgets) {
    try {
      const channel =
        activeClient.channels.cache?.get(w.channel_id) ||
        (await activeClient.channels.fetch(w.channel_id).catch(() => null));

      if (!channel || !channel.isTextBased()) {
        queries.deleteLeaderboardWidget(w.channel_id);
        continue;
      }

      const message = await channel.messages.fetch(w.message_id).catch(() => null);
      if (!message) {
        queries.deleteLeaderboardWidget(w.channel_id);
        continue;
      }

      await message.edit(payload);
    } catch (err) {
      if (err.code === 10008 || err.code === 10003) {
        // Unknown message or unknown channel - delete stale entry
        queries.deleteLeaderboardWidget(w.channel_id);
      } else {
        console.error(`Failed to update leaderboard widget in channel ${w.channel_id}:`, err);
      }
    }
  }
}

module.exports = {
  PAGE_SIZE,
  createLeaderboardWidgetPayload,
  handleLeaderboardWidgetInteraction,
  updateAllLeaderboardWidgets,
  setWidgetClient,
  notifyEloChange,
};
