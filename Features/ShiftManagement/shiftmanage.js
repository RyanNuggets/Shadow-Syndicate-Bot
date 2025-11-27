const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Path to store shift data
const SHIFT_DATA_PATH = path.join(__dirname, 'shift_data.json');

// Initialize shift data file if it doesn't exist
function initShiftData() {
    if (!fs.existsSync(SHIFT_DATA_PATH)) {
        fs.writeFileSync(SHIFT_DATA_PATH, JSON.stringify({}));
    }
}

// Load shift data from file
function loadShiftData() {
    try {
        const data = fs.readFileSync(SHIFT_DATA_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading shift data:', error);
        return {};
    }
}

// Save shift data to file
function saveShiftData(data) {
    try {
        fs.writeFileSync(SHIFT_DATA_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving shift data:', error);
    }
}

// Get user shift data
function getUserShiftData(userId, shiftType) {
    const allData = loadShiftData();
    const userKey = `${userId}_${shiftType}`;
    
    if (!allData[userKey]) {
        allData[userKey] = {
            shiftCount: 0,
            totalDuration: 0,
            currentShift: null,
            breaks: []
        };
        saveShiftData(allData);
    }
    
    return allData[userKey];
}

// Update user shift data
function updateUserShiftData(userId, shiftType, newData) {
    const allData = loadShiftData();
    const userKey = `${userId}_${shiftType}`;
    allData[userKey] = newData;
    saveShiftData(allData);
}

// Format duration in a readable format
function formatDuration(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    } else {
        return `${seconds}s`;
    }
}

// Create embed for different shift states
function createShiftEmbed(user, shiftType, shiftData, state = 'initial') {
    const embed = new EmbedBuilder()
        .setAuthor({ 
            name: `Shift Management | ${shiftType}`, 
            iconURL: user.displayAvatarURL() 
        })
        .setColor('#0099ff');

    switch (state) {
        case 'initial':
            embed.setTitle('All Time Information')
                .setDescription([
                    `**Shift Count:** ${shiftData.shiftCount}`,
                    `**Total Duration:** ${formatDuration(shiftData.totalDuration)}`,
                    `**Average Duration:** ${shiftData.shiftCount > 0 ? formatDuration(shiftData.totalDuration / shiftData.shiftCount) : '0s'}`
                ].join('\n'));
            break;

        case 'started':
            embed.setTitle('Shift Started')
                .setDescription([
                    `**Current Shift**`,
                    `**Status:** On Shift`,
                    `**Started:** <t:${Math.floor(shiftData.currentShift.startTime / 1000)}:R>`
                ].join('\n'));
            break;

        case 'paused':
            const lastBreak = shiftData.breaks[shiftData.breaks.length - 1];
            embed.setTitle('Break Started')
                .setDescription([
                    `**Current Shift**`,
                    `**Status:** On Break`,
                    `**Shift Started:** <t:${Math.floor(shiftData.currentShift.startTime / 1000)}:R>`,
                    `**Break Started:** <t:${Math.floor(lastBreak.startTime / 1000)}:R>`
                ].join('\n'));
            break;

        case 'resumed':
            const totalBreakTime = shiftData.breaks.reduce((total, breakPeriod) => {
                return total + (breakPeriod.endTime ? (breakPeriod.endTime - breakPeriod.startTime) : 0);
            }, 0);
            const lastBreakTime = shiftData.breaks.length > 0 ? 
                shiftData.breaks[shiftData.breaks.length - 1].endTime - shiftData.breaks[shiftData.breaks.length - 1].startTime : 0;
            
            embed.setTitle('Break Ended')
                .setDescription([
                    `**Current Shift**`,
                    `**Status:** On Shift`,
                    `**Started:** <t:${Math.floor(shiftData.currentShift.startTime / 1000)}:R>`,
                    `**Total Break Time:** ${formatDuration(totalBreakTime)}`,
                    `**Last Break Time:** ${formatDuration(lastBreakTime)}`
                ].join('\n'));
            break;

        case 'ended':
            const lastShiftDuration = shiftData.currentShift ? shiftData.currentShift.totalDuration : 0;
            embed.setTitle('All Time Information')
                .setDescription([
                    `**Shift Count:** ${shiftData.shiftCount}`,
                    `**Total Duration:** ${formatDuration(shiftData.totalDuration)}`,
                    `**Average Duration:** ${shiftData.shiftCount > 0 ? formatDuration(shiftData.totalDuration / shiftData.shiftCount) : '0s'}`,
                    ``,
                    `**Last Shift**`,
                    `**Status:** Ended`,
                    `**Total Time:** ${formatDuration(lastShiftDuration)}`
                ].join('\n'));
            break;
    }

    return embed;
}

// Create action row with buttons
function createActionRow(state = 'initial') {
    const startButton = new ButtonBuilder()
        .setCustomId('shift_start')
        .setLabel('Start')
        .setStyle(ButtonStyle.Success);

    const pauseButton = new ButtonBuilder()
        .setCustomId('shift_pause')
        .setLabel('Pause')
        .setStyle(ButtonStyle.Primary);

    const endButton = new ButtonBuilder()
        .setCustomId('shift_end')
        .setLabel('End')
        .setStyle(ButtonStyle.Danger);

    switch (state) {
        case 'initial':
        case 'ended':
            startButton.setDisabled(false);
            pauseButton.setDisabled(true);
            endButton.setDisabled(true);
            break;
        case 'started':
        case 'resumed':
            startButton.setDisabled(true);
            pauseButton.setDisabled(false);
            endButton.setDisabled(false);
            break;
        case 'paused':
            startButton.setDisabled(false); // Resume button
            pauseButton.setDisabled(true);
            endButton.setDisabled(true);
            break;
    }

    return new ActionRowBuilder().addComponents(startButton, pauseButton, endButton);
}

// Log shift action to specified channel
async function logShiftAction(client, config, user, shiftType, action, details = '') {
    try {
        const logChannel = await client.channels.fetch(config.SHIFT_MANAGEMENT.LOG_CHANNEL);
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: user.displayName || user.username, 
                    iconURL: user.displayAvatarURL() 
                })
                .setTitle(`Shift ${action}`)
                .setDescription(`**Type:** ${shiftType}\n${details}`)
                .setTimestamp()
                .setColor(action === 'Started' ? '#00ff00' : '#ff0000');

            await logChannel.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Error logging shift action:', error);
    }
}

