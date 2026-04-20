import {
  NetworkAdapter,
  PeerId,
  PeerMetadata,
  cbor,
} from "@automerge/automerge-repo/slim"

import debug from "debug"

import {
  FromClientMessage,
  FromServerMessage,
  JoinMessage,
  hasMessageTypeAndSenderId,
  isErrorMessage,
  isPeerMessage,
} from "./messages.js"
import { ProtocolV1 } from "./protocolVersion.js"
import { assert } from "./assert.js"
import { toArrayBuffer } from "./toArrayBuffer.js"
import { toUint8ArrayPayload } from "./socketIoPayload.js"
import {
  io,
  type ManagerOptions,
  type Socket,
  type SocketOptions,
} from "socket.io-client"

abstract class WebSocketNetworkAdapter extends NetworkAdapter {
  socket?: Socket
}

export type SocketIOClientAdapterOptions = {
  retryInterval?: number
  socketOptions?: Partial<ManagerOptions & SocketOptions>
}

export class SocketIOClientAdapter extends WebSocketNetworkAdapter {
  #ready = false
  #readyResolver?: () => void
  #readyPromise: Promise<void> = new Promise<void>((resolve) => {
    this.#readyResolver = resolve
  })

  isReady() {
    return this.#ready
  }

  whenReady() {
    return this.#readyPromise
  }

  #forceReady() {
    if (!this.#ready) {
      this.#ready = true
      this.#readyResolver?.()
    }
  }

  #retryIntervalId?: TimeoutId
  #log = debug("automerge-repo:socketio:browser")

  remotePeerId?: PeerId // this adapter only connects to one remote client at a time
  public readonly retryInterval: number
  public readonly socketOptions?: Partial<ManagerOptions & SocketOptions>

  constructor(
    public readonly url: string,
    retryIntervalOrOptions: number | SocketIOClientAdapterOptions = 5000,
  ) {
    super()
    this.#log = this.#log.extend(url)
    if (typeof retryIntervalOrOptions === "number") {
      this.retryInterval = retryIntervalOrOptions
    } else {
      this.retryInterval = retryIntervalOrOptions.retryInterval ?? 5000
      this.socketOptions = retryIntervalOrOptions.socketOptions
    }
  }

  connect(peerId: PeerId, peerMetadata?: PeerMetadata) {
    if (!this.socket || !this.peerId) {
      // first time connecting
      this.#log("connecting")
      this.peerId = peerId
      this.peerMetadata = peerMetadata ?? {}
    } else {
      this.#log("reconnecting")
      assert(peerId === this.peerId)
      // Remove the old event listeners before creating a new connection.
      this.socket.removeListener("connect", this.onConnect)
      this.socket.removeListener("disconnect", this.onDisconnect)
      this.socket.removeListener("message", this.onMessage)
      this.socket.removeListener("connect_error", this.onConnectError)
      this.socket.disconnect()
    }
    // Wire up retries
    if (!this.#retryIntervalId)
      this.#retryIntervalId = setInterval(() => {
        this.connect(peerId, peerMetadata)
      }, this.retryInterval)

    this.socket = io(this.url, this.socketOptions)

    this.socket.on("connect", this.onConnect)
    this.socket.on("disconnect", this.onDisconnect)
    this.socket.on("message", this.onMessage)
    this.socket.on("connect_error", this.onConnectError)

    // Mark this adapter as ready if we haven't received an ack in 1 second.
    // We might hear back from the other end at some point but we shouldn't
    // hold up marking things as unavailable for any longer
    setTimeout(() => this.#forceReady(), 1000)
    this.join()
  }

  onConnect = () => {
    this.#log("connect")
    clearInterval(this.#retryIntervalId)
    this.#retryIntervalId = undefined
    this.join()
  }

  // When a socket closes, or disconnects, remove it from the array.
  onDisconnect = () => {
    this.#log("disconnect")
    if (this.remotePeerId)
      this.emit("peer-disconnected", { peerId: this.remotePeerId })

    if (this.retryInterval > 0 && !this.#retryIntervalId)
      // try to reconnect
      setTimeout(() => {
        assert(this.peerId)
        return this.connect(this.peerId, this.peerMetadata)
      }, this.retryInterval)
  }

  onMessage = (payload: unknown) => {
    const messageBytes = toUint8ArrayPayload(payload)
    if (!messageBytes) {
      this.#log("dropping invalid socket payload")
      return
    }

    this.receiveMessage(messageBytes)
  }

  onConnectError = (error: unknown) => {
    this.#log("connect_error", error)
    this.#log("Connection failed, retrying...")
  }

  join() {
    assert(this.peerId)
    assert(this.socket)
    if (this.socket.connected) {
      this.send(joinMessage(this.peerId!, this.peerMetadata!))
    } else {
      // We'll try again in the `onConnect` handler
    }
  }

  disconnect() {
    assert(this.peerId)
    assert(this.socket)
    const socket = this.socket
    if (socket) {
      socket.removeListener("connect", this.onConnect)
      socket.removeListener("disconnect", this.onDisconnect)
      socket.removeListener("message", this.onMessage)
      socket.removeListener("connect_error", this.onConnectError)
      socket.disconnect()
    }
    clearInterval(this.#retryIntervalId)
    if (this.remotePeerId)
      this.emit("peer-disconnected", { peerId: this.remotePeerId })
    this.socket = undefined
  }

  send(message: FromClientMessage) {
    if ("data" in message && message.data?.byteLength === 0)
      throw new Error("Tried to send a zero-length message")
    assert(this.peerId)
    if (!this.socket) {
      this.#log("Tried to send on a disconnected socket.")
      return
    }
    if (!this.socket.connected) throw new Error(`Websocket not ready`)

    const encoded = cbor.encode(message)
    this.socket.send(toArrayBuffer(encoded))
  }

  peerCandidate(remotePeerId: PeerId, peerMetadata: PeerMetadata) {
    assert(this.socket)
    this.#forceReady()
    this.remotePeerId = remotePeerId
    this.emit("peer-candidate", {
      peerId: remotePeerId,
      peerMetadata,
    })
  }

  receiveMessage(messageBytes: Uint8Array) {
    let decoded: unknown
    try {
      decoded = cbor.decode(new Uint8Array(messageBytes))
    } catch (e) {
      this.#log("error decoding message:", e)
      return
    }

    assert(this.socket)
    if (messageBytes.byteLength === 0)
      throw new Error("received a zero-length message")

    if (!hasMessageTypeAndSenderId(decoded)) {
      this.#log("dropping decoded message with invalid envelope")
      return
    }

    const message = decoded as FromServerMessage

    if (isPeerMessage(message)) {
      const { peerMetadata } = message
      this.#log(`peer: ${message.senderId}`)
      this.peerCandidate(message.senderId, peerMetadata)
    } else if (isErrorMessage(message)) {
      this.#log(`error: ${message.message}`)
    } else {
      this.emit("message", message)
    }
  }
}

function joinMessage(
  senderId: PeerId,
  peerMetadata: PeerMetadata,
): JoinMessage {
  return {
    type: "join",
    senderId,
    peerMetadata,
    supportedProtocolVersions: [ProtocolV1],
  }
}

type TimeoutId = ReturnType<typeof setTimeout> //  https://stackoverflow.com/questions/45802988

export { SocketIOClientAdapter as WebSocketClientAdapter }
