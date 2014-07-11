var master = require('./ninchat').master;

var masterKeyId = '22nlihvg';
var masterKeySecret = 'C58sAn+Dp2Ogb2+FdfSNg3J0ImMYfYodUUgXFF2OPo0=';
var expire = Date.now() / 1000 + 60;
var userId = '22ouqqbp';
var channelId = '1bfbr0u';
var memberAttrs = [
	['silenced', false],
];
var metadata = {
	foo: 3.14159,
	bar: 'asdf',
	baz: [1, 2, 3],
	quux: {
		a: 100,
		b: 200,
	},
};

function dump(str) {
	console.log();
	console.log('Size: ' + str.length);
	console.log('Data: ' + str);
}

dump(master.signCreateSession(masterKeyId, masterKeySecret, expire));
dump(master.signCreateSessionForUser(masterKeyId, masterKeySecret, expire, userId));
dump(master.signJoinChannel(masterKeyId, masterKeySecret, expire, channelId));
dump(master.signJoinChannel(masterKeyId, masterKeySecret, expire, channelId, memberAttrs));
dump(master.signJoinChannelForUser(masterKeyId, masterKeySecret, expire, channelId, userId));
dump(master.signJoinChannelForUser(masterKeyId, masterKeySecret, expire, channelId, userId, memberAttrs));

dump(master.secureMetadata(masterKeyId, masterKeySecret, expire, metadata));
dump(master.secureMetadataForUser(masterKeyId, masterKeySecret, expire, metadata, userId));
