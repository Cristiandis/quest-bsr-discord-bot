const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js")
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
const questPlaylistPath = "/sdcard/ModData/com.beatgames.beatsaber/Mods/PlaylistManager/Playlists"

let questConnected = false
let questIpAddress = ``
let globalCooldown = 0
let currentVoting = null

const gameData = {
  pendingRequests: new Map(),
  pendingSearches: new Map(),
  searchPagination: new Map(),
  songQueue: [],
  votingSuggestions: [],
  userVotes: new Map(),
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
})

client.once("clientReady", onReadyHandler)
client.on("messageCreate", onMessageHandler)
client.on("interactionCreate", onInteractionHandler)
client.login(config.bot_options.token)

if (config.enable_automatic_upload_to_quest) {
  initializeQuest()
}

function initializeQuest() {
  console.log(`- Getting Quest IP Address...(make sure the Quest is connected via cable)`)
  executeCommand(`${adb} shell ip addr show wlan0`, (stdout) => {
    const ipAddress = stdout.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/)
    if (ipAddress) {
      console.log(`- Quest IP Address: ${ipAddress}`)
      connectToQuest(ipAddress)
    }
  })
}

function connectToQuest(ipAddress) {
  console.log(`- Connecting to Quest wirelessly...`)
  executeCommand(`${adb} tcpip 5555 && ${adb} connect ${ipAddress}:5555`, (stdout) => {
    if (stdout.includes("connected to")) {
      questConnected = true
      questIpAddress = ipAddress
      console.log(`- Quest connected wirelessly, now you can unplug the cable if you want`)
    }
  })
}

function executeCommand(command, onSuccess, onError = () => {}) {
  exec(command, (error, stdout, stderr) => {
    if (error || stderr) {
      console.log(`- Command error: ${error?.message || stderr}`)
      onError(error || stderr)
      return
    }
    onSuccess(stdout)
  })
}

function onReadyHandler() {
  console.log(`* Bot logged in as ${client.user.tag}!`)
}

function onMessageHandler(message) {
  if (message.author.bot || !message.content.startsWith(config.commandTrigger)) return

  console.log(`======\n* Received "${message.content}"`)
  const messageContent = message.content.trim()
  const userContext = {
    username: message.author.username,
    userId: message.author.id,
    isAdmin: config.admins.userIds.includes(message.author.id),
  }

  if (shouldApplyCooldown(messageContent, userContext) && isOnGlobalCooldown(message)) return

  const commands = [
    { handler: processBsr, needsCooldown: true },
    { handler: processSearch, needsCooldown: true },
    { handler: processQueue, needsCooldown: false },
    { handler: processClearQueue, needsCooldown: false },
  ]

  const command = commands.find((cmd) => cmd.handler(messageContent, userContext, message))
  if (!command) {
    console.log(`* This command is not handled`)
  }
}

function shouldApplyCooldown(messageContent, userContext) {
  return (
    config.cooldown.enabled &&
    !config.voting.enabled &&
    !userContext.isAdmin &&
    (messageContent.startsWith(`${config.commandTrigger}bsr`) ||
      messageContent.startsWith(`${config.commandTrigger}search`))
  )
}

async function onInteractionHandler(interaction) {
  if (interaction.isStringSelectMenu()) {
    return handleVotingSelect(interaction)
  }

  if (!interaction.isButton()) return

  const { action, requestId } = parseCustomId(interaction.customId)
  const handlers = {
    prev: () => handlePagination(interaction, action, requestId),
    next: () => handlePagination(interaction, action, requestId),
    cancel: () => handlePagination(interaction, action, requestId),
    select: () => handleSongSelect(interaction, requestId),
    approve: () => handleApproval(interaction, requestId, true),
    reject: () => handleApproval(interaction, requestId, false),
  }

  const handler = handlers[action]
  if (handler) {
    await handler()
  }
}

