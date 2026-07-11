#!/usr/bin/env node
// Live smoke test: makes ONE real gpt-image-2 generation (quality low, cheapest)
// and writes it to smoke-out/smoke.png, then verifies the file is a valid PNG.
// Needs a real key:  OPENAI_API_KEY=sk-... npm run smoke
// (or put the key in image-gen-mcp/.env)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenAIImageClient } from "../src/openai-image-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.OPENAI_API_KEY) {
  const envFile = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") {
    try { process.loadEnvFile(envFile); } catch { /* ignore */ }
  }
}
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY not set. Run: OPENAI_API_KEY=sk-... npm run smoke  (or fill .env)");
  process.exit(1);
}

const client = new OpenAIImageClient({ apiKey: process.env.OPENAI_API_KEY });
const out = path.join(__dirname, "..", "smoke-out", "smoke.png");
fs.mkdirSync(path.dirname(out), { recursive: true });

console.log("Generating a tiny test image with gpt-image-2 (quality low)...");
const json = await client.generate({
  model: "gpt-image-2",
  prompt: "a simple flat minimalist mountain logo, centered, solid background",
  size: "1024x1024",
  quality: "low",
  output_format: "png",
  n: 1,
});

const b64 = json?.data?.[0]?.b64_json;
if (!b64) { console.error("No image in response:", JSON.stringify(json).slice(0, 500)); process.exit(1); }
const buf = Buffer.from(b64, "base64");
fs.writeFileSync(out, buf);

const validPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
console.log(`Saved ${buf.length} bytes -> ${out}`);
console.log(`Valid PNG: ${validPng}`);
console.log(`Reported: size=${json.size} quality=${json.quality} format=${json.output_format}`);
if (json.usage) console.log(`Usage: ${JSON.stringify(json.usage)}`);
process.exit(validPng ? 0 : 1);
