// ---------- 评测任务表单的本地 state 类型 + 序列化 ----------

import type {
  TaskSchema,
  FilterDef,
  InputSourceDef,
  VariableDef,
  JsonSchemaDef,
  JsonPropDef,
  DisplayDimension,
  TransformStep,
} from "@/lib/schema/types"

export interface FormOutputField {
  name: string
  type: "string" | "number" | "boolean" | "array" | "object" | "string|null" | "tuple:number[]" | "image_url" | "image_url_list"
  required: boolean
  max_length?: number
  min_length?: number
  tuple_len?: number
  enum_values: string[]                   // 空数组 = 无约束；非空则值必须在列表里
}

interface FormInput {
  alias: string
  dataset_id: string
  dedupe_by: string[]
  hard_filter_field: string              // 空串 = 无
  hard_filter_equals_raw: string          // 用户输入字符串，保存时 parse（true/false/数字/字符串）
  filters: FilterDef[]
}

interface FormVariable {
  name: string
  source: string
  transform: TransformStep[]
  fallback: string
}

interface FormDimension {
  field: string
  label: string
  value_labels: Record<string, string>
  order: Array<string | number>
  header_fields: Array<{ field: string; label?: string }>
}

export interface TemplateFormState {
  id: string
  label: string
  description: string
  compare_group: string
  inputs: FormInput[]
  variables: FormVariable[]
  default_prompt: string
  user_template: string                   // 简化版 message_builder：只支持单一 user_template
  image_field: string                     // 空串 = 无图片
  output_fields: FormOutputField[]
  display_dimensions: FormDimension[]
  display_id_override: string             // 空串 = 自动推断
  raw_text_output: boolean                // true → 模型直接输出纯文本，parser 跳过 JSON 提取
}

export function emptyFormState(): TemplateFormState {
  return {
    id: "",
    label: "",
    description: "",
    compare_group: "",
    inputs: [emptyInput()],
    variables: [],
    default_prompt: "",
    user_template: '请输出严格 JSON，结构符合指定的输出字段。',
    image_field: "",
    output_fields: [],
    display_dimensions: [],
    display_id_override: "",
    raw_text_output: false,
  }
}

export function emptyInput(): FormInput {
  return { alias: "input", dataset_id: "", dedupe_by: [], hard_filter_field: "", hard_filter_equals_raw: "", filters: [] }
}

export function emptyVariable(): FormVariable {
  return { name: "", source: "", transform: [], fallback: "" }
}

export function emptyDimension(): FormDimension {
  return { field: "", label: "", value_labels: {}, order: [], header_fields: [] }
}

// --- 序列化表单 → TaskSchema ---

interface BuildResult {
  schema?: TaskSchema
  errors: Array<{ field: string; message: string }>
}