function parseCustomId(customId) {
  if (customId.startsWith("prev_") || customId.startsWith("next_") || customId.startsWith("cancel_")) {
    const parts = customId.split("_")
    return { action: parts[0], requestId: parts.slice(1).join("_") }
  }
  const [action, requestId] = customId.split("_")
  return { action, requestId }
}

async function handleVotingSelect(interaction) {
  if (!currentVoting) {
    return interaction.reply({ content: "This voting has expired.", flags: 64 })
  }

  const userId = interaction.user.id
  const selectedSongId = interaction.values[0]
  const selectedSong = gameData.votingSuggestions.find((song) => song.id === selectedSongId)

  const wasChanged = gameData.userVotes.has(userId)
  gameData.userVotes.set(userId, selectedSongId)

  const message = wasChanged
    ? `🔄 Your vote has been changed to "${selectedSong.name}"!`
    : `✅ Your vote for "${selectedSong.name}" has been recorded!`

  await interaction.reply({ content: message, flags: 64 })
}

async function handlePagination(interaction, action, requestId) {
  const searchData = gameData.searchPagination.get(requestId)
  if (!searchData || !validateUser(interaction, searchData.userId)) {
    return sendExpiredMessage(interaction)
  }

  if (action === "cancel") {
    return cancelSearch(interaction, requestId, searchData)
  }

  updateSearchPage(searchData, action)
  const { embed, components } = createSearchEmbed(searchData, requestId)

  try {
    await interaction.update({ embeds: [embed], components })
  } catch (error) {
    await interaction.followUp({ embeds: [embed], components, flags: 64 })
  }
}

function validateUser(interaction, expectedUserId) {
  if (interaction.user.id !== expectedUserId) {
    interaction.reply({ content: "Only the original requester can interact with this.", flags: 64 })
    return false
  }
  return true
}

async function sendExpiredMessage(interaction) {
  await interaction.reply({ content: "This request has expired.", flags: 64 })
}

async function cancelSearch(interaction, requestId, searchData) {
  gameData.searchPagination.delete(requestId)
  searchData.allResults.forEach((song) => gameData.pendingSearches.delete(song.id))

  try {
    await interaction.update({ content: "🚫 Search cancelled.", embeds: [], components: [] })
  } catch (error) {
    await interaction.followUp({ content: "🚫 Search cancelled.", flags: 64 })
  }
}

function updateSearchPage(searchData, action) {
  const oldPage = searchData.currentPage
  const maxPages = Math.ceil(searchData.allResults.length / 5)

  if (action === "prev") {
    searchData.currentPage = Math.max(0, searchData.currentPage - 1)
  } else if (action === "next") {
    searchData.currentPage = Math.min(maxPages - 1, searchData.currentPage + 1)
  }

  const oldResults = searchData.allResults.slice(oldPage * 5, Math.min((oldPage + 1) * 5, searchData.allResults.length))
  oldResults.forEach((song) => gameData.pendingSearches.delete(song.id))
}

async function handleSongSelect(interaction, songId) {
  const searchData = gameData.pendingSearches.get(songId)
  if (!searchData || !validateUser(interaction, searchData.userId)) {
    return sendExpiredMessage(interaction)
  }

  const selectedSong = findAndCleanupSong(songId, searchData.userId)
  if (selectedSong) {
    showSongApproval(selectedSong, searchData.username, interaction, searchData.userId)
  } else {
    await interaction.reply({ content: "Song not found.", flags: 64 })
  }
}

function findAndCleanupSong(songId, userId) {
  for (const [searchId, searchPagData] of gameData.searchPagination.entries()) {
    if (searchPagData.userId === userId) {
      const selectedSong = searchPagData.allResults.find((song) => song.id === songId)
      if (selectedSong) {
        gameData.searchPagination.delete(searchId)
        searchPagData.allResults.forEach((song) => gameData.pendingSearches.delete(song.id))
        return selectedSong
      }
    }
  }
  return null
}

