const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
} = require('discord.js');
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

/**
 * Builds the embed and interactive components for an inhouse lobby widget.
 * @param {string} lobbyId
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] } | null}
 */
function createLobbyWidgetPayload(lobbyId) {
  const lobby = queries.getLobby(lobbyId);
  if (!lobby) return null;

  const players = queries.getLobbyPlayers(lobbyId);
  const waitlist = queries.getLobbyWaitlist(lobbyId);
  const count = players.length;
  const isFull = count >= 10;

  // Header requirement: "Change header to '10 MAN LOADING' when lobby is not full and '10 MAN' when full."
  const baseHeader = isFull ? '10 MAN' : '10 MAN LOADING';
  const isCustomTitle = lobby.title && lobby.title !== 'Inhouse 5v5';
  const headerTitle = isCustomTitle
    ? `# ⚔️ ${baseHeader}: ${lobby.title.toUpperCase()} ⚔️`
    : `# ⚔️ ${baseHeader} ⚔️`;

  let statusText = '🟡 Gathering Players (Open)';
  if (isFull) {
    statusText = lobby.teams_json ? '🎲 Teams Generated' : '🟢 Full (10/10) — Ready to Spin!';
  }

  const timeDisplay = lobby.scheduled_time && lobby.scheduled_time.trim() !== ''
    ? lobby.scheduled_time
    : 'ASAP / When Full';

  const waitlistNote = waitlist.length > 0 ? ` *(+${waitlist.length} waiting)*` : '';

  const headerLines = [
    headerTitle,
    '══════════════════════════════════════════════',
    `📅 **Scheduled Time**: \`${timeDisplay}\``,
    `👑 **Host**: <@${lobby.owner_id}>   •   👥 **Players**: \`${count}/10\`${waitlistNote}`,
    `⚡ **Status**: \`${statusText}\``,
    '══════════════════════════════════════════════',
    '',
  ];

  // 10 spots rendering
  const slotLines = [];
  for (let slot = 1; slot <= 10; slot++) {
    const p = players.find((x) => x.slot_number === slot);
    const slotTag = `\`[${String(slot).padStart(2, '0')}]\``;

    if (p) {
      const isRanked = (p.wins + p.losses) >= 5;
      if (isRanked) {
        const tier = skillTier(p.rating || 1000);
        slotLines.push(
          `> ${slotTag} 🟢 **${p.riot_name}** • **${Math.round(p.rating || 1000)} Elo** ${tier.emoji} — <@${p.discord_id}>`
        );
      } else {
        slotLines.push(
          `> ${slotTag} 🟢 **${p.riot_name}** • *Unranked (${p.wins + p.losses}/5)* — <@${p.discord_id}>`
        );
      }
    } else {
      slotLines.push(`> ${slotTag} ⚪ *Open Spot — Click Join*`);
    }
  }

  // Waitlist section
  let waitlistSection = [];
  if (waitlist.length > 0) {
    waitlistSection = [
      '',
      '══════════════════════════════════════════════',
      `⏳ **WAITLIST (${waitlist.length})**`,
      ...waitlist.map((w, idx) => {
        const isRanked = (w.wins + w.losses) >= 5;
        if (isRanked) {
          const tier = skillTier(w.rating || 1000);
          return `> \`#${idx + 1}\` **${w.riot_name}** (${Math.round(w.rating || 1000)} Elo ${tier.emoji}) — <@${w.discord_id}>`;
        } else {
          return `> \`#${idx + 1}\` **${w.riot_name}** (*Unranked ${w.wins + w.losses}/5*) — <@${w.discord_id}>`;
        }
      }),
    ];
  }

  // Randomized teams section
  let teamsSection = [];
  if (lobby.teams_json) {
    try {
      const teams = JSON.parse(lobby.teams_json);
      const blueAvg = Math.round(
        teams.blue.reduce((acc, p) => acc + (p.rating || 1000), 0) / (teams.blue.length || 1)
      );
      const redAvg = Math.round(
        teams.red.reduce((acc, p) => acc + (p.rating || 1000), 0) / (teams.red.length || 1)
      );

      teamsSection = [
        '',
        '══════════════════════════════════════════════',
        '### 🎲 RANDOM TEAMS (5v5)',
        `🔵 **BLUE TEAM** (Avg: **${blueAvg} Elo**)`,
        ...teams.blue.map((p, i) => {
          const isRanked = (p.wins + p.losses) >= 5;
          const ratingStr = isRanked ? `${Math.round(p.rating || 1000)} Elo` : `Unranked (${p.wins + p.losses}/5)`;
          return `> \`${i + 1}.\` **${p.riot_name}** (${ratingStr}) — <@${p.discord_id}>`;
        }),
        '',
        `🔴 **RED TEAM** (Avg: **${redAvg} Elo**)`,
        ...teams.red.map((p, i) => {
          const isRanked = (p.wins + p.losses) >= 5;
          const ratingStr = isRanked ? `${Math.round(p.rating || 1000)} Elo` : `Unranked (${p.wins + p.losses}/5)`;
          return `> \`${i + 1}.\` **${p.riot_name}** (${ratingStr}) — <@${p.discord_id}>`;
        }),
      ];
    } catch (e) {
      console.error('Error parsing lobby teams_json:', e);
    }
  }

  const footerBanner = [
    '',
    '══════════════════════════════════════════════',
  ];

  const embed = new EmbedBuilder()
    .setColor(isFull ? 0x2ecc71 : 0x3498db)
    .setDescription([
      ...headerLines,
      ...slotLines,
      ...waitlistSection,
      ...teamsSection,
      ...footerBanner,
    ].join('\n'))
    .setFooter({
      text: 'Season 2026 • Use buttons below • Linked accounts only',
    })
    .setTimestamp();

  // Control Buttons (All in 1 ActionRow)
  const joinLabel = isFull ? 'Join Waitlist' : 'Join';
  const joinEmoji = isFull ? '⏳' : '⚔️';

  const spinLabel = !isFull
    ? '🎲 Spin Teams (Need 10)'
    : lobby.teams_json
    ? '🎲 Re-Spin Teams'
    : '🎲 Spin Random Teams';

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lobby:join:${lobbyId}`)
      .setLabel(joinLabel)
      .setEmoji(joinEmoji)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`lobby:leave:${lobbyId}`)
      .setLabel('Leave')
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`lobby:spin:${lobbyId}`)
      .setLabel(spinLabel)
      .setStyle(isFull ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!isFull),
    new ButtonBuilder()
      .setCustomId(`lobby:kick:${lobbyId}`)
      .setLabel('Kick')
      .setEmoji('👢')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`lobby:dissolve:${lobbyId}`)
      .setLabel('Dissolve')
      .setEmoji('💥')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [actionRow] };
}

/**
 * Handles button and select menu interactions for the lobby widget.
 * @param {import('discord.js').Interaction} interaction
 */
async function handleLobbyInteraction(interaction) {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const lobbyId = parts[2];

  const lobby = queries.getLobby(lobbyId);
  if (!lobby) {
    return interaction.reply({
      content: '❌ This lobby no longer exists or has already been dissolved.',
      ephemeral: true,
    });
  }

  const userId = interaction.user.id;

  // ── JOIN ACTION (OR JOIN WAITLIST IF FULL) ─────
  if (action === 'join') {
    const player = queries.getPlayer(userId);
    if (!player) {
      return interaction.reply({
        content: '❌ You must link your League of Legends account with `/link` before you can join an inhouse lobby!',
        ephemeral: true,
      });
    }

    const existingActive = queries.getLobbyPlayer(lobbyId, userId);
    if (existingActive) {
      return interaction.reply({
        content: `ℹ️ You are already in the active lobby (**Slot [${String(existingActive.slot_number).padStart(2, '0')}]**).`,
        ephemeral: true,
      });
    }

    const existingWaitlist = queries.getWaitlistPlayer(lobbyId, userId);
    if (existingWaitlist) {
      return interaction.reply({
        content: 'ℹ️ You are already on the waitlist for this lobby.',
        ephemeral: true,
      });
    }

    const nextSlot = queries.getNextAvailableSlot(lobbyId);
    if (nextSlot) {
      // Slot available in the active 10
      queries.addPlayerToLobby(lobbyId, userId, nextSlot);
      const payload = createLobbyWidgetPayload(lobbyId);
      return interaction.update(payload);
    } else {
      // 10 spots full -> Add to waitlist
      queries.addPlayerToWaitlist(lobbyId, userId);
      const waitlist = queries.getLobbyWaitlist(lobbyId);
      const pos = waitlist.findIndex((w) => w.discord_id === userId) + 1;

      const payload = createLobbyWidgetPayload(lobbyId);
      await interaction.update(payload);

      return interaction.followUp({
        content: `✅ The active lobby is currently full (10/10). You have been placed on the **Waitlist (Position #${pos})**! You will be automatically moved into the game if someone leaves or is kicked.`,
        ephemeral: true,
      }).catch(() => {});
    }
  }

  // ── LEAVE ACTION ──────────────────────────────
  if (action === 'leave') {
    const existingActive = queries.getLobbyPlayer(lobbyId, userId);
    const existingWaitlist = queries.getWaitlistPlayer(lobbyId, userId);

    if (!existingActive && !existingWaitlist) {
      return interaction.reply({
        content: 'ℹ️ You are not currently in this lobby or waitlist.',
        ephemeral: true,
      });
    }

    if (existingWaitlist) {
      queries.removePlayerFromWaitlist(lobbyId, userId);
      const payload = createLobbyWidgetPayload(lobbyId);
      await interaction.update(payload);
      return interaction.followUp({
        content: '✅ You have been removed from the waitlist.',
        ephemeral: true,
      }).catch(() => {});
    }

    if (existingActive) {
      const vacatedSlot = existingActive.slot_number;
      queries.removePlayerFromLobby(lobbyId, userId);
      queries.clearLobbyTeams(lobbyId);

      // Auto-fill from waitlist if players are waiting
      const promoted = queries.popNextWaitlistPlayer(lobbyId);
      if (promoted) {
        queries.addPlayerToLobby(lobbyId, promoted.discord_id, vacatedSlot);
        interaction.channel.send({
          content: `🎉 <@${promoted.discord_id}> was automatically moved from the waitlist into **Slot [${String(vacatedSlot).padStart(2, '0')}]**!`,
        }).catch(() => {});
      }

      const payload = createLobbyWidgetPayload(lobbyId);
      return interaction.update(payload);
    }
  }

  // ── KICK ACTION (OPEN SELECT MENU) ────────────
  if (action === 'kick') {
    const isOwner = userId === lobby.owner_id;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

    if (!isOwner && !isAdmin) {
      return interaction.reply({
        content: `❌ Only the lobby host (<@${lobby.owner_id}>) or server Administrators can kick players from this lobby.`,
        ephemeral: true,
      });
    }

    const activePlayers = queries.getLobbyPlayers(lobbyId);
    const waitlist = queries.getLobbyWaitlist(lobbyId);

    if (activePlayers.length === 0 && waitlist.length === 0) {
      return interaction.reply({
        content: '❌ No players currently in the lobby to kick.',
        ephemeral: true,
      });
    }

    const options = [];

    for (const p of activePlayers) {
      const isRanked = (p.wins + p.losses) >= 5;
      const desc = isRanked ? `Rating: ${Math.round(p.rating || 1000)} Elo` : `Unranked (${p.wins + p.losses}/5)`;
      options.push({
        label: `Slot [${String(p.slot_number).padStart(2, '0')}]: ${p.riot_name.slice(0, 50)}`,
        value: `active:${p.discord_id}:${p.slot_number}`,
        description: desc,
      });
    }

    for (let i = 0; i < waitlist.length; i++) {
      const w = waitlist[i];
      const isRanked = (w.wins + w.losses) >= 5;
      const desc = isRanked ? `Waiting queue • ${Math.round(w.rating || 1000)} Elo` : `Waiting • Unranked (${w.wins + w.losses}/5)`;
      options.push({
        label: `Waitlist #${i + 1}: ${w.riot_name.slice(0, 50)}`,
        value: `waitlist:${w.discord_id}:0`,
        description: desc,
      });
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`lobby:kick_select:${lobbyId}`)
      .setPlaceholder('Select a player to kick...')
      .addOptions(options.slice(0, 25)); // Discord max 25 select options

    const row = new ActionRowBuilder().addComponents(selectMenu);

    return interaction.reply({
      content: '👢 **Select a player to kick from the lobby:**',
      components: [row],
      ephemeral: true,
    });
  }

  // ── KICK SELECT MENU EXECUTION ─────────────────
  if (action === 'kick_select' && interaction.isStringSelectMenu()) {
    const isOwner = userId === lobby.owner_id;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

    if (!isOwner && !isAdmin) {
      return interaction.reply({
        content: '❌ You do not have permission to kick players from this lobby.',
        ephemeral: true,
      });
    }

    const selectedVal = interaction.values[0];
    const [type, targetDiscordId, slotStr] = selectedVal.split(':');

    if (type === 'active') {
      const slotNum = parseInt(slotStr, 10);
      queries.removePlayerFromLobby(lobbyId, targetDiscordId);
      queries.clearLobbyTeams(lobbyId);

      // Auto-fill from waitlist if players are waiting
      const promoted = queries.popNextWaitlistPlayer(lobbyId);
      if (promoted) {
        queries.addPlayerToLobby(lobbyId, promoted.discord_id, slotNum);
        interaction.channel.send({
          content: `🎉 <@${promoted.discord_id}> was automatically moved from the waitlist into **Slot [${String(slotNum).padStart(2, '0')}]**!`,
        }).catch(() => {});
      }
    } else if (type === 'waitlist') {
      queries.removePlayerFromWaitlist(lobbyId, targetDiscordId);
    }

    // Refresh main lobby message
    const payload = createLobbyWidgetPayload(lobbyId);
    const message = await interaction.channel.messages.fetch(lobby.message_id).catch(() => null);
    if (message) {
      await message.edit(payload).catch(console.error);
    }

    return interaction.update({
      content: `✅ Successfully kicked <@${targetDiscordId}> from the lobby.`,
      components: [],
    });
  }

  // ── SPIN / RANDOMIZE TEAMS ────────────────────
  if (action === 'spin') {
    const players = queries.getLobbyPlayers(lobbyId);
    if (players.length < 10) {
      return interaction.reply({
        content: `⚠️ The lobby must be full (10/10 players) to randomize 5v5 teams! Currently: ${players.length}/10.`,
        ephemeral: true,
      });
    }

    // Fisher-Yates shuffle
    const shuffled = [...players];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const blue = shuffled.slice(0, 5);
    const red = shuffled.slice(5, 10);
    const teamsData = JSON.stringify({ blue, red, spunAt: new Date().toISOString() });

    queries.updateLobbyTeams(lobbyId, teamsData, 'randomized');

    const payload = createLobbyWidgetPayload(lobbyId);
    return interaction.update(payload);
  }

  // ── DISSOLVE ACTION ───────────────────────────
  if (action === 'dissolve') {
    const isOwner = userId === lobby.owner_id;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

    if (!isOwner && !isAdmin) {
      return interaction.reply({
        content: `❌ Only the lobby host (<@${lobby.owner_id}>) or server Administrators can dissolve this lobby.`,
        ephemeral: true,
      });
    }

    queries.deleteLobby(lobbyId);

    // Delete message widget
    await interaction.message.delete().catch(() => {});
    return interaction.reply({
      content: '💥 Inhouse lobby has been dissolved and removed.',
      ephemeral: true,
    }).catch(() => {});
  }
}

module.exports = {
  createLobbyWidgetPayload,
  handleLobbyInteraction,
};
