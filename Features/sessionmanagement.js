const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const config = require('../config.json');

// In-memory state storage. 
// Structure: guildId -> { voters: Set(), pollMessageId: string, startupMessageId: string, shutdownMessageId: string, boostMessageIds: [], sessionLogs: [], managementMessageId: string, managementChannelId: string, hostId: string, startTime: number, status: string, startReason: string }
const sessionState = new Map();

// Helper to get or initialize state
function getOrInitState(guildId) {
    if (!sessionState.has(guildId)) {
        sessionState.set(guildId, {
            voters: new Set(),
            pollMessageId: null,
            startupMessageId: null,
            shutdownMessageId: null,
            boostMessageIds: [],
            sessionLogs: [],
            managementMessageId: null,
            managementChannelId: null,
            hostId: null,
            startTime: null,
            status: 'IDLE',
            startReason: ''
        });
    }
    return sessionState.get(guildId);
}

// Helper for external logging
async function logToChannel(guild, title, description, color) {
    const logChannelId = config.channels.actionLog;
    if (!logChannelId) return;
    
    const channel = guild.channels.cache.get(logChannelId);
    if (channel) {
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setTimestamp();
        await channel.send({ embeds: [embed] }).catch(console.error);
    }
}

// Helper to add internal log and return formatted string
function addSessionLog(state, message) {
    const timestamp = Math.floor(Date.now() / 1000);
    const logEntry = `${config.emojis.arrow} ${message} <t:${timestamp}>.`;
    state.sessionLogs.push(logEntry);
    return state.sessionLogs.join('\n');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('session')
        .setDescription('Manage RP Sessions')
        .addSubcommand(subcommand =>
            subcommand
                .setName('manage')
                .setDescription('Open the session management panel')
        ),

    async execute(interaction) {
        if (interaction.options.getSubcommand() === 'manage') {
            const state = getOrInitState(interaction.guildId);

            const embed = new EmbedBuilder()
                .setTitle(`${config.emojis.crpc} No Active Session`)
                .setDescription('Start a session or create a poll by clicking the buttons below this message')
                .setColor('#2b2d31');

            const row = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('session_manage_menu')
                        .setPlaceholder('Select an option')
                        .addOptions([
                            {
                                label: 'Start Session',
                                value: 'start_session',
                                description: 'Start the session immediately',
                                emoji: '🚀'
                            },
                            {
                                label: 'Create Poll',
                                value: 'create_poll',
                                description: 'Start a vote for a session',
                                emoji: '📊'
                            }
                        ])
                );

            // Fetch reply to get the message ID for future updates
            const response = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
            
            // Store management panel details
            state.managementMessageId = response.id;
            state.managementChannelId = interaction.channelId;
            
            // Ensure status is idle if just opening panel (or preserve if recovering, but here we assume fresh start usually)
            // If there was a previous state (like active session), this command spawns a NEW panel.
            // Ideally, we should sync with current state, but for simplicity we assume this command controls the flow.
        }
    },

    // Unified handler for buttons and dropdowns related to this feature
    async handleInteraction(interaction) {
        const guildId = interaction.guildId;
        const state = getOrInitState(guildId);

        // --- BUTTON HANDLING (VOTING) ---
        if (interaction.isButton()) {
            if (interaction.customId === 'poll_vote_btn') {
                const userId = interaction.user.id;

                // Toggle vote
                if (state.voters.has(userId)) {
                    state.voters.delete(userId);
                    await interaction.deferUpdate();
                } else {
                    state.voters.add(userId);
                    await interaction.deferUpdate();
                }

                // Update Poll Message Button
                const voteCount = state.voters.size;
                const newButton = new ButtonBuilder()
                    .setCustomId('poll_vote_btn')
                    .setLabel(`(${voteCount}) Vote`)
                    .setStyle(ButtonStyle.Primary);

                const actionRow = new ActionRowBuilder().addComponents(newButton);
                await interaction.message.edit({ components: [actionRow] });

                // BUG FIX 1: Update Management Panel Vote Count
                if (state.managementMessageId && state.managementChannelId) {
                    const manageChannel = interaction.guild.channels.cache.get(state.managementChannelId);
                    if (manageChannel) {
                        try {
                            const manageMsg = await manageChannel.messages.fetch(state.managementMessageId);
                            if (manageMsg) {
                                // Reconstruct the Embed
                                const manageEmbed = new EmbedBuilder()
                                    .setTitle(`${config.emojis.crpc} Session Poll in Progress`)
                                    .setDescription(`A session poll was started by <@${state.hostId}> <t:${state.startTime}:R>.`)
                                    .addFields(
                                        { name: '**Votes**', value: `${state.voters.size}`, inline: true },
                                        { name: '**Votes Required**', value: '10', inline: true }
                                    )
                                    .setColor('#e67e22');
                                
                                await manageMsg.edit({ embeds: [manageEmbed] });
                            }
                        } catch (e) { console.error('Failed to update management panel on vote:', e); }
                    }
                }

                // Check for 10 votes trigger
                if (voteCount === 10) {
                    const adminChannel = interaction.guild.channels.cache.get(config.channels.adminNotification);
                    if (adminChannel) {
                        await adminChannel.send({
                            content: `<@&${config.roles.voteReachedPing}> The session poll has reached 10 votes!`
                        });
                    }
                    await logToChannel(interaction.guild, 'Poll Votes Reached', `The poll reached 10 votes.`, '#e67e22');
                }
            }
        }

        // --- DROPDOWN HANDLING ---
        if (interaction.isStringSelectMenu() && interaction.customId === 'session_manage_menu') {
            const selected = interaction.values[0];

            // 1. CREATE POLL
            if (selected === 'create_poll') {
                state.hostId = interaction.user.id;
                state.startTime = Math.floor(Date.now() / 1000);
                state.status = 'POLL';
                state.voters.clear();

                // Send to Poll Channel
                const pollChannel = interaction.guild.channels.cache.get(config.channels.pollAnnouncement);
                if (pollChannel) {
                    const pollEmbed = new EmbedBuilder()
                        .setTitle(`${config.emojis.crpc} Session Poll`)
                        .setDescription(`A session poll was started by <@${state.hostId}>. Vote below to start the session. 10 votes required.`)
                        .setColor('#0099ff');
                    
                    const voteBtn = new ButtonBuilder()
                        .setCustomId('poll_vote_btn')
                        .setLabel('Vote')
                        .setStyle(ButtonStyle.Primary);

                    const pollMsg = await pollChannel.send({
                        content: `<@&${config.roles.pollPing}>`,
                        embeds: [pollEmbed],
                        components: [new ActionRowBuilder().addComponents(voteBtn)]
                    });

                    state.pollMessageId = pollMsg.id;
                }

                // Update Manager Embed
                const manageEmbed = new EmbedBuilder()
                    .setTitle(`${config.emojis.crpc} Session Poll in Progress`)
                    .setDescription(`A session poll was started by <@${state.hostId}> <t:${state.startTime}:R>.`)
                    .addFields(
                        { name: '**Votes**', value: `${state.voters.size}`, inline: true },
                        { name: '**Votes Required**', value: '10', inline: true }
                    )
                    .setColor('#e67e22');

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('session_manage_menu')
                        .setPlaceholder('Select an option')
                        .addOptions([
                            { label: 'Start Session', value: 'start_session', emoji: '🚀' },
                            { label: 'Cancel Poll', value: 'cancel_poll', emoji: '❌' },
                            { label: 'See Voters', value: 'see_voters', emoji: '👀' }
                        ])
                );

                await interaction.update({ embeds: [manageEmbed], components: [row] });
                await logToChannel(interaction.guild, 'Poll Created', `Poll started by <@${state.hostId}>`, '#0099ff');
            }

            // 2. SEE VOTERS
            else if (selected === 'see_voters') {
                const voterList = state.voters.size > 0 
                    ? Array.from(state.voters).map(id => `<@${id}>`).join('\n') 
                    : 'No voters yet.';

                const embed = new EmbedBuilder()
                    .setTitle(`${config.emojis.crpc} ${state.voters.size} Voter(s)`)
                    .setDescription(voterList)
                    .setColor('#2b2d31');

                await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // 3. CANCEL POLL
            else if (selected === 'cancel_poll') {
                // Delete Poll Message
                if (state.pollMessageId) {
                    const pollChannel = interaction.guild.channels.cache.get(config.channels.pollAnnouncement);
                    if (pollChannel) {
                        try {
                            const msg = await pollChannel.messages.fetch(state.pollMessageId);
                            if (msg) await msg.delete();
                        } catch (e) { }
                    }
                }

                // Send Shutdown Message
                const pollChannel = interaction.guild.channels.cache.get(config.channels.pollAnnouncement);
                if (pollChannel) {
                    const ssdMsg = await pollChannel.send({
                        content: `**Server Status**\nThe server is now shutting down. Thank you to everyone who joined and participated in the session! While the server may still be accessible, please be aware that no moderators will be present. We appreciate your time and hope to see you in the next one!`
                    });
                    state.shutdownMessageId = ssdMsg.id; // Store for next session
                }

                // Reset Panel
                const resetEmbed = new EmbedBuilder()
                    .setTitle(`${config.emojis.crpc} No Active Session`)
                    .setDescription('Start a session or create a poll by clicking the buttons below this message')
                    .setColor('#2b2d31');

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('session_manage_menu')
                        .setPlaceholder('Select an option')
                        .addOptions([
                            { label: 'Start Session', value: 'start_session', emoji: '🚀' },
                            { label: 'Create Poll', value: 'create_poll', emoji: '📊' }
                        ])
                );

                // We do NOT delete the entire state here, we just reset session specific info
                // This allows us to keep shutdownMessageId for the next session
                state.status = 'IDLE';
                state.voters.clear();
                state.pollMessageId = null;
                state.startupMessageId = null;
                state.boostMessageIds = [];
                state.sessionLogs = [];
                
                await interaction.update({ embeds: [resetEmbed], components: [row] });
                await logToChannel(interaction.guild, 'Poll Cancelled', `Poll cancelled by <@${interaction.user.id}>`, '#ff0000');
            }

            // 4. START SESSION (From Poll or Direct)
            else if (selected === 'start_session') {
                const wasPoll = state.status === 'POLL';
                const voteCount = state.voters.size;
                state.status = 'ACTIVE';
                state.sessionLogs = []; // Reset logs for new session
                
                if (!wasPoll) {
                    state.hostId = interaction.user.id;
                    state.startTime = Math.floor(Date.now() / 1000);
                    state.voters.clear();
                }

                state.startReason = wasPoll 
                    ? `The session was started after a poll with ${voteCount} votes.` 
                    : `The session was started after a poll with 0 votes.`; 

                const pollChannel = interaction.guild.channels.cache.get(config.channels.pollAnnouncement);
                if (pollChannel) {
                    // BUG FIX 2: Delete previous shutdown message if it exists
                    if (state.shutdownMessageId) {
                        try {
                            const ssdMsg = await pollChannel.messages.fetch(state.shutdownMessageId);
                            if (ssdMsg) await ssdMsg.delete();
                        } catch (e) { }
                        state.shutdownMessageId = null;
                    }

                    // Delete Poll Message if it exists
                    if (state.pollMessageId) {
                        try {
                            const msg = await pollChannel.messages.fetch(state.pollMessageId);
                            if (msg) await msg.delete();
                        } catch (e) { }
                    }

                    // Send Startup Message and save ID
                    const startupMsg = await pollChannel.send({
                        content: `**Server Status**\nA server startup has just been hosted! The server is now open for all players to join. Please ensure you follow all server rules and enjoy the session. Join instantly by [clicking here](https://policeroleplay.community/join/LARPJ) or join by using code "LARPJ".`
                    });
                    state.startupMessageId = startupMsg.id;
                }

                // Log generation
                addSessionLog(state, `Session startup message was posted`);
                if (wasPoll) {
                    addSessionLog(state, `Session was started by <@${state.hostId}> after a poll with ${voteCount} votes`);
                } else {
                    // Direct start log if needed (User prompt example showed log for direct start too)
                    addSessionLog(state, `Session was started by <@${state.hostId}> after a poll with 0 votes`);
                }

                // Update Manager Panel
                const activeEmbed = new EmbedBuilder()
                    .setTitle(`${config.emojis.crpc} Active Session`)
                    .setDescription(`The session was started by <@${state.hostId}> <t:${state.startTime}:R>. ${state.startReason}`)
                    .setColor('#2ecc71');

                const logsEmbed = new EmbedBuilder()
                    .setTitle(`${config.emojis.crpc} Session Logs`)
                    .setDescription(state.sessionLogs.join('\n'))
                    .setColor('#2b2d31');

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('session_manage_menu')
                        .setPlaceholder('Select an option')
                        .addOptions([
                            { label: 'Shutdown Session', value: 'shutdown_session', emoji: '🛑' },
                            { label: 'Post Boost Message', value: 'post_boost', emoji: '🚀' }
                        ])
                );

                await interaction.update({ embeds: [activeEmbed, logsEmbed], components: [row] });
                await logToChannel(interaction.guild, 'Session Started', `Session started by <@${interaction.user.id}>. Mode: ${wasPoll ? 'Poll' : 'Direct'}.`, '#2ecc71');
            }

            // 5. POST BOOST MESSAGE
            else if (selected === 'post_boost') {
                const pollChannel = interaction.guild.channels.cache.get(config.channels.pollAnnouncement);
                if (pollChannel) {
                    const boostEmbed = new EmbedBuilder()
                        .setTitle(`${config.emojis.crpc} Session is still active!`)
                        .setDescription('The session is still ongoing. Join up!')
                        .setColor('#00ff00');
                    
                    const boostMsg = await pollChannel.send({ embeds: [boostEmbed] });
                    // Store ID for cleanup
                    state.boostMessageIds.push(boostMsg.id);
                }

                // Feature 4: Log boost in internal logs
                addSessionLog(state, `Boost message was posted by <@${interaction.user.id}>`);

                // Update Management Panel to show new log
                const activeEmbed = new EmbedBuilder()
                    .setTitle(`${config.emojis.crpc} Active Session`)
                    .setDescription(`The session was started by <@${state.hostId}> <t:${state.startTime}:R>. ${state.startReason}`)
                    .setColor('#2ecc71');

                const logsEmbed = new EmbedBuilder()
                    .setTitle(`${config.emojis.crpc} Session Logs`)
                    .setDescription(state.sessionLogs.join('\n'))
                    .setColor('#2b2d31');
                
                // We use update here to refresh the logs
                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('session_manage_menu')
                        .setPlaceholder('Select an option')
                        .addOptions([
                            { label: 'Shutdown Session', value: 'shutdown_session', emoji: '🛑' },
                            { label: 'Post Boost Message', value: 'post_boost', emoji: '🚀' }
                        ])
                );

                await interaction.update({ embeds: [activeEmbed, logsEmbed], components: [row] });
                await logToChannel(interaction.guild, 'Boost Posted', `Boost message posted by <@${interaction.user.id}>.`, '#00ff00');
            }

            // 6. SHUTDOWN SESSION
            else if (selected === 'shutdown_session') {
                const pollChannel = interaction.guild.channels.cache.get(config.channels.pollAnnouncement);
                
                // Cleanup
                if (pollChannel) {
                    // Delete SSU
                    if (state.startupMessageId) {
                        try {
                            const msg = await pollChannel.messages.fetch(state.startupMessageId);
                            if (msg) await msg.delete();
                        } catch (e) { }
                    }
                    // BUG FIX 3: Delete Boost Messages
                    for (const boostId of state.boostMessageIds) {
                        try {
                            const msg = await pollChannel.messages.fetch(boostId);
                            if (msg) await msg.delete();
                        } catch (e) { }
                    }

                    // Send Shutdown Message
                    const ssdMsg = await pollChannel.send({
                        content: `**Server Status**\nThe server is now shutting down. Thank you to everyone who joined and participated in the session! While the server may still be accessible, please be aware that no moderators will be present. We appreciate your time and hope to see you in the next one!`
                    });
                    
                    // Store Shutdown ID for next session start cleanup
                    state.shutdownMessageId = ssdMsg.id;
                }

                // Reset Management Panel
                const resetEmbed = new EmbedBuilder()
                    .setTitle(`${config.emojis.crpc} No Active Session`)
                    .setDescription('Start a session or create a poll by clicking the buttons below this message')
                    .setColor('#2b2d31');

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('session_manage_menu')
                        .setPlaceholder('Select an option')
                        .addOptions([
                            { label: 'Start Session', value: 'start_session', emoji: '🚀' },
                            { label: 'Create Poll', value: 'create_poll', emoji: '📊' }
                        ])
                );

                // Reset session state but preserve shutdown ID and panel info
                state.status = 'IDLE';
                state.voters.clear();
                state.pollMessageId = null;
                state.startupMessageId = null;
                state.boostMessageIds = [];
                state.sessionLogs = [];
                // state.shutdownMessageId is preserved

                await interaction.update({ embeds: [resetEmbed], components: [row] });
                await logToChannel(interaction.guild, 'Session Shutdown', `Session shutdown by <@${interaction.user.id}>.`, '#ff0000');
            }
        }
    }
};
