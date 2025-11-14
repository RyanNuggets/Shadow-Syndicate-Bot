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
  // Category Dropdown Emojis
  CATEGORY_RANKS: "<:RTO:1421570606863876166>",
  CATEGORY_ACTIONS: "<:Hammer:1234026434973143071>",
  
  // Division Ranks (Must match keys in config.DIVISIONS for dynamic lookup)
  DHS: "<:DHS:1438835075843358720>",
  CHP: "<:CHP:1438834718492594176>",
  LASD: "<:LASD:1438834657436373064>",

  // Administrative Actions
  ACCEPT: "<:Addition:1272335252647444500>",
  EXILE: "<:trashicon:1233617122731757568>",
  BACK: "<:back:1438906842901254324>",
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

/**
 * Resolves the rank name by prioritizing names defined in the config.
 * Falls back to the official Roblox group rank name if not found in config.
 * This is primarily used for logging messages to ensure division names are tracked.
 */
const resolveRankName = async (rankId, userId, configDivisions, groupId) => {
  if (rankId === 0) return "Not in Group";

  // 1. Check against configured divisions (prioritize local names for consistency)
  for (const [name, div] of Object.entries(configDivisions)) {
    if (div.rankId === rankId) {
      return name;
    }
  }

  // 2. Fallback: Get the official rank name from Roblox API
  try {
    const officialName = await noblox.getRankNameInGroup(groupId, userId);
    return officialName;
  } catch (e) {
    console.error(`Failed to get official rank name for User ID ${userId} (Rank ID ${rankId}): ${e.message}`);
    return "Unknown Rank (API Error)";
  }
};

// Helper function to build the initial category components (used for /rank and 'Back' button)
const buildCategoryComponents = (username, isMember, isPending) => {
  const categorySelectMenu = new StringSelectMenuBuilder()
      .setCustomId(`categorySelect_${username}`)
      .setMinValues(1)
      .setMaxValues(1)
      .setPlaceholder("Select a Rank Action Category...");

  let categoryOptions = [];

  // Option 1: Department Ranks (Rank Divisions - Requires membership)
  if (isMember) {
      categoryOptions.push({
          label: "Department Ranks",
          value: "category_ranks",
          description: "Promote or demote the user across department ranks.",
          emoji: EMOJIS.CATEGORY_RANKS // Custom Emoji
      });
  }

  // Option 2: Administrative Actions (Exile/Accept - shown conditionally)
  if (isMember || isPending) {
      categoryOptions.push({
          label: "Administrative Actions",
          value: "category_actions",
          description: "Handle Exiling a member or accepting a Join Request.",
          emoji: EMOJIS.CATEGORY_ACTIONS // Custom Emoji
      });
  }

  if (categoryOptions.length > 0) {
      categorySelectMenu.addOptions(categoryOptions);
      return [new ActionRowBuilder().addComponents(categorySelectMenu)];
  }
  
  return [];
};


/**
 * Fetches user status and generates the Rank Panel Embed and Category Components.
 * This function is used for the initial command and refreshing the panel after an action.
 */
