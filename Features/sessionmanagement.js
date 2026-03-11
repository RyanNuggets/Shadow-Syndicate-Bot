const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder
} = require('discord.js');

const config = require('../config.json');

const sessionState = new Map();

const EMBED_COLOR = config.embedColor || '#111111';
const MAX_MEMBERS = 6;
const MIN_MEMBERS = 4;
const JOIN_EMOJI = config.reactions?.join || '✅';
const QUEUE_EMOJI = config.reactions?.queue || '📋';

function getOrInitState(guildId) {
    if (!sessionState.has(guildId)) {
        sessionState.set(guildId, {
            mainMessageId: null,
            sessionChannelId: null,
            managementMessageId: null,
            managementChannelId: null,
            hostId: null,
            hostTag: null,
            startTime: null,
            status: 'IDLE',
            displayStatus: null,

            activeMembers: new Set(),
            queuedMembers: [],
            allJoinedMembers: new Set(),
            removedMembers: new Set(),

            sessionLogs: [],

            boostMessageIds: [],
            fullMessageIds: [],
            auxMessageIds: []
        });
    }

    return sessionState.get(guildId);
}

function hasCommandAccess(member) {
    return member.roles.cache.has(config.roles.commandAccess);
}

function hasSlotAccess(member) {
    return (
        member.roles.cache.has(config.roles.commandAccess) ||
        member.roles.cache.has(config.roles.sessionSlotManager)
    );
}

function sessionEmoji() {
    return config.emojis?.session || '🔫';
}

function logEmoji() {
    return config.emojis?.log || '•';
}

function boostEmoji() {
    return config.emojis?.boost || '🚀';
}

function fullEmoji() {
    return config.emojis?.full || '⛔';
}

function getRelativeTimestamp(unix) {
    return `<t:${unix}:R>`;
}

function getLongTimestamp(unix) {
    return `<t:${unix}:F>`;
}

function formatMentionsFromSet(set) {
    if (!set || set.size === 0) return 'None';
    return Array.from(set).map(id => `<@${id}>`).join('\n');
}

function formatQueue(arr) {
    if (!arr || arr.length === 0) return 'None';
    return arr.map((id, i) => `**${i + 1}.** <@${id}>`).join('\n');
}

function addSessionLog(state, message) {
    const timestamp = Math.floor(Date.now() / 1000);
    state.sessionLogs.push(`${logEmoji()} ${message} on ${getLongTimestamp(timestamp)}.`);
}

function getStatusText(state) {
    if (state.displayStatus) return state.displayStatus;
    if (state.status === 'IDLE') return 'No Session';
    if (state.activeMembers.size >= MAX_MEMBERS) return 'Full';
    return 'Available Slots';
}

function buildHostedInfoEmbed(state) {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setDescription(
            `## ${sessionEmoji()} Mafia Session Hosting\n` +
            `A session is being hosted by <@${state.hostId}>! The session is now available for members to join.\n\n` +
            `**\`-\`** A minimum of ${MIN_MEMBERS} members and a maximum of ${MAX_MEMBERS} members.\n` +
            `**\`-\`** Arrive prepared with your uniforms, weapons, and vehicles ready before the session starts.\n` +
            `**\`-\`** First come, first serve.\n`
        );
}

function buildHostedStatusEmbed(state) {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setDescription(
            `## Session Status\n` +
            `**Last Updated:** ${getRelativeTimestamp(Math.floor(Date.now() / 1000))}`
        )
        .addFields(
            {
                name: 'Available Slots',
                value: `\`\`\`${state.activeMembers.size}/${MAX_MEMBERS}\`\`\``,
                inline: true
            },
            {
                name: 'Host',
                value: `\`\`\`${state.hostTag || 'Unknown User'}\`\`\``,
                inline: true
            },
            {
                name: 'Status',
                value: `\`\`\`${getStatusText(state)}\`\`\``,
                inline: true
            }
        );
}

