#!/usr/bin/env node
// Self-test: drives a REAL in-memory MCP round-trip (client <-> server) with a
// FAKE OpenAI client injected, so it verifies the whole tool path — schema,
// defaults, param mapping, base64 decode, file writing, n>1 indexing, and the
// transparent/format guard — WITHOUT a key or network. The only thing it can't
// cover is the live HTTPS call (see scripts/smoke.mjs for that).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerImageTools } from "../src/tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "selftest-out");
fs.rmSync(OUT, { recursive: true, force: true });

// A valid 1x1 PNG (starts with the \x89PNG magic bytes).
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

// Fake OpenAI client: records the last params it saw and echoes N images back.
const seen = { generate: null, edit: null };
const fakeClient = {
  // NOTE: real gpt-image responses have NO top-level `model` field — the fake
  // must not include one, or it would mask the "echo requested model" behaviour.
  async generate(params) {
    seen.generate = params;
    const n = params.n || 1;
    return {
      size: params.size,
      quality: params.quality,
      background: params.background || "opaque",
      output_format: params.output_format,
      data: Array.from({ length: n }, () => ({ b64_json: PNG_1x1, revised_prompt: "a tiny test dot" })),
      usage: { total_tokens: 1 },
    };
  },
  async edit({ images, mask, ...params }) {
    seen.edit = { params, imageCount: images.length, hasMask: !!mask };
    return {
      size: params.size,
      quality: params.quality,
      output_format: params.output_format,
      data: [{ b64_json: PNG_1x1 }],
    };
  },
};

// ---- tiny assert harness ----
let failures = 0;
function check(name, cond) {
  if (cond) { console.log(`  ok   ${name}`); }
  else { console.log(`  FAIL ${name}`); failures++; }
}
function isPng(p) {
  if (!fs.existsSync(p)) return false;
  const b = fs.readFileSync(p);
  return b.length > 0 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

// ---- wire up a real MCP session over in-memory transport ----
const server = new McpServer({ name: "image-gen-mcp-selftest", version: "0.0.0" });
registerImageTools(server, fakeClient);
const client = new Client({ name: "selftest-client", version: "0.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

console.log("tools/list");
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
check("exposes generate_image + edit_image", names.join(",") === "edit_image,generate_image");

console.log("generate_image (defaults)");
const genPath = path.join(OUT, "banner.png");
const r1 = await client.callTool({ name: "generate_image", arguments: { prompt: "a red dot", output_path: genPath } });
check("no error", !r1.isError);
check("file written as valid PNG", isPng(genPath));
check("default model = gpt-image-2", seen.generate?.model === "gpt-image-2");
check("default quality = medium", seen.generate?.quality === "medium");
check("default size = 1024x1024", seen.generate?.size === "1024x1024");
check("output_format inferred = png", seen.generate?.output_format === "png");
check("background auto NOT sent", seen.generate?.background === undefined);
check("moderation auto NOT sent", seen.generate?.moderation === undefined);
check("summary has path, no base64", !!r1.structuredContent?.images?.[0]?.path && !JSON.stringify(r1).includes(PNG_1x1));
check("summary echoes requested model (not response)", r1.structuredContent?.model === "gpt-image-2");

console.log("generate_image (webp + explicit quality high + compression)");
const webpPath = path.join(OUT, "icon.webp");
const r2 = await client.callTool({ name: "generate_image", arguments: { prompt: "an icon", output_path: webpPath, quality: "high", compression: 80 } });
check("no error", !r2.isError);
check("file written", fs.existsSync(webpPath));
check("output_format inferred = webp", seen.generate?.output_format === "webp");
check("quality high passed", seen.generate?.quality === "high");
check("output_compression 80 passed (webp)", seen.generate?.output_compression === 80);

console.log("generate_image (n=2 -> indexed files)");
const multiPath = path.join(OUT, "shot.png");
const r3 = await client.callTool({ name: "generate_image", arguments: { prompt: "two shots", output_path: multiPath, n: 2 } });
check("no error", !r3.isError);
check("wrote shot-1.png", isPng(path.join(OUT, "shot-1.png")));
check("wrote shot-2.png", isPng(path.join(OUT, "shot-2.png")));

console.log("generate_image (format conflicts with extension -> guarded error)");
const conflictPath = path.join(OUT, "logo.png");
const rc = await client.callTool({ name: "generate_image", arguments: { prompt: "x", output_path: conflictPath, format: "jpeg" } });
check("returns isError", rc.isError === true);
check("no mislabeled file written", !fs.existsSync(conflictPath));

console.log("generate_image (transparent + jpeg -> guarded error)");
const badPath = path.join(OUT, "bad.jpg");
const r4 = await client.callTool({ name: "generate_image", arguments: { prompt: "x", output_path: badPath, background: "transparent" } });
check("returns isError", r4.isError === true);
check("no file written", !fs.existsSync(badPath));

console.log("edit_image (2 refs + mask)");
const srcA = path.join(OUT, "srcA.png");
const srcB = path.join(OUT, "srcB.png");
const maskP = path.join(OUT, "mask.png");
fs.mkdirSync(OUT, { recursive: true });
for (const p of [srcA, srcB, maskP]) fs.writeFileSync(p, Buffer.from(PNG_1x1, "base64"));
const editOut = path.join(OUT, "edited.png");
const r5 = await client.callTool({ name: "edit_image", arguments: { prompt: "merge these", image_paths: [srcA, srcB], mask_path: maskP, output_path: editOut } });
check("no error", !r5.isError);
check("edited file written", isPng(editOut));
check("client received 2 reference images", seen.edit?.imageCount === 2);
check("client received a mask", seen.edit?.hasMask === true);
check("edit default model = gpt-image-2", seen.edit?.params?.model === "gpt-image-2");

console.log("edit_image (missing source -> error)");
const r6 = await client.callTool({ name: "edit_image", arguments: { prompt: "x", image_paths: [path.join(OUT, "nope.png")], output_path: path.join(OUT, "o.png") } });
check("returns isError", r6.isError === true);

await client.close();
await server.close();

console.log(failures === 0 ? "\nALL SELFTESTS PASSED" : `\n${failures} SELFTEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
