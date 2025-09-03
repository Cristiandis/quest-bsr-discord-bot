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
let globalCooldown = 0
const songQueue = []

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
  const userId = message.author.id

  const isAdmin = config.admins.userIds.includes(userId)

  if (
    config.cooldown.enabled &&
    !isAdmin &&
    (messageContent.startsWith("!bsr") || messageContent.startsWith("!search")) &&
    isOnGlobalCooldown(message)
  ) {
    return
  }

  if (processBsr(messageContent, username, message, userId)) {
  } else if (processSearch(messageContent, username, message, userId)) {
  } else if (processQueue(messageContent, message)) {
  } else if (processClearQueue(messageContent, message, userId)) {
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

    if (interaction.user.id !== searchData.userId) {
      await interaction.reply({ content: "Only the original requester can interact with this search.", flags: 64 })
      return
    }

    const selectedSong = searchData.results.find((song) => song.id === requestId)
    if (selectedSong) {
      showSongApproval(selectedSong, searchData.username, interaction, searchData.userId)
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

  if (interaction.user.id !== request.userId) {
    await interaction.reply({ content: "Only the original requester can interact with this request.", flags: 64 })
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
    globalCooldown = 0

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

function processSearch(messageContent, username, message, userId) {
  const command = `!search`
  if (!messageContent.startsWith(command)) {
    return false
  }

  const query = messageContent.slice(command.length + 1)
  if (messageContent.charAt(command.length) == ` ` && query.length > 0) {
    setGlobalCooldown()
    searchSongs(query, username, message, userId)
  } else {
    message.reply("Usage: `!search <song name or artist>`\nExample: `!search ghost expert+`")
  }
  return true
}

function searchSongs(query, username, message, userId) {
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
          userId: userId,
        })
      })

      message.reply({ embeds: [embed], components: [row] })
    })
    .catch((err) => {
      console.log("Search error:", err)
      message.reply("Sorry, there was an error searching for songs. Please try again!")
    })
}

function showSongApproval(songInfo, username, interaction, userId) {
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
    userId: userId,
  })

  interaction.update({ embeds: [embed], components: [row] })
}

function processBsr(messageContent, username, message, userId) {
  const command = `!bsr`
  if (!messageContent.startsWith(command)) {
    return false
  }

  const arg = messageContent.slice(command.length + 1)
  if (messageContent.charAt(command.length) == ` ` && arg.length > 0) {
    setGlobalCooldown()
    fetchMapInfo(arg, username, message, userId)
  } else {
    message.reply(config.message.manual)
  }
  return true
}

async function fetchMapInfo(mapId, username, message, userId) {
  const url = `https://api.beatsaver.com/maps/id/${mapId}`

  console.log(`* Getting map info...`)
  fetch(url, { method: "GET", headers: { "User-Agent": config.user_agent } })
    .then((res) => {
      if (!res.ok) {
        throw new Error(`BSR code not found: ${res.status}`)
      }
      return res.json()
    })
    .then((info) => {
      if (!info || !info.versions || info.versions.length === 0) {
        throw new Error("Invalid song data received")
      }

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
        userId: userId,
      })

      message.reply({ embeds: [embed], components: [row] })
    })
    .catch((err) => {
      console.log("BSR fetch error:", err)
      globalCooldown = 0
      message.reply(`❌ Could not find BSR code "${mapId}". Please check the code and try again!`)
    })
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

      const embed = interaction.message.embeds[0]
      const songData = {
        name: embed.data.fields.find((f) => f.name === "🎵 Song")?.value || "Unknown",
        artist: embed.data.fields.find((f) => f.name === "🎤 Artist")?.value || "Unknown",
        mapper: embed.data.fields.find((f) => f.name === "👤 Mapper")?.value || "Unknown",
        bsrCode: embed.data.fields.find((f) => f.name === "🆔 BSR Code")?.value || "Unknown",
        username: username,
        addedAt: new Date(),
      }
      songQueue.push(songData)
      console.log(`* Added "${songData.name}" to queue. Queue length: ${songQueue.length}`)

      const successEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("✅ Successfully Added to Queue")
        .setDescription(`The song has been downloaded and added to the queue!\nQueue position: #${songQueue.length}`)
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

function isOnGlobalCooldown(messageOrInteraction) {
  const now = Date.now()

  if (globalCooldown && now < globalCooldown) {
    const remainingTime = Math.ceil((globalCooldown - now) / 1000)

    const replyContent = `⏰ Please wait ${remainingTime} seconds before making another request.`

    if (messageOrInteraction.reply) {
      messageOrInteraction.reply(replyContent)
    } else {
      messageOrInteraction.reply({
        content: replyContent,
        flags: 64,
      })
    }
    return true
  }

  return false
}

function setGlobalCooldown() {
  if (config.cooldown.enabled) {
    globalCooldown = Date.now() + config.cooldown.duration
  }
}

function processQueue(messageContent, message) {
  const command = `!queue`
  if (!messageContent.startsWith(command)) {
    return false
  }

  if (songQueue.length === 0) {
    message.reply("🎵 The queue is currently empty!")
    return true
  }

  const embed = new EmbedBuilder()
    .setColor(0x9932cc)
    .setTitle("🎵 Current Song Queue")
    .setDescription(`There are ${songQueue.length} song(s) in the queue:`)
    .setTimestamp()

  songQueue.forEach((song, index) => {
    embed.addFields({
      name: `${index + 1}. ${song.name}`,
      value: `**Artist:** ${song.artist}\n**Mapper:** ${song.mapper}\n**BSR:** ${song.bsrCode}\n**Added by:** ${song.username}`,
      inline: false,
    })
  })

  message.reply({ embeds: [embed] })
  return true
}

function processClearQueue(messageContent, message, userId) {
  const command = `!clearqueue`
  if (!messageContent.startsWith(command)) {
    return false
  }

  const isAdmin = config.admins.userIds.includes(userId)

  if (!isAdmin) {
    message.reply("❌ You don't have permission to use this command. Only admins can clear the queue.")
    return true
  }

  const clearedCount = songQueue.length
  songQueue.length = 0 // Clear the array

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setTitle("🗑️ Queue Cleared")
    .setDescription(`Successfully cleared ${clearedCount} song(s) from the queue.`)
    .setFooter({ text: `Cleared by ${message.author.username}` })
    .setTimestamp()

  message.reply({ embeds: [embed] })
  return true
}
