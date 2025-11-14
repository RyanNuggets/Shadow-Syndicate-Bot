// Features/rank.js
const noblox = require("noblox.js");
const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");

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

    // Define /rank command
    const rankCommand = new SlashCommandBuilder()
        .setName("rank")
        .setDescription("Rank a Roblox user to the fixed role.")
        .addStringOption(option =>
            option
                .setName("user")
                .setDescription("Roblox username to rank")
                .setRequired(true)
        );

    // Register command globally
    client.application.commands.create(rankCommand);

    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== "rank") return;

        // Permission check
        const requiredRole = config.ROBLOX.RANK_PERMS;
        if (!interaction.member.roles.cache.has(requiredRole)) {
            return interaction.reply({
                content: "❌ You do not have permission to use this command.",
                ephemeral: true
            });
        }

        const username = interaction.options.getString("user");
        const groupId = config.ROBLOX.GROUP_ID;
        const fixedRoleID = config.ROBLOX.RANK_ROLE_ID;

        await interaction.reply({
            content: `⏳ Processing rank for **${username}**...`,
            ephemeral: true
        });

        try {
            // Get Roblox user ID
            const userId = await noblox.getIdFromUsername(username);

            // Apply rank
            await noblox.setRank(groupId, userId, fixedRoleID);

            // Success embed
            const successEmbed = new EmbedBuilder()
                .setColor("Green")
                .setTitle("Rank Successful")
                .addFields(
                    { name: "Roblox User", value: username, inline: true },
                    { name: "New Rank ID", value: fixedRoleID.toString(), inline: true },
                    { name: "Ranked By", value: `<@${interaction.user.id}>`, inline: false }
                )
                .setTimestamp();

            await interaction.editReply({ content: "", embeds: [successEmbed] });

            // Send log to rank logs channel
            const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
            if (logChannel) logChannel.send({ embeds: [successEmbed] });

        } catch (err) {
            console.log("RANK FAILED:", err);

            const failEmbed = new EmbedBuilder()
                .setColor("Red")
                .setTitle("Rank Failed")
                .addFields(
                    { name: "Roblox User", value: username },
                    { name: "Reason", value: err.message || "Unknown error" },
                    { name: "Requested By", value: `<@${interaction.user.id}>` }
                )
                .setTimestamp();

            await interaction.editReply({ content: "", embeds: [failEmbed] });

            const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
            if (logChannel) logChannel.send({ embeds: [failEmbed] });
        }
    });
};
