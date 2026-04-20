import { describe, expect, it } from "vitest"
import { resolveSocketIoUrl, toDocumentEndpointUrl } from "./crdt-utils"

describe("resolveSocketIoUrl", () => {
  it("keeps http URL and strips path to origin", () => {
    expect(resolveSocketIoUrl("http://localhost:3000/socket.io/")).toBe(
      "http://localhost:3000",
    )
  })

  it("converts ws URL to http origin", () => {
    expect(resolveSocketIoUrl("ws://localhost:3000/ws")).toBe(
      "http://localhost:3000",
    )
  })

  it("converts wss URL to https origin", () => {
    expect(resolveSocketIoUrl("wss://example.com/socket?room=demo")).toBe(
      "https://example.com",
    )
  })
})

describe("toDocumentEndpointUrl", () => {
  it("builds /document endpoint from socket origin", () => {
    expect(toDocumentEndpointUrl("http://localhost:3000")).toBe(
      "http://localhost:3000/document",
    )
  })
})
