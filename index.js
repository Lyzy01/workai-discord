const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── XP / LEVEL SYSTEM ───────────────────────────────────────────────────────
const XP_FILE = path.join(__dirname, 'xp.json');
let xpData = {};

function loadXP() {
  if (fs.existsSync(XP_FILE)) {
    xpData = JSON.parse(fs.readFileSync(XP_FILE, 'utf8'));
  }
}

function saveXP() {
  fs.writeFileSync(XP_FILE, JSON.stringify(xpData, null, 2));
}

function getLevel(xp) {
  return Math.floor(0.1 * Math.sqrt(xp));
}

function xpForLevel(level) {
  return Math.pow(level / 0.1, 2);
}

function addXP(userId, amount) {
  if (!xpData[userId]) xpData[userId] = { xp: 0, level: 0 };
  const before = getLevel(xpData[userId].xp);
  xpData[userId].xp += amount;
  const after = getLevel(xpData[userId].xp);
  saveXP();
  return after > before ? after : null; // returns new level if leveled up
}

loadXP();

// ─── AI CHAT HISTORY ─────────────────────────────────────────────────────────
const chatHistory = {};

async function askGroq(userId, userMessage) {
  if (!chatHistory[userId]) chatHistory[userId] = [];

  chatHistory[userId].push({ role: 'user', content: userMessage });

  // Keep last 10 messages only
  if (chatHistory[userId].length > 10) {
    chatHistory[userId] = chatHistory[userId].slice(-10);
  }

  const response = await groq.chat.completions.create({
    model: 'llama3-8b-8192',
    messages: [
      {
        role: 'system',
        content: `You are WchatBot, a fun, friendly, and helpful Discord bot assistant. 
You are witty, casual, and love to help users. Keep responses concise and engaging.
You can help with questions, games, and general chat. Use emojis occasionally.`,
      },
      ...chatHistory[userId],
    ],
    max_tokens: 500,
  });

  const reply = response.choices[0].message.content;
  chatHistory[userId].push({ role: 'assistant', content: reply });
  return reply;
}

// ─── TRIVIA QUESTIONS ─────────────────────────────────────────────────────────
const triviaQuestions = [
  { q: 'What is the capital of Japan?', a: 'tokyo' },
  { q: 'How many sides does a hexagon have?', a: '6' },
  { q: 'What planet is known as the Red Planet?', a: 'mars' },
  { q: 'Who wrote Harry Potter?', a: 'j.k. rowling' },
  { q: 'What is 12 x 12?', a: '144' },
  { q: 'What ocean is the largest?', a: 'pacific' },
  { q: 'What gas do plants absorb?', a: 'carbon dioxide' },
  { q: 'How many colors are in a rainbow?', a: '7' },
  { q: 'What is the fastest land animal?', a: 'cheetah' },
  { q: 'What language is spoken in Brazil?', a: 'portuguese' },
];

const activeTrivia = {};

// ─── RANK ROLES ───────────────────────────────────────────────────────────────
const rankRoles = [
  { level: 1,  name: '🌱 Newcomer' },
  { level: 5,  name: '⚡ Active' },
  { level: 10, name: '🔥 Regular' },
  { level: 20, name: '💎 Veteran' },
  { level: 30, name: '👑 Legend' },
];

async function assignRankRole(member, level) {
  try {
    const guild = member.guild;
    for (const rank of rankRoles) {
      if (level >= rank.level) {
        let role = guild.roles.cache.find(r => r.name === rank.name);
        if (!role) {
          role = await guild.roles.create({
            name: rank.name,
            color: 'Random',
            reason: 'Auto rank role',
          });
        }
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role);
        }
      }
    }
  } catch (e) {
    console.error('Role assign error:', e.message);
  }
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity('!help | AI Chat 🤖', { type: 0 });
});

// Welcome new members
client.on('guildMemberAdd', async (member) => {
  const channel =
    member.guild.systemChannel ||
    member.guild.channels.cache.find(
      c => c.name.includes('general') || c.name.includes('welcome')
    );

  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('👋 Welcome to the server!')
    .setDescription(`Hey ${member}, welcome to **${member.guild.name}**! 🎉\n\nType \`!help\` to see what I can do!`)
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: `Member #${member.guild.memberCount}` })
    .setTimestamp();

  channel.send({ embeds: [embed] });
});

