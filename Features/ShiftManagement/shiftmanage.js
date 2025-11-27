const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { SHIFT_TYPES } = require('../../config.json');

async function registerShiftManageCommand(client, config) {
  const data = new SlashCommandBuilder()
    .setName('shift')
    .setDescription('Manage shifts')
    .addStringOption(option =>
      option.setName('type')
        .setDescription('Type of shift')
        .setRequired(true));

  await client.application.commands.create({ 
    ...data.toJSON(), 
    guildId: config.GUILD_ID // register in specific guild
  });
}

async function handleInteraction(interaction, config) {
  console.log('Received interaction:', interaction);
  try {
    if (!interaction.isChatInputCommand()) {
      console.log('Interaction is not a chat input command.');
      return;
    }

    if (interaction.commandName !== 'shift') {
      console.log('Command is not "shift".');
      return;
    }

    const shiftTypeKey = interaction.options.getString('type');
    console.log('Shift type selected:', shiftTypeKey);

    const shiftTypeData = SHIFT_TYPES[shiftTypeKey];
    if (!shiftTypeData) {
      console.log('Invalid shift type:', shiftTypeKey);
      return interaction.reply({ content: `Invalid shift type: ${shiftTypeKey}`, ephemeral: true });
    }

    console.log('Shift type data:', shiftTypeData);

    // Check user role
    const requiredRoleID = shiftTypeData.roleId;
    console.log('Required role ID:', requiredRoleID);
    if (!interaction.member.roles.cache.has(requiredRoleID)) {
      console.log('User does not have required role.');
      return interaction.reply({ content: 'You do not have permission to start this shift type.', ephemeral: true });
    }

    // Initialize in-memory store if needed
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
      console.log('Log channel not found.');
      return interaction.reply({ content: 'Log channel not found.', ephemeral: true });
    }
    console.log('Log channel fetched:', logChannel.id);

    // Prepare embed with proper footer
    const baseEmbed = new EmbedBuilder()
      .setAuthor({ name: 'Shift Management', iconURL: interaction.user.displayAvatarURL() })
      // Remove or replace the footer line
      // .setFooter({ text: 'Shift Management' });
      .setFooter({ text: 'Shift Management' });

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

    // Send message
    const message = await interaction.reply({ embeds: [embed], components: [], fetchReply: true });
    console.log('Shift interaction message sent.');

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

    // Collector for button interactions
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

          userShift.breakStartTime = Date.now();
          userShift.shiftState = 'ON_BREAK';

          await logChannel.send(`${interaction.user.tag} started break at <t:${Math.floor(userShift.breakStartTime / 1000)}:R>.`);

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

          const shiftEndTime = Date.now();
          const shiftDurationSeconds = Math.floor((shiftEndTime - userShift.shiftStartTime) / 1000);
          userShift.totalDuration += Math.floor((shiftEndTime - userShift.shiftStartTime) / (1000 * 60));

          // Reset shift
          userShift.shiftStartTime = null;
          userShift.breakStartTime = null;
          userShift.shiftState = 'IDLE';

          await logChannel.send(`${interaction.user.tag} ended shift at <t:${Math.floor(shiftEndTime / 1000)}:R>. Total time: ${shiftDurationSeconds} seconds.`);

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
      } catch (err) {
        console.error('Error during button interaction:', err);
        await i.reply({ content: 'There was an error processing your shift action.', ephemeral: true });
      }
    });
  } catch (err) {
    console.error('Error in handleInteraction:', err);
    throw err; // propagate
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
