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

class ChannelAudience {
	constructor(channelId) {
		this.channelId = channelId
		this.buffering = false
		this.seenMessageIds = new Set()
		this.latestMessageId = ''
	}

	audienceBegun(ctx) {
		ctx.bot.emit('begin', this.channelId)
	}

	audienceResumed(ctx) {
		ctx.bot.emit('resume', this.channelId)
	}

	audienceEnded(ctx) {
		ctx.bot.emit('end', this.channelId)
	}

	messageReceived(ctx, messageId, content) {
		if (!this.buffering && !this.seenMessageIds.has(messageId)) {
			ctx.bot.emit('messages', this.channelId, [content])

			this.seenMessageIds.add(messageId)

			if (messageId > this.latestMessageId) {
				this.latestMessageId = messageId
			}
		}
	}

	loadHistory(ctx) {
		const promise = ctx.session.send({
			action:         'load_history',
			channel_id:     this.channelId,
			message_id:     this.latestMessageId,
			message_types:  ['ninchat.com/text'],
			history_length: 1000,
			history_order:  1,
		})

		const buffer = {}

		const finishBuffering = () => {
			this.buffering = false

			const ids = Object.keys(buffer)
			ids.sort()

			if (ids.length > 0) {
				let finalId
				let contents = []

				ids.forEach(id => {
					finalId = id

					if (!this.seenMessageIds.has(id)) {
						const c = buffer[id]
						if (c === null) {
							// Own message; discard older messages.
							contents.length = 0
						} else {
							contents.push(c)
						}
					}
				})

				ctx.bot.emit('messages', this.channelId, contents)

				ids.forEach(id => this.seenMessageIds.add(id))

				if (finalId > this.latestMessageId) {
					this.latestMessageId = finalId
				}
			}
		}

		const onMessage = (params, payload) => {
			if (params.message_user_id === ctx.userId) {
				buffer[params.message_id] = null // Marker
			} else {
				buffer[params.message_id] = JSON.parse(ninchatClient.stringifyFrame(payload[0]))
			}
		}

		const onFinalMessage = (params, payload) => {
			onMessage(params, payload)
			finishBuffering()
		}

		const onError = params => {
			finishBuffering()
		}

		promise.then(onFinalMessage, onError, onMessage)
		this.buffering = true
	}

	sendMessage(ctx, content) {
		const params = {
			action:       'send_message',
			channel_id:   this.channelId,
			message_type: 'ninchat.com/text',
		}

		ctx.session.send(params, [JSON.stringify(content)])
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
		ctx.session.send({action: 'accept_audience', queue_id: queueId})
	}
}

let eventHandlers = {}
let messageHandlers = {}

eventHandlers.error = (ctx, params) => {
	console.log('Error:', params)
}

eventHandlers.session_created = (ctx, params) => {
	const audienceChannels = {}

	Object.keys(params.user_channels).forEach(channelId => {
		const info = params.user_channels[channelId]

		if ('audience_id' in info.channel_attrs) {
			let a = ctx.audienceChannels[channelId]

			if (info.channel_attrs.closed || info.channel_attrs.suspended) {
				ctx.session.send({action: 'part_channel', channel_id: channelId})
			} else {
				if (a === undefined) {
					a = new ChannelAudience(channelId)
					a.audienceResumed(ctx)
				}
				audienceChannels[channelId] = a
				a.loadHistory(ctx)
			}
		}
	})

	Object.keys(ctx.audienceChannels).forEach(channelId => {
		const a = ctx.audienceChannels[channelId]
		a.audienceEnded(ctx)
	})

	ctx.audienceChannels = audienceChannels

	if ('user_queues' in params) {
		Object.keys(params.user_queues).forEach(queueId => {
			const info = params.user_queues[queueId]
			acceptAudience(ctx, queueId, info.queue_attrs)
		})
	}
}

eventHandlers.queue_found = (ctx, params) => {
	acceptAudience(ctx, params.queue_id, params.queue_attrs)
}

eventHandlers.queue_updated = (ctx, params) => {
	acceptAudience(ctx, params.queue_id, params.queue_attrs)
}

eventHandlers.channel_joined = (ctx, params) => {
	if ('audience_id' in params.channel_attrs && !(params.channel_id in ctx.audienceChannels)) {
		const a = new ChannelAudience(params.channel_id)
		ctx.audienceChannels[params.channel_id] = a
		a.audienceBegun(ctx)
	}
}

eventHandlers.channel_updated = (ctx, params) => {
	if (params.channel_attrs.closed || params.channel_attrs.suspended) {
		if ('audience_id' in params.channel_attrs) {
			ctx.session.send({action: 'part_channel', channel_id: params.channel_id})
		}

		const a = ctx.channelAudiences[params.channel_id]
		if (a !== undefined) {
			delete ctx.channelAudiences[params.channel_id]
			a.audienceEnded(ctx)
		}
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

messageHandlers['ninchat.com/text'] = (ctx, params, content) => {
	if ('channel_id' in params && params.message_user_id !== ctx.userId) {
		const a = ctx.audienceChannels[params.channel_id]
		if (a !== undefined) {
			a.messageReceived(ctx, params.message_id, content)
		}
	}
}

exports.Bot = class extends events.EventEmitter {
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

		const handleSessionEvent = params => {
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
