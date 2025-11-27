// index.js (with config.json + debug for interactions)
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ---------------- CONFIG ---------------- //
const configPath = path.join(__dirname, 'config.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
    console.error("FATAL ERROR: Could not load config.json.", error);
    process.exit(1);
}

if (!process.env.DISCORD_TOKEN) {
    console.error("FATAL ERROR: DISCORD_TOKEN not set.");
    process.exit(1);
}
// ---------------------------------------- //

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ---------------- MODULE IMPORTS ---------------- //
const timestampModule = require('./Features/timestamp');
const promotionInfractionModule = require('./Features/promotion-infraction');
const logArrestModule = require('./Features/logarrest');
const availableCallsignsModule = require('./Features/availablecallsigns');
const autoroleModule = require('./Features/autorole');
const blsExamModule = require('./Features/blsexam');
const rankModule = require('./Features/rank');
const shiftManageModule = require('./Features/ShiftManagement/shiftmanage');
// -------------------------------------------------- //

// ---------------- READY EVENT ---------------- //
client.once('ready', async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}!`);

    try {
        await timestampModule.registerTimestampCommand(client, config);
        await promotionInfractionModule.registerPromotionInfractionCommand(client, config);
        await logArrestModule.registerLogArrestCommand(client, config);
        await availableCallsignsModule.registerAvailableCallsignsCommand(client, config);
        await autoroleModule.registerAutoRoleCommand(client, config);
        await rankModule.registerRankCommand(client, config);

        // SHIFT COMMAND
        await shiftManageModule.registerShiftManageCommand(client, config);

        console.log("✅ All modules ready.");
    } catch (err) {
        console.error("❌ Error loading modules:", err);
    }
});
// ---------------------------------------------- //

// ---------------- EVENT HANDLERS ---------------- //
// Exam & shift handlers before login
blsExamModule.registerExamHandlers(client, config);
shiftManageModule.registerShiftManageHandlers(client, config);

// Interaction handler for buttons
client.on('interactionCreate', async (interaction) => {
    console.log(`[DEBUG] Interaction received: type=${interaction.type}, user=${interaction.user?.tag}`);

    try {
        if (interaction.isCommand()) {
            // Commands are handled in modules
            console.log(`[DEBUG] Command interaction: ${interaction.commandName}`);
            return;
        }

        if (interaction.isButton()) {
            console.log(`[DEBUG] Button interaction: ${interaction.customId}`);

            // Defer immediately to prevent "Unknown interaction" errors
            await interaction.deferUpdate().catch(err => {
                console.error("[WARN] deferUpdate failed:", err);
            });

            // Call shift module handler
            await shiftManageModule.handleShiftButtons(interaction, config).catch(err => {
                console.error("[ERROR] handleShiftButtons failed:", err);
            });
        }
    } catch (err) {
        console.error("❌ Error handling interaction:", err);
    }
});
// ------------------------------------------------ //

// ---------------- LOGIN ---------------- //
client.login(process.env.DISCORD_TOKEN)
    .then(() => console.log("✅ Logged in successfully."))
    .catch(err => console.error("❌ Login failed:", err));
// ---------------------------------------- //
