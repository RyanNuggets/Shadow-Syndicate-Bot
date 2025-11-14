// Features/rank.js
const noblox = require("noblox.js");
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
    .addStringOption(option =>
      option.setName("user")
        .setDescription("Roblox username")
        .setRequired(true)
    );

  await client.application.commands.create(rankCommand);

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

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
        const requests = Array.isArray(requestsRaw) ? requestsRaw : requestsRaw.data || [];
        const isPending = requests.some(r => Number(r.UserId) === Number(userId));

        const infoEmbed = new EmbedBuilder()
          .setColor("Blue")
          .setTitle("Roblox User Info")
          .addFields(
            { name: "Username", value: username, inline: true },
            { name: "In Group", value: isMember ? "✅ Yes" : "❌ No", inline: true },
            { name: "Pending Request", value: isPending ? "✅ Yes" : "❌ No", inline: true }
          );

        const buttons = new ActionRowBuilder();

        // Divisions buttons
        for (const div of Object.keys(config.DIVISIONS)) {
          const d = config.DIVISIONS[div];
          buttons.addComponents(
            new ButtonBuilder()
              .setCustomId(`rank_${div}_${username}`)
              .setLabel(div)
              .setEmoji(d.emoji) // should be {id,name} for custom emoji
              .setStyle(ButtonStyle.Primary)
              .setDisabled(!isMember)
          );
        }

        // Remove From Group button
        buttons.addComponents(
          new ButtonBuilder()
            .setCustomId(`removeUser_${username}`)
            .setLabel("Remove From Group")
            .setEmoji(config.EMOJIS.REMOVE)
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!isMember && !isPending)
        );

        // Accept Group Request button if pending
        if (isPending && !isMember) {
          buttons.addComponents(
            new ButtonBuilder()
              .setCustomId(`acceptRequest_${username}`)
              .setLabel("Accept Request")
              .setEmoji("✅")
              .setStyle(ButtonStyle.Success)
          );
        }

        return interaction.editReply({
          embeds: [infoEmbed],
          components: [buttons],
        });
      } catch (err) {
        return interaction.editReply({
          content: `❌ Failed to fetch user: ${err.message}`,
        });
      }
    }

    // --------------------- BUTTON HANDLER ---------------------
    if (interaction.isButton()) {
      await interaction.deferReply({ flags: 64 });

      const [action, division, ...rest] = interaction.customId.split("_");
      const username = rest.join("_");

      try {
        const userId = await noblox.getIdFromUsername(username);

        if (action === "rank") {
          const rankId = config.DIVISIONS[division].rankId;
          await noblox.setRank(groupId, userId, rankId);
        }

        if (action === "removeUser") {
          await noblox.setRank(groupId, userId, 0);
        }

        if (action === "acceptRequest") {
          await noblox.acceptJoinRequest(groupId, userId);
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
