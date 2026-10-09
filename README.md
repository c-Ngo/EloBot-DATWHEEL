# ⚔️ Elo Tracker Bot (OpenSkill / TrueSkill)

A Discord bot for tracking competitive skill ratings in custom League of Legends 10-man inhouse matches. Powered by the **OpenSkill / TrueSkill (Weng-Lin Bayesian)** ranking algorithm, it automatically parses in-game `.rofl` replay files, tracks individual player skill ($\mu$) and uncertainty ($\sigma$), computes pre-match win odds, applies role-weighted personal performance modifiers, provides interactive 10-player match lobbies with automated waitlists and team spinners, and maintains full champion pools — highlighting each player's top 3 most played champions directly on the leaderboard.

---

## Features

| Command | Permissions | Description |
|---------|-------------|-------------|
| `/link` | Everyone | Link a Riot account (`GameName#TagLine`) to yourself or another Discord user with an optional seed rating |
| `/record` | Everyone | Upload a `.rofl` replay file — auto-detects all 10 players, teams, stats, and outputs the match scoreboard summary |
| `/leaderboard` | Everyone | View the skill leaderboard with rank medals, ratings, win rates, and top 3 champion signatures |
| `/leaderboard-widget` | **Admin** | Deploy, refresh, or remove a permanent live leaderboard widget in a read-only channel |
| `/lobby-widget` | **Admin** | Deploy, refresh, or remove a permanent live inhouse match lobby widget in a channel |
| `/profile` | Everyone | View detailed player card: rating, peak, tier, win rate, top champions, recent matches, and role breakdown |
| `/history` | Everyone | Detailed match history with champion, role, KDA, and rating deltas |
| `/match` | Everyone | View the scoreboard summary of a previously recorded match |
| `/setelo` | **Admin** | Manually adjust a player's skill rating |
| `/undo` | **Admin** | Completely revert a recorded match (restores previous $\mu$, $\sigma$, ratings, and champion stats) |

---

## 📊 Post-Game Scoreboard Summary

Whenever a `.rofl` replay is uploaded via `/record`, the bot posts a clean, aligned match scoreboard summary showing match and team average Elo, **Player**, **Champion played**, **Elo +/- (with performance modifier in brackets)**, and **Final Elo**:

```text
🎮 Match Scoreboard Summary Recorded for EUW1-8005104108

⏱️ Duration: 34m 14s • Match Avg: 1000 Elo
⚖️ Team Avg: 🔵 Blue 1000 Elo vs 🔴 Red 1000 Elo
🎲 Pre-Match Odds: 🔵 Blue 50% vs 🔴 Red 50%
⭐ Match MVP: Gojo Satoru (@Gojo) as Yasuo (+24(+2) Elo → 1024)

🔵 Blue Side (VICTORY) 🏆 • Odds: 50% • Avg: 1000 Elo
Player         Champion          Elo +/-  Final Elo
───────────────────────────────────────────────────
Gojo Satoru    Yasuo             +24(+2)       1024
soohaeng       Chogath           +26(+3)       1026
Timmeister10   Veigar            +21(+0)       1021
who dat        Bard              +25(+2)       1025
mid easy       Rakan             +23(+1)       1023
👥 @Gojo @soohaeng @Timmeister10 @whodat @mideasy

🔴 Red Side (DEFEAT) • Odds: 50% • Avg: 1000 Elo
Player         Champion          Elo +/-  Final Elo
───────────────────────────────────────────────────
Player6        Aatrox            -22(+1)        978
Player7        Viego             -24(-2)        976
Player8        Syndra            -20(+2)        980
Player9        Jinx              -23(-1)        977
Player10       Nautilus          -21(+0)        979
👥 @Player6 @Player7 @Player8 @Player9 @Player10
```

---

## 🧠 OpenSkill / TrueSkill Algorithm

Instead of basic chess Elo, this bot uses **OpenSkill** — an open-source, patent-free Bayesian rating system based on the **Weng-Lin (2011)** ranking model (similar to Microsoft TrueSkill):

1. **Skill Distribution**:
   - Each player is modeled as a Gaussian belief distribution: Skill Mean ($\mu$, default 25.0) and Uncertainty ($\sigma$, default 8.333).
   - As a player plays more matches, their uncertainty ($\sigma$) shrinks, cementing their rating.

