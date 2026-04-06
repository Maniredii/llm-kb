import {
  convertResponsesMessages,
  convertResponsesTools,
  processResponsesStream
} from "./chunk-IFS3OKBN.js";
import "./chunk-UEODFF7H.js";
import {
  AzureOpenAI
} from "./chunk-XFV534WU.js";
import "./chunk-3YMNGUZZ.js";
import {
  getEnvApiKey
} from "./chunk-LDHOKBJA.js";
import {
  buildBaseOptions,
  clampReasoning
} from "./chunk-XCXTZJGO.js";
import {
  AssistantMessageEventStream,
  supportsXhigh
} from "./chunk-5PYKQQLA.js";
import "./chunk-EAQYK3U2.js";

// node_modules/@mariozechner/pi-ai/dist/providers/azure-openai-responses.js
var DEFAULT_AZURE_API_VERSION = "v1";
var AZURE_TOOL_CALL_PROVIDERS = /* @__PURE__ */ new Set(["openai", "openai-codex", "opencode", "azure-openai-responses"]);
function parseDeploymentNameMap(value) {
  const map = /* @__PURE__ */ new Map();
  if (!value)
    return map;
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed)
      continue;
    const [modelId, deploymentName] = trimmed.split("=", 2);
    if (!modelId || !deploymentName)
      continue;
    map.set(modelId.trim(), deploymentName.trim());
  }
  return map;
}
function resolveDeploymentName(model, options) {
  if (options?.azureDeploymentName) {
    return options.azureDeploymentName;
  }
  const mappedDeployment = parseDeploymentNameMap(process.env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP).get(model.id);
  return mappedDeployment || model.id;
}
var streamAzureOpenAIResponses = (model, context, options) => {
  const stream = new AssistantMessageEventStream();
  (async () => {
    const deploymentName = resolveDeploymentName(model, options);
    const output = {
      role: "assistant",
      content: [],
      api: "azure-openai-responses",
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: "stop",
      timestamp: Date.now()
    };
    try {
      const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
      const client = createClient(model, apiKey, options);
      let params = buildParams(model, context, options, deploymentName);
      const nextParams = await options?.onPayload?.(params, model);
      if (nextParams !== void 0) {
        params = nextParams;
      }
      const openaiStream = await client.responses.create(params, options?.signal ? { signal: options.signal } : void 0);
      stream.push({ type: "start", partial: output });
      await processResponsesStream(openaiStream, output, stream, model);
      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }
      if (output.stopReason === "aborted" || output.stopReason === "error") {
        throw new Error("An unknown error occurred");
      }
      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      for (const block of output.content)
        delete block.index;
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();
  return stream;
};
var streamSimpleAzureOpenAIResponses = (model, context, options) => {
  const apiKey = options?.apiKey || getEnvApiKey(model.provider);
  if (!apiKey) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }
  const base = buildBaseOptions(model, options, apiKey);
  const reasoningEffort = supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning);
  return streamAzureOpenAIResponses(model, context, {
    ...base,
    reasoningEffort
  });
};
function normalizeAzureBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}
function buildDefaultBaseUrl(resourceName) {
  return `https://${resourceName}.openai.azure.com/openai/v1`;
}
function resolveAzureConfig(model, options) {
  const apiVersion = options?.azureApiVersion || process.env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_API_VERSION;
  const baseUrl = options?.azureBaseUrl?.trim() || process.env.AZURE_OPENAI_BASE_URL?.trim() || void 0;
  const resourceName = options?.azureResourceName || process.env.AZURE_OPENAI_RESOURCE_NAME;
  let resolvedBaseUrl = baseUrl;
  if (!resolvedBaseUrl && resourceName) {
    resolvedBaseUrl = buildDefaultBaseUrl(resourceName);
  }
  if (!resolvedBaseUrl && model.baseUrl) {
    resolvedBaseUrl = model.baseUrl;
  }
  if (!resolvedBaseUrl) {
    throw new Error("Azure OpenAI base URL is required. Set AZURE_OPENAI_BASE_URL or AZURE_OPENAI_RESOURCE_NAME, or pass azureBaseUrl, azureResourceName, or model.baseUrl.");
  }
  return {
    baseUrl: normalizeAzureBaseUrl(resolvedBaseUrl),
    apiVersion
  };
}
function createClient(model, apiKey, options) {
  if (!apiKey) {
    if (!process.env.AZURE_OPENAI_API_KEY) {
      throw new Error("Azure OpenAI API key is required. Set AZURE_OPENAI_API_KEY environment variable or pass it as an argument.");
    }
    apiKey = process.env.AZURE_OPENAI_API_KEY;
  }
  const headers = { ...model.headers };
  if (options?.headers) {
    Object.assign(headers, options.headers);
  }
  const { baseUrl, apiVersion } = resolveAzureConfig(model, options);
  return new AzureOpenAI({
    apiKey,
    apiVersion,
    dangerouslyAllowBrowser: true,
    defaultHeaders: headers,
    baseURL: baseUrl
  });
}
function buildParams(model, context, options, deploymentName) {
  const messages = convertResponsesMessages(model, context, AZURE_TOOL_CALL_PROVIDERS);
  const params = {
    model: deploymentName,
    input: messages,
    stream: true,
    prompt_cache_key: options?.sessionId
  };
  if (options?.maxTokens) {
    params.max_output_tokens = options?.maxTokens;
  }
  if (options?.temperature !== void 0) {
    params.temperature = options?.temperature;
  }
  if (context.tools) {
    params.tools = convertResponsesTools(context.tools);
  }
  if (model.reasoning) {
    if (options?.reasoningEffort || options?.reasoningSummary) {
      params.reasoning = {
        effort: options?.reasoningEffort || "medium",
        summary: options?.reasoningSummary || "auto"
      };
      params.include = ["reasoning.encrypted_content"];
    } else {
      params.reasoning = { effort: "none" };
    }
  }
  return params;
}
export {
  streamAzureOpenAIResponses,
  streamSimpleAzureOpenAIResponses
};
