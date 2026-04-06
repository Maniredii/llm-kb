// node_modules/@mariozechner/pi-ai/dist/env-api-keys.js
var _existsSync = null;
var _homedir = null;
var _join = null;
var dynamicImport = (specifier) => import(specifier);
var NODE_FS_SPECIFIER = "node:fs";
var NODE_OS_SPECIFIER = "node:os";
var NODE_PATH_SPECIFIER = "node:path";
if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
  dynamicImport(NODE_FS_SPECIFIER).then((m) => {
    _existsSync = m.existsSync;
  });
  dynamicImport(NODE_OS_SPECIFIER).then((m) => {
    _homedir = m.homedir;
  });
  dynamicImport(NODE_PATH_SPECIFIER).then((m) => {
    _join = m.join;
  });
}
var cachedVertexAdcCredentialsExists = null;
function hasVertexAdcCredentials() {
  if (cachedVertexAdcCredentialsExists === null) {
    if (!_existsSync || !_homedir || !_join) {
      const isNode = typeof process !== "undefined" && (process.versions?.node || process.versions?.bun);
      if (!isNode) {
        cachedVertexAdcCredentialsExists = false;
      }
      return false;
    }
    const gacPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (gacPath) {
      cachedVertexAdcCredentialsExists = _existsSync(gacPath);
    } else {
      cachedVertexAdcCredentialsExists = _existsSync(_join(_homedir(), ".config", "gcloud", "application_default_credentials.json"));
    }
  }
  return cachedVertexAdcCredentialsExists;
}
function getEnvApiKey(provider) {
  if (provider === "github-copilot") {
    return process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  }
  if (provider === "anthropic") {
    return process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  }
  if (provider === "google-vertex") {
    if (process.env.GOOGLE_CLOUD_API_KEY) {
      return process.env.GOOGLE_CLOUD_API_KEY;
    }
    const hasCredentials = hasVertexAdcCredentials();
    const hasProject = !!(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT);
    const hasLocation = !!process.env.GOOGLE_CLOUD_LOCATION;
    if (hasCredentials && hasProject && hasLocation) {
      return "<authenticated>";
    }
  }
  if (provider === "amazon-bedrock") {
    if (process.env.AWS_PROFILE || process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI || process.env.AWS_WEB_IDENTITY_TOKEN_FILE) {
      return "<authenticated>";
    }
  }
  const envMap = {
    openai: "OPENAI_API_KEY",
    "azure-openai-responses": "AZURE_OPENAI_API_KEY",
    google: "GEMINI_API_KEY",
    groq: "GROQ_API_KEY",
    cerebras: "CEREBRAS_API_KEY",
    xai: "XAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
    zai: "ZAI_API_KEY",
    mistral: "MISTRAL_API_KEY",
    minimax: "MINIMAX_API_KEY",
    "minimax-cn": "MINIMAX_CN_API_KEY",
    huggingface: "HF_TOKEN",
    opencode: "OPENCODE_API_KEY",
    "opencode-go": "OPENCODE_API_KEY",
    "kimi-coding": "KIMI_API_KEY"
  };
  const envVar = envMap[provider];
  return envVar ? process.env[envVar] : void 0;
}

export {
  getEnvApiKey
};
