const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// ── Validate config ─────────────────────────────
if (!config.discordToken) {
  console.error('❌  Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

// ── Create client ───────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [
    Partials.Message,
    Partials.Reaction,
    Partials.User,
  ],
});

const {
  handleLeaderboardWidgetInteraction,
  updateAllLeaderboardWidgets,
  setWidgetClient,
} = require('./widgets/leaderboardWidget');

const {
  handleLobbyInteraction,
  updateAllLobbyWidgets,
  setLobbyWidgetClient,
} = require('./widgets/lobbyWidget');

setWidgetClient(client);
setLobbyWidgetClient(client);

// ── Load commands ───────────────────────────────
client.commands = new Collection();

const commandsDir = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsDir, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
    console.log(`  ✓ Loaded: /${command.data.name}`);
  }
}

// ── Handle interactions ─────────────────────────
client.on('interactionCreate', async (interaction) => {
  // Handle button, select menu, and modal interactions (e.g. persistent widgets & lobbies)
  if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('lb_widget:')) {
      return handleLeaderboardWidgetInteraction(interaction);
    }
    if (interaction.customId.startsWith('lobby:')) {
      return handleLobbyInteraction(interaction);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[${interaction.commandName}] Error:`, error);

    const reply = {
      content: '❌ Something went wrong executing that command.',
      ephemeral: true,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

// ── Ready ───────────────────────────────────────
client.once('ready', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     ⚔️  Elo Tracker Bot — Online  ⚔️     ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Bot:      ${client.user.tag.padEnd(28)}║`);
  console.log(`║  Guilds:   ${String(client.guilds.cache.size).padEnd(28)}║`);
  console.log(`║  Commands: ${String(client.commands.size).padEnd(28)}║`);
  console.log(`║  Rating:   ${'OpenSkill (TrueSkill)'.padEnd(28)}║`);
  console.log(`║  Data:     ${'ROFL Replay Parser'.padEnd(28)}║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  // Sync active persistent leaderboard widgets
  updateAllLeaderboardWidgets(client).catch((err) => {
    console.error('Failed to sync leaderboard widgets on startup:', err);
  });

  // Sync active persistent lobby widgets
  updateAllLobbyWidgets(client).catch((err) => {
    console.error('Failed to sync lobby widgets on startup:', err);
  });
});

// ── Login ───────────────────────────────────────
client.login(config.discordToken);
