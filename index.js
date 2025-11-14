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
const rankModule = require('./Features/rank'); // ← Added rank module

client.once('ready', async () => {
    console.log(`Bot logged in as ${client.user.tag}!`);

    // --- Register Slash Commands ---
    try {
        await timestampModule.registerTimestampCommand(client, config);
        await promotionInfractionModule.registerPromotionInfractionCommand(client, config);
        await logArrestModule.registerLogArrestCommand(client, config);
        await availableCallsignsModule.registerAvailableCallsignsCommand(client, config);
        await autoroleModule.registerAutoRoleCommand(client, config);

        await rankModule.registerRankCommand(client, config); // ← Register /rank command

        // NOTE: BLS Exam event handlers are registered below, outside this block.

        console.log("✅ All feature modules initialized successfully.");
    } catch (err) {
        console.error("❌ Error registering commands/handlers:", err);
    }
});

// 🔑 CRITICAL FIX: Register event handlers *before* client.login
// This ensures the client.once('ready', ...) listener inside blsexam.js is called
// when the client connects, allowing the start button to post.
blsExamModule.registerExamHandlers(client, config);

client.login(process.env.DISCORD_TOKEN);
