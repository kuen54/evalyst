import { describe, it, expect, vi, beforeEach } from "vitest"

// Must mock before the tool imports it.
const getMock = vi.fn()
const createMock = vi.fn()

vi.mock("@/lib/schema/user-schema-store", () => ({
  getUserSchema: (...args: unknown[]) => getMock(...args),
  createUserSchema: (...args: unknown[]) => createMock(...args),
}))

// Import AFTER vi.mock so the tool picks up the mocked module.
import { editTemplateTool } from "../edit-template"

const ctx = { session_id: "s", signal: new AbortController().signal }

beforeEach(() => {
  getMock.mockReset()
  createMock.mockReset()
  createMock.mockImplementation((s: unknown) => s)
})

describe("edit_template · metadata", () => {
  it("is marked destructive + not read-only", () => {
    expect(editTemplateTool.metadata.isDestructive).toBe(true)
    expect(editTemplateTool.metadata.isReadOnly).toBe(false)
  })

  it("has a reasonable maxResultSizeChars cap", () => {
    expect(editTemplateTool.metadata.maxResultSizeChars).toBeGreaterThan(0)
    expect(editTemplateTool.metadata.maxResultSizeChars).toBeLessThanOrEqual(2000)
  })

  it("required input fields declared", () => {
    const schema = editTemplateTool.inputSchema as {
      required?: string[]
      properties: Record<string, unknown>
    }
    expect(schema.required).toContain("schema_id")
    expect(schema.required).toContain("patch")
  })
})

describe("edit_template · behavior", () => {
  it("applies patch via shallow merge and bumps version", async () => {
    getMock.mockReturnValue({
      id: "sch_X",
      label: "original",
      default_prompt: "old prompt",
      version: 3,
      inputs: [],
      variables: [],
      message_builder: { messages: [] },
      output_schema: {},
    })
    const r = await editTemplateTool.call(
      { schema_id: "sch_X", patch: { default_prompt: "new prompt" } },
      ctx,
    )
    expect(r.success).toBe(true)
    expect(r.new_version).toBe(4)
    expect(r.schema_id).toBe("sch_X")

    expect(createMock).toHaveBeenCalledTimes(1)
    const written = createMock.mock.calls[0][0]
    expect(written.id).toBe("sch_X") // id preserved
    expect(written.default_prompt).toBe("new prompt") // patch applied
    expect(written.label).toBe("original") // unpatched field preserved
    expect(written.version).toBe(4)
  })

  it("starts version at 1 when schema has no version field", async () => {
    getMock.mockReturnValue({
      id: "sch_new",
      label: "x",
      default_prompt: "p",
      inputs: [],
      variables: [],
      message_builder: { messages: [] },
      output_schema: {},
      // no version
    })
    const r = await editTemplateTool.call(
      { schema_id: "sch_new", patch: { label: "y" } },
      ctx,
    )
    expect(r.new_version).toBe(1)
  })

  it("throws when schema is missing", async () => {
    getMock.mockReturnValue(null)
    await expect(
      editTemplateTool.call({ schema_id: "nope", patch: {} }, ctx),
    ).rejects.toThrow(/not found/)
    expect(createMock).not.toHaveBeenCalled()
  })

  it("ignores patch.id (id is never changeable)", async () => {
    getMock.mockReturnValue({
      id: "sch_X",
      label: "x",
      default_prompt: "p",
      version: 1,
      inputs: [],
      variables: [],
      message_builder: { messages: [] },
      output_schema: {},
    })
    await editTemplateTool.call(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { schema_id: "sch_X", patch: { id: "evil_rename" } as any },
      ctx,
    )
    const written = createMock.mock.calls[0][0]
    expect(written.id).toBe("sch_X")
  })

  it("rejects empty schema_id", async () => {
    await expect(
      editTemplateTool.call({ schema_id: "", patch: {} }, ctx),
    ).rejects.toThrow()
    expect(getMock).not.toHaveBeenCalled()
  })

  it("rejects non-object patch", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editTemplateTool.call({ schema_id: "sch_X", patch: null as any }, ctx),
    ).rejects.toThrow()
  })
})
