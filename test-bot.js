const ninchatBot = require('./ninchat/bot')

const debugMessages = true
const verboseLogging = true

const identity = {
	type: 'email',
	name: ADDRESS,
	auth: PASSWORD,
}

const bot = new ninchatBot.Bot({identity, debugMessages, verboseLogging})

bot.on('begin', id => {
	console.log('test-bot: new customer on channel', id)
})

bot.on('resume', id => {
	console.log('test-bot: existing customer on channel', id)
})

bot.on('messages', (id, messages) => {
	if (messages.length > 1) {
		console.log('test-bot: received', messages.length, 'messages at once')
	}

	messages.forEach(content => {
		console.log('test-bot: received message on channel', id)

		const text = content.text

		setTimeout(() => {
			bot.sendMessage(id, {text: 'You sez: ' + text})
		})
	})
})

bot.on('end', id => {
	console.log('test-bot: channel', id, 'is gone')
})
