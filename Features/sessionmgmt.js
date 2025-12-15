const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('session')
        .setDescription('Manage roleplay sessions')
        .addSubcommand(subcommand =>
            subcommand
                .setName('manage')
                .setDescription('Manage sessions or polls')
        ),
    async execute(interaction) {
        if (interaction.options.getSubcommand() === 'manage') {
            // Embed
            const embed = new EmbedBuilder()
                .setTitle(':CRPC: No Active Session')
                .setDescription('Start a session or create a poll by clicking the buttons below this message')
                .setColor('Blue');

            // Dropdown
            const dropdown = new StringSelectMenuBuilder()
                .setCustomId('session_select')
                .setPlaceholder('Select an action')
                .addOptions([
                    {
                        label: 'Start Session',
                        value: 'start_session',
                        description: 'Begin a new RP session'
                    },
                    {
                        label: 'Create Poll',
                        value: 'create_poll',
                        description: 'Create a poll for the server'
                    }
                ]);

            const row = new ActionRowBuilder().addComponents(dropdown);

            await interaction.reply({ embeds: [embed], components: [row] });
        }
    }
};