2. **Conservative Rating (Ordinal)**:
   - Evaluated as $\mu - 3\sigma$, providing a 99.7% statistical confidence lower bound of true skill.
   - Scaled to intuitive game MMR ($\text{Rating} = 1000 + \text{ordinal} \times 40$) for display and matchmaking.

3. **Multi-Player Team Aggregation**:
   - Team skill is the combined sum of player skill distributions.
   - Naturally rewards underdogs: lower-rated teams that pull off an upset gain more $\mu$, while heavily favored teams gain less.
   - Calculates exact pre-match win odds (e.g. *Blue 58% vs Red 42%*).

4. **Role-Weighted Performance Modifiers**:
   - Adjusts Bayesian skill gain/loss by up to $\pm 5\%$ based on personal performance relative to all 10 participants.
   - Role-aware: Supports are evaluated on Vision and KDA; ADCs on Damage and CS; Junglers on Objectives, KDA, and Vision.

### Role Weights

| Stat | Top | Jungle | Mid | ADC | Support |
|------|-----|--------|-----|-----|---------|
| KDA | 25% | 30% | 25% | 25% | 30% |
| Damage Dealt | 25% | 15% | 30% | 30% | 5% |
| Damage Taken | 20% | 10% | 5% | 5% | 10% |
| CS | 15% | 15% | 20% | 25% | 0% |
| Vision | 5% | 15% | 5% | 5% | 35% |
| Gold | 10% | 15% | 15% | 10% | 20% |

### Skill Tiers

| Tier | Rating Range |
|------|--------------|
| 👑 Challenger | 2400+ |
| 🔴 Grandmaster | 2200–2399 |
| 🟣 Master | 2000–2199 |
| 💎 Diamond | 1800–1999 |
| 🟢 Emerald | 1600–1799 |
| 🔵 Platinum | 1400–1599 |
| 🟡 Gold | 1200–1399 |
| ⚪ Silver | 1000–1199 |
| 🟤 Bronze | 800–999 |
| ⬛ Iron | <800 |

---

## 🏆 Leaderboard & Champion Tracking

The `/leaderboard` displays rankings, display MMR, win-loss record, recent matches form, and top 3 champion signatures:

```text
> 🥇 `#01`  1350 Elo — Faker#KR1 🟡
> └ 📊 12W 3L (80% WR) • Gold
> └ 🎮 Recent: 🟢🟢🔴🟢🟢
> └ ⚔️ Ahri 83% (6G) • Azir 100% (4G) • LeBlanc 67% (3G)

> 🥈 `#02`  1280 Elo — ShowMaker#KR1 🟡
> └ 📊 9W 5L (64% WR) • Gold
> └ 🎮 Recent: 🟢🔴🟢🟢🔴
> └ ⚔️ Syndra 75% (4G) • Zoe 60% (5G) • Katarina 50% (2G)

> 🥉 `#03`  1210 Elo — Chovy#KR1 🟡
> └ 📊 8W 6L (57% WR) • Gold
> └ 🎮 Recent: 🔴🟢🟢🔴🟢
> └ ⚔️ Yone 80% (5G) • Sylas 50% (4G) • Akali 40% (5G)
```

- **Top 3 Most Played Champions**: Ranked by games played and wins, displaying win percentage and match count.
- **Recent Form Circles**: Dedicated row showing `🟢` (win) and `🔴` (loss) for each player's past 5 matches.
- **5 Placement Matches (Provisional)**: Players with fewer than 5 games played are marked as Unranked (e.g. `Unranked (2/5)`), their Elo is kept private, and they appear at the bottom below all ranked players.
- **Compact mode**: `/leaderboard compact:True` hides champion sub-lines for a high-density view.

### 📌 Live Read-Only Channel Widget (`/leaderboard-widget`)

Deploy a permanent, interactive leaderboard widget directly to a dedicated read-only channel (e.g. `#leaderboard`):

