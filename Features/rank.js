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

// Helper function to map Rank ID to Rank Name from config
const getRankNameFromId = (rankId, configDivisions) => {
  if (rankId === 0) return "Not in Group";
  // Check against configured divisions
  for (const [name, div] of Object.entries(configDivisions)) {
    if (div.rankId === rankId) {
      return name;
    }
  }
  // Default Roblox rank name for rank 1 (assuming general 'Member' role)
  return rankId === 1 ? "Member" : "Unknown Rank";
};


module.exports.registerRankCommand = async (client, config) => {
  await robloxLogin();

  const rankCommand = new SlashCommandBuilder()
    .setName("rank")
    // Aesthetic Improvement: More descriptive command name
    .setDescription("View a user's status and manage their rank, exile, or join request.")
    .addStringOption((option) =>
      option
        .setName("user")
        .setDescription("Roblox username")
        .setRequired(true)
    );

  // This line might throw an error if client.application is not ready, adding a safety check.
  if (client.application && client.application.commands) {
    await client.application.commands.create(rankCommand);
  }

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
        const currentRankId = await noblox.getRankInGroup(groupId, userId);
        const isMember = currentRankId > 0;
        
        // Optimization: Get the actual role name using the helper function
        let currentRankName = getRankNameFromId(currentRankId, config.DIVISIONS);

        // --------------------- PENDING REQUEST LOGIC (PAGINATION) ---------------------
        let isPending = false;
        if (!isMember) {
          let cursor = null;
          let pageCount = 0;
          
          while (!isPending) {
            pageCount++;
            let requestsData;
            
            try {
                console.log(`[ROBLOX] Checking join request page ${pageCount}. Cursor: ${cursor || 'start'}`);
                requestsData = await noblox.getJoinRequests(groupId, { cursor: cursor });
            } catch (apiError) {
                console.error(`[ROBLOX API] Error fetching join requests for group ${groupId} on page ${pageCount}:`, apiError.message);
                break;
            }

            const requests = Array.isArray(requestsData) ? requestsData : requestsData?.data || [];
            console.log(`[ROBLOX] Page ${pageCount} returned ${requests.length} requests.`);
            
            if (requests.length === 0) break;

            isPending = requests.some((r) => {
              const id = r.requester?.userId ?? r.UserId ?? r.userId ?? r.user?.userId ?? r.id ?? 0;
              return Number(id) === Number(userId);
            });

            if (isPending) {
              console.log(`[ROBLOX] Found pending request for ${username} (${userId}) on page ${pageCount}.`);
              break;
            }

            cursor = requestsData.nextPageCursor;
            if (!cursor) {
              console.log(`[ROBLOX] Reached the last page (${pageCount}).`);
              break; 
            }
          }
        }
        // ---------------------------------------------------------------
        
        // --- Custom Rank Status Field for New Embed Structure ---
        let rankStatusValue = "";
        if (isPending) {
            rankStatusValue = `🟡 Pending Request (ID: ${currentRankId})`;
        } else if (isMember) {
            // Display Rank Name and ID
            rankStatusValue = `🛡️ **${currentRankName}** (ID: ${currentRankId})`;
        } else {
            rankStatusValue = "❌ Not in Group";
        }

        const embed = new EmbedBuilder()
          // AESTHETIC FIX: Set color to null as requested for the main lookup embed
          .setColor(null) 
          // New Title Format
          .setTitle(`Username: ${username}`)
          .setFooter({text: `Requested by ${interaction.user.tag}`}) 
          .setTimestamp() 
          // Thumbnail is already positioned well
          .setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=420&height=420&format=png`)
          .addFields(
            // Aesthetic Change: New combined Rank Field
            { name: "Current Rank:", value: rankStatusValue, inline: false },
            { name: "✨ Roblox ID", value: userId.toString(), inline: true },
            { name: "✅ Group Member?", value: isMember ? "🟢 Yes" : "🔴 No", inline: true },
            { name: "⏳ Join Request?", value: isPending ? "🟡 Yes" : "❌ No", inline: true }
          );

        // --------------------- DROPDOWN ---------------------
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`rankMenu_${username}`)
          .setMinValues(1)
          .setMaxValues(1);
          
        let menuOptions = [];

        if (isMember) {
            // Aesthetic Change: Placeholder for members
            selectMenu.setPlaceholder("Select a Rank or Action");

            // User is a member, show Rank/Exile options
            for (const divName of Object.keys(config.DIVISIONS)) {
                const div = config.DIVISIONS[divName];
                // Check for current rank to disable option if ID is 3, 6, or 9
                const isCurrentAdministrativeRank = currentRankId === div.rankId && [3, 6, 9].includes(currentRankId);
                
                menuOptions.push({
                    label: divName,
                    value: `rank_${divName}`,
                    emoji: div.emoji,
                    // Aesthetic Change: Updated description based on disabled status
                    description: isCurrentAdministrativeRank ? `Cannot change rank if user currently holds this role.` : `Promote/Set rank to ${divName}.`,
                    disabled: isCurrentAdministrativeRank,
                });
            }

            // Add Exile option
            menuOptions.push({
                label: "Exile Member",
                value: "remove",
                emoji: "🗑️",
                description: "Permanently remove the user from the group.",
            });

        } else if (isPending) {
            // Aesthetic Change: Placeholder for non-members with request
            selectMenu.setPlaceholder("User not in Group - Select Request Action");
            
            // User is NOT a member, but has a pending request. Only show Accept.
            menuOptions.push({
                label: "Accept Join Request",
                value: "accept",
                emoji: "📥",
                description: "Accept the pending join request (Sets to Rank 1).",
            });
        }
        
        // If the user is not a member and has no pending request, no menu options are added.

        if (menuOptions.length > 0) {
            selectMenu.addOptions(menuOptions);
            const row = new ActionRowBuilder().addComponents(selectMenu);

            return interaction.editReply({
                embeds: [embed],
                components: [row],
            });
        }
        
        // If no actions are possible, reply with only the embed and no components.
        return interaction.editReply({
            embeds: [embed],
            components: [],
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

      let logMessage = ""; 
      let actionTitle = "Action Successful";
      // Aesthetic Change: Define action color, default to Green for positive actions
      let actionColor = 0x4CAF50; // Success Green

      try {
        const userId = await noblox.getIdFromUsername(username);

        // Fetch rank ID/Name BEFORE action for logging the rank change
        const previousRankId = await noblox.getRankInGroup(groupId, userId);
        const previousRankName = getRankNameFromId(previousRankId, config.DIVISIONS);
        
        // --- 1. PERFORM ROBLOX ACTION (Success sets logMessage) ---

        if (selected.startsWith("rank_")) {
          const division = selected.replace("rank_", "");
          const rankId = config.DIVISIONS[division].rankId;
          await noblox.setRank(groupId, userId, rankId);
          actionTitle = "Rank Change Successful";
          const newRankName = division; // New rank name is the division name
          
          // Aesthetic & Logging Improvement: Log the rank change
          logMessage = `✅ **${username}** ranked from **${previousRankName}** to **${newRankName}**.`;
        }

        // Handle 'remove' (Exile only)
        if (selected === "remove") {
          
          await noblox.exile(groupId, userId);
          actionTitle = "Exiled Successfully";
          
          // Aesthetic Change: Use Red for destructive action
          actionColor = 0xFF0000; 
          logMessage = `🗑️ **${username}** has been **Exiled** (Previous Rank: ${previousRankName}) from the group.`;
        }

        if (selected === "accept") {
          await noblox.handleJoinRequest(groupId, userId, true);
          actionTitle = "Request Accepted Successfully";
          logMessage = `📥 **${username}**'s join request has been **Accepted** (Set to Rank 1 / Member).`;
        }
        
        if (!logMessage) {
            logMessage = `Performed action: **${selected}** on **${username}**.`;
        }
        
        // --- 2. DISCORD RESPONSE LOGIC ---

        const successEmbed = new EmbedBuilder()
          // Aesthetic Change: Use dynamic color for the reply/log embed
          .setColor(actionColor) 
          .setTitle(actionTitle)
          .setDescription(logMessage)
          .setFooter({text: `Action performed by ${interaction.user.tag}`}) 
          .setTimestamp();

        // Send success message to the user
        await interaction.followUp({
          embeds: [successEmbed],
          components: [],
          flags: 64, // EPHEMERAL
        });

        // Send success message to the logs channel
        const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
        if (logChannel) logChannel.send({ embeds: [successEmbed] });

        // Edit the original message to remove the dropdown
        await interaction.message.edit({ components: [] });

      } catch (err) {
        // --- 3. ERROR HANDLING LOGIC ---
        
        if (logMessage) {
            console.error(`[DISCORD API ERROR] Failed to send success followUp/edit message for successful action: ${logMessage}. Discord Error: ${err.message}`);
            return;
        }

        const failEmbed = new EmbedBuilder()
          // Aesthetic Change: Use Red for true failure
          .setColor(0xFF0000) 
          .setTitle("❌ Action Failed")
          .addFields(
            { name: "Username", value: username, inline: true },
            { name: "Action", value: selected, inline: true },
            { name: "Reason", value: err.message || "Unknown error occurred during API call." }
          )
          .setFooter({text: `Action failed for ${interaction.user.tag}`}) 
          .setTimestamp();

        // Report the failure to the user
        await interaction.followUp({ embeds: [failEmbed], flags: 64 });

        // Log the failure
        const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
        if (logChannel) logChannel.send({ embeds: [failEmbed] });
      }
    }
  });
};
