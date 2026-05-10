import { describe, it, expect } from 'vitest'
import { __testOnly } from '../llm-stream'
import { visibleToolsForRoute } from '../tools/route-gating'
import { TOOLS } from '../tools/registry'
import { toAnthropicTools, toOpenaiTools } from '../tool-adapters'

describe('per-route tool gating end-to-end (v2.5 P2)', () => {
  it('dashboard route → outgoing body.tools has only 5 always-available', () => {
    const visible = visibleToolsForRoute(TOOLS, 'dashboard')
    const body = __testOnly.buildStreamingRequestBody({
      config: { api_format: 'anthropic', base_url: 'https://x', api_key: 'k' },
      model: 'claude-sonnet-4-6',
      temperature: 0.7,
      max_tokens: 1000,
      messages: [{ role: 'user', content: 'q' }],
      tools: toAnthropicTools(visible),
    })
    const tools = body.tools as Array<{ name: string }>
    expect(tools).toHaveLength(5)
    expect(tools.map((t) => t.name).sort()).toEqual([
      'list_experiments', 'read_context', 'read_page', 'read_resource', 'read_tool_result',
    ])
  })

  it('experiment_detail route → outgoing body.tools has 8 (5 + 3 extra)', () => {
    const visible = visibleToolsForRoute(TOOLS, 'experiment_detail')
    const body = __testOnly.buildStreamingRequestBody({
      config: { api_format: 'anthropic', base_url: 'https://x', api_key: 'k' },
      model: 'claude-sonnet-4-6',
      temperature: 0.7,
      max_tokens: 1000,
      messages: [{ role: 'user', content: 'q' }],
      tools: toAnthropicTools(visible),
    })
    const tools = body.tools as Array<{ name: string }>
    expect(tools).toHaveLength(8)
    const names = tools.map((t) => t.name)
    expect(names).toContain('restart_experiment')
    expect(names).toContain('read_experiment_results')
    expect(names).toContain('read_dataset_records')
    expect(names).not.toContain('edit_template')
  })

  it('template_detail route → 6 tools, includes edit_template, no restart_experiment', () => {
    const visible = visibleToolsForRoute(TOOLS, 'template_detail')
    const body = __testOnly.buildStreamingRequestBody({
      config: { api_format: 'openai', base_url: 'https://x', api_key: 'k' },
      model: 'gpt-4o',
      temperature: 0.7,
      max_tokens: 1000,
      messages: [{ role: 'user', content: 'q' }],
      tools: toOpenaiTools(visible),
    })
    const tools = body.tools as Array<{ function: { name: string } }>
    expect(tools).toHaveLength(6)
    const names = tools.map((t) => t.function.name)
    expect(names).toContain('edit_template')
    expect(names).not.toContain('restart_experiment')
  })

  it('未知 route → 5 always tools fallback', () => {
    const visible = visibleToolsForRoute(TOOLS, 'unknown_xyz' as never)
    expect(visible).toHaveLength(5)
  })
})