async function handleApproval(interaction, requestId, isApproved) {
  const request = gameData.pendingRequests.get(requestId)
  if (!request || !validateUser(interaction, request.userId)) {
    return sendExpiredMessage(interaction)
  }

  const embed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(isApproved ? 0x00ff00 : 0xff0000)
    .setFooter({ text: `${isApproved ? "✅ Approved" : "❌ Rejected"} by ${interaction.user.username}` })

  await interaction.update({ embeds: [embed], components: [] })

  if (isApproved) {
    const songData = extractSongDataFromEmbed(interaction.message.embeds[0])

    if (config.voting.enabled) {
      addToVotingSuggestions(request, interaction.channel, songData)
    } else {
      download(request.downloadUrl, request.fileName, request.hash, request.username, interaction.channel, songData)
    }
  } else {
    globalCooldown = 0
  }

  gameData.pendingRequests.delete(requestId)
  gameData.pendingSearches.delete(requestId)
}

function extractSongDataFromEmbed(embed) {
  return {
    name: embed.fields.find((f) => f.name === "🎵 Song")?.value || "Unknown",
    artist: embed.fields.find((f) => f.name === "🎤 Artist")?.value || "Unknown",
    mapper: embed.fields.find((f) => f.name === "👤 Mapper")?.value || "Unknown",
    bsrCode: embed.fields.find((f) => f.name === "🆔 BSR Code")?.value || "Unknown",
  }
}

function processSearch(messageContent, userContext, message) {
  const command = `${config.commandTrigger}search`
  if (!messageContent.startsWith(command)) return false

  const query = messageContent.slice(command.length + 1)
  if (messageContent.charAt(command.length) === ` ` && query.length > 0) {
    searchSongs(query, userContext, message)
  } else {
    message.reply(config.message.manual)
  }
  return true
}

function searchSongs(query, userContext, message) {
  console.log(`* Searching for songs: "${query}"`)

  fetchFromAPI(`https://api.beatsaver.com/search/text/0?q=${encodeURIComponent(query)}&sortOrder=Relevance`)
    .then((data) => {
      if (!data.docs?.length) {
        message.reply(`No songs found for "${query}". Try different keywords!`)
        return
      }

      const searchId = `search_${Date.now()}`
      const searchData = {
        allResults: data.docs,
        currentPage: 0,
        username: userContext.username,
        userId: userContext.userId,
        query: query,
        totalResults: data.docs.length,
      }

      gameData.searchPagination.set(searchId, searchData)
      updateSearchCache(searchData.allResults.slice(0, 5), userContext)

      const { embed, components } = createSearchEmbed(searchData, searchId)
      message.reply({ embeds: [embed], components })
    })
    .catch((err) => {
      console.log("Search error:", err)
      message.reply("Sorry, there was an error searching for songs. Please try again!")
    })
}