// Message handler
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const prefix = '!';
  const content = message.content.trim();
  const userId = message.author.id;

  // ── XP gain on every message ──
  if (!content.startsWith(prefix)) {
    const xpGain = Math.floor(Math.random() * 10) + 5;
    const newLevel = addXP(userId, xpGain);
    if (newLevel !== null) {
      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('⬆️ LEVEL UP!')
        .setDescription(`${message.author} reached **Level ${newLevel}**! 🎉`)
        .setTimestamp();
      message.channel.send({ embeds: [embed] });

      const member = message.guild.members.cache.get(userId);
      if (member) await assignRankRole(member, newLevel);
    }
    return;
  }

  // ── Parse command ──
  const args = content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  // ── !help ──
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🤖 WchatBot Commands')
      .addFields(
        { name: '🗨️ AI Chat', value: '`!ai <message>` — Chat with AI\n`!reset` — Reset your AI chat history' },
        { name: '📊 Levels & XP', value: '`!rank` — Check your rank\n`!leaderboard` — Top 10 users' },
        { name: '🎮 Games', value: '`!coinflip` — Flip a coin\n`!roll <sides>` — Roll a dice\n`!trivia` — Start a trivia question\n`!rps <rock/paper/scissors>` — Play RPS' },
        { name: '🛠️ Utility', value: '`!ping` — Check bot latency\n`!userinfo` — Your profile info\n`!serverinfo` — Server info' },
      )
      .setFooter({ text: 'WchatBot • Powered by Groq AI' })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ── !ping ──
  if (command === 'ping') {
    const latency = Date.now() - message.createdTimestamp;
    return message.reply(`🏓 Pong! Latency: **${latency}ms** | API: **${Math.round(client.ws.ping)}ms**`);
  }

  // ── !ai ──
  if (command === 'ai') {
    const userMsg = args.join(' ');
    if (!userMsg) return message.reply('❌ Please provide a message. Example: `!ai hello!`');
    const typing = await message.channel.sendTyping();
    try {
      const reply = await askGroq(userId, userMsg);
      const embed = new EmbedBuilder()
        .setColor('#00C853')
        .setAuthor({ name: `${message.author.username} asked:`, iconURL: message.author.displayAvatarURL() })
        .setDescription(reply)
        .setFooter({ text: 'Powered by Groq AI (LLaMA 3)' });
      return message.reply({ embeds: [embed] });
    } catch (e) {
      return message.reply('❌ AI error: ' + e.message);
    }
  }

  // ── !reset ──
  if (command === 'reset') {
    chatHistory[userId] = [];
    return message.reply('✅ Your AI chat history has been reset!');
  }

  // ── !rank ──
  if (command === 'rank') {
    const target = message.mentions.users.first() || message.author;
    const data = xpData[target.id] || { xp: 0, level: 0 };
    const level = getLevel(data.xp);
    const currentXP = data.xp;
    const nextLevelXP = Math.floor(xpForLevel(level + 1));
    const progress = Math.min(Math.floor((currentXP / nextLevelXP) * 20), 20);
    const bar = '█'.repeat(progress) + '░'.repeat(20 - progress);

    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle(`📊 ${target.username}'s Rank`)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: 'Level', value: `**${level}**`, inline: true },
        { name: 'Total XP', value: `**${currentXP}**`, inline: true },
        { name: 'Next Level', value: `**${nextLevelXP} XP**`, inline: true },
        { name: 'Progress', value: `\`${bar}\` ${currentXP}/${nextLevelXP}` },
      )
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ── !leaderboard ──
  if (command === 'leaderboard') {
    const sorted = Object.entries(xpData)
      .sort(([, a], [, b]) => b.xp - a.xp)
      .slice(0, 10);

    const medals = ['🥇', '🥈', '🥉'];
    const desc = await Promise.all(
      sorted.map(async ([id, data], i) => {
        const user = await client.users.fetch(id).catch(() => ({ username: 'Unknown' }));
        const level = getLevel(data.xp);
        return `${medals[i] || `**${i + 1}.**`} ${user.username} — Level **${level}** (${data.xp} XP)`;
      })
    );

    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('🏆 Leaderboard — Top 10')
      .setDescription(desc.join('\n') || 'No data yet!')
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ── !coinflip ──
  if (command === 'coinflip') {
    const result = Math.random() < 0.5 ? '🪙 Heads' : '🪙 Tails';
    return message.reply(`You flipped a coin... it landed on **${result}**!`);
  }

  // ── !roll ──
  if (command === 'roll') {
    const sides = parseInt(args[0]) || 6;
    if (sides < 2 || sides > 1000) return message.reply('❌ Please use a number between 2 and 1000.');
    const result = Math.floor(Math.random() * sides) + 1;
    return message.reply(`🎲 You rolled a **d${sides}** and got... **${result}**!`);
  }

  // ── !trivia ──
  if (command === 'trivia') {
    if (activeTrivia[message.channel.id]) {
      return message.reply('❌ A trivia question is already active in this channel! Answer it first.');
    }
    const q = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
    activeTrivia[message.channel.id] = q;

    const embed = new EmbedBuilder()
      .setColor('#7289DA')
      .setTitle('🧠 Trivia Time!')
      .setDescription(`**${q.q}**\n\nYou have **30 seconds** to answer!`)
      .setFooter({ text: 'Type your answer in chat!' });
    message.channel.send({ embeds: [embed] });

    setTimeout(() => {
      if (activeTrivia[message.channel.id]) {
        delete activeTrivia[message.channel.id];
        message.channel.send(`⏰ Time's up! The answer was **${q.a}**!`);
      }
    }, 30000);
    return;
  }

  // ── !rps ──
  if (command === 'rps') {
    const choices = ['rock', 'paper', 'scissors'];
    const userChoice = args[0]?.toLowerCase();
    if (!choices.includes(userChoice)) return message.reply('❌ Choose: `rock`, `paper`, or `scissors`');
    const botChoice = choices[Math.floor(Math.random() * 3)];
    const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
    let result;
    if (userChoice === botChoice) result = "It's a **tie**! 🤝";
    else if (
      (userChoice === 'rock' && botChoice === 'scissors') ||
      (userChoice === 'paper' && botChoice === 'rock') ||
      (userChoice === 'scissors' && botChoice === 'paper')
    ) result = 'You **win**! 🎉';
    else result = 'You **lose**! 😈';

    return message.reply(`${emojis[userChoice]} vs ${emojis[botChoice]} — ${result}`);
  }

  // ── !userinfo ──
  if (command === 'userinfo') {
    const target = message.mentions.members.first() || message.member;
    const data = xpData[target.id] || { xp: 0 };
    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle(`👤 ${target.user.username}`)
      .setThumbnail(target.user.displayAvatarURL())
      .addFields(
        { name: 'ID', value: target.id, inline: true },
        { name: 'Level', value: `${getLevel(data.xp)}`, inline: true },
        { name: 'XP', value: `${data.xp}`, inline: true },
        { name: 'Joined Server', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true },
        { name: 'Account Created', value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:R>`, inline: true },
      )
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ── !serverinfo ──
  if (command === 'serverinfo') {
    const guild = message.guild;
    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle(`🏠 ${guild.name}`)
      .setThumbnail(guild.iconURL())
      .addFields(
        { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
        { name: 'Members', value: `${guild.memberCount}`, inline: true },
        { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
        { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
        { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
      )
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }
});

// ── Trivia answer checker ──
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const trivia = activeTrivia[message.channel.id];
  if (!trivia) return;
  if (message.content.toLowerCase().trim() === trivia.a.toLowerCase()) {
    delete activeTrivia[message.channel.id];
    const xpGain = 50;
    addXP(message.author.id, xpGain);
    const embed = new EmbedBuilder()
      .setColor('#00C853')
      .setTitle('✅ Correct!')
      .setDescription(`${message.author} got it right! The answer was **${trivia.a}**!\n\n+${xpGain} XP 🎉`);
    return message.channel.send({ embeds: [embed] });
  }
});

client.login(process.env.DISCORD_TOKEN);
