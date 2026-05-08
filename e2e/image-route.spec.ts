import { test, expect } from '@playwright/test'

test('image route returns 400 for invalid exp_id', async ({ request }) => {
  const res = await request.get('/api/results/..%2F..%2Fevil/images/x.png')
  expect(res.status()).toBe(400)
})

test('image route returns 400 for invalid filename', async ({ request }) => {
  const res = await request.get('/api/results/abc/images/no_extension')
  expect(res.status()).toBe(400)
})

test('image route returns 404 for missing file', async ({ request }) => {
  const res = await request.get('/api/results/nonexistent_exp_xyz/images/missing_0.png')
  expect(res.status()).toBe(404)
})
