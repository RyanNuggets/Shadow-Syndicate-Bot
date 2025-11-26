// shiftmanage.js
// Place this at: /Features/ShiftManagement/shiftmanage.js
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Determine paths for configuration and data files relative to the project root.
const CONFIG_PATH = path.resolve(__dirname, '../../config.json'); 
const DATA_PATH = path.resolve(__dirname, '../../shiftdata.json'); 

// --- helpers for config & data ---

/**
 * Loads and parses the configuration file.
 * @returns {object} The parsed configuration object.
 * @throws {Error} If the file is missing or contains invalid JSON.
 */
function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.error(`ERROR: config.json not found at expected path: ${CONFIG_PATH}`);
        throw new Error('config.json is missing or inaccessible.');
    }
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
        console.error('ERROR: config.json is invalid JSON or could not be read.', e);
        throw new Error('config.json is invalid.');
    }
}

/**
 * Ensures the shiftdata.json file exists, creating it if necessary.
 */
function ensureData() {
    if (!fs.existsSync(DATA_PATH)) {
        const initial = { activeShifts: [], userStats: {} };
        fs.writeFileSync(DATA_PATH, JSON.stringify(initial, null, 2));
    }
}

/**
 * Reads and parses the shift data file.
 * @returns {object} The parsed shift data object.
 */
