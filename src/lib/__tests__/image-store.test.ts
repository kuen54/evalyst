import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { saveImagesForTask, assignImagePathsToOutput } from '../image-store'
import type { JsonSchemaDef } from '../schema/types'

describe('saveImagesForTask', () => {
  let tmpDir: string
  let originalCwd: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-store-test-'))
    originalCwd = process.cwd()
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('decodes data URL and writes to disk', async () => {
    // 1x1 transparent PNG (base64)
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const result = await saveImagesForTask({
      experimentId: 'exp1',
      taskId: 'task1',
      images: [{ url: `data:image/png;base64,${tinyPng}`, mime_type: 'image/png' }],
    })

    expect(result).toEqual(['/api/results/exp1/images/task1_0.png'])

    // verify file exists on disk
    const expectedPath = path.join(tmpDir, 'data', 'results', 'exp1', 'images', 'task1_0.png')
    expect(fs.existsSync(expectedPath)).toBe(true)
    expect(fs.statSync(expectedPath).size).toBeGreaterThan(0)
  })

  it('handles multiple images with idx suffix', async () => {
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const result = await saveImagesForTask({
      experimentId: 'exp1',
      taskId: 'task1',
      images: [
        { url: `data:image/png;base64,${tinyPng}`, mime_type: 'image/png' },
        { url: `data:image/jpeg;base64,${tinyPng}`, mime_type: 'image/jpeg' },
      ],
    })

    expect(result).toEqual([
      '/api/results/exp1/images/task1_0.png',
      '/api/results/exp1/images/task1_1.jpg',
    ])
  })

  it('defaults to .png when mime_type unknown', async () => {
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const result = await saveImagesForTask({
      experimentId: 'exp1',
      taskId: 'task1',
      images: [{ url: `data:application/octet-stream;base64,${tinyPng}` }],
    })
    expect(result[0]).toMatch(/\.png$/)
  })

  it('returns empty array when no images provided', async () => {
    const result = await saveImagesForTask({ experimentId: 'exp1', taskId: 'task1', images: [] })
    expect(result).toEqual([])
  })
})

describe('assignImagePathsToOutput', () => {
  it('assigns first path to image_url field', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        caption: { type: 'string' },
        image_url: { type: 'image_url' },
      },
    }
    const output = { caption: 'A red apple' }
    const result = assignImagePathsToOutput(output, schema, ['/api/x/img/y_0.png'])
    expect(result).toEqual({ caption: 'A red apple', image_url: '/api/x/img/y_0.png' })
  })

  it('assigns full array to image_url_list field', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        images: { type: 'image_url_list' },
      },
    }
    const result = assignImagePathsToOutput({}, schema, ['/a.png', '/b.png', '/c.png'])
    expect(result).toEqual({ images: ['/a.png', '/b.png', '/c.png'] })
  })

  it('leaves output untouched when schema has no image fields', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: { answer: { type: 'string' } },
    }
    const result = assignImagePathsToOutput({ answer: 'hi' }, schema, ['/a.png'])
    expect(result).toEqual({ answer: 'hi' })
  })

  it('handles missing schema.properties', () => {
    const schema: JsonSchemaDef = { type: 'object' }
    const result = assignImagePathsToOutput({ foo: 1 }, schema, ['/a.png'])
    expect(result).toEqual({ foo: 1 })
  })
})
