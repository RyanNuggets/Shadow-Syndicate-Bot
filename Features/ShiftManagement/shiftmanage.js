const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { GUILD_ID } = require('../../config.json');

const { SHIFT_TYPES } = require('../../config.json');

function formatDuration(minutes) {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}h ${mins}m`;
}

// Function to register slash command
async function registerShiftManageCommand(client, config) {
  const data = new SlashCommandBuilder()
    .setName('shift')
    .setDescription('Manage shifts')
    .addStringOption(option =>
      option.setName('type')
        .setDescription('Type of shift')
        .setRequired(true));

  // Register command globally or guild-specific
  await client.application.commands.create({ 
    ...data.toJSON(), 
    guildId: config.GUILD_ID // for guild-specific registration
  });
}

// Function to handle interactions
async function handleInteraction(interaction, config) {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'shift') return;

  const shiftTypeKey = interaction.options.getString('type');
  const shiftTypeData = SHIFT_TYPES[shiftTypeKey];

  if (!shiftTypeData) {
    return interaction.reply({ content: `Invalid shift type: ${shiftTypeKey}`, ephemeral: true });
  }

  // Check if user has required role
  const requiredRoleID = shiftTypeData.roleId;
  if (!interaction.member.roles.cache.has(requiredRoleID)) {
    return interaction.reply({ content: 'You do not have permission to start this shift type.', ephemeral: true });
  }

  // For simplicity, using in-memory store (replace with persistent storage)
  if (!interaction.client.shiftData) interaction.client.shiftData = {};
  const shiftData = interaction.client.shiftData;

  const userId = interaction.user.id;
  if (!shiftData[userId]) {
    shiftData[userId] = {
      shiftCount: 0,
      totalDuration: 0,
      shiftStartTime: null,
      shiftType: null,
      shiftState: 'IDLE', // IDLE, ON_SHIFT, ON_BREAK
      breakStartTime: null,
      totalBreakTime: 0,
      lastBreakTime: 0,
    };
  }

  const userShift = shiftData[userId];

  // Fetch log channel
  const logChannel = await interaction.guild.channels.fetch(shiftTypeData.logChannel);
  if (!logChannel) {
    return interaction.reply({ content: 'Log channel not found.', ephemeral: true });
  }

  // Prepare embed and buttons based on shift state
  const baseEmbed = new EmbedBuilder()
    .setAuthor({ name: 'Shift Management', iconURL: interaction.user.displayAvatarURL() })
    .setFooter({ text: '' });

  let embed;
  if (userShift.shiftState === 'IDLE') {
    embed = baseEmbed
      .setTitle(`Shift Management | ${shiftTypeData.name}`)
      .setDescription('All Time Information')
      .addFields(
        { name: 'Shift Count:', value: `${userShift.shiftCount}`, inline: true },
        { name: 'Total Duration:', value: `${formatDuration(userShift.totalDuration)}`, inline: true },
        { name: 'Average Duration:', value: `${userShift.shiftCount ? formatDuration(Math.floor(userShift.totalDuration / userShift.shiftCount)) : '0h 0m'}`, inline: true }
      );
  } else if (userShift.shiftState === 'ON_SHIFT') {
    embed = baseEmbed
      .setTitle(`Shift Management | ${shiftTypeData.name}`)
      .setDescription('Shift Started')
      .addFields(
        { name: 'Current Shift', value: `**Status:** On Shift\n**Started:** <t:${Math.floor(userShift.shiftStartTime / 1000)}:R>`, inline: false }
      );
  } else if (userShift.shiftState === 'ON_BREAK') {
    embed = baseEmbed
      .setTitle(`Shift Management | ${shiftTypeData.name}`)
      .setDescription('Break Started')
      .addFields(
        { name: 'Current Shift', value: `**Status:** On Break\n**Shift Started:** <t:${Math.floor(userShift.shiftStartTime / 1000)}:R>\n**Break Started:** <t:${Math.floor(userShift.breakStartTime / 1000)}:R>`, inline: false }
      );
  }

  // Send initial message
  const message = await interaction.reply({ embeds: [embed], components: [], fetchReply: true });

  // Buttons
  const startBtn = new ButtonBuilder()
    .setCustomId('startShift')
    .setLabel('Start')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(userShift.shiftState !== 'IDLE');

  const pauseBtn = new ButtonBuilder()
    .setCustomId('pauseShift')
    .setLabel('Pause')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(userShift.shiftState !== 'ON_SHIFT');

  const endBtn = new ButtonBuilder()
    .setCustomId('endShift')
    .setLabel('End')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(userShift.shiftState === 'IDLE');

  const row = new ActionRowBuilder().addComponents(startBtn, pauseBtn, endBtn);

  // Collector for buttons
  const collector = message.createMessageComponentCollector({ time: 60 * 60 * 1000 });
  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: 'This interaction is not for you.', ephemeral: true });
    }

    if (i.customId === 'startShift') {
      if (userShift.shiftState !== 'IDLE') return;

      // Start shift
      userShift.shiftStartTime = Date.now();
      userShift.shiftCount += 1;
      userShift.shiftType = shiftTypeKey;
      userShift.shiftState = 'ON_SHIFT';

      await logChannel.send(`${interaction.user.tag} started shift of type ${shiftTypeData.name} at <t:${Math.floor(userShift.shiftStartTime / 1000)}:R>.`);

      // Update embed and buttons
      embed = baseEmbed
        .setTitle(`Shift Management | ${shiftTypeData.name}`)
        .setDescription('Shift Started')
        .addFields(
          { name: 'Current Shift', value: `**Status:** On Shift\n**Started:** <t:${Math.floor(userShift.shiftStartTime / 1000)}:R>`, inline: false }
        );

      const newRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('startShift').setLabel('Start').setStyle(ButtonStyle.Primary).setDisabled(true),
        new ButtonBuilder().setCustomId('pauseShift').setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(false),
        new ButtonBuilder().setCustomId('endShift').setLabel('End').setStyle(ButtonStyle.Danger).setDisabled(false),
      );
      await i.update({ embeds: [embed], components: [newRow] });
    } else if (i.customId === 'pauseShift') {
      if (userShift.shiftState !== 'ON_SHIFT') return;

      // Start break
      userShift.breakStartTime = Date.now();
      userShift.shiftState = 'ON_BREAK';

      await logChannel.send(`${interaction.user.tag} started break at <t:${Math.floor(userShift.breakStartTime / 1000)}:R>.`);

      // Update embed and buttons
      embed = baseEmbed
        .setTitle(`Shift Management | ${shiftTypeData.name}`)
        .setDescription('Break Started')
        .addFields(
          { name: 'Current Shift', value: `**Status:** On Break\n**Shift Started:** <t:${Math.floor(userShift.shiftStartTime / 1000)}:R>\n**Break Started:** <t:${Math.floor(userShift.breakStartTime / 1000)}:R>`, inline: false }
        );

      const newRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('startShift').setLabel('Start').setStyle(ButtonStyle.Primary).setDisabled(true),
        new ButtonBuilder().setCustomId('pauseShift').setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('endShift').setLabel('End').setStyle(ButtonStyle.Danger).setDisabled(false),
      );
      await i.update({ embeds: [embed], components: [newRow] });
    } else if (i.customId === 'endShift') {
      if (userShift.shiftState === 'IDLE') return;

      // End shift
      const shiftEndTime = Date.now();
      const shiftDurationSeconds = Math.floor((shiftEndTime - userShift.shiftStartTime) / 1000);
      userShift.totalDuration += Math.floor((shiftEndTime - userShift.shiftStartTime) / (1000 * 60)); // in minutes

      // Reset shift
      userShift.shiftStartTime = null;
      userShift.breakStartTime = null;
      userShift.shiftState = 'IDLE';

      // Log
      await logChannel.send(`${interaction.user.tag} ended shift at <t:${Math.floor(shiftEndTime / 1000)}:R>. Total time: ${shiftDurationSeconds} seconds.`);

      // Show summary
      const avgDur = Math.floor(userShift.totalDuration / userShift.shiftCount);
      const summaryEmbed = new EmbedBuilder()
        .setAuthor({ name: 'Shift Management', iconURL: interaction.user.displayAvatarURL() })
        .setTitle(`Shift Management | ${shiftTypeData.name}`)
        .setDescription('All Time Information')
        .addFields(
          { name: 'Shift Count:', value: `${userShift.shiftCount}`, inline: true },
          { name: 'Total Duration:', value: `${formatDuration(userShift.totalDuration)}`, inline: true },
          { name: 'Average Duration:', value: `${formatDuration(avgDur)}`, inline: true }
        );

      await i.update({ embeds: [summaryEmbed], components: [] });
    }
  });
}

module.exports = {
  registerShiftManageCommand,
  handleInteraction,
};
