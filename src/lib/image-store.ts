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
    const ext = extFor(img.mime_type)
    const filename = `${args.taskId}_${i}${ext}`
    const fullPath = path.join(dir, filename)

    let buf: Buffer
    if (img.url.startsWith('data:')) {
      const base64Match = /^data:[^;]+;base64,(.*)$/.exec(img.url)
      if (!base64Match) throw new Error(`saveImagesForTask: malformed data URL at index ${i}`)
      buf = Buffer.from(base64Match[1], 'base64')
    } else if (img.url.startsWith('http://') || img.url.startsWith('https://')) {
      const resp = await fetch(img.url)
      if (!resp.ok) throw new Error(`saveImagesForTask: HTTP ${resp.status} fetching ${img.url}`)
      buf = Buffer.from(await resp.arrayBuffer())
    } else {
      throw new Error(`saveImagesForTask: unsupported url scheme at index ${i}`)
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
