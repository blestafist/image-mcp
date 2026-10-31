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

1. Clone this repository and install the plugin's dependencies is not needed: OpenCode provides `@opencode/plugin`, but it must resolve from the OpenCode config directory.
2. Choose one way to load the plugin:
   - **Path to the clone** (simplest): in `~/.config/opencode/conf/secrets.json` (gitignored) use the absolute path:

     ```jsonc
     { "plugins": [ { "package": "/path/to/opencode-image-mcp/plugin", "options": { ... } } ] }
     ```

   - **Copy into the config** (what the author uses): copy `plugin/src/index.ts` and `plugin/package.json` to `~/.config/opencode/plugins/image/` and use `"package": "./plugins/image"`.
3. Put the options in the same `plugins` entry:

   ```jsonc
   {
     "package": "...",
     "options": {
       "baseURL": "https://example.com/v1",
       "model": "your-image-model",
       "outputDir": "/tmp/opencode/images",
       "previewMode": "overlay",
       "autoPreview": false,
       "apiKey": "..."
     }
   }
   ```

4. Rebuild the config: `cd ~/.config/opencode && npm run build:config`.
5. Restart OpenCode and check the log: `grep "loading plugin" ~/.local/share/opencode/log/opencode.log | tail -3`.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `baseURL` | `IMAGE_BASE_URL` env | OpenAI-compatible API base URL |
| `apiKey` | `IMAGE_API_KEY` env | Bearer token |
| `model` | `IMAGE_MODEL` env | Default model; the tool call can override it |
| `outputDir` | `/tmp/opencode/images` | Where images are saved |
| `previewMode` | `overlay` | `overlay` (kitty), `xdg-open`, or `none` |
| `autoPreview` | `true` | If `false`, `generate_image` only saves; use `show_image` to display |

### kitty preview

`overlay` needs kitty with remote control enabled in `kitty.conf`:

```
allow_remote_control yes
listen_on unix:/tmp/opencode/kitty
```

Outside kitty the plugin falls back to `xdg-open`. Use `previewMode: "none"` for headless use.

## Roadmap

- Additional providers (e.g. Codex image generation) behind the same tool interface
- Inline image preview in the terminal (kitty graphics protocol)

## License

MIT
