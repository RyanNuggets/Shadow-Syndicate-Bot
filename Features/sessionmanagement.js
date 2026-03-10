const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    ComponentType
} = require('discord.js');

const config = require('../config.json');

const sessionState = new Map();
const EMBED_COLOR = '#111111';
const JOIN_EMOJI = '✅';
const MAX_MEMBERS = 4;

function getOrInitState(guildId) {
    if (!sessionState.has(guildId)) {
        sessionState.set(guildId, {
            sessionMessageId: null,
            sessionChannelId: null,
            managementMessageId: null,
            managementChannelId: null,
            hostId: null,
            startTime: null,
            status: 'IDLE', // IDLE | SIGNUPS | ACTIVE
            joinedUsers: new Set(),
            sessionLogs: [],
            started: false
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

function addSessionLog(state, message) {
    const timestamp = Math.floor(Date.now() / 1000);
    const entry = `• ${message} <t:${timestamp}:R>`;
    state.sessionLogs.push(entry);
    return entry;
}

function formatRoster(state) {
    if (state.joinedUsers.size === 0) return 'No members added yet.';
    return Array.from(state.joinedUsers).map(id => `<@${id}>`).join('\n');
}

function buildSessionEmbed(state) {
    const isActive = state.status === 'ACTIVE';
    const title = isActive ? '🔫 Mafia Session Active' : '🔫 Mafia Session Signups';
    const description = isActive
        ? `Hosted by <@${state.hostId}>.\nThe session is now active.`
        : `Hosted by <@${state.hostId}>.\nReact with ${JOIN_EMOJI} to join.\n**First ${MAX_MEMBERS} only.**`;

    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .addFields(
            { name: 'Slots', value: `${state.joinedUsers.size}/${MAX_MEMBERS}`, inline: true },
            { name: 'Status', value: state.status, inline: true },
            { name: 'Roster', value: formatRoster(state), inline: false }
        )
        .setColor(EMBED_COLOR)
        .setTimestamp();
}

function buildManagementEmbeds(state) {
    if (state.status === 'IDLE') {
        return [
            new EmbedBuilder()
                .setTitle('🔫 No Active Mafia Session')
                .setDescription('Use the menu below to host a mafia session.')
                .setColor(EMBED_COLOR)
        ];
    }

    const mainEmbed = new EmbedBuilder()
        .setTitle(state.status === 'ACTIVE' ? '🔫 Active Mafia Session' : '🔫 Mafia Session Signups')
        .setDescription(`Hosted by <@${state.hostId}> <t:${state.startTime}:R>.`)
        .addFields(
            { name: 'Slots', value: `${state.joinedUsers.size}/${MAX_MEMBERS}`, inline: true },
            { name: 'Status', value: state.status, inline: true },
            { name: 'Roster', value: formatRoster(state), inline: false }
        )
        .setColor(EMBED_COLOR);

    const logsEmbed = new EmbedBuilder()
        .setTitle('📝 Session Logs')
        .setDescription(state.sessionLogs.length ? state.sessionLogs.join('\n') : 'No logs yet.')
        .setColor(EMBED_COLOR);

    return [mainEmbed, logsEmbed];
}

function buildManagementComponents(state) {
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
                            description: 'Create the session signup message',
                            emoji: '🚀'
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
                        label: 'Add Member',
                        value: 'add_member',
                        description: 'Manually add someone to the session',
                        emoji: '➕'
                    },
                    {
                        label: 'Remove Member',
                        value: 'remove_member',
                        description: 'Manually remove someone from the session',
                        emoji: '➖'
                    },
                    {
                        label: 'End Session',
                        value: 'end_session',
                        description: 'End the current mafia session',
                        emoji: '🛑'
                    }
                ])
        )
    ];
}

async function updateManagementPanel(guild, state) {
    if (!state.managementMessageId || !state.managementChannelId) return;

    const channel = guild.channels.cache.get(state.managementChannelId);
    if (!channel) return;

    try {
        const msg = await channel.messages.fetch(state.managementMessageId);
        if (!msg) return;

        await msg.edit({
            embeds: buildManagementEmbeds(state),
            components: buildManagementComponents(state)
        });
    } catch (err) {
        console.error('Failed to update management panel:', err);
    }
}

