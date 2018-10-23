/*
 * Copyright (c) 2018, Somia Reality Oy
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

"use strict"

const events = require('events')
const ninchatClient = require('ninchat-js')

class Audience {
	constructor(channelId) {
		this.channelId = channelId
	}

	channelJoined(ctx) {
	}

	messageReceived(ctx, content) {
		ctx.bot.emit('message', this.channelId, content)
	}

	sendMessage(ctx, content) {
		ctx.session.send({
			action:       'send_message',
			channel_id:   this.channelId,
			message_type: 'ninchat.com/text',
		}, [JSON.stringify(content)])
	}
}

class Context {
	constructor(bot, session, userId, debug, verbose) {
		this.bot = bot
		this.session = session
		this.userId = userId
		this.debug = debug
		this.verbose = verbose
		this.audienceChannels = {}
	}
}

function acceptAudience(ctx, queueId, queueAttrs) {
	if (queueAttrs.length > 0) {
		ctx.session.send({
			action:   'accept_audience',
			queue_id: queueId,
		})
	}
}

let eventHandlers = {}
let messageHandlers = {}

eventHandlers.error = (ctx, params) => {
	console.log('Error:', params)
}

eventHandlers.session_created = (ctx, params) => {
	// TODO
}

eventHandlers.queue_found = (ctx, params) => {
	acceptAudience(ctx, params.queue_id, params.queue_attrs)
}

eventHandlers.queue_updated = (ctx, params) => {
	acceptAudience(ctx, params.queue_id, params.queue_attrs)
}

eventHandlers.channel_joined = (ctx, params) => {
	if ('audience_id' in params.channel_attrs && !(params.channel_id in ctx.audienceChannels)) {
		const a = new Audience(params.channel_id)
		ctx.audienceChannels[params.channel_id] = a
		a.channelJoined(ctx)
	}
}

eventHandlers.message_received = (ctx, params, payload) => {
	const content = JSON.parse(ninchatClient.stringifyFrame(payload[0]))

	if (ctx.verbose) {
		console.log('Message content:', content)
	}

	const f = messageHandlers[params.message_type]
	if (f !== undefined) {
		f(ctx, params, content)
	}
}

messageHandlers['ninchat.com/info/user'] = (ctx, params, content) => {
	// TODO
}

messageHandlers['ninchat.com/text'] = (ctx, params, content) => {
	if (!('action_id' in params) && 'channel_id' in params) {
		const a = ctx.audienceChannels[params.channel_id]
		if (a !== undefined) {
			a.messageReceived(ctx, content)
		}
	}
}

class Bot extends events.EventEmitter {
	constructor({identity, debugMessages, verboseLogging}) {
		super()

		const messageTypes = Object.keys(messageHandlers)

		if (debugMessages) {
			messageTypes.push('ninch.at/bot/debug')
		}

		const params = {
			message_types: messageTypes,
		}

		if (identity) {
			params.identity_type = identity.type
			params.identity_name = identity.name
			params.identity_auth = identity.auth
		}

		this.ctx = null

		const session = ninchatClient.newSession()

		const handleEvent = (params, payload) => {
			if (verboseLogging) {
				console.log('Event: ' + params.event + ':', params)
			}

			const f = eventHandlers[params.event]
			if (f !== undefined) {
				f(this.ctx, params, payload)
			}
		}

		const handleSessionEvent = (params) => {
			if (params.event == 'error') {
				console.log('Bot session error:', params)
				session.close()
			} else {
				if (this.ctx === null) {
					this.ctx = new Context(this, session, params.user_id, debugMessages, verboseLogging)
				}

				handleEvent(params)
			}
		}

		session.setParams(params)
		session.onSessionEvent(handleSessionEvent)
		session.onEvent(handleEvent)
		session.open()
	}

	sendMessage(channelId, content) {
		const a = this.ctx.audienceChannels[channelId]
		if (a !== undefined) {
			a.sendMessage(this.ctx, content)
		}
	}
}

exports.Bot = Bot
