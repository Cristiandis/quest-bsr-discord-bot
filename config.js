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
    user_agent: `Quest-BSR-Twitch-Bot/1.0.0 (+https://github.com/wilik16/quest-bsr-twitch-bot)`,
    message: {
        manual: `To request song, find a song at bsaber.com and click on twitch logo under a song to copy the code, then use !bsr <code> in chat. I made a video guide here https://imgur.com/a/a0s0qqa`
    },
    bot_options: {
        token: process.env.DISCORD_TOKEN
    },
    enable_automatic_upload_to_quest: true,
    adb_folder: getAdbFolder()
};

module.exports = config;
