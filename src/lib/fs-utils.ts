// ---------- 文件系统通用小工具 ----------

import fs from 'fs'

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

/** 原子写：先写 tmp 再 rename，保证中途崩溃不会留半文件。
 *  tmp 名带 pid + 进程内序号：跨进程并发写同一目标时各写各的 tmp（固定 `.tmp`
 *  后缀会共享同名 tmp，被对方先 rename 走后自己 rename 抛 ENOENT 或发布对方
 *  的字节）；rename 本身仍原子，并发下 last-writer-wins。 */
let tmpSeq = 0
export function writeAtomic(filePath: string, content: string) {
  const tmp = `${filePath}.${process.pid}.${++tmpSeq}.tmp`
  try {
    fs.writeFileSync(tmp, content)
    fs.renameSync(tmp, filePath)
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch { /* tmp 可能没写出来 */ }
    throw e
  }
}
