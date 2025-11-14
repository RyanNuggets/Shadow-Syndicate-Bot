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
    console.log("[ROBLOX] Login failed:", err);
  }
}

module.exports.registerRankCommand = async (client, config) => {
  await robloxLogin();

  const rankCommand = new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Open the rank panel to manage Roblox users.");
  await client.application.commands.create(rankCommand);

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isModalSubmit())
      return;

    // ----------------- SLASH COMMAND -----------------
    if (interaction.isChatInputCommand() && interaction.commandName === "rank") {
      const requiredRole = config.COMMANDS.RANK_PERMISSION_ROLE;
      if (!interaction.member.roles.cache.has(requiredRole))
        return interaction.reply({
          content: "❌ You do not have permission to use this command.",
          flags: 64,
        });

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

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    // ----------------- BUTTON: SHOW MODAL -----------------
    if (interaction.isButton() && interaction.customId === "enterUser") {
      try {
        // **Show modal immediately — no API calls before this**
        const modal = new ModalBuilder()
          .setCustomId("usernameModal")
          .setTitle("Enter Roblox Username");

        const input = new TextInputBuilder()
          .setCustomId("usernameInput")
          .setLabel("Roblox Username")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Username")
          .setRequired(true);

        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);

        return interaction.showModal(modal);
      } catch (err) {
        console.error("Modal Error:", err);
        // fallback: try a quick ephemeral reply
        if (!interaction.replied)
          return interaction.reply({
            content: `❌ Failed to show modal: ${err.message}`,
            flags: 64,
          });
      }
    }

    // ----------------- MODAL SUBMIT -----------------
    if (interaction.isModalSubmit() && interaction.customId === "usernameModal") {
      await interaction.deferReply({ flags: 64 }); // defer to buy time for API calls

      const username = interaction.fields.getTextInputValue("usernameInput");
      const groupId = config.ROBLOX.GROUP_ID;

      try {
        const userId = await noblox.getIdFromUsername(username);
        const currentRank = await noblox.getRankInGroup(groupId, userId);
        const isMember = currentRank > 0;

        const requests = await noblox.getJoinRequests(groupId);
        const isPending =
          Array.isArray(requests) && requests.some((r) => r.UserId === userId);

        const infoEmbed = new EmbedBuilder()
          .setColor("Blue")
          .setTitle("Roblox User Info")
          .addFields(
            { name: "Username", value: username, inline: true },
            { name: "In Group", value: isMember ? "✅ Yes" : "❌ No", inline: true },
            { name: "Pending Request", value: isPending ? "✅ Yes" : "❌ No", inline: true }
          );

        const buttons = new ActionRowBuilder();

        // Division buttons
        for (const div of ["DHS", "CHP", "LASD"]) {
          const d = config.DIVISIONS[div];
          buttons.addComponents(
            new ButtonBuilder()
              .setCustomId(`rank_${div}_${username}`)
              .setLabel(`${d.emoji} ${div}`)
              .setStyle(ButtonStyle.Primary)
              .setDisabled(!isMember)
          );
        }

        // Remove user button
        buttons.addComponents(
          new ButtonBuilder()
            .setCustomId(`removeUser_${username}`)
            .setLabel("Remove From Group")
            .setEmoji(config.EMOJIS.REMOVE)
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!isMember && !isPending)
        );

        return interaction.editReply({ embeds: [infoEmbed], components: [buttons] });
      } catch (err) {
        return interaction.editReply({
          content: `❌ Failed to fetch user: ${err.message}`,
        });
      }
    }

    // ----------------- BUTTON: RANK / REMOVE -----------------
    if (interaction.isButton() && (interaction.customId.startsWith("rank_") || interaction.customId.startsWith("removeUser_"))) {
      const groupId = config.ROBLOX.GROUP_ID;
      const parts = interaction.customId.split("_");
      const action = parts[0];
      const division = parts[1];
      const username = parts.slice(2).join("_");

      await interaction.deferReply({ flags: 64 });

      try {
        const userId = await noblox.getIdFromUsername(username);

        if (action === "rank") {
          const rankId = config.DIVISIONS[division].rankId;
          await noblox.setRank(groupId, userId, rankId);
        } else if (action === "removeUser") {
          await noblox.setRank(groupId, userId, 0);
        }

        const successEmbed = new EmbedBuilder()
          .setColor("Green")
          .setTitle("Action Successful")
          .setDescription(`Performed **${action}** on **${username}**.`)
          .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed], components: [] });

        const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
        if (logChannel) logChannel.send({ embeds: [successEmbed] });
      } catch (err) {
        const failEmbed = new EmbedBuilder()
          .setColor("Red")
          .setTitle("Action Failed")
          .addFields({ name: "Username", value: username }, { name: "Reason", value: err.message })
          .setTimestamp();

        await interaction.editReply({ embeds: [failEmbed] });
        const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
        if (logChannel) logChannel.send({ embeds: [failEmbed] });
      }
    }
  });
};
