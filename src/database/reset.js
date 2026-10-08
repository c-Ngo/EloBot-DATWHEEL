/**
 * Reset the database — drops all tables and recreates them.
 * Usage: npm run db:reset
 */
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'elo.db');

if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log('🗑️  Deleted existing database.');
}

// Re-require db.js to recreate schema
require('./db');
console.log('✅ Database recreated with fresh schema.');
process.exit(0);
