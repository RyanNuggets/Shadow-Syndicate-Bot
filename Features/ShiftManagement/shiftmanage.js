// shiftmanage.js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'shiftdata.json');

function loadShiftData() {
    if (!fs.existsSync(DATA_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (err) {
        console.error("Failed to load shift data:", err);
        return {};
    }
}

function saveShiftData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
}

function formatDuration(ms) {
    let totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${hours > 0 ? hours + "h " : ""}${minutes > 0 ? minutes + "m " : ""}${seconds}s`;
}

function createShiftEmbed(user, shiftType, title, description) {
    return new EmbedBuilder()
        .setAuthor({ name: `Shift Management | ${shiftType}`, iconURL: user.displayAvatarURL() })
        .setTitle(title)
        .setDescription(description);
}

function createButtons(state) {
    const startBtn = new ButtonBuilder()
        .setCustomId('start')
        .setLabel('Start')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(state === 'started' || state === 'onBreak' || state === 'ended');

    const pauseBtn = new ButtonBuilder()
        .setCustomId('pause')
        .setLabel('Pause')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(state === 'paused' || state === 'notStarted' || state === 'ended');

    const endBtn = new ButtonBuilder()
        .setCustomId('end')
        .setLabel('End')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(state === 'notStarted' || state === 'ended');

    return new ActionRowBuilder().addComponents(startBtn, pauseBtn, endBtn);
}

async function registerShiftManageCommand(client, config) {
    const commandData = new SlashCommandBuilder()
        .setName('shift')
        .setDescription('Manage your shift')
        .addSubcommand(sub =>
            sub.setName('manage')
            .setDescription('Start, pause, resume or end your shift')
            .addStringOption(opt => {
                opt.setName('type').setDescription('Type of shift').setRequired(true);
                // Populate choices from config
                config.SHIFT_TYPES.forEach(t => opt.addChoices({ name: t.name, value: t.id }));
                return opt;
            })
        );

    try {
        await client.application.commands.create(commandData, config.GUILD_ID);
    } catch (err) {
        console.error("Error registering shift command:", err);
    }
}

async function handleInteraction(interaction, config) {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

    const shiftData = loadShiftData();
    const userId = interaction.user.id;
    if (!shiftData[userId]) {
        shiftData[userId] = {
            totalShifts: 0,
            totalDuration: 0,
            averageDuration: 0,
            lastShift: {},
            currentShift: null,
            breaks: []
        };
    }

    let userShift = shiftData[userId];

    const now = Date.now();

    // Button handling
    if (interaction.isButton()) {
        if (!userShift.currentShift) {
            return interaction.reply({ content: "You haven't started a shift yet.", ephemeral: true });
        }

        if (interaction.customId === 'start') {
            if (userShift.currentShift.state === 'paused') {
                const lastBreak = userShift.breaks[userShift.breaks.length - 1];
                lastBreak.end = now;
                userShift.currentShift.state = 'started';
                saveShiftData(shiftData);

                const totalBreak = userShift.breaks.reduce((acc, b) => acc + (b.end - b.start), 0);
                const lastBreakDuration = lastBreak.end - lastBreak.start;

                const embed = createShiftEmbed(
                    interaction.user,
                    userShift.currentShift.type,
                    'Break Ended',
                    `**Current Shift**\n**Status:** On Shift\n**Started:** <t:${Math.floor(userShift.currentShift.start/1000)}:R>\n**Total Break Time:** ${formatDuration(totalBreak)}\n**Last Break Time:** ${formatDuration(lastBreakDuration)}`
                );

                await interaction.update({ embeds: [embed], components: [createButtons('started')] });
            } else {
                return interaction.reply({ content: "Cannot start now.", ephemeral: true });
            }
        } else if (interaction.customId === 'pause') {
            if (userShift.currentShift.state === 'started') {
                userShift.currentShift.state = 'onBreak';
                userShift.breaks.push({ start: now, end: null });
                saveShiftData(shiftData);

                const embed = createShiftEmbed(
                    interaction.user,
                    userShift.currentShift.type,
                    'Break Started',
                    `**Current Shift**\n**Status:** On Break\n**Shift Started:** <t:${Math.floor(userShift.currentShift.start/1000)}:R>\n**Break Started:** <t:${Math.floor(now/1000)}:R>`
                );

                await interaction.update({ embeds: [embed], components: [createButtons('paused')] });
            } else {
                return interaction.reply({ content: "Cannot pause now.", ephemeral: true });
            }
        } else if (interaction.customId === 'end') {
            if (userShift.currentShift.state === 'onBreak') {
                const lastBreak = userShift.breaks[userShift.breaks.length - 1];
                lastBreak.end = now;
            }

            const shiftDuration = now - userShift.currentShift.start - userShift.breaks.reduce((acc, b) => acc + ((b.end||now) - b.start), 0);

            userShift.totalShifts += 1;
            userShift.totalDuration += shiftDuration;
            userShift.averageDuration = userShift.totalDuration / userShift.totalShifts;
            userShift.lastShift = {
                status: userShift.currentShift.state === 'onBreak' ? 'On Break' : 'On Shift',
                totalTime: formatDuration(shiftDuration),
                type: userShift.currentShift.type
            };
            userShift.currentShift = null;
            userShift.breaks = [];
            saveShiftData(shiftData);

            const embed = createShiftEmbed(
                interaction.user,
                'N/A',
                'All Time Information',
                `**Shift Count:** ${userShift.totalShifts}\n**Total Duration:** ${formatDuration(userShift.totalDuration)}\n**Average Duration:** ${formatDuration(userShift.averageDuration)}`
            );

            const lastShiftEmbed = new EmbedBuilder()
                .setAuthor({ name: `Shift Management | ${userShift.lastShift.type}`, iconURL: interaction.user.displayAvatarURL() })
                .setTitle('Last Shift')
                .setDescription(`**Status:** ${userShift.lastShift.status}\n**Total Time:** ${userShift.lastShift.totalTime}`);

            await interaction.update({ embeds: [embed, lastShiftEmbed], components: [createButtons('ended')] });
        }

        return;
    }

    // Slash command handling
    if (interaction.commandName === 'shift' && interaction.options.getSubcommand() === 'manage') {
        const shiftTypeId = interaction.options.getString('type');
        const shiftTypeObj = config.SHIFT_TYPES.find(t => t.id === shiftTypeId);
        const shiftTypeName = shiftTypeObj ? shiftTypeObj.name : shiftTypeId;

        if (userShift.currentShift) {
            return interaction.reply({ content: "You already have a shift in progress.", ephemeral: true });
        }

        userShift.currentShift = { type: shiftTypeName, start: now, state: 'started' };
        userShift.breaks = [];
        saveShiftData(shiftData);

        const embed = createShiftEmbed(
            interaction.user,
            shiftTypeName,
            'Shift Started',
            `**Current Shift**\n**Status:** On Shift\n**Started:** <t:${Math.floor(userShift.currentShift.start/1000)}:R>`
        );

        await interaction.reply({ embeds: [embed], components: [createButtons('started')] });
    }
}

module.exports = {
    registerShiftManageCommand,
    handleInteraction
};
