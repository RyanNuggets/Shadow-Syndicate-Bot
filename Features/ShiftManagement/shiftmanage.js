const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');

const dataFilePath = path.join(__dirname, 'shiftdata.json');

// Load or initialize shift data
function loadShiftData() {
    if (!fs.existsSync(dataFilePath)) {
        fs.writeFileSync(dataFilePath, JSON.stringify({}));
    }
    return JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
}

function saveShiftData(data) {
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
}

// Helper: format ms to readable string
function formatDuration(ms) {
    let totalSeconds = Math.floor(ms / 1000);
    let minutes = Math.floor(totalSeconds / 60);
    let seconds = totalSeconds % 60;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

// Build the shift embed according to state
function createShiftEmbed(user, shiftType, state, shiftData) {
    let title, description;
    const authorText = `Shift Management | ${shiftType}`;
    const avatarURL = user.displayAvatarURL();

    switch (state) {
        case 'allTime':
            title = 'All Time Information';
            description = `**Shift Count:** ${shiftData.shiftCount || 0}\n**Total Duration:** ${formatDuration(shiftData.totalDuration || 0)}\n**Average Duration:** ${formatDuration(shiftData.averageDuration || 0)}`;
            if (shiftData.lastShift) {
                description += `\n\n**Last Shift**\n**Status:** ${shiftData.lastShift.status}\n**Total Time:** ${formatDuration(shiftData.lastShift.totalTime)}`;
            }
            break;
        case 'started':
            title = 'Shift Started';
            description = `**Current Shift**\n**Status:** On Shift\n**Started:** <t:${Math.floor(shiftData.startTime / 1000)}:R>`;
            break;
        case 'paused':
            title = 'Break Started';
            description = `**Current Shift**\n**Status:** On Break\n**Shift Started:** <t:${Math.floor(shiftData.startTime / 1000)}:R>\n**Break Started:** <t:${Math.floor(shiftData.breakStart / 1000)}:R>`;
            break;
        case 'resumed':
            title = 'Break Ended';
            description = `**Current Shift**\n**Status:** On Shift\n**Started:** <t:${Math.floor(shiftData.startTime / 1000)}:R>\n**Total Break Time:** ${formatDuration(shiftData.totalBreak || 0)}\n**Last Break Time:** ${formatDuration(shiftData.lastBreak || 0)}`;
            break;
        case 'ended':
            title = 'All Time Information';
            description = `**Shift Count:** ${shiftData.shiftCount || 0}\n**Total Duration:** ${formatDuration(shiftData.totalDuration || 0)}\n**Average Duration:** ${formatDuration(shiftData.averageDuration || 0)}`;
            if (shiftData.lastShift) {
                description += `\n\n**Last Shift**\n**Status:** ${shiftData.lastShift.status}\n**Total Time:** ${formatDuration(shiftData.lastShift.totalTime)}`;
            }
            break;
    }

    // Buttons
    const startBtn = new ButtonBuilder()
        .setCustomId('shift_start')
        .setLabel('Start')
        .setStyle(ButtonStyle.Success)
        .setDisabled(state !== 'allTime');

    const pauseBtn = new ButtonBuilder()
        .setCustomId('shift_pause')
        .setLabel('Pause')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(state !== 'started');

    const endBtn = new ButtonBuilder()
        .setCustomId('shift_end')
        .setLabel('End')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(state !== 'started');

    const row = new ActionRowBuilder().addComponents(startBtn, pauseBtn, endBtn);

    const embed = new EmbedBuilder()
        .setAuthor({ name: authorText, iconURL: avatarURL })
        .setTitle(title)
        .setDescription(description)
        .setColor(0x00AE86);

    return { embeds: [embed], components: [row] };
}

// Command registration
async function registerShiftManageCommand(client) {
    const data = new SlashCommandBuilder()
        .setName('shift')
        .setDescription('Manage your shift')
        .addSubcommand(sub => sub
            .setName('manage')
            .setDescription('Open the shift management panel'));

    await client.application.commands.create(data);
}

// Interaction handler
async function registerShiftManageHandlers(client) {
    const shiftData = loadShiftData();

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

        const userId = interaction.user.id;

        // Handle /shift manage command
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'shift' && interaction.options.getSubcommand() === 'manage') {
                const userShift = shiftData[userId] || {};
                const embedMessage = createShiftEmbed(interaction.user, 'Patrol Shift', 'allTime', userShift);
                await interaction.reply({ ...embedMessage, ephemeral: true });
            }
        }

        // Handle button clicks
        if (interaction.isButton()) {
            shiftData[userId] = shiftData[userId] || {};
            const userShift = shiftData[userId];

            switch (interaction.customId) {
                case 'shift_start':
                    userShift.startTime = Date.now();
                    userShift.state = 'started';
                    await interaction.update(createShiftEmbed(interaction.user, 'Patrol Shift', 'started', userShift));
                    break;
                case 'shift_pause':
                    userShift.breakStart = Date.now();
                    userShift.state = 'paused';
                    await interaction.update(createShiftEmbed(interaction.user, 'Patrol Shift', 'paused', userShift));
                    break;
                case 'shift_end':
                    const now = Date.now();
                    const lastShiftTotal = now - (userShift.startTime || now);
                    userShift.shiftCount = (userShift.shiftCount || 0) + 1;
                    userShift.totalDuration = (userShift.totalDuration || 0) + lastShiftTotal;
                    userShift.averageDuration = userShift.totalDuration / userShift.shiftCount;
                    userShift.lastShift = {
                        status: 'Ended',
                        totalTime: lastShiftTotal
                    };
                    userShift.state = 'ended';
                    delete userShift.startTime;
                    delete userShift.breakStart;
                    delete userShift.lastBreak;
                    delete userShift.totalBreak;
                    await interaction.update(createShiftEmbed(interaction.user, 'Patrol Shift', 'ended', userShift));
                    break;
            }

            saveShiftData(shiftData);
        }
    });
}

module.exports = {
    registerShiftManageCommand,
    registerShiftManageHandlers
};
