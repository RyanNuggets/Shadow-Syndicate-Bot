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

module.exports = {
    registerShiftManageCommand,
    registerShiftManageHandlers,
    handleShiftButtons
};

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

// Only register slash commands handler (no button handling here!)
function registerShiftManageHandlers(client, config) {
    client.on('interactionCreate', async interaction => {
        try {
            if (!interaction.isChatInputCommand()) return;

            if (interaction.commandName === "shift" && interaction.options.getSubcommand() === "manage") {
                console.log(`[DEBUG] Shift manage command triggered by ${interaction.user.tag}`);
                await handleShiftManage(interaction, config);
            }
        } catch (err) {
            console.error("❌ Error in shift command handler:", err);
            if (!interaction.replied && !interaction.deferred) {
                try {
                    await interaction.reply({ content: "⚠️ Interaction failed.", ephemeral: true });
                } catch {}
            }
        }
    });
}

async function handleShiftManage(interaction, config) {
    try {
        const user = interaction.user;
        const shiftType = interaction.options.getString('type');
        const typeInfo = config.SHIFT_TYPES[shiftType];

        if (!typeInfo) {
            console.log(`[DEBUG] Invalid shift type: ${shiftType}`);
            return interaction.reply({ content: "❌ Invalid shift type.", ephemeral: true });
        }

        const requiredRole = typeInfo.role;
        if (!interaction.member.roles.cache.has(requiredRole)) {
            console.log(`[DEBUG] User ${user.tag} missing role for ${shiftType}`);
            return interaction.reply({ content: "❌ You don't have permission to start this shift type.", ephemeral: true });
        }

        if (!shiftData[user.id]) {
            shiftData[user.id] = {
                allTimeCount: 0,
                allTimeDuration: 0,
                lastShift: null
            };
            saveData();
        }

        const embed = new EmbedBuilder()
            .setAuthor({ name: `Shift Management | ${shiftType}`, iconURL: user.displayAvatarURL() })
            .setTitle("All Time Information")
            .setDescription(
                `**Shift Count:** ${shiftData[user.id].allTimeCount}\n` +
                `**Total Duration:** ${formatDuration(shiftData[user.id].allTimeDuration)}\n` +
                `**Average Duration:** ${formatDuration(
                    shiftData[user.id].allTimeCount === 0
                        ? 0
                        : Math.floor(shiftData[user.id].allTimeDuration / shiftData[user.id].allTimeCount)
                )}`
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`SHIFT_START_${shiftType}`).setLabel("Start").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("SHIFT_PAUSE").setLabel("Pause").setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId("SHIFT_END").setLabel("End").setStyle(ButtonStyle.Danger).setDisabled(true)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
        console.log(`[DEBUG] Shift manage UI sent for ${user.tag}`);
    } catch (err) {
        console.error("❌ Error in handleShiftManage:", err);
    }
}

