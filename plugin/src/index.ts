import { Plugin } from "@opencode/plugin"
import { spawn } from "node:child_process"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, extname, join, resolve } from "node:path"

type PreviewMode = "overlay" | "xdg-open" | "none"

type Options = {
  preview?: boolean
  autoPreview?: boolean
  previewMode?: PreviewMode
  model?: string
  outputDir?: string
  baseURL?: string
  apiKey?: string
}

type GenerateInput = {
  prompt: string
  model?: string
  reference_image?: string
  n?: number
  size?: string
  quality?: string
  background?: string
  image_detail?: string
  output_format?: string
  watermark?: boolean
  prompt_extend?: boolean
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}

const PASSTHROUGH = [
  "n",
  "size",
  "quality",
  "background",
  "image_detail",
  "output_format",
  "watermark",
  "prompt_extend",
] as const

const GENERATE_SCHEMA = {
  type: "object",
  properties: {
    prompt: { type: "string", description: "Text description of the image to generate." },
    model: { type: "string", description: "Model ID. Defaults to the plugin's model option." },
    reference_image: {
      type: "string",
      description: "Local path to a reference image (png, jpg, webp, gif). Sent to the API as the `image` field.",
    },
    n: { type: "integer", description: "Number of images to generate." },
    size: { type: "string", description: 'Image size, e.g. "auto" or "1024x1024".' },
    quality: { type: "string", description: 'Quality level, e.g. "auto", "high".' },
    background: { type: "string", description: 'Background type, e.g. "auto", "transparent".' },
    image_detail: { type: "string", description: 'Detail level for the input image, e.g. "high".' },
    output_format: { type: "string", description: 'Output file format, e.g. "png", "jpeg", "webp".' },
    watermark: { type: "boolean", description: "Whether to add a watermark." },
    prompt_extend: { type: "boolean", description: "Whether the provider may extend the prompt." },
  },
  required: ["prompt"],
  additionalProperties: false,
}

const SHOW_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string", description: "Path to an image file to display." },
  },
  required: ["path"],
  additionalProperties: false,
}

const expandHome = (p: string) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p)

function toDataUri(bytes: Buffer, path: string): string {
  const mime = MIME[extname(path).slice(1).toLowerCase()]
  if (!mime) throw new Error(`unsupported image type: ${path}`)
  return `data:${mime};base64,${bytes.toString("base64")}`
}

async function generate(input: GenerateInput, opts: Options, signal: AbortSignal) {
  const baseURL = (opts.baseURL ?? process.env.IMAGE_BASE_URL ?? "").replace(/\/$/, "")
  const apiKey = opts.apiKey ?? process.env.IMAGE_API_KEY
  const model = input.model ?? opts.model ?? process.env.IMAGE_MODEL
  if (!baseURL) throw new Error("image base URL is not set (plugin option baseURL or IMAGE_BASE_URL)")
  if (!apiKey) throw new Error("image API key is not set (plugin option apiKey or IMAGE_API_KEY)")
  if (!model) throw new Error("no model: pass `model` or set the plugin option model / IMAGE_MODEL")

  const body: Record<string, unknown> = { model, prompt: input.prompt }
  if (input.reference_image) {
    const path = expandHome(input.reference_image)
    body.image = toDataUri(await readFile(path), path)
  }
  for (const key of PASSTHROUGH) {
    if (input[key] !== undefined) body[key] = input[key]
  }

  const resp = await fetch(`${baseURL}/images/generations`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
  const text = await resp.text()
  if (!resp.ok) throw new Error(`image API returned ${resp.status}: ${text}`)

  const data = JSON.parse(text)?.data
  if (!Array.isArray(data)) throw new Error("response has no `data` array")

  const dir = expandHome(opts.outputDir ?? process.env.IMAGE_OUTPUT_DIR ?? "/tmp/opencode/images")
  await mkdir(dir, { recursive: true })
  const ext = input.output_format ?? "png"
  const stamp = Date.now()

  const paths: string[] = []
  for (const [i, item] of data.entries()) {
    const path = join(dir, `image-${stamp}-${i}.${ext}`)
    if (item.b64_json) {
      await writeFile(path, Buffer.from(item.b64_json, "base64"))
    } else if (item.url) {
      const img = await fetch(item.url, { signal })
      if (!img.ok) throw new Error(`downloading result ${i} failed: ${img.status}`)
      await writeFile(path, Buffer.from(await img.arrayBuffer()))
    } else {
      throw new Error(`result ${i} has neither b64_json nor url`)
    }
    paths.push(path)
  }
  return { model, paths }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true })
    child.on("error", fail)
    child.on("spawn", () => {
      child.unref()
      done()
    })
  })
}

function runWait(cmd: string, args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { stdio: "ignore" })
    child.on("error", fail)
    child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`${cmd} exited with ${code}`))))
  })
}

type Shown = "overlay" | "xdg-open"

async function preview(path: string, mode: Exclude<PreviewMode, "none">): Promise<Shown> {
  if (mode === "overlay") {
    if (!process.env.KITTY_WINDOW_ID) {
      console.warn("[image] not running inside kitty, falling back to xdg-open")
    } else {
      try {
        await runWait("kitten", [
          "@",
          "launch",
          "--type=overlay",
          "--title",
          `image: ${basename(path)}`,
          "kitten",
          "icat",
          "--hold",
          path,
        ])
        return "overlay"
      } catch (err) {
        console.warn(`[image] kitty overlay failed (${err}), falling back to xdg-open`)
      }
    }
  }
  await run("xdg-open", [path])
  return "xdg-open"
}

export default Plugin.define({
  id: "image",
  async setup(ctx) {
    const opts = (ctx.options ?? {}) as Options
    const previewMode: PreviewMode = opts.preview === false ? "none" : (opts.previewMode ?? "overlay")

    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "image", description: "Image generation" })

      editor.add({
        name: "generate_image",
        description:
          "Generate an image from a text prompt, optionally guided by a reference image. Saves the result to disk and returns the file paths. Use show_image with a returned path to display it to the user when they ask.",
        input: GENERATE_SCHEMA,
        options: { namespace: "image", codemode: false },
        execute: async (input, context) => {
          const { model, paths } = await generate(input as GenerateInput, opts, context.signal)
          if (previewMode !== "none" && opts.autoPreview !== false) {
            for (const path of paths) {
              await preview(path, previewMode).catch((err) => console.warn(`[image] preview failed: ${err}`))
            }
          }
          return {
            content: `Generated ${paths.length} image(s) with ${model}:\n${paths.join("\n")}`,
          }
        },
      })

      editor.add({
        name: "show_image",
        description:
          "Show an image file to the user in a kitty overlay (or the desktop viewer as a fallback). Use it to display an image the user asked to see, including images returned by generate_image.",
        input: SHOW_SCHEMA,
        options: { namespace: "image", codemode: false },
        execute: async (input) => {
          const path = resolve(expandHome((input as { path: string }).path))
          await stat(path)
          if (previewMode === "none") {
            return { content: `Preview is disabled (previewMode: none). File: ${path}` }
          }
          const shown = await preview(path, previewMode)
          return { content: `Opened ${path} (${shown})` }
        },
      })
    })

  },
})
