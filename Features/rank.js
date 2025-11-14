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

// --------------------- ROBLOX LOGIN ---------------------
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

// --------------------- REGISTER COMMAND ---------------------
module.exports.registerRankCommand = async (client, config) => {
  await robloxLogin();

  const rankCommand = new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Open the rank panel to manage Roblox users.");

  // Check if client.application exists before attempting to create global commands
  if (client.application && client.application.commands) {
    await client.application.commands.create(rankCommand);
  } else {
    // If running in a guild context, you might use:
    // const guild = client.guilds.cache.get(config.GUILD_ID);
    // if (guild) guild.commands.create(rankCommand);
    console.warn("Client application not available to register global command. Skipping /rank command creation.");
  }

  client.on("interactionCreate", async (interaction) => {
    // Ignore unrelated interactions
    if (
      !interaction.isChatInputCommand() &&
      !interaction.isButton() &&
      !interaction.isModalSubmit()
    )
      return;

    // --------------------- SLASH COMMAND ---------------------
    if (interaction.isChatInputCommand() && interaction.commandName === "rank") {
      // Use interaction.member.roles.cache for better performance
      const requiredRole = config.COMMANDS.RANK_PERMISSION_ROLE;

      if (!interaction.member.roles.cache.has(requiredRole)) {
        return interaction.reply({
          content: "❌ You do not have permission to use this command.",
          flags: 64, // EPHEMERAL
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

      return interaction.reply({
        embeds: [embed],
        components: [row],
      });
    }

    // --------------------- BUTTON: SHOW MODAL IMMEDIATELY ---------------------
    if (interaction.isButton() && interaction.customId === "enterUser") {
      // The logic here is technically correct, but if the bot is slow, it times out.
      // Ensuring no async calls precede this is key, which the original code does.
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

        // This must be the immediate response to the button click (within 3s).
        return interaction.showModal(modal);
      } catch (err) {
        console.error("Modal Error:", err);
        return interaction.reply({
          content: `❌ Failed to show modal. Please try again.`,
          flags: 64,
        });
      }
    }

    // --------------------- MODAL SUBMIT ---------------------
    if (interaction.isModalSubmit() && interaction.customId === "usernameModal") {
      // Defer reply immediately as we have async operations (Roblox API calls)
      await interaction.deferReply({ flags: 64 });

      const username = interaction.fields.getTextInputValue("usernameInput");
      const groupId = config.ROBLOX.GROUP_ID;

      try {
        const userId = await noblox.getIdFromUsername(username);
        
        // Fetch current rank and membership status
        const currentRank = await noblox.getRankInGroup(groupId, userId);
        const isMember = currentRank > 0;
        
        // Check for pending request status separately
        let isPending = false;
        if (!isMember) {
            const requests = await noblox.getJoinRequests(groupId);
            // Ensure requests is an array and check if the user's ID matches a pending request
            isPending = Array.isArray(requests) && requests.some((r) => r.UserId === userId);
        }

        const infoEmbed = new EmbedBuilder()
          .setColor("Blue")
          .setTitle("Roblox User Info")
          .setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=420&height=420&format=png`)
          .addFields(
            { name: "Username", value: username, inline: true },
            { name: "Current Rank", value: isMember ? currentRank.toString() : "N/A", inline: true },
            { name: "In Group", value: isMember ? "✅ Yes" : "❌ No", inline: true },
            {
              name: "Pending Request",
              value: isPending ? "✅ Yes" : "❌ No",
              inline: true,
            }
          );

        const buttons = new ActionRowBuilder();

        // Divisions
        for (const div of ["DHS", "CHP", "LASD"]) {
          const d = config.DIVISIONS[div];
          buttons.addComponents(
            new ButtonBuilder()
              .setCustomId(`rank_${div}_${username}`)
              .setLabel(`${d.emoji} ${div}`)
              .setStyle(ButtonStyle.Primary)
              // Only allow ranking if they are currently a member
              .setDisabled(!isMember) 
          );
        }

        // Remove button
        buttons.addComponents(
          new ButtonBuilder()
            .setCustomId(`removeUser_${username}`)
            .setLabel(isMember ? "Exile Member" : "Deny Request") // Clarify the button label
            .setEmoji(config.EMOJIS.REMOVE)
            .setStyle(ButtonStyle.Danger)
            // Enable if member OR pending
            .setDisabled(!isMember && !isPending) 
        );

        await interaction.editReply({
          embeds: [infoEmbed],
          components: [buttons],
        });
      } catch (err) {
        await interaction.editReply({
          content: `❌ Failed to fetch user information. Reason: ${err.message}`,
        });
      }
    }

    // --------------------- BUTTON: RANK ACTIONS ---------------------
    if (
      interaction.isButton() &&
      (interaction.customId.startsWith("rank_") ||
        interaction.customId.startsWith("removeUser_"))
    ) {
      const groupId = config.ROBLOX.GROUP_ID;
      const parts = interaction.customId.split("_");
      const action = parts[0];
      const division = parts[1]; // Will be undefined for removeUser
      const username = parts.slice(action === "rank" ? 2 : 1).join("_"); // Corrected to handle division part if present

      await interaction.deferReply({ flags: 64 });

      try {
        const userId = await noblox.getIdFromUsername(username);
        let actionType = "";
        let logMessage = "";

        if (action === "rank") {
          const rankId = config.DIVISIONS[division].rankId;
          await noblox.setRank(groupId, userId, rankId);
          actionType = "Ranked";
          logMessage = `Ranked **${username}** to **${division}** (${rankId}).`;
        }

        if (action === "removeUser") {
          const currentRank = await noblox.getRankInGroup(groupId, userId);
          const isMember = currentRank > 0;

          if (isMember) {
            // Exile member
            await noblox.setRank(groupId, userId, 0);
            actionType = "Exiled";
            logMessage = `Exiled **${username}** (Rank: ${currentRank}) from the group.`;
          } else {
            // Deny pending request
            await noblox.denyJoinRequest(groupId, userId);
            actionType = "Denied Request";
            logMessage = `Denied join request for **${username}**.`;
          }
        }

        const successEmbed = new EmbedBuilder()
          .setColor("Green")
          .setTitle(`${actionType} Successful`)
          .setDescription(logMessage)
          .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed], components: [] });

        // Logging
        const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
        if (logChannel) logChannel.send({ embeds: [successEmbed] });
      } catch (err) {
        const failEmbed = new EmbedBuilder()
          .setColor("Red")
          .setTitle("Action Failed")
          .addFields(
            { name: "Username", value: username, inline: true },
            { name: "Attempted Action", value: action === 'rank' ? `Rank to ${division}` : 'Remove/Exile/Deny', inline: true},
            { name: "Reason", value: err.message }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [failEmbed] });

        // Logging
        const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
        if (logChannel) logChannel.send({ embeds: [failEmbed] });
      }
    }
  });
};
