// /Features/ShiftManagement/shiftmanage.js
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'shiftData.json');

// Load or create data file
let shiftData = {};
if (fs.existsSync(DATA_PATH)) {
    shiftData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
} else {
    fs.writeFileSync(DATA_PATH, JSON.stringify({}, null, 4));
}

function saveData() {
    fs.writeFileSync(DATA_PATH, JSON.stringify(shiftData, null, 4));
}

module.exports = {
    registerShiftManageCommand,
    registerShiftManageHandlers,
    handleShiftButtons
};

// -------------------- REGISTER COMMAND -------------------- //
async function registerShiftManageCommand(client, config) {
    const commands = client.application.commands;

    await commands.create(
        new SlashCommandBuilder()
            .setName('shift')
            .setDescription('Shift management commands')
            .addSubcommand(sub =>
                sub.setName('manage')
                    .setDescription('Start managing your shift')
                    .addStringOption(opt =>
                        opt.setName('type')
                            .setDescription('Shift Type')
                            .setRequired(true)
                            .addChoices(
                                ...Object.keys(config.SHIFT_TYPES).map(type => ({
                                    name: type,
                                    value: type
                                }))
                            )
                    )
            )
    );

    console.log("✅ /shift manage registered");
}

// -------------------- EVENT HANDLERS -------------------- //
function registerShiftManageHandlers(client, config) {
    client.on('interactionCreate', async interaction => {
        try {
            if (interaction.isChatInputCommand()) {
                if (interaction.commandName === "shift" && interaction.options.getSubcommand() === "manage") {
                    console.log(`[DEBUG] Shift manage command triggered by ${interaction.user.tag}`);
                    await handleShiftManage(interaction, config);
                }
            }

            if (interaction.isButton() && interaction.customId.startsWith("SHIFT_")) {
                console.log(`[DEBUG] Shift button clicked: ${interaction.customId} by ${interaction.user.tag}`);
                await handleShiftButtons(interaction, config);
            }
        } catch (err) {
            console.error("❌ Error handling interaction:", err);
            if (!interaction.replied && !interaction.deferred) {
                try { await interaction.reply({ content: "⚠️ Interaction expired or failed.", ephemeral: true }); } catch {}
            }
        }
    });
}

// -------------------- HANDLE SHIFT MANAGE -------------------- //
async function handleShiftManage(interaction, config) {
    try {
        const user = interaction.user;
        const shiftType = interaction.options.getString('type');
        const typeInfo = config.SHIFT_TYPES[shiftType];

        if (!typeInfo) {
            console.log(`[DEBUG] Invalid shift type: ${shiftType}`);
            return interaction.reply({ content: "❌ Invalid shift type.", ephemeral: true });
        }

        if (!interaction.member.roles.cache.has(typeInfo.role)) {
            console.log(`[DEBUG] User ${user.tag} missing role for ${shiftType}`);
            return interaction.reply({ content: "❌ You don't have permission to start this shift type.", ephemeral: true });
        }

        if (!shiftData[user.id]) shiftData[user.id] = { activeShifts: {}, allTimeCount: {}, allTimeDuration: {}, lastShift: {} };

        if (!shiftData[user.id].allTimeCount[shiftType]) shiftData[user.id].allTimeCount[shiftType] = 0;
        if (!shiftData[user.id].allTimeDuration[shiftType]) shiftData[user.id].allTimeDuration[shiftType] = 0;

        const embed = new EmbedBuilder()
            .setAuthor({ name: `Shift Management | ${shiftType}`, iconURL: user.displayAvatarURL() })
            .setTitle("All Time Information")
            .setDescription(
                `**Shift Count:** ${shiftData[user.id].allTimeCount[shiftType]}\n` +
                `**Total Duration:** ${formatDuration(shiftData[user.id].allTimeDuration[shiftType])}\n` +
                `**Average Duration:** ${formatDuration(
                    shiftData[user.id].allTimeCount[shiftType] === 0
                        ? 0
                        : Math.floor(shiftData[user.id].allTimeDuration[shiftType] / shiftData[user.id].allTimeCount[shiftType])
                )}`
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`SHIFT_START_${shiftType}`).setLabel("Start").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`SHIFT_PAUSE_${shiftType}`).setLabel("Pause").setStyle(ButtonStyle.Secondary).setDisabled(false),
            new ButtonBuilder().setCustomId(`SHIFT_END_${shiftType}`).setLabel("End").setStyle(ButtonStyle.Danger).setDisabled(false)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
        console.log(`[DEBUG] Shift manage UI sent for ${user.tag}`);
    } catch (err) {
        console.error("❌ Error in handleShiftManage:", err);
    }
}

