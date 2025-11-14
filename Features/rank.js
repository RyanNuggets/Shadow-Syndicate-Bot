// Features/rank.js
const noblox = require("noblox.js");
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextInputBuilder,
  TextInputStyle,
  ModalBuilder,
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
    console.error("[ROBLOX] Login failed:", err);
  }
}

module.exports.registerRankCommand = async (client, config) => {
  await robloxLogin();

  // Define /rank command
  const rankCommand = new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Open the rank panel to manage Roblox users.");

  // Register globally
  client.application.commands.create(rankCommand);

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isModalSubmit()) return;

    // ---------- Slash Command ----------
    if (interaction.isChatInputCommand() && interaction.commandName === "rank") {
      const requiredRole = config.COMMANDS.RANK_PERMISSION_ROLE;
      if (!interaction.member.roles.cache.has(requiredRole)) {
        return interaction.reply({
          content: "❌ You do not have permission to use this command.",
          ephemeral: true,
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("Roblox Rank Panel")
        .setDescription("Click the button below to enter a Roblox username.")
        .setColor("Blue");

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("enterUser")
          .setLabel("Enter User")
          .setEmoji(config.EMOJIS.LOOKUP)
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    // ---------- Button Clicks ----------
    if (interaction.isButton()) {
      if (interaction.customId === "enterUser") {
        const modal = new ModalBuilder()
          .setCustomId("usernameModal")
          .setTitle("Enter Roblox Username");

        const input = new TextInputBuilder()
          .setCustomId("usernameInput")
          .setLabel("Roblox Username")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Username")
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId.startsWith("rank_") || interaction.customId.startsWith("removeUser")) {
        const parts = interaction.customId.split("_");
        const action = parts[1]; // DHS, CHP, LASD, or 'User'
        const username = parts.slice(2).join("_"); // In case username has underscores
        const groupId = config.ROBLOX.GROUP_ID;

        try {
          const userId = await noblox.getIdFromUsername(username);

          if (action === "DHS") await noblox.setRank(groupId, userId, config.DIVISIONS.DHS.rankId);
          else if (action === "CHP") await noblox.setRank(groupId, userId, config.DIVISIONS.CHP.rankId);
          else if (action === "LASD") await noblox.setRank(groupId, userId, config.DIVISIONS.LASD.rankId);
          else if (action === "User") await noblox.setRank(groupId, userId, 0); // remove from group

          const successEmbed = new EmbedBuilder()
            .setColor("Green")
            .setTitle("Action Successful")
            .setDescription(`Performed **${action}** on **${username}**.`)
            .setTimestamp();

          await interaction.update({ embeds: [successEmbed], components: [] });

          const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
          if (logChannel) logChannel.send({ embeds: [successEmbed] });
        } catch (err) {
          const failEmbed = new EmbedBuilder()
            .setColor("Red")
            .setTitle("Action Failed")
            .addFields(
              { name: "Username", value: username },
              { name: "Reason", value: err.message || "Unknown error" }
            )
            .setTimestamp();

          await interaction.update({ embeds: [failEmbed], components: [] });

          const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
          if (logChannel) logChannel.send({ embeds: [failEmbed] });
        }
      }
    }

    // ---------- Modal Submit ----------
    if (interaction.isModalSubmit() && interaction.customId === "usernameModal") {
      const username = interaction.fields.getTextInputValue("usernameInput");
      const groupId = config.ROBLOX.GROUP_ID;

      try {
        const userId = await noblox.getIdFromUsername(username);
        const currentRank = await noblox.getRankInGroup(groupId, userId);
        const isMember = currentRank > 0;

        const requests = await noblox.getJoinRequests(groupId);
        const isPending = requests.some((r) => r.UserId === userId);

        const infoEmbed = new EmbedBuilder()
          .setColor("Blue")
          .setTitle("Roblox User Info")
          .addFields(
            { name: "Username", value: username, inline: true },
            { name: "In Group", value: isMember ? "✅ Yes" : "❌ No", inline: true },
            { name: "Pending Request", value: isPending ? "✅ Yes" : "❌ No", inline: true }
          );

        const buttons = new ActionRowBuilder();

        buttons.addComponents(
          new ButtonBuilder()
            .setCustomId(`rank_DHS_${username}`)
            .setLabel(`${config.DIVISIONS.DHS.emoji} DHS`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(isMember)
        );
        buttons.addComponents(
          new ButtonBuilder()
            .setCustomId(`rank_CHP_${username}`)
            .setLabel(`${config.DIVISIONS.CHP.emoji} CHP`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!isMember)
        );
        buttons.addComponents(
          new ButtonBuilder()
            .setCustomId(`rank_LASD_${username}`)
            .setLabel(`${config.DIVISIONS.LASD.emoji} LASD`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!isMember)
        );
        buttons.addComponents(
          new ButtonBuilder()
            .setCustomId(`removeUser_${username}`)
            .setLabel("Remove From Group")
            .setEmoji(config.EMOJIS.REMOVE)
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!isMember && !isPending)
        );

        await interaction.reply({ embeds: [infoEmbed], components: [buttons], ephemeral: true });
      } catch (err) {
        await interaction.reply({ content: `❌ Failed to fetch user: ${err.message}`, ephemeral: true });
      }
    }
  });
};
