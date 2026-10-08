const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const queries = require('../database/queries');
const config = require('../config');
const { updateAllLeaderboardWidgets } = require('../widgets/leaderboardWidget');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link a Riot account to a Discord user')
    .addStringOption((opt) =>
      opt
        .setName('riot_id')
        .setDescription('Riot ID in the format GameName#TagLine (e.g. Faker#KR1)')
        .setRequired(true)
    )
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('Discord user to link (search by username or mention, default: yourself)')
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('seed_rating')
        .setDescription(`Starting skill rating (default: ${config.defaultElo})`)
        .setMinValue(0)
        .setMaxValue(3000)
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const riotId = interaction.options.getString('riot_id').trim();
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const isSelf = targetUser.id === interaction.user.id;
    const seedRating = interaction.options.getInteger('seed_rating') ?? config.defaultElo;

    // Validate GameName#TagLine format
    const parts = riotId.split('#');
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle('❌ Invalid Riot ID Format')
            .setDescription(
              'Please use the format `GameName#TagLine` (e.g. `Faker#KR1` or `Doublelift#NA1`).\nThis must match your in-game name shown in custom replays.'
            ),
        ],
      });
    }

    const gameName = parts[0].trim();
    const tagLine = parts[1].trim();
    const formattedRiotId = `${gameName}#${tagLine}`;

    let puuid = null;

    // If Riot API key is available, optionally resolve PUUID ahead of time
    if (config.riotApiKey) {
      try {
        const riotApi = require('../riot/api');
        const account = await riotApi.getAccountByRiotId(gameName, tagLine);
        if (account && account.puuid) {
          puuid = account.puuid;
        }
      } catch (err) {
        console.warn('[link] Could not resolve PUUID via Riot API, linking by name:', err.message);
      }
    }

    // Check if another user already linked this PUUID
    if (puuid) {
      const existingByPuuid = queries.getPlayerByPuuid(puuid);
      if (existingByPuuid && existingByPuuid.discord_id !== targetUser.id) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xff4444)
              .setTitle('❌ Account Already Linked')
              .setDescription(
                `This Riot account is already linked to <@${existingByPuuid.discord_id}>.`
              ),
          ],
        });
      }
    }

    // Also check if someone else in the database already has this Riot ID
    const existingByName = queries.findPlayerByRiot(gameName, tagLine, puuid);
    if (existingByName && existingByName.discord_id !== targetUser.id) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff4444)
            .setTitle('❌ Account Already Linked')
            .setDescription(
              `\`${formattedRiotId}\` is already linked to <@${existingByName.discord_id}>.`
            ),
        ],
      });
    }

    const existingPlayer = queries.getPlayer(targetUser.id);
    const isUpdate = !!existingPlayer;

    // Upsert player in database (preserves rating & record if already registered)
    queries.upsertPlayer(targetUser.id, puuid, formattedRiotId, seedRating);

    // Auto-update persistent leaderboard widgets
    updateAllLeaderboardWidgets(interaction.client).catch((err) => {
      console.error('[link] Error updating leaderboard widgets:', err);
    });

    const explicitSeed = interaction.options.getInteger('seed_rating');

    const embedFields = [
      { name: '👤 Discord User', value: `<@${targetUser.id}>`, inline: true },
      { name: '🎮 Riot ID', value: `\`${formattedRiotId}\``, inline: true },
    ];

    if (isUpdate) {
      const totalGames = (existingPlayer.wins || 0) + (existingPlayer.losses || 0);
      if (totalGames >= 5) {
        embedFields.push({
          name: '📊 Current Rating',
          value: `**${Math.round(existingPlayer.rating)} Elo**`,
          inline: true,
        });
      } else {
        embedFields.push({
          name: '📊 Status',
          value: `**Unranked (${totalGames}/5)**`,
          inline: true,
        });
      }
    } else {
      if (explicitSeed !== null) {
        embedFields.push({
          name: '📊 Seed Rating',
          value: `**${seedRating} Elo**`,
          inline: true,
        });
      } else {
        embedFields.push({
          name: '📊 Status',
          value: '**Unranked (0/5)**',
          inline: true,
        });
      }
    }

    embedFields.push({
      name: '🧠 Rating Engine',
      value: 'OpenSkill Bayesian engine (5 games required to unlock public rank)',
      inline: false,
    });

    const embed = new EmbedBuilder()
      .setColor(0x00cc88)
      .setTitle(isUpdate ? '🔄 Riot ID Updated!' : '✅ Account Linked!')
      .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
      .addFields(embedFields)
      .setFooter({
        text: isSelf
          ? (puuid ? `PUUID: ${puuid.slice(0, 16)}…` : 'Linked by Riot ID')
          : `Linked by ${interaction.user.displayName}`,
      });

    return interaction.editReply({ embeds: [embed] });
  },
};

