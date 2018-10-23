const ninchatBot = require('./ninchat/bot')

const debugMessages = true
const verboseLogging = true

const identity = {
	type: 'email',
	name: ADDRESS,
	auth: PASSWORD,
}

const bot = new ninchatBot.Bot({identity, debugMessages, verboseLogging})

bot.on('message', (channelId, content) => {
	console.log('test-bot received message')

	const text = content.text

	setTimeout(() => {
		console.log('test-bot is sending message')
		bot.sendMessage(channelId, {text: 'You sez: ' + text})
	})
})
