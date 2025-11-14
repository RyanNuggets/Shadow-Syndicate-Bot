const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType } = require("discord.js");
const Roblox = require("noblox.js"); // make sure noblox.js is logged in
const { EMOJIS } = require("./config.json");

module.exports = {
    name: "rank",
    description: "Manage Roblox group ranks",
    async execute(client, interaction) {
        if (interaction.isButton()) {
            if (interaction.customId === "enter_user") {
                // Show modal immediately
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

                try {
                    await interaction.showModal(modal);
                } catch (err) {
                    console.error("Failed to show modal:", err);
                    await interaction.reply({ content: "❌ Failed to open modal.", flags: 64 });
                }
            } else if (interaction.customId === "remove_user") {
                // Remove from group button
                const username = interaction.message.embeds[0]?.description?.split("\n")[0]; // adjust depending on your embed
                if (!username) {
                    return await interaction.reply({ content: "❌ Could not find user.", flags: 64 });
                }

                try {
                    const userId = await Roblox.getIdFromUsername(username);
                    await Roblox.setRank(process.env.GROUP_ID, userId, 0); // rank 0 = remove from group
                    await interaction.reply({ content: `✅ ${username} removed from the group.`, flags: 64 });
                } catch (err) {
                    console.error(err);
                    await interaction.reply({ content: `❌ Failed to remove ${username} from the group.`, flags: 64 });
                }
            }
        } else if (interaction.type === InteractionType.ModalSubmit) {
            if (interaction.customId === "enter_user_modal") {
                await interaction.deferReply({ ephemeral: true });

                const username = interaction.fields.getTextInputValue("username");

                try {
                    const userId = await Roblox.getIdFromUsername(username);
                    const rank = await Roblox.getRankNameInGroup(process.env.GROUP_ID, userId);

                    const acceptButton = new ButtonBuilder()
                        .setCustomId("accept_join")
                        .setLabel("Accept Join Request")
                        .setStyle(ButtonStyle.Success);

                    const removeButton = new ButtonBuilder()
                        .setCustomId("remove_user")
                        .setLabel("Remove From Group")
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji(EMOJIS.REMOVE);

                    const row = new ActionRowBuilder().addComponents(acceptButton, removeButton);

                    await interaction.editReply({ content: `User: ${username}\nCurrent Rank: ${rank}`, components: [row] });
                } catch (err) {
                    console.error(err);
                    await interaction.editReply({ content: `❌ Failed to fetch user: ${err.message}` });
                }
            }
        }
    },
};
