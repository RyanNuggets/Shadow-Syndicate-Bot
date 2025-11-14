const { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');

// In-memory state management (for score and question history). Use a database for production.
const userExams = new Map();
// Simple file storage for failure counts
const failureLogPath = 'failures.json';

const questions = [
    { q: "What should be done first if a GSW is found on the neck?", a: "Apply a cotton pad", choices: ["Apply a cotton pad", "Apply a chest seal", "Immediately transport", "Check pulse rate"] },
    { q: "What is the normal pulse rate for an adult?", a: "60-100", choices: ["30-50", "60-100", "110-140", "150+"] },
    { q: "Which wound care item should be used for a neck wound?", a: "Cotton pad", choices: ["Gauze", "Chest seal", "Cotton pad", "Tourniquet"] },
    { q: "What is the first action when dealing with a GSW?", a: "Check the scene's security", choices: ["Apply pressure to wound", "Check the scene's security", "Call for backup", "Check the patient's breathing"] },
    { q: "Which wound should be packed with gauze and secured with a bandage?", a: "GSW to the abdomen", choices: ["GSW to the neck", "GSW to the chest", "GSW to the limb", "GSW to the abdomen"] },
    { q: "What should be done if a patient's pulse is above 150?", a: "Transport ASAP", choices: ["Monitor for 10 minutes", "Transport ASAP", "Administer oxygen", "Check breathing rate"] },
    { q: "What is the purpose of a chest seal?", a: "To secure a chest wound", choices: ["To stop bleeding from a limb", "To secure a chest wound", "To treat a fracture", "To maintain an airway"] },
    { q: "What is the purpose of the recovery position?", a: "To maintain an open airway", choices: ["To stabilize a fracture", "To maintain an open airway", "To treat internal bleeding", "To warm the patient"] },
    { q: "How should a GSW to the face be treated?", a: "Use a cotton pad", choices: ["Use a tourniquet", "Use a chest seal", "Use a cotton pad", "Apply a backboard"] },
    { q: "What does the 'A' in ABCs stand for?", a: "Airway", choices: ["Arteries", "Assessment", "Airway", "Alertness"] },
    { q: "What should be used to secure a chest wound?", a: "Chest seal", choices: ["Cotton pad", "Splint", "Chest seal", "Tourniquet"] },
    { q: "What should you do if a patient's breathing rate is above 20?", a: "Monitor and seek additional aid", choices: ["Immediate transport", "Monitor and seek additional aid", "Apply a chest seal", "Administer high-flow oxygen"] },
    { q: "What is the first thing you should check when arriving at a scene?", a: "The scene's security", choices: ["The patient's pulse", "The patient's breathing", "The scene's security", "Patient's consciousness"] },
    { q: "What is the maximum safe pulse rate before transport is necessary?", a: "150", choices: ["100", "120", "150", "160"] },
    { q: "How do you treat a gunshot wound on a limb?", a: "Wrap a tourniquet above the wound", choices: ["Apply a cotton pad", "Wrap a tourniquet above the wound", "Apply a splint", "Use a chest seal"] },
    { q: "What is the best initial treatment for a blunt force injury causing a broken bone?", a: "Apply a splint", choices: ["Apply a splint", "Immediate transport", "Apply a tourniquet", "Apply pressure"] },
    { q: "Which piece of equipment is used to prevent movement of a fractured limb?", a: "Splint", choices: ["Chest seal", "Splint", "Cotton pad", "Backboard"] },
    { q: "Which injury requires immediate transport and possibly a backboard?", a: "GSW to the chest", choices: ["GSW to the hand", "GSW to the arm", "GSW to the chest", "Abrasion"] },
    { q: "What should be done if you suspect internal bleeding?", a: "Transport ASAP", choices: ["Give water", "Transport ASAP", "Elevate limbs", "Monitor pulse"] },
    { q: "Which type of GSW requires both an entry and exit wound to be treated?", a: "Limb wound", choices: ["Chest wound", "Neck wound", "Limb wound", "Face wound"] }
];

// --- Utility Functions ---

/** Loads failure counts from a local file. */
function loadFailureCounts() {
    try {
        if (fs.existsSync(failureLogPath)) {
            return JSON.parse(fs.readFileSync(failureLogPath));
        }
    } catch (e) {
        console.error("Error loading failure counts:", e);
    }
    return {};
}

/** Saves failure counts to a local file. */
function saveFailureCounts(counts) {
    try {
        fs.writeFileSync(failureLogPath, JSON.stringify(counts, null, 2));
    } catch (e) {
        console.error("Error saving failure counts:", e);
    }
}

/** Shuffles an array (Fisher-Yates algorithm). */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// --- Main Exam Flow Functions ---

/** Sends the current question to the user via DM. */
async function sendQuestion(user, examState, config) {
    const { questions: userQuestions, currentQuestionIndex } = examState;

    if (currentQuestionIndex >= config.EXAM_SETTINGS.TOTAL_QUESTIONS) {
        // Exam finished
        return completeExam(user.client, user, examState, config);
    }

    const qData = userQuestions[currentQuestionIndex];

    const embed = new EmbedBuilder()
        .setTitle(`BLS Exam - Question ${currentQuestionIndex + 1}/${config.EXAM_SETTINGS.TOTAL_QUESTIONS}`)
        .setDescription(qData.q)
        .setColor(0x3498DB); 

    // Row 1: The four answer buttons
    const row1 = new ActionRowBuilder();
    const letters = ['A', 'B', 'C', 'D'];
    
    // Store the choices with their button labels/IDs for validation later
    let buttonChoices = {};
    const shuffledChoices = shuffleArray([...qData.choices]); 

    for (let i = 0; i < 4; i++) {
        const choiceText = shuffledChoices[i];
        // Ensure custom ID is unique and carries validation info, but stays under 100 char limit
        const customId = `bls_q_${currentQuestionIndex}_a_${letters[i]}_${Buffer.from(choiceText).toString('base64').slice(0, 10)}`; 
        
        row1.addComponents( 
            new ButtonBuilder()
                .setCustomId(customId) 
                .setLabel(choiceText) 
                .setStyle(ButtonStyle.Secondary)
        );
        buttonChoices[customId] = choiceText;
    }

    // Row 2: The Cancel button
    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('bls_cancel_exam')
                .setLabel('Cancel Exam')
                .setStyle(ButtonStyle.Danger)
        );

    // Update state with choice map for validation
    examState.currentChoices = buttonChoices;

    try {
        const message = await user.send({ embeds: [embed], components: [row1, row2] }); // Send both rows
        examState.currentMessage = message;
    } catch (e) {
        console.error(`Failed to DM user ${user.id}:`, e.message);
        userExams.delete(user.id); // Stop the exam if DM fails
    }
}

