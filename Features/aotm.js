const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const cron = require('node-cron');

function registerAOTM(client, config) {
    const GUILD_ID = config.GUILD_ID;

    const CHANNELS = config.CHANNELS;
    const COMMAND_ROLES = config.COMMAND_ROLES;

    // --- Automatic voting announcement ---
    async function sendVotingAnnouncement() {
        const channelsToSend = [CHANNELS.AOTM_VOTING, CHANNELS.AOTM_PUBLISH];

        const messageContent = `|| <@&942533333303308309>   ||

# <:DHSLOGO2:1229625703503499386>  | Agent of the Month Voting

**Hello everyone!**

Agent of the Month voting submissions are now open for this month. Please use the following Google Form to cast your vote:

- [Agent of the Month Voting Form](https://forms.gle/fD8x6CaS9wU7wVbu8)
- [Department of Homeland Security Roster](https://docs.google.com/spreadsheets/d/1aNUvUw7T-DkLN8fzSDCPdjV7FpmnXlOG7CVKX7EXuJA/edit?gid=1932038631#gid=1932038631)

We kindly request all members to vote responsibly and fairly. Your involvement is crucial in recognizing and appreciating the remarkable efforts of our agents!

Your participation in this voting process will not only acknowledge their hard work but also inspire and motivate them further!

-# On behalf of the High Command Team,
-# <:Chief_of_Staff:1293958022934302750> Chief of Staff, Quinn.
-# <:Executive_Director:1293958517002211388> Executive Director, S. Bob.
-# <:Assistant_Director:1293958529862078524> Assistant Director, Kelly S.
-# <:Director:1293958557322186752> Director, Ryan R.`;

        for (const channelId of channelsToSend) {
            const ch = await client.channels.fetch(channelId).catch(() => null);
            if (!ch) continue;

            const sentMsg = await ch.send({ content: messageContent });
            if (channelId === CHANNELS.AOTM_PUBLISH && sentMsg.crosspost) {
                sentMsg.crosspost().catch(console.error);
            }
        }
    }

    // Schedule on 25th of each month at 9:00 AM
    cron.schedule('0 9 25 * *', () => {
        console.log('🗓️ Sending monthly AOTM voting announcement...');
        sendVotingAnnouncement().catch(console.error);
    });

    // --- Slash command registration ---
    async function registerCommand() {
        try {
            await client.application.commands.create(
                new SlashCommandBuilder()
                    .setName('aotm')
                    .setDescription('Announce the Agent of The Month')
                    .setDefaultMemberPermissions(0) // No default, role-controlled
                    .toJSON(),
                GUILD_ID
            );
            console.log(`✅ /aotm command registered for guild: ${GUILD_ID}`);
        } catch (err) {
            console.error('❌ Failed to register /aotm:', err);
        }
    }

    if (client.isReady()) registerCommand();
    else client.once('ready', registerCommand);

    // --- Command interaction handler ---
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'aotm') return;

        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(COMMAND_ROLES.AOTM_COMMAND_ROLE)) {
            return interaction.reply({ content: '❌ You do not have permission to run this command.', ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId('aotm_modal')
            .setTitle('Announce Agent of the Month');

        const pingInput = new TextInputBuilder()
            .setCustomId('pingUser')
            .setLabel('Ping the user')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('@user')
            .setRequired(true);

        const rankInput = new TextInputBuilder()
            .setCustomId('userRank')
            .setLabel("User's Rank")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Field Agent');

        const nameInput = new TextInputBuilder()
            .setCustomId('userName')
            .setLabel("User's Name")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Olivia R.');

        modal.addComponents(
            new ActionRowBuilder().addComponents(pingInput),
            new ActionRowBuilder().addComponents(rankInput),
            new ActionRowBuilder().addComponents(nameInput)
        );

        await interaction.showModal(modal);
    });

    // --- Modal submit handler ---
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isModalSubmit()) return;
        if (interaction.customId !== 'aotm_modal') return;

        await interaction.deferReply({ ephemeral: false });

        try {
            const pingUser = interaction.fields.getTextInputValue('pingUser');
            const userRank = interaction.fields.getTextInputValue('userRank');
            const userName = interaction.fields.getTextInputValue('userName');

            const ch = await client.channels.fetch(CHANNELS.AOTM_ANNOUNCE).catch(() => null);
            if (!ch) return interaction.editReply({ content: '❌ Could not find announcement channel.' });

            const monthName = new Date().toLocaleString('en-US', { month: 'long' });

            const messageContent = `|| <@&928455277609615450> ||

# <:DHSLOGO2:1229625703503499386> | Agent of The Month
It is time to announce **${monthName}’s** AOTM! We value all our agents but one of them stood out. 
After carefully considering all of your votes, we are happy to announce that this Month's AOTM is no other than....

||*${pingUser}*||

||*${userRank}, ${userName} has consistently demonstrated dedication, professionalism, and leadership. Their unwavering activity, attention to detail, and ability to guide others have not gone unnoticed by the entire High Command team. On behalf of myself and the entire High Command team, we would like to thank and commend ${userName} for their commitment and wish them continued success at the Department of Homeland Security.*||

||Please join us in congratulating ${pingUser} in <#${CHANNELS.GENERAL_CONGRATS}>!||

### Perks 
> - || **Vehicle Access**: You now have access to all vehicles listed in the Vehicle Restrictions embed, except for High Command vehicles.||
> - || **Discord Communication**: You are now allowed to send GIFs and images in all chat channels.||
> - || **Reduced Quota:** Your required quota hours are reduced by 1 hour for the month.||
> - || **Increased Economy Earnings**: Enjoy more money in the economy channel.||
> - || **Golden Ticket**: Awarded a Golden Ticket, granting access to one sub-division of choice without the need for an application.||

||-# Perks end ${new Date(new Date().setMonth(new Date().getMonth()+1)).toLocaleDateString()}||`;

            await ch.send({ content: messageContent });
            await interaction.editReply({ content: '✅ Agent of The Month announced successfully.' });

        } catch (err) {
            console.error('❌ Error announcing AOTM:', err);
            await interaction.editReply({ content: '❌ Error processing the announcement.' });
        }
    });
}

module.exports = { registerAOTM };
