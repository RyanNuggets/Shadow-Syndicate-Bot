// /Features/ShiftManagement/shiftmanage.js
const {
    SlashCommandBuilder,
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

// Safe update helper to avoid InteractionAlreadyReplied
async function safeUpdate(interaction, options) {
    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply(options);
        } else {
            await interaction.update(options);
        }
    } catch (err) {
        console.error("❌ Failed safe update:", err);
    }
}

module.exports = {
    registerShiftManageCommand,
    registerShiftManageHandlers,
    handleShiftButtons
};

// ---------------- COMMAND REGISTRATION ----------------
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

// ---------------- INTERACTION HANDLERS ----------------
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
                try {
                    await interaction.reply({ content: "⚠️ Interaction expired or failed.", ephemeral: true });
                } catch {}
            }
        }
    });
}

// ---------------- SHIFT COMMAND ----------------
async function handleShiftManage(interaction, config) {
    const user = interaction.user;
    const shiftType = interaction.options.getString('type');
    const typeInfo = config.SHIFT_TYPES[shiftType];

    if (!typeInfo) {
        return interaction.reply({ content: "❌ Invalid shift type.", ephemeral: true });
    }

    const requiredRole = typeInfo.role;
    if (!interaction.member.roles.cache.has(requiredRole)) {
        return interaction.reply({ content: "❌ You don't have permission to start this shift type.", ephemeral: true });
    }

    if (!shiftData[user.id]) {
        shiftData[user.id] = {};
    }

    if (!shiftData[user.id][shiftType]) {
        shiftData[user.id][shiftType] = {
            allTimeCount: 0,
            allTimeDuration: 0,
            lastShift: null,
            activeShift: null
        };
    }

    const data = shiftData[user.id][shiftType];

    const embed = new EmbedBuilder()
        .setAuthor({ name: `Shift Management | ${shiftType}`, iconURL: user.displayAvatarURL() })
        .setTitle("All Time Information")
        .setDescription(
            `**Shift Count:** ${data.allTimeCount}\n` +
            `**Total Duration:** ${formatDuration(data.allTimeDuration)}\n` +
            `**Average Duration:** ${formatDuration(
                data.allTimeCount === 0 ? 0 : Math.floor(data.allTimeDuration / data.allTimeCount)
            )}`
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`SHIFT_START_${shiftType}`).setLabel("Start").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`SHIFT_PAUSE_${shiftType}`).setLabel("Pause").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`SHIFT_END_${shiftType}`).setLabel("End").setStyle(ButtonStyle.Danger).setDisabled(true)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
}

