import { describe, it, expect } from "vitest"
import {
  emptyFormState,
  emptyInput,
  emptyVariable,
  emptyDimension,
  buildSchemaFromForm,
  formFromSchema,
  type TemplateFormState,
  type FormOutputField,
} from "@/components/template-builder/form-state"
import type { TaskSchema } from "@/lib/schema/types"

// --- Helpers ---

function validForm(overrides: Partial<TemplateFormState> = {}): TemplateFormState {
  return {
    ...emptyFormState(),
    id: "my_task",
    label: "My Task",
    inputs: [
      { alias: "item", dataset_id: "ds1", dedupe_by: [], hard_filter_field: "", hard_filter_equals_raw: "", filters: [] },
    ],
    output_fields: [
      { name: "answer", type: "string", required: true, enum_values: [] } satisfies FormOutputField,
    ],
    ...overrides,
  }
}

// --- Empty helpers (shape assertions) ---

describe("empty helpers", () => {
  it("emptyFormState returns a structurally complete blank form", () => {
    const f = emptyFormState()
    expect(f.id).toBe("")
    expect(f.label).toBe("")
    expect(f.description).toBe("")
    expect(f.compare_group).toBe("")
    expect(f.inputs).toHaveLength(1)           // seeded with one empty input
    expect(f.inputs[0]).toEqual(emptyInput())
    expect(f.variables).toEqual([])
    expect(f.default_prompt).toBe("")
    expect(typeof f.user_template).toBe("string")
    expect(f.user_template.length).toBeGreaterThan(0)
    expect(f.image_field).toBe("")
    expect(f.output_fields).toEqual([])
    expect(f.display_dimensions).toEqual([])
    expect(f.display_id_override).toBe("")
    expect(f.raw_text_output).toBe(false)
  })

  it("emptyInput returns blank input shell with alias='input'", () => {
    expect(emptyInput()).toEqual({
      alias: "input",
      dataset_id: "",
      dedupe_by: [],
      hard_filter_field: "",
      hard_filter_equals_raw: "",
      filters: [],
    })
  })

  it("emptyVariable returns blank variable shell", () => {
    expect(emptyVariable()).toEqual({ name: "", source: "", transform: [], fallback: "" })
  })

  it("emptyDimension returns blank dimension shell", () => {
    expect(emptyDimension()).toEqual({ field: "", label: "", value_labels: {}, order: [], header_fields: [] })
  })
})

// --- parseEqualsValue: tested indirectly via buildSchemaFromForm hard_filter ---

describe("parseEqualsValue (via hard_filter)", () => {
  function buildHardFilterEquals(raw: string): unknown {
    const res = buildSchemaFromForm(
      validForm({
        inputs: [
          {
            alias: "item",
            dataset_id: "ds1",
            dedupe_by: [],
            hard_filter_field: "status",
            hard_filter_equals_raw: raw,
            filters: [],
          },
        ],
      })
    )
    expect(res.errors).toEqual([])
    return res.schema!.inputs[0]!.hard_filter!.equals
  }

  it("parses 'true' → boolean true", () => {
    expect(buildHardFilterEquals("true")).toBe(true)
  })

  it("parses 'false' → boolean false", () => {
    expect(buildHardFilterEquals("false")).toBe(false)
  })

  it("parses 'null' → null", () => {
    expect(buildHardFilterEquals("null")).toBe(null)
  })

  it("parses numeric string → number", () => {
    expect(buildHardFilterEquals("42")).toBe(42)
    expect(buildHardFilterEquals("3.14")).toBeCloseTo(3.14)
  })

  it("parses plain string → string (pure whitespace trims to empty string)", () => {
    expect(buildHardFilterEquals("active")).toBe("active")
    // Pure whitespace input: trim eliminates it to ""; Number('') is 0 but the
    // code guards with `t !== ""` so the returned value is "" (not the original
    // whitespace, because the function returns the trimmed `t`).
    expect(buildHardFilterEquals("   ")).toBe("")
  })
})

// --- buildSchemaFromForm happy path ---

