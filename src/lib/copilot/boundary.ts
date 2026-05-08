// src/lib/copilot/boundary.ts
import type { CopilotMessage } from './types'

/**
 * spec §5.4 build-llm-messages 组装前调用：找最近一条 compact_boundary，
 * 从 boundary 之后开始组装。无 boundary → 返原 branch（老 session 兼容，
 * 语义等价 v2 现状）。
 *
 * 时间复杂度：线性回扫到找到即停；boundary 越靠近末端越快。
 */
export function sliceAfterBoundary(branch: CopilotMessage[]): CopilotMessage[] {
  for (let i = branch.length - 1; i >= 0; i--) {
    const m = branch[i]
    if (m.role === 'system' && m.kind === 'compact_boundary') {
      return branch.slice(i + 1)
    }
  }
  return branch
}