async function updateSessionMessage(guild, state) {
    if (!state.sessionMessageId || !state.sessionChannelId) return;

    const channel = guild.channels.cache.get(state.sessionChannelId);
    if (!channel) return;

    try {
        const msg = await channel.messages.fetch(state.sessionMessageId);
        if (!msg) return;

        await msg.edit({
            embeds: [buildSessionEmbed(state)]
        });
    } catch (err) {
        console.error('Failed to update session message:', err);
    }
}

async function startSession(guild, state) {
    if (state.started || state.joinedUsers.size < MAX_MEMBERS) return;

    state.started = true;
    state.status = 'ACTIVE';

    addSessionLog(state, `Session automatically started with ${MAX_MEMBERS} members`);

    const channel = guild.channels.cache.get(state.sessionChannelId);
    if (channel) {
        const memberMentions = Array.from(state.joinedUsers).map(id => `<@${id}>`).join(' ');
        await channel.send({
            content: `${memberMentions}\nYour mafia session is now starting. You were the first ${MAX_MEMBERS} to join.`
        }).catch(console.error);
    }

    await updateSessionMessage(guild, state);
    await updateManagementPanel(guild, state);
    await logToChannel(guild, 'Mafia Session Started', `Session started automatically with ${MAX_MEMBERS} members.`, EMBED_COLOR);
}

