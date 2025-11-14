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

module.exports.registerRankCommand = async (client, config) => {
  await robloxLogin();

  const rankCommand = new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Manage Roblox users in the group")
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
        const currentRank = await noblox.getRankInGroup(groupId, userId);
        const isMember = currentRank > 0;

        // --------------------- PENDING REQUEST LOGIC (PAGINATION & DEBUG) ---------------------
        let isPending = false;
        if (!isMember) {
          let cursor = null;
          let pageCount = 0; // Added page counter
          
          // Keep fetching until no cursor is returned (last page) or request is found
          while (!isPending) {
            pageCount++;
            let requestsData;
            
            try {
                // Log the page being fetched
                console.log(`[ROBLOX] Checking join request page ${pageCount}. Cursor: ${cursor || 'start'}`);
                
                // Fetch join requests, using the cursor if available
                requestsData = await noblox.getJoinRequests(groupId, { cursor: cursor });
            } catch (apiError) {
                // Log API error if fetching pages fails (e.g., rate limit)
                console.error(`[ROBLOX API] Error fetching join requests for group ${groupId} on page ${pageCount}:`, apiError.message);
                break; // Break the while loop on API error
            }

            // Get the array of requests, handling both raw array and paginated object formats
            const requests = Array.isArray(requestsData)
              ? requestsData
              : requestsData?.data || [];
            
            console.log(`[ROBLOX] Page ${pageCount} returned ${requests.length} requests.`);
            
            // --- CRITICAL DEBUG LOGGING (Updated to find the ID and Username) ---
            const foundUsers = requests.map(r => {
                // *** FIX: Prioritize checking the nested 'requester' object first ***
                const id = r.requester?.userId ?? r.UserId ?? r.userId ?? r.user?.userId ?? r.id ?? 0;
                const uname = r.requester?.username ?? r.Username ?? r.username ?? r.user?.username ?? 'UnknownUser';
                
                // If we failed to find the ID, log the raw object structure
                if (id === 0) {
                    // Use a specific error tag so it's easy to find in the logs
                    console.error("[ROBLOX DEBUG] Failed to extract ID/Username. Raw Request Object:", JSON.stringify(r));
                }

                return id > 0 ? `${uname} (${id})` : null;
            }).filter(u => u);

            if (foundUsers.length > 0) {
                 console.log(`[ROBLOX] Found pending requests on page ${pageCount}: [${foundUsers.join(', ')}]`);
            }
            // -----------------------------------------------------------------------------

            // If the current page is empty, or the group has no pending requests, break
            if (requests.length === 0) break;

            // Check if the target user is in the current page of requests
            isPending = requests.some((r) => {
              // *** FIX: Prioritize checking the nested 'requester' object first ***
              const id = r.requester?.userId ?? r.UserId ?? r.userId ?? r.user?.userId ?? r.id ?? 0;
              return Number(id) === Number(userId);
            });

            // If the user was found, break immediately
            if (isPending) {
              console.log(`[ROBLOX] Found pending request for ${username} (${userId}) on page ${pageCount}.`);
              break;
            }

            // Move to the next page if a cursor exists. If not, this was the last page.
            cursor = requestsData.nextPageCursor;
            if (!cursor) {
              console.log(`[ROBLOX] Reached the last page (${pageCount}).`);
              break; 
            }
          }
        }
        // ---------------------------------------------------------------

        const embed = new EmbedBuilder()
          .setColor("Blue")
          .setTitle("Roblox User Info")
          // Added thumbnail for visual context
          .setThumbnail(`https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=420&height=420&format=png`)
          .addFields(
            { name: "Username", value: username, inline: true },
            { name: "Current Rank", value: isMember ? currentRank.toString() : "N/A", inline: true },
            { name: "In Group", value: isMember ? "✅ Yes" : "❌ No", inline: true },
            { name: "Pending Request", value: isPending ? "✅ Yes" : "❌ No", inline: true }
          );

        // --------------------- DROPDOWN ---------------------
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`rankMenu_${username}`)
          .setPlaceholder("Select an action")
          .setMinValues(1)
          .setMaxValues(1);

        // Add divisions (only rankable if member)
        for (const divName of Object.keys(config.DIVISIONS)) {
          const div = config.DIVISIONS[divName];
          selectMenu.addOptions({
            label: divName,
            value: `rank_${divName}`,
            emoji: div.emoji,
            description: isMember ? `Set rank to ${divName}` : "User not in group (Cannot Rank)",
            // Removed default property to prevent Discord API Error
          });
        }

        // Add action for removing/denying
        // Only show 'Exile Member' if they are currently a member.
        if (isMember) {
           selectMenu.addOptions({
              label: "Exile Member",
              value: "remove",
              description: "Remove the user from the group (Exile)",
            });
        }


        // Accept join request if pending AND NOT member
        if (isPending && !isMember) {
          selectMenu.addOptions({
            label: "Accept Join Request",
            value: "accept",
            description: "Accept the pending request",
          });
        }

        const row = new ActionRowBuilder().addComponents(selectMenu);

        return interaction.editReply({
          embeds: [embed],
          components: [row],
        });
      } catch (err) {
        return interaction.editReply({
          content: `❌ Failed to fetch user: ${err.message}`,
        });
      }
    }

    // --------------------- DROPDOWN HANDLER ---------------------
    if (interaction.isStringSelectMenu()) {
      await interaction.deferUpdate(); // Defer update to get time for API calls

      const username = interaction.customId.replace("rankMenu_", "");
      const selected = interaction.values[0];

      let logMessage = "";
      let actionTitle = "Action Successful";

      try {
        const userId = await noblox.getIdFromUsername(username);

        if (selected.startsWith("rank_")) {
          const division = selected.replace("rank_", "");
          const rankId = config.DIVISIONS[division].rankId;
          await noblox.setRank(groupId, userId, rankId);
          actionTitle = "Ranked Successfully";
          logMessage = `Ranked **${username}** to **${division}** (${rankId}).`;
        }

        // Handle 'remove' (Exile only)
        if (selected === "remove") {
          // Fetch rank before exiling for accurate logging
          const currentRank = await noblox.getRankInGroup(groupId, userId);
          
          // Exile member (set rank to 0)
          await noblox.setRank(groupId, userId, 0);
          actionTitle = "Exiled Successfully";
          logMessage = `Exiled **${username}** (Previous Rank: ${currentRank}) from the group.`;
        }

        if (selected === "accept") {
          await noblox.acceptJoinRequest(groupId, userId);
          actionTitle = "Request Accepted Successfully";
          logMessage = `Accepted join request for **${username}**. They should now be rank 1.`;
        }
        
        // If logMessage is still empty, it means an action was missed or invalid, but we proceed assuming a valid action was taken.
        if (!logMessage) {
            logMessage = `Performed action: **${selected}** on **${username}**.`;
        }

        const successEmbed = new EmbedBuilder()
          .setColor("Green")
          .setTitle(actionTitle)
          .setDescription(logMessage)
          .setTimestamp();

        // Use followUp instead of editReply since deferUpdate was used
        await interaction.followUp({
          embeds: [successEmbed],
          components: [],
          flags: 64, // EPHEMERAL
        });

        const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
        if (logChannel) logChannel.send({ embeds: [successEmbed] });

        // Since we deferred the UPDATE, we need to edit the original message to remove the dropdown
        await interaction.message.edit({ components: [] });

      } catch (err) {
        const failEmbed = new EmbedBuilder()
          .setColor("Red")
          .setTitle("Action Failed")
          .addFields(
            { name: "Username", value: username, inline: true },
            { name: "Action", value: selected, inline: true },
            { name: "Reason", value: err.message }
          )
          .setTimestamp();

        // Use followUp for error reporting
        await interaction.followUp({ embeds: [failEmbed], flags: 64 });

        const logChannel = client.channels.cache.get(config.CHANNELS.RANK_LOGS);
        if (logChannel) logChannel.send({ embeds: [failEmbed] });
      }
    }
  });
};