const getPanelContent = async (username, groupId, config, interactionUserTag = null) => {
    const userId = await noblox.getIdFromUsername(username);
    const currentRankId = await noblox.getRankInGroup(groupId, userId);
    const isMember = currentRankId > 0;
    
    // --- PENDING REQUEST LOGIC (PAGINATION) ---
    let isPending = false;
    if (!isMember) {
      let cursor = null;
      let requestsData;
      do {
          try { 
              // Using a large limit (e.g., 50) for the first page to maximize chance of finding request quickly.
              requestsData = await noblox.getJoinRequests(groupId, { cursor: cursor, limit: 50 }); 
          } catch (e) { 
              console.error(`Error fetching join requests: ${e.message}`);
              requestsData = { data: [] }; // Handle API failure gracefully
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
    
    // --- SIMPLIFIED RANK STATUS VALUE (Handles all 3 states: Member, Pending, Not In Group) ---
    let rankStatusValue = "Not in Group";
    if (isPending) {
        rankStatusValue = `Pending Request`;
    } else if (isMember) {
        // --- MODIFIED: Directly fetch the actual rank name from the Roblox API as requested ---
        try {
            rankStatusValue = await noblox.getRankNameInGroup(groupId, userId);
        } catch (e) {
            console.error(`Failed to get official rank name for User ID ${userId} during panel status: ${e.message}`);
            // Fallback to the Rank ID if API call fails
            rankStatusValue = `Member (Rank ID: ${currentRankId})`;
        }
    }

    // --- NEW: Fetch Thumbnail URL using noblox.js function ---
    let thumbnailUrl = null;
    try {
        // Use the noblox function as specified in the docs for maximum reliability
        const thumbnailData = await noblox.getPlayerThumbnail([userId], 420, 'png', false, 'Headshot');
        if (thumbnailData && thumbnailData[0] && thumbnailData[0].imageUrl) {
            thumbnailUrl = thumbnailData[0].imageUrl;
        }
    } catch (e) {
        console.error(`Failed to retrieve thumbnail via noblox for ID ${userId}: ${e.message}`);
        // Keep thumbnailUrl null, Discord will gracefully ignore it
    }

    const embed = new EmbedBuilder()
      .setColor(null) // No color for main embed
      .setTitle("Roblox Group Panel")
      .setFooter({text: interactionUserTag ? `Requested by ${interactionUserTag}` : `Status refreshed`}) // Conditional Footer
      .setTimestamp() 
      // Use the reliable URL fetched by the noblox function, defaulting to null if fetch fails
      .setThumbnail(thumbnailUrl)
      .addFields(
        { name: "User:", value: username, inline: false },
        { name: "\u200b", value: "\u200b", inline: false }, // Blank spacer field added here
        { name: "Current Rank:", value: rankStatusValue, inline: false }
      );

    const componentRows = buildCategoryComponents(username, isMember, isPending);

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

    // --------------------- SLASH COMMAND (Stage 1: Initial Lookup + Category Dropdown) ---------------------
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
        // Use the new reusable function to get initial content
        const { embed, componentRows } = await getPanelContent(username, groupId, config, interaction.user.tag);
        
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

    // --------------------- CATEGORY DROPDOWN HANDLER (Stage 2: Category Selection -> Action Dropdown Generation) ---------------------
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('categorySelect_')) {
      // FIX: Wrap deferUpdate in try/catch to prevent 'Unknown interaction' crash
      try {
          await interaction.deferUpdate(); 
      } catch (e) {
          console.error(`[DISCORD API ERROR] Failed to defer update for dropdown: ${e.message}`);
          return;
      }

      const username = interaction.customId.replace("categorySelect_", "");
      const selectedCategory = interaction.values[0];
      const isRanksCategory = selectedCategory === "category_ranks";
      const isActionsCategory = selectedCategory === "category_actions";

      // Re-fetch essential data for component generation
      const userId = await noblox.getIdFromUsername(username);
      const currentRankId = await noblox.getRankInGroup(groupId, userId);
      const isMember = currentRankId > 0;
      
      const actionSelectMenu = new StringSelectMenuBuilder()
          .setCustomId(`actionSelect_${username}`) // NEW ID for Action Dropdown
          .setMinValues(1)
          .setMaxValues(1);

      let actionOptions = [];
      let placeholderText = "Select an action...";

      // Helper to dynamically get division emoji based on name
      const getDivisionEmoji = (divName) => {
          return EMOJIS[divName.toUpperCase()] || EMOJIS.CATEGORY_RANKS; 
      };

      if (isRanksCategory && isMember) {
          placeholderText = "Select a Department Rank to set...";
          
          // Generate Options for all divisions
          for (const divName of Object.keys(config.DIVISIONS)) {
              const div = config.DIVISIONS[divName];
              
              // Only add ranks that are NOT the user's current rank
              const isDisabled = currentRankId === div.rankId;
              
              if (!isDisabled) {
                  actionOptions.push({
                      label: `Set Rank: ${divName}`,
                      value: `rank_${divName}`, // Value format: rank_[divName]
                      description: `Change user's rank to ${divName} (Rank ID: ${div.rankId})`,
                      emoji: getDivisionEmoji(divName)
                  });
              }
          }
      } else if (isActionsCategory) {
          placeholderText = "Select an Administrative Action...";
          
          // --- Re-check PENDING status for the Accept Option ---
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
              actionOptions.push({
                  label: 'Accept Join Request',
                  value: 'accept',
                  description: 'Accept the pending group join request.',
                  emoji: EMOJIS.ACCEPT
              });
          }
          
          if (isMember) {
              actionOptions.push({
                  label: 'Exile Member',
                  value: 'remove',
                  description: 'Permanently exile the user from the group.',
                  emoji: EMOJIS.EXILE
              });
          }
      }
      
      // Add 'Back' option (MANDATORY in the dropdown as requested)
      actionOptions.push({
          label: 'Back to Categories',
          value: 'back', // Value format: back
          description: 'Return to the main selection menu.',
          emoji: EMOJIS.BACK
      });

      actionSelectMenu.addOptions(actionOptions);
      actionSelectMenu.setPlaceholder(placeholderText);
      
      const actionRows = [new ActionRowBuilder().addComponents(actionSelectMenu)];

      // Get the current embeds and edit the message
      const existingEmbeds = interaction.message.embeds; 
      
      await interaction.message.edit({
          content: null, 
          embeds: existingEmbeds, 
          components: actionRows
      });
      return;
    }

    // --------------------- ACTION DROPDOWN HANDLER (Stage 3: Action Execution / Back) ---------------------
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('actionSelect_')) {
        // FIX: Wrap deferUpdate in try/catch to prevent 'Unknown interaction' crash
        try {
            await interaction.deferUpdate(); 
        } catch (e) {
            console.error(`[DISCORD API ERROR] Failed to defer update for action dropdown: ${e.message}`);
            return;
        }
        
        const username = interaction.customId.replace("actionSelect_", "");
        const selectedValue = interaction.values[0];
        
        let logMessage = ""; 
        let actionTitle = "Action Successful";
        let actionColor = 0x4CAF50; // Success Green
        let selectedAction = selectedValue; // For error logging

        // --- 3A. HANDLE BACK ACTION ---
        if (selectedValue === 'back') {
            // Revert to Category Dropdown
            const { embed, componentRows } = await getPanelContent(username, groupId, config);
            
            await interaction.message.edit({
                content: null,
                embeds: [embed], 
                components: componentRows
            });
            return;
        }

        // --- 3B. HANDLE RANKING/EXILE/ACCEPT ACTIONS ---
        try {
            const userId = await noblox.getIdFromUsername(username);

            // Fetch rank ID/Name BEFORE action for logging the rank change
            // resolveRankName is still used here as it provides the configured division name
            const previousRankId = await noblox.getRankInGroup(groupId, userId);
            const previousRankName = await resolveRankName(previousRankId, userId, config.DIVISIONS, groupId); 
            
            // --- PERFORM ROBLOX ACTION ---
            
            if (selectedValue.startsWith("rank_")) {
                const division = selectedValue.split('_')[1];
                const rankId = config.DIVISIONS[division].rankId;
                
                // Debug Log for issue identification
                console.log(`[ROBLOX RANK] Attempting to rank user ${username} (ID: ${userId}) to ${division} with Rank ID: ${rankId}`);
                
                await noblox.setRank(groupId, userId, rankId);
                
                actionTitle = "Rank Change Successful";
                const newRankName = division; 
                selectedAction = division;

                logMessage = `✅ **${username}** ranked from **${previousRankName}** to **${newRankName}**.`;
            }

            else if (selectedValue === "remove") {
                await noblox.exile(groupId, userId);
                actionTitle = "Exiled Successfully";
                actionColor = 0xFF0000; 
                selectedAction = "Exile";
                logMessage = `🗑️ **${username}** has been **Exiled** (Previous Rank: ${previousRankName}) from the group.`;
            }

            else if (selectedValue === "accept") {
                await noblox.handleJoinRequest(groupId, userId, true);
                actionTitle = "Request Accepted Successfully";
                selectedAction = "Accept Request";
                logMessage = `📥 **${username}**'s join request has been **Accepted** (Set to Rank 1 / Member).`;
            }

            if (!logMessage) {
                logMessage = `Performed action: **${selectedAction}** on **${username}**.`;
            }
            
            // --- DISCORD RESPONSE LOGIC (Success) ---

            const successEmbed = new EmbedBuilder()
              .setColor(actionColor) 
              .setTitle(actionTitle)
              .setDescription(logMessage)
              .setFooter({text: `Action performed by ${interaction.user.tag}`}) 
              .setTimestamp();

            await interaction.followUp({
              embeds: [successEmbed],
              components: [],
              flags: 64, // EPHEMERAL - This ensures the message is hidden!
            });

            const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
            if (logChannel) logChannel.send({ embeds: [successEmbed] });

            // --- REFRESH AND RETURN TO CATEGORY VIEW ---
            // Fetch the updated status and components
            const { embed: refreshedEmbed, componentRows: refreshedComponents } = await getPanelContent(username, groupId, config);

            // Edit the original message to display the new status and bring back the Category Dropdown
            await interaction.message.edit({ 
                content: null, // Clear the 'Select an action...' content
                embeds: [refreshedEmbed],
                components: refreshedComponents
            });


        } catch (err) {
            // --- ERROR HANDLING LOGIC (Failure) ---
            
            if (logMessage) {
                console.error(`[DISCORD API ERROR] Failed to send success followUp/edit message for successful action: ${logMessage}. Discord Error: ${err.message}`);
                // Continue to refresh the panel even if followUp failed.
            }

            const failEmbed = new EmbedBuilder()
              .setColor(0xFF0000) 
              .setTitle("❌ Action Failed")
              .addFields(
                { name: "Username", value: username, inline: true },
                { name: "Action", value: selectedAction, inline: true },
                { name: "Reason", value: err.message || "Unknown error occurred during API call." }
              )
              .setFooter({text: `Action failed for ${interaction.user.tag}`}) 
              .setTimestamp();

            // Attempt to send an ephemeral failure message
            try {
                await interaction.followUp({ embeds: [failEmbed], flags: 64 });
            } catch (followUpErr) {
                console.error(`[DISCORD API ERROR] Failed to send followUp error message: ${followUpErr.message}`);
            }


            const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
            if (logChannel) logChannel.send({ embeds: [failEmbed] });
            
            // On failure, refresh status and return to the category menu
            const { embed: currentEmbed, componentRows: currentComponents } = await getPanelContent(username, groupId, config);

            // Edit the original message to return to the Category Dropdown
            await interaction.message.edit({
                content: null,
                embeds: [currentEmbed],
                components: currentComponents
            });
        }
    }
  });
};
