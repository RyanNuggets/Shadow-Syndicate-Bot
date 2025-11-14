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

    // Register slash command
    const rankCommand = new SlashCommandBuilder()
        .setName("rank")
        .setDescription("Rank a Roblox user to the fixed role.")
        .addStringOption(option =>
            option.setName("user")
                .setDescription("Roblox username to rank")
                .setRequired(true)
        );

    client.application.commands.create(rankCommand);

    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== "rank") return;

        const username = interaction.options.getString("user");
        const groupId = config.ROBLOX.GROUP_ID; 
        const fixedRoleID = config.ROBLOX.RANK_ROLE_ID; // YOU SET THIS IN CONFIG
        
        await interaction.reply({ content: `Processing rank for **${username}**...`, ephemeral: true });

        try {
            // Convert username → userId
            const userId = await noblox.getIdFromUsername(username);

            // Rank user
            await noblox.setRank(groupId, userId, fixedRoleID);

            // Success embed
            const successEmbed = new EmbedBuilder()
                .setColor("Green")
                .setTitle("Rank Successful")
                .addFields(
                    { name: "User", value: username },
                    { name: "Rank ID", value: fixedRoleID.toString() },
                    { name: "Status", value: "User has been ranked successfully." }
                );

            await interaction.editReply({ content: "", embeds: [successEmbed] });

            // Logging embed
            const logEmbed = new EmbedBuilder()
                .setColor("Blue")
                .setTitle("Rank Log")
                .addFields(
                    { name: "Ranked By", value: `${interaction.user.tag}` },
                    { name: "Target User", value: username },
                    { name: "Rank ID", value: fixedRoleID.toString() },
                    { name: "Result", value: "Success" }
                )
                .setTimestamp();

            const logChannel = client.channels.cache.get(config.CHANNELS.LOGS);
            if (logChannel) logChannel.send({ embeds: [logEmbed] });

        } catch (err) {
            console.log("RANK FAILED:", err);

            const failEmbed = new EmbedBuilder()
                .setColor("Red")
                .setTitle("Rank Failed")
                .addFields(
                    { name: "User", value: username },
                    { name: "Reason", value: "User not found or not in group." }
                );

            await interaction.editReply({ content: "", embeds: [failEmbed] });
        }
    });
};