describe("buildSchemaFromForm happy path", () => {
  it("produces a minimal well-formed TaskSchema from validForm()", () => {
    const res = buildSchemaFromForm(validForm())
    expect(res.errors).toEqual([])
    expect(res.schema).toBeDefined()
    const s = res.schema!
    expect(s.id).toBe("my_task")
    expect(s.label).toBe("My Task")
    expect(s.version).toBe(1)
    expect(s.inputs).toHaveLength(1)
    expect(s.inputs[0]!.alias).toBe("item")
    expect(s.inputs[0]!.dataset_id).toBe("ds1")
    // Empty filters / dedupe_by collapse to undefined (not empty array)
    expect(s.inputs[0]!.dedupe_by).toBeUndefined()
    expect(s.inputs[0]!.filters).toBeUndefined()
    expect(s.inputs[0]!.hard_filter).toBeUndefined()
    expect(s.output_schema.type).toBe("object")
    expect(s.output_schema.required).toEqual(["answer"])
    expect(s.output_schema.properties?.answer).toEqual({ type: "string" })
    // description / compare_group empty → undefined
    expect(s.description).toBeUndefined()
    expect(s.compare_group).toBeUndefined()
    expect(s.display_id).toBeUndefined()
    expect(s.display_dimensions).toBeUndefined()
    expect(s.raw_text_output).toBeUndefined()
    // message_builder with default user_template and no image
    expect(s.message_builder.user_template).toBeDefined()
    expect(s.message_builder.image).toBeUndefined()
  })

  it("coerces number-type enum values from strings and drops NaN", () => {
    const form = validForm({
      output_fields: [
        {
          name: "score",
          type: "number",
          required: true,
          enum_values: ["1", "2", "notanumber", "3"],
        } satisfies FormOutputField,
      ],
    })
    const res = buildSchemaFromForm(form)
    expect(res.errors).toEqual([])
    expect(res.schema!.output_schema.properties?.score?.enum).toEqual([1, 2, 3])
  })

  it("keeps enum values as strings for string-typed fields", () => {
    const form = validForm({
      output_fields: [
        {
          name: "status",
          type: "string",
          required: true,
          enum_values: ["active", "archived"],
        } satisfies FormOutputField,
      ],
    })
    const res = buildSchemaFromForm(form)
    expect(res.errors).toEqual([])
    expect(res.schema!.output_schema.properties?.status?.enum).toEqual(["active", "archived"])
  })

  it("preserves description / compare_group / image_field / display_id_override when non-empty", () => {
    const res = buildSchemaFromForm(
      validForm({
        description: "Test desc",
        compare_group: "grp",
        image_field: "item.image_url",
        display_id_override: "custom_display",
      })
    )
    expect(res.errors).toEqual([])
    const s = res.schema!
    expect(s.description).toBe("Test desc")
    expect(s.compare_group).toBe("grp")
    expect(s.message_builder.image).toEqual({ field: "item.image_url", required: false })
    expect(s.display_id).toBe("custom_display")
  })
})

// --- buildSchemaFromForm validation errors ---