async function fetchFromAPI(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: { "User-Agent": config.user_agent },
  })

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`)
  }

  return response.json()
}

function updateSearchCache(results, userContext) {
  results.forEach((song) => {
    gameData.pendingSearches.set(song.id, {
      results: results,
      username: userContext.username,
      userId: userContext.userId,
    })
  })
}

function createSearchEmbed(searchData, searchId) {
  const { allResults, currentPage, username, query, totalResults } = searchData
  const startIndex = currentPage * 5
  const endIndex = Math.min(startIndex + 5, allResults.length)
  const currentPageResults = allResults.slice(startIndex, endIndex)
  const maxPages = Math.ceil(allResults.length / 5)

  const embed = new EmbedBuilder()
    .setColor(0x9932cc)
    .setTitle("🔍 Song Search Results")
    .setDescription(
      `Found ${totalResults} songs for "${query}"\nPage ${currentPage + 1} of ${maxPages} (showing ${startIndex + 1}-${endIndex} of ${totalResults})`,
    )
    .setFooter({ text: `Search by ${username}` })
    .setTimestamp()

  currentPageResults.forEach((song, index) => {
    const rating = song.stats.score ? `${(song.stats.score * 100).toFixed(1)}%` : "N/A"
    const duration = formatDuration(song.metadata.duration)
    const globalIndex = startIndex + index + 1

    embed.addFields({
      name: `${globalIndex}. ${song.name}`,
      value: `**Artist:** ${song.metadata.songAuthorName}\n**Mapper:** ${song.metadata.levelAuthorName}\n**BSR:** ${song.id} | **Rating:** ${rating} | **Duration:** ${duration}`,
      inline: false,
    })
  })

  const components = createSearchComponents(currentPageResults, searchId, currentPage, maxPages, startIndex)
  updateSearchCache(currentPageResults, { username: searchData.username, userId: searchData.userId })

  return { embed, components }
}

function createSearchComponents(results, searchId, currentPage, maxPages, startIndex) {
  const selectionRow = new ActionRowBuilder()
  results.forEach((song, index) => {
    const globalIndex = startIndex + index + 1
    selectionRow.addComponents(
      new ButtonBuilder().setCustomId(`select_${song.id}`).setLabel(`${globalIndex}`).setStyle(ButtonStyle.Primary),
    )
  })

  const navigationRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`prev_${searchId}`)
      .setLabel("◀️ Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(`cancel_${searchId}`).setLabel("🚫 Cancel").setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`next_${searchId}`)
      .setLabel("Next ▶️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= maxPages - 1),
  )

  return [selectionRow, navigationRow]
}

function showSongApproval(songInfo, username, interaction, userId) {
  const versions = songInfo.versions[0]
  const fileName = sanitize(`${songInfo.id} ${username} ${songInfo.metadata.levelAuthorName} (${songInfo.name}).zip`)

  const embed = createSongEmbed(songInfo, versions, username, "🎵 Song Request (from search)")
  const components = createApprovalComponents(songInfo.id)

  gameData.pendingRequests.set(songInfo.id, {
    downloadUrl: versions.downloadURL,
    fileName,
    hash: versions.hash,
    username,
    userId: userId,
  })

  interaction.reply({ embeds: [embed], components: [components], flags: 64 })
}

function processBsr(messageContent, userContext, message) {
  const command = `${config.commandTrigger}bsr`
  if (!messageContent.startsWith(command)) return false

  const mapId = messageContent.slice(command.length + 1)
  if (messageContent.charAt(command.length) === ` ` && mapId.length > 0) {
    if (!config.voting.enabled) setGlobalCooldown()
    fetchMapInfo(mapId, userContext, message)
  } else {
    message.reply(config.message.manual)
  }
  return true
}

async function fetchMapInfo(mapId, userContext, message) {
  console.log(`* Getting map info...`)

  try {
    const info = await fetchFromAPI(`https://api.beatsaver.com/maps/id/${mapId}`)

    if (!info?.versions?.length) {
      throw new Error("Invalid song data received")
    }

    const versions = info.versions[0]
    const fileName = sanitize(`${info.id} ${userContext.username} ${info.metadata.levelAuthorName} (${info.name}).zip`)

    const embed = createSongEmbed(info, versions, userContext.username, "🎵 Song Request")
    const components = createApprovalComponents(info.id)

    gameData.pendingRequests.set(info.id, {
      downloadUrl: versions.downloadURL,
      fileName,
      hash: versions.hash,
      username: userContext.username,
      userId: userContext.userId,
    })

    message.reply({ embeds: [embed], components: [components] })
  } catch (err) {
    console.log("BSR fetch error:", err)
    globalCooldown = 0
    message.reply(`❌ Could not find BSR code "${mapId}". Please check the code and try again!`)
  }
}

function createSongEmbed(songInfo, versions, username, title) {
  return new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(title)
    .setThumbnail(versions.coverURL)
    .addFields(
      { name: "🎤 Artist", value: songInfo.metadata.songAuthorName, inline: true },
      { name: "🎵 Song", value: songInfo.name, inline: true },
      { name: "👤 Mapper", value: songInfo.metadata.levelAuthorName, inline: true },
      { name: "🆔 BSR Code", value: songInfo.id, inline: true },
      { name: "⭐ Rating", value: `${(songInfo.stats.score * 100).toFixed(1)}%`, inline: true },
      { name: "⏱️ Duration", value: formatDuration(songInfo.metadata.duration), inline: true },
    )
    .setFooter({ text: `${title.includes("search") ? "Selected" : "Requested"} by ${username}` })
    .setTimestamp()
}