// ---------------- BUTTON HANDLER ----------------
async function handleShiftButtons(interaction, config) {
    const user = interaction.user;
    const uid = user.id;

    const [action, ...rest] = interaction.customId.split("_");
    const shiftType = rest.join("_");

    if (!shiftData[uid]) shiftData[uid] = {};
    if (!shiftData[uid][shiftType]) shiftData[uid][shiftType] = {
        allTimeCount: 0,
        allTimeDuration: 0,
        lastShift: null,
        activeShift: null
    };

    const data = shiftData[uid][shiftType];
    const typeInfo = config.SHIFT_TYPES[shiftType];

    const member = interaction.member;

    // ---------- START ----------
    if (action === "SHIFT" && rest[0] === "START") {
        const now = Date.now();

        data.activeShift = {
            started: now,
            breakTotal: 0,
            lastBreakStart: null,
            status: "onShift"
        };

        // Add onduty role
        if (typeInfo.ondutyRole && !member.roles.cache.has(typeInfo.ondutyRole)) {
            await member.roles.add(typeInfo.ondutyRole).catch(console.error);
        }

        const embed = new EmbedBuilder()
            .setAuthor({ name: `Shift Management | ${shiftType}`, iconURL: user.displayAvatarURL() })
            .setTitle("Shift Started")
            .setDescription(
                "**Current Shift**\n" +
                "**Status:** On Shift\n" +
                `**Started:** <t:${Math.floor(now / 1000)}:R>`
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`START_DISABLED`).setLabel("Start").setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId(`SHIFT_PAUSE_${shiftType}`).setLabel("Pause").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`SHIFT_END_${shiftType}`).setLabel("End").setStyle(ButtonStyle.Danger)
        );

        saveData();
        console.log(`[DEBUG] Shift started: ${shiftType} by ${user.tag}`);
        await safeUpdate(interaction, { embeds: [embed], components: [row] });

        const channel = interaction.client.channels.cache.get(typeInfo.logChannel);
        if (channel) channel.send(`📗 **Shift Started** — <@${uid}> (${shiftType})`);
        return;
    }

    // ---------- PAUSE / UNPAUSE ----------
    if (action === "SHIFT" && rest[0] === "PAUSE") {
        const shift = data.activeShift;
        if (!shift) return interaction.reply({ content: "❌ No active shift.", ephemeral: true });

        const now = Date.now();

        if (shift.status === "onShift") {
            // Going on break
            shift.lastBreakStart = now;
            shift.status = "onBreak";

            // Remove onduty role
            if (typeInfo.ondutyRole && member.roles.cache.has(typeInfo.ondutyRole)) {
                await member.roles.remove(typeInfo.ondutyRole).catch(console.error);
            }
        } else if (shift.status === "onBreak") {
            // Resuming shift
            shift.breakTotal += now - shift.lastBreakStart;
            shift.lastBreakStart = null;
            shift.status = "onShift";

            // Add onduty role back
            if (typeInfo.ondutyRole && !member.roles.cache.has(typeInfo.ondutyRole)) {
                await member.roles.add(typeInfo.ondutyRole).catch(console.error);
            }
        }

        const embed = new EmbedBuilder()
            .setAuthor({ name: `Shift Management | ${shiftType}`, iconURL: user.displayAvatarURL() })
            .setTitle(shift.status === "onBreak" ? "Break Started" : "Shift Resumed")
            .setDescription(
                "**Current Shift**\n" +
                `**Status:** ${shift.status === "onBreak" ? "On Break" : "On Shift"}\n` +
                `**Shift Started:** <t:${Math.floor(shift.started / 1000)}:R>\n` +
                (shift.status === "onBreak" ? `**Break Started:** <t:${Math.floor(shift.lastBreakStart / 1000)}:R>` : '')
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`START_DISABLED`).setLabel("Start").setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId(`SHIFT_PAUSE_${shiftType}`).setLabel("Pause").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`SHIFT_END_${shiftType}`).setLabel("End").setStyle(ButtonStyle.Danger)
        );

        saveData();
        await safeUpdate(interaction, { embeds: [embed], components: [row] });
        console.log(`[DEBUG] Shift ${shift.status === "onBreak" ? "paused" : "resumed"}: ${shiftType} by ${user.tag}`);
        return;
    }

    // ---------- END ----------
    if (action === "SHIFT" && rest[0] === "END") {
        const shift = data.activeShift;
        if (!shift) return interaction.reply({ content: "❌ No active shift.", ephemeral: true });

        const now = Date.now();

        if (shift.status === "onBreak" && shift.lastBreakStart) {
            shift.breakTotal += now - shift.lastBreakStart;
        }

        const totalShift = now - shift.started;
        const cleanTime = totalShift - shift.breakTotal;

        data.allTimeCount++;
        data.allTimeDuration += cleanTime;
        data.lastShift = { status: "Ended", totalTime: cleanTime };
        data.activeShift = null;

        // Remove onduty role
        if (typeInfo.ondutyRole && member.roles.cache.has(typeInfo.ondutyRole)) {
            await member.roles.remove(typeInfo.ondutyRole).catch(console.error);
        }

        const embed = new EmbedBuilder()
            .setAuthor({ name: `Shift Management | ${shiftType}`, iconURL: user.displayAvatarURL() })
            .setTitle("Shift Ended")
            .setDescription(
                `**Shift Count:** ${data.allTimeCount}\n` +
                `**Total Duration:** ${formatDuration(data.allTimeDuration)}\n` +
                `**Average Duration:** ${formatDuration(data.allTimeDuration / data.allTimeCount)}\n\n` +
                "__Last Shift__\n" +
                `**Status:** Ended\n` +
                `**Total Time:** ${formatDuration(cleanTime)}`
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`SHIFT_START_${shiftType}`).setLabel("Start").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`SHIFT_PAUSE_${shiftType}`).setLabel("Pause").setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId(`SHIFT_END_${shiftType}`).setLabel("End").setStyle(ButtonStyle.Danger).setDisabled(true)
        );

        saveData();
        await safeUpdate(interaction, { embeds: [embed], components: [row] });
        console.log(`[DEBUG] Shift ended: ${shiftType} by ${user.tag} — Duration: ${cleanTime}ms`);

        const channel = interaction.client.channels.cache.get(typeInfo.logChannel);
        if (channel) channel.send(`📕 **Shift Ended** — <@${uid}> (${shiftType}) — ${formatDuration(cleanTime)}`);
        return;
    }
}

// ---------------- UTIL ----------------
function formatDuration(ms) {
    if (!ms || ms < 1000) return ms + "ms";
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec} Seconds`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} Minutes`;
    const hr = Math.floor(min / 60);
    return `${hr} Hours ${min % 60} Minutes`;
}
