# opencode-image-mcp

A small MCP server (stdio, written in Rust) that exposes an image generation API as a `generate_image` tool for [OpenCode](https://opencode.ai).

It calls `POST {IMAGE_BASE_URL}/images/generations` (OpenAI-compatible), saves the result to disk and returns the file paths.

## Features

- `generate_image` tool with `prompt` and optional `model`, `reference_image`, `n`, `size`, `quality`, `background`, `image_detail`, `output_format`, `watermark`, `prompt_extend`
- Model is configured through the environment (`IMAGE_MODEL`), not hardcoded
- Reference image is read from a local file and sent as a data URI in the `image` field
- Handles both `b64_json` and `url` responses
- No API key in the code; it is read from the environment

## Build

```sh
cargo build --release
```

The binary is `target/release/opencode-image-mcp`.

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `IMAGE_API_KEY` | yes | — | Bearer token for the API |
| `IMAGE_BASE_URL` | yes | — | API base URL, e.g. `https://example.com/v1` |
| `IMAGE_MODEL` | no | — | Default model. Required if the tool call does not pass `model` |
| `IMAGE_OUTPUT_DIR` | no | `/tmp/opencode/images` | Where generated images are saved |

## OpenCode setup

Add a local MCP server to your `opencode.json` / `opencode.jsonc`:

```jsonc
{
  "mcp": {
    "image": {
      "type": "local",
      "command": ["/path/to/opencode-image-mcp"],
      "enabled": true,
      "environment": {
        "IMAGE_API_KEY": "{env:IMAGE_API_KEY}",
        "IMAGE_BASE_URL": "https://example.com/v1",
        "IMAGE_MODEL": "your-image-model",
        "IMAGE_OUTPUT_DIR": "/tmp/opencode/images"
      }
    }
  }
}
```

Prefer `{env:...}` references or a secrets file over putting the key directly in a config that is committed.

Check that it is connected:

```sh
opencode mcp list
```

## Usage

Ask the agent to generate an image, for example:

> Generate a 1024x1024 image of a lighthouse at dusk, using /tmp/ref.png as the reference.

The tool returns the saved file paths.

## Testing the protocol by hand

The server speaks MCP over stdio. A quick smoke test:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | IMAGE_API_KEY=... IMAGE_BASE_URL=... IMAGE_MODEL=... ./target/release/opencode-image-mcp
```

## OpenCode plugin (`image_generate_image`, `image_show_image`)

The plugin source is in `plugin/` in this repository. It is a separate package from the Rust MCP server.

### Install

1. Clone this repository. The plugin imports `@opencode/plugin`, which OpenCode provides. Make sure it is installed in `~/.config/opencode` (`npm install` there).
2. Choose one way to load the plugin:
   - **Path to the clone** (simplest): add the absolute path to the `plugins` array in your OpenCode config (or `conf/plugins.json` if you use config fragments):

     ```jsonc
     { "plugins": [ { "package": "/path/to/opencode-image-mcp/plugin", "options": { ... } } ] }
     ```

   - **Copy into the config** (what the author uses): copy `plugin/src/index.ts` and `plugin/package.json` to `~/.config/opencode/plugins/image/` and use `"package": "./plugins/image"`. This is a flat copy, so edit the copied `package.json`: set `"main": "./index.ts"`, `"exports": { ".": "./index.ts" }`, and `"files": ["index.ts"]`. Leaving `./src/index.ts` there prevents OpenCode from loading the plugin. Recopy `index.ts` when updating.
3. If you use this author's config-fragment layout (`conf/`, `scripts/build-config.mjs`, and the `build:config` npm script are part of the author's config repository, not built into OpenCode):
   - `plugins.json` (committable): the plugin entry and its non-secret options (`model`, `outputDir`, `previewMode`, `autoPreview`).
   - `secrets.json` (gitignored): the 9Router `baseURL` and `apiKey` under `providers.9router.settings`, plus the plugin `apiKey`. Copy `secrets.json.example` and fill in the placeholders.

   The plugin reads `providers.9router.settings.baseURL` when `generate_image` runs, after config overrides are applied, so the URL is set once. The `baseURL` option is only needed to point the image plugin at a different endpoint. Without a 9Router provider, set this option or `IMAGE_BASE_URL`.

   ```jsonc
   {
     "package": "./plugins/image",
     "options": {
       "model": "your-image-model",
       "outputDir": "/tmp/opencode/images",
       "previewMode": "overlay",
       "autoPreview": false,
       "apiKey": "..."
     }
   }
   ```

   With a standard OpenCode config, put the plugin entry in `opencode.jsonc` instead and use `"apiKey": "{env:IMAGE_API_KEY}"` to keep the token out of git.

4. With config fragments, rebuild the config: `cd ~/.config/opencode && npm run build:config`. Do not edit the generated `opencode.jsonc` directly.
5. OpenCode watches config changes; use `/reload` to force a reload without restarting the service. Ask the agent to call `image_generate_image` to verify actual generation, not just tool visibility.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `baseURL` | 9Router `baseURL`, then `IMAGE_BASE_URL` env | OpenAI-compatible API base URL override |
| `apiKey` | `IMAGE_API_KEY` env | Bearer token |
| `model` | `IMAGE_MODEL` env | Default model; the tool call can override it |
| `outputDir` | `/tmp/opencode/images` | Where images are saved |
| `previewMode` | `overlay` | `overlay` (kitty), `xdg-open`, or `none` |
| `autoPreview` | `true` | If `false`, `generate_image` only saves; use `show_image` to display |

### kitty preview

`overlay` needs kitty with remote control enabled in `kitty.conf`:

```
allow_remote_control yes
listen_on unix:@opencode-kitty-{kitty_pid}
```

Outside kitty the plugin falls back to `xdg-open`. Use `previewMode: "none"` for headless use.

`listen_on` takes effect in a new kitty process; reloading kitty's config does not change an existing process's listening socket.

### Plugin regression tests

Run these from the repository clone with Node.js 22.18+ (native TypeScript support). The tests mock the API and do not require credentials:

```sh
cd plugin
npm install
npm test
```

## Roadmap

- Additional providers (e.g. Codex image generation) behind the same tool interface
- Inline image preview in the terminal (kitty graphics protocol)

## License

MIT
