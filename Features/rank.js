// Features/rank.js
const noblox = require("noblox.js");
const {
    SlashCommandBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");

let robloxLoggedIn = false;

async function robloxLogin() {
    if (robloxLoggedIn) return;

    try {
        await noblox.setCookie(process.env.ROBLOX_COOKIE);
        console.log("[ROBLOX] Logged in.");
        robloxLoggedIn = true;
    } catch (err) {
        console.log("[ROBLOX] Login failed:", err);
    }
}

async function fetchUserInfo(username, groupId) {
    const userId = await noblox.getIdFromUsername(username);
    const inGroup = await noblox.getRankInGroup(groupId, userId);

    const joinRequests = await noblox.getJoinRequests(groupId);
    const hasRequest = joinRequests.data.some(req => req.requester.userId === userId);

    return {
        userId,
        inGroup,
        hasRequest
    };
}

module.exports.registerRankCommand = async (client, config) => {
    await robloxLogin();

    const groupId = config.ROBLOX.GROUP_ID;
    const DHS_RANK = 3;
    const CHP_RANK = 4;
    const LASD_RANK = 6;

    const requiredRole = config.ROBLOX.RANK_PERMS;

    // Register command
    const command = new SlashCommandBuilder()
        .setName("rank")
        .setDescription("Open the DHS ranking panel.");
    client.application.commands.create(command);

    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== "rank") return;

        if (!interaction.member.roles.cache.has(requiredRole)) {
            return interaction.reply({
                content: "❌ You do not have permission to use this command.",
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setColor("#2b2d31")
            .setTitle("DHS Rank Panel")
            .setDescription("Click the button below to enter the Roblox username.")
            .setTimestamp();

        const button = new ButtonBuilder()
            .setCustomId("enter_user")
            .setLabel("Enter User")
            .setEmoji("<:lookup:1438837345536180385>")
            .setStyle(ButtonStyle.Primary);

        await interaction.reply({
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(button)],
            ephemeral: true
        });
    });


    // Button: Enter User → shows modal
    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isButton()) return;
        if (interaction.customId !== "enter_user") return;

        const modal = new ModalBuilder()
            .setCustomId("modal_enter_user")
            .setTitle("Enter Roblox Username");

        const input = new TextInputBuilder()
            .setCustomId("username_input")
            .setLabel("Roblox Username")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));

        await interaction.showModal(modal);
    });


    // Modal submit → fetch user info → show panel with buttons
    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isModalSubmit()) return;
        if (interaction.customId !== "modal_enter_user") return;

        const username = interaction.fields.getTextInputValue("username_input");

        await interaction.reply({ content: "⏳ Fetching user info...", ephemeral: true });

        try {
            const info = await fetchUserInfo(username, groupId);

            const embed = new EmbedBuilder()
                .setColor("#5865F2")
                .setTitle("User Lookup Result")
                .addFields(
                    { name: "Username", value: username, inline: true },
                    { name: "User ID", value: info.userId.toString(), inline: true },
                    { name: "In Group?", value: info.inGroup > 0 ? "✅ Yes" : "❌ No", inline: true },
                    { name: "Join Request?", value: info.hasRequest ? "📬 Pending" : "❌ None", inline: true }
                )
                .setTimestamp();

            const btnAccept = new ButtonBuilder()
                .setCustomId(`accept_${info.userId}`)
                .setLabel("Accept Join Request")
                .setStyle(ButtonStyle.Success)
                .setDisabled(!info.hasRequest);

            const btnDHS = new ButtonBuilder()
                .setCustomId(`rank_dhs_${info.userId}`)
                .setLabel("DHS")
                .setEmoji("<:DHS:1438835075843358720>")
                .setStyle(ButtonStyle.Primary);

            const btnCHP = new ButtonBuilder()
                .setCustomId(`rank_chp_${info.userId}`)
                .setLabel("CHP")
                .setEmoji("<:CHP:1438834718492594176>")
                .setStyle(ButtonStyle.Primary);

            const btnLASD = new ButtonBuilder()
                .setCustomId(`rank_lasd_${info.userId}`)
                .setLabel("LASD")
                .setEmoji("<:LASD:1438834657436373064>")
                .setStyle(ButtonStyle.Primary);

            await interaction.editReply({
                content: "",
                embeds: [embed],
                components: [new ActionRowBuilder().addComponents(btnAccept, btnDHS, btnCHP, btnLASD)]
            });

        } catch (err) {
            return interaction.editReply({
                content: `❌ Error: ${err.message}`
            });
        }
    });


    // Button actions: Accept or Rank
    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isButton()) return;

        const id = interaction.customId;

        // Accept request
        if (id.startsWith("accept_")) {
            const userId = Number(id.split("_")[1]);

            try {
                await noblox.handleJoinRequest(groupId, userId, true);

                await interaction.reply({
                    content: `✅ Accepted join request for **${userId}**.`,
                    ephemeral: true
                });

            } catch (e) {
                await interaction.reply({
                    content: `❌ Failed: ${e.message}`,
                    ephemeral: true
                });
            }
            return;
        }

        // Ranking
        const parts = id.split("_");
        const rankType = parts[1];
        const userId = Number(parts[2]);

        let newRank;

        if (rankType === "dhs") newRank = DHS_RANK;
        if (rankType === "chp") newRank = CHP_RANK;
        if (rankType === "lasd") newRank = LASD_RANK;

        try {
            await noblox.setRank(groupId, userId, newRank);

            await interaction.reply({
                content: `✅ Successfully ranked **${userId}** to **${rankType.toUpperCase()} (ID ${newRank})**.`,
                ephemeral: true
            });

            const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
            if (logChannel) {
                const e = new EmbedBuilder()
                    .setColor("Green")
                    .setTitle("Rank Action Logged")
                    .addFields(
                        { name: "User ID", value: userId.toString() },
                        { name: "Ranked To", value: rankType.toUpperCase() },
                        { name: "Rank ID", value: newRank.toString() },
                        { name: "Ranked By", value: `<@${interaction.user.id}>` }
                    )
                    .setTimestamp();

                logChannel.send({ embeds: [e] });
            }

        } catch (err) {
            await interaction.reply({
                content: `❌ Failed to rank: ${err.message}`,
                ephemeral: true
            });
        }
    });
};
