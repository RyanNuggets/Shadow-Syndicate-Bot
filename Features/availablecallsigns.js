const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const callsignGroups = {
    "Special Agent Commander": ['2H-06', '2H-07', '2H-08'],
    "Lead Special Agent": ['2H-09', '2H-10', '2H-11', '2H-12'],
    "Supervisory Agent In-Charge": ['3H-13', '3H-14', '3H-15', '3H-16', '3H-17'],
    "Supervisory Special Agent": ['4H-18', '4H-19', '4H-20', '4H-21', '4H-22'],
    "Assistant Supervisory Special Agent": ['5H-23', '5H-24', '5H-25', '5H-26', '5H-27', '5H-28', '5H-29'],
    "Senior Special Agent": ['6H-30', '6H-31', '6H-32', '6H-33', '6H-34', '6H-35', '6H-36', '6H-37', '6H-38'],
    "Special Agent In-Charge": ['7H-39', '7H-40', '7H-41', '7H-42', '7H-43', '7H-44', '7H-45', '7H-46', '7H-47', '7H-48', '7H-49', '7H-50', '7H-51'],
    "Special Agent": ['8H-52', '8H-53', '8H-54', '8H-55', '8H-56', '8H-57', '8H-58', '8H-59', '8H-60', '8H-61', '8H-62', '8H-63', '8H-64'],
    "Probationary Special Agent": [
        '9H-65', '9H-66', '9H-67', '9H-68', '9H-69', '9H-70', '9H-71', '9H-72', '9H-73', '9H-74', '9H-75', '9H-76', '9H-77', '9H-78', '9H-79',
        '9H-80', '9H-81', '9H-82', '9H-83', '9H-84', '9H-85', '9H-86', '9H-87', '9H-88', '9H-89', '9H-90', '9H-91', '9H-92',
        '9H-93', '9H-94', '9H-95', '9H-96', '9H-97', '9H-98', '9H-99'
    ]
};

module.exports = {
    async registerAvailableCallsignsCommand(client, config) {
        const guild = client.guilds.cache.get(config.GUILD_ID);
        if (!guild) {
            console.error("❌ Could not find guild with ID from config.json");
            return;
        }

        await guild.commands.create(
            new SlashCommandBuilder()
                .setName('availablecallsigns')
                .setDescription('Select a rank to see available callsigns.')
        );

        console.log(`Successfully registered /availablecallsigns command in guild: ${config.GUILD_ID}`);

        client.on('interactionCreate', async (interaction) => {
            const allowedRole = config.COMMAND_ROLES.AVAILABLE_CALLSIGNS_ROLE;

            // Command execution
            if (interaction.isChatInputCommand() && interaction.commandName === 'availablecallsigns') {
                if (!interaction.member.roles.cache.has(allowedRole)) {
                    return interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
                }

                const options = Object.keys(callsignGroups).map(rank => ({
                    label: rank,
                    value: rank
                }));

                const row = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('select_rank_callsigns')
                            .setPlaceholder('Select a rank')
                            .addOptions(options)
                    );

                await interaction.reply({ content: "Select a rank to view available callsigns:", components: [row], ephemeral: true });
            }

            // Dropdown selection
            if (interaction.isStringSelectMenu() && interaction.customId === 'select_rank_callsigns') {
                const selectedRank = interaction.values[0];

                await interaction.guild.members.fetch();

                const takenCallsigns = new Set();
                const callsignRegex = /\b\dH-\d{2}\b/;
                interaction.guild.members.cache.forEach(member => {
                    const nickname = member.nickname || member.user.username;
                    const match = nickname.match(callsignRegex);
                    if (match) takenCallsigns.add(match[0]);
                });

                const available = callsignGroups[selectedRank].filter(cs => !takenCallsigns.has(cs));

                const description = available.length > 0 
                    ? available.map(cs => `- ${cs}`).join('\n') 
                    : "- No Callsigns Available";

                const embed = new EmbedBuilder()
                    .setTitle(`Available Callsigns: ${selectedRank}`)
                    .setDescription(description)
                    .setColor(0x2F3136)
                    .setTimestamp();

                const backRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('back_to_dropdown')
                            .setLabel('Back')
                            .setStyle(ButtonStyle.Secondary)
                    );

                await interaction.update({ content: null, embeds: [embed], components: [backRow] });
            }

            // Back button
            if (interaction.isButton() && interaction.customId === 'back_to_dropdown') {
                const options = Object.keys(callsignGroups).map(rank => ({
                    label: rank,
                    value: rank
                }));

                const row = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('select_rank_callsigns')
                            .setPlaceholder('Select a rank')
                            .addOptions(options)
                    );

                await interaction.update({ content: "Select a rank to view available callsigns:", embeds: [], components: [row] });
            }
        });
    }
};