/** Sends the confirmation prompt when 'Cancel Exam' is clicked. */
async function sendConfirmation(interaction, examState) {
    const user = interaction.user;

    // GUARANTEE 1: Reliably delete the previous question message immediately
    try {
        await interaction.message.delete();
        examState.currentMessage = null; 
    } catch (e) {
        if (!e.message.includes('Unknown Message')) {
             console.warn(`[Warning] Failed to delete question message during pre-cancellation for user ${user.id}:`, e.message);
        }
    }

    const embed = new EmbedBuilder()
        .setTitle("⚠️ Confirm Cancellation")
        .setDescription("Are you sure you want to cancel the BLS Exam? If you confirm, your current progress will be lost and **no score will be logged**.")
        .setColor(0xFEE75C);

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('bls_cancel_confirm')
                .setLabel('Yes, Cancel Exam')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('bls_cancel_continue')
                .setLabel('No, Continue Exam')
                .setStyle(ButtonStyle.Success)
        );

    try {
        const message = await user.send({ embeds: [embed], components: [row] });
        examState.currentMessage = message; // Update current message to the confirmation message
    } catch (e) {
        console.error(`Failed to DM user ${user.id} with confirmation:`, e.message);
        userExams.delete(user.id);
    }
}

/** Handles confirmed cancellation, cleans state, and logs the cancellation (Embed in LOGS). */
async function cancelExam(client, user, examState, config) {
    userExams.delete(user.id); // Remove from active exams

    // GUARANTEE 2: Explicitly delete the confirmation embed before sending the final message
    if (examState.currentMessage) {
        try {
            await examState.currentMessage.delete();
        } catch (e) {
            if (!e.message.includes('Unknown Message')) {
                console.warn(`[Warning] Failed to delete confirmation message for user ${user.id}:`, e.message);
            }
        }
    }

    // 1. Send final message to user
    await user.send("You have successfully cancelled the BLS Exam."); 

    // 2. Log to the LOGS Channel (using Embed)
    try {
        const logsChannel = await client.channels.fetch(config.CHANNELS.LOGS);
        
        const logEmbed = new EmbedBuilder()
            .setTitle(`Exam Cancelled - ${user.tag}`)
            .setDescription(`**Cadet:** <@${user.id}>\n**Status:** Exam Cancelled by user.`)
            .setColor(0xF04747)
            .setFooter({ text: `Attempt stopped at question ${examState.currentQuestionIndex + 1}/${config.EXAM_SETTINGS.TOTAL_QUESTIONS}` })
            .setTimestamp();

        if (logsChannel && logsChannel.type === ChannelType.GuildText) {
            await logsChannel.send({ embeds: [logEmbed] });
        } else {
            console.error("Logs channel not found or is not a text channel for cancellation log.");
        }
    } catch (e) {
        console.error("Error sending cancellation log:", e.message);
    }
}


