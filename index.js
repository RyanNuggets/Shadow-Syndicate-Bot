// index.js
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Feature Modules
const timestampModule = require('./Features/timestamp');
const promotionInfractionModule = require('./Features/promotion-infraction');
const logArrestModule = require('./Features/logarrest');
const availableCallsignsModule = require('./Features/availablecallsigns');
const autoroleModule = require('./Features/autorole');
const blsExamModule = require('./Features/blsexam');
const rankModule = require('./Features/rank');

// SHIFT MODULE — ADDED
const shiftManageModule = require('./Features/ShiftManagement/shiftmanage');

client.once('ready', async () => {
    console.log(`Bot logged in as ${client.user.tag}!`);

    try {
        await timestampModule.registerTimestampCommand(client, config);
        await promotionInfractionModule.registerPromotionInfractionCommand(client, config);
        await logArrestModule.registerLogArrestCommand(client, config);
        await availableCallsignsModule.registerAvailableCallsignsCommand(client, config);
        await autoroleModule.registerAutoRoleCommand(client, config);
        await rankModule.registerRankCommand(client, config);

        // SHIFT
        await shiftManageModule.registerShiftManageCommand(client, config);

        console.log("✅ All modules ready.");
    } catch (err) {
        console.error("❌ Error loading modules:", err);
    }
});

// Event handlers BEFORE login
blsExamModule.registerExamHandlers(client, config);
shiftManageModule.registerShiftManageHandlers(client, config);

client.login(process.env.DISCORD_TOKEN);
