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

class Queue {
	constructor(id, attrs, settings, isMember) {
		this.id = id
		this.attrs = attrs
		this.settings = settings || {}
		this.isMember = !!isMember
	}

	found(ctx) {
		ctx.bot.emit('queue:closed', this.id, !!this.attrs.closed)
	}

	updated(ctx, newAttrs, settings, isMember) {
		const oldAttrs = this.attrs

		this.attrs = newAttrs

		if (settings !== undefined) {
			this.settings = settings
		}

		if (isMember !== undefined) {
			this.isMember = isMember
		}

		if (!newAttrs.closed !== !oldAttrs.closed) {
			ctx.bot.emit('queue:closed', this.id, !!newAttrs.closed)
		}
	}
}

class ChannelAudience {
	constructor(channelId, audienceId) {
		this.channelId = channelId
		this.audienceId = audienceId
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
		const promise = ctx.sendAction({
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

	sendMessage(ctx, content, messageType) {
		if (messageType === undefined) {
			messageType = 'ninchat.com/text'
		}

		const params = {
			action:       'send_message',
			channel_id:   this.channelId,
			message_type: messageType,
		}

		ctx.sendAction(params, [JSON.stringify(content)])
	}

	transferAudience(ctx, targetQueueId) {
		const params = {
			action:      'transfer_audience',
			audience_id: this.audienceId,
			queue_id:    targetQueueId,
		}

		ctx.sendAction(params)
	}
}

class Context {
	constructor(bot, session, userId, debug, verbose) {
		this.bot = bot
		this.session = session
		this.userId = userId
		this.debug = debug
		this.verbose = verbose
		this.queues = {}
		this.audienceChannels = {}
	}

	sendAction(params, payload) {
		if (this.verbose) {
			if (payload !== undefined && payload !== null) {
				console.log('Action: ' + params.action + ' with payload:', params)
			} else {
				console.log('Action: ' + params.action + ':', params)
			}
		}

		this.session.send(params, payload)
	}
}

function queueUpdated(ctx, id, attrs, newSettings, isMember) {
	let oldSettings = {}

	let queue = ctx.queues[id]
	if (queue === undefined) {
		queue = new Queue(id, attrs, newSettings, isMember)
		ctx.queues[id] = queue
		queue.found(ctx)
	} else {
		oldSettings = queue.settings
		queue.updated(ctx, attrs, newSettings, isMember)
	}

	if (queue.isMember && attrs.length > 0) {
		ctx.sendAction({action: 'accept_audience', queue_id: id})
	}

	if (newSettings !== undefined && 'transfer_queue_ids' in newSettings) {
		const oldSet = new Set(oldSettings.transfer_queue_ids || null)

		for (let i in newSettings.transfer_queue_ids) {
			const targetQueueId = newSettings.transfer_queue_ids[i]

			if (!oldSet.has(targetQueueId)) {
				ctx.sendAction({action: 'describe_queue', queue_id: targetQueueId})
			}
		}
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
				ctx.sendAction({action: 'part_channel', channel_id: channelId})
			} else {
				if (a === undefined) {
					a = new ChannelAudience(channelId, info.channel_attrs.audience_id)
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
			queueUpdated(ctx, queueId, info.queue_attrs, undefined, true)

			ctx.sendAction({action: 'describe_queue', queue_id: queueId}) // Get settings.
		})
	}
}

eventHandlers.queue_joined = (ctx, params) => {
	queueUpdated(ctx, params.queue_id, params.queue_attrs, params.queue_settings, true)
}

eventHandlers.queue_found = (ctx, params) => {
	queueUpdated(ctx, params.queue_id, params.queue_attrs, params.queue_settings, undefined)
}

eventHandlers.queue_updated = (ctx, params) => {
	queueUpdated(ctx, params.queue_id, params.queue_attrs, params.queue_settings, undefined)
}

eventHandlers.channel_joined = (ctx, params) => {
	if ('audience_id' in params.channel_attrs && !(params.channel_id in ctx.audienceChannels)) {
		const a = new ChannelAudience(params.channel_id, params.channel_attrs.audience_id)
		ctx.audienceChannels[params.channel_id] = a
		a.audienceBegun(ctx)
	}
}

eventHandlers.channel_updated = (ctx, params) => {
	if (params.channel_attrs.closed || params.channel_attrs.suspended) {
		if ('audience_id' in params.channel_attrs) {
			ctx.sendAction({action: 'part_channel', channel_id: params.channel_id})
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

	sendMessage(channelId, content, messageType) {
		const a = this.ctx.audienceChannels[channelId]
		if (a !== undefined) {
			a.sendMessage(this.ctx, content, messageType)
		}
	}

	transferAudience(currentChannelId, targetQueueId) {
		const a = this.ctx.audienceChannels[currentChannelId]
		if (a !== undefined) {
			a.transferAudience(this.ctx, targetQueueId)
		}
	}
}
