// /Features/ShiftManagement/shiftmanage.js
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const fs = require('fs');
const path = require('path');

// File where shift data is stored
const DATA_PATH = path.join(__dirname, "shifts.json");

// Load or create file
function loadData() {
    if (!fs.existsSync(DATA_PATH)) {
        fs.writeFileSync(DATA_PATH, JSON.stringify({}, null, 2));
    }
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
}

function saveData(data) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

module.exports = {
    // -----------------------------------------------------
    // REGISTER SLASH COMMAND
    // -----------------------------------------------------
    registerShiftManageCommand: async (client, config) => {
        const shiftTypes = Object.keys(config.SHIFT_MANAGEMENT.TYPES);

        const command = new SlashCommandBuilder()
            .setName("shift")
            .setDescription("Shift Management System")
            .addSubcommand(sub =>
                sub
                    .setName("manage")
                    .setDescription("Start, pause or end your shift")
                    .addStringOption(opt =>
                        opt
                            .setName("type")
                            .setDescription("Type of shift")
                            .setRequired(true)
                            .addChoices(
                                ...shiftTypes.map(t => ({
                                    name: config.SHIFT_MANAGEMENT.TYPES[t].name,
                                    value: t
                                }))
                            )
                    )
            );

        await client.application.commands.create(command);
        console.log("✓ Registered /shift manage");
    },

    // -----------------------------------------------------
    // REGISTER HANDLERS (BUTTONS + COMMAND)
    // -----------------------------------------------------
    registerShiftManageHandlers: (client, config) => {
        const data = loadData();

        client.on("interactionCreate", async interaction => {
            // ----------------------
            // Slash Command Handler
            // ----------------------
            if (interaction.isChatInputCommand() && interaction.commandName === "shift") {
                await interaction.deferReply({ ephemeral: true });

                const sub = interaction.options.getSubcommand();
                if (sub === "manage") {
                    const type = interaction.options.getString("type");
                    const settings = config.SHIFT_MANAGEMENT.TYPES[type];

                    if (!settings) {
                        return interaction.editReply("❌ Invalid shift type.");
                    }

                    // Role lock
                    if (!interaction.member.roles.cache.has(settings.role)) {
                        return interaction.editReply("❌ You do not have permission to start this shift.");
                    }

                    const userId = interaction.user.id;

                    // Ensure data exists
                    if (!data[userId]) {
                        data[userId] = {
                            shiftCount: 0,
                            totalDuration: 0,
                            averageDuration: 0,
                            lastShift: 0
                        };
                    }

                    saveData(data);

                    // Return main panel
                    return interaction.editReply({
                        embeds: [createMainPanel(interaction.user, data[userId], settings.name)],
                        components: [createButtons("START")]
                    });
                }
            }

            // ------------------------------------
            // BUTTON HANDLER: START, PAUSE, END
            // ------------------------------------
            if (!interaction.isButton()) return;

            const [action, type] = interaction.customId.split("_");
            const userId = interaction.user.id;

            const settings = config.SHIFT_MANAGEMENT.TYPES[type];
            if (!settings) return;

            const logChannel = await interaction.guild.channels.fetch(settings.logChannel);

            await interaction.deferUpdate();

            // Ensure user entry exists
            if (!data[userId]) {
                data[userId] = {
                    shiftCount: 0,
                    totalDuration: 0,
                    averageDuration: 0,
                    lastShift: 0
                };
            }

            // Temp shift session memory (not stored in file)
            if (!global.shiftSessions) global.shiftSessions = {};
            if (!global.shiftSessions[userId]) {
                global.shiftSessions[userId] = {
                    startedAt: null,
                    breakStart: null,
                    totalBreak: 0,
                    lastBreak: 0,
                    type: type
                };
            }

            const session = global.shiftSessions[userId];

            // ---------------------------
            // START SHIFT
            // ---------------------------
            if (action === "START") {
                session.startedAt = Date.now();
                session.totalBreak = 0;
                session.lastBreak = 0;
                session.breakStart = null;

                logChannel.send(`👤 **${interaction.user.tag}** started a **${settings.name}** shift.`);

                return interaction.editReply({
                    embeds: [embedShiftStarted(interaction.user, type, session)],
                    components: [createButtons("ONSHIFT", type)]
                });
            }

            // ---------------------------
            // PAUSE SHIFT
            // ---------------------------
            if (action === "PAUSE") {
                session.breakStart = Date.now();

                return interaction.editReply({
                    embeds: [embedBreakStarted(interaction.user, type, session)],
                    components: [createButtons("BREAK", type)]
                });
            }

            // ---------------------------
            // RESUME SHIFT
            // ---------------------------
            if (action === "RESUME") {
                const now = Date.now();
                session.lastBreak = now - session.breakStart;
                session.totalBreak += session.lastBreak;
                session.breakStart = null;

                return interaction.editReply({
                    embeds: [embedBreakEnded(interaction.user, type, session)],
                    components: [createButtons("ONSHIFT", type)]
                });
            }

            // ---------------------------
            // END SHIFT
            // ---------------------------
            if (action === "END") {
                const now = Date.now();
                const totalTime = now - session.startedAt - session.totalBreak;

                data[userId].shiftCount += 1;
                data[userId].totalDuration += totalTime;
                data[userId].lastShift = totalTime;
                data[userId].averageDuration =
                    data[userId].totalDuration / data[userId].shiftCount;

                saveData(data);

                logChannel.send(`🛑 **${interaction.user.tag}** ended their shift. Total: **${formatDuration(totalTime)}**`);

                delete global.shiftSessions[userId];

                return interaction.editReply({
                    embeds: [embedShiftEnded(interaction.user, type, data[userId])],
                    components: [createButtons("START", type)]
                });
            }
        });
    }
};

