const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');
const queries = require('../database/queries');
const {
  setupLobbyWidget,
  updateLobbyWidget,
} = require('../widgets/lobbyWidget');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lobby-widget')
    .setDescription('Set up or manage a permanent live match lobby widget in a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Target channel for the lobby widget (default: current channel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('action')
        .setDescription('Action to perform (setup, refresh, or remove)')
        .setRequired(false)
        .addChoices(
          { name: 'Setup / Create Widget (default)', value: 'setup' },
          { name: 'Refresh Existing Widget', value: 'refresh' },
          { name: 'Remove / Delete Widget', value: 'remove' }
        )
    ),

  async execute(interaction) {
    // Check permission (Administrator only)
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: '❌ You need **Administrator** permissions to configure the lobby widget.',
        ephemeral: true,
      });
    }

    const action = interaction.options.getString('action') || 'setup';
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

    if (action === 'remove') {
      const existing = queries.getLobbyWidget(targetChannel.id);
      if (!existing) {
        return interaction.reply({
          content: `❌ No active lobby widget found in <#${targetChannel.id}>.`,
          ephemeral: true,
        });
      }

      // Attempt to delete message if it still exists
      try {
        const msg = await targetChannel.messages.fetch(existing.message_id).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      } catch (_) {}

      // If active lobby in this channel, delete announcement message and lobby
      const activeLobby = queries.getActiveLobbyForChannel(targetChannel.id);
      if (activeLobby) {
        if (activeLobby.announcement_message_id) {
          try {
            const announceMsg = await targetChannel.messages.fetch(activeLobby.announcement_message_id).catch(() => null);
            if (announceMsg) await announceMsg.delete().catch(() => {});
          } catch (_) {}
        }
        queries.deleteLobby(activeLobby.lobby_id);
      }

      queries.deleteLobbyWidget(targetChannel.id);
      return interaction.reply({
        content: `🗑️ Inhouse lobby widget successfully removed from <#${targetChannel.id}>.`,
        ephemeral: true,
      });
    }

    if (action === 'refresh') {
      const existing = queries.getLobbyWidget(targetChannel.id);
      if (!existing) {
        return interaction.reply({
          content: `❌ No active lobby widget found in <#${targetChannel.id}>. Run \`/lobby-widget\` to create one!`,
          ephemeral: true,
        });
      }

      try {
        await updateLobbyWidget(targetChannel.id, interaction.client);
        return interaction.reply({
          content: `🔄 Inhouse lobby widget in <#${targetChannel.id}> has been refreshed!`,
          ephemeral: true,
        });
      } catch (err) {
        return interaction.reply({
          content: `❌ Failed to refresh widget: ${err.message}`,
          ephemeral: true,
        });
      }
    }

    // Default action: 'setup'
    // Verify bot permissions in target channel
    const botMember = interaction.guild?.members?.me;
    if (botMember) {
      const perms = targetChannel.permissionsFor(botMember);
      if (perms && !perms.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
        return interaction.reply({
          content: `❌ I am missing permissions in <#${targetChannel.id}>. Please ensure I have **View Channel**, **Send Messages**, and **Embed Links**.`,
          ephemeral: true,
        });
      }
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      await setupLobbyWidget(targetChannel, interaction.guildId);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00cc88)
            .setTitle('⚔️ Persistent Inhouse Lobby Widget Created')
            .setDescription(
              `The permanent inhouse lobby widget is now active in <#${targetChannel.id}>!\n\n` +
              `• **Permanent Match Queue**: Always present in the channel\n` +
              `• **Idle State**: Displays waiting status with a **Create Lobby** button when no game is active\n` +
              `• **Interactive 10-Man Lobby**: Full slot claiming, automated waitlist, team spinner, and host controls\n` +
              `• **Auto-Resetting**: Reverts to waiting state as soon as a lobby is dissolved`
            )
            .setFooter({ text: 'Tip: Members can click the Create Lobby button to start a match anytime!' }),
        ],
      });
    } catch (err) {
      console.error('Failed to post lobby widget:', err);
      return interaction.editReply({
        content: `❌ Failed to create lobby widget: ${err.message}`,
      });
    }
  },
};
