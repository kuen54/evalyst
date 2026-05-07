import { describe, it, expect, vi } from 'vitest'
import { readPageTool } from '../read-page'

vi.mock('../../snapshot-cache', () => ({
  getSnapshot: () => ({
    viewport_index: [
      { key: 'template:sch_1', type: 'template', preview_text: 'QA template prompt template hello', ancestors: [] },
    ],
  }),
}))

vi.mock('@/lib/schema', () => ({
  getSchema: (id: string) => id === 'sch_1' ? {
    id, label: 'QA', description: 'd', version: 1,
    inputs: [], variables: [{ name: 'q', source: 'item.q' }],
    default_prompt: 'SECRET PROMPT BODY '.repeat(50),
    message_builder: {},
    output_schema: { type: 'object', properties: { answer: { type: 'string' } } },
  } : null,
}))

const ctx = { session_id: 's', signal: new AbortController().signal }

describe('readPageTool returns manifest content_tree, not full schema', () => {
  it('template hit: content_tree has prompt_template_excerpt, no full default_prompt', async () => {
    const r = (await readPageTool.call({ query: 'template prompt' }, ctx)) as {
      matches: Array<{ key: string; content_tree: Record<string, unknown> | null }>
    }
    expect(r.matches.length).toBe(1)
    const tree = r.matches[0].content_tree!
    expect(tree.id).toBe('sch_1')
    expect(tree).toHaveProperty('prompt_template_excerpt')
    expect((tree.prompt_template_excerpt as string).length).toBe(300)
    expect(tree).not.toHaveProperty('default_prompt')
    expect(tree).not.toHaveProperty('prompt_template')
    expect(JSON.stringify(tree)).not.toContain('SECRET PROMPT BODY '.repeat(20))
  })
})
