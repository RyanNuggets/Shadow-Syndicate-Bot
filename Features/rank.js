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
  InteractionType,
  InteractionResponseFlags
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

  // Define /rank command with no options
  const rankCommand = new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Open the rank panel to manage Roblox users.");

  // Register globally
  client.application.commands.create(rankCommand);

  client.on("interactionCreate", async (interaction) => {
    if (
      !interaction.isChatInputCommand() &&
      !interaction.isButton() &&
      !interaction.isModalSubmit()
    )
      return;

    // ---------- Slash Command ----------
    if (interaction.isChatInputCommand() && interaction.commandName === "rank") {
      const requiredRole = config.COMMANDS.RANK_PERMISSION_ROLE;
      if (!interaction.member.roles.cache.has(requiredRole)) {
        return interaction.reply({
          content: "❌ You do not have permission to use this command.",
          flags: InteractionResponseFlags.Ephemeral,
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

      await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: InteractionResponseFlags.Ephemeral,
      });
    }

    // ---------- Button Clicks ----------
    if (interaction.isButton()) {
      if (interaction.customId === "enterUser") {
        try {
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

          await interaction.showModal(modal);
        } catch (err) {
          console.error("Failed to show modal:", err);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: `❌ Failed to show modal: ${err.message}`,
              flags: InteractionResponseFlags.Ephemeral,
            });
          } else {
            await interaction.followUp({
              content: `❌ Failed to show modal: ${err.message}`,
              flags: InteractionResponseFlags.Ephemeral,
            });
          }
        }
      }

      // Handling rank buttons
      if (
        interaction.customId.startsWith("rank_") ||
        interaction.customId.startsWith("removeUser")
      ) {
        const [action, username] = interaction.customId.split("_").slice(0, 2);

        try {
          const userId = await noblox.getIdFromUsername(username);
          const groupId = config.ROBLOX.GROUP_ID;

          if (action === "rank") {
            const division = interaction.customId.split("_")[1];
            const rankId = config.DIVISIONS[division]?.rankId;
            if (rankId) await noblox.setRank(groupId, userId, rankId);
          } else if (action === "removeUser") {
            await noblox.setRank(groupId, userId, 0);
          }

          const successEmbed = new EmbedBuilder()
            .setColor("Green")
            .setTitle("Action Successful")
            .setDescription(`Performed **${interaction.customId}** on **${username}**.`)
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

          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ embeds: [failEmbed], flags: InteractionResponseFlags.Ephemeral });
          } else {
            await interaction.update({ embeds: [failEmbed], components: [] });
          }

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

        // Fix getJoinRequests for newer noblox.js
        const requestsData = await noblox.getJoinRequests(groupId);
        const requestsArray = Array.isArray(requestsData)
          ? requestsData
          : requestsData.data || [];
        const isPending = requestsArray.some((r) => r.UserId === userId);

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

        await interaction.reply({
          embeds: [infoEmbed],
          components: [buttons],
          flags: InteractionResponseFlags.Ephemeral,
        });
      } catch (err) {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `❌ Failed to fetch user: ${err.message}`, flags: InteractionResponseFlags.Ephemeral });
        } else {
          await interaction.followUp({ content: `❌ Failed to fetch user: ${err.message}`, flags: InteractionResponseFlags.Ephemeral });
        }
      }
    }
  });
};
