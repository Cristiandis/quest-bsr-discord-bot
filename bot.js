const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js")
const fetch = require("node-fetch")
const fs = require(`fs`)
const sanitize = require(`sanitize-filename`)
const http = require("https")
const { exec } = require("child_process")
const extract = require("extract-zip")
const { resolve } = require("path")
const path = require("path")
const config = require("./config")

const adbExecutable = process.platform === "win32" ? "adb.exe" : "adb"
const adb = path.join(config.adb_folder, adbExecutable)
var questConnected = false
var questIpAddress = ``

const pendingRequests = new Map()
const pendingSearches = new Map()

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
})

client.once("clientReady", onReadyHandler)
client.on("messageCreate", onMessageHandler)
client.on("interactionCreate", onInteractionHandler)
client.login(config.bot_options.token)

if (config.enable_automatic_upload_to_quest) {
    getIpAddress()
}

function getIpAddress() {
    console.log(`- Getting Quest IP Address...(make sure the Quest is connected via cable)`)
    exec(`${adb} shell ip addr show wlan0`, (error, stdout, stderr) => {
        if (error) {
            console.log(`- [IP]error: ${error.message}`)
            return
        }
        if (stderr) {
            console.log(`- [IP]stderr: ${stderr}`)
            return
        }
        const r = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/
        const ipAddress = stdout.match(r)
        console.log(`- Quest IP Address: ${ipAddress}`)
        adbConnect(ipAddress)
    })
}

function adbConnect(ipAddress) {
    console.log(`- Connecting to Quest wirelessly...`)
    exec(`${adb} tcpip 5555 && ${adb} connect ${ipAddress}:5555`, (error, stdout, stderr) => {
        if (error) {
            console.log(`- [CO]error: ${error.message}`)
            return
        }
        if (stderr) {
            console.log(`- [CO]stderr: ${stderr}`)
            return
        }
        console.log(`- [CO]output: ${stdout}`)
        if (stdout.includes("connected to")) {
            questConnected = true
            questIpAddress = ipAddress
            console.log(`- Quest connected wirelessly, now you can unplug the cable if you want`)
        }
    })
}

function onReadyHandler() {
    console.log(`* Bot logged in as ${client.user.tag}!`)
}

function onMessageHandler(message) {
    if (message.author.bot || !message.content.startsWith("!")) {
        return
    }

    console.log(`======\n* Received "${message.content}"`)
    const messageContent = message.content.trim()
    const username = message.author.username

    if (processBsr(messageContent, username, message)) {
    } else if (processSearch(messageContent, username, message)) {
    } else {
        console.log(`* This command is not handled`)
    }
}

async function onInteractionHandler(interaction) {
    if (!interaction.isButton()) return

        const [action, requestId] = interaction.customId.split("_")

        if (action === "select") {
            const searchData = pendingSearches.get(requestId)
            if (!searchData) {
                await interaction.reply({ content: "This search has expired.", flags: 64 })
                return
            }

            const selectedSong = searchData.results.find((song) => song.id === requestId)
            if (selectedSong) {
                showSongApproval(selectedSong, searchData.username, interaction)
            } else {
                await interaction.reply({ content: "Song not found.", flags: 64 })
            }
            return
        }

        const request = pendingRequests.get(requestId)

        if (!request) {
            await interaction.reply({ content: "This request has expired.", flags: 64 })
            return
        }

        if (action === "approve") {
            download(request.downloadUrl, request.fileName, request.hash, request.username, interaction)

            const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x00ff00)
            .setFooter({ text: `✅ Approved by ${interaction.user.username}` })

            await interaction.update({
                embeds: [approvedEmbed],
                components: [],
            })
        } else if (action === "reject") {
            const rejectedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0xff0000)
            .setFooter({ text: `❌ Rejected by ${interaction.user.username}` })

            await interaction.update({
                embeds: [rejectedEmbed],
                components: [],
            })
        }

        pendingRequests.delete(requestId)
        pendingSearches.delete(requestId)
}

