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

async function handleShiftManage(interaction, config) {
    const user = interaction.user;
    const shiftType = interaction.options.getString('type');
    const typeInfo = config.SHIFT_TYPES[shiftType];

    if (!typeInfo) return interaction.reply({ content: "❌ Invalid shift type.", ephemeral: true });

    if (!interaction.member.roles.cache.has(typeInfo.role)) {
        return interaction.reply({ content: "❌ You don't have permission to start this shift type.", ephemeral: true });
    }

    if (!shiftData[user.id]) shiftData[user.id] = {};
    if (!shiftData[user.id][shiftType]) {
        shiftData[user.id][shiftType] = { allTimeCount: 0, allTimeDuration: 0, lastShift: null, activeShift: null };
        saveData();
    }

    const embed = new EmbedBuilder()
        .setAuthor({ name: `Shift Management | ${shiftType}`, iconURL: user.displayAvatarURL() })
        .setTitle("All Time Information")
        .setDescription(
            `**Shift Count:** ${shiftData[user.id][shiftType].allTimeCount}\n` +
            `**Total Duration:** ${formatDuration(shiftData[user.id][shiftType].allTimeDuration)}\n` +
            `**Average Duration:** ${formatDuration(
                shiftData[user.id][shiftType].allTimeCount === 0
                    ? 0
                    : Math.floor(shiftData[user.id][shiftType].allTimeDuration / shiftData[user.id][shiftType].allTimeCount)
            )}`
        );

    const active = shiftData[user.id][shiftType].activeShift;

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`SHIFT_START_${shiftType}`)
            .setLabel("Start")
            .setStyle(ButtonStyle.Success)
            .setDisabled(!!active),
        new ButtonBuilder()
            .setCustomId(`SHIFT_PAUSE_${shiftType}`)
            .setLabel(active && active.onBreak ? "Resume" : "Pause")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!active),
        new ButtonBuilder()
            .setCustomId(`SHIFT_END_${shiftType}`)
            .setLabel("End")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!active)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
}

async function handleShiftButtons(interaction, config) {
    const user = interaction.user;
    const uid = user.id;
    const [action, type] = interaction.customId.split("_").slice(1); // e.g., SHIFT_START_DHS -> ["START", "DHS"]

    const typeInfo = config.SHIFT_TYPES[type];
    if (!typeInfo) return;

    if (!shiftData[uid]) shiftData[uid] = {};
    if (!shiftData[uid][type]) shiftData[uid][type] = { allTimeCount: 0, allTimeDuration: 0, lastShift: null, activeShift: null };

    let shift = shiftData[uid][type].activeShift;

    const member = interaction.member;

    if (action === "START") {
        if (shift) return; // already started

        const now = Date.now();
        shiftData[uid][type].activeShift = { type, started: now, breakTotal: 0, lastBreakStart: null, onBreak: false };
        saveData();

        // Add onduty role
        if (typeInfo.ondutyRole) await member.roles.add(typeInfo.ondutyRole).catch(() => {});

        const embed = new EmbedBuilder()
            .setAuthor({ name: `Shift Management | ${type}`, iconURL: user.displayAvatarURL() })
            .setTitle("Shift Started")
            .setDescription(`**Status:** On Shift\n**Started:** <t:${Math.floor(now / 1000)}:R>`);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`SHIFT_START_${type}`).setLabel("Start").setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId(`SHIFT_PAUSE_${type}`).setLabel("Pause").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`SHIFT_END_${type}`).setLabel("End").setStyle(ButtonStyle.Danger)
        );

        await interaction.update({ embeds: [embed], components: [row] });

        const logChannel = interaction.client.channels.cache.get(typeInfo.logChannel);
        if (logChannel) logChannel.send(`📗 **Shift Started** — <@${uid}> (${type})`);
        return;
    }

    if (action === "PAUSE") {
        if (!shift) return;

        shift.onBreak = !shift.onBreak;
        if (shift.onBreak) {
            shift.lastBreakStart = Date.now();
            if (typeInfo.ondutyRole) await member.roles.remove(typeInfo.ondutyRole).catch(() => {});
        } else {
            shift.breakTotal += Date.now() - (shift.lastBreakStart || Date.now());
            shift.lastBreakStart = null;
            if (typeInfo.ondutyRole) await member.roles.add(typeInfo.ondutyRole).catch(() => {});
        }
        saveData();

        const embed = new EmbedBuilder()
            .setAuthor({ name: `Shift Management | ${type}`, iconURL: user.displayAvatarURL() })
            .setTitle(shift.onBreak ? "Break Started" : "Break Ended")
            .setDescription(
                `**Status:** ${shift.onBreak ? "On Break" : "On Shift"}\n` +
                `**Shift Started:** <t:${Math.floor(shift.started / 1000)}:R>` +
                (shift.onBreak ? `\n**Break Started:** <t:${Math.floor(shift.lastBreakStart / 1000)}:R>` : "")
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`SHIFT_START_${type}`).setLabel("Start").setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId(`SHIFT_PAUSE_${type}`).setLabel(shift.onBreak ? "Resume" : "Pause").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`SHIFT_END_${type}`).setLabel("End").setStyle(ButtonStyle.Danger)
        );

        await interaction.update({ embeds: [embed], components: [row] });
        return;
    }

    if (action === "END") {
        if (!shift) return;

        const now = Date.now();
        if (shift.onBreak && shift.lastBreakStart) shift.breakTotal += now - shift.lastBreakStart;
        const totalShift = now - shift.started - (shift.breakTotal || 0);

        shiftData[uid][type].allTimeCount++;
        shiftData[uid][type].allTimeDuration += totalShift;
        shiftData[uid][type].lastShift = { status: "Ended", totalTime: totalShift };
        shiftData[uid][type].activeShift = null;
        saveData();

        if (typeInfo.ondutyRole) await member.roles.remove(typeInfo.ondutyRole).catch(() => {});

        const embed = new EmbedBuilder()
            .setAuthor({ name: `Shift Management | ${type}`, iconURL: user.displayAvatarURL() })
            .setTitle("Shift Ended")
            .setDescription(
                `**Shift Count:** ${shiftData[uid][type].allTimeCount}\n` +
                `**Total Duration:** ${formatDuration(shiftData[uid][type].allTimeDuration)}\n` +
                `**Average Duration:** ${formatDuration(shiftData[uid][type].allTimeDuration / shiftData[uid][type].allTimeCount)}`
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`SHIFT_START_${type}`).setLabel("Start").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`SHIFT_PAUSE_${type}`).setLabel("Pause").setStyle(ButtonStyle.Primary).setDisabled(true),
            new ButtonBuilder().setCustomId(`SHIFT_END_${type}`).setLabel("End").setStyle(ButtonStyle.Danger).setDisabled(true)
        );

        await interaction.update({ embeds: [embed], components: [row] });

        const logChannel = interaction.client.channels.cache.get(typeInfo.logChannel);
        if (logChannel) logChannel.send(`📕 **Shift Ended** — <@${uid}> (${type}) — ${formatDuration(totalShift)}`);
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
