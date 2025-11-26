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

// --- Shift Management Module ---
const shiftManageModule = require('./Features/ShiftManagement/shiftmanage');

// --- Event: clientReady ---
client.once('clientReady', async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}!`);

    // --- Register Slash Commands ---
    try {
        await timestampModule.registerTimestampCommand(client, config);
        await promotionInfractionModule.registerPromotionInfractionCommand(client, config);
        await logArrestModule.registerLogArrestCommand(client, config);
        await availableCallsignsModule.registerAvailableCallsignsCommand(client, config);
        await autoroleModule.registerAutoRoleCommand(client, config);
        await rankModule.registerRankCommand(client, config);
        
        // Register shift command properly with log
        await shiftManageModule.registerShiftManageCommand(client, config); 

        console.log("✅ All feature modules initialized successfully.");
    } catch (err) {
        console.error("❌ Error registering commands/handlers:", err);
    }
});

// --- Event: interactionCreate ---
client.on('interactionCreate', async (interaction) => {
    try {
        // Shift management interaction
        await shiftManageModule.handleInteraction(interaction, config);
    } catch (err) {
        console.error("❌ Error handling shift interaction:", err);
        if (interaction.isButton() || interaction.isChatInputCommand()) {
            try {
                await interaction.reply({ content: "There was an error processing your shift action.", ephemeral: true });
            } catch {}
        }
    }

    // Other modules that require interaction
    try { blsExamModule.handleInteraction?.(interaction, config); } catch {}
    try { timestampModule.handleInteraction?.(interaction, config); } catch {}
    try { promotionInfractionModule.handleInteraction?.(interaction, config); } catch {}
    try { logArrestModule.handleInteraction?.(interaction, config); } catch {}
    try { availableCallsignsModule.handleInteraction?.(interaction, config); } catch {}
    try { autoroleModule.handleInteraction?.(interaction, config); } catch {}
    try { rankModule.handleInteraction?.(interaction, config); } catch {}
});

// --- Register other event handlers ---
blsExamModule.registerExamHandlers(client, config); 

// Login
client.login(process.env.DISCORD_TOKEN);