function createApprovalComponents(songId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`approve_${songId}`).setLabel("✅ Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reject_${songId}`).setLabel("❌ Reject").setStyle(ButtonStyle.Danger),
  )
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`
}

async function download(url, fileName, hash, username, channel, songData = null) {
  console.log(`* Downloading map...`)

  const mapsFolder = `maps`
  ensureDirectoryExists(mapsFolder)

  const filePath = `${mapsFolder}/${fileName}`

  return new Promise((resolve) => {
    const fileStream = fs.createWriteStream(filePath)
    http.get(url, (response) => response.pipe(fileStream))

    fileStream.on("finish", () => {
      console.log(`* Downloaded "${fileName}"`)

      const queueSongData = songData
        ? createSongDataFromInfo(songData, username)
        : createSongData(fileName, hash, username)
      gameData.songQueue.push(queueSongData)
      console.log(`* Added "${queueSongData.name}" to queue. Queue length: ${gameData.songQueue.length}`)

      if (config.playlist.enabled) {
        addToPlaylist(queueSongData, hash)
      }

      sendSuccessMessage(channel, username, gameData.songQueue.length)

      if (questConnected) {
        extractZip(hash, filePath)
      }
      resolve()
    })
  })
}

function ensureDirectoryExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function createSongDataFromInfo(songData, username) {
  return {
    name: songData.name,
    artist: songData.artist,
    mapper: songData.mapper,
    bsrCode: songData.bsrCode,
    username: username,
    addedAt: new Date(),
  }
}

function createSongData(fileName, hash, username) {
  return {
    name: fileName.split(" ").slice(2, -1).join(" ") || "Unknown",
    artist: "Unknown",
    mapper: "Unknown",
    bsrCode: hash || "Unknown",
    username: username,
    addedAt: new Date(),
  }
}

function sendSuccessMessage(channel, username, queuePosition) {
  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle("✅ Successfully Added to Queue")
    .setDescription(`The song has been downloaded and added to the queue!\nQueue position: #${queuePosition}`)
    .setFooter({ text: `Downloaded for ${username}` })
    .setTimestamp()

  channel.send({ embeds: [embed] })
}

function addToPlaylist(songData, hash) {
  try {
    const localPlaylistPath = "playlists"
    ensureDirectoryExists(localPlaylistPath)

    const playlistFileName = sanitize(`${config.playlist.name}.bplist`)
    const localFilePath = path.join(localPlaylistPath, playlistFileName)

    const playlist = loadOrCreatePlaylist(localFilePath)

    if (playlist.songs.find((song) => song.hash?.toLowerCase() === hash.toLowerCase())) {
      console.log(`* Song "${songData.name}" already exists in playlist, skipping`)
      return
    }

    playlist.songs.push({
      hash: hash,
      songName: songData.name,
      key: songData.bsrCode,
    })

    fs.writeFileSync(localFilePath, JSON.stringify(playlist, null, 2), "utf8")
    console.log(
      `* Added "${songData.name}" to playlist "${config.playlist.name}" (${playlist.songs.length} songs total)`,
    )

    if (questConnected) {
      pushToQuest(localFilePath, playlistFileName, questPlaylistPath)
    }
  } catch (err) {
    console.log(`* Error adding song to playlist: ${err.message}`)
  }
}

function loadOrCreatePlaylist(filePath) {
  const defaultPlaylist = {
    playlistTitle: config.playlist.name,
    playlistAuthor: config.playlist.author,
    playlistDescription: config.playlist.description,
    image: "",
    songs: [],
  }

  if (!fs.existsSync(filePath)) return defaultPlaylist

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (err) {
    console.log(`* Warning: Could not parse existing playlist, creating new one: ${err.message}`)
    return defaultPlaylist
  }
}

