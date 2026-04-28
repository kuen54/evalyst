"use client"

import React, { useMemo } from "react"
import { GlassCardThin, useGlassStyle } from "@/components/copilot/shell"
import { useCopilotStore } from "@/components/copilot/store"
import { useT } from "@/lib/i18n/provider"
import type { Display, GenericResultRecord, TaskSchema } from "@/lib/schema/types"
import type { ResultViewProps, CellViewProps } from "./types"
import { makeHelpers } from "./view-helpers"

// 按需动态 import babel-standalone（~3MB），不进首屏
type BabelTransform = (
  code: string,
  opts: { presets?: Array<string | [string, Record<string, unknown>]>; plugins?: unknown[] },
) => { code?: string }

let babelTransform: BabelTransform | null = null
async function loadBabel() {
  if (babelTransform) return babelTransform
  const mod = await import("@babel/standalone")
  babelTransform = mod.transform as unknown as BabelTransform
  return babelTransform
}

/** 给 JSX 编译过后的函数调用，带 try/catch + ErrorBoundary */
class JsxBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode; errorLabel: string }, { hasError: boolean; err?: Error }> {
  state = { hasError: false, err: undefined as Error | undefined }
  static getDerivedStateFromError(err: Error) { return { hasError: true, err } }
  render() {
    if (this.state.hasError) {
      return (
        <div className="border border-red-200 bg-red-50 rounded p-3 text-xs text-red-600">
          <div className="font-medium mb-1">{this.props.errorLabel}</div>
          <pre className="font-mono text-[11px] whitespace-pre-wrap">{this.state.err?.message}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

/** 编译用户 JSX 源码为渲染函数 */
function compileUserJsx(source: string, compilerLoadingText: string, compileErrorPrefix: string): { fn: (props: Record<string, unknown>) => React.ReactNode; error?: string } {
  if (!babelTransform) {
    return { fn: () => <span>{compilerLoadingText}</span>, error: "babel not loaded yet" }
  }
  try {
    // 用户提供的是一个 function 或箭头函数；包一下让它成为返回 JSX 的表达式
    const wrapped = `(${source})`
    const result = babelTransform(wrapped, {
      presets: [["react", { runtime: "classic" }]],
    })
    const code = result.code
    if (!code) throw new Error("Babel returned empty code")
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const factory = new Function("React", `return ${code}`) as (R: typeof React) => (props: Record<string, unknown>) => React.ReactNode
    const fn = factory(React)
    return { fn }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { fn: () => <span className="text-red-500 text-xs">{compileErrorPrefix}{msg}</span>, error: msg }
  }
}

function useCompiledJsx(source: string, compilerLoadingText: string, compileErrorPrefix: string) {
  const [ready, setReady] = React.useState(!!babelTransform)
  React.useEffect(() => {
    if (!babelTransform) loadBabel().then(() => setReady(true))
  }, [])
  return useMemo(() => {
    if (!ready) return null
    return compileUserJsx(source, compilerLoadingText, compileErrorPrefix)
  }, [source, ready, compilerLoadingText, compileErrorPrefix])
}

interface JsxProps extends ResultViewProps {
  display: Display
}

export function DisplayJsx({ results, schema, display }: JsxProps) {
  const t = useT()
  const source = display.jsx?.source ?? ""
  const compiled = useCompiledJsx(source, t("results.compiler_loading"), t("results.compile_error_prefix"))
  const { open: copilotOpen } = useCopilotStore()
  const thinStyle = useGlassStyle("thin")
  const regularStyle = useGlassStyle("regular")
  const thickStyle = useGlassStyle("thick")
  const tintedStyle = useGlassStyle("tinted")

  if (!compiled) return <div className="text-muted-foreground text-sm py-4">{t("results.compiler_loading")}</div>
  if (compiled.error) {
    return (
      <div className="border border-red-200 bg-red-50 rounded p-3 text-xs text-red-600">
        <div className="font-medium mb-1">{t("results.jsx_compile_error")}</div>
        <pre className="font-mono text-[11px] whitespace-pre-wrap">{compiled.error}</pre>
      </div>
    )
  }

  const helpers = makeHelpers({
    open: copilotOpen,
    styles: { thin: thinStyle, regular: regularStyle, thick: thickStyle, tinted: tintedStyle },
  })

  return (
    <div className="space-y-3">
      {results.map(r => (
        <div
          key={r.task_id}
          data-copilot-context="task_result"
          data-copilot-context-id={r.task_id}
          data-copilot-context-extra={JSON.stringify({ experiment_id: r.experiment_id })}
        >
          <JsxBoundary
            errorLabel={t("results.jsx_render_error")}
            fallback={
              <GlassCardThin className="p-3 border-red-200">
                <pre className="text-xs font-mono whitespace-pre-wrap">{JSON.stringify(r.output, null, 2)}</pre>
              </GlassCardThin>
            }
          >
            <JsxRenderer fn={compiled.fn} result={r} schema={schema} helpers={helpers} />
          </JsxBoundary>
        </div>
      ))}
    </div>
  )
}

function JsxRenderer({ fn, result, schema, helpers }: {
  fn: (props: Record<string, unknown>) => React.ReactNode
  result: GenericResultRecord
  schema: TaskSchema
  helpers: ReturnType<typeof makeHelpers>
}) {
  return <>{fn({ result, schema, helpers })}</>
}

/** compare cell：对每个 result 单独调用用户函数 */
export function DisplayJsxCell({ result, schema, display }: CellViewProps & { display: Display }) {
  const t = useT()
  const source = display.jsx?.source ?? ""
  const compiled = useCompiledJsx(source, t("results.compiler_loading"), t("results.compile_error_prefix"))
  const { open: copilotOpen } = useCopilotStore()
  const thinStyle = useGlassStyle("thin")
  const regularStyle = useGlassStyle("regular")
  const thickStyle = useGlassStyle("thick")
  const tintedStyle = useGlassStyle("tinted")
  if (!compiled || compiled.error) return null
  const helpers = makeHelpers({
    open: copilotOpen,
    styles: { thin: thinStyle, regular: regularStyle, thick: thickStyle, tinted: tintedStyle },
  })
  return (
    <JsxBoundary errorLabel={t("results.jsx_render_error")} fallback={<pre className="text-xs font-mono">{JSON.stringify(result.output)}</pre>}>
      <JsxRenderer fn={compiled.fn} result={result} schema={schema} helpers={helpers} />
    </JsxBoundary>
  )
}
