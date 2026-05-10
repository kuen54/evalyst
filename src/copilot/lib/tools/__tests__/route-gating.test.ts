import { describe, it, expect } from 'vitest'
import { visibleToolsForRoute, isToolVisibleAtRoute } from '../route-gating'
import type { AnyToolDescriptor } from '../registry'
import type { RouteType } from '../../types'

function fakeTool(name: string): AnyToolDescriptor {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: 'object' },
    metadata: { isReadOnly: true, isDestructive: false, maxResultSizeChars: 1000 },
    call: async () => ({}),
  }
}

const ALL_TOOLS: AnyToolDescriptor[] = [
  fakeTool('list_experiments'),
  fakeTool('read_experiment_results'),
  fakeTool('restart_experiment'),
  fakeTool('read_resource'),
  fakeTool('read_dataset_records'),
  fakeTool('read_page'),
  fakeTool('read_context'),
  fakeTool('read_tool_result'),
  fakeTool('edit_template'),
]

const ALWAYS_NAMES = ['read_context', 'read_resource', 'read_page', 'read_tool_result', 'list_experiments']

describe('visibleToolsForRoute', () => {
  it('dashboard → 5 always tools only', () => {
    const r = visibleToolsForRoute(ALL_TOOLS, 'dashboard')
    expect(r.map((t) => t.name).sort()).toEqual([...ALWAYS_NAMES].sort())
  })

  it('experiment_detail → always + restart_experiment + read_experiment_results + read_dataset_records', () => {
    const r = visibleToolsForRoute(ALL_TOOLS, 'experiment_detail')
    const names = r.map((t) => t.name).sort()
    expect(names).toEqual([
      ...ALWAYS_NAMES,
      'read_dataset_records',
      'read_experiment_results',
      'restart_experiment',
    ].sort())
    expect(r).toHaveLength(8)
  })

  it('template_detail → always + edit_template', () => {
    const r = visibleToolsForRoute(ALL_TOOLS, 'template_detail')
    expect(r.map((t) => t.name).sort()).toEqual([...ALWAYS_NAMES, 'edit_template'].sort())
    expect(r).toHaveLength(6)
  })

  it('dataset_detail → always + read_dataset_records', () => {
    const r = visibleToolsForRoute(ALL_TOOLS, 'dataset_detail')
    expect(r.map((t) => t.name).sort()).toEqual([...ALWAYS_NAMES, 'read_dataset_records'].sort())
  })

  it('compare → always + read_experiment_results + read_dataset_records', () => {
    const r = visibleToolsForRoute(ALL_TOOLS, 'compare')
    expect(r.map((t) => t.name).sort()).toEqual([
      ...ALWAYS_NAMES, 'read_dataset_records', 'read_experiment_results',
    ].sort())
  })

  it('displays_list / rubrics_list → always only', () => {
    expect(visibleToolsForRoute(ALL_TOOLS, 'displays_list').map((t) => t.name).sort()).toEqual([...ALWAYS_NAMES].sort())
    expect(visibleToolsForRoute(ALL_TOOLS, 'rubrics_list').map((t) => t.name).sort()).toEqual([...ALWAYS_NAMES].sort())
  })

  it('undefined route → always fallback', () => {
    const r = visibleToolsForRoute(ALL_TOOLS, undefined)
    expect(r.map((t) => t.name).sort()).toEqual([...ALWAYS_NAMES].sort())
  })

  it('null route → always fallback', () => {
    const r = visibleToolsForRoute(ALL_TOOLS, null)
    expect(r.map((t) => t.name).sort()).toEqual([...ALWAYS_NAMES].sort())
  })

  it('未知 route_type 字符串 → always fallback', () => {
    const r = visibleToolsForRoute(ALL_TOOLS, 'unknown_route' as RouteType)
    expect(r.map((t) => t.name).sort()).toEqual([...ALWAYS_NAMES].sort())
  })

  it('保留 allTools 原顺序', () => {
    const r = visibleToolsForRoute(ALL_TOOLS, 'experiment_detail')
    // ALL_TOOLS 顺序: list_experiments, read_experiment_results, restart_experiment, read_resource,
    //                 read_dataset_records, read_page, read_context, read_tool_result, edit_template
    // experiment_detail 可见: 上面 9 个里去掉 edit_template
    expect(r.map((t) => t.name)).toEqual([
      'list_experiments', 'read_experiment_results', 'restart_experiment', 'read_resource',
      'read_dataset_records', 'read_page', 'read_context', 'read_tool_result',
    ])
  })
})

describe('isToolVisibleAtRoute', () => {
  it('always tools visible at any route', () => {
    for (const name of ALWAYS_NAMES) {
      expect(isToolVisibleAtRoute(name, 'dashboard')).toBe(true)
      expect(isToolVisibleAtRoute(name, 'template_detail')).toBe(true)
      expect(isToolVisibleAtRoute(name, undefined)).toBe(true)
    }
  })

  it('edit_template visible only at template routes', () => {
    expect(isToolVisibleAtRoute('edit_template', 'template_detail')).toBe(true)
    expect(isToolVisibleAtRoute('edit_template', 'template_new')).toBe(true)
    expect(isToolVisibleAtRoute('edit_template', 'templates_list')).toBe(true)
    expect(isToolVisibleAtRoute('edit_template', 'dashboard')).toBe(false)
    expect(isToolVisibleAtRoute('edit_template', 'experiment_detail')).toBe(false)
  })

  it('restart_experiment visible only at experiment_detail', () => {
    expect(isToolVisibleAtRoute('restart_experiment', 'experiment_detail')).toBe(true)
    expect(isToolVisibleAtRoute('restart_experiment', 'compare')).toBe(false)  // compare 不暴露 destructive
    expect(isToolVisibleAtRoute('restart_experiment', 'dashboard')).toBe(false)
  })

  it('read_dataset_records visible at experiment_detail / compare / dataset_*', () => {
    expect(isToolVisibleAtRoute('read_dataset_records', 'experiment_detail')).toBe(true)
    expect(isToolVisibleAtRoute('read_dataset_records', 'compare')).toBe(true)
    expect(isToolVisibleAtRoute('read_dataset_records', 'dataset_detail')).toBe(true)
    expect(isToolVisibleAtRoute('read_dataset_records', 'dashboard')).toBe(false)
    expect(isToolVisibleAtRoute('read_dataset_records', 'template_detail')).toBe(false)
  })
})
