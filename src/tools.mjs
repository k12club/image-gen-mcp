// image-gen-mcp tools: generate_image + edit_image.
// Both call the OpenAI Images API, decode the returned base64, and WRITE the
// result to a caller-specified path (resolved against the calling project's
// CWD). We return only a compact path + metadata summary — never the base64 —
// so image bytes don't flood the agent's context.

import path from "node:path";
import fs from "node:fs";
import { z } from "zod";

const MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

// ---- path / format helpers -------------------------------------------------

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

// png | jpeg | webp inferred from a filename extension, else null.
function formatFromExt(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".png") return "png";
  if (ext === ".jpg" || ext === ".jpeg") return "jpeg";
  if (ext === ".webp") return "webp";
  return null;
}

// For n>1: banner.png -> banner-1.png, banner-2.png, ...
function withIndex(p, i) {
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  return path.join(dir, `${base}-${i}${ext}`);
}

function writeImage(absPath, b64) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const buf = Buffer.from(b64, "base64");
  fs.writeFileSync(absPath, buf);
  return buf.length;
}

function readImageFile(p) {
  const abs = resolvePath(p);
  if (!fs.existsSync(abs)) throw new Error(`image not found: ${abs}`);
  const fmt = formatFromExt(abs) || "png";
  return { buffer: fs.readFileSync(abs), filename: path.basename(abs), contentType: MIME[fmt] };
}

// Turn OpenAI params + result into what we send to the API and hand back.
function buildApiParams({ model, prompt, size, quality, format, background, compression, n, moderation }) {
  const p = { model, prompt, size, quality, output_format: format, n };
  if (background && background !== "auto") p.background = background;         // auto = server default
  if (moderation && moderation !== "auto") p.moderation = moderation;
  if ((format === "jpeg" || format === "webp") && Number.isInteger(compression)) {
    p.output_compression = compression;
  }
  return p;
}

// Decide the output encoding. The output_path extension is authoritative: if an
// explicit `format` contradicts a known image extension we reject, rather than
// silently writing (e.g.) JPEG bytes into a .png file. Also enforce that
// transparent backgrounds only go to png/webp.
function decideFormat({ format, outputPath, background }) {
  const extFmt = formatFromExt(outputPath); // png|jpeg|webp|null
  if (extFmt && format && extFmt !== format) {
    throw new Error(
      `format:"${format}" ไม่ตรงกับนามสกุลไฟล์ "${path.extname(outputPath)}" ของ output_path — ` +
      `ทำให้ตรงกัน หรือเอา format ออกเพื่อให้เดาจากนามสกุลไฟล์ (กันไฟล์เนื้อในกับนามสกุลไม่ตรง)`
    );
  }
  const fmt = extFmt || format || "png";
  if (background === "transparent" && fmt !== "png" && fmt !== "webp") {
    throw new Error(`background:"transparent" ต้องใช้ format png หรือ webp (ได้ ${fmt})`);
  }
  return fmt;
}

// Write every image in an Images API response, indexing when n>1.
// requestedModel is echoed back because the Images API response has no top-level
// `model` field — reading json.model would always be undefined.
function saveResult(json, outputPath, n, requestedModel) {
  const abs = resolvePath(outputPath);
  const saved = json.data.map((item, i) => {
    const target = n > 1 ? withIndex(abs, i + 1) : abs;
    const bytes = writeImage(target, item.b64_json);
    return { path: target, bytes, revised_prompt: item.revised_prompt };
  });
  return {
    images: saved.map((s) => ({ path: s.path, bytes: s.bytes })),
    model: requestedModel,
    size: json.size,
    quality: json.quality,
    background: json.background,
    output_format: json.output_format,
    revised_prompt: saved[0]?.revised_prompt,
    usage: json.usage,
  };
}

function ok(summary) {
  return {
    content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
    structuredContent: summary,
  };
}

function fail(err) {
  const detail = err?.status ? `${err.message}` : String(err?.message || err);
  return { content: [{ type: "text", text: `Error: ${detail}` }], isError: true };
}

// ---- shared input schema fields (raw zod shape) ----------------------------

