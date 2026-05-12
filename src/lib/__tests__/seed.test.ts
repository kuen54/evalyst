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
