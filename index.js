// index.js
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Load configuration
const configPath = path.join(__dirname, 'config.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
    console.error("FATAL ERROR: Could not load config.json. Please ensure the file exists and is valid JSON.", error);
    process.exit(1);
}

// Check for required environment variable
if (!process.env.DISCORD_TOKEN) {
    console.error("FATAL ERROR: DISCORD_TOKEN environment variable is not set.");
    process.exit(1);
}

// Initialize Discord Client
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

// NEW: Shift Management
const shiftManageModule = require('./Features/ShiftManagement/shiftmanage');

client.once('clientReady', async () => {
    console.log(`Bot logged in as ${client.user.tag}!`);

    try {
        // Register commands
        await timestampModule.registerTimestampCommand(client, config);
        await promotionInfractionModule.registerPromotionInfractionCommand(client, config);
        await logArrestModule.registerLogArrestCommand(client, config);
        await availableCallsignsModule.registerAvailableCallsignsCommand(client, config);
        await autoroleModule.registerAutoRoleCommand(client, config);
        await rankModule.registerRankCommand(client, config);

        // NEW: Register /shift command
        await shiftManageModule.registerShiftManageCommand(client, config);

        console.log(":white_check_mark: All feature modules initialized successfully.");
    } catch (err) {
        console.error(":x: Error registering commands/handlers:", err);
    }
});

// CRITICAL: Register event handlers BEFORE login
blsExamModule.registerExamHandlers(client, config);

// NEW: Shift Management button/logic handlers
shiftManageModule.registerShiftManageHandlers(client, config);

client.login(process.env.DISCORD_TOKEN);
