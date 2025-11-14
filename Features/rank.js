const noblox = require("noblox.js");
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
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
          label: "Department Ranks", // UPDATED LABEL
          value: "category_ranks",
          description: "Promote or demote the user across department ranks.",
          emoji: "🛡️"
      });
  }

  // Option 2: Administrative Actions (Exile/Accept - shown conditionally)
  if (isMember || isPending) {
      categoryOptions.push({
          label: "Administrative Actions", // UPDATED LABEL
          value: "category_actions",
          description: "Handle Exiling a member or accepting a Join Request.",
          emoji: "⚙️"
      });
  }

  if (categoryOptions.length > 0) {
      categorySelectMenu.addOptions(categoryOptions);
      return [new ActionRowBuilder().addComponents(categorySelectMenu)];
  }
  
  return [];
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
      // FIX: Removed flags: 64 to make the reply public and prevent the "Unknown Message" error
      // when moderators take too long to interact with the follow-up menus/buttons.
      await interaction.deferReply(); 

      try {
        const userId = await noblox.getIdFromUsername(username);
        const currentRankId = await noblox.getRankInGroup(groupId, userId);
        const isMember = currentRankId > 0;
        
        let currentRankName = getRankNameFromId(currentRankId, config.DIVISIONS);

        // --- PENDING REQUEST LOGIC (PAGINATION) ---
        let isPending = false;
        if (!isMember) {
          let cursor = null;
          let pageCount = 0;
          // Loop through requests until user found or cursor runs out
          // This loop is kept here because it's required for the initial embed status
          while (!isPending) {
            pageCount++;
            let requestsData;
            try { requestsData = await noblox.getJoinRequests(groupId, { cursor: cursor }); } catch (e) { break; }
            const requests = Array.isArray(requestsData) ? requestsData : requestsData?.data || [];
            if (requests.length === 0) break;
            isPending = requests.some((r) => {
              const id = r.requester?.userId ?? r.UserId ?? r.userId ?? r.user?.userId ?? r.id ?? 0;
              return Number(id) === Number(userId);
            });
            if (isPending) break;
            cursor = requestsData.nextPageCursor;
            if (!cursor) break; 
          }
        }
        
        // --- SIMPLIFIED RANK STATUS VALUE (Handles all 3 states: Member, Pending, Not In Group) ---
        let rankStatusValue = "";
        if (isPending) {
            rankStatusValue = `Pending Request`;
        } else if (isMember) {
            // User is a member, show their rank name
            rankStatusValue = `${currentRankName}`;
        } else {
            // Not a member and no pending request
            rankStatusValue = "Not in Group";
        }

        const embed = new EmbedBuilder()
          .setColor(null) // No color for main embed
          .setTitle("Roblox Group Panel") // UPDATED: Fixed Title
          .setFooter({text: `Requested by ${interaction.user.tag}`}) 
          .setTimestamp() 
          .setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=420&height=420&format=png`)
          .addFields(
            // UPDATED: Added User field
            { name: "User:", value: username, inline: false },
            // Simplified fields: just the rank status (which now includes membership status)
            { name: "Current Rank:", value: rankStatusValue, inline: false }
          );

        // Stage 1: Generate the Category Selection Dropdown
        const componentRows = buildCategoryComponents(username, isMember, isPending);
        
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
      await interaction.deferUpdate(); 

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
                      .setEmoji('📥')
              );
          }
          
          if (isMember) {
              actionButtons.push(
                  new ButtonBuilder()
                      .setCustomId(`action_remove_${username}`) // Format: action_remove_[username]
                      .setLabel('Exile Member')
                      .setStyle(ButtonStyle.Danger)
                      .setEmoji('🗑️')
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
              .setLabel('⬅️ Back to Categories')
              .setStyle(ButtonStyle.Secondary)
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
        await interaction.deferUpdate(); 
        
        // Custom ID format: action_[type]_[username] or action_rank_[divName]_[username]
        const customIdParts = interaction.customId.split('_');
        
        if (customIdParts[0] !== 'action') return; // Not a rank/exile button

        const actionType = customIdParts[1]; // back, rank, accept, remove
        const username = customIdParts.slice(-1)[0];
        
        // --- 3A. HANDLE BACK BUTTON ---
        if (actionType === 'back') {
            const userId = await noblox.getIdFromUsername(username);
            const currentRankId = await noblox.getRankInGroup(groupId, userId);
            const isMember = currentRankId > 0;
            
            // Re-check PENDING status for the Accept Button visibility on the initial menu
            let isPending = false; 
            if (!isMember) {
                const requestsData = await noblox.getJoinRequests(groupId, { limit: 10 }); // Quick check
                const requests = Array.isArray(requestsData) ? requestsData : requestsData?.data || [];
                isPending = requests.some((r) => {
                     const id = r.requester?.userId ?? r.UserId ?? r.userId ?? r.user?.userId ?? r.id ?? 0;
                     return Number(id) === Number(userId);
                });
            }

            const componentRows = buildCategoryComponents(username, isMember, isPending);

            // Get original embed (first embed in the message)
            const originalEmbed = interaction.message.embeds[0];
            
            // Edit message to revert to the Category Dropdown
            await interaction.message.edit({
                content: null, // Clear the temp content
                embeds: [originalEmbed], 
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
            const previousRankName = getRankNameFromId(previousRankId, config.DIVISIONS);
            
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
            
            // --- DISCORD RESPONSE LOGIC ---

            const successEmbed = new EmbedBuilder()
              .setColor(actionColor) 
              .setTitle(actionTitle)
              .setDescription(logMessage)
              .setFooter({text: `Action performed by ${interaction.user.tag}`}) 
              .setTimestamp();

            await interaction.followUp({
              embeds: [successEmbed],
              components: [],
              flags: 64, // EPHEMERAL
            });

            const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
            if (logChannel) logChannel.send({ embeds: [successEmbed] });

            // Edit the original message to remove components
            await interaction.message.edit({ components: [] });

        } catch (err) {
            // --- ERROR HANDLING LOGIC ---
            
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

            await interaction.followUp({ embeds: [failEmbed], flags: 64 });

            const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
            if (logChannel) logChannel.send({ embeds: [failEmbed] });
        }
    }
  });
};
