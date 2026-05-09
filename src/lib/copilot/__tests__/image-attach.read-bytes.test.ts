import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { readImageBytes, resolveImageDiskPath } from '@/lib/copilot/image-attach'

let tmp = ''
let origCwd = ''

beforeEach(() => {
  origCwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-attach-'))
  fs.mkdirSync(path.join(tmp, 'data', 'results', 'exp_test', 'images'), { recursive: true })
  process.chdir(tmp)
})

afterEach(() => {
  process.chdir(origCwd)
  fs.rmSync(tmp, { recursive: true, force: true })
})

const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

describe('readImageBytes', () => {
  it('passes through a data: URL without filesystem access', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const out = await readImageBytes({ url: dataUrl, source_label: 'x' })
    expect(out).toEqual({ data_url: dataUrl })
  })

  it('reads a real file off disk and emits data:image/png;base64,...', async () => {
    const target = path.join(tmp, 'data', 'results', 'exp_test', 'images', 'foo.png')
    fs.writeFileSync(target, ONE_PX_PNG)
    const out = await readImageBytes({ url: '/api/results/exp_test/images/foo.png', source_label: 'x' })
    expect(out).toEqual({ data_url: `data:image/png;base64,${ONE_PX_PNG.toString('base64')}` })
  })

  it('emits {error} for missing file (ENOENT)', async () => {
    const out = await readImageBytes({ url: '/api/results/exp_test/images/missing.png', source_label: 'x' })
    expect('error' in out).toBe(true)
    expect((out as { error: string }).error).toMatch(/ENOENT|no such file/i)
  })

  it('rejects path traversal attempts', async () => {
    const out = await readImageBytes({ url: '/api/results/../../../etc/passwd', source_label: 'x' })
    expect('error' in out).toBe(true)
  })

  it('mime-by-ext: .jpg → image/jpeg', async () => {
    const target = path.join(tmp, 'data', 'results', 'exp_test', 'images', 'foo.jpg')
    fs.writeFileSync(target, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    const out = await readImageBytes({ url: '/api/results/exp_test/images/foo.jpg', source_label: 'x' })
    expect((out as { data_url: string }).data_url.startsWith('data:image/jpeg;base64,')).toBe(true)
  })

  it('mime-by-ext: .webp → image/webp', async () => {
    const target = path.join(tmp, 'data', 'results', 'exp_test', 'images', 'foo.webp')
    fs.writeFileSync(target, Buffer.from('RIFF????WEBP', 'binary'))
    const out = await readImageBytes({ url: '/api/results/exp_test/images/foo.webp', source_label: 'x' })
    expect((out as { data_url: string }).data_url.startsWith('data:image/webp;base64,')).toBe(true)
  })

  it('rejects file with disallowed extension via the path resolver', async () => {
    const out = await readImageBytes({ url: '/api/results/exp_test/images/passwd.txt', source_label: 'x' })
    expect('error' in out).toBe(true)
  })
})

describe('resolveImageDiskPath (path traversal regex)', () => {
  it('accepts a clean filename', () => {
    const p = resolveImageDiskPath('/api/results/exp_test/images/foo.png')
    expect(p).toBe(path.join(process.cwd(), 'data', 'results', 'exp_test', 'images', 'foo.png'))
  })

  it('rejects ".." path components', () => {
    expect(resolveImageDiskPath('/api/results/exp_test/images/../foo.png')).toBeNull()
  })

  it('rejects non-image extension', () => {
    expect(resolveImageDiskPath('/api/results/exp_test/images/foo.txt')).toBeNull()
  })

  it('rejects non-conforming experiment id', () => {
    expect(resolveImageDiskPath('/api/results/exp/test/images/foo.png')).toBeNull()
  })

  it('returns null for non-/api/results URL shapes', () => {
    expect(resolveImageDiskPath('https://cdn.example.com/x.png')).toBeNull()
    expect(resolveImageDiskPath('images/foo.png')).toBeNull()
  })
})