describe("buildSchemaFromForm validation errors", () => {
  it("reports missing id", () => {
    const res = buildSchemaFromForm(validForm({ id: "" }))
    expect(res.schema).toBeUndefined()
    expect(res.errors.some(e => e.field === "id")).toBe(true)
  })

  it("reports invalid id pattern (must start lowercase letter, letters/digits/underscore)", () => {
    const res = buildSchemaFromForm(validForm({ id: "1badid" }))
    expect(res.schema).toBeUndefined()
    expect(res.errors.some(e => e.field === "id" && /lowercase/i.test(e.message))).toBe(true)
  })

  it("reports missing label", () => {
    const res = buildSchemaFromForm(validForm({ label: "" }))
    expect(res.schema).toBeUndefined()
    expect(res.errors.some(e => e.field === "label")).toBe(true)
  })

  it("reports empty inputs array", () => {
    const res = buildSchemaFromForm(validForm({ inputs: [] }))
    expect(res.schema).toBeUndefined()
    expect(res.errors.some(e => e.field === "inputs")).toBe(true)
  })

  it("reports missing input alias / dataset_id", () => {
    const res = buildSchemaFromForm(
      validForm({
        inputs: [
          { alias: "", dataset_id: "", dedupe_by: [], hard_filter_field: "", hard_filter_equals_raw: "", filters: [] },
        ],
      })
    )
    expect(res.schema).toBeUndefined()
    expect(res.errors.some(e => e.field === "inputs[0].alias")).toBe(true)
    expect(res.errors.some(e => e.field === "inputs[0].dataset_id")).toBe(true)
  })

  it("reports duplicate input alias", () => {
    const res = buildSchemaFromForm(
      validForm({
        inputs: [
          { alias: "item", dataset_id: "ds1", dedupe_by: [], hard_filter_field: "", hard_filter_equals_raw: "", filters: [] },
          { alias: "item", dataset_id: "ds2", dedupe_by: [], hard_filter_field: "", hard_filter_equals_raw: "", filters: [] },
        ],
      })
    )
    expect(res.schema).toBeUndefined()
    expect(
      res.errors.some(e => e.field === "inputs[1].alias" && /duplicate/i.test(e.message))
    ).toBe(true)
  })

  it("reports missing variable name / source and duplicate variable name", () => {
    const res = buildSchemaFromForm(
      validForm({
        variables: [
          { name: "", source: "", transform: [], fallback: "" },
          { name: "v", source: "item.title", transform: [], fallback: "" },
          { name: "v", source: "item.body", transform: [], fallback: "" },
        ],
      })
    )
    expect(res.schema).toBeUndefined()
    expect(res.errors.some(e => e.field === "variables[0].name")).toBe(true)
    expect(res.errors.some(e => e.field === "variables[0].source")).toBe(true)
    expect(
      res.errors.some(e => e.field === "variables[2].name" && /duplicate/i.test(e.message))
    ).toBe(true)
  })

  it("reports missing output field name and empty output_fields", () => {
    const res1 = buildSchemaFromForm(validForm({ output_fields: [] }))
    expect(res1.schema).toBeUndefined()
    expect(res1.errors.some(e => e.field === "output_fields")).toBe(true)

    const res2 = buildSchemaFromForm(
      validForm({
        output_fields: [
          { name: "", type: "string", required: false, enum_values: [] } satisfies FormOutputField,
        ],
      })
    )
    expect(res2.schema).toBeUndefined()
    expect(res2.errors.some(e => e.field === "output_fields[0].name")).toBe(true)
  })

  it("reports duplicate output field name", () => {
    const res = buildSchemaFromForm(
      validForm({
        output_fields: [
          { name: "answer", type: "string", required: true, enum_values: [] } satisfies FormOutputField,
          { name: "answer", type: "number", required: false, enum_values: [] } satisfies FormOutputField,
        ],
      })
    )
    expect(res.schema).toBeUndefined()
    expect(
      res.errors.some(e => e.field === "output_fields[1].name" && /duplicate/i.test(e.message))
    ).toBe(true)
  })

  it("reports raw_text_output violation when >1 output fields", () => {
    const res = buildSchemaFromForm(
      validForm({
        raw_text_output: true,
        output_fields: [
          { name: "a", type: "string", required: true, enum_values: [] } satisfies FormOutputField,
          { name: "b", type: "string", required: false, enum_values: [] } satisfies FormOutputField,
        ],
      })
    )
    expect(res.schema).toBeUndefined()
    expect(
      res.errors.some(e => e.field === "raw_text_output" && /only 1 output/i.test(e.message))
    ).toBe(true)
  })

  it("reports raw_text_output violation when the single field is not string", () => {
    const res = buildSchemaFromForm(
      validForm({
        raw_text_output: true,
        output_fields: [
          { name: "n", type: "number", required: true, enum_values: [] } satisfies FormOutputField,
        ],
      })
    )
    expect(res.schema).toBeUndefined()
    expect(
      res.errors.some(e => e.field === "raw_text_output" && /string type/i.test(e.message))
    ).toBe(true)
  })
})

// --- formFromSchema deserialization ---