- **Top 5 Display**: Displays the top 5 players per page, optimized for mobile and desktop screens.
- **Interactive Pagination**: Server members can click `⏮️ Top 5`, `◀️ Previous`, `Next ▶️`, `⏭️ Last Page`, or `🔄 Refresh` buttons to browse all ranked and unranked players.
- **Real-Time Auto Sync**: Pushes instant updates whenever ratings change via an event-driven emitter (`eloEvents`): on match record (`/record`), match undo (`/undo`), manual rating adjust (`/setelo`), or player account link (`/link`).
- **Persistent Across Restarts**: Automatically re-syncs all deployed widgets when the bot boots up (`ready` event).
- **Setup Command**:
  ```text
  /leaderboard-widget channel:#leaderboard
  ```
- **Actions**: Supports `action:Setup` (default), `action:Refresh`, and `action:Remove` *(Administrator permissions required)*.

---

## ⚔️ Persistent Inhouse Match Lobby Widget (`/lobby-widget`)

Instead of one-off slash commands, the lobby operates as a **permanent, self-resetting channel widget**:

- **Idle / Waiting State**:
  - When no match is active, the widget displays `⚪ No Active Lobby` with a clean queue prompt and a **⚔️ Create Lobby** button.
- **Button / Modal Creation**:
  - Any linked player can click **⚔️ Create Lobby** to open a modal with optional **Scheduled Time** (e.g. `ASAP`, `in 30m`, `20:30 CET`) and **Lobby Title** (default: `Inhouse 5v5`).
  - Upon submission, the permanent widget automatically updates into the active 10-player match queue and alerts the `@League?` role in the channel.
- **10 Slot Capacity & Dynamic Header**:
  - Displays `# ⚔️ 10 MAN LOADING: [TITLE] ⚔️` while open (`<10` players).
  - Switches to `# ⚔️ 10 MAN: [TITLE] ⚔️` once all 10 spots are filled.
- **Button-Driven Signups**:
  - Players click **⚔️ Join** to claim an open slot, or **🚪 Leave** to vacate their spot.
  - Linked account validation: players must run `/link` before joining to display verified ratings and tiers.
- **Automatic FIFO Waitlist**:
  - Once 10 slots are full, the join button becomes **⏳ Join Waitlist**.
  - Waitlisted players are queued in order of signup.
  - When an active player leaves or is kicked, the 1st person on the waitlist is automatically promoted into the active roster!
- **Kick Players**:
  - The lobby host or server Administrators can click **👢 Kick** to select and remove any active or waitlisted player via a select dropdown.
- **Random Team Spinner**:
  - Once full (10/10), the **🎲 Spin Random Teams** button is enabled, shuffling the 10 players into Blue Side and Red Side with computed Average Elo for both teams. Supports re-spinning.
- **Auto-Resetting on Dissolve**:
  - The lobby host or server Administrators can click **💥 Dissolve**. The widget instantly resets back to the **Idle / Waiting State** (`⚪ No Active Lobby`), ready for the next match!
- **Setup Command**:
  ```text
  /lobby-widget [channel:#inhouse-queue] [action:Setup]
  ```

---

## 📖 Command Reference

| Command | Options | Description |
|---------|---------|-------------|
| `/link` | `riot_id` *(required)*, `user` *(optional)*, `seed_rating` *(optional)* | Link a Riot ID (`GameName#TagLine`) to yourself or another user, optionally setting an initial seed rating (default: 1000). |
| `/record` | `file` *(required)* | Upload a `.rofl` replay file. Parses match stats, validates all 10 linked players, computes OpenSkill rating changes, updates champion stats, and posts the scoreboard summary. |
| `/leaderboard` | `compact` *(optional)* | View the server leaderboard with podium medals, tier emojis, win rates, and top 3 champion signatures. Set `compact:True` for dense view. |
| `/leaderboard-widget` | `channel` *(optional)*, `action` *(optional: setup, refresh, remove)* | *(Admin)* Deploy or manage a permanent self-updating leaderboard widget with pagination buttons in a channel. |
| `/lobby-widget` | `channel` *(optional)*, `action` *(optional: setup, refresh, remove)* | *(Admin)* Deploy, refresh, or remove a permanent live inhouse match lobby widget in a channel. |
| `/profile` | `player` *(optional)* | View detailed player card: current rating, peak rating, tier, record (W/L/WR%), top 5 champions (games, WR%, KDA), recent 5 matches, and role breakdown. |
| `/history` | `player` *(optional)*, `count` *(optional, 1–25, default: 10)* | View a player's recent matches with win/loss indicators, champion, role, KDA, and rating deltas. |
| `/match` | `match_id` *(required)* | Inspect the detailed scoreboard summary of any past recorded match by its ID (e.g. `EUW1-8005104108`). |
| `/setelo` | `player` *(required)*, `rating` *(required, 0–5000)* | *(Admin)* Manually override a player's skill rating, recalculating $\mu$ and ordinal, and syncing active widgets. |
| `/undo` | `match_id` *(required)* | *(Admin)* Revert a recorded match, restoring previous Bayesian $\mu$, $\sigma$, ratings, wins/losses, and champion stats for all participants. |

