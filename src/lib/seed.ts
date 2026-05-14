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
]

export function ensureSeeds() {
  try {
    for (const k of KINDS) {
      seedFromDir(path.join(seedsRoot(), k.subdir), path.join(dataRoot(), k.dst), k.exts)
    }
    seedResultsTree()
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

/**
 * `src/lib/seeds/results/<exp_id>/{results,annotations}.jsonl` 镜像到
 * `data/results/<exp_id>/{results,annotations}.jsonl`，且 `<exp_id>/images/` 下
 * 二进制图片（PNG/JPG/...）一并递归 copy 到 runtime。
 *
 * Evalyst runtime 期望 results 嵌套结构（`src/lib/store.ts:132` /
 * `src/lib/annotation-store.ts:14`）：每个 experiment 一个目录，目录内放
 * results.jsonl + annotations.jsonl + 可选 images/。Sample experiments ship 时按这个
 * 约定组织 seed，seed 时整树拷贝。
 *
 * 幂等：existsSync 跳过单文件；用户整树删除后下次访问从 seed 树恢复。
 */
function seedResultsTree() {
  const src = path.join(seedsRoot(), 'results')
  const dst = path.join(dataRoot(), 'results')
  if (!fs.existsSync(src)) return
  ensureDir(dst)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue   // 顶层散文件强制 ignore，sample 必须走 <exp_id>/
    copyTreeIdempotent(path.join(src, entry.name), path.join(dst, entry.name))
  }
}

/**
 * 递归 copy srcDir 下所有文件 + 子目录到 dstDir。已存在的目标文件跳过（幂等）。
 * 用于 seedResultsTree 把 <exp_id>/ 整子树（含 images/ 等任意嵌套）镜像到 runtime。
 */
function copyTreeIdempotent(srcDir: string, dstDir: string) {
  ensureDir(dstDir)
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name)
    const d = path.join(dstDir, entry.name)
    if (entry.isDirectory()) {
      copyTreeIdempotent(s, d)
    } else {
      if (fs.existsSync(d)) continue
      fs.copyFileSync(s, d)
    }
  }
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
