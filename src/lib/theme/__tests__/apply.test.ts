/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { applyThemeClass } from "../apply"

describe("applyThemeClass", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark")
  })

  it("adds .dark when next=dark", () => {
    applyThemeClass("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("removes .dark when next=light", () => {
    document.documentElement.classList.add("dark")
    applyThemeClass("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("follows prefers-color-scheme dark when next=system", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        media: "(prefers-color-scheme: dark)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
    )
    applyThemeClass("system")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    vi.unstubAllGlobals()
  })

  it("follows prefers-color-scheme light when next=system", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        media: "(prefers-color-scheme: dark)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
    )
    document.documentElement.classList.add("dark")
    applyThemeClass("system")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    vi.unstubAllGlobals()
  })
})
