const noblox = require("noblox.js");
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

// --- CUSTOM EMOJI MAPPING ---
const EMOJIS = {
  CATEGORY_RANKS: "<:RTO:1421570606863876166>",
  CATEGORY_ACTIONS: "<:Hammer:1234026434973143071>",
  DHS: "<:DHS:1438835075843358720>",
  CHP: "<:CHP:1438834718492594176>",
  LASD: "<:LASD:1438834657432594176>",
  ACCEPT: "<:Addition:1272335252647444500>",
  EXILE: "<:bullet:1410911432253378601>",
  BACK: "<:back:1438906842901254324>",
  CANCEL: "<:trashicon:1233617122731757568>",
};

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

const resolveRankName = async (rankId, userId, configDivisions, groupId) => {
  if (rankId === 0) return "Not in Group";
  for (const [name, div] of Object.entries(configDivisions)) {
    if (div.rankId === rankId) return name;
  }
  try {
    return await noblox.getRankNameInGroup(groupId, userId);
  } catch (e) {
    console.error(`Failed to get official rank name for User ID ${userId} (Rank ID ${rankId}): ${e.message}`);
    return "Unknown Rank (API Error)";
  }
};

// Build category dropdown, restricted to executor only
const buildCategoryComponents = (username, isMember, isPending, executorId) => {
  const categorySelectMenu = new StringSelectMenuBuilder()
      .setCustomId(`categorySelect_${username}_${executorId}`) // append executor ID
      .setMinValues(1)
      .setMaxValues(1)
      .setPlaceholder("Select a Rank Action Category...");

  let categoryOptions = [];

  if (isMember) {
      categoryOptions.push({
          label: "Department Ranks",
          value: "category_ranks",
          description: "Promote or demote the user across department ranks.",
          emoji: EMOJIS.CATEGORY_RANKS
      });
  }

  if (isMember || isPending) {
      categoryOptions.push({
          label: "Administrative Actions",
          value: "category_actions",
          description: "Handle Exiling a member or accepting a Join Request.",
          emoji: EMOJIS.CATEGORY_ACTIONS
      });
  }

  categoryOptions.push({
      label: 'Cancel Panel',
      value: 'cancel',
      description: 'Close the rank panel.',
      emoji: EMOJIS.CANCEL
  });

  let components = [];
  
  if (categoryOptions.length > 0) {
      categorySelectMenu.addOptions(categoryOptions);
      components.push(new ActionRowBuilder().addComponents(categorySelectMenu));
  }

  return components;
};

const getPanelContent = async (username, groupId, config, interactionUserTag = null, executorId = null) => {
    const userId = await noblox.getIdFromUsername(username);
    const currentRankId = await noblox.getRankInGroup(groupId, userId);
    const isMember = currentRankId > 0;
    
    let isPending = false;
    if (!isMember) {
      let cursor = null;
      let requestsData;
      do {
          try { 
              requestsData = await noblox.getJoinRequests(groupId, { cursor: cursor, limit: 50 }); 
          } catch (e) { 
              console.error(`Error fetching join requests: ${e.message}`);
              requestsData = { data: [] };
          }
          const requests = Array.isArray(requestsData) ? requestsData : requestsData?.data || [];
          if (requests.length === 0) break;
          isPending = requests.some((r) => {
            const id = r.requester?.userId ?? r.UserId ?? r.userId ?? r.user?.userId ?? r.id ?? 0;
            return Number(id) === Number(userId);
          });
          if (isPending) break;
          cursor = requestsData.nextPageCursor;
      } while (cursor && !isPending);
    }
    
    let rankStatusValue = "Not in Group";
    if (isPending) rankStatusValue = `Pending Request`;
    else if (isMember) {
        try {
            rankStatusValue = await noblox.getRankNameInGroup(groupId, userId);
        } catch (e) {
            console.error(`Failed to get official rank name for User ID ${userId}: ${e.message}`);
            rankStatusValue = `Member (Rank ID: ${currentRankId})`;
        }
    }

    let thumbnailUrl = null;
    try {
        const thumbnailData = await noblox.getPlayerThumbnail([userId], 420, 'png', false, 'Headshot');
        if (thumbnailData && thumbnailData[0] && thumbnailData[0].imageUrl) thumbnailUrl = thumbnailData[0].imageUrl;
    } catch (e) {
        console.error(`Failed to retrieve thumbnail: ${e.message}`);
    }

    const embed = new EmbedBuilder()
      .setColor(null)
      .setTitle("Roblox Group Panel")
      .setFooter({text: interactionUserTag ? `Requested by ${interactionUserTag}` : `Status refreshed`})
      .setTimestamp()
      .setThumbnail(thumbnailUrl)
      .addFields(
        { name: "User:", value: username, inline: true },
        { name: "\u200b", value: "\u200b", inline: true },
        { name: "Current Rank:", value: rankStatusValue, inline: true }
      );

    const componentRows = buildCategoryComponents(username, isMember, isPending, executorId);

    return { embed, componentRows };
};

