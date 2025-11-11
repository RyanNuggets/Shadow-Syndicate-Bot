const {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');

function registerPromotionInfractionCommand(client, config) {
    const GUILD_ID = config.GUILD_ID;
    const HIGH_COMMAND_ROLE = config.QUOTA_SETTINGS.QUOTA_COMMAND_PERMISSION_ROLE;
    const GRACE_PERIOD = config.QUOTA_SETTINGS.GRACE_PERIOD_MINUTES;
    const STATUS_ROLES = config.QUOTA_SETTINGS.STATUS_ROLES;
    const RANK_QUOTAS = config.QUOTA_SETTINGS.RANK_QUOTAS;
    const PROMO_QUOTAS = config.QUOTA_SETTINGS.PROMO_QUOTAS;
    const AIP_ROLE_ID = config.QUOTA_SETTINGS.AIP_ROLE_ID;
    const AIP_REDUCTION = config.QUOTA_SETTINGS.AIP_REDUCTION;

    async function registerCommand() {
        try {
            await client.application.commands.create(
                new SlashCommandBuilder()
                    .setName('activityreport')
                    .setDescription('Submit an activity report for High Command.')
                    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
                    .toJSON(),
                GUILD_ID
            );
            console.log(`✅ Successfully registered /activityreport command to guild: ${GUILD_ID}.`);
        } catch (error) {
            console.error('❌ Failed to register /activityreport command:', error);
        }
    }

    if (client.isReady()) registerCommand();
    else client.once('ready', registerCommand);

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'activityreport') return;

        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(HIGH_COMMAND_ROLE)) {
            return interaction.reply({ content: '❌ You do not have permission to run this command.', ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId('activityreport_modal')
            .setTitle('Activity Report Submission');

        const dataInput = new TextInputBuilder()
            .setCustomId('reportdata')
            .setLabel('Paste the shift data below:')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder('@ryannuggets3 • 7 hours, 13 minutes, 56 seconds on shift • 0 moderations...');

        const reductionInput = new TextInputBuilder()
            .setCustomId('reductionPercent')
            .setLabel('Quota Reduction (Number Only)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(dataInput),
            new ActionRowBuilder().addComponents(reductionInput)
        );

        await interaction.showModal(modal);
    });

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isModalSubmit()) return;
        if (interaction.customId !== 'activityreport_modal') return;

        await interaction.deferReply({ ephemeral: false });

        try {
            const rawData = interaction.fields.getTextInputValue('reportdata');
            const reductionPercent = parseFloat(interaction.fields.getTextInputValue('reductionPercent')) || 0;
            const lines = rawData.split('\n').filter(line => line.trim() !== '');

            const results = [];
            const regex = /<@!?(\d+)>|@?([^•\n]+)\s*•\s*(?:(\d+)\s*hours?)?\s*,?\s*(?:(\d+)\s*minutes?)?\s*,?\s*(?:(\d+)\s*seconds?)?/i;

            for (const line of lines) {
                const match = regex.exec(line);
                if (!match) continue;

                let userId = match[1];
                let name = match[2]?.trim();
                const h = parseInt(match[3]) || 0;
                const m = parseInt(match[4]) || 0;
                const s = parseInt(match[5]) || 0;
                const totalMinutes = h * 60 + m + s / 60;

                let member = null;

                if (userId) {
                    member = await interaction.guild.members.fetch(userId).catch(() => null);
                } else if (name) {
                    // Try to find by nickname, username, or global name
                    name = name.replace(/^@/, '').trim().toLowerCase();
                    member = interaction.guild.members.cache.find(m =>
                        m.displayName.toLowerCase().includes(name) ||
                        m.user.username.toLowerCase().includes(name) ||
                        m.user.globalName?.toLowerCase().includes(name)
                    );
                }

                if (!member) {
                    console.warn(`⚠️ Could not find member for: ${line}`);
                    continue;
                }

                results.push({
                    member,
                    h,
                    m,
                    s,
                    totalMinutes
                });
            }

            const promoMetQuota = [];
            const metQuota = [];
            const notMetQuota = [];
            const exempted = [];
            const gracePeriodMet = [];

            for (const entry of results) {
                const member = entry.member;

                // Exemptions
                if (member.roles.cache.has(STATUS_ROLES.LEAVE_OF_ABSENCE_ID)) {
                    exempted.push(`${member} • Leave of Absence`);
                    continue;
                }
                if (member.roles.cache.has(STATUS_ROLES.REDUCED_QUOTA_ID)) {
                    exempted.push(`${member} • Reduced Quota`);
                    continue;
                }

                let quotaMinutes = null;
                for (const rank of RANK_QUOTAS) {
                    if (rank.rankRoles.some(r => member.roles.cache.has(r))) {
                        quotaMinutes = rank.minQuotaMinutes;
                        break;
                    }
                }
                if (!quotaMinutes) continue;

                // --- AIP reduction / Reduced Activity ---
                let aipReduction = 0;
                if (member.roles.cache.has(AIP_ROLE_ID)) {
                    if (RANK_QUOTAS[2].rankRoles.some(r => member.roles.cache.has(r))) aipReduction = AIP_REDUCTION.LOW_COMMAND;
                    else if (RANK_QUOTAS[1].rankRoles.some(r => member.roles.cache.has(r))) aipReduction = AIP_REDUCTION.SUPERVISOR;
                    else if (RANK_QUOTAS[0].rankRoles.some(r => member.roles.cache.has(r))) aipReduction = AIP_REDUCTION.PATROL;
                }

                if (member.roles.cache.has(STATUS_ROLES.REDUCED_ACTIVITY_ID)) {
                    const reducedActivityMinutes = quotaMinutes / 2;
                    const aipReducedMinutes = quotaMinutes - aipReduction;
                    quotaMinutes = Math.min(reducedActivityMinutes, aipReducedMinutes);
                } else if (aipReduction > 0) {
                    quotaMinutes -= aipReduction;
                }

                quotaMinutes *= (1 - reductionPercent / 100);

                let promoMinutes = null;
                for (const rank of PROMO_QUOTAS) {
                    if (rank.rankRoles.some(r => member.roles.cache.has(r))) {
                        promoMinutes = rank.minQuotaMinutes;
                        break;
                    }
                }
                if (promoMinutes) promoMinutes *= (1 - reductionPercent / 100);

                let countedAsPromo = false;
                if (promoMinutes && entry.totalMinutes >= promoMinutes) {
                    promoMetQuota.push(`${member} • ${entry.h}h ${entry.m}m ${entry.s}s`);
                    countedAsPromo = true;
                }

                if (!countedAsPromo) {
                    const diff = quotaMinutes - entry.totalMinutes;
                    if (diff <= 0) {
                        metQuota.push(`${member} • ${entry.h}h ${entry.m}m ${entry.s}s`);
                    } else if (diff > 0 && diff <= GRACE_PERIOD) {
                        gracePeriodMet.push(`${member} • ${entry.h}h ${entry.m}m ${entry.s}s`);
                    } else {
                        notMetQuota.push(`${member} • ${entry.h}h ${entry.m}m ${entry.s}s`);
                    }
                }
            }

            const makeEmbed = (title, members) =>
                new EmbedBuilder()
                    .setTitle(title)
                    .setColor(0x2F3136)
                    .setDescription(members.length ? members.join('\n') : 'None');

            const embeds = [
                makeEmbed('Met Promotional Quota', promoMetQuota),
                makeEmbed('Met Quota', metQuota),
                makeEmbed('Not Met Quota', notMetQuota),
                makeEmbed('Exempted (Leave Of Absence / Reduced Quota)', exempted),
                makeEmbed(`Grace Period Applied (≤${GRACE_PERIOD} min)`, gracePeriodMet)
            ];

            await interaction.channel.send({ embeds });
            await interaction.editReply({ content: '✅ Activity report submitted and processed.' });

        } catch (err) {
            console.error('❌ Error processing activity report:', err);
            await interaction.editReply({ content: '❌ Error processing activity report.' });
        }
    });
}

module.exports = { registerPromotionInfractionCommand };
