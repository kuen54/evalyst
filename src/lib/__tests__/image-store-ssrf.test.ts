import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { assertSafeImageUrl, UnsafeImageUrlError, saveImagesForTask } from '../image-store'

describe('assertSafeImageUrl', () => {
  describe('allowed', () => {
    it('accepts data:image/png base64', () => {
      expect(() => assertSafeImageUrl('data:image/png;base64,iVBORw0KGgo=')).not.toThrow()
    })
    it('accepts https:// public host', () => {
      expect(() => assertSafeImageUrl('https://example.com/img.png')).not.toThrow()
    })
    it('accepts https:// public IPv4 (172.32 is outside RFC1918 16-31)', () => {
      expect(() => assertSafeImageUrl('https://172.32.5.5/img')).not.toThrow()
    })
  })

  describe('rejected schemes', () => {
    it('rejects http:// even with public host', () => {
      expect(() => assertSafeImageUrl('http://example.com/img')).toThrow(UnsafeImageUrlError)
    })
    it('rejects file://', () => {
      expect(() => assertSafeImageUrl('file:///etc/passwd')).toThrow(UnsafeImageUrlError)
    })
    it('rejects ftp://', () => {
      expect(() => assertSafeImageUrl('ftp://example.com/img')).toThrow(UnsafeImageUrlError)
    })
    it('rejects gopher://', () => {
      expect(() => assertSafeImageUrl('gopher://example.com/9/foo')).toThrow(UnsafeImageUrlError)
    })
    it('rejects malformed URL', () => {
      expect(() => assertSafeImageUrl('not-a-url')).toThrow(UnsafeImageUrlError)
    })
  })

  describe('rejected hosts (IPv4)', () => {
    it('rejects https://localhost', () => {
      expect(() => assertSafeImageUrl('https://localhost/img')).toThrow(/localhost/)
    })
    it('rejects https://127.0.0.1 (loopback)', () => {
      expect(() => assertSafeImageUrl('https://127.0.0.1/img')).toThrow(/127\.0\.0\.1/)
    })
    it('rejects https://10.0.0.1 (RFC1918 /8)', () => {
      expect(() => assertSafeImageUrl('https://10.0.0.1/img')).toThrow(UnsafeImageUrlError)
    })
    it('rejects https://192.168.1.1 (RFC1918 /16)', () => {
      expect(() => assertSafeImageUrl('https://192.168.1.1/img')).toThrow(UnsafeImageUrlError)
    })
    it('rejects https://172.16.5.5 (RFC1918 /12 lower bound)', () => {
      expect(() => assertSafeImageUrl('https://172.16.5.5/img')).toThrow(UnsafeImageUrlError)
    })
    it('rejects https://172.31.5.5 (RFC1918 /12 upper bound)', () => {
      expect(() => assertSafeImageUrl('https://172.31.5.5/img')).toThrow(UnsafeImageUrlError)
    })
    it('rejects https://169.254.169.254 (cloud metadata)', () => {
      expect(() => assertSafeImageUrl('https://169.254.169.254/latest/meta-data')).toThrow(/169\.254/)
    })
    it('rejects https://0.0.0.0', () => {
      expect(() => assertSafeImageUrl('https://0.0.0.0/img')).toThrow(UnsafeImageUrlError)
    })
    it('rejects https://224.0.0.1 (multicast)', () => {
      expect(() => assertSafeImageUrl('https://224.0.0.1/img')).toThrow(UnsafeImageUrlError)
    })
  })

  describe('rejected hosts (IPv6)', () => {
    it('rejects https://[::1] (loopback)', () => {
      expect(() => assertSafeImageUrl('https://[::1]/img')).toThrow(/::1/)
    })
    it('rejects https://[fe80::1] (link-local)', () => {
      expect(() => assertSafeImageUrl('https://[fe80::1]/img')).toThrow(/fe80/)
    })
    it('rejects https://[fc00::1] (ULA fc range)', () => {
      expect(() => assertSafeImageUrl('https://[fc00::1]/img')).toThrow(UnsafeImageUrlError)
    })
    it('rejects https://[fd12::1] (ULA fd range)', () => {
      expect(() => assertSafeImageUrl('https://[fd12::1]/img')).toThrow(UnsafeImageUrlError)
    })
    it('rejects IPv4-mapped IPv6 with private v4 (::ffff:10.0.0.1)', () => {
      expect(() => assertSafeImageUrl('https://[::ffff:10.0.0.1]/img')).toThrow(UnsafeImageUrlError)
    })
  })
})

describe('saveImagesForTask SSRF integration', () => {
  let tmpDir: string
  let originalCwd: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-ssrf-'))
    originalCwd = process.cwd()
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('refuses unsafe url before any network IO', async () => {
    // If the static check leaked, fetch() would attempt the request and
    // throw a different error (ECONNREFUSED or HTTP status). We only
    // accept UnsafeImageUrlError, which proves the refusal happened
    // before reaching the network layer.
    await expect(
      saveImagesForTask({
        experimentId: 'exp1',
        taskId: 'task1',
        images: [{ url: 'http://169.254.169.254/latest/meta-data', mime_type: 'image/png' }],
      }),
    ).rejects.toThrow(UnsafeImageUrlError)

    // Side-effect check: nothing on disk for this task.
    const dir = path.join(tmpDir, 'data', 'results', 'exp1', 'images')
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([])
  })

  it('refuses file:// URL', async () => {
    await expect(
      saveImagesForTask({
        experimentId: 'exp1',
        taskId: 'task1',
        images: [{ url: 'file:///etc/passwd' }],
      }),
    ).rejects.toThrow(UnsafeImageUrlError)
  })
})