function pushToQuest(localPath, fileName, remotePath) {
  console.log(`- Uploading to Quest...`)
  executeCommand(
    `${adb} -s ${questIpAddress}:5555 push --sync "${localPath}" "${remotePath}/${fileName}"`,
    () => console.log(`- ${fileName} uploaded to Quest`),
    (error) => console.log(`- Upload error: ${error}`),
  )
}

function isOnGlobalCooldown(messageOrInteraction) {
  const now = Date.now()
  if (!globalCooldown || now >= globalCooldown) return false

  const remainingTime = Math.ceil((globalCooldown - now) / 1000)
  const replyContent = `⏰ Please wait ${remainingTime} seconds before making another request.`

  if (messageOrInteraction.reply) {
    messageOrInteraction.reply(replyContent)
  } else {
    messageOrInteraction.reply({ content: replyContent, flags: 64 })
  }
  return true
}

function setGlobalCooldown() {
  if (config.cooldown.enabled) {
    globalCooldown = Date.now() + config.cooldown.duration
  }
}

function processQueue(messageContent, userContext, message) {
  const command = `${config.commandTrigger}queue`
  if (!messageContent.startsWith(command)) return false

  if (gameData.songQueue.length === 0) {
    message.reply("🎵 The queue is currently empty!")
    return true
  }

  const embed = new EmbedBuilder()
    .setColor(0x9932cc)
    .setTitle("🎵 Current Song Queue")
    .setDescription(`There are ${gameData.songQueue.length} song(s) in the queue:`)
    .setTimestamp()

  gameData.songQueue.forEach((song, index) => {
    embed.addFields({
      name: `${index + 1}. ${song.name}`,
      value: `**Artist:** ${song.artist}\n**Mapper:** ${song.mapper}\n**BSR:** ${song.bsrCode}\n**Added by:** ${song.username}`,
      inline: false,
    })
  })

  message.reply({ embeds: [embed] })
  return true
}

function processClearQueue(messageContent, userContext, message) {
  const command = `${config.commandTrigger}clearqueue`
  if (!messageContent.startsWith(command)) return false

  if (!userContext.isAdmin) {
    message.reply("❌ You don't have permission to use this command. Only admins can clear the queue.")
    return true
  }

  const clearedCount = gameData.songQueue.length
  gameData.songQueue.length = 0

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setTitle("🗑️ Queue Cleared")
    .setDescription(`Successfully cleared ${clearedCount} song(s) from the queue.`)
    .setFooter({ text: `Cleared by ${message.author.username}` })
    .setTimestamp()

  message.reply({ embeds: [embed] })
  return true
}

function addToVotingSuggestions(request, channel, songData) {
  const votingSong = {
    id: request.hash,
    name: songData.name,
    artist: songData.artist,
    mapper: songData.mapper,
    bsrCode: songData.bsrCode,
    username: request.username,
    downloadUrl: request.downloadUrl,
    fileName: request.fileName,
    hash: request.hash,
    votes: 0,
  }

  gameData.votingSuggestions.push(votingSong)
  console.log(
    `* Added "${votingSong.name}" to voting suggestions. Count: ${gameData.votingSuggestions.length}/${config.voting.maxSuggestions}`,
  )

  if (gameData.votingSuggestions.length >= config.voting.maxSuggestions) {
    startVoting(channel)
  } else {
    const remainingSlots = config.voting.maxSuggestions - gameData.votingSuggestions.length
    channel.send({
      content: `🗳️ Song added to voting pool! ${remainingSlots} more suggestion(s) needed to start voting.`,
    })
  }
}

function startVoting(channel) {
  if (!gameData.votingSuggestions.length) return

  gameData.userVotes.clear()
  currentVoting = { id: `voting_${Date.now()}`, startTime: Date.now() }

  const endTime = Math.floor((Date.now() + config.voting.votingDuration) / 1000)
  const embed = createVotingEmbed(endTime)
  const selectMenu = createVotingSelectMenu()

  channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(selectMenu)] })
  setTimeout(() => endVoting(channel), config.voting.votingDuration)
}

