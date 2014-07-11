/*
 * Copyright (c) 2013-2014, Somia Reality Oy
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

var crypto = require('crypto');

exports.signCreateSession = function(keyId, keySecret, expire) {
	var msg = [
		['action', 'create_session'],
	];

	return sign(keyId, keySecret, expire, msg);
};

exports.signCreateSessionForUser = function(keyId, keySecret, expire, userId) {
	var msg = [
		['action', 'create_session'],
		['user_id', userId],
	];

	return sign(keyId, keySecret, expire, msg);
};

exports.signJoinChannel = function(keyId, keySecret, expire, channelId, memberAttrs) {
	return signJoinChannel(keyId, keySecret, expire, channelId, memberAttrs, []);
};

exports.signJoinChannelForUser = function(keyId, keySecret, expire, channelId, userId, memberAttrs) {
	var msg = [
		['user_id', userId],
	];

	return signJoinChannel(keyId, keySecret, expire, channelId, memberAttrs, msg) + '-1';
};

function signJoinChannel(keyId, keySecret, expire, channelId, memberAttrs, msg) {
	msg.push(['action', 'join_channel']);
	msg.push(['channel_id', channelId]);

	if (memberAttrs && memberAttrs.length > 0) {
		memberAttrs.sort();
		msg.push(['member_attrs', memberAttrs]);
	}

	return sign(keyId, keySecret, expire, msg);
};

function sign(keyId, keySecret, expire, msg) {
	expire = Math.floor(expire);
	var nonce = crypto.pseudoRandomBytes(6).toString('base64');

	msg.push(['expire', expire]);
	msg.push(['nonce', nonce]);
	msg.sort();

	var msgJson = JSON.stringify(msg);

	var hmac = crypto.createHmac('SHA512', new Buffer(keySecret, 'base64'));
	hmac.update(msgJson);
	var digestBase64 = hmac.digest('base64');

	return keyId + '-' + expire + '-' + nonce + '-' + digestBase64;
};

exports.secureMetadata = function(keyId, keySecret, expire, metadata) {
	return secureMetadata(keyId, keySecret, expire, metadata, {});
};

exports.secureMetadataForUser = function(keyId, keySecret, expire, metadata, userId) {
	var msg = {
		user_id: userId,
	};

	return secureMetadata(keyId, keySecret, expire, metadata, msg);
};

function secureMetadata(keyId, keySecret, expire, metadata, msg) {
	msg.expire = expire;
	msg.metadata = metadata;

	var msgJson = new Buffer(JSON.stringify(msg), 'utf8');

	var hash = crypto.createHash('SHA512');
	hash.end(msgJson);
	var digest = hash.read();

	var blockSize = 16;
	var blockMask = blockSize - 1;

	var hashedSize = digest.length + msgJson.length;
	var paddedSize = (hashedSize + blockMask) & ~blockMask;

	var msgPadded = new Buffer(paddedSize);
	digest.copy(msgPadded);
	msgJson.copy(msgPadded, digest.length);
	msgPadded.fill(0, hashedSize);

	var iv = crypto.randomBytes(blockSize);

	var cipher = crypto.createCipheriv('AES-256-CBC', new Buffer(keySecret, 'base64'), iv);
	cipher.setAutoPadding(false);
	cipher.end(msgPadded);
	var msgEncrypted = cipher.read();

	var msgIv = Buffer.concat([iv, msgEncrypted]);
	var msgBase64 = msgIv.toString('base64');

	return keyId + '-' + msgBase64;
};