const shared = {
  quality: z.enum(["low", "medium", "high", "auto"]).optional().default("medium")
    .describe("คุณภาพ/ราคา: low (ร่าง, ถูกสุด) | medium (ค่าเริ่มต้น) | high (งาน final, แพงสุด) | auto"),
  size: z.string().optional().default("1024x1024")
    .refine((v) => v === "auto" || /^\d+x\d+$/.test(v), "size ต้องเป็น auto หรือ WxH เช่น 1024x1024")
    .describe("auto | 1024x1024 (จตุรัส) | 1536x1024 (แนวนอน) | 1024x1536 (แนวตั้ง) | 2048x2048 | WxH (gpt-image-2 สูงสุด 3840px, ทวีคูณของ 16)"),
  format: z.enum(["png", "jpeg", "webp"]).optional()
    .describe("นามสกุลไฟล์ผลลัพธ์ (ไม่ใส่ = เดาจาก output_path, ไม่รู้ = png)"),
  background: z.enum(["opaque", "transparent", "auto"]).optional().default("auto")
    .describe("transparent = พื้นหลังโปร่งใส (ใช้ได้เฉพาะ png/webp) | opaque | auto"),
  compression: z.number().int().min(0).max(100).optional()
    .describe("ระดับบีบอัด 0-100 (เฉพาะ jpeg/webp)"),
  n: z.number().int().min(1).max(10).optional().default(1)
    .describe("จำนวนรูป (default 1). ถ้า >1 จะเซฟเป็น name-1.ext, name-2.ext, ..."),
  model: z.string().optional().default("gpt-image-2")
    .describe("โมเดล (default gpt-image-2). override ได้ เช่น gpt-image-1.5"),
  moderation: z.enum(["auto", "low"]).optional().default("auto")
    .describe("ระดับ moderation (default auto)"),
};

// ---- registration ----------------------------------------------------------

export function registerImageTools(server, client) {
  server.registerTool(
    "generate_image",
    {
      description:
        "เจนรูปใหม่จากข้อความ (prompt) ด้วย OpenAI gpt-image-2 แล้วเซฟเป็นไฟล์ที่ output_path ที่สั่ง " +
        "(สร้างโฟลเดอร์ให้อัตโนมัติ, path relative จะอิงโฟลเดอร์โปรเจกต์ปัจจุบัน). " +
        "ใช้สำหรับผลิต asset จริงเพื่อเอาไปใช้ในงาน เช่น banner เว็บ, ไอคอน, พื้นหลัง, texture. " +
        "เลือกคุณภาพได้ (quality) — low ร่างถูกสุด, high งาน final. คืนแค่ path + metadata ไม่คืนข้อมูลรูปดิบ.",
      inputSchema: {
        prompt: z.string().min(1).describe("คำอธิบายรูปที่ต้องการ (อังกฤษได้ผลดีสุด, ไทยก็ได้)"),
        output_path: z.string().min(1).describe("ที่จะเซฟไฟล์ เช่น public/images/banner.png หรือ /abs/path/icon.webp"),
        ...shared,
      },
    },
    async (args) => {
      try {
        const format = decideFormat({ format: args.format, outputPath: args.output_path, background: args.background });
        const json = await client.generate(buildApiParams({ ...args, format }));
        return ok(saveResult(json, args.output_path, args.n, args.model));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "edit_image",
    {
      description:
        "แก้ไข/ต่อยอดรูปที่มีอยู่ด้วย gpt-image-2: ใส่รูปต้นทางได้ 1-16 ไฟล์เป็น reference " +
        "(เช่น แก้รูปเดิม, รวมสไตล์จากหลายรูป, ใส่โลโก้), และใส่ mask (mask_path) เพื่อ inpaint เฉพาะบางส่วนได้. " +
        "ผลลัพธ์เซฟเป็นไฟล์ที่ output_path. เหมาะกับการปรับ asset ที่เจนไว้แล้วหรือทำให้ตรงแบรนด์.",
      inputSchema: {
        prompt: z.string().min(1).describe("บอกว่าจะให้แก้/สร้างอะไรจากรูปต้นทาง"),
        image_paths: z.array(z.string().min(1)).min(1).max(16)
          .describe("path รูปต้นทาง 1-16 ไฟล์ (reference images)"),
        output_path: z.string().min(1).describe("ที่จะเซฟไฟล์ผลลัพธ์"),
        mask_path: z.string().optional()
          .describe("(ไม่บังคับ) path ไฟล์ mask สำหรับ inpaint — บริเวณโปร่งใสใน mask คือส่วนที่จะถูกแก้ ต้องขนาดเท่ารูปแรก"),
        ...shared,
      },
    },
    async (args) => {
      try {
        const format = decideFormat({ format: args.format, outputPath: args.output_path, background: args.background });
        const images = args.image_paths.map(readImageFile);
        const mask = args.mask_path ? readImageFile(args.mask_path) : undefined;
        const params = buildApiParams({ ...args, format });
        const json = await client.edit({ images, mask, ...params });
        return ok(saveResult(json, args.output_path, args.n, args.model));
      } catch (err) {
        return fail(err);
      }
    }
  );
}
