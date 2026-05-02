// Copilot v2 tool runtime：主入口 runTool (M2 Task 2.3) + JSON 语义截断 util。
// truncateJsonSemantic 来自 hermes-agent `_truncate_tool_call_args_json`：
// 递归把字符串字段裁到上限，防止 LLM 产出过长参数把 provider 拒掉。

export function truncateJsonSemantic(obj: unknown, maxFieldChars: number): unknown {
  if (typeof obj === "string") {
    return obj.length > maxFieldChars
      ? obj.slice(0, maxFieldChars) + "...(truncated)"
      : obj
  }
  if (Array.isArray(obj)) return obj.map((x) => truncateJsonSemantic(x, maxFieldChars))
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k,
        truncateJsonSemantic(v, maxFieldChars),
      ]),
    )
  }
  return obj
}
