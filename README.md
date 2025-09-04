# Quest BSR Discord Bot
Quest BSR Discord Bot is an Oculus Quest Beat Saber song request bot that will download requested songs from a discord chat and optionally upload to the Quest automatically.

## Features
- **Song Requests**: Request songs using BSR codes with customizable command triggers
- **Song Search**: Search for songs by name or artist using BeatSaver API
- **Queue Management**: View current song queue and clear queue (admin only)
- **Cooldown System**: Configurable cooldown between requests to prevent spam
- **Voting System**: Optional voting system for song selection when enabled
- **Admin Controls**: Admin-only commands and cooldown immunity
- **Quest Integration**: Optional automatic upload to Oculus Quest via adb

## Background
This is intended for Discord communities who play Oculus Quest version of Beat Saber.

## Installation
- Clone or download this repo (Code -> Download ZIP, then extract)
- Copy `.env.example` to `.env` and add your Discord bot token:

  \`\`\`bash
  cp .env.example .env
  \`\`\`
  Then edit `.env` and replace `your_bot_token_here` with your actual bot token
  
- To get your Discord bot token:
  1. Go to https://discord.com/developers/applications
  2. Click "New Application" and give it a name
  3. Go to the "Bot" section in the left sidebar
  4. Click "Add Bot" if needed
  5. Under "Token", click "Copy" to get your bot token
  6. Paste this token in your `.env` file
  7. In the "Bot" section, enable "Message Content Intent"
  8. Go to OAuth2 > URL Generator, select "bot" scope and "Send Messages" permission
  9. Use the generated URL to invite the bot to your Discord server
  
- Install [Node.js](https://nodejs.org/en/download/)
- Run `npm install` or `node install.js` to install dependencies
- Configure the bot settings in `config.js` (see Configuration section below)
- To start the bot, run `npm start` or `node start.js`

## Configuration
Edit `config.js` to customize the bot behavior:

### Basic Settings
\`\`\`javascript
commandTrigger: '!',           // Command prefix (only special characters allowed)
cooldownEnabled: true,         // Enable/disable cooldown system
cooldownDuration: 30000,          // Cooldown duration in milliseconds 
\`\`\`

### Admin Settings
\`\`\`javascript
adminUserIds: [               // Discord user IDs with admin privileges
  '123456789012345678',       // Replace with actual Discord user IDs
  '987654321098765432'
],
\`\`\`

### Voting System
\`\`\`javascript
votingEnabled: false,         // Enable optional voting system
votingDuration: 10000,          // Voting duration in milliseconds
maxVotingSuggestions: 5      // Number of songs before voting starts
\`\`\`

### Messages
Customize bot response messages in the `messages` object within `config.js`.

## Commands

### User Commands
- `!bsr <code>` - Request a song using BSR code (e.g., `!bsr bd45`)
- `!search <query>` - Search for songs by name or artist (e.g., `!search believer`)
- `!queue` - View current song queue

### Admin Commands (requires admin privileges)
- `!clearqueue` - Clear all songs from the queue

*Note: Replace `!` with your configured command trigger*

## How It Works

### Standard Mode
1. Users request songs using `!bsr <code>` or search with `!search <query>`
2. Songs appear with Approve/Decline buttons
3. When approved, songs are downloaded to `/maps` folder and added to queue
4. Cooldown prevents spam requests (configurable duration)

### Voting Mode (Optional)
1. When voting is enabled, X amount of songs can be approved without cooldown
2. After X approvals, a voting session starts with a dropdown menu
3. Users vote for their preferred song from the suggestions
4. The most voted song gets added to the queue
5. Users can change their votes during the voting period
6. Voting includes a countdown timer showing when voting ends

### Admin Features
- Admins (configured by Discord user ID) have special privileges:
  - Immune to cooldown restrictions
  - Access to `!clearqueue` command
  - Can approve/decline any song requests

After the bot is connected, try to send a bsr command in your Discord server (for example `!bsr bd45`), the bot will automatically download the zip and save it to `/maps` folder. After the download is finished, the bot will reply informing that the song is added to the queue, you will need to reload song list every new song added.

## Troubleshooting
- Make sure "Message Content Intent" is enabled in your Discord bot settings
- Verify your bot token is correct in the `.env` file
- Check that the bot has proper permissions in your Discord server
- Ensure Node.js is properly installed and up to date

