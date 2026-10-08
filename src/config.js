const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

module.exports = {
  // Discord
  discordToken: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,

  // Riot
  riotApiKey: process.env.RIOT_API_KEY,
  riotRegion: process.env.RIOT_REGION || 'europe',
  riotPlatform: process.env.RIOT_PLATFORM || 'euw1',

  // Elo
  defaultElo: parseInt(process.env.DEFAULT_ELO, 10) || 1000,
  kFactor: parseInt(process.env.K_FACTOR, 10) || 32,
};