/** Handles the final scoring, role changes, and logging (Pass/Fail). */
async function completeExam(client, user, examState, config) {
    userExams.delete(user.id); // Remove from active exams
    const score = examState.score;
    const didPass = score >= config.EXAM_SETTINGS.PASS_SCORE;
    
    // 1. Load/Update Failure History
    const failureCounts = loadFailureCounts();
    let userFails = failureCounts[user.id] || 0;
    
    // 2. Variables for Logging and Role Management
    let rolesAttempted = false;
    let rolesSuccess = false;
    
    if (didPass) {
        // Clear fails on passing
        if (failureCounts[user.id]) delete failureCounts[user.id];

        // Role Management
        rolesAttempted = true;
        try {
            const guild = client.guilds.cache.get(config.GUILD_ID);
            const member = await guild.members.fetch(user.id);
            
            await member.roles.add(config.ROLES.ADD_ON_PASS);
            await member.roles.remove(config.ROLES.REMOVE_ON_PASS);
            rolesSuccess = true;
            
            // Final DM to user
            await user.send(`**Congratulations!** You passed the BLS Exam with a score of **${score}/${config.EXAM_SETTINGS.TOTAL_QUESTIONS}**. Your roles have been updated.`);

        } catch (e) {
            console.error(`Failed to update roles for ${user.tag}:`, e.message);
            await user.send(`**You Passed** with a score of **${score}/${config.EXAM_SETTINGS.TOTAL_QUESTIONS}**, but I could not update your roles. Please open a General Support Ticket.`);
        }
        
    } else {
        // User FAILED
        userFails += 1;
        failureCounts[user.id] = userFails;

        if (userFails >= 2) {
            await user.send(`**You did not pass** the BLS Exam. Your final score was **${score}/${config.EXAM_SETTINGS.TOTAL_QUESTIONS}**. This is your **${userFails}th failed attempt**. An instructor will reach out to you before you can retry.`);
        } else {
            await user.send(`**You did not pass** the BLS Exam. Your final score was **${score}/${config.EXAM_SETTINGS.TOTAL_QUESTIONS}**. Please study and try again.`);
        }
    }

    // 3. Save Fails
    saveFailureCounts(failureCounts);

    // --- LOGIC 1: RESULTS Channel (Detailed Plain Text Log with Emojis and Date) ---
    try {
        const currentDate = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }); 

        const statusText = didPass ? `Pass` : `Fail`;

        const resultsLogMessage = 
