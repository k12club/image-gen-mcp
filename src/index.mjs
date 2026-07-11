#!/usr/bin/env node
// image-gen-mcp — stdio MCP server.
// Generates & edits images with OpenAI gpt-image-2 and saves them to a path you
// specify, so Claude Code can produce real project assets (banners, icons,
// textures) and drop them straight into your project.

// stdio MCP uses stdout for the JSON-RPC stream. Redirect ALL console.log to
// stderr so stray logs can't corrupt the protocol. (console.error already
// goes to stderr.)
console.log = (...args) => console.error(...args);

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OpenAIImageClient } from "./openai-image-client.mjs";
import { registerImageTools } from "./tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The API key normally comes from the MCP server config `env` block in Claude
// Code (add it in /mcp). As a local-dev convenience, also load <root>/.env if
// the key isn't already in the environment.
if (!process.env.OPENAI_API_KEY) {
  const envFile = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") {
    try { process.loadEnvFile(envFile); } catch { /* ignore */ }
  }
}

const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

if (!API_KEY) {
  console.error(
    "OPENAI_API_KEY is required. Add it to the MCP server's env block in Claude " +
    "Code (/mcp), or put it in image-gen-mcp/.env (copy from .env.example)."
  );
  process.exit(1);
}

const client = new OpenAIImageClient({ apiKey: API_KEY, baseUrl: BASE_URL });

const server = new McpServer({ name: "image-gen-mcp", version: "1.0.0" });
registerImageTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[image-gen-mcp] ready (stdio) → ${BASE_URL} | model default gpt-image-2`);
