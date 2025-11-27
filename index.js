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
        await shiftManageModule.registerShiftManageCommand(client, config);

        console.log("✅ All modules ready.");
    } catch (err) {
        console.error("❌ Error loading modules:", err);
    }
});
// ---------------------------------------------- //

// ---------------- EVENT HANDLERS ---------------- //
blsExamModule.registerExamHandlers(client, config);
shiftManageModule.registerShiftManageHandlers(client, config); // only slash commands, not buttons

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isCommand()) return;

        if (interaction.isButton() && interaction.customId.startsWith("SHIFT_")) {
            console.log(`[DEBUG] Button pressed: ${interaction.customId} by ${interaction.user.tag}`);

            // ✅ Defer immediately to prevent unknown interaction
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate().catch(err => console.error("[WARN] deferUpdate failed:", err));
            }

            // Pass to shift module
            await shiftManageModule.handleShiftButtons(interaction, config).catch(err => {
                console.error("[ERROR] handleShiftButtons failed:", err);
                if (!interaction.replied && !interaction.deferred) {
                    interaction.followUp({ content: "⚠️ Something went wrong.", ephemeral: true }).catch(() => {});
                }
            });
        }
    } catch (err) {
        console.error("[FATAL] interactionCreate handler failed:", err);
    }
});
// ------------------------------------------------ //

// ---------------- LOGIN ---------------- //
client.login(process.env.DISCORD_TOKEN)
    .then(() => console.log("✅ Logged in successfully."))
    .catch(err => console.error("❌ Login failed:", err));
