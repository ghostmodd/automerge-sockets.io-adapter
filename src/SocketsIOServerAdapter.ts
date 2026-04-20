import debug from "debug"

const log = debug("WebsocketServer")

import {
  cbor as cborHelpers,
  NetworkAdapter,
  type PeerMetadata,
  type PeerId,
} from "@automerge/automerge-repo/slim"
import {
  FromClientMessage,
  FromServerMessage,
  hasMessageTypeAndSenderId,
  isJoinMessage,
} from "./messages.js"
import { ProtocolV1, ProtocolVersion } from "./protocolVersion.js"
import { assert } from "./assert.js"
import { toArrayBuffer } from "./toArrayBuffer.js"
import { toUint8ArrayPayload } from "./socketIoPayload.js"
import { Server, Socket } from "socket.io"

const { encode, decode } = cborHelpers

export class SocketIOServerAdapter extends NetworkAdapter {
  sockets: { [peerId: PeerId]: Socket } = {}

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

  constructor(
    private server: Server,
    private keepAliveInterval = 5000,
  ) {
    super()
  }

  connect(peerId: PeerId, peerMetadata?: PeerMetadata) {
    this.peerId = peerId
    this.peerMetadata = peerMetadata

    this.server.on("close", () => {
      this.disconnect()
    })

    this.server.on("connection", (socket: Socket) => {
      socket.on("message", (payload: unknown) => {
        const messageBytes = toUint8ArrayPayload(payload)
        if (!messageBytes) {
          log("dropping invalid socket payload")
          return
        }

        this.receiveMessage(messageBytes, socket)
      })

      socket.on("disconnect", () => {
        this.#removeSocket(socket)
      })

      this.#forceReady()
    })
  }

  disconnect() {
    const clients = this.server.sockets.sockets
    clients.forEach((socket) => {
      this.#terminate(socket)
    })
  }

  send(message: FromServerMessage) {
    assert("targetId" in message && message.targetId !== undefined)
    if ("data" in message && message.data?.byteLength === 0)
      throw new Error("Tried to send a zero-length message")

    const senderId = this.peerId
    assert(senderId, "No peerId set for the websocket server network adapter.")

    const socket = this.sockets[message.targetId]

    if (!socket) {
      log(`Tried to send to disconnected peer: ${message.targetId}`)
      return
    }

    const encoded = encode(message)
    const arrayBuf = toArrayBuffer(encoded)

    socket.send(arrayBuf)
  }

  receiveMessage(messageBytes: Uint8Array, socket: Socket) {
    let decoded: unknown
    try {
      decoded = decode(messageBytes)
    } catch (e) {
      log("dropping invalid message payload")
      return
    }

    if (!hasMessageTypeAndSenderId(decoded)) {
      log("dropping decoded message with invalid envelope")
      return
    }

    const message = decoded as FromClientMessage
    const { type, senderId } = message

    const myPeerId = this.peerId
    assert(myPeerId)

    const documentId = "documentId" in message ? "@" + message.documentId : ""
    const { byteLength } = messageBytes
    log(`[${senderId}->${myPeerId}${documentId}] ${type} | ${byteLength} bytes`)

    if (isJoinMessage(message)) {
      const { peerMetadata, supportedProtocolVersions } = message
      const existingSocket = this.sockets[senderId]
      if (existingSocket) {
        if (existingSocket.connected) existingSocket.disconnect(true)
        this.emit("peer-disconnected", { peerId: senderId })
      }

      // Let the repo know that we have a new connection.
      this.emit("peer-candidate", { peerId: senderId, peerMetadata })
      this.sockets[senderId] = socket

      const selectedProtocolVersion = selectProtocol(supportedProtocolVersions)
      if (selectedProtocolVersion === null) {
        this.send({
          type: "error",
          senderId: this.peerId!,
          message: "unsupported protocol version",
          targetId: senderId,
        })
        this.sockets[senderId].disconnect(true)
        delete this.sockets[senderId]
      } else {
        this.send({
          type: "peer",
          senderId: this.peerId!,
          peerMetadata: this.peerMetadata!,
          selectedProtocolVersion: ProtocolV1,
          targetId: senderId,
        })
      }
    } else {
      this.emit("message", message)
    }
  }

  #terminate(socket: Socket) {
    this.#removeSocket(socket)
    if (socket.connected) socket.disconnect(true)
  }

  #removeSocket(socket: Socket) {
    const peerId = this.#peerIdBySocket(socket)
    if (!peerId) return
    this.emit("peer-disconnected", { peerId })
    delete this.sockets[peerId as PeerId]
  }

  #peerIdBySocket = (socket: Socket) => {
    const isThisSocket = (peerId: string) =>
      this.sockets[peerId as PeerId] === socket
    const result = Object.keys(this.sockets).find(isThisSocket) as PeerId
    return result ?? null
  }
}

export { SocketIOServerAdapter as WebSocketServerAdapter }

const selectProtocol = (versions?: ProtocolVersion[]) => {
  if (versions === undefined) return ProtocolV1
  if (versions.includes(ProtocolV1)) return ProtocolV1
  return null
}