`<:FLETC:1242923979992469564> | **Homeland Security - FTC Activity Log**
<:User_Verified:1307811372544950352> | **Cadet:** <@${user.id}>
<:Paper:1241536003143893022> | **FTC Activity:** Phase 2
📅 | **Date:** ${currentDate}
📋 | **Status:** ${statusText}
<:aipstartline:1269142827498209401> <:AIPLine:1269141548881412186> <:aipendline:1269143053109690430>`;

        const resultsChannel = await client.channels.fetch(config.CHANNELS.RESULTS);
        if (resultsChannel && resultsChannel.type === ChannelType.GuildText) {
            await resultsChannel.send(resultsLogMessage);
        } else {
            console.error("Results channel (config.CHANNELS.RESULTS) not found or is not a text channel. Please check your config.json.");
        }
    } catch (e) {
        console.error("Error sending message to results channel:", e.message);
    }
    
    // --- LOGIC 2: LOGS Channel (New Embed Log) ---
    try {
        const totalQuestions = config.EXAM_SETTINGS.TOTAL_QUESTIONS;
        let title, description, color;

        if (didPass) {
            const rolesGivenStatus = rolesSuccess ? 'Yes' : 'Failed to Give';
            title = `Exam Passed - ${user.tag}`;
            description = `**Cadet:** <@${user.id}>\n**Score:** ${score}/${totalQuestions}\n**Roles Given:** ${rolesGivenStatus}`;
            color = 0x57F287;
        } else {
            title = `Exam Failed - ${user.tag}`;
            description = `**Cadet:** <@${user.id}>\n**Score:** ${score}/${totalQuestions}\n**Fails:** ${userFails}`;
            color = 0xFEE75C;
        }

        const logEmbed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setTimestamp();

        const logsChannel = await client.channels.fetch(config.CHANNELS.LOGS);
        if (logsChannel && logsChannel.type === ChannelType.GuildText) {
            await logsChannel.send({ embeds: [logEmbed] });
        } else {
            console.error("Logs channel (config.CHANNELS.LOGS) not found or is not a text channel.");
        }
    } catch (e) {
        console.error("Error sending message to logs channel:", e.message);
    }
}


/** Sends the start button to the designated channel. */
async function postStartButton(client, config) {
    const channel = await client.channels.fetch(config.CHANNELS.BUTTON);
    if (!channel || channel.type !== ChannelType.GuildText) {
        console.error("Button channel not found or is not a text channel.");
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle("BLS Cadet Exam")
        .setDescription("Click the button below to start the Basic Life Support exam. The exam consists of 20 questions and requires a score of **15/20** to pass. The exam will be conducted entirely via **Direct Messages**.")
        .setColor(0x0099FF);

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('bls_start_test')
                .setLabel('Start BLS Exam')
                .setStyle(ButtonStyle.Success)
        );

    // Check if a message already exists to avoid spamming the channel
    const messages = await channel.messages.fetch({ limit: 5 });
    const existingMessage = messages.find(m => m.components.some(c => c.components.some(b => b.customId === 'bls_start_test')));

    if (!existingMessage) {
        channel.send({ embeds: [embed], components: [row] });
        console.log("Start button posted successfully.");
    } else {
        console.log("Start button already exists, skipping post.");
    }
}

/**
 * Registers all event handlers for the BLS Exam feature with the Discord client.
 * @param {Client} client The Discord client instance.
 * @param {object} config The configuration object loaded from config.json.
 */
