import { describe, expect, it } from "vitest"

type SyncPrimitives = {
  bytesToBase64: (bytes: Uint8Array) => string
  base64ToBytes: (base64: string) => Uint8Array
  sameHeads: (left: readonly string[], right: readonly string[]) => boolean
}

export const runSyncPrimitivesContract = (
  name: string,
  primitives: SyncPrimitives,
) => {
  describe(`${name}: sync primitives contract`, () => {
    it("round-trips binary payload through base64 codec", () => {
      const samples = [
        Uint8Array.from([]),
        Uint8Array.from([0]),
        Uint8Array.from([0, 1, 2, 253, 254, 255]),
        Uint8Array.from(Array.from({ length: 256 }, (_, i) => i)),
      ]

      for (const sample of samples) {
        const encoded = primitives.bytesToBase64(sample)
        const decoded = primitives.base64ToBytes(encoded)
        expect(Array.from(decoded)).toEqual(Array.from(sample))
      }
    })

    it("treats heads as order-insensitive set equality", () => {
      expect(primitives.sameHeads(["a", "b"], ["b", "a"])).toBe(true)
      expect(primitives.sameHeads(["a"], ["a", "b"])).toBe(false)
      expect(primitives.sameHeads(["a", "c"], ["a", "b"])).toBe(false)
    })

    it("is symmetric", () => {
      const left = ["h1", "h2", "h3"]
      const right = ["h3", "h2", "h1"]

      expect(primitives.sameHeads(left, right)).toBe(
        primitives.sameHeads(right, left),
      )
    })
  })
}
