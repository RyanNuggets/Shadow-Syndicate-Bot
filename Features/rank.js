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
 * * NOTE: The function now correctly takes the userId to resolve the official rank name
 * via the noblox API when a local division name is not found.
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
  // FIX: Using userId as the second parameter as per noblox documentation.
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
    
    // UPDATE: Pass userId to resolveRankName
    let currentRankName = await resolveRankName(currentRankId, userId, config.DIVISIONS, groupId);

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
        // Use the official/resolved rank name here
        rankStatusValue = `${currentRankName}`;
    }

    const embed = new EmbedBuilder()
      .setColor(null) // No color for main embed
      .setTitle("Roblox Group Panel")
      .setFooter({text: interactionUserTag ? `Requested by ${interactionUserTag}` : `Status refreshed`}) // Conditional Footer
      .setTimestamp() 
      .setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=420&height=420&format=png`)
      .addFields(
        { name: "User:", value: username, inline: false },
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

    // --------------------- DROPDOWN HANDLER (Stage 2: Category Selection -> Button Generation) ---------------------
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
      
      let actionButtons = [];
      const buttonRows = [];
      const maxButtonsPerRow = 5;

      // Helper to dynamically get division emoji based on name
      const getDivisionEmoji = (divName) => {
          return EMOJIS[divName.toUpperCase()] || EMOJIS.CATEGORY_RANKS; 
      };

      if (isRanksCategory && isMember) {
          // Generate Buttons for all divisions
          for (const divName of Object.keys(config.DIVISIONS)) {
              const div = config.DIVISIONS[divName];
              const isCurrentAdministrativeRank = currentRankId === div.rankId && [3, 6, 9].includes(currentRankId);
              
              actionButtons.push(
                  new ButtonBuilder()
                      .setCustomId(`action_rank_${divName}_${username}`) // Format: action_rank_[divName]_[username]
                      .setLabel(divName)
                      .setStyle(ButtonStyle.Secondary)
                      .setDisabled(isCurrentAdministrativeRank)
                      .setEmoji(getDivisionEmoji(divName)) // Custom Emoji
              );
          }
      } else if (isActionsCategory) {
          // --- Re-check PENDING status for the Accept Button ---
          let isPending = false; 
          if (!isMember) {
              const requestsData = await noblox.getJoinRequests(groupId, { limit: 50 }); // Check first 50 for quick lookup
              const requests = Array.isArray(requestsData) ? requestsData : requestsData?.data || [];
              isPending = requests.some((r) => {
                   const id = r.requester?.userId ?? r.UserId ?? r.userId ?? r.user?.userId ?? r.id ?? 0;
                   return Number(id) === Number(userId);
              });
          }

          if (!isMember && isPending) {
              actionButtons.push(
                  new ButtonBuilder()
                      .setCustomId(`action_accept_${username}`) // Format: action_accept_[username]
                      .setLabel('Accept Join Request')
                      .setStyle(ButtonStyle.Success)
                      .setEmoji(EMOJIS.ACCEPT) // Custom Emoji
              );
          }
          
          if (isMember) {
              actionButtons.push(
                  new ButtonBuilder()
                      .setCustomId(`action_remove_${username}`) // Format: action_remove_[username]
                      .setLabel('Exile Member')
                      .setStyle(ButtonStyle.Danger)
                      .setEmoji(EMOJIS.EXILE) // Custom Emoji
              );
          }
      }
      
      // Organize buttons into rows of max 5
      for (let i = 0; i < actionButtons.length; i += maxButtonsPerRow) {
          buttonRows.push(new ActionRowBuilder().addComponents(actionButtons.slice(i, i + maxButtonsPerRow)));
      }

      // Add 'Back' button row (Essential for UX)
      buttonRows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
              .setCustomId(`action_back_${username}`)
              .setLabel('Back to Categories') 
              .setStyle(ButtonStyle.Secondary)
              .setEmoji(EMOJIS.BACK) // Custom Emoji
      ));

      const title = selectedCategory.replace('category_', '').replace('_', ' ');

      // Edit the original message to replace the dropdown with buttons
      await interaction.message.edit({
          content: `Select an action for **${username}** in the \`${title.toUpperCase()}\` section.`,
          components: buttonRows
      });
      return;
    }

    // --------------------- BUTTON HANDLER (Stage 3: Action Execution / Back) ---------------------
    if (interaction.isButton()) {
        // FIX: Wrap deferUpdate in try/catch to prevent 'Unknown interaction' crash
        try {
            await interaction.deferUpdate(); 
        } catch (e) {
            console.error(`[DISCORD API ERROR] Failed to defer update for button: ${e.message}`);
            return;
        }
        
        // Custom ID format: action_[type]_[username] or action_rank_[divName]_[username]
        const customIdParts = interaction.customId.split('_');
        
        if (customIdParts[0] !== 'action') return; // Not a rank/exile button

        const actionType = customIdParts[1]; // back, rank, accept, remove
        const username = customIdParts.slice(-1)[0];
        
        // --- 3A. HANDLE BACK BUTTON ---
        if (actionType === 'back') {
            // Use the new reusable function to get content for the back view
            const { embed, componentRows } = await getPanelContent(username, groupId, config);
            
            // Edit message to revert to the Category Dropdown
            await interaction.message.edit({
                content: null, // Clear the temp content
                embeds: [embed], 
                components: componentRows
            });
            return;
        }


        // --- 3B. HANDLE RANKING/EXILE/ACCEPT ACTIONS ---
        
        let logMessage = ""; 
        let actionTitle = "Action Successful";
        let actionColor = 0x4CAF50; // Success Green
        let selectedAction = actionType; // For error logging

        try {
            const userId = await noblox.getIdFromUsername(username);

            // Fetch rank ID/Name BEFORE action for logging the rank change
            const previousRankId = await noblox.getRankInGroup(groupId, userId);
            // UPDATE: Pass userId to resolveRankName for previous rank
            const previousRankName = await resolveRankName(previousRankId, userId, config.DIVISIONS, groupId); 
            
            // --- PERFORM ROBLOX ACTION ---
            
            if (actionType === "rank") {
                const division = customIdParts[2];
                const rankId = config.DIVISIONS[division].rankId;
                await noblox.setRank(groupId, userId, rankId);
                actionTitle = "Rank Change Successful";
                const newRankName = division; 
                selectedAction = division;

                logMessage = `✅ **${username}** ranked from **${previousRankName}** to **${newRankName}**.`;
            }

            else if (actionType === "remove") {
                await noblox.exile(groupId, userId);
                actionTitle = "Exiled Successfully";
                actionColor = 0xFF0000; 
                selectedAction = "Exile";
                logMessage = `🗑️ **${username}** has been **Exiled** (Previous Rank: ${previousRankName}) from the group.`;
            }

            else if (actionType === "accept") {
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

            // --- REFRESH AND RETURN TO CATEGORY VIEW (User Request) ---
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
                return;
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

            await interaction.followUp({ embeds: [failEmbed], flags: 64 }); // This is also ephemeral

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
