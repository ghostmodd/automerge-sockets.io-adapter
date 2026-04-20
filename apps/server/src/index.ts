import { serve } from "@hono/node-server"
import { Repo } from "@automerge/automerge-repo"
import { SocketIOServerAdapter } from "automerge-sockets-io-adapter"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { Server as SocketIOServer } from "socket.io"
import { resolvePort } from "./port.js"

type PingEvent = {
  id: string
  by: string
  at: string
}

type SharedState = {
  events: PingEvent[]
}

const app = new Hono()
const port = resolvePort(process.env.PORT)
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173"

app.use("*", cors({ origin: clientOrigin }))

app.get("/", (c) =>
  c.text("Hono + Socket.IO + Automerge Repo server is running"),
)
app.get("/health", (c) => c.json({ ok: true }))

const httpServer = serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Server listening on http://localhost:${info.port}`)
  },
)

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: clientOrigin,
    methods: ["GET", "POST"],
  },
})
const repo = new Repo({
  network: [new SocketIOServerAdapter(io)],
})

const sharedHandle = repo.create<SharedState>({
  events: [],
})
const sharedDocumentId = sharedHandle.documentId

app.get("/document", (c) =>
  c.json({
    documentId: sharedDocumentId,
    serverPeerId: repo.peerId,
  }),
)
