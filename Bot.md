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
const debugMessages = false
const verboseLogging = false

const bot = new ninchatbot.Bot({identity, debugMessages, verboseLogging})
```

A bot is instantiated with an identity object.  It contains authentication
credentials (email and password) of the bot user.

It needs a normal Ninchat user account.  It will automatically serve customers
in the audience queues it belongs to.


### Chat

```js
bot.on('begin', (channelId, queueId) => {})
bot.on('messages', (channelId, messages) => {})
bot.on('end', channelId => {})
```

The `begin` event is emitted whenever a new customer has been accepted.
Channel id is a unique identifier (string) for the chat.  The `end` event is
emitted when the chat ends.  Between them, `messages` are emitted whenever the
customer has written something.

Messages are received as an array of objects.  Normally the array contains just
one message.  A message object contains the `text` property.

Messages may be sent one at a time:

```js
bot.sendMessage(channelId, {text: 'Hello!'})
```


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