---

## 🎮 How .ROFL Replays Work

Because custom games are not indexed reliably on Riot's public Match-v5 API, this bot extracts all match metadata directly from League replay files (`.rofl`):

1. Play a 10-man custom match in the League of Legends client.
2. In the post-game lobby (or **Profile → Match History**), download the replay.
3. The `.rofl` file is saved to your computer:
   - **Windows**: `Documents\League of Legends\Replays\EUW1-XXXXXXXXXX.rofl`
   - **Mac**: `~/Documents/League of Legends/Replays/`
4. In Discord, upload the file:
   ```text
   /record file:<attach your .rofl file>
   ```
5. The bot parses the binary replay file, extracts the embedded JSON metadata containing all 10 players' stats, maps each participant to their registered Discord account, runs the OpenSkill / TrueSkill rating calculations, records champion statistics, and outputs the game scoreboard summary.

---

## 🚀 Setup & Deployment

### Prerequisites

1. **Node.js 18+** — [Download here](https://nodejs.org/)
2. **Discord Bot Token** — [Create an application](https://discord.com/developers/applications)

*(Riot API key is NOT required)*

### Step 1: Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** → name it (e.g. "Skill Tracker").
3. Go to **Bot** → click **Reset Token** → copy the token.
4. Go to **OAuth2 → URL Generator**:
   - **Scopes**: `bot`, `applications.commands`
   - **Bot Permissions**:
     - `Send Messages`
     - `Embed Links`
     - `Attach Files`
     - `Use Slash Commands`
     - `Manage Messages`
     - `Read Message History`
     - `Mention Everyone` / Mention Roles (for `@League?` role ping in lobbies)
5. Copy the generated URL and invite the bot to your server.

### Step 2: Configure Environment Variables

```bash
cd EloTrackerBot
cp .env.example .env
```

Edit `.env`:
```env
# Discord Bot Credentials
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_id_here
GUILD_ID=your_test_server_id_here    # optional: for instant dev slash command updates

# Starting Elo & Scaling
DEFAULT_ELO=1000
K_FACTOR=32

# (Optional) Riot Games API
RIOT_API_KEY=
RIOT_REGION=europe
RIOT_PLATFORM=euw1
```

#### Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | **Yes** | — | Bot authentication token from Discord Developer Portal |
| `CLIENT_ID` | **Yes** | — | Discord Application ID |
| `GUILD_ID` | No | — | Guild ID for instant slash command registration during development |
| `DEFAULT_ELO` | No | `1000` | Baseline display rating for newly linked players |
| `K_FACTOR` | No | `32` | Scaling factor for rating adjustments |
| `RIOT_API_KEY` | No | — | Optional Riot Games API key for PUUID verification during `/link` |
| `RIOT_REGION` | No | `europe` | Regional routing cluster (`europe`, `americas`, `asia`, `sea`) |
| `RIOT_PLATFORM` | No | `euw1` | Platform routing identifier (`euw1`, `na1`, `kr`, etc.) |

### Step 3: Install Dependencies & Deploy Commands

```bash
# Install dependencies
npm install

# Deploy slash commands:
npm run deploy-commands -- --guild    # instant deploy to GUILD_ID (development)
# or for global deployment (takes up to 1 hour to propagate):
npm run deploy-commands

# Start the bot
npm start
```

### Available npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm start` | `node src/index.js` | Start the bot in production mode |
| `npm run dev` | `node --watch src/index.js` | Start the bot with Node `--watch` for auto-reloading on file changes |
| `npm run deploy-commands` | `node src/deploy-commands.js` | Register slash commands globally or to test guild with `-- --guild` |
| `npm run db:reset` | `node src/database/reset.js` | Reset SQLite database and recreate schema from scratch |

---

## 📂 Project Structure

```
EloTrackerBot/
├── .env.example              # Environment variable template
├── .gitignore                # Git ignore rules for node_modules, .env, .db, .rofl
├── package.json              # Dependencies, project metadata & npm scripts
├── data/                     # SQLite database & sample replay data
│   ├── elo.db                # SQLite database (auto-created on first run)
│   └── rofl_metadata.json    # Sample replay metadata reference
└── src/
    ├── index.js              # Bot entry point, client initialization & interaction router
    ├── config.js             # Environment configuration loader
    ├── deploy-commands.js    # Slash command registration script (global & guild)
    ├── commands/             # Slash command definitions
    │   ├── history.js        # /history — match history with rating deltas
    │   ├── leaderboard.js    # /leaderboard — rankings & top 3 champion signatures
    │   ├── leaderboardWidget.js # /leaderboard-widget — persistent live channel widget
    │   ├── link.js           # /link — registers Riot ID & initializes rating
    │   ├── lobbyWidget.js    # /lobby-widget — persistent live inhouse lobby widget
    │   ├── match.js          # /match — inspect past match scoreboard summary
    │   ├── profile.js        # /profile — player card, peak rating, champ pool & role stats
    │   ├── record.js         # /record — parses .rofl replays with scoreboard summary
    │   ├── setelo.js         # /setelo — admin rating override
    │   └── undo.js           # /undo — reverts match, OpenSkill & champion stats
    ├── widgets/              # Interactive UI widgets & component handlers
    │   ├── leaderboardWidget.js # Persistent widget renderer, pagination & auto-update
    │   └── lobbyWidget.js    # Inhouse lobby renderer, slot management, waitlist & team spinner
    ├── events/               # Cross-module event synchronization
    │   └── eloEvents.js      # EventEmitter for rating updates & widget re-rendering
    ├── database/             # Data persistence layer (better-sqlite3)
    │   ├── db.js             # SQLite connection, WAL mode & schema setup
    │   ├── queries.js        # Prepared statements & transactional data access layer
    │   └── reset.js          # Database reset utility
    ├── elo/                  # Rating & matchmaking algorithms
    │   ├── openskill.js      # Pure JS Weng-Lin / TrueSkill Bayesian implementation
    │   └── engine.js         # Role-weighted performance modifiers + rating engine
    ├── rofl/                 # Replay file processing
    │   └── parser.js         # Binary .rofl replay metadata parser
    └── riot/                 # Riot Games API integration
        └── api.js            # Optional Riot API client for account verification
```

---

## 🗄️ Database Architecture

The bot uses [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) with Write-Ahead Logging (`WAL` mode) and foreign keys enabled for fast, synchronous, and safe local persistence.

- **`players`**: Discord ID, Riot PUUID, Riot ID, Bayesian skill parameters ($\mu$, $\sigma$, ordinal), display ratings (rating, peak), and overall record (wins, losses).
- **`matches`**: Match ID (from replay file name or timestamp), recording user, game duration, and average match Elo.
- **`match_players`**: Per-player match performance stats (KDA, CS, vision, damage dealt/taken, gold), team assignment (Blue 100 / Red 200), role, before/after rating parameters ($\mu$, $\sigma$, rating, rating delta), and individual performance modifier.
- **`champion_stats`**: Per-player champion mastery tracking (games, wins, total kills, deaths, assists).
- **`leaderboard_widgets`**: Active channel widget registrations (`channel_id`, `guild_id`, `message_id`).
- **`lobbies`**: Active inhouse match lobbies (`lobby_id`, `channel_id`, `message_id`, `owner_id`, `scheduled_time`, `title`, `teams_json`).
- **`lobby_players`**: Active lobby slots (1–10) mapped to linked players.
- **`lobby_waitlist`**: FIFO waitlist queue for players joining when 10 active slots are full.