function createVotingEmbed(endTime) {
  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setTitle("🗳️ Song Voting Started!")
    .setDescription(
      `Vote for your favorite song using the dropdown below!\n⏰ Voting ends <t:${endTime}:R> (at <t:${endTime}:T>)\n\n*You can change your vote by selecting a different option.*`,
    )
    .setTimestamp()

  gameData.votingSuggestions.forEach((song, index) => {
    embed.addFields({
      name: `${index + 1}. ${song.name}`,
      value: `**Artist:** ${song.artist}\n**Mapper:** ${song.mapper}\n**BSR:** ${song.bsrCode}\n**Suggested by:** ${song.username}`,
      inline: false,
    })
  })

  return embed
}

function createVotingSelectMenu() {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("voting_select")
    .setPlaceholder("Choose your favorite song...")

  gameData.votingSuggestions.forEach((song) => {
    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(song.name)
        .setDescription(`by ${song.artist} - mapped by ${song.mapper}`)
        .setValue(song.id)
        .setEmoji("🎵"),
    )
  })

  return selectMenu
}

function endVoting(channel) {
  if (!gameData.votingSuggestions.length) return

  gameData.votingSuggestions.forEach((song) => {
    song.votes = Array.from(gameData.userVotes.values()).filter((voteId) => voteId === song.id).length
  })

  const winner = gameData.votingSuggestions.reduce((prev, current) => (prev.votes > current.votes ? prev : current))

  const embed = createVotingResultsEmbed(winner)
  channel.send({ embeds: [embed] })

  const winnerSongData = {
    name: winner.name,
    artist: winner.artist,
    mapper: winner.mapper,
    bsrCode: winner.bsrCode,
  }
  download(winner.downloadUrl, winner.fileName, winner.hash, winner.username, channel, winnerSongData)

  gameData.votingSuggestions.length = 0
  currentVoting = null
  gameData.userVotes.clear()
}

function createVotingResultsEmbed(winner) {
  const embed = new EmbedBuilder().setColor(0x00ff00).setTitle("🏆 Voting Results!").setTimestamp()

  const sortedSongs = gameData.votingSuggestions.sort((a, b) => b.votes - a.votes)

  embed.setDescription(
    `**🏆 Winner: ${winner.name}** by ${winner.artist} (${winner.votes} vote${winner.votes !== 1 ? "s" : ""})\nMapped by ${winner.mapper} | BSR: ${winner.bsrCode}\nSuggested by: ${winner.username}`,
  )

  let resultsText = ""
  sortedSongs.forEach((song, index) => {
    const position = index + 1
    const trophy = position === 1 ? "🏆" : position === 2 ? "🥈" : position === 3 ? "🥉" : `${position}.`
    resultsText += `${trophy} **${song.name}** - ${song.votes} vote${song.votes !== 1 ? "s" : ""}\n`
  })

  embed.addFields({
    name: "📊 Final Results",
    value: resultsText,
    inline: false,
  })

  return embed
}

function extractZip(hash, source) {
  try {
    extract(source, { dir: resolve(path.join("tmp", hash)) })
    pushMapToQuest(hash)
  } catch (err) {
    console.log("* Oops: extractZip failed", err)
  }
}

function pushMapToQuest(hash) {
  const sourcePath = path.join("tmp", hash)
  const targetPath = `/sdcard/ModData/com.beatgames.beatsaber/Mods/SongLoader/CustomLevels/${hash}`

  executeCommand(
    `${adb} -s ${questIpAddress}:5555 push --sync "${sourcePath}" ${targetPath}`,
    () => {
      console.log(`- Map uploaded to Quest`)
      fs.rm(path.join("tmp", hash), { recursive: true }, (err) => {
        if (err) console.log(`- Cleanup error: ${err.message}`)
      })
    },
    (error) => console.log(`- Upload error: ${error}`),
  )
}