module.exports.registerRankCommand = async (client, config) => {
  await robloxLogin();

  const groupId = config.ROBLOX.GROUP_ID;

  const rankCommand = new SlashCommandBuilder()
    .setName("rank")
    .setDescription("View a user's status and manage their rank, exile, or join request.")
    .addStringOption((option) =>
      option
        .setName("user")
        .setDescription("Roblox username")
        .setRequired(true)
    );

  if (client.application && client.application.commands) {
    await client.application.commands.create(rankCommand);
  }

  client.on("interactionCreate", async (interaction) => {

    if (interaction.isChatInputCommand() && interaction.commandName === "rank") {
      const requiredRole = config.COMMANDS.RANK_PERMISSION_ROLE;
      if (!interaction.member.roles.cache.has(requiredRole)) {
        return interaction.reply({
          content: "❌ You do not have permission to use this command.",
          flags: 64,
        });
      }

      const username = interaction.options.getString("user");
      await interaction.deferReply(); 

      try {
        const { embed, componentRows } = await getPanelContent(username, groupId, config, interaction.user.tag, interaction.user.id);
        
        return interaction.editReply({
            embeds: [embed],
            components: componentRows,
        });

      } catch (err) {
        return interaction.editReply({
          content: `❌ Failed to fetch user: ${err.message}`,
        });
      }
    }

    // ---------------- CATEGORY DROPDOWN HANDLER ----------------
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('categorySelect_')) {
        const parts = interaction.customId.split('_');
        const username = parts[1];
        const executorId = parts[2];

        if (interaction.user.id !== executorId) {
            return interaction.reply({ content: "❌ You cannot interact with someone else's rank panel.", ephemeral: true });
        }

        try { await interaction.deferUpdate(); } catch(e){ console.error(e); return; }

        const selectedCategory = interaction.values[0];

        if (selectedCategory === 'cancel') {
            const embed = new EmbedBuilder()
                .setColor(0xFFA500)
                .setTitle("Rank Panel Cancelled")
                .setDescription(`The ranking operation for **${username}** was cancelled by ${interaction.user.tag}.`)
                .setTimestamp();
                
            await interaction.editReply({ embeds: [embed], components: [] });
            return;
        }

        const isRanksCategory = selectedCategory === "category_ranks";
        const isActionsCategory = selectedCategory === "category_actions";

        const userId = await noblox.getIdFromUsername(username);
        const currentRankId = await noblox.getRankInGroup(groupId, userId);
        const isMember = currentRankId > 0;

        const actionSelectMenu = new StringSelectMenuBuilder()
            .setCustomId(`actionSelect_${username}_${executorId}`)
            .setMinValues(1)
            .setMaxValues(1);

        let actionOptions = [];
        let placeholderText = "Select an action...";

        const getDivisionEmoji = (divName) => EMOJIS[divName.toUpperCase()] || EMOJIS.CATEGORY_RANKS;

        if (isRanksCategory && isMember) {
            placeholderText = "Select a Department Rank to set...";
            for (const divName of Object.keys(config.DIVISIONS)) {
                const div = config.DIVISIONS[divName];
                if (currentRankId !== div.rankId) {
                    actionOptions.push({
                        label: `Set Rank: ${divName}`,
                        value: `rank_${divName}`,
                        description: `Change user's rank to ${divName} (Rank ID: ${div.rankId})`,
                        emoji: getDivisionEmoji(divName)
                    });
                }
            }
        } else if (isActionsCategory) {
            placeholderText = "Select an Administrative Action...";
            let isPending = false; 
            if (!isMember) {
                const requestsData = await noblox.getJoinRequests(groupId, { limit: 50 }); 
                const requests = Array.isArray(requestsData) ? requestsData : requestsData?.data || [];
                isPending = requests.some((r) => {
                     const id = r.requester?.userId ?? r.UserId ?? r.userId ?? r.user?.userId ?? r.id ?? 0;
                     return Number(id) === Number(userId);
                });
            }

            if (!isMember && isPending) {
                actionOptions.push({ label: 'Accept Join Request', value: 'accept', description: 'Accept the pending group join request.', emoji: EMOJIS.ACCEPT });
            }
            
            if (isMember) {
                actionOptions.push({ label: 'Exile Member', value: 'remove', description: 'Permanently exile the user from the group.', emoji: EMOJIS.EXILE });
            }
        }

        actionOptions.push({ label: 'Back to Categories', value: 'back', description: 'Return to the main selection menu.', emoji: EMOJIS.BACK });

        actionSelectMenu.addOptions(actionOptions);
        actionSelectMenu.setPlaceholder(placeholderText);

        await interaction.message.edit({ embeds: interaction.message.embeds, components: [new ActionRowBuilder().addComponents(actionSelectMenu)] });
        return;
    }

    // ---------------- ACTION DROPDOWN HANDLER ----------------
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('actionSelect_')) {
        const parts = interaction.customId.split('_');
        const username = parts[1];
        const executorId = parts[2];

        if (interaction.user.id !== executorId) {
            return interaction.reply({ content: "❌ You cannot interact with someone else's rank panel.", ephemeral: true });
        }

        try { await interaction.deferUpdate(); } catch(e){ console.error(e); return; }

        const selectedValue = interaction.values[0];
        let logMessage = ""; 
        let actionTitle = "Action Successful";
        let actionColor = 0x4CAF50;
        let selectedAction = selectedValue;

        if (selectedValue === 'back') {
            const { embed, componentRows } = await getPanelContent(username, groupId, config, null, executorId);
            await interaction.message.edit({ content: null, embeds: [embed], components: componentRows });
            return;
        }

        try {
            const userId = await noblox.getIdFromUsername(username);
            const previousRankId = await noblox.getRankInGroup(groupId, userId);
            const previousRankName = await resolveRankName(previousRankId, userId, config.DIVISIONS, groupId);

            if (selectedValue.startsWith("rank_")) {
                const division = selectedValue.split('_')[1];
                const rankId = config.DIVISIONS[division].rankId;
                await noblox.setRank(groupId, userId, rankId);
                actionTitle = "Rank Change Successful";
                selectedAction = division;
                logMessage = `✅ **${username}** ranked from **${previousRankName}** to **${division}**.`;
            } else if (selectedValue === "remove") {
                await noblox.exile(groupId, userId);
                actionTitle = "Exiled Successfully";
                actionColor = 0xFF0000;
                selectedAction = "Exile";
                logMessage = `<:trashicon:1233617122731757568> **${username}** has been **Exiled** (Previous Rank: ${previousRankName}).`;
            } else if (selectedValue === "accept") {
                await noblox.handleJoinRequest(groupId, userId, true);
                actionTitle = "Request Accepted Successfully";
                selectedAction = "Accept Request";
                logMessage = `<:Submission:1233803895994585219> **${username}**'s join request has been **Accepted**.`;
            }

            if (!logMessage) logMessage = `Performed action: **${selectedAction}** on **${username}**.`;

            const successEmbed = new EmbedBuilder()
              .setColor(actionColor)
              .setTitle(actionTitle)
              .setDescription(logMessage)
              .setFooter({text: `Action performed by ${interaction.user.tag}`})
              .setTimestamp();

            await interaction.followUp({ embeds: [successEmbed], components: [], flags: 64 });
            const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
            if (logChannel) logChannel.send({ embeds: [successEmbed] });

            const { embed: refreshedEmbed, componentRows: refreshedComponents } = await getPanelContent(username, groupId, config, null, executorId);
            await interaction.message.edit({ content: null, embeds: [refreshedEmbed], components: refreshedComponents });

        } catch (err) {
            console.error(err);
            const failEmbed = new EmbedBuilder()
              .setColor(0xFF0000)
              .setTitle("❌ Action Failed")
              .addFields(
                { name: "Username", value: username, inline: true },
                { name: "Action", value: selectedAction, inline: true },
                { name: "Reason", value: err.message || "Unknown error occurred." }
              )
              .setFooter({text: `Action failed for ${interaction.user.tag}`})
              .setTimestamp();

            try { await interaction.followUp({ embeds: [failEmbed], flags: 64 }); } catch(e){ console.error(e); }
            const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
            if (logChannel) logChannel.send({ embeds: [failEmbed] });

            const { embed: currentEmbed, componentRows: currentComponents } = await getPanelContent(username, groupId, config, null, executorId);
            await interaction.message.edit({ content: null, embeds: [currentEmbed], components: currentComponents });
        }
    }
  });
};
