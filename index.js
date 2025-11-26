// index.js
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// --- Load configuration ---
const configPath = path.join(__dirname, 'config.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
    console.error("FATAL ERROR: Could not load config.json. Please ensure the file exists and is valid JSON.", error);
    process.exit(1);
}

// --- Check for required environment variable ---
if (!process.env.DISCORD_TOKEN) {
    console.error("FATAL ERROR: DISCORD_TOKEN environment variable is not set.");
    process.exit(1);
}

// --- Initialize Discord Client ---
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ] 
});

// --- Feature Modules ---
const timestampModule = require('./Features/timestamp');
const promotionInfractionModule = require('./Features/promotion-infraction');
const logArrestModule = require('./Features/logarrest');
const availableCallsignsModule = require('./Features/availablecallsigns'); 
const autoroleModule = require('./Features/autorole'); 
const blsExamModule = require('./Features/blsexam'); 
const rankModule = require('./Features/rank'); 

// --- Shift Management Module ---
const shiftManageModule = require('./Features/ShiftManagement/shiftmanage');

// --- Client Ready Event ---
client.once('ready', async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}!`);

    // --- Register Slash Commands ---
    try {
        if (timestampModule.registerTimestampCommand) await timestampModule.registerTimestampCommand(client, config);
        if (promotionInfractionModule.registerPromotionInfractionCommand) await promotionInfractionModule.registerPromotionInfractionCommand(client, config);
        if (logArrestModule.registerLogArrestCommand) await logArrestModule.registerLogArrestCommand(client, config);
        if (availableCallsignsModule.registerAvailableCallsignsCommand) await availableCallsignsModule.registerAvailableCallsignsCommand(client, config);
        if (autoroleModule.registerAutoRoleCommand) await autoroleModule.registerAutoRoleCommand(client, config);
        if (rankModule.registerRankCommand) await rankModule.registerRankCommand(client, config);
        if (shiftManageModule.registerShiftManageCommand) await shiftManageModule.registerShiftManageCommand(client, config);

        console.log("✅ All feature modules initialized successfully.");
    } catch (err) {
        console.error("❌ Error registering commands/handlers:", err);
    }
});

// --- Event Handlers ---
if (blsExamModule.registerExamHandlers) blsExamModule.registerExamHandlers(client, config);
if (shiftManageModule.registerShiftManageHandlers) shiftManageModule.registerShiftManageHandlers(client, config);

// --- Login ---
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error("❌ Failed to login client:", err);
});
