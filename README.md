# automerge-sockets-io-adapter

Socket.IO network adapter for [Automerge Repo](https://automerge.org/).

This package exposes client and server adapters that let Automerge Repo peers
sync through a Socket.IO connection.

## Installation

```sh
npm install automerge-sockets-io-adapter@beta
```

## Usage

### Client

```ts
import { Repo } from "@automerge/automerge-repo"
import { SocketIOClientAdapter } from "automerge-sockets-io-adapter"

const repo = new Repo({
  network: [new SocketIOClientAdapter("http://localhost:3000")],
})
```

### Server

```ts
import { Repo } from "@automerge/automerge-repo"
import { Server } from "socket.io"
import { SocketIOServerAdapter } from "automerge-sockets-io-adapter"

const io = new Server(httpServer, {
  cors: { origin: "*" },
})

const repo = new Repo({
  network: [new SocketIOServerAdapter(io)],
})
```

## API

- `SocketIOClientAdapter`
- `SocketIOServerAdapter`
- `WebSocketClientAdapter` alias
- `WebSocketServerAdapter` alias

## License

MIT