async function resetSession(guildId) {
    const state = getOrInitState(guildId);

    state.sessionMessageId = null;
    state.sessionChannelId = null;
    state.hostId = null;
    state.startTime = null;
    state.status = 'IDLE';
    state.joinedUsers.clear();
    state.sessionLogs = [];
    state.started = false;
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

        await interaction.reply({
            embeds: buildManagementEmbeds(state),
            components: buildManagementComponents(state)
        });

        const msg = await interaction.fetchReply();
        state.managementMessageId = msg.id;
        state.managementChannelId = interaction.channelId;
    },

    async handleInteraction(interaction) {
        const state = getOrInitState(interaction.guildId);

        if (interaction.isStringSelectMenu() && interaction.customId === 'session_manage_menu') {
            if (!hasCommandAccess(interaction.member) && !hasSlotAccess(interaction.member)) {
                return interaction.reply({
                    content: 'You do not have permission to use this menu.',
                    ephemeral: true
                });
            }

            const selected = interaction.values[0];

            if (selected === 'host_session') {
                if (!hasCommandAccess(interaction.member)) {
                    return interaction.reply({
                        content: 'Only command access can host a session.',
                        ephemeral: true
                    });
                }

                if (state.status !== 'IDLE') {
                    return interaction.reply({
                        content: 'There is already an active or pending session.',
                        ephemeral: true
                    });
                }

                const sessionChannel = interaction.guild.channels.cache.get(config.channels.sessionAnnouncement);
                if (!sessionChannel) {
                    return interaction.reply({
                        content: 'Session announcement channel is not configured correctly.',
                        ephemeral: true
                    });
                }

                state.hostId = interaction.user.id;
                state.startTime = Math.floor(Date.now() / 1000);
                state.status = 'SIGNUPS';
                state.joinedUsers.clear();
                state.sessionLogs = [];
                state.started = false;

                addSessionLog(state, `Session hosted by <@${interaction.user.id}>`);

                const sessionMsg = await sessionChannel.send({
                    embeds: [buildSessionEmbed(state)]
                });

                await sessionMsg.react(JOIN_EMOJI);

                state.sessionMessageId = sessionMsg.id;
                state.sessionChannelId = sessionChannel.id;

                await interaction.update({
                    embeds: buildManagementEmbeds(state),
                    components: buildManagementComponents(state)
                });

                await logToChannel(
                    interaction.guild,
                    'Mafia Session Hosted',
                    `Session hosted by <@${interaction.user.id}>.`,
                    EMBED_COLOR
                );
            }

            else if (selected === 'add_member') {
                if (!hasSlotAccess(interaction.member)) {
                    return interaction.reply({
                        content: 'You do not have permission to add members.',
                        ephemeral: true
                    });
                }

                if (state.status === 'IDLE') {
                    return interaction.reply({
                        content: 'There is no active session.',
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

            else if (selected === 'remove_member') {
                if (!hasSlotAccess(interaction.member)) {
                    return interaction.reply({
                        content: 'You do not have permission to remove members.',
                        ephemeral: true
                    });
                }

                if (state.status === 'IDLE') {
                    return interaction.reply({
                        content: 'There is no active session.',
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

            else if (selected === 'end_session') {
                if (!hasCommandAccess(interaction.member)) {
                    return interaction.reply({
                        content: 'Only command access can end a session.',
                        ephemeral: true
                    });
                }

                if (state.status === 'IDLE') {
                    return interaction.reply({
                        content: 'There is no active session to end.',
                        ephemeral: true
                    });
                }

                const oldHost = state.hostId;
                await resetSession(interaction.guildId);
                await updateManagementPanel(interaction.guild, getOrInitState(interaction.guildId));

                await interaction.update({
                    embeds: buildManagementEmbeds(getOrInitState(interaction.guildId)),
                    components: buildManagementComponents(getOrInitState(interaction.guildId))
                });

                await logToChannel(
                    interaction.guild,
                    'Mafia Session Ended',
                    `Session ended by <@${interaction.user.id}>. Hosted by <@${oldHost}>.`,
                    EMBED_COLOR
                );
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

            if (interaction.customId === 'session_add_member_user') {
                if (state.status === 'IDLE') {
                    return interaction.update({
                        content: 'There is no active session.',
                        components: []
                    });
                }

                if (state.joinedUsers.has(targetId)) {
                    return interaction.update({
                        content: `<@${targetId}> is already in the session.`,
                        components: []
                    });
                }

                if (state.joinedUsers.size >= MAX_MEMBERS) {
                    return interaction.update({
                        content: `The session is already full (${MAX_MEMBERS}/${MAX_MEMBERS}).`,
                        components: []
                    });
                }

                state.joinedUsers.add(targetId);
                addSessionLog(state, `<@${interaction.user.id}> manually added <@${targetId}>`);

                await updateSessionMessage(interaction.guild, state);
                await updateManagementPanel(interaction.guild, state);
                await logToChannel(
                    interaction.guild,
                    'Session Member Added',
                    `<@${interaction.user.id}> added <@${targetId}> to the session.`,
                    EMBED_COLOR
                );

                if (state.joinedUsers.size === MAX_MEMBERS && !state.started) {
                    await startSession(interaction.guild, state);
                }

                return interaction.update({
                    content: `<@${targetId}> was added to the session.`,
                    components: []
                });
            }

            if (interaction.customId === 'session_remove_member_user') {
                if (state.status === 'IDLE') {
                    return interaction.update({
                        content: 'There is no active session.',
                        components: []
                    });
                }

                if (!state.joinedUsers.has(targetId)) {
                    return interaction.update({
                        content: `<@${targetId}> is not in the session.`,
                        components: []
                    });
                }

                state.joinedUsers.delete(targetId);
                addSessionLog(state, `<@${interaction.user.id}> manually removed <@${targetId}>`);

                await updateSessionMessage(interaction.guild, state);
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
            try { await reaction.fetch(); } catch { return; }
        }

        const message = reaction.message;
        const state = getOrInitState(message.guild.id);

        if (!state.sessionMessageId || message.id !== state.sessionMessageId) return;
        if (reaction.emoji.name !== JOIN_EMOJI) return;
        if (state.status !== 'SIGNUPS' && state.status !== 'ACTIVE') return;

        if (state.joinedUsers.has(user.id)) return;

        if (state.joinedUsers.size >= MAX_MEMBERS) {
            try {
                await reaction.users.remove(user.id);
            } catch (err) {
                console.error('Failed to remove extra reaction:', err);
            }

            await message.channel.send({
                content: `<@${user.id}> This mafia session is full. Max is ${MAX_MEMBERS}.`
            }).catch(console.error);

            return;
        }

        state.joinedUsers.add(user.id);
        addSessionLog(state, `<@${user.id}> joined the session by reaction`);

        await updateSessionMessage(message.guild, state);
        await updateManagementPanel(message.guild, state);

        if (state.joinedUsers.size === MAX_MEMBERS && !state.started) {
            await startSession(message.guild, state);
        }
    },

    async handleReactionRemove(reaction, user) {
        if (user.bot) return;

        if (reaction.partial) {
            try { await reaction.fetch(); } catch { return; }
        }

        const message = reaction.message;
        const state = getOrInitState(message.guild.id);

        if (!state.sessionMessageId || message.id !== state.sessionMessageId) return;
        if (reaction.emoji.name !== JOIN_EMOJI) return;
        if (!state.joinedUsers.has(user.id)) return;

        state.joinedUsers.delete(user.id);
        addSessionLog(state, `<@${user.id}> left the session`);

        await updateSessionMessage(message.guild, state);
        await updateManagementPanel(message.guild, state);
    }
};
