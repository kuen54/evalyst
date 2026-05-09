import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

const EXP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const FILENAME_PATTERN = /^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp|gif)$/

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ exp_id: string; filename: string }> },
) {
  const { exp_id, filename } = await params
  if (!EXP_ID_PATTERN.test(exp_id)) {
    return new NextResponse('invalid exp_id', { status: 400 })
  }
  if (!FILENAME_PATTERN.test(filename)) {
    return new NextResponse('invalid filename', { status: 400 })
  }
  const fullPath = path.join(process.cwd(), 'data', 'results', exp_id, 'images', filename)
  // Defense in depth: ensure resolved path stays within imagesDir
  const expectedDir = path.join(process.cwd(), 'data', 'results', exp_id, 'images')
  const resolved = path.resolve(fullPath)
  if (!resolved.startsWith(path.resolve(expectedDir))) {
    return new NextResponse('forbidden', { status: 403 })
  }
  try {
    const buf = await fs.readFile(fullPath)
    const ext = filename.split('.').pop()!.toLowerCase()
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
    // Buffer → Uint8Array → BodyInit (Next.js 16 / Web APIs accept Uint8Array)
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return new NextResponse('not found', { status: 404 })
    }
    return new NextResponse('error', { status: 500 })
  }
}
