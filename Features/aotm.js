async function sendAOTMAnnouncement(client, config) {
    const CHANNELS = config.CHANNELS;

    const messageContent = `|| <@&942533333303308309> ||

# <:DHSLOGO2:1229625703503499386>  | Agent of the Month Voting

**Hello everyone!**

Agent of the Month voting submissions are now open for this month. Please use the following Google Form to cast your vote:

- [Agent of the Month Voting Form](https://forms.gle/fD8x6CaS9wU7wVbu8)
- [Department of Homeland Security Roster](https://docs.google.com/spreadsheets/d/1aNUvUw7T-DkLN8fzSDCPdjV7FpmnXlOG7CVKX7EXuJA/edit?gid=1932038631#gid=1932038631)

We kindly request all members to vote responsibly and fairly. Your involvement is crucial in recognizing and appreciating the remarkable efforts of our agents!

Your participation in this voting process will not only acknowledge their hard work but also inspire and motivate them further!

-# On behalf of the High Command Team,
-# <:Chief_of_Staff:1293958022934302750> Chief of Staff, Quinn.
-# <:Executive_Director:1293958517002211388> Executive Director, S. Bob.
-# <:Assistant_Director:1293958529862078524> Assistant Director, Kelly S.
-# <:Director:1293958557322186752> Director, Ryan R.`;

    const channelsToSend = [CHANNELS.AOTM_VOTING, CHANNELS.AOTM_PUBLISH];

    for (const channelId of channelsToSend) {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (!ch) continue;

        const sentMsg = await ch.send({ content: messageContent });
        if (channelId === CHANNELS.AOTM_PUBLISH && sentMsg.crosspost) {
            sentMsg.crosspost().catch(console.error);
        }
    }
}

module.exports = { sendAOTMAnnouncement };
