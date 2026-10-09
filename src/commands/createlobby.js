const { SlashCommandBuilder } = require('discord.js');
const queries = require('../database/queries');
const { createLobbyWidgetPayload } = require('../widgets/lobbyWidget');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createlobby')
    .setDescription('Create an interactive 10-player inhouse match lobby with random team spinning')
    .addStringOption((opt) =>
      opt
        .setName('time')
        .setDescription('Optional scheduled match time (e.g. "8:00 PM", "in 30m", "20:30 CET")')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('title')
        .setDescription('Lobby title or description (default: "Inhouse 5v5")')
        .setRequired(false)
    ),

  async execute(interaction) {
    const time = interaction.options.getString('time') || 'ASAP / When Full';
    const title = interaction.options.getString('title') || 'Inhouse 5v5';
    const lobbyId = `lobby_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Defer reply so we can post the full widget
    await interaction.deferReply();

    // Insert lobby into DB initially with unique placeholder message_id
    queries.createLobby({
      lobby_id: lobbyId,
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
      message_id: lobbyId,
      owner_id: interaction.user.id,
      scheduled_time: time,
      title: title,
    });

    const payload = createLobbyWidgetPayload(lobbyId);
    if (!payload) {
      queries.deleteLobby(lobbyId);
      return interaction.editReply({ content: '❌ Failed to initialize lobby widget.' });
    }

    // Find the @League? role in the guild to ping
    let leagueRole = null;
    if (interaction.guild?.roles) {
      leagueRole =
        interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === 'league?') ||
        interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === 'league') ||
        interaction.guild.roles.cache.find((r) => /league/i.test(r.name));
    }

    const pingContent = leagueRole
      ? `<@&${leagueRole.id}> ⚔️ **A new 10 Man inhouse lobby has been created!**`
      : '⚔️ **@League? A new 10 Man inhouse lobby has been created!**';

    try {
      // Post lobby widget with role ping
      const message = await interaction.editReply({
        content: pingContent,
        embeds: payload.embeds,
        components: payload.components,
        allowedMentions: {
          parse: ['roles', 'users'],
        },
      });

      // Update real message_id in DB
      queries.updateLobbyMessageId(lobbyId, message.id);
    } catch (err) {
      queries.deleteLobby(lobbyId);
      throw err;
    }
  },
};
