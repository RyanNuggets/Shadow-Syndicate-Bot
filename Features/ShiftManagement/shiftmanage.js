const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { SHIFT_TYPES } = require('../../config.json');

// Register command (called once on startup)
async function registerShiftManageCommand(client, config) {
  const commandData = new SlashCommandBuilder()
    .setName('shift')
    .setDescription('Manage shifts')
    .addStringOption(option =>
      option.setName('type')
        .setDescription('Type of shift')
        .setRequired(true));

  await client.application.commands.create({ 
    ...commandData.toJSON(), 
    guildId: config.GUILD_ID // register guild-specific
  });
}

// Main interaction handler
async function handleInteraction(interaction, config) {
  console.log('Received interaction:', interaction);
  try {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'shift') return;

    const shiftTypeKey = interaction.options.getString('type');
    console.log('Shift type selected:', shiftTypeKey);

    const shiftTypeData = SHIFT_TYPES[shiftTypeKey];
    if (!shiftTypeData) {
      console.log('Invalid shift type:', shiftTypeKey);
      return interaction.reply({ content: `Invalid shift type: ${shiftTypeKey}`, ephemeral: true });
    }

    // Check role lock
    const requiredRoleID = shiftTypeData.roleId;
    if (!interaction.member.roles.cache.has(requiredRoleID)) {
      return interaction.reply({ content: 'You do not have permission to manage this shift type.', ephemeral: true });
    }

    // Initialize data store
    if (!interaction.client.shiftData) interaction.client.shiftData = {};
    const shiftData = interaction.client.shiftData;

    const userId = interaction.user.id;
    if (!shiftData[userId]) {
      shiftData[userId] = {
        shiftCount: 0,
        totalDuration: 0, // in minutes
        shiftStartTime: null,
        shiftType: shiftTypeKey,
        shiftState: 'IDLE', // IDLE, ON_SHIFT, ON_BREAK
        breakStartTime: null,
        totalBreakTime: 0, // in seconds
        lastBreakTime: 0, // in seconds
      };
    }

    const userShift = shiftData[userId];

    // Fetch log channel
    const logChannel = await interaction.guild.channels.fetch(shiftTypeData.logChannel);
    if (!logChannel) {
      console.log('Log channel not found.');
      return interaction.reply({ content: 'Log channel not found.', ephemeral: true });
    }
    console.log('Log channel:', logChannel.id);

    // Build the base embed (no footer)
    const baseEmbed = new EmbedBuilder()
      .setAuthor({ name: 'Shift Management', iconURL: interaction.user.displayAvatarURL() });
    // No footer

    let embed;

    // Set description based on shift state
    if (userShift.shiftState === 'IDLE') {
      embed = baseEmbed
        .setTitle(`Shift Management | ${shiftTypeData.name}`)
        .setDescription(`Shift Count: ${userShift.shiftCount}\nTotal Duration: ${formatDuration(userShift.totalDuration)}\nAverage Duration: ${userShift.shiftCount ? formatDuration(Math.floor(userShift.totalDuration / userShift.shiftCount)) : '0h 0m'}`);
    } else if (userShift.shiftState === 'ON_SHIFT') {
      embed = baseEmbed
        .setTitle(`Shift Management | ${shiftTypeData.name}`)
        .setDescription(`Shift Started`);
    } else if (userShift.shiftState === 'ON_BREAK') {
      embed = baseEmbed
        .setTitle(`Shift Management | ${shiftTypeData.name}`)
        .setDescription(`Break Started`);
    }

    // Send initial message
    const message = await interaction.reply({ embeds: [embed], components: [], fetchReply: true });
    console.log('Initial embed sent.');

    // Create buttons
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
      try {
        if (i.user.id !== interaction.user.id) {
          console.log('Interaction from another user.');
          return i.reply({ content: 'This interaction is not for you.', ephemeral: true });
        }

        if (i.customId === 'startShift') {
          if (userShift.shiftState !== 'IDLE') return;
          userShift.shiftStartTime = Date.now();
          userShift.shiftCount += 1;
          userShift.shiftType = shiftTypeKey;
          userShift.shiftState = 'ON_SHIFT';

          await logChannel.send(`${interaction.user.tag} started shift of type ${shiftTypeData.name} at <t:${Math.floor(userShift.shiftStartTime / 1000)}:R>.`);

          // Update embed
          embed = baseEmbed
            .setTitle(`Shift Management | ${shiftTypeData.name}`)
            .setDescription(`Shift Started`);

          const newRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('startShift').setLabel('Start').setStyle(ButtonStyle.Primary).setDisabled(true),
            new ButtonBuilder().setCustomId('pauseShift').setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(false),
            new ButtonBuilder().setCustomId('endShift').setLabel('End').setStyle(ButtonStyle.Danger).setDisabled(false)
          );
          await i.update({ embeds: [embed], components: [newRow] });
        } else if (i.customId === 'pauseShift') {
          if (userShift.shiftState !== 'ON_SHIFT') return;
          userShift.breakStartTime = Date.now();
          userShift.shiftState = 'ON_BREAK';

          await logChannel.send(`${interaction.user.tag} started break at <t:${Math.floor(userShift.breakStartTime / 1000)}:R>.`);

          // Update embed
          embed = baseEmbed
            .setTitle(`Shift Management | ${shiftTypeData.name}`)
            .setDescription(`Break Started`);

          const newRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('startShift').setLabel('Start').setStyle(ButtonStyle.Primary).setDisabled(true),
            new ButtonBuilder().setCustomId('pauseShift').setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId('endShift').setLabel('End').setStyle(ButtonStyle.Danger).setDisabled(false)
          );
          await i.update({ embeds: [embed], components: [newRow] });
        } else if (i.customId === 'endShift') {
          if (userShift.shiftState === 'IDLE') return;

          const shiftEndTime = Date.now();
          const shiftDurationMinutes = Math.floor((shiftEndTime - userShift.shiftStartTime) / (1000 * 60));
          userShift.totalDuration += shiftDurationMinutes;

          // Reset shift
          userShift.shiftStartTime = null;
          userShift.breakStartTime = null;
          userShift.shiftState = 'IDLE';

          await logChannel.send(`${interaction.user.tag} ended shift at <t:${Math.floor(shiftEndTime / 1000)}:R>. Total time: ${shiftDurationMinutes} minutes.`);

          const avgDur = Math.floor(userShift.totalDuration / userShift.shiftCount);
          const summaryEmbed = new EmbedBuilder()
            .setAuthor({ name: 'Shift Management', iconURL: interaction.user.displayAvatarURL() })
            .setTitle(`Shift Management | ${shiftTypeData.name}`)
            .setDescription(`Shift Count: ${userShift.shiftCount}\nTotal Duration: ${formatDuration(userShift.totalDuration)}\nAverage Duration: ${formatDuration(avgDur)}`);

          await i.update({ embeds: [summaryEmbed], components: [] });
        }
      } catch (err) {
        console.error('Error during button interaction:', err);
        await i.reply({ content: 'There was an error processing your shift action.', ephemeral: true });
      }
    });
  } catch (err) {
    console.error('Error in handleInteraction:', err);
    throw err;
  }
}

function formatDuration(minutes) {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs}h ${mins}m`;
}

module.exports = {
  registerShiftManageCommand,
  handleInteraction,
};
