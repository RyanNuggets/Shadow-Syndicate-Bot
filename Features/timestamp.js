const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

// Helper function to handle exponential backoff for API calls
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- Core Logic ---

/**
 * Converts date and time inputs into a Unix timestamp in seconds.
 * @param {string} dateInput - Date string (e.g., '2024-10-24', 'today').
 * @param {string} timeInput - Time string (e.g., '14:30', '2pm', 'now').
 * @returns {number | null} Unix timestamp in seconds, or null if invalid.
 */
function getUnixTimestamp(dateInput, timeInput) {
    let dateTimeString;

    // Handle relative date keywords
    if (dateInput.toLowerCase() === 'today') {
        dateTimeString = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    } else if (dateInput.toLowerCase() === 'tomorrow') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        dateTimeString = tomorrow.toISOString().slice(0, 10);
    } else if (dateInput.toLowerCase() === 'yesterday') {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        dateTimeString = yesterday.toISOString().slice(0, 10);
    } else {
        // Assume standard format (e.g., YYYY-MM-DD)
        dateTimeString = dateInput;
    }

    // Handle relative time keywords and append time
    if (timeInput.toLowerCase() === 'now') {
        dateTimeString += 'T' + new Date().toTimeString().split(' ')[0];
    } else if (timeInput.match(/^\d+ (hours?|minutes?|secs?|days?) (from|ago)$/i)) {
        // Simple relative time parsing (e.g., "10 hours from now")
        const parts = timeInput.split(' ');
        const value = parseInt(parts[0]);
        const unit = parts[1].toLowerCase();
        const direction = parts[2].toLowerCase();

        if (isNaN(value)) return null;

        const date = new Date();
        let ms = 0;

        switch (unit) {
            case 'hour':
            case 'hours':
                ms = value * 60 * 60 * 1000;
                break;
            case 'minute':
            case 'minutes':
                ms = value * 60 * 1000;
                break;
            case 'second':
            case 'seconds':
            case 'sec':
            case 'secs':
                ms = value * 1000;
                break;
            case 'day':
            case 'days':
                ms = value * 24 * 60 * 60 * 1000;
                break;
            default:
                return null;
        }

        if (direction === 'ago') {
            date.setTime(date.getTime() - ms);
        } else {
            date.setTime(date.getTime() + ms);
        }
        return Math.floor(date.getTime() / 1000);

    } else {
        // Standard time format (e.g., '14:30', '2pm')
        // Append time to the date part
        dateTimeString += ' ' + timeInput;
    }

    // Attempt to parse the combined string
    const date = new Date(dateTimeString);

    if (isNaN(date.getTime())) {
        return null; // Invalid date or time input
    }

    return Math.floor(date.getTime() / 1000);
}


// --- Command Definition and Handler ---

const timestampCommand = new SlashCommandBuilder()
    .setName('timestamp')
    .setDescription('Generates a dynamic Discord timestamp link from a date and time.')
    
    // REQUIRED OPTIONS (Must come before any optional option)
    .addStringOption(option => option // Option 1
        .setName('date')
        .setDescription('Date (e.g., 2024-10-24, today, yesterday, tomorrow)')
        .setRequired(true))
    .addStringOption(option => option // Option 2
        .setName('time')
        .setDescription('Time (e.g., 14:30, 2pm, now, 10 hours from now)')
        .setRequired(true))
        
    // OPTIONAL OPTIONS (Must come after all required options)
    .addStringOption(option => option // Option 3 (The one that caused the error)
        .setName('format')
        .setDescription('The display format for the timestamp (e.g., R, t, D, T)')
        .setRequired(false) // Explicitly set to false, placed last.
        .addChoices(
            { name: 'Relative Time (e.g., 5 minutes ago)', value: 'R' },
            { name: 'Short Time (e.g., 4:20 PM)', value: 't' },
            { name: 'Long Time (e.g., 4:20:30 PM)', value: 'T' },
            { name: 'Short Date (e.g., 04/20/2024)', value: 'd' },
            { name: 'Long Date (e.g., April 20, 2024)', value: 'D' },
            { name: 'Short Date/Time (e.g., 20 April 2024 4:20 PM)', value: 'f' },
            { name: 'Long Date/Time (e.g., Saturday, April 20, 2024 4:20 PM)', value: 'F' }
        ));


/**
 * Handles the execution of the /timestamp slash command.
 * @param {object} interaction - The Discord interaction object.
 */
async function handleTimestampCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const dateInput = interaction.options.getString('date');
    const timeInput = interaction.options.getString('time');
    const format = interaction.options.getString('format') || 'F'; // Default to Long Date/Time

    const timestamp = getUnixTimestamp(dateInput, timeInput);

    if (!timestamp) {
        return interaction.editReply({
            content: '**Error:** Invalid date or time input. Please ensure the date format is valid (e.g., `2024-10-24` or `today`) and the time is valid (e.g., `14:30` or `2pm`).',
            ephemeral: true
        });
    }

    const discordTimestamp = `<t:${timestamp}:${format}>`;

    const embed = new EmbedBuilder()
        .setTitle('🗓️ Discord Timestamp Generator')
        .setDescription('Preview below. **Copy the code from the plain text message above this embed.**')
        .addFields(
            // Removed 'Raw Code' field to make copying easier for mobile users
            { name: 'Preview', value: discordTimestamp }
        )
        .setColor(0x0099FF)
        .setFooter({ text: `Generated by ${interaction.user.tag}` })
        .setTimestamp();

    // Send the raw code as the main content for easy copy-paste on mobile,
    // and the embed for the nice preview/explanation.
    await interaction.editReply({ 
        content: `**Raw Timestamp Code (Easy Copy):**\n\`${discordTimestamp}\``,
        embeds: [embed],
        ephemeral: true
    });
}


// --- Deployment Logic ---

/**
 * Registers the timestamp slash command and sets up the handler.
 * @param {Client} client - The Discord Client instance.
 * @param {object} config - The bot configuration object.
 */
function registerTimestampCommand(client, config) {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const commands = [timestampCommand.toJSON()];
    const guildId = config.GUILD_ID;
    const clientId = config.DISCORD_CLIENT_ID;

    if (!clientId) {
        console.error("FATAL ERROR: DISCORD_CLIENT_ID is missing in config.json. Cannot deploy slash commands.");
        return;
    }

    // Prioritize deployment to the test guild for instant updates
    rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands })
        .then(() => {
            console.log(`Successfully registered /timestamp command to guild: ${guildId}.`);
        })
        .catch(async (error) => {
            console.error(`Failed to register /timestamp command:`, error.message);
            
            // If guild deployment fails (e.g., missing permissions), attempt global deployment
            // NOTE: Global deployment can take up to an hour.
            await delay(1000); // Wait a second before next API call
            
            rest.put(Routes.applicationCommands(clientId), { body: commands })
                .then(() => {
                    console.log("Successfully started global registration for /timestamp. Command may take up to an hour to appear.");
                })
                .catch(err => {
                    console.error("Failed to register /timestamp command globally:", err.message);
                });
        });

    // Set up the interaction handler
    client.on('interactionCreate', async interaction => {
        if (!interaction.isCommand()) return;

        if (interaction.commandName === 'timestamp') {
            await handleTimestampCommand(interaction);
        }
    });
}

module.exports = {
    registerTimestampCommand
};