function buildCommandMainEmbed(state) {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setDescription(
            `**${sessionEmoji()} Active Session**\n` +
            `The session was started by <@${state.hostId}> ${getRelativeTimestamp(state.startTime)}.\n`
        )
        .addFields(
            {
                name: 'Available Slots',
                value: `${state.activeMembers.size}/${MAX_MEMBERS}`,
                inline: true
            },
            {
                name: 'Host',
                value: `${state.hostTag || 'Unknown User'}`,
                inline: true
            },
            {
                name: 'Status',
                value: getStatusText(state),
                inline: true
            }
        );
}

function buildLogsEmbed(state) {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setDescription(
            `**${sessionEmoji()} Session Logs**\n` +
            `${state.sessionLogs.length ? state.sessionLogs.join('\n') : `${logEmoji()} No logs yet.`}`
        );
}

function buildIdleEmbed() {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setDescription(`**${sessionEmoji()} No Active Session**\nUse the menu below to host a session.`);
}

function buildManageComponents(state) {
    if (state.status === 'IDLE') {
        return [
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('session_manage_menu')
                    .setPlaceholder('Select an option')
                    .addOptions([
                        {
                            label: 'Host Session',
                            value: 'host_session',
                            description: 'Host a new mafia session'
                        }
                    ])
            )
        ];
    }

    return [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('session_manage_menu')
                .setPlaceholder('Select an option')
                .addOptions([
                    {
                        label: 'Shutdown Session',
                        value: 'shutdown_session'
                    },
                    {
                        label: 'Post Boost Message',
                        value: 'post_boost'
                    },
                    {
                        label: 'Post Slots Full Message',
                        value: 'post_full'
                    },
                    {
                        label: 'Add Member',
                        value: 'add_member'
                    },
                    {
                        label: 'Remove Member',
                        value: 'remove_member'
                    }
                ])
        )
    ];
}

