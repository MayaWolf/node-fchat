# node-fchat
Node.js (and web) library for connecting to F-Chat

It is intended as an abstraction of the basic features for any FChat tool, including connections, and interacting with characters and channels.

## Installation
`yarn add fchat`

## Usage
`import * as fchat from 'fchat';`

Look at the `interfaces` for further information.

## Modules
* **Connection** - Provides a general implementation of a connection to FChat. Requires an implementation of the `WebSocketConnection` interface as a parameter to allow you to choose a WebSocket library yourself.
* **Characters** - Keeps track of the characters that are online, and their relation to the connected character.
* **Channels** - Keeps track of the global channel lists, and the channels the connected character is currently in.
