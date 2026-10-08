const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');
const queries = require('../database/queries');
const {
  createLeaderboardWidgetPayload,
} = require('../widgets/leaderboardWidget');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard-widget')
    .setDescription('Set up or manage a permanent live leaderboard widget in a read-only channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Target read-only channel for the leaderboard widget (default: current channel)')
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
        content: '❌ You need **Administrator** permissions to configure the leaderboard widget.',
        ephemeral: true,
      });
    }

    const action = interaction.options.getString('action') || 'setup';
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

    if (action === 'remove') {
      const existing = queries.getLeaderboardWidget(targetChannel.id);
      if (!existing) {
        return interaction.reply({
          content: `❌ No active leaderboard widget found in <#${targetChannel.id}>.`,
          ephemeral: true,
        });
      }

      // Attempt to delete message if it still exists
      try {
        const msg = await targetChannel.messages.fetch(existing.message_id).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      } catch (_) {}

      queries.deleteLeaderboardWidget(targetChannel.id);
      return interaction.reply({
        content: `🗑️ Leaderboard widget successfully removed from <#${targetChannel.id}>.`,
        ephemeral: true,
      });
    }

    if (action === 'refresh') {
      const existing = queries.getLeaderboardWidget(targetChannel.id);
      if (!existing) {
        return interaction.reply({
          content: `❌ No active leaderboard widget found in <#${targetChannel.id}>. Run \`/leaderboard-widget\` to create one!`,
          ephemeral: true,
        });
      }

      try {
        const msg = await targetChannel.messages.fetch(existing.message_id).catch(() => null);
        if (!msg) {
          queries.deleteLeaderboardWidget(targetChannel.id);
          return interaction.reply({
            content: `❌ The widget message in <#${targetChannel.id}> was deleted. Please run \`/leaderboard-widget\` again to post a fresh one.`,
            ephemeral: true,
          });
        }

        const payload = createLeaderboardWidgetPayload(0);
        await msg.edit(payload);

        return interaction.reply({
          content: `🔄 Leaderboard widget in <#${targetChannel.id}> has been refreshed!`,
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

    // Clean up previous registered message in this channel if any
    const existing = queries.getLeaderboardWidget(targetChannel.id);
    if (existing) {
      try {
        const oldMsg = await targetChannel.messages.fetch(existing.message_id).catch(() => null);
        if (oldMsg) await oldMsg.delete().catch(() => {});
      } catch (_) {}
    }

    try {
      const payload = createLeaderboardWidgetPayload(0);
      const sentMessage = await targetChannel.send(payload);

      queries.saveLeaderboardWidget(targetChannel.id, interaction.guildId, sentMessage.id);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00cc88)
            .setTitle('🏆 Persistent Leaderboard Widget Created')
            .setDescription(
              `The live leaderboard widget is now active in <#${targetChannel.id}>!\n\n` +
              `• **Top 5 Standings**: Displays ranks 1–5 by default (optimized for mobile)\n` +
              `• **Interactive Controls**: Anyone can use the pagination buttons to browse beyond the top 5\n` +
              `• **Always Up to Date**: Automatically refreshes whenever a match is recorded with \`/record\``
            )
            .setFooter({ text: 'Tip: Set this channel to read-only for members for a dedicated clean widget channel.' }),
        ],
      });
    } catch (err) {
      console.error('Failed to post leaderboard widget:', err);
      return interaction.editReply({
        content: `❌ Failed to create leaderboard widget: ${err.message}`,
      });
    }
  },
};
