const fs = require('fs');
const path = require('path');
const {
    Client,
    Collection,
    GatewayIntentBits,
    Partials,
    Events,
    REST,
    Routes
} = require('discord.js');

require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ]
});

client.commands = new Collection();

const slashCommands = [];
const featuresPath = path.join(__dirname, 'Features');
const featureFiles = fs.readdirSync(featuresPath).filter(file => file.endsWith('.js'));

for (const file of featureFiles) {
    const filePath = path.join(featuresPath, file);
    const feature = require(filePath);

    if (feature.data && feature.execute) {
        client.commands.set(feature.data.name, feature);
        slashCommands.push(feature.data.toJSON());
        console.log(`✅ Loaded slash command from Features/${file}`);
    } else {
        console.log(`ℹ️ Loaded feature handler from Features/${file}`);
    }
}

async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

        if (process.env.GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(
                    process.env.CLIENT_ID,
                    process.env.GUILD_ID
                ),
                { body: slashCommands }
            );
            console.log(`✅ Registered guild commands in ${process.env.GUILD_ID}`);
        } else {
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: slashCommands }
            );
            console.log('✅ Registered global commands');
        }
    } catch (error) {
        console.error('❌ Failed to register commands:', error);
    }
}

client.once(Events.ClientReady, async readyClient => {
    console.log(`✅ Logged in as ${readyClient.user.tag}`);
    await registerCommands();
});

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            await command.execute(interaction);
            return;
        }

        for (const feature of client.commands.values()) {
            if (typeof feature.handleInteraction === 'function') {
                await feature.handleInteraction(interaction);
            }
        }
    } catch (error) {
        console.error('❌ Interaction error:', error);

        if (interaction.isRepliable()) {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: 'There was an error while processing this interaction.',
                    ephemeral: true
                }).catch(() => {});
            } else {
                await interaction.reply({
                    content: 'There was an error while processing this interaction.',
                    ephemeral: true
                }).catch(() => {});
            }
        }
    }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
        for (const feature of client.commands.values()) {
            if (typeof feature.handleReactionAdd === 'function') {
                await feature.handleReactionAdd(reaction, user);
            }
        }
    } catch (error) {
        console.error('❌ Reaction add error:', error);
    }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
    try {
        for (const feature of client.commands.values()) {
            if (typeof feature.handleReactionRemove === 'function') {
                await feature.handleReactionRemove(reaction, user);
            }
        }
    } catch (error) {
        console.error('❌ Reaction remove error:', error);
    }
});

process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Uncaught exception:', error);
});

client.login(process.env.DISCORD_TOKEN);
