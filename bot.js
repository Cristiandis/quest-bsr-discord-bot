const { Client, GatewayIntentBits } = require('discord.js');
const fetch = require('node-fetch');
const fs = require(`fs`);
const sanitize = require(`sanitize-filename`);
const http = require('https');
const { exec } = require("child_process");
const extract = require('extract-zip');
const {resolve} = require("path");
const path = require('path');
const config = require('./config');

const adbExecutable = process.platform === 'win32' ? 'adb.exe' : 'adb';
const adb = path.join(config.adb_folder, adbExecutable);
var questConnected = false;
var questIpAddress = ``;

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

client.once('ready', onReadyHandler);
client.on('messageCreate', onMessageHandler);
client.login(config.bot_options.token);

if (config.enable_automatic_upload_to_quest) {
    getIpAddress();
}

function getIpAddress() {
    console.log(`- Getting Quest IP Address...(make sure the Quest is connected via cable)`);
    exec(`${adb} shell ip addr show wlan0`, (error, stdout, stderr) => {
        if (error) {
            console.log(`- [IP]error: ${error.message}`);
            return;
        }
        if (stderr) {
            console.log(`- [IP]stderr: ${stderr}`);
            return;
        }
        const r = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
        const ipAddress = stdout.match(r);
        console.log(`- Quest IP Address: ${ipAddress}`);
        adbConnect(ipAddress);
    });
}

function adbConnect(ipAddress) {
    console.log(`- Connecting to Quest wirelessly...`)
    exec(`${adb} tcpip 5555 && ${adb} connect ${ipAddress}:5555`, (error, stdout, stderr) => {
        if (error) {
            console.log(`- [CO]error: ${error.message}`);
            return;
        }
        if (stderr) {
            console.log(`- [CO]stderr: ${stderr}`);
            return;
        }
        console.log(`- [CO]output: ${stdout}`);
        if (stdout.includes('connected to')) {
            questConnected = true;
            questIpAddress = ipAddress;
            console.log(`- Quest connected wirelessly, now you can unplug the cable if you want`)
        }
    });
}

function onReadyHandler() {
    console.log(`* Bot logged in as ${client.user.tag}!`);
}

function onMessageHandler(message) {
    if (message.author.bot || !message.content.startsWith('!')) { return; }

    console.log(`======\n* Received "${message.content}"`);
    const messageContent = message.content.trim();
    const username = message.author.username;

    if (processBsr(messageContent, username, message)) { 
    } else { console.log(`* This command is not handled`); }
}

function processBsr(messageContent, username, message) {
    const command = `!bsr`;
    if (!messageContent.startsWith(command)) { return false; }

    const arg = messageContent.slice(command.length + 1);
    if (messageContent.charAt(command.length) == ` ` && arg.length > 0) {
        fetchMapInfo(arg, username, message);
    } else {
        message.reply(config.message.manual);
    }
    return true;
}

function fetchMapInfo(mapId, username, message) {
    const url = `https://api.beatsaver.com/maps/id/${mapId}`;

    console.log(`* Getting map info...`);
    fetch(url, { method: "GET", headers: { 'User-Agent': config.user_agent }})
        .then(res => res.json())
        .then(info => {
            const versions = info.versions[0]
            const downloadUrl = versions.downloadURL;
            const fileName = sanitize(`${info.id} ${username} ${info.metadata.levelAuthorName} (${info.name}).zip`);
            const responseMessage = `Requested "${info.metadata.songAuthorName}" - "${info.name}" by "${info.metadata.levelAuthorName}" (${info.id}). Successfully added to the queue.`;
            download(downloadUrl, fileName, versions.hash, responseMessage, message);
        })
        .catch(err => console.log(err));
}

async function download(url, fileName, hash, responseMessage, message) {
    await new Promise((resolve, reject) => {
        console.log(`* Downloading map...`);
        const mapsFolder = `maps`;
        if (!fs.existsSync(mapsFolder)){
            fs.mkdirSync(mapsFolder);
        }
        const filePath = `${mapsFolder}/${fileName}`;
        const fileStream = fs.createWriteStream(filePath);
            http.get(`${url}`, function(response) {
                response.pipe(fileStream);
            });
        fileStream.on("finish", function() {
            console.log(`* Downloaded "${fileName}"`);
            message.reply(responseMessage);
            if (questConnected) {
                extractZip(hash, filePath);
            }
            resolve();
        });
    });
}

async function extractZip(hash, source) {
    try {
        await extract(source, { dir: resolve(`tmp/${hash}`) });
        pushMapToQuest(hash);
    } catch (err) {
        console.log("* Oops: extractZip failed", err);
    }
}

function pushMapToQuest(hash) {
    console.log(`- Uploading to Quest...`)
    exec(`${adb} -s ${questIpAddress}:5555 push tmp\\${hash} /sdcard/ModData/com.beatgames.beatsaber/Mods/SongLoader/CustomLevels/${hash}`, (error, stdout, stderr) => {
        if (error) {
            console.log(`- [PU]error: ${error.message}`);
            return;
        }
        if (stderr) {
            console.log(`- [PU]stderr: ${stderr}`);
            return;
        }
        console.log(`- Map uploaded to Quest`);
        fs.rmdir(`tmp/${hash}`, { recursive: true }, (err) => {
            if (err) { 
                console.log(`- [EX]error: ${err.message}`); 
            }
        });
    });
}
