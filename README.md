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

## Roadmap

- Additional providers (e.g. Codex image generation) behind the same tool interface
- Inline image preview in the terminal (kitty graphics protocol)

## License

MIT
