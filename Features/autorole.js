// Features/autorole.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

async function registerAutoRoleCommand(client, config) {
console.log(`Successfully registered /autorole command in guild: ${config.GUILD_ID}`);

client.once('clientReady', async () => {
try {
const guild = await client.guilds.fetch(config.GUILD_ID);

await guild.commands.create(
new SlashCommandBuilder()
.setName('autorole')
.setDescription('Assigns roles based on call signs in a message')
.addStringOption(option =>
option.setName('message_link')
.setDescription('Link to the promotion message')
.setRequired(true)
)
.toJSON()
);
console.log("✅ Autorole command registered to guild");
} catch (err) {
console.error("❌ Failed to register autorole command:", err);
}
});

client.on('interactionCreate', async interaction => {
if (!interaction.isCommand()) return;
if (interaction.commandName !== 'autorole') return;

await interaction.deferReply({ ephemeral: true });

// Check permission
const requiredRole = config.COMMAND_ROLES.AUTOROLE_ROLE;
if (!interaction.member.roles.cache.has(requiredRole)) {
return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
}

const messageLink = interaction.options.getString('message_link');

try {
const matchLink = messageLink.match(/https:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
if (!matchLink) throw new Error("Invalid message link format.");

const [_, guildId, channelId, messageId] = matchLink;
if (guildId !== interaction.guild.id.toString())
return interaction.editReply({ content: '❌ This message is not from this server.' });

const channel = await interaction.guild.channels.fetch(channelId);
const message = await channel.messages.fetch(messageId);
const content = message.content;

const logChannelId = config.COMMAND_ROLES?.AUTOROLE_LOG_CHANNEL;
const logChannel = logChannelId ? await interaction.guild.channels.fetch(logChannelId).catch(() => null) : null;

let processedUsers = 0;
const fields = [];

for (const entry of config.AUTOROLE.LEGEND) {
for (const callsign of entry.callsigns) {
// Regex: matches @user and callsign anywhere on the same line
const regex = new RegExp(`(<@!?\\d+>).*${callsign}`, 'g');
let match;
while ((match = regex.exec(content)) !== null) {
const userId = match[1].replace(/[<@!>]/g, '');
const member = await interaction.guild.members.fetch(userId).catch(() => null);
if (!member) continue;

processedUsers++;

const addedRoles = [];
const removedRoles = [];
const failedRoles = [];

// Add roles
for (const roleName of entry.rolesGiven) {
const role = interaction.guild.roles.cache.find(r => r.name === roleName);
if (!role) {
failedRoles.push(roleName);
continue;
}
if (!member.roles.cache.has(role.id)) {
try {
await member.roles.add(role);
addedRoles.push(role.name);
} catch {
failedRoles.push(role.name);
}
}
}

// Remove roles
for (const roleName of entry.rolesRemoved) {
const role = interaction.guild.roles.cache.find(r => r.name === roleName);
if (!role) {
failedRoles.push(roleName);
continue;
}
if (member.roles.cache.has(role.id)) {
try {
await member.roles.remove(role);
removedRoles.push(role.name);
} catch {
failedRoles.push(role.name);
}
}
}

// Add field for this member
fields.push({
name: `**${member.user.tag}**`,
value: `Added Roles: ${addedRoles.join(', ') || 'None'}\nRemoved Roles: ${removedRoles.join(', ') || 'None'}${failedRoles.length > 0 ? `\nMissing Roles: ${failedRoles.join(', ')}` : ''}`
});
}
}
}

// Send embed log if there are processed users
if (logChannel && fields.length > 0) {
const embed = new EmbedBuilder()
.setTitle(`Autorole Log - [${message.url}]`)
.setColor(0x00FF00)
.addFields(fields)
.setTimestamp();

await logChannel.send({ embeds: [embed] });
}

return interaction.editReply({ content: `✅ Roles processed successfully. Users processed: ${processedUsers}` });

} catch (err) {
console.error(err);
return interaction.editReply({ content: `❌ Failed to process the message: ${err.message}` });
}
});
}

module.exports = {
registerAutoRoleCommand
};
