# Quest BSR Discord Bot
Quest BSR Discord Bot is an Oculus Quest Beat Saber song request bot that will download requested songs and optionally upload to the Quest automatically. If you choose to enable automatic upload feature, you will be able to play requested songs without leaving Beat Saber and opening BMBF.


## Background
This is intended for Discord communities who play Oculus Quest version of Beat Saber, I made this because I need a solution for song request via bsr command.

## Installation
- Clone or download this repo (Code -> Download ZIP, then extract)
- Copy `.env.example` to `.env` and add your Discord bot token:

  ```bash
  cp .env.example .env
  ```
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
- To start the bot, run `npm start` or `node start.js`

After the bot is connected, try to send a bsr command in your Discord server (for example `!bsr bd45`), the bot will automatically download the zip and save it to `/maps` folder. After the download is finished, the bot will reply informing that the song is added to the queue.
