// ---------- 文件系统通用小工具 ----------

import fs from 'fs'

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

/** 原子写：先写 .tmp 再 rename，保证中途崩溃不会留半文件 */
export function writeAtomic(filePath: string, content: string) {
  const tmp = filePath + '.tmp'
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, filePath)
}
