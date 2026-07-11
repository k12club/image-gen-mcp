# image-gen-mcp

MCP server ที่ให้ Claude Code **เจนรูปจริงเพื่อเอาไปใช้ในโปรเจกต์** (banner, ไอคอน, พื้นหลัง, texture ฯลฯ) ด้วย OpenAI **gpt-image-2** แล้ว **เซฟเป็นไฟล์ที่ path ที่สั่ง** ได้เลย — ไม่ได้เอาไว้ทำ mockup หน้าตาเว็บ

> English: see [README.md](./README.md)

## Tools

### `generate_image`
เจนรูปใหม่จาก prompt แล้วเซฟไฟล์

| param | ค่า | default |
|---|---|---|
| `prompt` * | ข้อความอธิบายรูป | — |
| `output_path` * | ที่จะเซฟ เช่น `public/images/banner.png` | — |
| `quality` | `low` \| `medium` \| `high` \| `auto` | `medium` |
| `size` | `auto` \| `1024x1024` \| `1536x1024` (นอน) \| `1024x1536` (ตั้ง) \| `2048x2048` \| `WxH` | `1024x1024` |
| `format` | `png` \| `jpeg` \| `webp` | เดาจากนามสกุล `output_path` |
| `background` | `opaque` \| `transparent` \| `auto` (โปร่งใสได้เฉพาะ png/webp) | `auto` |
| `compression` | 0-100 (เฉพาะ jpeg/webp) | — |
| `n` | 1-10 (ถ้า >1 เซฟเป็น `name-1.ext`, `name-2.ext`, ...) | `1` |
| `model` | override โมเดล | `gpt-image-2` |

### `edit_image`
แก้/ต่อยอดรูปเดิม ใส่ reference ได้ 1-16 ไฟล์ + mask (inpaint)

| param | ค่า |
|---|---|
| `prompt` * | บอกว่าจะแก้/สร้างอะไร |
| `image_paths` * | รูปต้นทาง 1-16 ไฟล์ |
| `output_path` * | ที่จะเซฟผลลัพธ์ |
| `mask_path` | (ไม่บังคับ) mask สำหรับ inpaint — บริเวณโปร่งใส = ส่วนที่จะถูกแก้ ต้องขนาดเท่ารูปแรก |
| + `quality` / `size` / `format` / `background` / `compression` / `n` / `model` เหมือน generate |

ทั้งสอง tool คืนแค่ `{ path, bytes, size, quality, ... }` ไม่คืนข้อมูลรูปดิบ (กัน context บวม) · `output_path` แบบ relative อิงโฟลเดอร์โปรเจกต์ที่เรียก · สร้างโฟลเดอร์ให้อัตโนมัติ

## ติดตั้ง

```bash
cd image-gen-mcp
npm install
```

## ต่อเข้า Claude Code

ใส่ API key ผ่าน env block ใน MCP config ได้เลย (ไม่ต้องมีไฟล์ `.env`) — `.mcp.json` ของโปรเจกต์ หรือ user-scope:

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

หรือเพิ่มผ่าน CLI:

```bash
claude mcp add image-gen -e OPENAI_API_KEY=sk-... -- node /Users/palm/Desktop/projects/custom-mcp/image-gen-mcp/src/index.mjs
```

## ทดสอบ

```bash
npm run selftest   # MCP round-trip จริง (fake client) — ไม่ต้องใช้ key/เน็ต
OPENAI_API_KEY=sk-... npm run smoke   # ยิง API จริง 1 รูป (quality low) แล้ว verify PNG
```

## ราคา (โดยประมาณ, gpt-image-2, 1024x1024)

low ~$0.006 · medium ~$0.053 · high ~$0.211 ต่อรูป — เริ่มที่ `medium`, ใช้ `high` เฉพาะงาน final