describe("formFromSchema", () => {
  it("deserializes a minimal TaskSchema to the corresponding form state", () => {
    const schema: TaskSchema = {
      id: "s1",
      label: "S1",
      version: 1,
      inputs: [{ alias: "item", dataset_id: "ds1" }],
      variables: [],
      default_prompt: "",
      message_builder: { user_template: "hi" },
      output_schema: { type: "object", required: ["a"], properties: { a: { type: "string" } } },
    }
    const f = formFromSchema(schema)
    expect(f.id).toBe("s1")
    expect(f.label).toBe("S1")
    expect(f.description).toBe("")
    expect(f.compare_group).toBe("")
    expect(f.inputs).toHaveLength(1)
    expect(f.inputs[0]!.alias).toBe("item")
    expect(f.inputs[0]!.hard_filter_field).toBe("")
    expect(f.inputs[0]!.hard_filter_equals_raw).toBe("")
    expect(f.output_fields).toEqual([
      { name: "a", type: "string", required: true, max_length: undefined, min_length: undefined, tuple_len: undefined, enum_values: [] },
    ])
    expect(f.raw_text_output).toBe(false)
    expect(f.image_field).toBe("")
    expect(f.user_template).toBe("hi")
    expect(f.display_id_override).toBe("")
  })

  it("deserializes enum arrays to string[] via String() coercion", () => {
    const schema: TaskSchema = {
      id: "s1",
      label: "S1",
      version: 1,
      inputs: [{ alias: "item", dataset_id: "ds1" }],
      variables: [],
      default_prompt: "",
      message_builder: {},
      output_schema: {
        type: "object",
        required: [],
        properties: { score: { type: "number", enum: [1, 2, 3] } },
      },
    }
    const f = formFromSchema(schema)
    expect(f.output_fields[0]!.enum_values).toEqual(["1", "2", "3"])
  })
})

// --- Round-trip idempotency ---

describe("round-trip: formFromSchema ∘ buildSchemaFromForm", () => {
  it("is identity for validForm()", () => {
    const original = validForm()
    const res = buildSchemaFromForm(original)
    expect(res.errors).toEqual([])
    const reborn = formFromSchema(res.schema!)
    expect(reborn).toEqual(original)
  })

  it("is identity for a rich form with hard_filter / variables / dimensions / image", () => {
    const rich = validForm({
      description: "rich desc",
      compare_group: "grp_a",
      image_field: "item.pic",
      display_id_override: "custom_disp",
      inputs: [
        {
          alias: "item",
          dataset_id: "ds1",
          dedupe_by: ["id"],
          hard_filter_field: "kind",
          hard_filter_equals_raw: "42",                          // will round-trip number → "42"
          filters: [],
        },
      ],
      variables: [
        { name: "title", source: "item.title", transform: [{ op: "truncate", max: 10 }], fallback: "n/a" },
      ],
      output_fields: [
        {
          name: "score",
          type: "number",
          required: true,
          max_length: undefined,
          min_length: undefined,
          tuple_len: undefined,
          enum_values: ["1", "2", "3"],
        } satisfies FormOutputField,
      ],
      display_dimensions: [
        {
          field: "output.score",
          label: "Score",
          value_labels: { "1": "low", "2": "mid", "3": "high" },
          order: ["1", "2", "3"],
          header_fields: [{ field: "item.title", label: "Title" }],
        },
      ],
    })
    const res = buildSchemaFromForm(rich)
    expect(res.errors).toEqual([])
    const reborn = formFromSchema(res.schema!)
    expect(reborn).toEqual(rich)
  })

  it("round-trips boolean hard_filter_equals via 'true'/'false' raw strings", () => {
    const f = validForm({
      inputs: [
        {
          alias: "item",
          dataset_id: "ds1",
          dedupe_by: [],
          hard_filter_field: "flag",
          hard_filter_equals_raw: "true",
          filters: [],
        },
      ],
    })
    const res = buildSchemaFromForm(f)
    expect(res.errors).toEqual([])
    expect(res.schema!.inputs[0]!.hard_filter!.equals).toBe(true)
    const reborn = formFromSchema(res.schema!)
    expect(reborn.inputs[0]!.hard_filter_equals_raw).toBe("true")
    expect(reborn).toEqual(f)
  })

  it("round-trips raw_text_output=true with single string output field", () => {
    const f = validForm({
      raw_text_output: true,
      output_fields: [
        { name: "text", type: "string", required: true, enum_values: [] } satisfies FormOutputField,
      ],
    })
    const res = buildSchemaFromForm(f)
    expect(res.errors).toEqual([])
    expect(res.schema!.raw_text_output).toBe(true)
    const reborn = formFromSchema(res.schema!)
    expect(reborn).toEqual(f)
  })
})
