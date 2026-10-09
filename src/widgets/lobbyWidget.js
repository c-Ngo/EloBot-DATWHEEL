const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');
const queries = require('../database/queries');

let lobbyWidgetClient = null;

function setLobbyWidgetClient(client) {
  lobbyWidgetClient = client;
}

/**
 * Builds the embed and interactive components for an idle lobby widget (no active lobby).
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
function createIdleLobbyWidgetPayload() {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('⚔️ 10 MAN INHOUSE LOBBY ⚔️')
    .setDescription([
      '══════════════════════════════════════════════',
      '⚡ **Status**: `⚪ No Active Lobby`',
      '══════════════════════════════════════════════',
      '',
      '> 🎮 There is currently no active inhouse match lobby.',
      '> Click **Create Lobby** below to open a 10-player match queue!',
      '',
      '══════════════════════════════════════════════',
    ].join('\n'))
    .setFooter({
      text: 'Season 2026 • 10 Man Inhouse • OpenSkill Bayesian Engine',
    })
    .setTimestamp();

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lobby:create')
      .setLabel('Create Lobby')
      .setEmoji('⚔️')
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [actionRow] };
}

/**
 * Sets up a permanent inhouse lobby widget in the specified channel.
 * @param {import('discord.js').TextChannel} targetChannel
 * @param {string} guildId
 * @returns {Promise<import('discord.js').Message>}
 */
async function setupLobbyWidget(targetChannel, guildId) {
  const activeLobby = queries.getActiveLobbyForChannel(targetChannel.id);
  const payload = activeLobby
    ? createLobbyWidgetPayload(activeLobby.lobby_id)
    : createIdleLobbyWidgetPayload();

  // Clean up any previously registered widget message in this channel
  const existing = queries.getLobbyWidget(targetChannel.id);
  if (existing) {
    try {
      const oldMsg = await targetChannel.messages.fetch(existing.message_id).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => {});
    } catch (_) {}
  }

  const sentMessage = await targetChannel.send(payload);
  queries.saveLobbyWidget(targetChannel.id, guildId, sentMessage.id);

  if (activeLobby) {
    queries.updateLobbyMessageId(activeLobby.lobby_id, sentMessage.id);
  }

  return sentMessage;
}

/**
 * Updates a lobby widget in a channel to either its active lobby or idle state.
 * @param {string} channelId
 * @param {import('discord.js').Client} [client]
 */
async function updateLobbyWidget(channelId, client) {
  const cl = client || lobbyWidgetClient;
  if (!cl) return;

  const widget = queries.getLobbyWidget(channelId);
  if (!widget) return;

  try {
    const channel = await cl.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const msg = await channel.messages.fetch(widget.message_id).catch(() => null);
    if (!msg) {
      queries.deleteLobbyWidget(channelId);
      return;
    }

    const activeLobby = queries.getActiveLobbyForChannel(channelId);
    const payload = activeLobby
      ? createLobbyWidgetPayload(activeLobby.lobby_id)
      : createIdleLobbyWidgetPayload();

    await msg.edit(payload).catch(console.error);
  } catch (err) {
    console.error(`Error updating lobby widget for channel ${channelId}:`, err);
  }
}

/**
 * Syncs all registered lobby widgets across channels on startup.
 * @param {import('discord.js').Client} [client]
 */
async function updateAllLobbyWidgets(client) {
  const cl = client || lobbyWidgetClient;
  if (!cl) return;

  const widgets = queries.getAllLobbyWidgets();
  for (const w of widgets) {
    await updateLobbyWidget(w.channel_id, cl);
  }
}

/**
 * Safely deletes a message by ID in a channel.
 * @param {import('discord.js').TextChannel} channel
 * @param {string|null} messageId
 */
async function deleteChannelMessage(channel, messageId) {
  if (!channel || !messageId) return;
  try {
    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (msg) {
      await msg.delete().catch(() => {});
    }
  } catch (_) {}
}

/**
 * Ensures the channel has at most 1 auxiliary announcement message:
 * - When full (10 players): Pings all 10 players that the lobby is full.
 * - When open (<10 players): Pings role that slots are available (if replacing full message).
 * @param {import('discord.js').TextChannel} channel
 * @param {string} lobbyId
 */
