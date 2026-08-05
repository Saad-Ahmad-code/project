/**
 * AI provider registry — ordered fallback chain for chat completions
 * plus vision-capable models and Cloudflare base URL helper.
 */
export interface AiProvider {
  name: string;
  baseURL: string;
  model: string;
  apiKeyEnv: string;
  priority: number;
  headers?: Record<string, string>;
}

export const providers: AiProvider[] = [
  { name: "openrouter-gemma4", baseURL: "https://openrouter.ai/api/v1", model: "google/gemma-4-26b-a4b-it:free", apiKeyEnv: "OPENROUTER_API_KEY", priority: 1 },
  { name: "openrouter-ling", baseURL: "https://openrouter.ai/api/v1", model: "inclusionai/ling-3.0-flash:free", apiKeyEnv: "OPENROUTER_API_KEY", priority: 2 },
  { name: "openrouter-router", baseURL: "https://openrouter.ai/api/v1", model: "openrouter/free", apiKeyEnv: "OPENROUTER_API_KEY", priority: 3 },
  { name: "openrouter-nemotron-nano", baseURL: "https://openrouter.ai/api/v1", model: "nvidia/nemotron-3-nano-30b-a3b:free", apiKeyEnv: "OPENROUTER_API_KEY", priority: 4 },
  { name: "openrouter-nemotron-super", baseURL: "https://openrouter.ai/api/v1", model: "nvidia/nemotron-3-super-120b-a12b:free", apiKeyEnv: "OPENROUTER_API_KEY", priority: 5 },
  { name: "openrouter-nemotron-ultra", baseURL: "https://openrouter.ai/api/v1", model: "nvidia/nemotron-3-ultra-550b-a55b:free", apiKeyEnv: "OPENROUTER_API_KEY", priority: 6 },
  { name: "openrouter-gpt-oss", baseURL: "https://openrouter.ai/api/v1", model: "openai/gpt-oss-20b:free", apiKeyEnv: "OPENROUTER_API_KEY", priority: 7 },
  { name: "freetheai", baseURL: "https://api.freetheai.xyz/v1", model: "kai/free", apiKeyEnv: "FREETHEAI_API_KEY", priority: 8 },
  { name: "groq", baseURL: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", apiKeyEnv: "GROQ_API_KEY", priority: 10 },
  { name: "gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", model: "gemini-2.0-flash", apiKeyEnv: "GEMINI_API_KEY", priority: 11 },
  { name: "sambanova", baseURL: "https://api.sambanova.ai/v1", model: "Meta-Llama-3.3-70B-Instruct", apiKeyEnv: "SAMBANOVA_API_KEY", priority: 12 },
  { name: "github", baseURL: "https://models.github.ai/inference", model: "meta/llama-3.3-70b-instruct", apiKeyEnv: "GITHUB_TOKEN", priority: 13, headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } },
  { name: "huggingface", baseURL: "https://router.huggingface.co/v1", model: "meta-llama/Llama-3.3-70B-Instruct", apiKeyEnv: "HF_TOKEN", priority: 14 },
  { name: "cloudflare", baseURL: "", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", apiKeyEnv: "CLOUDFLARE_API_TOKEN", priority: 15, headers: { "cf-aig-gateway-id": "default" } },
  // Local open-source LLM (Ollama) — free, unlimited, fully offline. Uses
  // OpenAI-compatible /v1 endpoint; no API key. Active when OLLAMA_URL is set
  // (default http://localhost:11434). Model must be pulled locally, e.g.
  //   ollama pull llama3.2:3b   ← small, fast chat model (2GB)
  //   ollama pull gemma4:e2b    ← used for OCR refine/vision (see ollama.ts)
  // llama3.2:3b is used here because llama3:latest (meta-llama/Llama-3.2B)
  // does not support the /v1/chat endpoint in current Ollama builds.
  { name: "ollama", baseURL: "http://localhost:11434/v1", model: "llama3.2:3b", apiKeyEnv: "OLLAMA_URL", priority: 9 },
];

export function getCloudflareBaseURL(): string {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
}

export const VISION_MODELS = [
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "nvidia/nemotron-3.5-content-safety:free",
  "openrouter/free",
];
