// ---------- Seed 机制（子目录扫描版） ----------
// 首次访问时把 src/lib/seeds/<kind>/ 下的示例资源复制到 data/<kind>/，
// images/ 下的示例图复制到 public/sample-images/。
// 幂等：目标文件已存在则跳过；用户删除后下次访问自动恢复。

import fs from 'fs'
import path from 'path'
import { ensureDir } from './fs-utils'

function seedsRoot() { return path.join(process.cwd(), 'src', 'lib', 'seeds') }
function dataRoot() { return path.join(process.cwd(), 'data') }
function publicRoot() { return path.join(process.cwd(), 'public') }

const KINDS: Array<{ subdir: string; dst: string; exts: string[] }> = [
  { subdir: 'datasets', dst: 'datasets', exts: ['.jsonl', '.meta.json'] },
  { subdir: 'schemas', dst: 'schemas', exts: ['.json'] },
  { subdir: 'rubrics', dst: 'rubrics', exts: ['.json'] },
  { subdir: 'displays', dst: 'displays', exts: ['.json'] },
  { subdir: 'experiments', dst: 'experiments', exts: ['.json'] },
  { subdir: 'results', dst: 'results', exts: ['.jsonl'] },
  { subdir: 'annotations', dst: 'annotations', exts: ['.jsonl'] },
]

export function ensureSeeds() {
  try {
    for (const k of KINDS) {
      seedFromDir(path.join(seedsRoot(), k.subdir), path.join(dataRoot(), k.dst), k.exts)
    }
    seedSampleImages()
  } catch (e) {
    console.error('[ensureSeeds] failed:', e)
  }
}

function seedFromDir(srcDir: string, dstDir: string, allowedExts: string[]) {
  if (!fs.existsSync(srcDir)) return
  ensureDir(dstDir)
  for (const name of fs.readdirSync(srcDir)) {
    if (!matchesExt(name, allowedExts)) continue
    const src = path.join(srcDir, name)
    const dst = path.join(dstDir, name)
    if (fs.existsSync(dst)) continue
    fs.copyFileSync(src, dst)
  }
}

function matchesExt(name: string, allowedExts: string[]): boolean {
  return allowedExts.some(ext => name.endsWith(ext))
}

function seedSampleImages() {
  const src = path.join(seedsRoot(), 'images')
  const dst = path.join(publicRoot(), 'sample-images')
  if (!fs.existsSync(src)) return
  copyImageTree(src, dst)
}

function copyImageTree(src: string, dst: string) {
  ensureDir(dst)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) {
      copyImageTree(s, d)
    } else if (/\.(jpg|jpeg|png|webp)$/i.test(entry.name)) {
      if (!fs.existsSync(d)) fs.copyFileSync(s, d)
    }
  }
}
