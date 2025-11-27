// Features/ShiftManagement/shiftmanage.js
const { 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');

const fs = require('fs');
const path = require('path');

// Path to persistent storage
const shiftsPath = path.join(__dirname, 'shifts.json');

// Load existing shifts OR create new file
let activeShifts = {};
try {
    if (fs.existsSync(shiftsPath)) {
        activeShifts = JSON.parse(fs.readFileSync(shiftsPath, 'utf8'));
    }
} catch (err) {
    console.error("Failed to read shifts.json:", err);
}

// Save function
function saveShifts() {
    fs.writeFileSync(shiftsPath, JSON.stringify(activeShifts, null, 4));
}

// ------------------------------------------------------------------------------------
// /shift command registration
// ------------------------------------------------------------------------------------
module.exports.registerShiftManageCommand = async (client, config) => {
    try {
        await client.application.commands.create(
            new SlashCommandBuilder()
                .setName("shift")
                .setDescription("Start, pause, resume, or end your shift.")
        );

        console.log("ShiftManagement: /shift command registered.");
    } catch (err) {
        console.error("ShiftManagement: Failed to register /shift.", err);
    }
};

// ------------------------------------------------------------------------------------
// Button Handler Logic
// ------------------------------------------------------------------------------------
module.exports.registerShiftManageHandlers = (client, config) => {

    client.on("interactionCreate", async interaction => {
        if (interaction.isChatInputCommand() && interaction.commandName === "shift") {
            return handleShiftCommand(interaction);
        }

        if (interaction.isButton()) {
            return handleShiftButton(interaction);
        }
    });

};

// ------------------------------------------------------------------------------------
// Send shift control panel
// ------------------------------------------------------------------------------------
async function handleShiftCommand(interaction) {

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("shift_start")
            .setLabel("Start Shift")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId("shift_pause")
            .setLabel("Pause")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("shift_resume")
            .setLabel("Resume")
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId("shift_end")
            .setLabel("End Shift")
            .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
        content: "Shift Control Panel:",
        components: [row],
        ephemeral: true
    });
}

// ------------------------------------------------------------------------------------
// Button Handler
// ------------------------------------------------------------------------------------
async function handleShiftButton(interaction) {
    const userId = interaction.user.id;

    // ALWAYS ack button so it doesn’t timeout
    await interaction.deferReply({ ephemeral: true });

    switch (interaction.customId) {

        case "shift_start":
            return startShift(interaction, userId);

        case "shift_pause":
            return pauseShift(interaction, userId);

        case "shift_resume":
            return resumeShift(interaction, userId);

        case "shift_end":
            return endShift(interaction, userId);
    }
}

// ------------------------------------------------------------------------------------
// SHIFT LOGIC FUNCTIONS
// ------------------------------------------------------------------------------------
function startShift(interaction, userId) {

    if (activeShifts[userId]?.active) {
        return interaction.editReply("❌ You already have an active shift.");
    }

    activeShifts[userId] = {
        active: true,
        startTime: Date.now(),
        paused: false,
        pausedTime: null,
        totalPausedDuration: 0
    };

    saveShifts();
    return interaction.editReply("✅ Shift started.");
}

function pauseShift(interaction, userId) {

    const shift = activeShifts[userId];

    if (!shift?.active) {
        return interaction.editReply("❌ You don't have an active shift.");
    }
    if (shift.paused) {
        return interaction.editReply("❌ Your shift is already paused.");
    }

    shift.paused = true;
    shift.pausedTime = Date.now();

    saveShifts();
    return interaction.editReply("⏸️ Shift paused.");
}

function resumeShift(interaction, userId) {

    const shift = activeShifts[userId];

    if (!shift?.active) {
        return interaction.editReply("❌ You don't have an active shift.");
    }
    if (!shift.paused) {
        return interaction.editReply("❌ Your shift is not paused.");
    }

    const pausedDuration = Date.now() - shift.pausedTime;
    shift.totalPausedDuration += pausedDuration;

    shift.paused = false;
    shift.pausedTime = null;

    saveShifts();
    return interaction.editReply("▶️ Shift resumed.");
}

function endShift(interaction, userId) {

    const shift = activeShifts[userId];

    if (!shift?.active) {
        return interaction.editReply("❌ You don't have an active shift.");
    }

    let totalTime = Date.now() - shift.startTime - shift.totalPausedDuration;

    delete activeShifts[userId];
    saveShifts();

    const minutes = Math.floor(totalTime / 60000);

    return interaction.editReply(`🛑 Shift ended.\nTotal time worked: **${minutes} minutes**.`);
}
