<script lang="ts">
  import { onMount } from 'svelte'
  import { io, type Socket } from 'socket.io-client'

  const socketUrl = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3000'
  let socket: Socket | null = null

  let status = 'connecting'
  let totalPings = 0
  let clicks = 0
  let messages: string[] = []

  const sendPing = () => {
    if (!socket) return
    clicks += 1
    socket.emit('ping', { count: clicks })
  }

  onMount(() => {
    socket = io(socketUrl)

    socket.on('connect', () => {
      status = 'connected'
    })

    socket.on('disconnect', () => {
      status = 'disconnected'
    })

    socket.on('server:message', (message: string) => {
      messages = [message, ...messages].slice(0, 6)
    })

    socket.on('pong', (payload: { totalPings: number; at: string }) => {
      totalPings = payload.totalPings
      messages = [`Pong: ${payload.totalPings} (${payload.at})`, ...messages].slice(0, 6)
    })

    return () => {
      socket?.disconnect()
      socket = null
    }
  })
</script>

<main
  class="min-h-screen bg-[radial-gradient(circle_at_top,_#0f172a_0,_#020617_60%)] text-slate-100 px-4 py-8 md:px-8"
>
  <div class="mx-auto w-full max-w-3xl rounded-2xl border border-slate-700/70 bg-slate-900/70 p-6 shadow-2xl backdrop-blur">
    <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">Automerge + Socket.IO Playground</h1>
    <p class="mt-2 text-sm text-slate-300">
      Client: Svelte 5 + TS + Tailwind | Server: Hono + Socket.IO
    </p>

    <div class="mt-6 grid gap-4 rounded-xl border border-slate-700 bg-slate-950/70 p-4 md:grid-cols-2">
      <div>
        <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Socket status</p>
        <p class="mt-2 text-lg font-medium text-emerald-300">{status}</p>
      </div>
      <div>
        <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Total pings (server doc)</p>
        <p class="mt-2 text-lg font-medium text-cyan-300">{totalPings}</p>
      </div>
    </div>

    <button
      class="mt-6 rounded-xl bg-cyan-500 px-4 py-2 font-medium text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
      on:click={sendPing}
      disabled={status !== 'connected'}
    >
      Send ping (local clicks: {clicks})
    </button>

    <div class="mt-6 rounded-xl border border-slate-700 bg-slate-950/70 p-4">
      <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Events</p>
      <ul class="mt-2 space-y-2 text-sm text-slate-200">
        {#each messages as item}
          <li class="rounded-md bg-slate-800/70 px-3 py-2">{item}</li>
        {/each}
      </ul>
    </div>
  </div>
</main>
