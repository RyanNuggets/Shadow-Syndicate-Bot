// shiftmanage.js
// Place this at: /Features/ShiftManagement/shiftmanage.js

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const CONFIG_PATH = path.join(__dirname, '../../config.json'); // project root config.json
const DATA_PATH = path.join(__dirname, '../../shiftdata.json'); // project root shiftdata.json

// --- helpers for config & data ---
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) throw new Error('config.json not found at ' + CONFIG_PATH);
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function ensureData() {
  if (!fs.existsSync(DATA_PATH)) {
    const initial = { activeShifts: [], userStats: {} };
    fs.writeFileSync(DATA_PATH, JSON.stringify(initial, null, 2));
  }
}

function readData() {
  ensureData();
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function addShiftObj(shiftObj) {
  const d = readData();
  d.activeShifts.push(shiftObj);
  writeData(d);
}

function updateShiftObj(shiftId, patch) {
  const d = readData();
  const idx = d.activeShifts.findIndex(s => s.shiftId === shiftId);
  if (idx === -1) return null;
  d.activeShifts[idx] = Object.assign({}, d.activeShifts[idx], patch);
  writeData(d);
  return d.activeShifts[idx];
}

function removeShiftObj(shiftId) {
  const d = readData();
  const found = d.activeShifts.find(s => s.shiftId === shiftId) || null;
  d.activeShifts = d.activeShifts.filter(s => s.shiftId !== shiftId);
  writeData(d);
  return found;
}

function getShiftObj(shiftId) {
  const d = readData();
  return d.activeShifts.find(s => s.shiftId === shiftId) || null;
}

function getUserStats(userId, typeId) {
  const d = readData();
  d.userStats = d.userStats || {};
  const byUser = d.userStats[userId] || {};
  return byUser[typeId] || { count: 0, totalTimeMs: 0 };
}

function updateUserStats(userId, typeId, addMs) {
  const d = readData();
  d.userStats = d.userStats || {};
  d.userStats[userId] = d.userStats[userId] || {};
  d.userStats[userId][typeId] = d.userStats[userId][typeId] || { count: 0, totalTimeMs: 0 };
  if (addMs > 0) {
    d.userStats[userId][typeId].count += 1;
    d.userStats[userId][typeId].totalTimeMs += addMs;
  }
  writeData(d);
  return d.userStats[userId][typeId];
}

function formatDuration(ms) {
  if (ms === 0) return '0s';
  let s = Math.floor(ms / 1000);
  const hours = Math.floor(s / 3600);
  s -= hours * 3600;
  const mins = Math.floor(s / 60);
  s -= mins * 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

// parse customId: "shift_<shiftId>_<action>_<typeId>"
function parseCustomId(customId) {
  if (!customId || !customId.startsWith('shift_')) return null;
  const parts = customId.split('_');
  if (parts.length < 4) return null;
  const shiftId = parts[1];
  const action = parts[2];
  const typeId = parts.slice(3).join('_');
  return { shiftId, action, typeId };
}

// --- Slash command export ---
const config = (() => {
  try { return loadConfig(); } catch (e) { return null; }
})();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shift')
    .setDescription('Shift Management')
    .addSubcommand(sub =>
      sub.setName('manage')
        .setDescription('Open a shift management panel for a shift type.')
        .addStringOption(opt => {
          const optBuilder = opt.setName('type').setDescription('Shift type').setRequired(true);
          if (config && Array.isArray(config.SHIFT_TYPES)) {
            optBuilder.addChoices(...config.SHIFT_TYPES.map(t => ({ name: t.name, value: t.id })));
          }
          return optBuilder;
        })
    ),

  async execute(interaction) {
    try {
      const cfg = loadConfig();
      const requiredRole = cfg.SHIFT_ROLE_REQUIRED || null;
      if (requiredRole && !interaction.member.roles.cache.has(requiredRole)) {
        return interaction.reply({ content: '❌ You do not have permission to use this.', ephemeral: true });
      }

      const typeId = interaction.options.getString('type');
      const typeObj = (cfg.SHIFT_TYPES || []).find(t => t.id === typeId) || { id: typeId, name: typeId };

      const stats = getUserStats(interaction.user.id, typeId);
      const count = stats.count || 0;
      const totalTimeMs = stats.totalTimeMs || 0;
      const avgMs = count > 0 ? Math.round(totalTimeMs / count) : 0;

      const embed = new EmbedBuilder()
        .setAuthor({ name: `Shift Management | ${typeObj.name}`, iconURL: interaction.user.displayAvatarURL({ forceStatic: false }) })
        .setTitle('All Time Information')
        .addFields(
          { name: '**Shift Count:**', value: `${count}`, inline: true },
          { name: '**Total Duration:**', value: `${formatDuration(totalTimeMs)}`, inline: true },
          { name: '**Average Duration:**', value: `${formatDuration(avgMs)}`, inline: true }
        )
        .setColor('#5865F2');

      const shiftId = randomUUID();
      const startId = `shift_${shiftId}_start_${typeId}`;
      const pauseId = `shift_${shiftId}_pause_${typeId}`;
      const endId = `shift_${shiftId}_end_${typeId}`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(startId).setLabel('Start').setStyle(ButtonStyle.Success).setDisabled(false),
        new ButtonBuilder().setCustomId(pauseId).setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(endId).setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(true)
      );

      const placeholder = {
        shiftId,
        userId: interaction.user.id,
        typeId,
        typeName: typeObj.name,
        status: 'idle',
        startTime: null,
        endTime: null,
        breaks: [],
        currentBreakStart: null,
        messageId: null,
        channelId: interaction.channelId,
        createdAt: Date.now()
      };

      addShiftObj(placeholder);

      const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

      updateShiftObj(shiftId, { messageId: msg.id });

    } catch (err) {
      console.error('shiftmanage.execute error:', err);
      if (!interaction.replied) interaction.reply({ content: 'An error occurred.', ephemeral: true }).catch(()=>{});
    }
  },

  async handleInteraction(interaction) {
    try {
      if (!interaction.isButton()) return;
      const parsed = parseCustomId(interaction.customId);
      if (!parsed) return;
      const { shiftId, action, typeId } = parsed;
      const shift = getShiftObj(shiftId);
      if (!shift) return interaction.reply({ content: 'Shift not found or already ended.', ephemeral: true });

      if (interaction.user.id !== shift.userId) {
        return interaction.reply({ content: 'You are not allowed to control this shift.', ephemeral: true });
      }

      if (shift.messageId && interaction.message.id !== shift.messageId) {
        return interaction.reply({ content: 'This button is no longer valid for that shift.', ephemeral: true });
      }

      const cfg = loadConfig();
      const shiftType = (cfg.SHIFT_TYPES || []).find(t => t.id === typeId) || { id: typeId, name: typeId };

      // --- START action ---
      if (action === 'start') {
        if (shift.status === 'idle') {
          const startTime = Date.now();
          updateShiftObj(shiftId, { status: 'onShift', startTime, currentBreakStart: null });
          const embed = new EmbedBuilder()
            .setAuthor({ name: `Shift Management | ${shiftType.name}`, iconURL: interaction.user.displayAvatarURL({ forceStatic: false }) })
            .setTitle('Shift Started')
            .addFields(
              { name: '**Current Shift**', value: '\u200b' },
              { name: '**Status:**', value: 'On Shift', inline: true },
              { name: '**Started:**', value: `<t:${Math.floor(startTime/1000)}:R>`, inline: true }
            )
            .setColor('Green');

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`shift_${shiftId}_start_${typeId}`).setLabel('Start').setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId(`shift_${shiftId}_pause_${typeId}`).setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(false),
            new ButtonBuilder().setCustomId(`shift_${shiftId}_end_${typeId}`).setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(false)
          );

          await interaction.update({ embeds: [embed], components: [row] });

          if (cfg.SHIFT_LOG_CHANNEL) {
            const ch = interaction.client.channels.cache.get(cfg.SHIFT_LOG_CHANNEL);
            if (ch) {
              const log = new EmbedBuilder()
                .setTitle('🟢 Shift Started')
                .addFields(
                  { name: 'User', value: `<@${interaction.user.id}>` },
                  { name: 'Type', value: shiftType.name },
                  { name: 'At', value: `<t:${Math.floor(startTime/1000)}:F>` }
                );
              ch.send({ embeds: [log] }).catch(()=>{});
            }
          }
          return;
        }

        if (shift.status === 'onBreak') {
          const breakEnd = Date.now();
          const lastBreakStart = shift.currentBreakStart;
          const lastBreakMs = Math.max(0, breakEnd - lastBreakStart);
          const breaks = (shift.breaks || []).concat([{ start: lastBreakStart, end: breakEnd }]);
          updateShiftObj(shiftId, { status: 'onShift', currentBreakStart: null, breaks });

          const totalBreakMs = breaks.reduce((s,b) => s + (b.end - b.start), 0);
          const embed = new EmbedBuilder()
            .setAuthor({ name: `Shift Management | ${shiftType.name}`, iconURL: interaction.user.displayAvatarURL({ forceStatic: false }) })
            .setTitle('Break Ended')
            .addFields(
              { name: '**Current Shift**', value: '\u200b' },
              { name: '**Status:**', value: 'On Shift', inline: true },
              { name: '**Started:**', value: `<t:${Math.floor(shift.startTime/1000)}:R>`, inline: true },
              { name: '**Total Break Time:**', value: `${formatDuration(totalBreakMs)}`, inline: false },
              { name: '**Last Break Time:**', value: `${formatDuration(lastBreakMs)}`, inline: false }
            )
            .setColor('Green');

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`shift_${shiftId}_start_${typeId}`).setLabel('Start').setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId(`shift_${shiftId}_pause_${typeId}`).setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(false),
            new ButtonBuilder().setCustomId(`shift_${shiftId}_end_${typeId}`).setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(false)
          );

          await interaction.update({ embeds: [embed], components: [row] });
          return;
        }

        return interaction.reply({ content: 'Cannot start at this time.', ephemeral: true });
      }

      // --- PAUSE action ---
      if (action === 'pause') {
        if (shift.status === 'onShift') {
          const breakStart = Date.now();
          updateShiftObj(shiftId, { status: 'onBreak', currentBreakStart: breakStart });

          const embed = new EmbedBuilder()
            .setAuthor({ name: `Shift Management | ${shiftType.name}`, iconURL: interaction.user.displayAvatarURL({ forceStatic: false }) })
            .setTitle('Break Started')
            .addFields(
              { name: '**Current Shift**', value: '\u200b' },
              { name: '**Status:**', value: 'On Break', inline: true },
              { name: '**Shift Started:**', value: `<t:${Math.floor(shift.startTime/1000)}:R>`, inline: true },
              { name: '**Break Started:**', value: `<t:${Math.floor(breakStart/1000)}:R>`, inline: true }
            )
            .setColor('#99AAB5');

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`shift_${shiftId}_start_${typeId}`).setLabel('Start').setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId(`shift_${shiftId}_pause_${typeId}`).setLabel('Resume').setStyle(ButtonStyle.Primary).setDisabled(false),
            new ButtonBuilder().setCustomId(`shift_${shiftId}_end_${typeId}`).setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(true)
          );

          await interaction.update({ embeds: [embed], components: [row] });
          return;
        }

        if (shift.status === 'onBreak') {
          const breakEnd = Date.now();
          const lastBreakStart = shift.currentBreakStart;
          const lastBreakMs = Math.max(0, breakEnd - lastBreakStart);
          const breaks = (shift.breaks || []).concat([{ start: lastBreakStart, end: breakEnd }]);
          updateShiftObj(shiftId, { status: 'onShift', currentBreakStart: null, breaks });

          const totalBreakMs = breaks.reduce((s,b) => s + (b.end - b.start), 0);
          const embed = new EmbedBuilder()
            .setAuthor({ name: `Shift Management | ${shiftType.name}`, iconURL: interaction.user.displayAvatarURL({ forceStatic: false }) })
            .setTitle('Break Ended')
            .addFields(
              { name: '**Current Shift**', value: '\u200b' },
              { name: '**Status:**', value: 'On Shift', inline: true },
              { name: '**Started:**', value: `<t:${Math.floor(shift.startTime/1000)}:R>`, inline: true },
              { name: '**Total Break Time:**', value: `${formatDuration(totalBreakMs)}`, inline: false },
              { name: '**Last Break Time:**', value: `${formatDuration(lastBreakMs)}`, inline: false }
            )
            .setColor('Green');

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`shift_${shiftId}_start_${typeId}`).setLabel('Start').setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId(`shift_${shiftId}_pause_${typeId}`).setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(false),
            new ButtonBuilder().setCustomId(`shift_${shiftId}_end_${typeId}`).setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(false)
          );

          await interaction.update({ embeds: [embed], components: [row] });
          return;
        }

        return interaction.reply({ content: 'You cannot pause/resume at this time.', ephemeral: true });
      }

      // --- END action ---
      if (action === 'end') {
        if (shift.status === 'idle') {
          removeShiftObj(shiftId);

          const stats = getUserStats(shift.userId, shift.typeId);
          const count = stats.count || 0;
          const totalTime = stats.totalTimeMs || 0;
          const avg = count > 0 ? Math.round(totalTime / count) : 0;

          const embedAll = new EmbedBuilder()
            .setAuthor({ name: `Shift Management | ${shift.typeName}`, iconURL: interaction.user.displayAvatarURL({ forceStatic: false }) })
            .setTitle('All Time Information')
            .addFields(
              { name: '**Shift Count:**', value: `${count}`, inline: true },
              { name: '**Total Duration:**', value: `${formatDuration(totalTime)}`, inline: true },
              { name: '**Average Duration:**', value: `${formatDuration(avg)}`, inline: true }
            )
            .setColor('#5865F2');

          const embedLast = new EmbedBuilder()
            .setTitle('Last Shift')
            .addFields(
              { name: '**Status:**', value: 'Ended', inline: true },
              { name: '**Total Time:**', value: `${formatDuration(0)}`, inline: true }
            );

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`shift_${randomUUID()}_start_${typeId}`).setLabel('Start').setStyle(ButtonStyle.Success).setDisabled(false),
            new ButtonBuilder().setCustomId(`shift_${randomUUID()}_pause_${typeId}`).setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId(`shift_${randomUUID()}_end_${typeId}`).setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(true)
          );

          return interaction.update({ embeds: [embedAll, embedLast], components: [row] }).catch(()=>{});
        }

        const endTime = Date.now();
        let duration = endTime - shift.startTime;
        if (shift.status === 'onBreak' && shift.currentBreakStart) {
          // count current break time as well
          duration -= (endTime - shift.currentBreakStart);
        }
        const totalBreakMs = (shift.breaks || []).reduce((s,b) => s + (b.end - b.start), 0);
        duration -= totalBreakMs;

        updateUserStats(shift.userId, shift.typeId, duration);
        removeShiftObj(shiftId);

        const embed = new EmbedBuilder()
          .setAuthor({ name: `Shift Management | ${shiftType.name}`, iconURL: interaction.user.displayAvatarURL({ forceStatic: false }) })
          .setTitle('Shift Ended')
          .addFields(
            { name: '**Total Shift Time:**', value: `${formatDuration(duration)}`, inline: true },
            { name: '**Break Time:**', value: `${formatDuration(totalBreakMs)}`, inline: true }
          )
          .setColor('Red');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`shift_${randomUUID()}_start_${typeId}`).setLabel('Start').setStyle(ButtonStyle.Success).setDisabled(false),
          new ButtonBuilder().setCustomId(`shift_${randomUUID()}_pause_${typeId}`).setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId(`shift_${randomUUID()}_end_${typeId}`).setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(true)
        );

        await interaction.update({ embeds: [embed], components: [row] });
        return;
      }

    } catch (err) {
      console.error('shiftmanage.handleInteraction error:', err);
      if (!interaction.replied) interaction.reply({ content: 'An error occurred handling the button.', ephemeral: true }).catch(()=>{});
    }
  }
};
