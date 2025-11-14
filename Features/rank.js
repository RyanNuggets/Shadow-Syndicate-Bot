// Features/rank.js
const noblox = require("noblox.js");
const {
    EmbedBuilder,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    InteractionType
} = require("discord.js");

let robloxLoggedIn = false;

async function robloxLogin() {
    if (robloxLoggedIn) return;
    try {
        await noblox.setCookie(process.env.ROBLOX_COOKIE);
        console.log("[ROBLOX] Bot logged in successfully.");
        robloxLoggedIn = true;
    } catch (err) {
        console.log("[ROBLOX] Login failed:", err);
    }
}

module.exports.registerRankCommand = async (client, config) => {
    await robloxLogin();

    // Slash command
    const rankCommand = new SlashCommandBuilder()
        .setName("rank")
        .setDescription("Open the Roblox user rank panel");

    client.application.commands.create(rankCommand);

    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isModalSubmit()) return;
        const userId = interaction.user.id;

        // Permission check
        if (interaction.isChatInputCommand() && interaction.commandName === "rank") {
            if (!interaction.member.roles.cache.has(config.COMMANDS.RANK_PERMISSION_ROLE)) {
                return interaction.reply({ content: "❌ You do not have permission.", ephemeral: true });
            }

            // Open initial embed with Enter User button
            const embed = new EmbedBuilder()
                .setTitle("Roblox Rank Panel")
                .setDescription("Click the button below to enter a Roblox username.")
                .setColor("Blue");

            const buttonRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("enter_user")
                    .setLabel(`Enter User ${config.EMOJIS.LOOKUP}`)
                    .setStyle(ButtonStyle.Primary)
            );

            return interaction.reply({ embeds: [embed], components: [buttonRow], ephemeral: true });
        }

        // Handle Enter User button
        if (interaction.isButton() && interaction.customId === "enter_user") {
            const modal = new ModalBuilder()
                .setCustomId("enter_user_modal")
                .setTitle("Enter Roblox Username");

            const usernameInput = new TextInputBuilder()
                .setCustomId("username")
                .setLabel("Roblox Username")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const row = new ActionRowBuilder().addComponents(usernameInput);
            modal.addComponents(row);

            return interaction.showModal(modal);
        }

        // Handle modal submission
        if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "enter_user_modal") {
            const username = interaction.fields.getTextInputValue("username");

            await interaction.deferReply({ ephemeral: true });

            let robloxId;
            try {
                robloxId = await noblox.getIdFromUsername(username);
            } catch (err) {
                return interaction.editReply({ content: `❌ Failed to fetch user: ${err.message}` });
            }

            // Fetch group info
            let isInGroup = false;
            let currentRank = null;
            try {
                const info = await noblox.getRankInGroup(config.ROBLOX.GROUP_ID, robloxId);
                isInGroup = info > 0;
                currentRank = info;
            } catch {
                isInGroup = false;
            }

            // Fetch join requests safely
            let requests = [];
            try {
                const reqs = await noblox.getJoinRequests(config.ROBLOX.GROUP_ID);
                requests = Array.isArray(reqs) ? reqs : [];
            } catch {}

            const hasRequest = requests.some(r => r.userId === robloxId);

            const infoEmbed = new EmbedBuilder()
                .setTitle(`User Info: ${username}`)
                .setColor("Green")
                .addFields(
                    { name: "Roblox ID", value: robloxId.toString(), inline: true },
                    { name: "In Group?", value: isInGroup ? "✅ Yes" : "❌ No", inline: true },
                    { name: "Join Request?", value: hasRequest ? "✅ Yes" : "❌ No", inline: true },
                    { name: "Current Rank", value: currentRank ? currentRank.toString() : "N/A", inline: true }
                );

            const row = new ActionRowBuilder();

            // Accept Join Request
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId("accept_join")
                    .setLabel("Accept Join Request")
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(isInGroup || !hasRequest)
            );

            // Department buttons
            for (const dept in config.DIVISIONS) {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`rank_${dept}`)
                        .setLabel(`${config.DIVISIONS[dept].emoji} ${dept}`)
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(!isInGroup || currentRank === config.DIVISIONS[dept].rankId)
                );
            }

            // Remove from group button
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId("remove_group")
                    .setLabel(`Remove From Group ${config.EMOJIS.REMOVE}`)
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(!isInGroup)
            );

            return interaction.editReply({ embeds: [infoEmbed], components: [row] });
        }

        // Handle department / accept / remove buttons
        if (interaction.isButton()) {
            const [action, dept] = interaction.customId.split("_");
            await interaction.deferReply({ ephemeral: true });

            let robloxUser;
            try {
                // Embed message contains Roblox ID in fields
                robloxUser = parseInt(interaction.message.embeds[0].data.fields.find(f => f.name === "Roblox ID").value);
            } catch {
                return interaction.editReply({ content: "❌ Could not determine Roblox user." });
            }

            try {
                if (action === "accept") {
                    await noblox.handleJoinRequest(config.ROBLOX.GROUP_ID, robloxUser, true);
                    return interaction.editReply({ content: `✅ User accepted into the group.` });
                }

                if (action === "rank") {
                    const rankId = config.DIVISIONS[dept].rankId;
                    await noblox.setRank(config.ROBLOX.GROUP_ID, robloxUser, rankId);
                    return interaction.editReply({ content: `✅ User ranked to ${dept} (ID ${rankId}).` });
                }

                if (action === "remove") {
                    await noblox.setRank(config.ROBLOX.GROUP_ID, robloxUser, 0); // Remove from group
                    return interaction.editReply({ content: `✅ User removed from group.` });
                }
            } catch (err) {
                return interaction.editReply({ content: `❌ Failed: ${err.message}` });
            }
        }
    });
};
