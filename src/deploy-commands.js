/**
 * Deploy slash commands to Discord.
 *
 * Usage:
 *   node src/deploy-commands.js          — deploy globally (takes up to 1h to propagate)
 *   node src/deploy-commands.js --guild   — deploy to test guild only (instant)
 */
const { REST, Routes } = require('discord.js');
const config = require('./config');
const fs = require('fs');
const path = require('path');

async function deploy() {
  const commandsDir = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'));

  const commands = [];
  for (const file of commandFiles) {
    const command = require(path.join(commandsDir, file));
    if (command.data) {
      commands.push(command.data.toJSON());
      console.log(`  ✓ Loaded command: /${command.data.name}`);
    }
  }

  const rest = new REST({ version: '10' }).setToken(config.discordToken);

  const useGuild = process.argv.includes('--guild');

  if (useGuild && config.guildId) {
    console.log(`\nDeploying ${commands.length} commands to guild ${config.guildId}…`);
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );
    console.log('✅ Guild commands deployed (instant update).');

    console.log('🧹 Clearing global commands to prevent duplicate entries…');
    await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: [] }
    );
    console.log('✅ Global commands cleared.');
  } else {
    console.log(`\nDeploying ${commands.length} commands globally…`);
    await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: commands }
    );
    console.log('✅ Global commands deployed.');

    if (config.guildId) {
      console.log(`🧹 Clearing guild commands for ${config.guildId} to prevent duplicates…`);
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: [] }
      );
      console.log('✅ Guild commands cleared.');
    }
  }
}

deploy().catch((err) => {
  console.error('❌ Failed to deploy commands:', err);
  process.exit(1);
});