function registerExamHandlers(client, config) {

    // --- 1. Ready Event: Post Start Button ---
    // FIX APPLIED: Using client.once to ensure the button posts exactly once on bot connection.
    client.once('clientReady', () => {
        // Ensure config.json is loaded and has necessary data before posting
        if (config && config.CHANNELS && config.CHANNELS.BUTTON) {
            postStartButton(client, config);
        } else {
            console.error("Configuration incomplete. Cannot post start button.");
        }
    });

    // --- 2. Interaction Event: Handles button interactions (Start, Answer, Cancel, Confirm) ---
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()) return;
        
        // Defer the reply to prevent timeout warnings (only for channel interactions)
        if (interaction.channel.type !== ChannelType.DM) {
            await interaction.deferUpdate().catch(() => {});
        }

        // --- START BUTTON LOGIC (In Guild Channel) ---
        if (interaction.customId === 'bls_start_test') {
            // Note: Since we deferred the reply above, we now use followUp
            const member = interaction.member;

            if (userExams.has(member.id)) {
                return interaction.followUp({ content: 'You are already taking the exam! Check your DMs.', ephemeral: true });
            }
            
            // 1. Role Check
            const neededRole = config.ROLES.NEEDED_TO_START;
            if (!member.roles.cache.has(neededRole)) {
                return interaction.followUp({ content: `You must have the <@&${neededRole}> role to start the exam.`, ephemeral: true });
            }

            // 2. Prepare Exam State
            const randomizedQuestions = shuffleArray([...questions]);
            const examState = {
                score: 0,
                currentQuestionIndex: 0,
                questions: randomizedQuestions,
                currentMessage: null,
                currentChoices: {} // Stores choices for validation
            };
            userExams.set(member.id, examState);

            // 3. Send First Question
            try {
                await member.send("Starting your BLS Exam. Good luck!");
                await sendQuestion(member.user, examState, config);
            } catch (e) {
                userExams.delete(member.id);
                interaction.followUp({ content: `Failed to DM you! Please ensure your DMs are open and try again.`, ephemeral: true });
            }
            
            return;
        }

        // --- DM INTERACTION LOGIC (Only proceed if it's an exam-related button) ---
        if (!interaction.customId.startsWith('bls_')) return;
        if (interaction.channel.type !== ChannelType.DM) return;
        
        const userId = interaction.user.id;
        if (!userExams.has(userId)) {
            return interaction.reply({ content: "Your exam state was lost or the exam was finished. Please start a new one.", ephemeral: true });
        }

        const examState = userExams.get(userId);
        const user = interaction.user;

        // 1. Initial Cancel Button Press
        if (interaction.customId === 'bls_cancel_exam') {
            await interaction.deferUpdate().catch(() => {});
            return sendConfirmation(interaction, examState);
        }

        // 2. Cancel Confirmation
        if (interaction.customId === 'bls_cancel_confirm') {
            await interaction.deferUpdate().catch(() => {});
            // Deletion is handled inside cancelExam for final cleanup
            return cancelExam(client, user, examState, config);
        }

        // 3. Continue Confirmation (Clicked 'No, Continue Exam')
        if (interaction.customId === 'bls_cancel_continue') {
            await interaction.deferUpdate().catch(() => {});
            
            // FIX: Reliably delete the cancel confirmation embed *before* sending the new question
            if (examState.currentMessage) {
                try {
                    // AWAIT the delete call
                    await examState.currentMessage.delete();
                } catch (e) {
                    if (!e.message.includes('Unknown Message')) {
                        console.warn(`[Warning] Failed to delete 'continue' confirmation message for user ${user.id}:`, e.message);
                    }
                }
            }
            
            // Re-send the current question (AWAITING the return to ensure sequential execution)
            examState.currentMessage = null; 
            await sendQuestion(interaction.user, examState, config); 
            return;
        }

        // 4. Question Answer Logic
        if (interaction.customId.startsWith('bls_q_')) {
            const qIndex = examState.currentQuestionIndex;
            const qData = examState.questions[qIndex];
            
            // FIX: Disable all buttons on the current message immediately to prevent race conditions
            try {
                const updatedComponents = interaction.message.components.map(row => 
                    ActionRowBuilder.from(row).setComponents(row.components.map(component => 
                        ButtonBuilder.from(component).setDisabled(true)
                    ))
                );
                // This edit *must* happen before the deferUpdate for smooth UX
                await interaction.update({ components: updatedComponents });
            } catch (e) {
                console.error(`Error disabling buttons for user ${userId}:`, e.message);
                // Continue even if button update fails
            }
            
            // Defer the update (since we're in a DM, this is mainly to keep the interaction alive)
            await interaction.deferUpdate().catch(() => {});
            
            // Validate Answer
            const chosenAnswer = examState.currentChoices[interaction.customId];
            if (!chosenAnswer) {
                console.error("Choice text not found for custom ID:", interaction.customId);
                return; // Ignore invalid button press
            }

            if (chosenAnswer === qData.a) {
                examState.score += 1;
            }

            // FIX: Reliably delete the answered question message *before* moving to the next
            try {
                // AWAIT the delete call
                await interaction.message.delete();
            } catch (e) {
                if (!e.message.includes('Unknown Message')) {
                    console.warn(`[Warning] Failed to delete answered question message for user ${userId}:`, e.message);
                }
            }
            
            // Move to Next Question
            examState.currentQuestionIndex += 1;
            
            // Clear the currentMessage reference
            examState.currentMessage = null; 
            
            // AWAIT the next question being sent to enforce sequence (This prevents Q9/Q10 stack)
            await sendQuestion(interaction.user, examState, config);
            return;
        }
    });
}

// Export the registration function
module.exports = { registerExamHandlers };
