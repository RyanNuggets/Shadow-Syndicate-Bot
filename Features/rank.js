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
    .setDescription("Manage a Roblox user")
    .addStringOption(option =>
      option
        .setName("user")
        .setDescription("Roblox username")
        .setRequired(true)
    );

  client.application.commands.create(rankCommand);

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

    const groupId = config.ROBLOX.GROUP_ID;

    // --------------------- SLASH COMMAND ---------------------
    if (interaction.isChatInputCommand() && interaction.commandName === "rank") {
      const requiredRole = config.COMMANDS.RANK_PERMISSION_ROLE;
      if (!interaction.member.roles.cache.has(requiredRole)) {
        return interaction.reply({
          content: "❌ You do not have permission to use this command.",
          ephemeral: true,
        });
      }

      const username = interaction.options.getString("user");

      try {
        const userId = await noblox.getIdFromUsername(username);
        const currentRank = await noblox.getRankInGroup(groupId, userId);
        const isMember = currentRank > 0;

        const requests = await noblox.getJoinRequests(groupId);
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

        // Division rank buttons
        for (const div of Object.keys(config.DIVISIONS)) {
          const d = config.DIVISIONS[div];
          buttons.addComponents(
            new ButtonBuilder()
              .setCustomId(`rank_${div}_${username}`)
              .setLabel(div)
              .setEmoji(d.emoji)
              .setStyle(ButtonStyle.Primary)
              .setDisabled(!isMember)
          );
        }

        // Remove / Accept buttons
        if (isPending && !isMember) {
          buttons.addComponents(
            new ButtonBuilder()
              .setCustomId(`acceptRequest_${username}`)
              .setLabel("Accept Request")
              .setEmoji("✅")
              .setStyle(ButtonStyle.Success)
          );
        } else {
          buttons.addComponents(
            new ButtonBuilder()
              .setCustomId(`removeUser_${username}`)
              .setLabel("Remove From Group")
              .setEmoji(config.EMOJIS.REMOVE)
              .setStyle(ButtonStyle.Danger)
              .setDisabled(!isMember)
          );
        }

        await interaction.reply({ embeds: [infoEmbed], components: [buttons] });
      } catch (err) {
        return interaction.reply({
          content: `❌ Failed to fetch user: ${err.message}`,
          ephemeral: true,
        });
      }
    }

    // --------------------- BUTTON HANDLER ---------------------
    if (interaction.isButton()) {
      await interaction.deferReply({ ephemeral: true });

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
