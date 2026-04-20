import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { Server as SocketIOServer } from "socket.io"
import * as Automerge from "@automerge/automerge"

type SharedState = {
  pings: number
}

let sharedState = Automerge.from<SharedState>({ pings: 0 })

const app = new Hono()

app.get("/", (c) => c.text("Hono + Socket.IO server is running"))
app.get("/health", (c) => c.json({ ok: true }))

const port = Number(process.env.PORT ?? 3000)

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
    origin: ["http://localhost:5173"],
    methods: ["GET", "POST"],
  },
})

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`)
  socket.emit("server:message", "Socket.IO is connected to Hono server")

  socket.on("ping", (payload: { count?: number }) => {
    sharedState = Automerge.change(sharedState, (doc) => {
      doc.pings += 1
    })

    io.emit("pong", {
      from: socket.id,
      count: payload?.count ?? 0,
      totalPings: sharedState.pings,
      at: new Date().toISOString(),
    })
  })

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`)
  })
})
