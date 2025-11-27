// Features/ShiftManagement/shiftmanage.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// In-memory shift tracking
const activeShifts = new Map();

module.exports = {
    registerShiftManageCommand: async (client, config) => {
        // Slash command registration handled elsewhere
    },

    registerShiftManageHandlers: (client, config) => {
        // Only slash commands here, buttons handled in index.js
    },

    handleShiftButtons: async (interaction, config) => {
        try {
            const [action, type] = interaction.customId.split('_').slice(1); // SHIFT_START_DHS => ['START','DHS']
            const userId = interaction.user.id;
            const guild = interaction.guild;

            if (!config.SHIFT_TYPES[type]) {
                if (!interaction.replied && !interaction.deferred) {
                    return interaction.followUp({ content: `❌ Unknown shift type: ${type}`, ephemeral: true });
                } else {
                    return interaction.editReply({ content: `❌ Unknown shift type: ${type}` }).catch(() => {});
                }
            }

            const shiftData = activeShifts.get(userId) || {};
            const typeData = config.SHIFT_TYPES[type];
            const member = await guild.members.fetch(userId);

            switch (action) {
                case 'START':
                    if (!shiftData[type]) {
                        shiftData[type] = { startedAt: Date.now(), onBreak: false };
                        activeShifts.set(userId, shiftData);

                        // Add on-duty role
                        if (typeData.ondutyrole) await member.roles.add(typeData.ondutyrole).catch(() => {});

                        if (interaction.deferred) {
                            await interaction.editReply({ content: `✅ You started your ${type} shift.` }).catch(() => {});
                        } else {
                            await interaction.followUp({ content: `✅ You started your ${type} shift.`, ephemeral: true }).catch(() => {});
                        }
                    } else {
                        if (interaction.deferred) {
                            await interaction.editReply({ content: `⚠️ You already started a ${type} shift.` }).catch(() => {});
                        } else {
                            await interaction.followUp({ content: `⚠️ You already started a ${type} shift.`, ephemeral: true }).catch(() => {});
                        }
                    }
                    break;

                case 'END':
                    if (shiftData[type]) {
                        // Remove on-duty role
                        if (typeData.ondutyrole) await member.roles.remove(typeData.ondutyrole).catch(() => {});

                        delete shiftData[type];
                        activeShifts.set(userId, shiftData);

                        if (interaction.deferred) {
                            await interaction.editReply({ content: `🛑 You ended your ${type} shift.` }).catch(() => {});
                        } else {
                            await interaction.followUp({ content: `🛑 You ended your ${type} shift.`, ephemeral: true }).catch(() => {});
                        }
                    } else {
                        if (interaction.deferred) {
                            await interaction.editReply({ content: `⚠️ You don't have an active ${type} shift.` }).catch(() => {});
                        } else {
                            await interaction.followUp({ content: `⚠️ You don't have an active ${type} shift.`, ephemeral: true }).catch(() => {});
                        }
                    }
                    break;

                case 'PAUSE':
                    if (shiftData[type] && !shiftData[type].onBreak) {
                        // Start break
                        shiftData[type].onBreak = true;
                        activeShifts.set(userId, shiftData);

                        if (typeData.ondutyrole) await member.roles.remove(typeData.ondutyrole).catch(() => {});

                        if (interaction.deferred) {
                            await interaction.editReply({ content: `⏸️ You are now on break for ${type} shift.` }).catch(() => {});
                        } else {
                            await interaction.followUp({ content: `⏸️ You are now on break for ${type} shift.`, ephemeral: true }).catch(() => {});
                        }
                    } else if (shiftData[type] && shiftData[type].onBreak) {
                        // Resume shift
                        shiftData[type].onBreak = false;
                        activeShifts.set(userId, shiftData);

                        if (typeData.ondutyrole) await member.roles.add(typeData.ondutyrole).catch(() => {});

                        if (interaction.deferred) {
                            await interaction.editReply({ content: `▶️ You resumed your ${type} shift.` }).catch(() => {});
                        } else {
                            await interaction.followUp({ content: `▶️ You resumed your ${type} shift.`, ephemeral: true }).catch(() => {});
                        }
                    } else {
                        if (interaction.deferred) {
                            await interaction.editReply({ content: `⚠️ You don't have an active ${type} shift.` }).catch(() => {});
                        } else {
                            await interaction.followUp({ content: `⚠️ You don't have an active ${type} shift.`, ephemeral: true }).catch(() => {});
                        }
                    }
                    break;

                default:
                    if (interaction.deferred) {
                        await interaction.editReply({ content: `❌ Unknown action: ${action}` }).catch(() => {});
                    } else {
                        await interaction.followUp({ content: `❌ Unknown action: ${action}`, ephemeral: true }).catch(() => {});
                    }
            }
        } catch (err) {
            console.error("[ERROR] handleShiftButtons:", err);

            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.followUp({ content: "⚠️ Something went wrong.", ephemeral: true }).catch(() => {});
                } else if (interaction.deferred) {
                    await interaction.editReply({ content: "⚠️ Something went wrong.", ephemeral: true }).catch(() => {});
                }
            } catch (e) {
                console.error("[ERROR] Failed to notify user about error:", e);
            }
        }
    }
};