export function buildSchemaFromForm(form: TemplateFormState): BuildResult {
  const errors: Array<{ field: string; message: string }> = []

  if (!form.id) errors.push({ field: "id", message: "ID required / ID 必填" })
  else if (!/^[a-z][a-z0-9_]*$/.test(form.id)) errors.push({ field: "id", message: "ID must start lowercase letter, letters/digits/underscore only" })
  if (!form.label) errors.push({ field: "label", message: "Label required / 标签必填" })
  if (!form.inputs.length) errors.push({ field: "inputs", message: "At least one input / 至少一个输入" })

  const inputs: InputSourceDef[] = []
  const seenAlias = new Set<string>()
  form.inputs.forEach((inp, i) => {
    if (!inp.alias) errors.push({ field: `inputs[${i}].alias`, message: "Required / 必填" })
    else if (seenAlias.has(inp.alias)) errors.push({ field: `inputs[${i}].alias`, message: `Duplicate alias: "${inp.alias}"` })
    else seenAlias.add(inp.alias)
    if (!inp.dataset_id) errors.push({ field: `inputs[${i}].dataset_id`, message: "Required / 必填" })
    const hard = inp.hard_filter_field
      ? { field: inp.hard_filter_field, equals: parseEqualsValue(inp.hard_filter_equals_raw) }
      : undefined
    inputs.push({
      alias: inp.alias,
      dataset_id: inp.dataset_id,
      dedupe_by: inp.dedupe_by.length ? inp.dedupe_by : undefined,
      hard_filter: hard,
      filters: inp.filters.length ? inp.filters : undefined,
    })
  })

  const variables: VariableDef[] = []
  const seenVarName = new Set<string>()
  form.variables.forEach((v, i) => {
    if (!v.name) errors.push({ field: `variables[${i}].name`, message: "Required / 必填" })
    else if (seenVarName.has(v.name)) errors.push({ field: `variables[${i}].name`, message: `Duplicate variable: "${v.name}"` })
    else seenVarName.add(v.name)
    if (!v.source) errors.push({ field: `variables[${i}].source`, message: "Required / 必填" })
    variables.push({
      name: v.name,
      source: v.source,
      transform: v.transform.length ? v.transform : undefined,
      fallback: v.fallback || undefined,
    })
  })

  // output_schema
  const properties: Record<string, JsonPropDef> = {}
  const required: string[] = []
  const seenFieldName = new Set<string>()
  form.output_fields.forEach((f, i) => {
    if (!f.name) {
      errors.push({ field: `output_fields[${i}].name`, message: "Required / 必填" })
      return
    }
    if (seenFieldName.has(f.name)) {
      errors.push({ field: `output_fields[${i}].name`, message: `Duplicate field: "${f.name}"` })
      return
    }
    seenFieldName.add(f.name)
    const prop: JsonPropDef = { type: f.type }
    if (f.max_length != null) prop.max_length = f.max_length
    if (f.min_length != null) prop.min_length = f.min_length
    if (f.tuple_len != null) prop.tuple_len = f.tuple_len
    if (f.enum_values.length > 0) {
      // 数字类型时 enum 值转数字
      prop.enum = f.type === "number"
        ? f.enum_values.map(v => Number(v)).filter(v => !isNaN(v))
        : f.enum_values
    }
    properties[f.name] = prop
    if (f.required) required.push(f.name)
  })
  if (form.output_fields.length === 0) {
    errors.push({ field: "output_fields", message: "At least one output field / 至少声明一个输出字段" })
  }
  // 纯文本模式约束
  if (form.raw_text_output) {
    if (form.output_fields.length > 1) {
      errors.push({ field: "raw_text_output", message: "raw text mode allows only 1 output field" })
    }
    const only = form.output_fields[0]
    if (only && only.type !== "string") {
      errors.push({ field: "raw_text_output", message: `raw text mode requires string type, got ${only.type}` })
    }
  }
  const output_schema: JsonSchemaDef = { type: "object", required, properties }

  // display_dimensions
  const display_dimensions: DisplayDimension[] = form.display_dimensions.map(d => ({
    field: d.field,
    label: d.label || undefined,
    value_labels: Object.keys(d.value_labels).length ? d.value_labels : undefined,
    order: d.order.length ? d.order : undefined,
    header_fields: d.header_fields.length ? d.header_fields : undefined,
  }))

  if (errors.length) return { errors }

  const schema: TaskSchema = {
    id: form.id,
    label: form.label,
    description: form.description || undefined,
    version: 1,
    compare_group: form.compare_group || undefined,
    inputs,
    variables,
    default_prompt: form.default_prompt,
    message_builder: {
      user_template: form.user_template,
      image: form.image_field ? { field: form.image_field, required: false } : undefined,
    },
    output_schema,
    display_dimensions: display_dimensions.length ? display_dimensions : undefined,
    display_id: form.display_id_override || undefined,
    raw_text_output: form.raw_text_output || undefined,
  }
  return { schema, errors: [] }
}

function parseEqualsValue(raw: string): unknown {
  const t = raw.trim()
  if (t === "true") return true
  if (t === "false") return false
  if (t === "null") return null
  const n = Number(t)
  if (!isNaN(n) && t !== "") return n
  return t
}

// --- 反向：TaskSchema → FormState（用于 JSON 导入） ---

export function formFromSchema(schema: TaskSchema): TemplateFormState {
  return {
    id: schema.id,
    label: schema.label,
    description: schema.description ?? "",
    compare_group: schema.compare_group ?? "",
    inputs: schema.inputs.map(inp => ({
      alias: inp.alias,
      dataset_id: inp.dataset_id,
      dedupe_by: inp.dedupe_by ?? [],
      hard_filter_field: inp.hard_filter?.field ?? "",
      hard_filter_equals_raw: inp.hard_filter ? String(inp.hard_filter.equals) : "",
      filters: inp.filters ?? [],
    })),
    variables: schema.variables.map(v => ({
      name: v.name,
      source: v.source,
      transform: v.transform ?? [],
      fallback: v.fallback ?? "",
    })),
    default_prompt: schema.default_prompt,
    user_template: schema.message_builder.user_template ?? "",
    image_field: schema.message_builder.image?.field ?? "",
    output_fields: Object.entries(schema.output_schema.properties ?? {}).map(([name, p]) => ({
      name,
      type: p.type as FormOutputField["type"],
      required: (schema.output_schema.required ?? []).includes(name),
      max_length: p.max_length,
      min_length: p.min_length,
      tuple_len: p.tuple_len,
      enum_values: p.enum ? p.enum.map(String) : [],
    })),
    display_dimensions: (schema.display_dimensions ?? []).map(d => ({
      field: d.field,
      label: d.label ?? "",
      value_labels: d.value_labels ?? {},
      order: d.order ?? [],
      header_fields: d.header_fields ?? [],
    })),
    display_id_override: schema.display_id ?? "",
    raw_text_output: schema.raw_text_output ?? false,
  }
}