// -----------------------------------------------------
// EMBED TEMPLATES
// -----------------------------------------------------
function createMainPanel(user, stats, typeName) {
    return new EmbedBuilder()
        .setAuthor({ name: `Shift Management | ${typeName}`, iconURL: user.displayAvatarURL() })
        .setTitle("All Time Information")
        .setDescription(
            `**Shift Count:** ${stats.shiftCount}\n` +
            `**Total Duration:** ${formatDuration(stats.totalDuration)}\n` +
            `**Average Duration:** ${formatDuration(stats.averageDuration)}`
        )
        .setColor("#2b2d31");
}

function embedShiftStarted(user, type, session) {
    return new EmbedBuilder()
        .setAuthor({ name: `Shift Management | ${type}`, iconURL: user.displayAvatarURL() })
        .setTitle("Shift Started")
        .setDescription(
            `**Current Shift**\n` +
            `**Status:** On Shift\n` +
            `**Started:** <t:${Math.floor(session.startedAt / 1000)}:R>`
        )
        .setColor("#2ecc71");
}

function embedBreakStarted(user, type, session) {
    return new EmbedBuilder()
        .setAuthor({ name: `Shift Management | ${type}`, iconURL: user.displayAvatarURL() })
        .setTitle("Break Started")
        .setDescription(
            `**Current Shift**\n` +
            `**Status:** On Break\n` +
            `**Shift Started:** <t:${Math.floor(session.startedAt / 1000)}:R>\n` +
            `**Break Started:** <t:${Math.floor(session.breakStart / 1000)}:R>`
        )
        .setColor("#faa61a");
}

function embedBreakEnded(user, type, session) {
    return new EmbedBuilder()
        .setAuthor({ name: `Shift Management | ${type}`, iconURL: user.displayAvatarURL() })
        .setTitle("Break Ended")
        .setDescription(
            `**Current Shift**\n` +
            `**Status:** On Shift\n` +
            `**Started:** <t:${Math.floor(session.startedAt / 1000)}:R>\n` +
            `**Total Break Time:** ${formatDuration(session.totalBreak)}\n` +
            `**Last Break Time:** ${formatDuration(session.lastBreak)}`
        )
        .setColor("#3498db");
}

function embedShiftEnded(user, type, stats) {
    return new EmbedBuilder()
        .setAuthor({ name: `Shift Management | ${type}`, iconURL: user.displayAvatarURL() })
        .setTitle("All Time Information")
        .setDescription(
            `**Shift Count:** ${stats.shiftCount}\n` +
            `**Total Duration:** ${formatDuration(stats.totalDuration)}\n` +
            `**Average Duration:** ${formatDuration(stats.averageDuration)}`
        )
        .addFields({
            name: "Last Shift",
            value: `**Status:** Ended\n**Total Time:** ${formatDuration(stats.lastShift)}`
        })
        .setColor("#2b2d31");
}

// -----------------------------------------------------
// BUTTON PANEL BUILDER
// -----------------------------------------------------
function createButtons(state, type = "") {
    const row = new ActionRowBuilder();

    if (state === "START") {
        row.addComponents(
            new ButtonBuilder().setCustomId(`START_${type}`).setLabel("Start").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`PAUSE_${type}`).setLabel("Pause").setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId(`END_${type}`).setLabel("End").setStyle(ButtonStyle.Danger).setDisabled(true)
        );
    }

    if (state === "ONSHIFT") {
        row.addComponents(
            new ButtonBuilder().setCustomId(`START_${type}`).setLabel("Start").setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId(`PAUSE_${type}`).setLabel("Pause").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`END_${type}`).setLabel("End").setStyle(ButtonStyle.Danger)
        );
    }

    if (state === "BREAK") {
        row.addComponents(
            new ButtonBuilder().setCustomId(`START_${type}`).setLabel("Start").setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId(`PAUSE_${type}`).setLabel("Pause").setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId(`RESUME_${type}`).setLabel("End Break").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`END_${type}`).setLabel("End").setStyle(ButtonStyle.Danger).setDisabled(true)
        );
    }

    return row;
}

// -----------------------------------------------------
// TIME FORMATTER
// -----------------------------------------------------
function formatDuration(ms) {
    if (!ms || ms <= 0) return "0s";

    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s} Seconds`;

    const m = Math.floor(s / 60);
    if (m < 60) return `${m} Minutes`;

    const h = Math.floor(m / 60);
    return `${h} Hours ${m % 60} Min`;
}
