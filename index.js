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

// Check for Discord token
if (!process.env.DISCORD_TOKEN) {
    console.error("FATAL ERROR: DISCORD_TOKEN environment variable is not set.");
    process.exit(1);
}

// Initialize Discord Client with required intents
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Import modules
const timestampModule = require('./Features/timestamp');
const promotionInfractionModule = require('./Features/promotion-infraction');
const logArrestModule = require('./Features/logarrest');
const availableCallsignsModule = require('./Features/availablecallsigns');
const autoroleModule = require('./Features/autorole');
const blsExamModule = require('./Features/blsexam');
const rankModule = require('./Features/rank');
const shiftManageModule = require('./Features/ShiftManagement/shiftmanage');

// When bot is ready
client.once('ready', async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}!`);

    // Register slash commands
    try {
        await timestampModule.registerTimestampCommand(client, config);
        await promotionInfractionModule.registerPromotionInfractionCommand(client, config);
        await logArrestModule.registerLogArrestCommand(client, config);
        await availableCallsignsModule.registerAvailableCallsignsCommand(client, config);
        await autoroleModule.registerAutoRoleCommand(client, config);
        await rankModule.registerRankCommand(client, config);
        await shiftManageModule.registerShiftManageCommand(client, config);
        console.log("✅ All commands registered successfully.");
    } catch (err) {
        console.error("❌ Error registering commands:", err);
    }
});

// Interaction handling
client.on('interactionCreate', async (interaction) => {
    try {
        // Handle shift command
        await shiftManageModule.handleInteraction(interaction, config);
    } catch (err) {
        console.error("❌ Error handling shift interaction:", err);
        if (interaction.isButton() || interaction.isChatInputCommand()) {
            try {
                await interaction.reply({ content: "There was an error processing your shift action.", ephemeral: true });
            } catch {}
        }
    }

    // Handle other modules if they have handleInteraction functions
    try { await blsExamModule.handleInteraction?.(interaction, config); } catch {}
    try { await timestampModule.handleInteraction?.(interaction, config); } catch {}
    try { await promotionInfractionModule.handleInteraction?.(interaction, config); } catch {}
    try { await logArrestModule.handleInteraction?.(interaction, config); } catch {}
    try { await availableCallsignsModule.handleInteraction?.(interaction, config); } catch {}
    try { await autoroleModule.handleInteraction?.(interaction, config); } catch {}
    try { await rankModule.handleInteraction?.(interaction, config); } catch {}
});

// Register other event handlers (like BLS Exam)
blsExamModule.registerExamHandlers(client, config);

// Login
client.login(process.env.DISCORD_TOKEN);