// Register the slash command
async function registerShiftManageCommand(client, config) {
    initShiftData();

    const rest = require('@discordjs/rest');
    const { Routes } = require('discord-api-types/v9');
    const restClient = new rest.REST({ version: '9' }).setToken(process.env.DISCORD_TOKEN);

    // Create choices for shift types
    const shiftTypeChoices = config.SHIFT_MANAGEMENT.SHIFT_TYPES.map(type => ({
        name: `${type.name} (${type.duration} min)`,
        value: type.name
    }));

    const command = new SlashCommandBuilder()
        .setName('shift')
        .setDescription('Manage your shifts')
        .addSubcommand(subcommand =>
            subcommand
                .setName('manage')
                .setDescription('Manage your shift time')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Select shift type')
                        .setRequired(true)
                        .addChoices(...shiftTypeChoices)
                )
        );

    try {
        await restClient.put(
            Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.GUILD_ID),
            { body: [command.toJSON()] }
        );
        console.log('✅ Shift management command registered successfully');
    } catch (error) {
        console.error('❌ Error registering shift management command:', error);
    }
}

// Handle slash command interactions
async function handleShiftCommand(interaction, config) {
    if (!interaction.isCommand() || interaction.commandName !== 'shift') return;

    await interaction.deferReply({ ephemeral: true });

    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'manage') {
        const shiftType = interaction.options.getString('type');
        const user = interaction.user;
        
        // Check if user has required role
        const shiftConfig = config.SHIFT_MANAGEMENT.SHIFT_TYPES.find(type => type.name === shiftType);
        if (!shiftConfig) {
            return interaction.editReply({ content: 'Invalid shift type selected.' });
        }

        // Check role permissions
        const member = await interaction.guild.members.fetch(user.id);
        if (!member.roles.cache.has(shiftConfig.requiredRole)) {
            return interaction.editReply({ content: 'You do not have permission to manage this shift type.' });
        }

        const shiftData = getUserShiftData(user.id, shiftType);
        const embed = createShiftEmbed(user, shiftType, shiftData, 'initial');
        const actionRow = createActionRow('initial');

        await interaction.editReply({
            embeds: [embed],
            components: [actionRow]
        });
    }
}

