const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const { guildId } = require('./config.json'); // Your target server ID
const token = process.env.DISCORD_TOKEN;

if (!token) {
    console.error('ERROR: DISCORD_TOKEN is not set in your environment variables.');
    process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, 'Features');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
    } else {
        console.log(`[WARNING] The command at ${file} is missing "data" or "execute".`);
    }
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (slash) commands for guild ${guildId}.`);

        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
            { body: commands },
        );

        console.log(`Successfully reloaded application commands for guild ${guildId}.`);
    } catch (error) {
        console.error(error);
    }
})();
