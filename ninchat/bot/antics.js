/*
 * Copyright (c) 2019, Somia Reality Oy
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

const crypto = require('crypto')
const https = require('https')

const DEFAULT_HOST = 'antics.ninchat.com'
const TIMEOUT = 30 * 1000
const MAX_CONTENT_LENGTH = 1024 * 1024
const MAX_DELAY_INCREMENT = 5 * 1000
const MAX_DELAY_FACTOR = 32

exports.ClientInstance = class {
	constructor(host, identity) {
		if (!host) {
			host = DEFAULT_HOST
		}
		this.host = host

		this.query = ''
		if (identity && 'name' in identity) {
			this.query = '?p=' + encodeURIComponent(identity.name)
		}

		const array = new Uint8Array(8) // 64 bits
		crypto.randomFillSync(array, 1)  // 56 random bits
		const view = new DataView(array.buffer)
		this.instanceId = (view.getUint32(0) * (1<<32)) + view.getUint32(4) // 56-bit number

		this.sessionIndex = 0
	}

	newSessionContext() {
		this.sessionIndex++
		return new SessionContext(this.host, '/' + this.instanceId + '/' + this.sessionIndex + this.query)
	}
}

class SessionContext {
	constructor(host, path) {
		this.host = host
		this.path = path
		this.sendId = null
		this.sending = false
		this.delayFactor = 1
		this.buffer = []
		this.bufferSize = 0
	}

	doSend() {
		this.sendId = null
		this.sending = true

		const sendCount = this.buffer.length
		const content = '[' + this.buffer.join(',') + ']'

		const req = https.request({
			host: this.host,
			path: this.path,
			method: 'POST',
			headers: {
				'Content-Length': content.length,
				'Content-Type': 'application/json',
			},
			timeout: TIMEOUT,
		}, res => {
			this.delayFactor = 1
			this.buffer = this.buffer.slice(sendCount)
			this.bufferSize = 0
			for (var i in this.buffer) {
				this.bufferSize += 1 + this.buffer[i].length
			}
		})

		req.on('error', () => {
			this.delayFactor *= 2
			if (this.delayFactor > MAX_DELAY_FACTOR) {
				this.delayFactor = MAX_DELAY_FACTOR
			}
		})

		req.on('close', () => {
			this.sending = false
			if (this.buffer.length > 0) {
				this.sendId = setTimeout(() => this.doSend(), Math.random() * this.delayFactor * MAX_DELAY_INCREMENT)
			}
		})

		req.write(content)
		req.end()
	}

	send(entry) {
		entry['@'] = Math.floor(new Date().getTime() / 1000)

		var jsonEntry = JSON.stringify(entry)
		var newSize = this.bufferSize + 1 + jsonEntry.length

		if (newSize + 1 <= MAX_CONTENT_LENGTH) {
			this.buffer.push(jsonEntry)
			this.bufferSize = newSize

			if (!this.sendId && !this.sending) {
				this.sendId = setTimeout(() => this.doSend(), Math.random() * MAX_DELAY_INCREMENT)
			}
		}
	}

	flush() {
		if (this.buffer.length > 0 && !this.sending) {
			if (this.sendId) {
				clearTimeout(this.sendId)
				this.sendId = null
			}

			this.doSend()
		}
	}
}
