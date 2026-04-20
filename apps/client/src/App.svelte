<script lang="ts">
  import { onMount } from "svelte"
  import {
    Automerge,
    Repo,
    initializeBase64Wasm,
    isValidDocumentId,
    type DocHandle,
    type DocumentId,
  } from "@automerge/automerge-repo/slim"
  import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64"
  import { SocketIOClientAdapter } from "automerge-sockets-io-adapter"
  import { resolveSocketIoUrl, toDocumentEndpointUrl } from "./crdt-utils"

  type PingEvent = {
    id: string
    by: string
    at: string
  }

  type SharedState = {
    events: PingEvent[]
  }

  const peerLabel = `peer-${crypto.randomUUID().slice(0, 8)}`
  const socketIoUrl = resolveSocketIoUrl(
    import.meta.env.VITE_SOCKET_IO_URL ?? "http://localhost:3000",
    window.location.origin,
  )

  let repo: Repo | null = null
  let adapter: SocketIOClientAdapter | null = null
  let handle: DocHandle<SharedState> | null = null

  let status = "connecting"
  let localPeerId = "-"
  let serverPeerId = "-"
  let documentId = "-"
  let clicks = 0
  let messages: string[] = []
  let sharedState: SharedState | null = null
  let forcePollingOnly = false
  let reconnecting = false
  let disposed = false
  let activeConnectToken = 0

  $: totalPings = sharedState?.events.length ?? 0
  $: recentEvents = sharedState?.events.slice(0, 8) ?? []

  const appendMessage = (text: string) => {
    messages = [text, ...messages].slice(0, 6)
  }

  const refreshSharedState = () => {
    if (!handle || !handle.isReady()) return
    sharedState = handle.doc()
  }

  const resolveDocumentId = async (): Promise<DocumentId> => {
    const fromEnv = import.meta.env.VITE_DOCUMENT_ID
    if (typeof fromEnv === "string" && fromEnv.length > 0) {
      if (!isValidDocumentId(fromEnv)) {
        throw new Error(`VITE_DOCUMENT_ID is not a valid document id: ${fromEnv}`)
      }
      return fromEnv
    }

    const endpoint = toDocumentEndpointUrl(socketIoUrl)
    const response = await fetch(endpoint)
    if (!response.ok) {
      throw new Error(`Failed to fetch shared document id: ${response.status}`)
    }

    const payload = (await response.json()) as {
      documentId?: unknown
      serverPeerId?: unknown
    }

    if (typeof payload.serverPeerId === "string" && payload.serverPeerId.length > 0) {
      serverPeerId = payload.serverPeerId
    }

    if (!isValidDocumentId(payload.documentId)) {
      throw new Error("Server response has no documentId")
    }
    return payload.documentId
  }

  const sendPing = () => {
    if (!handle) return

    clicks += 1
    handle.change((draft) => {
      draft.events.unshift({
        id: `${peerLabel}:${clicks}:${crypto.randomUUID()}`,
        by: peerLabel,
        at: new Date().toISOString(),
      })
    })
    appendMessage(`Local change #${clicks} created`)
  }

  const onHandleChange = () => {
    refreshSharedState()
    appendMessage("Remote change merged")
  }

  const isStaleConnection = (token: number): boolean =>
    disposed || token !== activeConnectToken

  const disconnectCurrentSession = async () => {
    handle?.off("change", onHandleChange)
    await repo?.shutdown()
    handle = null
    repo = null
    adapter = null
    localPeerId = "-"
    serverPeerId = "-"
    sharedState = null
  }

  const connectToRepo = async () => {
    const token = ++activeConnectToken
    status = "connecting"
    await disconnectCurrentSession()
    if (isStaleConnection(token)) return

    try {
      if (!Automerge.isWasmInitialized()) {
        await initializeBase64Wasm(automergeWasmBase64)
      }
      if (isStaleConnection(token)) return

      const nextAdapter = new SocketIOClientAdapter(socketIoUrl, {
        socketOptions: forcePollingOnly
          ? {
              transports: ["polling"],
            }
          : undefined,
      })
      nextAdapter.on("peer-candidate", ({ peerId }) => {
        if (isStaleConnection(token)) return
        serverPeerId = peerId
        status = "connected"
        appendMessage(`Connected to ${peerId}`)
      })
      nextAdapter.on("peer-disconnected", ({ peerId }) => {
        if (isStaleConnection(token)) return
        if (serverPeerId === peerId) {
          status = "disconnected"
        }
        appendMessage(`Disconnected from ${peerId}`)
      })

      const nextRepo = new Repo({
        network: [nextAdapter],
      })
      if (isStaleConnection(token)) {
        await nextRepo.shutdown()
        return
      }

      localPeerId = nextRepo.peerId
      const resolvedDocumentId = await resolveDocumentId()
      if (isStaleConnection(token)) {
        await nextRepo.shutdown()
        return
      }

      documentId = resolvedDocumentId
      const nextHandle = await nextRepo.find<SharedState>(resolvedDocumentId)
      await nextHandle.whenReady()
      if (isStaleConnection(token)) {
        await nextRepo.shutdown()
        return
      }

      repo = nextRepo
      adapter = nextAdapter
      handle = nextHandle
      handle.on("change", onHandleChange)
      refreshSharedState()
      appendMessage(`Joined shared document ${documentId.slice(0, 16)}...`)
    } catch (error: unknown) {
      if (isStaleConnection(token)) return
      console.error(error)
      appendMessage("Failed to connect to Repo")
      status = "disconnected"
    }
  }

  const reconnect = async () => {
    reconnecting = true
    try {
      await connectToRepo()
    } finally {
      reconnecting = false
    }
  }

  const toggleWebSocket = async () => {
    forcePollingOnly = !forcePollingOnly
    appendMessage(
      forcePollingOnly
        ? "WebSocket disabled on client. Reconnecting with long polling only"
        : "WebSocket enabled on client. Reconnecting with default transports",
    )
    await reconnect()
  }

  onMount(() => {
    disposed = false
    void reconnect()

    return () => {
      disposed = true
      activeConnectToken += 1
      void disconnectCurrentSession()
    }
  })
