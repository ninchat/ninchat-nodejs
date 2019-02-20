# Ninchat bot framework for Node.js


### Connect

```js
const ninchatbot = require('ninchat-nodejs/ninchat/bot')
```

Module `ninchat-nodejs/ninchat/bot` contains a simple framework for
implementing chat bots for Ninchat.  The Bot class is used to connect to
Ninchat, listen to events and send messages.

```js
const identity = {type, name, auth}
const messageTypes = ['ninchat.com/text']
const verboseLogging = false

const bot = new ninchatbot.Bot({identity, messageTypes, verboseLogging})
```

A bot is instantiated with an identity object.  It contains authentication
credentials (email and password) of the bot user.

It needs a normal Ninchat user account.  It will automatically serve customers
in the audience queues it belongs to.

The `messageTypes` option lists Ninchat message types which the bot
implementation wants to use.  If the bot sends and receives only text messages,
it can be omitted.  (Specifying an empty array disables all message types.)



### Chat

```js
bot.on('begin', (channelId, queueId, info) => {})
bot.on('messages', (channelId, textMessages) => {})
bot.on('receive', (channelId, typedMessages) => {})
bot.on('end', channelId => {})
```

The `begin` event is emitted whenever a new customer has been accepted.
Channel id is a unique identifier (string) for the chat.  The `end` event is
emitted when the chat ends.  Between them, `messages` and `receive` are emitted
whenever the customer has written something.

A `messages` callback receives text messages as an array of objects.  (Normally
the array contains just one message.)  A text message object contains the
`text` property.

A `receive` callback can be used to receive any supported message type
(including the text messages).  It receives an array of objects which contain
the `messageType` and `content` properties.  Content format depends on the
message type.

Messages may be sent one at a time:

```js
bot.sendMessage(channelId, {text: 'Hello!'}) // Defaults to text message type.
bot.sendMessage(channelId, {text: 'Hello!'}, 'ninchat.com/text')
```


### Info

The third argument passed to the `begin` callback is an object containing
optional information.  The following property might be available:

- `audienceMetadata` is an object containing metadata that was provided via
  [Ninchat embed API](https://github.com/ninchat/ninchat-embed/blob/master/embed2.md#customer-service-audience-embed-specific-options)
  before the chat started.  It includes the `secure` property if one was
  provided; its value has been decrypted.


### Metadata messages

In addition to audience metadata that is received at the start of the chat,
metadata messages may be received during the chat.  In order to do that the
`ninchat.com/metadata` message type must be specified when instantiating Bot,
and the `receive` event must be handled.

The content of a metadata message is an object with the `data` property. See
[Ninchat API reference](https://github.com/ninchat/ninchat-api/blob/v2/api.md#ninchatcommetadata)
for details.


### UI messages

A bot may display widgets which trigger actions when the customer interacts
with them.  The bot sends `ninchat.com/ui/compose` messages and receives
corrseponding `ninchat.com/ui/action` messages.

Composition example:

```js
const content = [
	{element: 'button', id: 'foo-1', label: 'Yes'},
	{element: 'button', id: 'foo-2', label: 'No'},
]

bot.sendMessage(id, content, 'ninchat.com/ui/compose')
```

Remember to specify both message types when instantiating Bot.  See
[Ninchat API reference](https://github.com/ninchat/ninchat-api/blob/v2/api.md#ninchatcomui)
for details.


### Restart

If the bot program is restarted and there are existing, ongoing chats with
customers, the `resume` event is emitted for each one:

```js
bot.on('resume', (channelId, queueId) => {})
```

If the customer had written something while the bot was not running, a
`messages` event will follow the `resume` event.  The messages array might
contain more than one message (in chronological order).


### Transfer

The bot may decide to transfer a customer to a human agent:

```js
bot.transferAudience(channelId, queueId)
```

The current chat will end automatically (the `end` event is emitted), and the
customer will be placed in the specified queue.  The queue must have been
whitelisted as a possible transfer target via Ninchat queue settings UI.

The bot can make its transfer decision based on the state of the target queue
(or queues):

```js
bot.on('queue:closed', (queueId, closed) => {})
```

The `queue:closed` event is emitted whenever a queue is opened or closed.
Events are emitted for queues which the bot uses to serve customers, and queues
which are possible transfer targets.  The `closed` argument is a boolean.


### Example

See [hello-bot](https://github.com/ninchat/hello-bot/tree/nodejs) for an
example implementation.

