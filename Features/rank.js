// Features/rank.js
const noblox = require("noblox.js");
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
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

  const rankCommand = new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Manage Roblox users in the group")
    .addStringOption((option) =>
      option
        .setName("user")
        .setDescription("Roblox username")
        .setRequired(true)
    );

  await client.application.commands.create(rankCommand);

  client.on("interactionCreate", async (interaction) => {
    const groupId = config.ROBLOX.GROUP_ID;

    // --------------------- SLASH COMMAND ---------------------
    if (interaction.isChatInputCommand() && interaction.commandName === "rank") {
      const requiredRole = config.COMMANDS.RANK_PERMISSION_ROLE;
      if (!interaction.member.roles.cache.has(requiredRole)) {
        return interaction.reply({
          content: "❌ You do not have permission to use this command.",
          flags: 64,
        });
      }

      const username = interaction.options.getString("user");
      await interaction.deferReply({ flags: 64 });

      try {
        const userId = await noblox.getIdFromUsername(username);
        const currentRank = await noblox.getRankInGroup(groupId, userId);
        const isMember = currentRank > 0;

        const requestsRaw = await noblox.getJoinRequests(groupId);
        const requests = Array.isArray(requestsRaw)
          ? requestsRaw
          : requestsRaw.data || [];
        const isPending = requests.some(
          (r) => Number(r.UserId) === Number(userId)
        );

        const embed = new EmbedBuilder()
          .setColor("Blue")
          .setTitle("Roblox User Info")
          .addFields(
            { name: "Username", value: username, inline: true },
            { name: "In Group", value: isMember ? "✅ Yes" : "❌ No", inline: true },
            { name: "Pending Request", value: isPending ? "✅ Yes" : "❌ No", inline: true }
          );

        // --------------------- DROPDOWN ---------------------
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`rankMenu_${username}`)
          .setPlaceholder("Select an action")
          .setMinValues(1)
          .setMaxValues(1);

        // Add divisions
        for (const divName of Object.keys(config.DIVISIONS)) {
          const div = config.DIVISIONS[divName];
          selectMenu.addOptions({
            label: divName,
            value: `rank_${divName}`,
            emoji: div.emoji,
            description: isMember ? `Set rank to ${divName}` : "User not in group",
          });
        }

        // Remove user
        selectMenu.addOptions({
          label: "Remove from Group",
          value: "remove",
          description: isMember || isPending ? "Remove this user" : "Not available",
        });

        // Accept join request if pending
        if (isPending && !isMember) {
          selectMenu.addOptions({
            label: "Accept Join Request",
            value: "accept",
            description: "Accept the pending request",
          });
        }

        const row = new ActionRowBuilder().addComponents(selectMenu);

        return interaction.editReply({
          embeds: [embed],
          components: [row],
        });
      } catch (err) {
        return interaction.editReply({
          content: `❌ Failed to fetch user: ${err.message}`,
        });
      }
    }

    // --------------------- DROPDOWN HANDLER ---------------------
    if (interaction.isStringSelectMenu()) {
      await interaction.deferUpdate();

      const username = interaction.customId.replace("rankMenu_", "");
      const selected = interaction.values[0];

      try {
        const userId = await noblox.getIdFromUsername(username);

        if (selected.startsWith("rank_")) {
          const division = selected.replace("rank_", "");
          const rankId = config.DIVISIONS[division].rankId;
          await noblox.setRank(groupId, userId, rankId);
        }

        if (selected === "remove") {
          await noblox.setRank(groupId, userId, 0);
        }

        if (selected === "accept") {
          await noblox.acceptJoinRequest(groupId, userId);
        }

        const successEmbed = new EmbedBuilder()
          .setColor("Green")
          .setTitle("Action Successful")
          .setDescription(`Performed **${selected}** on **${username}**`)
          .setTimestamp();

        await interaction.editReply({
          embeds: [successEmbed],
          components: [],
        });

        const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
        if (logChannel) logChannel.send({ embeds: [successEmbed] });
      } catch (err) {
        const failEmbed = new EmbedBuilder()
          .setColor("Red")
          .setTitle("Action Failed")
          .addFields(
            { name: "Username", value: username },
            { name: "Reason", value: err.message }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [failEmbed], components: [] });

        const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
        if (logChannel) logChannel.send({ embeds: [failEmbed] });
      }
    }
  });
};