async function handleShiftButtons(interaction, config) {
    try {
        const user = interaction.user;
        const uid = user.id;

        if (!shiftData[uid]) {
            shiftData[uid] = {
                allTimeCount: 0,
                allTimeDuration: 0,
                lastShift: null
            };
        }

        let shift = shiftData[uid].activeShift || null;

        // START SHIFT
        if (interaction.customId.startsWith("SHIFT_START")) {
            const shiftType = interaction.customId.replace("SHIFT_START_", "");
            const typeInfo = config.SHIFT_TYPES[shiftType];
            const now = Date.now();

            shiftData[uid].activeShift = {
                type: shiftType,
                started: now,
                breakTotal: 0,
                lastBreakStart: null
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
                new ButtonBuilder().setCustomId("START_DISABLED").setLabel("Start").setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId("SHIFT_PAUSE").setLabel("Pause").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId("SHIFT_END").setLabel("End").setStyle(ButtonStyle.Danger)
            );

            await interaction.editReply({ embeds: [embed], components: [row] });
            console.log(`[DEBUG] Shift started for ${user.tag}`);

            const channel = interaction.client.channels.cache.get(typeInfo.logChannel);
            if (channel) channel.send(`📗 **Shift Started** — <@${uid}> (${shiftType})`);
            return;
        }

        // PAUSE SHIFT
        if (interaction.customId === "SHIFT_PAUSE") {
            shift = shiftData[uid].activeShift;
            if (!shift) return interaction.followUp({ content: "❌ No active shift.", ephemeral: true });

            shift.lastBreakStart = Date.now();
            saveData();

            const embed = new EmbedBuilder()
                .setAuthor({ name: `Shift Management | ${shift.type}`, iconURL: user.displayAvatarURL() })
                .setTitle("Break Started")
                .setDescription(
                    "**Current Shift**\n" +
                    "**Status:** On Break\n" +
                    `**Shift Started:** <t:${Math.floor(shift.started / 1000)}:R>\n` +
                    `**Break Started:** <t:${Math.floor(shift.lastBreakStart / 1000)}:R>`
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("START_DISABLED").setLabel("Start").setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId("PAUSE_DISABLED").setLabel("Pause").setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId("SHIFT_END").setLabel("End").setStyle(ButtonStyle.Danger)
            );

            await interaction.editReply({ embeds: [embed], components: [row] });
            console.log(`[DEBUG] Break started for ${user.tag}`);
            return;
        }

        // END SHIFT
        if (interaction.customId === "SHIFT_END") {
            shift = shiftData[uid].activeShift;
            if (!shift) return interaction.followUp({ content: "❌ No active shift.", ephemeral: true });

            const now = Date.now();
            if (shift.lastBreakStart) shift.breakTotal += now - shift.lastBreakStart;

            const totalShift = now - shift.started;
            const cleanTime = totalShift - shift.breakTotal;

            shiftData[uid].allTimeCount++;
            shiftData[uid].allTimeDuration += cleanTime;
            shiftData[uid].lastShift = {
                status: "Ended",
                totalTime: cleanTime
            };

            delete shiftData[uid].activeShift;
            saveData();

            const embed = new EmbedBuilder()
                .setAuthor({ name: `Shift Management | ${shift.type}`, iconURL: user.displayAvatarURL() })
                .setTitle("All Time Information")
                .setDescription(
                    `**Shift Count:** ${shiftData[uid].allTimeCount}\n` +
                    `**Total Duration:** ${formatDuration(shiftData[uid].allTimeDuration)}\n` +
                    `**Average Duration:** ${formatDuration(shiftData[uid].allTimeDuration / shiftData[uid].allTimeCount)}\n\n` +
                    "__Last Shift__\n" +
                    `**Status:** Ended\n` +
                    `**Total Time:** ${formatDuration(cleanTime)}`
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("SHIFT_START_" + shift.type).setLabel("Start").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId("PAUSE_DISABLED").setLabel("Pause").setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId("END_DISABLED").setLabel("End").setStyle(ButtonStyle.Danger).setDisabled(true)
            );

            await interaction.editReply({ embeds: [embed], components: [row] });
            console.log(`[DEBUG] Shift ended for ${user.tag} — Duration: ${cleanTime}ms`);

            const typeInfo = config.SHIFT_TYPES[shift.type];
            const channel = interaction.client.channels.cache.get(typeInfo.logChannel);
            if (channel) channel.send(`📕 **Shift Ended** — <@${uid}> (${shift.type}) — ${formatDuration(cleanTime)}`);
            return;
        }
    } catch (err) {
        console.error("❌ Error in handleShiftButtons:", err);
        if (!interaction.replied && !interaction.deferred) {
            try {
                await interaction.followUp({ content: "⚠️ Interaction expired or failed.", ephemeral: true });
            } catch {}
        }
    }
}

function formatDuration(ms) {
    if (!ms || ms < 1000) return ms + "ms";
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec} Seconds`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} Minutes`;
    const hr = Math.floor(min / 60);
    return `${hr} Hours ${min % 60} Minutes`;
}
