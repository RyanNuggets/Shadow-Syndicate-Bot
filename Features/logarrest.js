const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

function registerLogArrestCommand(client, config) {
    const GUILD_ID = config.GUILD_ID;
    const ARREST_LOG_CHANNEL = config.CHANNELS.ARREST_LOGS;
    const LOG_ARREST_ROLE = config.COMMAND_ROLES.LOG_ARREST_ROLE;

    async function registerCommand() {
        try {
            await client.application.commands.create(
                new SlashCommandBuilder()
                    .setName('logarrest')
                    .setDescription('Logs an arrest to the official channel.')
                    .addUserOption(option =>
                        option.setName('arresting_officer')
                            .setDescription('Arresting Officer')
                            .setRequired(true))
                    .addStringOption(option =>
                        option.setName('assisting_officer')
                            .setDescription('Assisting Officer (or N/A)')
                            .setRequired(true))
                    .addStringOption(option =>
                        option.setName('suspect')
                            .setDescription('Suspect’s Roblox username')
                            .setRequired(true))
                    .addStringOption(option =>
                        option.setName('date_time')
                            .setDescription('Date & Time of Arrest')
                            .setRequired(true))
                    .addStringOption(option =>
                        option.setName('charges')
                            .setDescription('Charges for the arrest')
                            .setRequired(true))
                    .addStringOption(option =>
                        option.setName('jail_time')
                            .setDescription('Jail time (e.g. 15 minutes)')
                            .setRequired(true))
                    .addAttachmentOption(option =>
                        option.setName('mugshot')
                            .setDescription('Upload a mugshot image')
                            .setRequired(true))
                    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
                    .toJSON(),
                GUILD_ID
            );
            console.log(`Successfully registered /logarrest command in guild: ${GUILD_ID}`);
        } catch (error) {
            console.error('Failed to register /logarrest command:', error);
        }
    }

    if (client.isReady()) {
        registerCommand();
    } else {
        client.once('clientReady', registerCommand);
    }

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'logarrest') return;

        try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            if (!member.roles.cache.has(LOG_ARREST_ROLE)) {
                return interaction.reply({
                    content: '❌ You do not have permission to use this command.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            const arrestingOfficer = interaction.options.getUser('arresting_officer');
            const assistingOfficer = interaction.options.getString('assisting_officer');
            const suspect = interaction.options.getString('suspect');
            const dateTime = interaction.options.getString('date_time');
            const charges = interaction.options.getString('charges');
            const jailTime = interaction.options.getString('jail_time');
            const mugshot = interaction.options.getAttachment('mugshot');

            // Fetch channel safely
            const channel = await interaction.guild.channels.fetch(ARREST_LOG_CHANNEL).catch(() => null);
            if (!channel) {
                await interaction.editReply({ content: '❌ Arrest log channel not found. Please check the config.' });
                return;
            }

            const messageContent = `
<:DHSLOGO:1187300549939445801> **| Arrest log:**
<:DHSLine:1256440427897294928><:DHSLine:1256440427897294928><:DHSLine:1256440427897294928><:DHSLine:1256440427897294928><:DHSLine:1256440427897294928><:DHSLine:1256440427897294928><:DHSLine:1256440427897294928><:DHSLine:1256440427897294928><:DHSLine:1256440427897294928>

**\`Arresting Officer:\`** ${arrestingOfficer}
**\`Assisting Officer:\`** ${assistingOfficer}
**\`Suspect:\`** ${suspect}
**\`Date & Time of Arrest:\`** ${dateTime}
**\`Charges:\`** ${charges}
**\`Jail Time:\`** ${jailTime}
**\`Mugshot:\`** [Click to View](${mugshot.url})
            `;

            await channel.send({ content: messageContent });
            await interaction.editReply({ content: '✅ Arrest log successfully submitted.' });

        } catch (error) {
            console.error('❌ Error processing arrest log:', error);
            await interaction.editReply({ content: '❌ There was an error submitting the arrest log.' });
        }
    });
}

module.exports = { registerLogArrestCommand };
