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

const AnticsClientInstance = require('./antics.js').ClientInstance

const defaultUserAgent = 'ninchat-nodejs-bot/1' // Replaces NinchatClient's default.
exports.defaultUserAgent = defaultUserAgent

function parseContent(ctx, messageType, payload) {
	let content

	try {
		content = JSON.parse(ninchatClient.stringifyFrame(payload[0]))
	} catch (e) {
		if (ctx.verbose) {
			console.log(messageType, 'message content parse error: ', e)
		}
	}

	return content
}

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
	constructor(channelId, queueId, audienceId) {
		this.channelId = channelId
		this.queueId = queueId
		this.audienceId = audienceId
		this.buffering = false
		this.seenMessageIds = new Set()
		this.latestMessageId = ''
	}

	audienceBegun(ctx, audienceMetadata) {
		let info = {}
		if (audienceMetadata !== undefined) {
			info.audienceMetadata = audienceMetadata
		}
		ctx.bot.emit('begin', this.channelId, this.queueId, info)
	}

	audienceResumed(ctx) {
		ctx.bot.emit('resume', this.channelId, this.queueId)
	}

	audienceEnded(ctx) {
		ctx.bot.emit('end', this.channelId)
	}

	messageReceived(ctx, messageId, messageType, payload) {
		if (this.buffering) {
			return
		}

		if (this.seenMessageIds.has(messageId)) {
			return
		}

		const m = {
			messageType: messageType,
		}

		const content = parseContent(ctx, messageType, payload)
		if (content !== undefined) {
			m.content = content
		}

		if (messageType === 'ninchat.com/text') {
			ctx.bot.emit('messages', this.channelId, [content])
		}

		ctx.bot.emit('receive', this.channelId, [m])

		this.seenMessageIds.add(messageId)

		if (messageId > this.latestMessageId) {
			this.latestMessageId = messageId
		}
	}

	loadHistory(ctx) {
		const promise = ctx.sendAction({
			action:         'load_history',
			channel_id:     this.channelId,
			message_id:     this.latestMessageId,
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
				let texts = []
				let typed = []

				ids.forEach(id => {
					finalId = id

					if (!this.seenMessageIds.has(id)) {
						const m = buffer[id]
						if (m === null) {
							// Own message; discard older messages.
							texts.length = 0
							typed.length = 0
						} else {
							if (m.messageType === 'ninchat.com/text') {
								texts.push(m.content)
							}
							typed.push(m)
						}
					}
				})

				if (texts.length > 0) {
					ctx.bot.emit('messages', this.channelId, texts)
				}
				if (typed.length > 0) {
					ctx.bot.emit('receive', this.channelId, typed)
				}

				ids.forEach(id => this.seenMessageIds.add(id))

				if (finalId > this.latestMessageId) {
					this.latestMessageId = finalId
				}
			}
		}

		const onMessage = (params, payload) => {
			if (params.event !== 'message_received') {
				return
			}

			if (params.message_user_id === ctx.userId) {
				buffer[params.message_id] = null // Marker
			} else {
				const m = {
					messageType: params.message_type,
				}

				const content = parseContent(ctx, params.message_type, payload)
				if (content !== undefined) {
					m.content = content
				}

				buffer[params.message_id] = m
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

	sendMessage(ctx, content, messageType, messageRecipientIds) {
		if (messageType === undefined) {
			messageType = 'ninchat.com/text'
		}

		const params = {
			action:       'send_message',
			channel_id:   this.channelId,
			message_type: messageType,
		}

		if (messageRecipientIds !== undefined && messageRecipientIds !== null) {
			params.message_recipient_ids = messageRecipientIds
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
	constructor(bot, antics, session, userId, debug, verbose) {
		this.bot = bot
		this.antics = antics
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

		return new ActionPromise(this.antics, params.action, this.session.send(params, payload))
	}
}

class ActionPromise {
	constructor(antics, name, clientPromise) {
		this.antics = antics
		this.time = new Date().getTime()
		this.name = name

		this.onSuccess = () => {}
		this.onError = () => {}
		this.onUpdate = () => {}

		clientPromise.then(
			(header, payload) => {
				this.handleAntics(header, false)
				this.onSuccess(header, payload)
			},
			(header) => {
				this.handleAntics(header, true)
				this.onError(header)
			},
			(header, payload) => {
				this.onUpdate(header, payload)
			},
		)
	}

	then(onSuccess, onError, onUpdate) {
		if (onSuccess) { this.onSuccess = onSuccess }
		if (onError)   { this.onError = onError     }
		if (onUpdate)  { this.onUpdate = onUpdate   }
	}

	handleAntics(eventHeader, fail)  {
		const ant = {
			t: (new Date().getTime() - this.time) / 1000.0,
			a: this.name,
			i: eventHeader.action_id,
		}
		if (fail) {
			ant.fail = true
		}
		this.antics.send(ant)
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

eventHandlers.error = (ctx, params) => {
	console.log('Error:', params)
}

eventHandlers.session_created = (ctx, params) => {
	const audienceChannels = {}

	Object.keys(params.user_channels).forEach(channelId => {
		const info = params.user_channels[channelId]

		if ('audience_id' in info.channel_attrs) {
			if (info.channel_attrs.closed || info.channel_attrs.suspended) {
				ctx.sendAction({action: 'part_channel', channel_id: channelId})
			} else {
				let a = ctx.audienceChannels[channelId]
				if (a === undefined) {
					a = new ChannelAudience(channelId, info.channel_attrs.queue_id, info.channel_attrs.audience_id)
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
		const a = new ChannelAudience(params.channel_id, params.channel_attrs.queue_id, params.channel_attrs.audience_id)
		ctx.audienceChannels[params.channel_id] = a
		a.audienceBegun(ctx, params.audience_metadata)
	}
}

eventHandlers.channel_updated = (ctx, params) => {
	if (params.channel_attrs.closed || params.channel_attrs.suspended) {
		if ('audience_id' in params.channel_attrs) {
			ctx.sendAction({action: 'part_channel', channel_id: params.channel_id})
		}

		const a = ctx.audienceChannels[params.channel_id]
		if (a !== undefined) {
			delete ctx.audienceChannels[params.channel_id]
			a.audienceEnded(ctx)
		}
	}
}

eventHandlers.message_received = (ctx, params, payload) => {
	if (params.message_user_id === ctx.userId) {
		return
	}

	const channelId = params.channel_id
	if (channelId === undefined) {
		return
	}

	const a = ctx.audienceChannels[channelId]
	if (a === undefined) {
		return
	}

	a.messageReceived(ctx, params.message_id, params.message_type, payload)
}

exports.Bot = class extends events.EventEmitter {
	constructor({identity, messageTypes, debugMessages, verboseLogging, anticsHost, headers}) {
		super()

		if (messageTypes === undefined || messageTypes === null) {
			messageTypes = ['ninchat.com/text']
		}

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

		const antics = new AnticsClientInstance(anticsHost, identity).newSessionContext()

		this.session = ninchatClient.newSession()
		this.session.setHeader('User-Agent', headers['User-Agent'] || defaultUserAgent)

		let createStarted = new Date().getTime()

		const handleSessionEvent = params => {
			try {
				let antAct = null

				if (createStarted !== null) {
					antAct = {
						t: (new Date().getTime() - createStarted) / 1000.0,
						a: 'create_session',
					}
					createStarted = null
				} else {
					const antExc = {
						w: 'session_lost',
					}
					if (params.event !== 'session_created') {
						antExc.fail = true
					}
					antics.send(antExc)
				}

				if (params.event == 'error') {
					console.log('Bot session error:', params)
					this.session.close()

					if (antAct) {
						antAct.fail = true
						antics.send(antAct)
					}
					antics.flush()

					this.emit('error', params)
				} else {
					if (this.ctx === null) {
						this.ctx = new Context(this, antics, this.session, params.user_id, debugMessages, verboseLogging)
					}

					handleEvent(params)

					if (antAct) {
						antics.send(antAct)
					}
				}
			} catch (e) {
				console.log('Event handler:', e)
			}
		}

		const handleEvent = (params, payload) => {
			try {
				if (verboseLogging) {
					console.log('Event: ' + params.event + ':', params)
				}

				const f = eventHandlers[params.event]
				if (f !== undefined) {
					f(this.ctx, params, payload)
				}
			} catch (e) {
				console.log('Event handler:', e)
			}
		}

		const handleClose = () => {
			if (verboseLogging) {
				console.log('Session closed')
			}

			this.emit('closed')
		}

		let oldConnState = null
		let connStarted = null

		const handleConnState = state => {
			if (state == oldConnState) {
				return
			}

			if (oldConnState == 'connected') {
				antics.send({
					w: 'disconnected',
				})
			}

			switch (state) {
			case 'connecting':
				connStarted = new Date().getTime()
				break

			case 'connected':
				antics.send({
					w: 'conn',
					t: (new Date().getTime() - connStarted) / 1000.0,
				})
				break

			case 'disconnected':
				if (oldConnState == 'connecting') {
					antics.send({
						w:    'conn',
						t:    (new Date().getTime() - connStarted) / 1000.0,
						fail: true,
					})
					connStarted = null
				}
				break
			}

			oldConnState = state
		}

		let handleClientLog = null

		if (verboseLogging) {
			handleClientLog = msg => {
				console.log('NinchatClient:', msg)
			}
		}

		this.session.setParams(params)
		this.session.onSessionEvent(handleSessionEvent)
		this.session.onEvent(handleEvent)
		this.session.onClose(handleClose)
		this.session.onConnState(handleConnState)
		this.session.onLog(handleClientLog)
		this.session.open()
	}

	close() {
		this.session.close()
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