function processSearch(messageContent, username, message) {
    const command = `!search`
    if (!messageContent.startsWith(command)) {
        return false
    }

    const query = messageContent.slice(command.length + 1)
    if (messageContent.charAt(command.length) == ` ` && query.length > 0) {
        searchSongs(query, username, message)
    } else {
        message.reply("Usage: `!search <song name or artist>`\nExample: `!search ghost expert+`")
    }
    return true
}

function searchSongs(query, username, message) {
    const url = `https://api.beatsaver.com/search/text/0?q=${encodeURIComponent(query)}&sortOrder=Relevance`

    console.log(`* Searching for songs: "${query}"`)
    fetch(url, { method: "GET", headers: { "User-Agent": config.user_agent } })
    .then((res) => res.json())
    .then((data) => {
        if (!data.docs || data.docs.length === 0) {
            message.reply(`No songs found for "${query}". Try different keywords!`)
            return
        }

        const results = data.docs.slice(0, 5)
        const searchId = `search_${Date.now()}`

        const embed = new EmbedBuilder()
        .setColor(0x9932cc)
        .setTitle("🔍 Song Search Results")
        .setDescription(`Found ${data.docs.length} songs for "${query}". Showing top 5 results:`)
        .setFooter({ text: `Search by ${username}` })
        .setTimestamp()

        results.forEach((song, index) => {
            const versions = song.versions[0]
            const rating = song.stats.score ? `${(song.stats.score * 100).toFixed(1)}%` : "N/A"
            const duration = formatDuration(song.metadata.duration)

            embed.addFields({
                name: `${index + 1}. ${song.name}`,
                value: `**Artist:** ${song.metadata.songAuthorName}\n**Mapper:** ${song.metadata.levelAuthorName}\n**BSR:** ${song.id} | **Rating:** ${rating} | **Duration:** ${duration}`,
                inline: false,
            })
        })

        const row = new ActionRowBuilder()
        results.forEach((song, index) => {
            row.addComponents(
                new ButtonBuilder()
                .setCustomId(`select_${song.id}`)
                .setLabel(`${index + 1}`)
                .setStyle(ButtonStyle.Primary),
            )
        })

        results.forEach((song) => {
            pendingSearches.set(song.id, {
                results: results,
                username: username,
            })
        })

        message.reply({ embeds: [embed], components: [row] })
    })
    .catch((err) => {
        console.log("Search error:", err)
        message.reply("Sorry, there was an error searching for songs. Please try again!")
    })
}

