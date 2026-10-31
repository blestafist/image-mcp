import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import image from "../src/index.ts"

const bytes = Buffer.from("generated image")

async function harness(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "opencode-image-test-"))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const env = process.env.IMAGE_BASE_URL
  delete process.env.IMAGE_BASE_URL
  t.after(() => {
    if (env === undefined) delete process.env.IMAGE_BASE_URL
    else process.env.IMAGE_BASE_URL = env
  })

  const state = { baseURL: "https://router.example/v1/", error: undefined, noSettings: false }
  const get = t.mock.fn(async (input) => {
    assert.equal(input.providerID, "9router")
    if (state.error) throw state.error
    return { location: {}, data: { settings: state.noSettings ? undefined : { baseURL: state.baseURL } } }
  })
  const requests = []
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, ...init, body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }))
  })

  const tools = new Map()
  await image.setup({
    options: {
      apiKey: "test-key",
      model: "test-model",
      autoPreview: false,
      outputDir: dir,
      ...options,
    },
    provider: { get },
    tool: {
      transform: async (edit) => edit({
        namespace() {},
        add(tool) { tools.set(`${tool.options.namespace}_${tool.name}`, tool) },
      }),
    },
  })

  const signal = new AbortController().signal
  const generate = (input = { prompt: "test image" }) => tools.get("image_generate_image").execute(input, { signal })
  return { state, get, requests, tools, signal, generate }
}

test("reads configured provider only at execution and refreshes it for each call", async (t) => {
  const h = await harness(t)
  assert.equal(h.get.mock.callCount(), 0)
  process.env.IMAGE_BASE_URL = "https://env.example/v1"

  const result = await h.generate()
  assert.equal(h.requests[0].url, "https://router.example/v1/images/generations")
  assert.equal(h.requests[0].headers.authorization, "Bearer test-key")
  assert.equal(h.requests[0].signal, h.signal)
  assert.equal(h.tools.get("image_generate_image").options.codemode, false)
  assert.ok(h.tools.has("image_show_image"))
  const path = result.content.split("\n")[1]
  assert.deepEqual(await readFile(path), bytes)

  h.state.baseURL = "https://updated-router.example/v1"
  await h.generate()
  assert.equal(h.requests[1].url, "https://updated-router.example/v1/images/generations")
  assert.equal(h.get.mock.callCount(), 2)
})

test("explicit baseURL overrides provider and environment without reading the provider", async (t) => {
  const h = await harness(t, { baseURL: "https://override.example/v1/" })
  h.state.error = new Error("provider must not be read")
  process.env.IMAGE_BASE_URL = "https://env.example/v1"
  await h.generate()
  assert.equal(h.get.mock.callCount(), 0)
  assert.equal(h.requests[0].url, "https://override.example/v1/images/generations")
})

test("falls back to IMAGE_BASE_URL when 9Router is unavailable", async (t) => {
  const h = await harness(t)
  h.state.error = new Error("provider not found")
  process.env.IMAGE_BASE_URL = "https://env.example/v1"
  await h.generate()
  assert.equal(h.requests[0].url, "https://env.example/v1/images/generations")
})

test("falls back to IMAGE_BASE_URL when provider baseURL is absent or not a string", async (t) => {
  const h = await harness(t)
  process.env.IMAGE_BASE_URL = "https://env.example/v1"
  for (const value of [undefined, 42]) {
    h.state.baseURL = value
    await h.generate()
  }
  assert.equal(h.requests.length, 2)
  for (const request of h.requests) {
    assert.equal(request.url, "https://env.example/v1/images/generations")
  }
})

test("missing URL reports all configuration sources without sending a request", async (t) => {
  const h = await harness(t)
  h.state.error = new Error("provider not found")
  await assert.rejects(h.generate(), /plugin option baseURL, providers\.9router\.settings\.baseURL or IMAGE_BASE_URL/)
  assert.equal(h.requests.length, 0)
})

test("provider without settings still uses the environment fallback", async (t) => {
  const h = await harness(t)
  h.state.noSettings = true
  process.env.IMAGE_BASE_URL = "https://env.example/v1"
  await h.generate()
  assert.equal(h.requests[0].url, "https://env.example/v1/images/generations")
})
