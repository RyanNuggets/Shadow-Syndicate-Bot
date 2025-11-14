// Features/rank.js
const { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    InteractionType,
    SlashCommandBuilder 
} = require("discord.js");
const Roblox = require("noblox.js"); // make sure noblox.js is logged in
const { EMOJIS, ROBLOX, COMMANDS } = require("../config.json");

// Function called from index.js
async function registerRankCommand(client, config) {
    // Create /rank slash command
    const data = new SlashCommandBuilder()
        .setName("rank")
        .setDescription("Manage Roblox group ranks");

    try {
        await client.application.commands.create(data, config.GUILD_ID);
        console.log('✅ /rank command registered successfully.');
    } catch (error) {
        console.error('❌ Failed to register /rank command:', error);
    }

    // Interaction handler
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand() && !interaction.isButton() && interaction.type !== InteractionType.ModalSubmit) return;

        // --- Slash Command ---
        if (interaction.isChatInputCommand() && interaction.commandName === "rank") {
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
                await interaction.reply({ content: "❌ Failed to open modal.", ephemeral: true });
            }
        }

        // --- Buttons ---
        else if (interaction.isButton()) {
            if (interaction.customId === "enter_user") {
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
                    await interaction.reply({ content: "❌ Failed to open modal.", ephemeral: true });
                }
            } else if (interaction.customId === "remove_user") {
                const username = interaction.message.embeds[0]?.description?.split("\n")[0]; // adjust if needed
                if (!username) return await interaction.reply({ content: "❌ Could not find user.", ephemeral: true });

                try {
                    const userId = await Roblox.getIdFromUsername(username);
                    await Roblox.setRank(ROBLOX.GROUP_ID, userId, 0); // rank 0 = remove from group
                    await interaction.reply({ content: `✅ ${username} removed from the group.`, ephemeral: true });
                } catch (err) {
                    console.error(err);
                    await interaction.reply({ content: `❌ Failed to remove ${username} from the group.`, ephemeral: true });
                }
            }
        }

        // --- Modal Submit ---
        else if (interaction.type === InteractionType.ModalSubmit) {
            if (interaction.customId === "enter_user_modal") {
                await interaction.deferReply({ ephemeral: true });

                const username = interaction.fields.getTextInputValue("username");

                try {
                    const userId = await Roblox.getIdFromUsername(username);
                    const rank = await Roblox.getRankNameInGroup(ROBLOX.GROUP_ID, userId);

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
    });
}

module.exports = { registerRankCommand };
