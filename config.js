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

function validateCommandTrigger(trigger) {
    const specialChars = /^[!$%^&*?~`|\\/+=\-_<>[\]{}()]+$/
    if (!specialChars.test(trigger)) {
        console.error(`Invalid command trigger "${trigger}". Only special characters are allowed.`)
        return "!"
    }
    return trigger
}

const config = {
    user_agent: `Quest-BSR-Discord-Bot/1.0.0 (+https://github.com/Cristiandis/quest-bsr-discord-bot)`,
    message: {
        manual: `To request song, find a song at bsaber.com and click on the ! on the side to copy the command.`
    },
    bot_options: {
        token: process.env.DISCORD_TOKEN
    },
    commandTrigger: "!", // Only special characters are allowed: ! $ % ^ & * ? ~ ` | \ / + = - _ < > [ ] { } ( )
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

config.commandTrigger = validateCommandTrigger(config.commandTrigger)

module.exports = config;
