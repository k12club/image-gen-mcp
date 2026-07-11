# image-gen-mcp

An MCP server that lets Claude Code **generate real images to use in your projects** (banners, icons, backgrounds, textures, etc.) with OpenAI **gpt-image-2**, and **save them straight to a path you specify**. It is meant for producing production assets — not for mocking up UI designs.

> ภาษาไทย: ดู [README.th.md](./README.th.md)

## Tools

### `generate_image`
Generate a new image from a text prompt and write it to a file.

| param | values | default |
|---|---|---|
| `prompt` * | text description of the image | — |
| `output_path` * | where to save, e.g. `public/images/banner.png` | — |
| `quality` | `low` \| `medium` \| `high` \| `auto` | `medium` |
| `size` | `auto` \| `1024x1024` \| `1536x1024` (landscape) \| `1024x1536` (portrait) \| `2048x2048` \| `WxH` | `1024x1024` |
| `format` | `png` \| `jpeg` \| `webp` | inferred from `output_path` extension |
| `background` | `opaque` \| `transparent` \| `auto` (transparent needs png/webp) | `auto` |
| `compression` | 0-100 (jpeg/webp only) | — |
| `n` | 1-10 (if >1, saves `name-1.ext`, `name-2.ext`, ...) | `1` |
| `model` | override the model | `gpt-image-2` |

### `edit_image`
Edit / build on existing images. Pass 1-16 reference images, plus an optional mask for inpainting.

| param | values |
|---|---|
| `prompt` * | what to edit / create |
| `image_paths` * | 1-16 source (reference) image paths |
| `output_path` * | where to save the result |
| `mask_path` | (optional) mask for inpainting — transparent areas of the mask are what gets edited; must match the first image's dimensions |
| + `quality` / `size` / `format` / `background` / `compression` / `n` / `model` — same as `generate_image` |

Both tools return only `{ path, bytes, size, quality, ... }` — never the raw image bytes (to avoid flooding the agent's context). A relative `output_path` is resolved against the calling project's CWD, and parent directories are created automatically.

## Install

```bash
cd image-gen-mcp
npm install
```

## Connect to Claude Code

Provide the API key via the server's `env` block in your MCP config (no `.env` file required) — in a project `.mcp.json` or a user-scoped config:

```json
{
  "mcpServers": {
    "image-gen": {
      "command": "node",
      "args": ["/Users/palm/Desktop/projects/custom-mcp/image-gen-mcp/src/index.mjs"],
      "env": { "OPENAI_API_KEY": "sk-..." }
    }
  }
}
```

Or add it via the CLI:

```bash
claude mcp add image-gen -e OPENAI_API_KEY=sk-... -- node /Users/palm/Desktop/projects/custom-mcp/image-gen-mcp/src/index.mjs
```

## Test

```bash
npm run selftest   # real in-memory MCP round-trip with a fake client — no key/network needed
OPENAI_API_KEY=sk-... npm run smoke   # one real API call (quality low) that verifies a valid PNG
```

## Pricing (approx., gpt-image-2, 1024x1024)

low ~$0.006 · medium ~$0.053 · high ~$0.211 per image — start at `medium`, use `high` only for final assets.
