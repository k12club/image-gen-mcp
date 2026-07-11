// Thin OpenAI Images API client (generate + edit).
// Uses Node's global fetch/FormData/Blob (Node >= 20) — no extra deps, no SDK
// version drift. gpt-image-* models ALWAYS return base64 (data[].b64_json);
// they do not support response_format:"url", so we never send it.

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

// Drop keys whose value is undefined so we only send params the caller set.
function prune(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

export class OpenAIImageClient {
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL } = {}) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is required");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  // POST /v1/images/generations (application/json).
  // params: { model, prompt, size, quality, output_format, n, background?,
  //           output_compression?, moderation? }
  async generate(params) {
    const res = await fetch(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(prune(params)),
    });
    return parseResponse(res);
  }

  // POST /v1/images/edits (multipart/form-data).
  // images: [{ buffer, filename, contentType }]  (1..16 reference images)
  // mask:   { buffer, filename, contentType } | undefined
  // params: same knobs as generate() (model, prompt, size, quality, ...)
  async edit({ images, mask, ...params }) {
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error("edit() requires at least one image");
    }
    const form = new FormData();
    for (const [k, v] of Object.entries(prune(params))) {
      form.append(k, String(v));
    }
    // gpt-image-2 supports multiple reference images; the multipart field is image[].
    for (const img of images) {
      form.append("image[]", new Blob([img.buffer], { type: img.contentType }), img.filename);
    }
    if (mask) {
      form.append("mask", new Blob([mask.buffer], { type: mask.contentType }), mask.filename);
    }
    // Do NOT set Content-Type here — fetch adds the multipart boundary itself.
    const res = await fetch(`${this.baseUrl}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    return parseResponse(res);
  }
}

// Parse an Images API response, turning non-2xx into a clear Error.
async function parseResponse(res) {
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }

  if (!res.ok) {
    const msg = json?.error?.message || text || `HTTP ${res.status}`;
    const err = new Error(`OpenAI Images API error (${res.status}): ${msg}`);
    err.status = res.status;
    err.code = json?.error?.code;
    err.type = json?.error?.type;
    throw err;
  }
  if (!json || !Array.isArray(json.data)) {
    throw new Error("OpenAI Images API returned an unexpected response (no data[]).");
  }
  // Shape: { created, data:[{b64_json, revised_prompt?}], background?,
  //          output_format?, quality?, size?, usage? }
  return json;
}
