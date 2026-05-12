import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { NextRequest } from "next/server"
import { PATCH } from "../route"
import type { ExperimentConfig } from "@/lib/types"

let tmp = ""
let origCwd = ""

beforeEach(() => {
  origCwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "exp-patch-"))
  fs.mkdirSync(path.join(tmp, "data", "experiments"), { recursive: true })
  fs.mkdirSync(path.join(tmp, "data", "results"), { recursive: true })
  process.chdir(tmp)

  const exp: ExperimentConfig = {
    id: "exp_real",
    name: "real",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    schema_id: "s1",
    model: "m1",
    temperature: 1,
    max_tokens: 100,
    api_config: { base_url: "https://x", api_key: "secret-key" },
    prompt_template: "",
    status: "completed",
  }
  fs.writeFileSync(
    path.join(tmp, "data", "experiments", "exp_real.json"),
    JSON.stringify(exp, null, 2),
  )
})

afterEach(() => {
  process.chdir(origCwd)
  fs.rmSync(tmp, { recursive: true, force: true })
})

function makeRequest(urlId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/experiments/${urlId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

describe("PATCH /api/experiments/[id] · id-mismatch gate", () => {
  it("rejects body.id that mismatches the URL id (regression for path traversal)", async () => {
    // Pre-fix: body.id="../llm-config" would shadow config.id and writeExperiment
    // would dump the config to data/llm-config.json, killing all stored API keys.
    // Post-fix: 400 'id mismatch' before updateExperiment is even called.
    const req = makeRequest("exp_real", { id: "../llm-config", status: "draft" })
    const res = await PATCH(req, { params: Promise.resolve({ id: "exp_real" }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("id mismatch")

    // Crucial: nothing escaped — no llm-config.json was written outside the
    // intended dir, and the original experiment file is untouched.
    expect(fs.existsSync(path.join(tmp, "data", "llm-config.json"))).toBe(false)
    const original = JSON.parse(
      fs.readFileSync(path.join(tmp, "data", "experiments", "exp_real.json"), "utf-8"),
    )
    expect(original.id).toBe("exp_real")
    expect(original.status).toBe("completed")
  })

  it("rejects body.id even when it points to a sibling experiment", async () => {
    const req = makeRequest("exp_real", { id: "exp_other", name: "renamed" })
    const res = await PATCH(req, { params: Promise.resolve({ id: "exp_real" }) })
    expect(res.status).toBe(400)
  })

  it("accepts a body without id (the typical UI shape)", async () => {
    const req = makeRequest("exp_real", { name: "renamed" })
    const res = await PATCH(req, { params: Promise.resolve({ id: "exp_real" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe("exp_real")
    expect(body.name).toBe("renamed")
  })

  it("accepts a body with matching id", async () => {
    const req = makeRequest("exp_real", { id: "exp_real", name: "renamed" })
    const res = await PATCH(req, { params: Promise.resolve({ id: "exp_real" }) })
    expect(res.status).toBe(200)
  })

  it("returns 404 before the id-mismatch check when the experiment is missing", async () => {
    // Order: existence first, then id-mismatch. Reflects the route handler.
    const req = makeRequest("exp_missing", { id: "../llm-config" })
    const res = await PATCH(req, { params: Promise.resolve({ id: "exp_missing" }) })
    expect(res.status).toBe(404)
  })
})