function showSongApproval(songInfo, username, interaction) {
    const versions = songInfo.versions[0]
    const downloadUrl = versions.downloadURL
    const fileName = sanitize(`${songInfo.id} ${username} ${songInfo.metadata.levelAuthorName} (${songInfo.name}).zip`)

    const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle("🎵 Song Request (from search)")
    .setThumbnail(versions.coverURL)
    .addFields(
        { name: "🎤 Artist", value: songInfo.metadata.songAuthorName, inline: true },
        { name: "🎵 Song", value: songInfo.name, inline: true },
        { name: "👤 Mapper", value: songInfo.metadata.levelAuthorName, inline: true },
        { name: "🆔 BSR Code", value: songInfo.id, inline: true },
        { name: "⭐ Rating", value: `${(songInfo.stats.score * 100).toFixed(1)}%`, inline: true },
               { name: "⏱️ Duration", value: formatDuration(songInfo.metadata.duration), inline: true },
    )
    .setFooter({ text: `Selected by ${username}` })
    .setTimestamp()

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve_${songInfo.id}`).setLabel("✅ Approve").setStyle(ButtonStyle.Success),
                                                     new ButtonBuilder().setCustomId(`reject_${songInfo.id}`).setLabel("❌ Reject").setStyle(ButtonStyle.Danger),
    )

    pendingRequests.set(songInfo.id, {
        downloadUrl,
        fileName,
        hash: versions.hash,
        username,
    })

    interaction.update({ embeds: [embed], components: [row] })
}

function processBsr(messageContent, username, message) {
    const command = `!bsr`
    if (!messageContent.startsWith(command)) {
        return false
    }

    const arg = messageContent.slice(command.length + 1)
    if (messageContent.charAt(command.length) == ` ` && arg.length > 0) {
        fetchMapInfo(arg, username, message)
    } else {
        message.reply(config.message.manual)
    }
    return true
}

function fetchMapInfo(mapId, username, message) {
    const url = `https://api.beatsaver.com/maps/id/${mapId}`

    console.log(`* Getting map info...`)
    fetch(url, { method: "GET", headers: { "User-Agent": config.user_agent } })
    .then((res) => res.json())
    .then((info) => {
        const versions = info.versions[0]
        const downloadUrl = versions.downloadURL
        const fileName = sanitize(`${info.id} ${username} ${info.metadata.levelAuthorName} (${info.name}).zip`)

        const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("🎵 Song Request")
        .setThumbnail(versions.coverURL)
        .addFields(
            { name: "🎤 Artist", value: info.metadata.songAuthorName, inline: true },
            { name: "🎵 Song", value: info.name, inline: true },
            { name: "👤 Mapper", value: info.metadata.levelAuthorName, inline: true },
            { name: "🆔 BSR Code", value: info.id, inline: true },
            { name: "⭐ Rating", value: `${(info.stats.score * 100).toFixed(1)}%`, inline: true },
                   { name: "⏱️ Duration", value: formatDuration(info.metadata.duration), inline: true },
        )
        .setFooter({ text: `Requested by ${username}` })
        .setTimestamp()

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`approve_${info.id}`).setLabel("✅ Approve").setStyle(ButtonStyle.Success),
                                                         new ButtonBuilder().setCustomId(`reject_${info.id}`).setLabel("❌ Reject").setStyle(ButtonStyle.Danger),
        )

        pendingRequests.set(info.id, {
            downloadUrl,
            fileName,
            hash: versions.hash,
            username,
        })

        message.reply({ embeds: [embed], components: [row] })
    })
    .catch((err) => console.log(err))
}

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`
}

async function download(url, fileName, hash, username, interaction) {
    await new Promise((resolve, reject) => {
        console.log(`* Downloading map...`)
        const mapsFolder = `maps`
        if (!fs.existsSync(mapsFolder)) {
            fs.mkdirSync(mapsFolder)
        }
        const filePath = `${mapsFolder}/${fileName}`
        const fileStream = fs.createWriteStream(filePath)
        http.get(`${url}`, (response) => {
            response.pipe(fileStream)
        })
        fileStream.on("finish", () => {
            console.log(`* Downloaded "${fileName}"`)

            const successEmbed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle("✅ Successfully Added to Queue")
            .setDescription(`The song has been downloaded and added to the queue!`)
            .setFooter({ text: `Downloaded for ${username}` })
            .setTimestamp()

            interaction.followUp({ embeds: [successEmbed] })

            if (questConnected) {
                extractZip(hash, filePath)
            }
            resolve()
        })
    })
}

async function extractZip(hash, source) {
    try {
        await extract(source, { dir: resolve(path.join("tmp", hash)) })
        pushMapToQuest(hash)
    } catch (err) {
        console.log("* Oops: extractZip failed", err)
    }
}

function pushMapToQuest(hash) {
    console.log(`- Uploading to Quest...`)
    const sourcePath = path.join("tmp", hash)
    exec(
        `${adb} -s ${questIpAddress}:5555 push "${sourcePath}" /sdcard/ModData/com.beatgames.beatsaber/Mods/SongLoader/CustomLevels/${hash}`,
         (error, stdout, stderr) => {
             if (error) {
                 console.log(`- [PU]error: ${error.message}`)
                 return
             }
             if (stderr) {
                 console.log(`- [PU]stderr: ${stderr}`)
                 return
             }
             console.log(`- Map uploaded to Quest`)
             fs.rm(path.join("tmp", hash), { recursive: true }, (err) => {
                 if (err) {
                     console.log(`- [EX]error: ${err.message}`)
                 }
             })
         },
    )
}