// Handle button interactions
async function handleShiftButtons(interaction, config, client) {
    if (!interaction.isButton()) return;

    const buttonId = interaction.customId;
    if (!['shift_start', 'shift_pause', 'shift_end'].includes(buttonId)) return;

    await interaction.deferUpdate();

    const user = interaction.user;
    const embed = interaction.message.embeds[0];
    
    // Extract shift type from embed author
    const shiftType = embed.author.name.split(' | ')[1];
    
    if (!shiftType) {
        return interaction.followUp({ content: 'Error: Could not determine shift type.', ephemeral: true });
    }

    let shiftData = getUserShiftData(user.id, shiftType);

    switch (buttonId) {
        case 'shift_start':
            if (shiftData.currentShift && shiftData.breaks.length > 0 && !shiftData.breaks[shiftData.breaks.length - 1].endTime) {
                // Resume from break
                const lastBreak = shiftData.breaks[shiftData.breaks.length - 1];
                lastBreak.endTime = Date.now();
                updateUserShiftData(user.id, shiftType, shiftData);
                
                const resumeEmbed = createShiftEmbed(user, shiftType, shiftData, 'resumed');
                const resumeActionRow = createActionRow('resumed');
                
                await interaction.editReply({
                    embeds: [resumeEmbed],
                    components: [resumeActionRow]
                });
            } else {
                // Start new shift
                shiftData.currentShift = {
                    startTime: Date.now(),
                    totalDuration: 0
                };
                shiftData.breaks = [];
                updateUserShiftData(user.id, shiftType, shiftData);
                
                const startEmbed = createShiftEmbed(user, shiftType, shiftData, 'started');
                const startActionRow = createActionRow('started');
                
                await interaction.editReply({
                    embeds: [startEmbed],
                    components: [startActionRow]
                });

                // Log shift start
                await logShiftAction(client, config, user, shiftType, 'Started');
            }
            break;

        case 'shift_pause':
            if (shiftData.currentShift) {
                shiftData.breaks.push({
                    startTime: Date.now(),
                    endTime: null
                });
                updateUserShiftData(user.id, shiftType, shiftData);
                
                const pauseEmbed = createShiftEmbed(user, shiftType, shiftData, 'paused');
                const pauseActionRow = createActionRow('paused');
                
                await interaction.editReply({
                    embeds: [pauseEmbed],
                    components: [pauseActionRow]
                });
            }
            break;

        case 'shift_end':
            if (shiftData.currentShift) {
                const currentTime = Date.now();
                const totalBreakTime = shiftData.breaks.reduce((total, breakPeriod) => {
                    return total + (breakPeriod.endTime ? (breakPeriod.endTime - breakPeriod.startTime) : 0);
                }, 0);
                
                const shiftDuration = currentTime - shiftData.currentShift.startTime - totalBreakTime;
                
                shiftData.shiftCount++;
                shiftData.totalDuration += shiftDuration;
                shiftData.currentShift.totalDuration = shiftDuration;
                
                // Save for display
                updateUserShiftData(user.id, shiftType, shiftData);
                
                const endEmbed = createShiftEmbed(user, shiftType, shiftData, 'ended');
                const endActionRow = createActionRow('ended');
                
                await interaction.editReply({
                    embeds: [endEmbed],
                    components: [endActionRow]
                });

                // Clear current shift after displaying end summary
                shiftData.currentShift = null;
                shiftData.breaks = [];
                updateUserShiftData(user.id, shiftType, shiftData);

                // Log shift end
                await logShiftAction(client, config, user, shiftType, 'Ended', 
                    `**Duration:** ${formatDuration(shiftDuration)}`);
            }
            break;
    }
}

// Register event handlers
function registerShiftHandlers(client, config) {
    client.on('interactionCreate', async (interaction) => {
        try {
            if (interaction.isCommand()) {
                await handleShiftCommand(interaction, config);
            } else if (interaction.isButton()) {
                await handleShiftButtons(interaction, config, client);
            }
        } catch (error) {
            console.error('Error handling shift interaction:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: 'An error occurred while processing your request.', 
                    ephemeral: true 
                });
            }
        }
    });
}

module.exports = {
    registerShiftManageCommand,
    registerShiftHandlers
};
