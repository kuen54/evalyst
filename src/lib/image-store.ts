import fs from 'fs/promises'
import path from 'path'
import type { JsonSchemaDef } from './schema/types'
import { ensureDir } from './fs-utils'

export interface ImagePayload {
  url: string                 // 'data:image/png;base64,...' OR 'https://...'
  mime_type?: string
}

export interface SaveImagesArgs {
  experimentId: string
  taskId: string
  images: ImagePayload[]
}

export class UnsafeImageUrlError extends Error {
  constructor(reason: string) {
    super(`UNSAFE_IMAGE_URL: ${reason}`)
    this.name = 'UnsafeImageUrlError'
  }
}

/**
 * SSRF defense for LLM-returned image URLs (PR fix/image-url-ssrf, v0.11):
 *
 * Allowed:
 *   - `data:image/*;base64,…` (handled by caller before reaching the network)
 *   - `https://<public-host>/…`
 *
 * Rejected:
 *   - Any non-https remote scheme (`http:` `file:` `ftp:` `gopher:` …) —
 *     plaintext is wasteful for production fetch and `file:` is direct LFI.
 *   - https URLs whose host is a private/loopback/link-local/multicast
 *     IP literal (IPv4 + IPv6) or the literal "localhost".
 *
 * Static check only — we do NOT resolve DNS and verify the resolved IP.
 * That defense (DNS rebinding) is documented in the cleanup spec as a
 * future hardening; the current attack model is "malicious or compromised
 * LLM hands us a URL", which a static IP-literal check stops cold for the
 * cases the cleanup spec called out (cloud metadata 169.254.169.254,
 * RFC1918, loopback).
 *
 * Throws UnsafeImageUrlError; the caller (saveImagesForTask) lets it
 * bubble up to batch-runner where it's recorded as task.error.
 */
export function assertSafeImageUrl(rawUrl: string): void {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new UnsafeImageUrlError('malformed URL')
  }

  if (url.protocol === 'data:') return

  if (url.protocol !== 'https:') {
    throw new UnsafeImageUrlError(`only https:// and data: schemes are allowed (got ${url.protocol})`)
  }

  // URL.hostname returns IPv6 wrapped in [] per WHATWG. Strip them so the
  // checks below operate on the bare host token.
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost') {
    throw new UnsafeImageUrlError('localhost is not allowed')
  }

  if (isPrivateIpv4(host)) {
    throw new UnsafeImageUrlError(`private or reserved IPv4 ${host}`)
  }

  if (host.includes(':')) {
    // Loopback / unspecified.
    if (host === '::1' || host === '::') {
      throw new UnsafeImageUrlError(`loopback IPv6 ${host}`)
    }
    // Link-local (fe80::/10) and ULA (fc00::/7 = fc.. or fd..).
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
      throw new UnsafeImageUrlError(`private or link-local IPv6 ${host}`)
    }
    // IPv4-mapped IPv6 — two forms reach us:
    //   - dotted: ::ffff:10.0.0.1 (literal in input)
    //   - hex-compacted: ::ffff:a00:1 (Node's URL parser normalizes to this)
    const mappedDotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host)
    if (mappedDotted && isPrivateIpv4(mappedDotted[1])) {
      throw new UnsafeImageUrlError(`private IPv4-mapped IPv6 ${host}`)
    }
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
    if (mappedHex) {
      const high = parseInt(mappedHex[1], 16)
      const low = parseInt(mappedHex[2], 16)
      const v4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
      if (isPrivateIpv4(v4)) {
        throw new UnsafeImageUrlError(`private IPv4-mapped IPv6 ${host} (decodes to ${v4})`)
      }
    }
  }
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const [a, b] = m.slice(1, 3).map(Number)
  if (a === undefined || b === undefined) return false
  // 0.0.0.0/8        — "this network"
  // 10.0.0.0/8       — RFC1918
  // 127.0.0.0/8      — loopback
  // 169.254.0.0/16   — link-local incl. cloud metadata 169.254.169.254
  // 172.16.0.0/12    — RFC1918
  // 192.168.0.0/16   — RFC1918
  // 224.0.0.0+       — multicast / reserved
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

function extFor(mime?: string): string {
  if (!mime) return '.png'
  return MIME_TO_EXT[mime.toLowerCase()] ?? '.png'
}

function imagesDir(experimentId: string): string {
  return path.join(process.cwd(), 'data', 'results', experimentId, 'images')
}

/**
 * Decode data URLs (or fetch HTTPS URLs) and write to
 * data/results/{experimentId}/images/{taskId}_{idx}.{ext}.
 *
 * Returns absolute API URLs (e.g. "/api/results/exp1/images/task1_0.png")
 * suitable for direct use as <img src> in the UI — no relative-path resolution
 * needed at render time.
 *
 * Uses fs.writeFile directly (not writeAtomic) — image files are atomic by
 * convention (one writer, one task_id+idx); a torn write would manifest as
 * a corrupt PNG which the user immediately notices.
 */
export async function saveImagesForTask(args: SaveImagesArgs): Promise<string[]> {
  if (args.images.length === 0) return []
  const dir = imagesDir(args.experimentId)
  ensureDir(dir)
  const out: string[] = []
  for (let i = 0; i < args.images.length; i++) {
    const img = args.images[i]
    // Static SSRF gate — runs for every URL, before any network IO.
    // data: URLs are allowed (handled below); https:// is allowed only
    // for non-private hosts; everything else throws.
    assertSafeImageUrl(img.url)
    const ext = extFor(img.mime_type)
    const filename = `${args.taskId}_${i}${ext}`
    const fullPath = path.join(dir, filename)

    let buf: Buffer
    if (img.url.startsWith('data:')) {
      const base64Match = /^data:[^;]+;base64,(.*)$/.exec(img.url)
      if (!base64Match) throw new Error(`saveImagesForTask: malformed data URL at index ${i}`)
      buf = Buffer.from(base64Match[1], 'base64')
    } else {
      // assertSafeImageUrl above guarantees protocol === 'https:' at this point.
      const resp = await fetch(img.url)
      if (!resp.ok) throw new Error(`saveImagesForTask: HTTP ${resp.status} fetching ${img.url}`)
      buf = Buffer.from(await resp.arrayBuffer())
    }

    await fs.writeFile(fullPath, buf)
    out.push(`/api/results/${args.experimentId}/images/${filename}`)
  }
  return out
}

/**
 * Assign saved image URLs to fields declared as image_url / image_url_list
 * in the output schema. Single image_url gets paths[0]; image_url_list gets
 * the full array. Multiple image_url fields each get one image (in declaration
 * order). Mutates a copy and returns it.
 */
export function assignImagePathsToOutput(
  output: Record<string, unknown>,
  schema: JsonSchemaDef,
  paths: string[],
): Record<string, unknown> {
  if (!schema.properties || paths.length === 0) return { ...output }
  const result: Record<string, unknown> = { ...output }
  let cursor = 0
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (prop.type === 'image_url') {
      if (cursor < paths.length) {
        result[name] = paths[cursor]
        cursor++
      }
    } else if (prop.type === 'image_url_list') {
      result[name] = paths.slice(cursor)
      cursor = paths.length
    }
  }
  return result
}
