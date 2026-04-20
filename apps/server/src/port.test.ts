import { describe, expect, it } from "vitest"
import { resolvePort } from "./port.js"

describe("resolvePort", () => {
  it("uses fallback when variable is missing", () => {
    expect(resolvePort(undefined)).toBe(3000)
  })

  it("uses fallback when value is invalid", () => {
    expect(resolvePort("abc", 7000)).toBe(7000)
    expect(resolvePort("0", 7000)).toBe(7000)
    expect(resolvePort("-10", 7000)).toBe(7000)
  })

  it("parses valid numeric value", () => {
    expect(resolvePort("3456")).toBe(3456)
  })
})