async function syncLobbyAnnouncement(channel, lobbyId) {
  if (!channel) return;
  const lobby = queries.getLobby(lobbyId);
  if (!lobby) return;

  const activePlayers = queries.getLobbyPlayers(lobbyId);
  const isFull = activePlayers.length >= 10;

  if (isFull) {
    // Delete existing creation/open announcement message if any
    if (lobby.announcement_message_id) {
      await deleteChannelMessage(channel, lobby.announcement_message_id);
    }

    // Ping all 10 players in the lobby that it is full
    const playerPings = activePlayers.map((p) => `<@${p.discord_id}>`).join(' ');
    const fullContent = `⚔️ **The 10 Man inhouse lobby is FULL (10/10)!** 🎲 Ready to spin teams!\n${playerPings}`;

    const newMsg = await channel.send({
      content: fullContent,
      allowedMentions: { parse: ['users'] },
    }).catch(() => null);

    queries.updateLobbyAnnouncementMessageId(lobbyId, newMsg ? newMsg.id : null);
  } else {
    // If lobby had an announcement message and now dropped below 10, replace with open slot ping
    if (lobby.announcement_message_id) {
      await deleteChannelMessage(channel, lobby.announcement_message_id);

      let leagueRole = null;
      if (channel.guild?.roles) {
        leagueRole =
          channel.guild.roles.cache.find((r) => r.name.toLowerCase() === 'league?') ||
          channel.guild.roles.cache.find((r) => r.name.toLowerCase() === 'league') ||
          channel.guild.roles.cache.find((r) => /league/i.test(r.name));
      }

      const openContent = leagueRole
        ? `<@&${leagueRole.id}> ⚔️ **A slot has opened in the 10 Man inhouse lobby (${activePlayers.length}/10)!**`
        : `⚔️ **@League? A slot has opened in the 10 Man inhouse lobby (${activePlayers.length}/10)!**`;

      const newMsg = await channel.send({
        content: openContent,
        allowedMentions: { parse: ['roles', 'users'] },
      }).catch(() => null);

      queries.updateLobbyAnnouncementMessageId(lobbyId, newMsg ? newMsg.id : null);
    }
  }
}

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
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const lobbyId = parts[2];
  const userId = interaction.user.id;

  // ── CREATE LOBBY BUTTON (OPEN MODAL) ──────────
  if (action === 'create') {
    const player = queries.getPlayer(userId);
    if (!player) {
      return interaction.reply({
        content: '❌ You must link your League of Legends account with `/link` before you can create an inhouse lobby!',
        ephemeral: true,
      });
    }

    const activeLobby = queries.getActiveLobbyForChannel(interaction.channelId);
    if (activeLobby) {
      const activePayload = createLobbyWidgetPayload(activeLobby.lobby_id);
      if (activePayload && interaction.isButton()) {
        await interaction.update(activePayload).catch(() => {});
      }
      return interaction.followUp({
        content: '⚠️ An active lobby is already running in this channel!',
        ephemeral: true,
      }).catch(() => {});
    }

    const modal = new ModalBuilder()
      .setCustomId('lobby:modal_create')
      .setTitle('Create 10 Man Inhouse Lobby');

    const timeInput = new TextInputBuilder()
      .setCustomId('lobby_time')
      .setLabel('Scheduled Time (Optional)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. ASAP, in 30m, 20:30 CET')
      .setValue('ASAP / When Full')
      .setRequired(false)
      .setMaxLength(50);

    const titleInput = new TextInputBuilder()
      .setCustomId('lobby_title')
      .setLabel('Lobby Title (Optional)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. Inhouse 5v5')
      .setValue('Inhouse 5v5')
      .setRequired(false)
      .setMaxLength(60);

    modal.addComponents(
      new ActionRowBuilder().addComponents(timeInput),
      new ActionRowBuilder().addComponents(titleInput)
    );

    return interaction.showModal(modal);
  }

  // ── MODAL SUBMIT: INITIALIZE LOBBY ────────────
  if (action === 'modal_create' && interaction.isModalSubmit()) {
    const player = queries.getPlayer(userId);
    if (!player) {
      return interaction.reply({
        content: '❌ You must link your League of Legends account with `/link` before creating a lobby!',
        ephemeral: true,
      });
    }

    const activeLobby = queries.getActiveLobbyForChannel(interaction.channelId);
    if (activeLobby) {
      return interaction.reply({
        content: '⚠️ An active lobby is already running in this channel!',
        ephemeral: true,
      });
    }

    const time = interaction.fields.getTextInputValue('lobby_time')?.trim() || 'ASAP / When Full';
    const title = interaction.fields.getTextInputValue('lobby_title')?.trim() || 'Inhouse 5v5';
    const newLobbyId = `lobby_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Identify the persistent widget message id
    const widget = queries.getLobbyWidget(interaction.channelId);
    const messageId = widget ? widget.message_id : (interaction.message?.id || newLobbyId);

    // Create the lobby in SQLite
    queries.createLobby({
      lobby_id: newLobbyId,
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
      message_id: messageId,
      owner_id: userId,
      scheduled_time: time,
      title: title,
    });

    const activePayload = createLobbyWidgetPayload(newLobbyId);

    // Update the persistent widget message in channel
    try {
      const channel = interaction.channel;
      const msg = await channel.messages.fetch(messageId).catch(() => null);
      if (msg && activePayload) {
        await msg.edit(activePayload);
      }
    } catch (err) {
      console.error('Failed to update persistent lobby widget on create:', err);
    }

    // Role ping in channel
    let leagueRole = null;
    if (interaction.guild?.roles) {
      leagueRole =
        interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === 'league?') ||
        interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === 'league') ||
        interaction.guild.roles.cache.find((r) => /league/i.test(r.name));
    }

    const pingContent = leagueRole
      ? `<@&${leagueRole.id}> ⚔️ **<@${userId}> has opened an inhouse 10-man lobby!**`
      : `⚔️ **@League? <@${userId}> has opened an inhouse 10-man lobby!**`;

    const announceMsg = await interaction.channel.send({
      content: pingContent,
      allowedMentions: { parse: ['roles', 'users'] },
    }).catch(() => null);

    if (announceMsg) {
      queries.updateLobbyAnnouncementMessageId(newLobbyId, announceMsg.id);
    }

    return interaction.reply({
      content: `✅ Inhouse lobby **${title}** created! Click **Join** on the widget to claim your spot.`,
      ephemeral: true,
    });
  }

  const lobby = queries.getLobby(lobbyId);
  if (!lobby) {
    const idlePayload = createIdleLobbyWidgetPayload();
    if (interaction.isButton()) {
      await interaction.update(idlePayload).catch(() => {});
    }
    return interaction.followUp({
      content: '❌ This lobby no longer exists or has already been dissolved.',
      ephemeral: true,
    }).catch(() => {});
  }

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
      await interaction.update(payload);

      // When lobby reaches 10 players, remove creation message and ping all 10 players
      const activePlayers = queries.getLobbyPlayers(lobbyId);
      if (activePlayers.length >= 10) {
        await syncLobbyAnnouncement(interaction.channel, lobbyId);
      }
      return;
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
      }

      // If lobby dropped below 10 players, sync announcement
      const activePlayers = queries.getLobbyPlayers(lobbyId);
      if (activePlayers.length < 10) {
        await syncLobbyAnnouncement(interaction.channel, lobbyId);
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
      }

      // Sync announcement message if lobby dropped below 10
      const activePlayers = queries.getLobbyPlayers(lobbyId);
      if (activePlayers.length < 10) {
        await syncLobbyAnnouncement(interaction.channel, lobbyId);
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

    // Delete announcement/ping message from channel
    if (lobby.announcement_message_id) {
      await deleteChannelMessage(interaction.channel, lobby.announcement_message_id);
    }

    queries.deleteLobby(lobbyId);

    const idlePayload = createIdleLobbyWidgetPayload();
    await interaction.update(idlePayload);

    return interaction.followUp({
      content: '💥 Inhouse lobby has been dissolved. The widget has returned to waiting state.',
      ephemeral: true,
    }).catch(() => {});
  }
}

module.exports = {
  createIdleLobbyWidgetPayload,
  createLobbyWidgetPayload,
  setupLobbyWidget,
  updateLobbyWidget,
  updateAllLobbyWidgets,
  setLobbyWidgetClient,
  handleLobbyInteraction,
  deleteChannelMessage,
  syncLobbyAnnouncement,
};
