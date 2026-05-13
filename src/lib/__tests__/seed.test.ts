import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { ensureSeeds } from '../seed'

describe('ensureSeeds (subdir-scan)', () => {
  let tmpRoot: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evalyst-seed-test-'))
    const realSeeds = path.join(originalCwd, 'src', 'lib', 'seeds')
    const tmpSeeds = path.join(tmpRoot, 'src', 'lib', 'seeds')
    fs.mkdirSync(tmpSeeds, { recursive: true })
    cpRecursive(realSeeds, tmpSeeds)
    process.chdir(tmpRoot)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('seeds all subdirs into data/{kind}/ on empty data tree', () => {
    ensureSeeds()
    expect(fs.existsSync(path.join(tmpRoot, 'data/datasets/qa_pairs.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(tmpRoot, 'data/datasets/qa_pairs.meta.json'))).toBe(true)
    expect(fs.existsSync(path.join(tmpRoot, 'data/schemas/qa_answer_v1.json'))).toBe(true)
    expect(fs.existsSync(path.join(tmpRoot, 'data/rubrics/qa_accuracy.json'))).toBe(true)
  })

  it('does not overwrite existing target files (idempotent)', () => {
    fs.mkdirSync(path.join(tmpRoot, 'data/datasets'), { recursive: true })
    fs.writeFileSync(path.join(tmpRoot, 'data/datasets/qa_pairs.jsonl'), 'USER_EDITED')
    ensureSeeds()
    expect(fs.readFileSync(path.join(tmpRoot, 'data/datasets/qa_pairs.jsonl'), 'utf-8')).toBe('USER_EDITED')
  })

  it('restores deleted seed files on next run', () => {
    ensureSeeds()
    fs.unlinkSync(path.join(tmpRoot, 'data/schemas/qa_answer_v1.json'))
    expect(fs.existsSync(path.join(tmpRoot, 'data/schemas/qa_answer_v1.json'))).toBe(false)
    ensureSeeds()
    expect(fs.existsSync(path.join(tmpRoot, 'data/schemas/qa_answer_v1.json'))).toBe(true)
  })

  it('skips .gitkeep and other non-data files', () => {
    ensureSeeds()
    expect(fs.existsSync(path.join(tmpRoot, 'data/datasets/.gitkeep'))).toBe(false)
    expect(fs.existsSync(path.join(tmpRoot, 'data/schemas/.gitkeep'))).toBe(false)
  })

  it('copies sample images to public/sample-images/', () => {
    const fakeImgDir = path.join(tmpRoot, 'src/lib/seeds/images/refcoco')
    fs.mkdirSync(fakeImgDir, { recursive: true })
    fs.writeFileSync(path.join(fakeImgDir, 'fake.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))

    ensureSeeds()
    expect(fs.existsSync(path.join(tmpRoot, 'public/sample-images/refcoco/fake.jpg'))).toBe(true)
  })

  it('mirrors src/lib/seeds/results/<exp_id>/{results,annotations}.jsonl into data/results/<exp_id>/', () => {
    // 模拟 sample experiment 嵌套 ship
    const expDir = path.join(tmpRoot, 'src/lib/seeds/results/fake_baseline')
    fs.mkdirSync(expDir, { recursive: true })
    fs.writeFileSync(path.join(expDir, 'results.jsonl'), '{"task_id":"t1","status":"success"}\n')
    fs.writeFileSync(path.join(expDir, 'annotations.jsonl'), '{"annotation_id":"a1","task_id":"t1"}\n')

    ensureSeeds()

    expect(fs.existsSync(path.join(tmpRoot, 'data/results/fake_baseline/results.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(tmpRoot, 'data/results/fake_baseline/annotations.jsonl'))).toBe(true)
  })

  it('skips top-level .jsonl in seeds/results/ (only descends into <exp_id>/ subdirs)', () => {
    // 顶层散文件不会被 seed —— 强制 sample 走嵌套约定
    fs.mkdirSync(path.join(tmpRoot, 'src/lib/seeds/results'), { recursive: true })
    fs.writeFileSync(path.join(tmpRoot, 'src/lib/seeds/results/orphan.jsonl'), 'should not seed')

    ensureSeeds()

    expect(fs.existsSync(path.join(tmpRoot, 'data/results/orphan.jsonl'))).toBe(false)
  })

  it('does not overwrite existing nested results files (idempotent)', () => {
    const expDir = path.join(tmpRoot, 'src/lib/seeds/results/exp1')
    fs.mkdirSync(expDir, { recursive: true })
    fs.writeFileSync(path.join(expDir, 'results.jsonl'), 'SEED_VERSION\n')

    fs.mkdirSync(path.join(tmpRoot, 'data/results/exp1'), { recursive: true })
    fs.writeFileSync(path.join(tmpRoot, 'data/results/exp1/results.jsonl'), 'USER_EDITED\n')

    ensureSeeds()

    expect(fs.readFileSync(path.join(tmpRoot, 'data/results/exp1/results.jsonl'), 'utf-8')).toBe('USER_EDITED\n')
  })
})

function cpRecursive(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) cpRecursive(s, d)
    else fs.copyFileSync(s, d)
  }
}