</script>

<main
  class="min-h-screen bg-[radial-gradient(circle_at_top,_#0f172a_0,_#020617_60%)] text-slate-100 px-4 py-8 md:px-8"
>
  <div class="mx-auto w-full max-w-3xl rounded-2xl border border-slate-700/70 bg-slate-900/70 p-6 shadow-2xl backdrop-blur">
    <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">Automerge Repo + Socket.IO Playground</h1>
    <p class="mt-2 text-sm text-slate-300">
      Client: Svelte 5 + Repo | Network: custom Socket.IO adapter
    </p>

    <div class="mt-6 grid gap-4 rounded-xl border border-slate-700 bg-slate-950/70 p-4 md:grid-cols-2">
      <div>
        <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Connection status</p>
        <p class="mt-2 text-lg font-medium text-emerald-300">{status}</p>
      </div>
      <div>
        <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Total CRDT events</p>
        <p class="mt-2 text-lg font-medium text-cyan-300">{totalPings}</p>
      </div>
    </div>

    <p class="mt-3 text-xs text-slate-400">
      Local peer: {localPeerId} | Remote peer: {serverPeerId}
    </p>
    <p class="mt-1 text-xs text-slate-400">Document: {documentId}</p>
    <p class="mt-1 text-xs text-slate-400">
      Transport mode: {forcePollingOnly
        ? "long polling only (WebSocket disabled)"
        : "default (WebSocket enabled)"}
    </p>

    <div class="mt-6 flex flex-wrap gap-3">
      <button
        class="rounded-xl bg-amber-400 px-4 py-2 font-medium text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
        on:click={toggleWebSocket}
        disabled={reconnecting}
      >
        {forcePollingOnly
          ? "Enable WebSocket (default transports)"
          : "Disable WebSocket (force long polling)"}
      </button>

      <button
        class="rounded-xl bg-cyan-500 px-4 py-2 font-medium text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
        on:click={sendPing}
        disabled={status !== "connected" || reconnecting}
      >
        Add local CRDT event (local clicks: {clicks})
      </button>
    </div>

    <div class="mt-6 grid gap-4 md:grid-cols-2">
      <div class="rounded-xl border border-slate-700 bg-slate-950/70 p-4">
        <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Merged events</p>
        <ul class="mt-2 space-y-2 text-sm text-slate-200">
          {#each recentEvents as event}
            <li class="rounded-md bg-slate-800/70 px-3 py-2">
              {event.by} at {event.at}
            </li>
          {/each}
        </ul>
      </div>

      <div class="rounded-xl border border-slate-700 bg-slate-950/70 p-4">
        <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Sync log</p>
        <ul class="mt-2 space-y-2 text-sm text-slate-200">
          {#each messages as item}
            <li class="rounded-md bg-slate-800/70 px-3 py-2">{item}</li>
          {/each}
        </ul>
      </div>
    </div>
  </div>
</main>
