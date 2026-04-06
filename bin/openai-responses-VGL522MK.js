import {
  buildCopilotDynamicHeaders,
  hasCopilotVisionInput
} from "./chunk-65KFH7OI.js";
import {
  convertResponsesMessages,
  convertResponsesTools,
  processResponsesStream
} from "./chunk-IFS3OKBN.js";
import "./chunk-UEODFF7H.js";
import {
  OpenAI
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

// node_modules/@mariozechner/pi-ai/dist/providers/openai-responses.js
var OPENAI_TOOL_CALL_PROVIDERS = /* @__PURE__ */ new Set(["openai", "openai-codex", "opencode"]);
function resolveCacheRetention(cacheRetention) {
  if (cacheRetention) {
    return cacheRetention;
  }
  if (typeof process !== "undefined" && process.env.PI_CACHE_RETENTION === "long") {
    return "long";
  }
  return "short";
}
function getPromptCacheRetention(baseUrl, cacheRetention) {
  if (cacheRetention !== "long") {
    return void 0;
  }
  if (baseUrl.includes("api.openai.com")) {
    return "24h";
  }
  return void 0;
}
var streamOpenAIResponses = (model, context, options) => {
  const stream = new AssistantMessageEventStream();
  (async () => {
    const output = {
      role: "assistant",
      content: [],
      api: model.api,
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
      const client = createClient(model, context, apiKey, options?.headers);
      let params = buildParams(model, context, options);
      const nextParams = await options?.onPayload?.(params, model);
      if (nextParams !== void 0) {
        params = nextParams;
      }
      const openaiStream = await client.responses.create(params, options?.signal ? { signal: options.signal } : void 0);
      stream.push({ type: "start", partial: output });
      await processResponsesStream(openaiStream, output, stream, model, {
        serviceTier: options?.serviceTier,
        applyServiceTierPricing
      });
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
var streamSimpleOpenAIResponses = (model, context, options) => {
  const apiKey = options?.apiKey || getEnvApiKey(model.provider);
  if (!apiKey) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }
  const base = buildBaseOptions(model, options, apiKey);
  const reasoningEffort = supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning);
  return streamOpenAIResponses(model, context, {
    ...base,
    reasoningEffort
  });
};
function createClient(model, context, apiKey, optionsHeaders) {
  if (!apiKey) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it as an argument.");
    }
    apiKey = process.env.OPENAI_API_KEY;
  }
  const headers = { ...model.headers };
  if (model.provider === "github-copilot") {
    const hasImages = hasCopilotVisionInput(context.messages);
    const copilotHeaders = buildCopilotDynamicHeaders({
      messages: context.messages,
      hasImages
    });
    Object.assign(headers, copilotHeaders);
  }
  if (optionsHeaders) {
    Object.assign(headers, optionsHeaders);
  }
  return new OpenAI({
    apiKey,
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    defaultHeaders: headers
  });
}
function buildParams(model, context, options) {
  const messages = convertResponsesMessages(model, context, OPENAI_TOOL_CALL_PROVIDERS);
  const cacheRetention = resolveCacheRetention(options?.cacheRetention);
  const params = {
    model: model.id,
    input: messages,
    stream: true,
    prompt_cache_key: cacheRetention === "none" ? void 0 : options?.sessionId,
    prompt_cache_retention: getPromptCacheRetention(model.baseUrl, cacheRetention),
    store: false
  };
  if (options?.maxTokens) {
    params.max_output_tokens = options?.maxTokens;
  }
  if (options?.temperature !== void 0) {
    params.temperature = options?.temperature;
  }
  if (options?.serviceTier !== void 0) {
    params.service_tier = options.serviceTier;
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
    } else if (model.provider !== "github-copilot") {
      params.reasoning = { effort: "none" };
    }
  }
  return params;
}
function getServiceTierCostMultiplier(serviceTier) {
  switch (serviceTier) {
    case "flex":
      return 0.5;
    case "priority":
      return 2;
    default:
      return 1;
  }
}
function applyServiceTierPricing(usage, serviceTier) {
  const multiplier = getServiceTierCostMultiplier(serviceTier);
  if (multiplier === 1)
    return;
  usage.cost.input *= multiplier;
  usage.cost.output *= multiplier;
  usage.cost.cacheRead *= multiplier;
  usage.cost.cacheWrite *= multiplier;
  usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}
export {
  streamOpenAIResponses,
  streamSimpleOpenAIResponses
};