// -------------------- HANDLE BUTTONS -------------------- //
async function handleShiftButtons(interaction, config) {
    try {
        const user = interaction.user;
        const uid = user.id;
        const customId = interaction.customId;

        if (!shiftData[uid]) shiftData[uid] = { activeShifts: {}, allTimeCount: {}, allTimeDuration: {}, lastShift: {} };

        // Determine shiftType from customId
        const shiftTypeMatch = customId.match(/SHIFT_(START|PAUSE|END)_(.+)/);
        if (!shiftTypeMatch) return;

        const action = shiftTypeMatch[1];
        const shiftType = shiftTypeMatch[2];
        const typeInfo = config.SHIFT_TYPES[shiftType];
        if (!typeInfo) return;

        if (!shiftData[uid].activeShifts[shiftType]) shiftData[uid].activeShifts[shiftType] = null;

        let shift = shiftData[uid].activeShifts[shiftType];

        const now = Date.now();

        // --------------- START SHIFT ---------------
        if (action === "START") {
            if (shift && !shift.ended) {
                return interaction.reply({ content: "⚠️ This shift is already started.", ephemeral: true });
            }

            // Give role
            if (typeInfo.role) await interaction.member.roles.add(typeInfo.role).catch(() => {});

            shiftData[uid].activeShifts[shiftType] = {
                type: shiftType,
                started: now,
                breakTotal: 0,
                onBreak: false,
                lastBreakStart: null,
                ended: false
            };
            saveData();

            const embed = new EmbedBuilder()
                .setAuthor({ name: `Shift Management | ${shiftType}`, iconURL: user.displayAvatarURL() })
                .setTitle("Shift Started")
                .setDescription(
                    "**Current Shift**\n" +
                    "**Status:** On Shift\n" +
                    `**Started:** <t:${Math.floor(now / 1000)}:R>`
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`SHIFT_START_${shiftType}`).setLabel("Start").setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId(`SHIFT_PAUSE_${shiftType}`).setLabel("Pause").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`SHIFT_END_${shiftType}`).setLabel("End").setStyle(ButtonStyle.Danger)
            );

            await interaction.update({ embeds: [embed], components: [row] });
            console.log(`[DEBUG] Shift STARTED for ${user.tag}`);

            const channel = interaction.client.channels.cache.get(typeInfo.logChannel);
            if (channel) channel.send(`📗 **Shift Started** — <@${uid}> (${shiftType})`);
            return;
        }

        // --------------- PAUSE / RESUME SHIFT ---------------
        if (action === "PAUSE") {
            if (!shift || shift.ended) return interaction.reply({ content: "⚠️ No active shift to pause/resume.", ephemeral: true });

            if (!shift.onBreak) {
                // Start break → remove role
                shift.lastBreakStart = now;
                shift.onBreak = true;
                if (typeInfo.role) await interaction.member.roles.remove(typeInfo.role).catch(() => {});
            } else {
                // Resume → add role back
                shift.breakTotal += now - shift.lastBreakStart;
                shift.lastBreakStart = null;
                shift.onBreak = false;
                if (typeInfo.role) await interaction.member.roles.add(typeInfo.role).catch(() => {});
            }
            saveData();

            const embed = new EmbedBuilder()
                .setAuthor({ name: `Shift Management | ${shiftType}`, iconURL: user.displayAvatarURL() })
                .setTitle(shift.onBreak ? "Break Started" : "Break Ended")
                .setDescription(
                    "**Current Shift**\n" +
                    `**Status:** ${shift.onBreak ? "On Break" : "On Shift"}\n` +
                    `**Shift Started:** <t:${Math.floor(shift.started / 1000)}:R>` +
                    (shift.onBreak ? `\n**Break Started:** <t:${Math.floor(shift.lastBreakStart / 1000)}:R>` : "")
                );

            await interaction.update({ embeds: [embed] });
            console.log(`[DEBUG] Shift ${shift.onBreak ? "PAUSED" : "RESUMED"} for ${user.tag}`);
            return;
        }

        // --------------- END SHIFT ---------------
        if (action === "END") {
            if (!shift || shift.ended) return interaction.reply({ content: "⚠️ No active shift to end.", ephemeral: true });

            if (shift.onBreak && shift.lastBreakStart) shift.breakTotal += now - shift.lastBreakStart;

            const totalShift = now - shift.started;
            const cleanTime = totalShift - shift.breakTotal;

            // Update allTime stats
            shiftData[uid].allTimeCount[shiftType] = (shiftData[uid].allTimeCount[shiftType] || 0) + 1;
            shiftData[uid].allTimeDuration[shiftType] = (shiftData[uid].allTimeDuration[shiftType] || 0) + cleanTime;
            shiftData[uid].lastShift[shiftType] = { status: "Ended", totalTime: cleanTime };

            // Remove role
            if (typeInfo.role) await interaction.member.roles.remove(typeInfo.role).catch(() => {});

            shift.ended = true;
            shiftData[uid].activeShifts[shiftType] = null;
            saveData();

            const embed = new EmbedBuilder()
                .setAuthor({ name: `Shift Management | ${shiftType}`, iconURL: user.displayAvatarURL() })
                .setTitle("Shift Ended")
                .setDescription(
                    `**Shift Count:** ${shiftData[uid].allTimeCount[shiftType]}\n` +
                    `**Total Duration:** ${formatDuration(shiftData[uid].allTimeDuration[shiftType])}\n` +
                    `**Average Duration:** ${formatDuration(shiftData[uid].allTimeDuration[shiftType] / shiftData[uid].allTimeCount[shiftType])}`
                );

            await interaction.update({ embeds: [embed] });
            console.log(`[DEBUG] Shift ENDED for ${user.tag} — Duration: ${cleanTime}ms`);

            const channel = interaction.client.channels.cache.get(typeInfo.logChannel);
            if (channel) channel.send(`📕 **Shift Ended** — <@${uid}> (${shiftType}) — ${formatDuration(cleanTime)}`);
            return;
        }

    } catch (err) {
        console.error("❌ Error in handleShiftButtons:", err);
        if (!interaction.replied && !interaction.deferred) {
            try { await interaction.reply({ content: "⚠️ Interaction expired or failed.", ephemeral: true }); } catch {}
        }
    }
}

// -------------------- HELPER -------------------- //
function formatDuration(ms) {
    if (!ms || ms < 1000) return ms + "ms";
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec} Seconds`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} Minutes`;
    const hr = Math.floor(min / 60);
    return `${hr} Hours ${min % 60} Minutes`;
}
