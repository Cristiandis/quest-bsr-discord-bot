require('dotenv').config();
const os = require('os');
const path = require('path');

function getAdbFolder() {
    const platform = os.platform();
    
    switch (platform) {
        case 'win32':
            return path.join(os.homedir(), 'AppData', 'Roaming', 'SideQuest', 'platform-tools');
        case 'darwin':
            return path.join(os.homedir(), 'Library', 'Application Support', 'SideQuest', 'platform-tools');
        case 'linux':
            return path.join(os.homedir(), '.config', 'SideQuest', 'platform-tools');
        default:
            return path.join(os.homedir(), 'SideQuest', 'platform-tools');
    }
}

const config = {
    user_agent: `Quest-BSR-Discord-Bot/1.0.0 (+https://github.com/Cristiandis/quest-bsr-discord-bot)`,
    message: {
        manual: `To request song, find a song at bsaber.com and click on twitch logo under a song to copy the code, then use !bsr <code> in chat.`
    },
    bot_options: {
        token: process.env.DISCORD_TOKEN
    },
    cooldown: {
        enabled: true,
        duration: 30000,
    },
    admins: {
        userIds: [
            // "123456789012345678", // Replace with actual Discord user IDs
            // "987654321098765432", // Add more admin IDs as needed
        ],
    },
    voting: {
        enabled: false, // Set to true to enable voting system
        maxSuggestions: 5, // Number of suggestions before voting starts
        votingDuration: 10000, // voting time in milliseconds
    },
    enable_automatic_upload_to_quest: true,
    adb_folder: getAdbFolder()
};

module.exports = config;
