const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

function registerAOTMFeature(client, config) {
    const GUILD_ID = config.GUILD_ID;
    const COMMAND_ROLE = config.COMMAND_ROLES.AOTM_COMMAND_ROLE;

    const CHANNELS = {
        VOTING: config.CHANNELS.AOTM_VOTING,
        PUBLISH: config.CHANNELS.AOTM_PUBLISH,
        ANNOUNCE: config.CHANNELS.AOTM_ANNOUNCE,
        GENERAL: config.CHANNELS.GENERAL_CONGRATS
    };

    // ---------- Automatic voting message (25th of every month) ----------
    const scheduleVotingMessage = async () => {
        const today = new Date();
        if (today.getDate() !== 25) return; // Only on the 25th

        const guild = await client.guilds.fetch(GUILD_ID);
        const votingChannel = await guild.channels.fetch(CHANNELS.VOTING);
        const publishChannel = await guild.channels.fetch(CHANNELS.PUBLISH);

        const votingEmbed = {
            content: "<@&942533333303308309>",
            embeds: [
                {
                    color: 0x2F3136,
                    title: "<:DHSLOGO2:1229625703503499386> | Agent of the Month Voting",
                    description: `
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
-# <:Director:1293958557322186752> Director, Ryan R.
`
                }
            ]
        };

        await votingChannel.send(votingEmbed);
        // Publish message so it appears in following servers
        if (publishChannel.isTextBased()) {
            const msg = await publishChannel.send(votingEmbed);
            if (msg.publish) await msg.publish();
        }
    };

    if (client.isReady()) scheduleVotingMessage();
    else client.once('ready', scheduleVotingMessage);

    // ---------- Slash command /aotm ----------
    const registerCommand = async () => {
        try {
            await client.application.commands.create(
                new SlashCommandBuilder()
                    .setName('aotm')
                    .setDescription('Announce Agent of The Month')
                    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
                    .addUserOption(option =>
                        option.setName('user')
                            .setDescription('Select the user to announce as AOTM')
                            .setRequired(true))
                    .addStringOption(option =>
                        option.setName('rank')
                            .setDescription('Enter the rank of the user')
                            .setRequired(true))
                    .addStringOption(option =>
                        option.setName('name')
                            .setDescription('Enter the full name of the user')
                            .setRequired(true))
                    .toJSON(),
                GUILD_ID
            );
            console.log('✅ /aotm command registered.');
        } catch (err) {
            console.error('❌ Failed to register /aotm command:', err);
        }
    };

    if (client.isReady()) registerCommand();
    else client.once('ready', registerCommand);

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'aotm') return;

        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(COMMAND_ROLE)) {
            return interaction.reply({ content: '❌ You do not have permission to run this command.', ephemeral: true });
        }

        const selectedUser = interaction.options.getUser('user');
        const selectedRank = interaction.options.getString('rank');
        const selectedName = interaction.options.getString('name');

        const monthName = new Date().toLocaleString('default', { month: 'long' });

        const embed = new EmbedBuilder()
            .setColor(0x2F3136)
            .setTitle('<:DHSLOGO2:1229625703503499386> | Agent of The Month')
            .setDescription(`It is time to announce **${monthName}’s** AOTM! We value all our agents but one of them stood out. 
After carefully considering all of your votes, we are happy to announce that this Month's AOTM is no other than....`)
            .addFields(
                { name: 'Agent', value: `||<@${selectedUser.id}>||`, inline: false },
                { name: 'Commendation', value: `||${selectedRank}, ${selectedName} has consistently demonstrated dedication, professionalism, and leadership. Their unwavering activity, attention to detail, and ability to guide others have not gone unnoticed by the entire High Command team. On behalf of myself and the entire High Command team, we would like to thank and commend ${selectedName} for their commitment and wish them continued success at the Department of Homeland Security.||`, inline: false },
                { name: 'Join in Congrats', value: `||Please join us in congratulating <@${selectedUser.id}> in <#${CHANNELS.GENERAL}>!||`, inline: false },
                { name: 'Perks', value: `> - || **Vehicle Access**: You now have access to all vehicles listed in the Vehicle Restrictions embed, except for High Command vehicles.||
> - || **Discord Communication**: You are now allowed to send GIFs and images in all chat channels.||
> - || **Reduced Quota:** Your required quota hours are reduced by 1 hour for the month.||
> - || **Increased Economy Earnings**: Enjoy more money in the economy channel.||
> - || **Golden Ticket**: Awarded a Golden Ticket, granting access to one sub-division of choice without the need for an application.||
-# Perks end ${new Date(new Date().setMonth(new Date().getMonth() + 1)).toDateString()}`, inline: false }
            );

        const announceChannel = await interaction.guild.channels.fetch(CHANNELS.ANNOUNCE);
        await announceChannel.send({ embeds: [embed] });

        await interaction.reply({ content: `✅ AOTM announced for ${selectedName}.`, ephemeral: true });
    });
}

module.exports = { registerAOTMFeature };
