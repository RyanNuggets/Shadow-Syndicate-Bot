const { Client, GatewayIntentBits, Collection, REST, Routes, Events } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config.json');

// Initialize Client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Load the session management feature manually
const sessionFeature = require('./Features/sessionmanagement.js');

client.commands = new Collection();
// Register the session command
client.commands.set(sessionFeature.data.name, sessionFeature);

// When the client is ready
client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Register Slash Commands
    const rest = new REST({ version: '10' }).setToken(config.token);

    try {
        console.log('Started refreshing application (/) commands.');

        // FIX: Use client.user.id instead of config.clientId to prevent authorization errors
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, config.guildId),
            { body: [sessionFeature.data.toJSON()] },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
});

// Interaction Handler
client.on(Events.InteractionCreate, async interaction => {
    try {
        // Handle Slash Commands
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            await command.execute(interaction);
        }
        // Handle Buttons and Select Menus (routed to sessionFeature)
        else if (interaction.isButton() || interaction.isStringSelectMenu()) {
            const customId = interaction.customId;
            if (customId.startsWith('session_') || customId === 'poll_vote_btn') {
                await sessionFeature.handleInteraction(interaction);
            }
        }
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
});

client.login(config.token);