async function logToChannel(guild, title, description, color = EMBED_COLOR) {
    const logChannelId = config.channels.actionLog;
    if (!logChannelId) return;

    const channel = guild.channels.cache.get(logChannelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(console.error);
}

async function logSessionEndedSummary(guild, state) {
    const logChannelId = config.channels.sessionEndLog || config.channels.actionLog;
    const channel = guild.channels.cache.get(logChannelId);
    if (!channel) return;

    const link = state.mainMessageId && state.sessionChannelId
        ? `https://discord.com/channels/${guild.id}/${state.sessionChannelId}/${state.mainMessageId}`
        : 'Unavailable';

    const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('Session Ended')
        .setDescription(
            `**Event Message:** ${link}\n` +
            `**Hosted By:** <@${state.hostId}>\n` +
            `**Started:** ${getLongTimestamp(state.startTime)}\n` +
            `**Ended:** ${getLongTimestamp(Math.floor(Date.now() / 1000))}`
        )
        .addFields(
            {
                name: 'Everyone Who Joined',
                value: formatMentionsFromSet(state.allJoinedMembers),
                inline: false
            },
            {
                name: 'Removed During Session',
                value: formatMentionsFromSet(state.removedMembers),
                inline: false
            },
            {
                name: 'Final Queue',
                value: formatQueue(state.queuedMembers),
                inline: false
            }
        );

    await channel.send({ embeds: [embed] }).catch(console.error);
}

async function updateManagementPanel(guild, state) {
    if (!state.managementMessageId || !state.managementChannelId) return;

    const channel = guild.channels.cache.get(state.managementChannelId);
    if (!channel) return;

    try {
        const message = await channel.messages.fetch(state.managementMessageId);
        if (!message) return;

        if (state.status === 'IDLE') {
            await message.edit({
                embeds: [buildIdleEmbed()],
                components: buildManageComponents(state)
            });
            return;
        }

        await message.edit({
            embeds: [buildCommandMainEmbed(state), buildLogsEmbed(state)],
            components: buildManageComponents(state)
        });
    } catch (error) {
        console.error('Failed to update management panel:', error);
    }
}

async function updateMainMessage(guild, state) {
    if (!state.mainMessageId || !state.sessionChannelId) return;

    const channel = guild.channels.cache.get(state.sessionChannelId);
    if (!channel) return;

    try {
        const message = await channel.messages.fetch(state.mainMessageId);
        if (!message) return;

        await message.edit({
            content: `<@&${config.roles.sessionPing}>`,
            embeds: [buildHostedInfoEmbed(state), buildHostedStatusEmbed(state)],
            allowedMentions: { parse: ['roles'] }
        });
    } catch (error) {
        console.error('Failed to update main session message:', error);
    }
}

async function notifyQueuePromotion(guild, userId) {
    const channelId = config.channels.queueNotification;
    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;

    await channel.send({
        content: `<@${userId}> a session spot opened and you have been added to the session.`
    }).catch(console.error);
}

function removeFromQueue(state, userId) {
    state.queuedMembers = state.queuedMembers.filter(id => id !== userId);
}

async function removeUserQueueReactions(guild, state, userId) {
    const channel = guild.channels.cache.get(state.sessionChannelId);
    if (!channel) return;

    for (const msgId of state.fullMessageIds) {
        try {
            const msg = await channel.messages.fetch(msgId);
            if (!msg) continue;

            const reaction = msg.reactions.cache.find(r => r.emoji.name === QUEUE_EMOJI);
            if (reaction) {
                await reaction.users.remove(userId).catch(() => {});
            }
        } catch (error) {
            // ignore
        }
    }
}

async function fillOpenSlotFromQueue(guild, state) {
    if (state.activeMembers.size >= MAX_MEMBERS) return;
    if (state.queuedMembers.length === 0) return;

    const nextUserId = state.queuedMembers.shift();
    if (!nextUserId) return;

    state.activeMembers.add(nextUserId);
    state.allJoinedMembers.add(nextUserId);
    addSessionLog(state, `<@${nextUserId}> was moved from the queue into the session`);

    await removeUserQueueReactions(guild, state, nextUserId);
    await notifyQueuePromotion(guild, nextUserId);
    await updateMainMessage(guild, state);
    await updateManagementPanel(guild, state);

    await logToChannel(
        guild,
        'Queue Promotion',
        `<@${nextUserId}> was moved from the queue into the session.`,
        EMBED_COLOR
    );
}

async function cleanupSessionChannelMessages(guild, state) {
    const channel = guild.channels.cache.get(state.sessionChannelId);
    if (!channel) return;

    const idsToDelete = [...new Set([...state.auxMessageIds, ...state.boostMessageIds, ...state.fullMessageIds])];

    for (const id of idsToDelete) {
        try {
            const msg = await channel.messages.fetch(id);
            if (msg) await msg.delete();
        } catch (error) {
            // ignore
        }
    }
}

function resetStateButKeepPanel(guildId) {
    const old = getOrInitState(guildId);

    old.mainMessageId = null;
    old.sessionChannelId = null;
    old.hostId = null;
    old.hostTag = null;
    old.startTime = null;
    old.status = 'IDLE';
    old.displayStatus = null;

    old.activeMembers.clear();
    old.queuedMembers = [];
    old.allJoinedMembers.clear();
    old.removedMembers.clear();

    old.sessionLogs = [];
    old.boostMessageIds = [];
    old.fullMessageIds = [];
    old.auxMessageIds = [];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('session')
        .setDescription('Manage mafia sessions')
        .addSubcommand(subcommand =>
            subcommand
                .setName('manage')
                .setDescription('Open the mafia session management panel')
        ),

    async execute(interaction) {
        if (!hasCommandAccess(interaction.member)) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        const state = getOrInitState(interaction.guildId);

        if (state.status === 'IDLE') {
            await interaction.reply({
                embeds: [buildIdleEmbed()],
                components: buildManageComponents(state)
            });
        } else {
            await interaction.reply({
                embeds: [buildCommandMainEmbed(state), buildLogsEmbed(state)],
                components: buildManageComponents(state)
            });
        }

        const msg = await interaction.fetchReply();
        state.managementMessageId = msg.id;
        state.managementChannelId = interaction.channelId;
    },

    async handleInteraction(interaction) {
        const state = getOrInitState(interaction.guildId);

        if (interaction.isStringSelectMenu() && interaction.customId === 'session_manage_menu') {
            const selected = interaction.values[0];

            if (selected === 'host_session') {
                if (!hasCommandAccess(interaction.member)) {
                    return interaction.reply({
                        content: 'You do not have permission to host sessions.',
                        ephemeral: true
                    });
                }

                if (state.status !== 'IDLE') {
                    return interaction.reply({
                        content: 'There is already an active session.',
                        ephemeral: true
                    });
                }

                const channel = interaction.guild.channels.cache.get(config.channels.sessionAnnouncement);
                if (!channel) {
                    return interaction.reply({
                        content: 'Session announcement channel is not configured.',
                        ephemeral: true
                    });
                }

                state.hostId = interaction.user.id;
                state.hostTag = interaction.user.globalName || interaction.user.username;
                state.startTime = Math.floor(Date.now() / 1000);
                state.status = 'ACTIVE';
                state.displayStatus = null;

                addSessionLog(state, `Session was started by <@${interaction.user.id}>`);

                const mainMessage = await channel.send({
                    content: `<@&${config.roles.sessionPing}>`,
                    embeds: [buildHostedInfoEmbed(state), buildHostedStatusEmbed(state)],
                    allowedMentions: { parse: ['roles'] }
                });

                await mainMessage.react(JOIN_EMOJI);

                state.mainMessageId = mainMessage.id;
                state.sessionChannelId = channel.id;

                await interaction.update({
                    embeds: [buildCommandMainEmbed(state), buildLogsEmbed(state)],
                    components: buildManageComponents(state)
                });

                await logToChannel(
                    interaction.guild,
                    'Session Started',
                    `Session started by <@${interaction.user.id}>.\nMessage: ${mainMessage.url}`,
                    EMBED_COLOR
                );

                return;
            }

            if (state.status === 'IDLE') {
                return interaction.reply({
                    content: 'There is no active session.',
                    ephemeral: true
                });
            }

            if (selected === 'post_boost') {
                if (!hasCommandAccess(interaction.member)) {
                    return interaction.reply({
                        content: 'You do not have permission to post boost messages.',
                        ephemeral: true
                    });
                }

                const channel = interaction.guild.channels.cache.get(state.sessionChannelId);
                if (!channel) {
                    return interaction.reply({
                        content: 'Session channel not found.',
                        ephemeral: true
                    });
                }

                const boostEmbed = new EmbedBuilder()
                    .setColor(EMBED_COLOR)
                    .setDescription(
                        `## ${boostEmoji()} Session Boost\n` +
                        `Slots are currently available for the active session.\n` +
                        `React with ${JOIN_EMOJI} below to claim an open slot.`
                    );

                const boostMsg = await channel.send({
                    content: `<@&${config.roles.sessionPing}>`,
                    embeds: [boostEmbed],
                    allowedMentions: { parse: ['roles'] }
                });

                await boostMsg.react(JOIN_EMOJI);

                state.boostMessageIds.push(boostMsg.id);
                state.auxMessageIds.push(boostMsg.id);

                addSessionLog(state, `Session boost message was posted`);

                await updateManagementPanel(interaction.guild, state);

                await interaction.update({
                    embeds: [buildCommandMainEmbed(state), buildLogsEmbed(state)],
                    components: buildManageComponents(state)
                });

                await logToChannel(
                    interaction.guild,
                    'Boost Message Posted',
                    `Boost message posted by <@${interaction.user.id}>.`,
                    EMBED_COLOR
                );

                return;
            }

            if (selected === 'post_full') {
                if (!hasCommandAccess(interaction.member)) {
                    return interaction.reply({
                        content: 'You do not have permission to post the full message.',
                        ephemeral: true
                    });
                }

                const channel = interaction.guild.channels.cache.get(state.sessionChannelId);
                if (!channel) {
                    return interaction.reply({
                        content: 'Session channel not found.',
                        ephemeral: true
                    });
                }

                const fullEmbed = new EmbedBuilder()
                    .setColor(EMBED_COLOR)
                    .setDescription(
                        `## ${fullEmoji()} Session Full\n` +
                        `The session is currently full.\n` +
                        `React with ${QUEUE_EMOJI} below to join the queue for the next available spot.`
                    );

                const fullMsg = await channel.send({
                    embeds: [fullEmbed]
                });

                await fullMsg.react(QUEUE_EMOJI);

                state.fullMessageIds.push(fullMsg.id);
                state.auxMessageIds.push(fullMsg.id);

                addSessionLog(state, `Session full message was posted`);

                await updateManagementPanel(interaction.guild, state);

                await interaction.update({
                    embeds: [buildCommandMainEmbed(state), buildLogsEmbed(state)],
                    components: buildManageComponents(state)
                });

                await logToChannel(
                    interaction.guild,
                    'Full Message Posted',
                    `Slots full message posted by <@${interaction.user.id}>.`,
                    EMBED_COLOR
                );

                return;
            }

            if (selected === 'add_member') {
                if (!hasSlotAccess(interaction.member)) {
                    return interaction.reply({
                        content: 'You do not have permission to add members.',
                        ephemeral: true
                    });
                }

                const row = new ActionRowBuilder().addComponents(
                    new UserSelectMenuBuilder()
                        .setCustomId('session_add_member_user')
                        .setPlaceholder('Select a user to add')
                        .setMinValues(1)
                        .setMaxValues(1)
                );

                return interaction.reply({
                    content: 'Select a user to add to the session.',
                    components: [row],
                    ephemeral: true
                });
            }

            if (selected === 'remove_member') {
                if (!hasSlotAccess(interaction.member)) {
                    return interaction.reply({
                        content: 'You do not have permission to remove members.',
                        ephemeral: true
                    });
                }

                const row = new ActionRowBuilder().addComponents(
                    new UserSelectMenuBuilder()
                        .setCustomId('session_remove_member_user')
                        .setPlaceholder('Select a user to remove')
                        .setMinValues(1)
                        .setMaxValues(1)
                );

                return interaction.reply({
                    content: 'Select a user to remove from the session.',
                    components: [row],
                    ephemeral: true
                });
            }

            if (selected === 'shutdown_session') {
                if (!hasCommandAccess(interaction.member)) {
                    return interaction.reply({
                        content: 'You do not have permission to shut down sessions.',
                        ephemeral: true
                    });
                }

                const channel = interaction.guild.channels.cache.get(state.sessionChannelId);

                state.displayStatus = 'Ended';
                await updateMainMessage(interaction.guild, state);

                await cleanupSessionChannelMessages(interaction.guild, state);

                if (channel && state.mainMessageId) {
                    try {
                        const mainMsg = await channel.messages.fetch(state.mainMessageId);
                        if (mainMsg) {
                            await mainMsg.reply({
                                content: 'This session has ended, thank you for joining.'
                            });
                        }
                    } catch (error) {
                        console.error('Failed to reply to main session message on shutdown:', error);
                    }
                }

                await logSessionEndedSummary(interaction.guild, state);
                await logToChannel(
                    interaction.guild,
                    'Session Shutdown',
                    `Session shut down by <@${interaction.user.id}>.`,
                    EMBED_COLOR
                );

                resetStateButKeepPanel(interaction.guildId);

                await interaction.update({
                    embeds: [buildIdleEmbed()],
                    components: buildManageComponents(getOrInitState(interaction.guildId))
                });

                return;
            }
        }

        if (interaction.isUserSelectMenu()) {
            if (!hasSlotAccess(interaction.member)) {
                return interaction.reply({
                    content: 'You do not have permission to manage session members.',
                    ephemeral: true
                });
            }

            const state = getOrInitState(interaction.guildId);
            const targetId = interaction.values[0];

            if (state.status === 'IDLE') {
                return interaction.update({
                    content: 'There is no active session.',
                    components: []
                });
            }

            if (interaction.customId === 'session_add_member_user') {
                if (state.activeMembers.has(targetId)) {
                    return interaction.update({
                        content: `<@${targetId}> is already in the session.`,
                        components: []
                    });
                }

                if (state.activeMembers.size >= MAX_MEMBERS) {
                    return interaction.update({
                        content: `The session is full (${MAX_MEMBERS}/${MAX_MEMBERS}).`,
                        components: []
                    });
                }

                removeFromQueue(state, targetId);
                await removeUserQueueReactions(interaction.guild, state, targetId);

                state.activeMembers.add(targetId);
                state.allJoinedMembers.add(targetId);

                addSessionLog(state, `<@${interaction.user.id}> added <@${targetId}> to the session`);

                await updateMainMessage(interaction.guild, state);
                await updateManagementPanel(interaction.guild, state);

                await logToChannel(
                    interaction.guild,
                    'Session Member Added',
                    `<@${interaction.user.id}> added <@${targetId}> to the session.`,
                    EMBED_COLOR
                );

                return interaction.update({
                    content: `<@${targetId}> was added to the session.`,
                    components: []
                });
            }

            if (interaction.customId === 'session_remove_member_user') {
                if (!state.activeMembers.has(targetId)) {
                    return interaction.update({
                        content: `<@${targetId}> is not in the session.`,
                        components: []
                    });
                }

                state.activeMembers.delete(targetId);
                state.removedMembers.add(targetId);

                addSessionLog(state, `<@${interaction.user.id}> removed <@${targetId}> from the session`);

                await fillOpenSlotFromQueue(interaction.guild, state);
                await updateMainMessage(interaction.guild, state);
                await updateManagementPanel(interaction.guild, state);

                await logToChannel(
                    interaction.guild,
                    'Session Member Removed',
                    `<@${interaction.user.id}> removed <@${targetId}> from the session.`,
                    EMBED_COLOR
                );

                return interaction.update({
                    content: `<@${targetId}> was removed from the session.`,
                    components: []
                });
            }
        }
    },

    async handleReactionAdd(reaction, user) {
        if (user.bot) return;

        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch {
                return;
            }
        }

        const message = reaction.message;
        if (!message.guild) return;

        const state = getOrInitState(message.guild.id);
        if (state.status === 'IDLE') return;

        const emojiName = reaction.emoji.name;

        const isJoinMessage =
            message.id === state.mainMessageId ||
            state.boostMessageIds.includes(message.id);

        if (isJoinMessage && emojiName === JOIN_EMOJI) {
            if (state.activeMembers.has(user.id)) return;

            if (state.activeMembers.size >= MAX_MEMBERS) {
                try {
                    await reaction.users.remove(user.id);
                } catch (error) {
                    console.error('Failed to remove join reaction from full session:', error);
                }
                return;
            }

            removeFromQueue(state, user.id);
            await removeUserQueueReactions(message.guild, state, user.id);

            state.activeMembers.add(user.id);
            state.allJoinedMembers.add(user.id);

            addSessionLog(state, `<@${user.id}> joined the session`);

            await updateMainMessage(message.guild, state);
            await updateManagementPanel(message.guild, state);
            return;
        }

        const isQueueMessage = state.fullMessageIds.includes(message.id);

        if (isQueueMessage && emojiName === QUEUE_EMOJI) {
            if (state.activeMembers.has(user.id)) {
                try {
                    await reaction.users.remove(user.id);
                } catch (error) {
                    console.error('Failed to remove queue reaction for active member:', error);
                }
                return;
            }

            if (state.queuedMembers.includes(user.id)) return;

            state.queuedMembers.push(user.id);
            addSessionLog(state, `<@${user.id}> joined the queue`);

            await updateManagementPanel(message.guild, state);
        }
    },

    async handleReactionRemove(reaction, user) {
        if (user.bot) return;

        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch {
                return;
            }
        }

        const message = reaction.message;
        if (!message.guild) return;

        const state = getOrInitState(message.guild.id);
        if (state.status === 'IDLE') return;

        const emojiName = reaction.emoji.name;

        const isJoinMessage =
            message.id === state.mainMessageId ||
            state.boostMessageIds.includes(message.id);

        if (isJoinMessage && emojiName === JOIN_EMOJI) {
            if (!state.activeMembers.has(user.id)) return;

            state.activeMembers.delete(user.id);
            state.removedMembers.add(user.id);

            addSessionLog(state, `<@${user.id}> left the session`);

            await fillOpenSlotFromQueue(message.guild, state);
            await updateMainMessage(message.guild, state);
            await updateManagementPanel(message.guild, state);
            return;
        }

        const isQueueMessage = state.fullMessageIds.includes(message.id);

        if (isQueueMessage && emojiName === QUEUE_EMOJI) {
            if (!state.queuedMembers.includes(user.id)) return;

            removeFromQueue(state, user.id);
            addSessionLog(state, `<@${user.id}> left the queue`);

            await updateManagementPanel(message.guild, state);
        }
    }
};