function readData() {
    ensureData();
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

/**
 * Writes the provided data object back to the shift data file.
 * @param {object} data - The data object to write.
 */
function writeData(data) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

/**
 * Adds a new shift object to the active shifts array.
 * @param {object} shiftObj - The new shift object.
 */
function addShiftObj(shiftObj) {
    const d = readData();
    d.activeShifts.push(shiftObj);
    writeData(d);
}

/**
 * Updates an existing shift object by merging a patch object.
 * @param {string} shiftId - The ID of the shift to update.
 * @param {object} patch - The properties to update.
 * @returns {object|null} The updated shift object or null if not found.
 */
function updateShiftObj(shiftId, patch) {
    const d = readData();
    const idx = d.activeShifts.findIndex(s => s.shiftId === shiftId);
    if (idx === -1) return null;
    d.activeShifts[idx] = Object.assign({}, d.activeShifts[idx], patch);
    writeData(d);
    return d.activeShifts[idx];
}

/**
 * Removes a shift object from the active shifts array.
 * @param {string} shiftId - The ID of the shift to remove.
 * @returns {object|null} The removed shift object or null if not found.
 */
function removeShiftObj(shiftId) {
    const d = readData();
    const found = d.activeShifts.find(s => s.shiftId === shiftId) || null;
    d.activeShifts = d.activeShifts.filter(s => s.shiftId !== shiftId);
    writeData(d);
    return found;
}

/**
 * Retrieves a single active shift object by ID.
 * @param {string} shiftId - The ID of the shift.
 * @returns {object|null} The shift object or null if not found.
 */
function getShiftObj(shiftId) {
    const d = readData();
    return d.activeShifts.find(s => s.shiftId === shiftId) || null;
}

/**
 * Gets the cumulative stats for a user and shift type.
 * @param {string} userId - The Discord user ID.
 * @param {string} typeId - The shift type ID.
 * @returns {object} Stats object with count and totalTimeMs.
 */
function getUserStats(userId, typeId) {
    const d = readData();
    d.userStats = d.userStats || {};
    const byUser = d.userStats[userId] || {};
    return byUser[typeId] || { count: 0, totalTimeMs: 0 };
}

/**
 * Updates the cumulative stats for a user and shift type after a shift ends.
 * @param {string} userId - The Discord user ID.
 * @param {string} typeId - The shift type ID.
 * @param {number} addMs - The net duration in milliseconds to add.
 * @returns {object} The updated stats object.
 */
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

/**
 * Formats a duration in milliseconds into a readable 'Hh Mm Ss' string.
 * @param {number} ms - Duration in milliseconds.
 * @returns {string} Formatted duration string.
 */
function formatDuration(ms) {
    if (ms === 0) return '0s';
    let s = Math.floor(ms / 1000);
    const hours = Math.floor(s / 3600);
    s -= hours * 3600;
    const mins = Math.floor(s / 60);
    const secs = s - mins * 60;

    const parts = [];
    if (hours) parts.push(`${hours}h`);
    if (mins) parts.push(`${mins}m`);
    // Include seconds only if there are no hours/minutes, or if secs > 0
    if (secs || parts.length === 0) parts.push(`${secs}s`);
    
    return parts.join(' ');
}

/**
 * Parses the custom ID from a button interaction.
 * Format: "shift_<shiftId>_<action>_<typeId>"
 * @param {string} customId - The raw custom ID string.
 * @returns {object|null} Object containing shiftId, action, and typeId, or null if invalid.
 */
function parseCustomId(customId) {
    if (!customId || !customId.startsWith('shift_')) return null;
    const parts = customId.split('_');
    // Ensure we have at least 'shift', 'id', 'action', and 'type' (which might contain underscores)
    if (parts.length < 4) return null;

    const shiftId = parts[1];
    const action = parts[2];
    const typeId = parts.slice(3).join('_'); // Rejoin anything after action as typeId
    
    return { shiftId, action, typeId };
}

/**
 * Registers the /shift manage slash command to the Discord Guild.
 * @param {object} client - The Discord client instance.
 * @param {object} config - The configuration object.
 */
async function registerShiftManageCommand(client, config) {
    const guildId = config.GUILD_ID;
    if (!guildId) {
        console.error("Missing GUILD_ID in config.json for shift command registration.");
        return;
    }
    
    if (module.exports.data) {
        await client.guilds.cache.get(guildId)?.commands.create(module.exports.data);
        console.log(`✅ Successfully registered /${module.exports.data.name} command to guild: ${guildId}.`);
    }
}

/**
 * Sets up the interaction listener to handle shift buttons.
 * @param {object} client - The Discord client instance.
 */
function registerShiftManageHandlers(client) {
    client.on('interactionCreate', interaction => {
        // Delegate button interactions starting with 'shift_' to the exported handler
        if (interaction.isButton() && interaction.customId.startsWith('shift_')) {
            module.exports.handleInteraction(interaction).catch(err => {
                console.error('Error handling shift button interaction:', err);
                if (!interaction.replied && !interaction.deferred) {
                    interaction.reply({ content: 'An internal error occurred while processing your shift action.', ephemeral: true }).catch(()=>{});
                }
            });
        }
    });
}

// --- Slash command export definition ---

// Load config early to populate dynamic choices for the command option.
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
                    
                    // Populate choices from config.json SHIFT_TYPES
                    if (config && Array.isArray(config.SHIFT_TYPES)) {
                        optBuilder.addChoices(...config.SHIFT_TYPES.map(t => ({ name: t.name, value: t.id })));
                    } else {
                        // Fallback choice if config load or SHIFT_TYPES array failed
                        optBuilder.addChoices({ name: 'Config Error - Check SHIFT_TYPES', value: 'error' });
                        console.warn('WARNING: SHIFT_TYPES missing or invalid in config.json during command registration.');
                    }
                    return optBuilder;
                })
        ),

    /**
     * Executes the /shift manage command, creating the initial shift tracking message.
     * @param {object} interaction - The Discord interaction object.
     */
    async execute(interaction) {
        // Acknowledge the interaction immediately to prevent the "Application did not run" error.
        await interaction.deferReply({ ephemeral: true }); 
        
        try {
            const cfg = loadConfig(); 
            
            // Authorization check (using SHIFT_ROLE_REQUIRED from config)
            const requiredRole = cfg.SHIFT_ROLE_REQUIRED || null;
            if (requiredRole && !interaction.member.roles.cache.has(requiredRole)) {
                return interaction.editReply({ content: '❌ You do not have permission to use this.', ephemeral: true });
            }

            const typeId = interaction.options.getString('type');

            if (typeId === 'error') {
                return interaction.editReply({ content: '❌ Configuration Error: Please check your `config.json` file for the `SHIFT_TYPES` array.', ephemeral: true });
            }

            // Find the shift type name for display purposes
            const typeObj = (cfg.SHIFT_TYPES || []).find(t => t.id === typeId) || { id: typeId, name: typeId };

            // 1. Build the All Time Information embed
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

            // 2. Build Buttons: Start enabled, Pause/End disabled initially
            const shiftId = randomUUID();
            const startId = `shift_${shiftId}_start_${typeId}`;
            const pauseId = `shift_${shiftId}_pause_${typeId}`;
            const endId = `shift_${shiftId}_end_${typeId}`;

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(startId).setLabel('Start').setStyle(ButtonStyle.Success).setDisabled(false),
                new ButtonBuilder().setCustomId(pauseId).setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId(endId).setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );

            // 3. Create placeholder shift object (status: idle)
            const placeholder = {
                shiftId,
                userId: interaction.user.id,
                typeId,
                typeName: typeObj.name,
                status: 'idle', // idle -> onShift -> onBreak -> ended
                startTime: null,
                endTime: null,
                breaks: [],
                currentBreakStart: null,
                messageId: null, // Will be updated after message is sent
                channelId: interaction.channelId,
                createdAt: Date.now()
            };
            addShiftObj(placeholder);

            // 4. Send the message and get its ID
            const msg = await interaction.editReply({ embeds: [embed], components: [row], ephemeral: false });

            // 5. Update shift object with the messageId for future reference
            updateShiftObj(shiftId, { messageId: msg.id });

        } catch (err) {
            console.error('shiftmanage.execute error:', err);
            // Must use editReply since we deferred earlier
            interaction.editReply({ content: '❌ An internal error occurred during command execution. Check console logs for configuration errors.', ephemeral: true }).catch(()=>{});
        }
    },

    /**
     * Handles button interactions for starting, pausing/resuming, and ending shifts.
     * @param {object} interaction - The Discord button interaction object.
     */
    async handleInteraction(interaction) {
        try {
            if (!interaction.isButton()) return;

            // Acknowledge the interaction immediately
            await interaction.deferUpdate(); 

            const parsed = parseCustomId(interaction.customId);
            if (!parsed) return;
            
            const { shiftId, action, typeId } = parsed;
            const shift = getShiftObj(shiftId);

            if (!shift) {
                // Shift data is missing (e.g., deleted from file). Clean up the message.
                const cleanupRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('deleted_shift_stub').setLabel('Shift Ended/Not Found').setStyle(ButtonStyle.Danger).setDisabled(true)
                );
                await interaction.editReply({ components: [cleanupRow] }).catch(()=>{});
                return;
            }

            // Authorization: only the shift owner can control it
            if (interaction.user.id !== shift.userId) {
                return interaction.followUp({ content: 'You are not allowed to control this shift.', ephemeral: true });
            }

            const cfg = loadConfig();
            const shiftType = (cfg.SHIFT_TYPES || []).find(t => t.id === typeId) || { id: typeId, name: typeId };

            // --- START action (Also handles RESUME) ---
            if (action === 'start') {
                // Case 1: idle -> start shift
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

                    await interaction.editReply({ embeds: [embed], components: [row] });

                    // Log start
                    if (cfg.SHIFT_LOG_CHANNEL) {
                        const ch = interaction.client.channels.cache.get(cfg.SHIFT_LOG_CHANNEL);
                        if (ch) {
                            const log = new EmbedBuilder()
                                .setTitle('🟢 Shift Started')
                                .addFields(
                                    { name: 'User', value: `<@${interaction.user.id}>` },
                                    { name: 'Type', value: shiftType.name },
                                    { name: 'At', value: `<t:${Math.floor(startTime/1000)}:F>` }
                                )
                                .setColor('Green');
                            ch.send({ embeds: [log] }).catch(()=>{});
                        }
                    }
                    return;
                }

                // Case 2: onBreak -> resume shift
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
                        .setDescription(`Last break duration: **${formatDuration(lastBreakMs)}**`)
                        .addFields(
                            { name: '**Current Shift**', value: '\u200b' },
                            { name: '**Status:**', value: 'On Shift', inline: true },
                            { name: '**Started:**', value: `<t:${Math.floor(shift.startTime/1000)}:R>`, inline: true },
                            { name: '**Total Break Time:**', value: `${formatDuration(totalBreakMs)}`, inline: false }
                        )
                        .setColor('Green');

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`shift_${shiftId}_start_${typeId}`).setLabel('Start').setStyle(ButtonStyle.Success).setDisabled(true),
                        new ButtonBuilder().setCustomId(`shift_${shiftId}_pause_${typeId}`).setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(false),
                        new ButtonBuilder().setCustomId(`shift_${shiftId}_end_${typeId}`).setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(false)
                    );

                    await interaction.editReply({ embeds: [embed], components: [row] });
                    return;
                }
                await interaction.followUp({ content: 'Cannot start at this time.', ephemeral: true });
                return;
            }

            // --- PAUSE action ---
            if (action === 'pause') {
                // Case 1: onShift -> pause shift
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
                        .setColor('#99AAB5'); // Grey for break state

                    const row = new ActionRowBuilder().addComponents(
                        // The 'start' button becomes the 'Resume' button
                        new ButtonBuilder().setCustomId(`shift_${shiftId}_start_${typeId}`).setLabel('Resume').setStyle(ButtonStyle.Primary).setDisabled(false),
                        new ButtonBuilder().setCustomId(`shift_${shiftId}_pause_${typeId}`).setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(true),
                        new ButtonBuilder().setCustomId(`shift_${shiftId}_end_${typeId}`).setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(false)
                    );

                    await interaction.editReply({ embeds: [embed], components: [row] });
                    return;
                }
                
                // Case 2: already onBreak
                if (shift.status === 'onBreak') {
                    return interaction.followUp({ content: 'You are already on break. Click "Resume" to continue.', ephemeral: true });
                }

                await interaction.followUp({ content: 'You cannot pause at this time.', ephemeral: true });
                return;
            }

            // --- END action ---
            if (action === 'end') {
                // Case 1: idle -> Cancel shift
                if (shift.status === 'idle') {
                    removeShiftObj(shiftId);
                    
                    const stats = getUserStats(shift.userId, shift.typeId);
                    const count = stats.count || 0;
                    const totalTime = stats.totalTimeMs || 0;
                    const avg = count > 0 ? Math.round(totalTime / count) : 0;

                    // All Time Stats (resetting the tracking embed context)
                    const embedAll = new EmbedBuilder()
                        .setAuthor({ name: `Shift Management | ${shift.typeName}`, iconURL: interaction.user.displayAvatarURL({ forceStatic: false }) })
                        .setTitle('All Time Information')
                        .addFields(
                            { name: '**Shift Count:**', value: `${count}`, inline: true },
                            { name: '**Total Duration:**', value: `${formatDuration(totalTime)}`, inline: true },
                            { name: '**Average Duration:**', value: `${formatDuration(avg)}`, inline: true }
                        )
                        .setColor('#5865F2');

                    // Last Shift Summary (Cancellation)
                    const embedLast = new EmbedBuilder()
                        .setTitle('Last Shift Summary')
                        .addFields(
                            { name: 'Shift Status', value: 'Cancelled (Idle)' },
                            { name: 'Duration', value: '0s' },
                            { name: 'Breaks', value: '0s' }
                        )
                        .setColor('Red');

                    // Set up new placeholder for next shift cycle
                    const newShiftId = randomUUID();
                    const newRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`shift_${newShiftId}_start_${typeId}`).setLabel('Start').setStyle(ButtonStyle.Success).setDisabled(false),
                        new ButtonBuilder().setCustomId(`shift_${newShiftId}_pause_${typeId}`).setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(true),
                        new ButtonBuilder().setCustomId(`shift_${newShiftId}_end_${typeId}`).setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(true)
                    );
                    
                    const newPlaceholder = {
                        shiftId: newShiftId,
                        userId: interaction.user.id,
                        typeId,
                        typeName: shift.typeName,
                        status: 'idle', 
                        startTime: null,
                        endTime: null,
                        breaks: [],
                        currentBreakStart: null,
                        messageId: interaction.message.id,
                        channelId: interaction.channelId,
                        createdAt: Date.now()
                    };
                    addShiftObj(newPlaceholder);

                    await interaction.editReply({ embeds: [embedAll, embedLast], components: [newRow] });
                    return;
                }

                // Case 2: onShift or onBreak -> Finalize shift
                if (shift.status === 'onShift' || shift.status === 'onBreak') {
                    const endTime = Date.now();
                    let { breaks, currentBreakStart } = shift;

                    // If ending while on break, close the final break
                    if (shift.status === 'onBreak' && currentBreakStart) {
                        const breakEnd = endTime;
                        breaks = (breaks || []).concat([{ start: currentBreakStart, end: breakEnd }]);
                        currentBreakStart = null;
                    }

                    // Calculate total durations
                    const totalBreakMs = breaks.reduce((s,b) => s + (b.end - b.start), 0);
                    const rawDurationMs = endTime - shift.startTime;
                    const netDurationMs = rawDurationMs - totalBreakMs;

                    // Persist final metrics and status
                    updateShiftObj(shiftId, { 
                        status: 'ended', 
                        endTime, 
                        breaks, 
                        currentBreakStart: null,
                        rawDurationMs,
                        netDurationMs,
                        totalBreakMs
                    });

                    // Update user stats with the net duration
                    updateUserStats(shift.userId, shift.typeId, netDurationMs);
                    
                    // Fetch updated total stats
                    const stats = getUserStats(shift.userId, shift.typeId);
                    const count = stats.count || 0;
                    const totalTime = stats.totalTimeMs || 0;
                    const avg = count > 0 ? Math.round(totalTime / count) : 0;
                    
                    // All Time Information embed
                    const embedAll = new EmbedBuilder()
                        .setAuthor({ name: `Shift Management | ${shift.typeName}`, iconURL: interaction.user.displayAvatarURL({ forceStatic: false }) })
                        .setTitle('All Time Information')
                        .addFields(
                            { name: '**Shift Count:**', value: `${count}`, inline: true },
                            { name: '**Total Duration:**', value: `${formatDuration(totalTime)}`, inline: true },
                            { name: '**Average Duration:**', value: `${formatDuration(avg)}`, inline: true }
                        )
                        .setColor('#5865F2');

                    // Last Shift Summary embed
                    const embedLast = new EmbedBuilder()
                        .setTitle('Last Shift Summary')
                        .addFields(
                            { name: 'Shift Status', value: 'Ended' },
                            { name: 'Net Duration', value: formatDuration(netDurationMs), inline: true },
                            { name: 'Total Breaks', value: formatDuration(totalBreakMs), inline: true },
                            { name: 'Started At', value: `<t:${Math.floor(shift.startTime/1000)}:F>`, inline: false },
                            { name: 'Ended At', value: `<t:${Math.floor(endTime/1000)}:F>`, inline: false }
                        )
                        .setColor('Red');

                    // Set up new placeholder for next shift cycle
                    const newShiftId = randomUUID();
                    const newRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`shift_${newShiftId}_start_${typeId}`).setLabel('Start').setStyle(ButtonStyle.Success).setDisabled(false),
                        new ButtonBuilder().setCustomId(`shift_${newShiftId}_pause_${typeId}`).setLabel('Pause').setStyle(ButtonStyle.Secondary).setDisabled(true),
                        new ButtonBuilder().setCustomId(`shift_${newShiftId}_end_${typeId}`).setLabel('End').setStyle(ButtonStyle.Secondary).setDisabled(true)
                    );
                    
                    const newPlaceholder = {
                        shiftId: newShiftId,
                        userId: interaction.user.id,
                        typeId,
                        typeName: shift.typeName,
                        status: 'idle', 
                        startTime: null,
                        endTime: null,
                        breaks: [],
                        currentBreakStart: null,
                        messageId: interaction.message.id,
                        channelId: interaction.channelId,
                        createdAt: Date.now()
                    };
                    addShiftObj(newPlaceholder);

                    await interaction.editReply({ embeds: [embedAll, embedLast], components: [newRow] });

                    // Send final log if configured
                    if (cfg.SHIFT_LOG_CHANNEL) {
                        const ch = interaction.client.channels.cache.get(cfg.SHIFT_LOG_CHANNEL);
                        if (ch) {
                            const log = new EmbedBuilder()
                                .setTitle('🛑 Shift Ended')
                                .addFields(
                                    { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
                                    { name: 'Type', value: shift.typeName, inline: true },
                                    { name: 'Net Duration', value: formatDuration(netDurationMs), inline: true },
                                    { name: 'Total Breaks', value: formatDuration(totalBreakMs), inline: true },
                                    { name: 'Started At', value: `<t:${Math.floor(shift.startTime/1000)}:F>` },
                                    { name: 'Ended At', value: `<t:${Math.floor(endTime/1000)}:F>` }
                                )
                                .setColor('Red');
                            ch.send({ embeds: [log] }).catch(()=>{});
                        }
                    }
                    return;
                }

                await interaction.followUp({ content: 'Cannot end the shift at this time.', ephemeral: true });
                return;
            }

            return interaction.followUp({ content: 'Invalid shift action.', ephemeral: true });

        } catch (err) {
            console.error('shiftmanage.handleInteraction error:', err);
            // If the deferred update failed, send a followUp message
            interaction.followUp({ content: 'An unexpected error occurred during the shift action.', ephemeral: true }).catch(()=>{});
        }
    },

    registerShiftManageCommand, 
    registerShiftManageHandlers 
};
