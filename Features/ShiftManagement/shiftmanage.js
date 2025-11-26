// shiftmanage.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const shiftDataPath = path.join(__dirname, 'shiftdata.json');
let shiftData = {};

// Load existing shift data
if (fs.existsSync(shiftDataPath)) {
    shiftData = JSON.parse(fs.readFileSync(shiftDataPath, 'utf8'));
} else {
    fs.writeFileSync(shiftDataPath, JSON.stringify({}));
}

// Helper: Save shift data
function saveShiftData() {
    fs.writeFileSync(shiftDataPath, JSON.stringify(shiftData, null, 2));
}

// Format seconds to hh:mm:ss
function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${s}s`;
}

// Register Slash Command
async function registerShiftManageCommand(client, config) {
    const guild = await client.guilds.fetch(config.GUILD_ID);

    const data = {
        name: 'shift',
        description: 'Manage your shifts',
        options: [
            {
                name: 'type',
                description: 'Select shift type',
                type: 3,
                required: true,
                choices: config.SHIFT_TYPES.map(t => ({ name: t.name, value: t.id }))
            }
        ]
    };

    await guild.commands.create(data);
    console.log(`✅ Successfully registered /shift command in guild: ${config.GUILD_ID}`);
}

// Register Button Interaction Handlers
function registerShiftManageHandlers(client, config) {
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

        // Slash command handler
        if (interaction.isChatInputCommand() && interaction.commandName === 'shift') {
            const shiftType = interaction.options.getString('type');
            const userId = interaction.user.id;

            if (!shiftData[userId]) {
                shiftData[userId] = {
                    shiftCount: 0,
                    totalDuration: 0,
                    averageDuration: 0,
                    lastShift: null
                };
            }

            // Create initial "All Time Information" embed
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Shift Management | ${shiftType}`, iconURL: interaction.user.displayAvatarURL() })
                .setTitle('All Time Information')
                .addFields(
                    { name: 'Shift Count', value: `${shiftData[userId].shiftCount}`, inline: true },
                    { name: 'Total Duration', value: formatDuration(shiftData[userId].totalDuration), inline: true },
                    { name: 'Average Duration', value: formatDuration(shiftData[userId].averageDuration), inline: true }
                );

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('start_shift').setLabel('Start').setStyle(ButtonStyle.Primary).setDisabled(false),
                new ButtonBuilder().setCustomId('pause_shift').setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('end_shift').setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );

            const msg = await interaction.reply({ embeds: [embed], components: [buttons], fetchReply: true });

            // Save shift info in memory
            shiftData[userId].current = {
                messageId: msg.id,
                channelId: msg.channelId,
                shiftType: shiftType,
                startTime: null,
                breakStart: null,
                totalBreak: 0,
                lastBreak: 0,
                status: 'idle'
            };

            saveShiftData();
        }

        // Button handlers
        if (interaction.isButton()) {
            const userId = interaction.user.id;
            if (!shiftData[userId] || !shiftData[userId].current) return;

            const current = shiftData[userId].current;
            if (interaction.customId === 'start_shift') {
                if (current.status === 'idle') {
                    current.startTime = Date.now();
                    current.status = 'onShift';

                    const embed = new EmbedBuilder()
                        .setAuthor({ name: `Shift Management | ${current.shiftType}`, iconURL: interaction.user.displayAvatarURL() })
                        .setTitle('Shift Started')
                        .addFields({ name: 'Current Shift', value: `**Status:** On Shift\n**Started:** <t:${Math.floor(current.startTime / 1000)}:R>` });

                    const buttons = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('start_shift').setLabel('Start').setStyle(ButtonStyle.Primary).setDisabled(true),
                        new ButtonBuilder().setCustomId('pause_shift').setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(false),
                        new ButtonBuilder().setCustomId('end_shift').setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(false)
                    );

                    await interaction.update({ embeds: [embed], components: [buttons] });
                    saveShiftData();
                } else if (current.status === 'onBreak') {
                    // Resume from break
                    const breakDuration = Date.now() - current.breakStart;
                    current.totalBreak += breakDuration;
                    current.lastBreak = breakDuration;
                    current.breakStart = null;
                    current.status = 'onShift';

                    const embed = new EmbedBuilder()
                        .setAuthor({ name: `Shift Management | ${current.shiftType}`, iconURL: interaction.user.displayAvatarURL() })
                        .setTitle('Break Ended')
                        .addFields({
                            name: 'Current Shift',
                            value: `**Status:** On Shift\n**Started:** <t:${Math.floor(current.startTime / 1000)}:R>\n**Total Break Time:** ${formatDuration(current.totalBreak / 1000)}\n**Last Break Time:** ${formatDuration(current.lastBreak / 1000)}`
                        });

                    const buttons = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('start_shift').setLabel('Start').setStyle(ButtonStyle.Primary).setDisabled(true),
                        new ButtonBuilder().setCustomId('pause_shift').setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(false),
                        new ButtonBuilder().setCustomId('end_shift').setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(false)
                    );

                    await interaction.update({ embeds: [embed], components: [buttons] });
                    saveShiftData();
                }
            }

            if (interaction.customId === 'pause_shift' && current.status === 'onShift') {
                current.breakStart = Date.now();
                current.status = 'onBreak';

                const embed = new EmbedBuilder()
                    .setAuthor({ name: `Shift Management | ${current.shiftType}`, iconURL: interaction.user.displayAvatarURL() })
                    .setTitle('Break Started')
                    .addFields({
                        name: 'Current Shift',
                        value: `**Status:** On Break\n**Shift Started:** <t:${Math.floor(current.startTime / 1000)}:R>\n**Break Started:** <t:${Math.floor(current.breakStart / 1000)}:R>`
                    });

                const buttons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('start_shift').setLabel('Start').setStyle(ButtonStyle.Primary).setDisabled(true),
                    new ButtonBuilder().setCustomId('pause_shift').setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId('end_shift').setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(true)
                );

                await interaction.update({ embeds: [embed], components: [buttons] });
                saveShiftData();
            }

            if (interaction.customId === 'end_shift' && (current.status === 'onShift' || current.status === 'onBreak')) {
                const shiftEndTime = Date.now();
                let totalShiftDuration = shiftEndTime - current.startTime - current.totalBreak;

                shiftData[userId].shiftCount += 1;
                shiftData[userId].totalDuration += totalShiftDuration;
                shiftData[userId].averageDuration = shiftData[userId].totalDuration / shiftData[userId].shiftCount;
                shiftData[userId].lastShift = {
                    status: current.status === 'onBreak' ? 'On Break' : 'On Shift',
                    totalTime: totalShiftDuration
                };

                const embed = new EmbedBuilder()
                    .setAuthor({ name: `Shift Management | ${current.shiftType}`, iconURL: interaction.user.displayAvatarURL() })
                    .setTitle('All Time Information')
                    .addFields(
                        { name: 'Shift Count', value: `${shiftData[userId].shiftCount}`, inline: true },
                        { name: 'Total Duration', value: formatDuration(shiftData[userId].totalDuration / 1000), inline: true },
                        { name: 'Average Duration', value: formatDuration(shiftData[userId].averageDuration / 1000), inline: true }
                    )
                    .addFields({
                        name: 'Last Shift',
                        value: `**Status:** ${shiftData[userId].lastShift.status}\n**Total Time:** ${formatDuration(shiftData[userId].lastShift.totalTime / 1000)}`
                    });

                const buttons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('start_shift').setLabel('Start').setStyle(ButtonStyle.Primary).setDisabled(false),
                    new ButtonBuilder().setCustomId('pause_shift').setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId('end_shift').setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(true)
                );

                delete shiftData[userId].current;
                await interaction.update({ embeds: [embed], components: [buttons] });
                saveShiftData();
            }
        }
    });
}

module.exports = { registerShiftManageCommand, registerShiftManageHandlers };
