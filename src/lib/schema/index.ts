import type { TaskSchema } from './types'
import { listUserSchemas, getUserSchema } from './user-schema-store'
import { ensureSeeds } from '../seed'

/** 获取 schema：先 seed 再从 data/schemas/ 读 */
export function getSchema(id: string): TaskSchema | null {
  ensureSeeds()
  return getUserSchema(id)
}

/** 列出所有 schema：全部从 data/schemas/ 读（含 seed 过来的示例） */
export function listSchemas(): TaskSchema[] {
  ensureSeeds()
  return listUserSchemas()
}

export type { TaskSchema } from './types'
