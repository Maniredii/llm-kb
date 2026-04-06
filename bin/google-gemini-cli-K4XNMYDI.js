import {
  convertMessages,
  convertTools,
  isThinkingPart,
  mapStopReasonString,
  mapToolChoice,
  retainThoughtSignature
} from "./chunk-SLYBG6ZQ.js";
import {
  buildBaseOptions,
  clampReasoning,
  sanitizeSurrogates
} from "./chunk-XCXTZJGO.js";
import {
  AssistantMessageEventStream,
  calculateCost
} from "./chunk-5PYKQQLA.js";
import "./chunk-EAQYK3U2.js";

// node_modules/@mariozechner/pi-ai/dist/providers/google-gemini-cli.js
var DEFAULT_ENDPOINT = "https://cloudcode-pa.googleapis.com";
var ANTIGRAVITY_DAILY_ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com";
var ANTIGRAVITY_AUTOPUSH_ENDPOINT = "https://autopush-cloudcode-pa.sandbox.googleapis.com";
var ANTIGRAVITY_ENDPOINT_FALLBACKS = [
  ANTIGRAVITY_DAILY_ENDPOINT,
  ANTIGRAVITY_AUTOPUSH_ENDPOINT,
  DEFAULT_ENDPOINT
];
var GEMINI_CLI_HEADERS = {
  "User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "X-Goog-Api-Client": "gl-node/22.17.0",
  "Client-Metadata": JSON.stringify({
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI"
  })
};
var DEFAULT_ANTIGRAVITY_VERSION = "1.18.4";
function getAntigravityHeaders() {
  const version = process.env.PI_AI_ANTIGRAVITY_VERSION || DEFAULT_ANTIGRAVITY_VERSION;
  return {
    "User-Agent": `antigravity/${version} darwin/arm64`
  };
}
var ANTIGRAVITY_SYSTEM_INSTRUCTION = "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.**Absolute paths only****Proactiveness**";
var toolCallCounter = 0;
var MAX_RETRIES = 3;
var BASE_DELAY_MS = 1e3;
var MAX_EMPTY_STREAM_RETRIES = 2;
var EMPTY_STREAM_BASE_DELAY_MS = 500;
var CLAUDE_THINKING_BETA_HEADER = "interleaved-thinking-2025-05-14";
function extractRetryDelay(errorText, response) {
  const normalizeDelay = (ms) => ms > 0 ? Math.ceil(ms + 1e3) : void 0;
  const headers = response instanceof Headers ? response : response?.headers;
  if (headers) {
    const retryAfter = headers.get("retry-after");
    if (retryAfter) {
      const retryAfterSeconds = Number(retryAfter);
      if (Number.isFinite(retryAfterSeconds)) {
        const delay = normalizeDelay(retryAfterSeconds * 1e3);
        if (delay !== void 0) {
          return delay;
        }
      }
      const retryAfterDate = new Date(retryAfter);
      const retryAfterMs = retryAfterDate.getTime();
      if (!Number.isNaN(retryAfterMs)) {
        const delay = normalizeDelay(retryAfterMs - Date.now());
        if (delay !== void 0) {
          return delay;
        }
      }
    }
    const rateLimitReset = headers.get("x-ratelimit-reset");
    if (rateLimitReset) {
      const resetSeconds = Number.parseInt(rateLimitReset, 10);
      if (!Number.isNaN(resetSeconds)) {
        const delay = normalizeDelay(resetSeconds * 1e3 - Date.now());
        if (delay !== void 0) {
          return delay;
        }
      }
    }
    const rateLimitResetAfter = headers.get("x-ratelimit-reset-after");
    if (rateLimitResetAfter) {
      const resetAfterSeconds = Number(rateLimitResetAfter);
      if (Number.isFinite(resetAfterSeconds)) {
        const delay = normalizeDelay(resetAfterSeconds * 1e3);
        if (delay !== void 0) {
          return delay;
        }
      }
    }
  }
  const durationMatch = errorText.match(/reset after (?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s/i);
  if (durationMatch) {
    const hours = durationMatch[1] ? parseInt(durationMatch[1], 10) : 0;
    const minutes = durationMatch[2] ? parseInt(durationMatch[2], 10) : 0;
    const seconds = parseFloat(durationMatch[3]);
    if (!Number.isNaN(seconds)) {
      const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1e3;
      const delay = normalizeDelay(totalMs);
      if (delay !== void 0) {
        return delay;
      }
    }
  }
  const retryInMatch = errorText.match(/Please retry in ([0-9.]+)(ms|s)/i);
  if (retryInMatch?.[1]) {
    const value = parseFloat(retryInMatch[1]);
    if (!Number.isNaN(value) && value > 0) {
      const ms = retryInMatch[2].toLowerCase() === "ms" ? value : value * 1e3;
      const delay = normalizeDelay(ms);
      if (delay !== void 0) {
        return delay;
      }
    }
  }
  const retryDelayMatch = errorText.match(/"retryDelay":\s*"([0-9.]+)(ms|s)"/i);
  if (retryDelayMatch?.[1]) {
    const value = parseFloat(retryDelayMatch[1]);
    if (!Number.isNaN(value) && value > 0) {
      const ms = retryDelayMatch[2].toLowerCase() === "ms" ? value : value * 1e3;
      const delay = normalizeDelay(ms);
      if (delay !== void 0) {
        return delay;
      }
    }
  }
  return void 0;
}
function needsClaudeThinkingBetaHeader(model) {
  return model.provider === "google-antigravity" && model.id.startsWith("claude-") && model.reasoning;
}
function isGemini3ProModel(modelId) {
  return /gemini-3(?:\.1)?-pro/.test(modelId.toLowerCase());
}
function isGemini3FlashModel(modelId) {
  return /gemini-3(?:\.1)?-flash/.test(modelId.toLowerCase());
}
function isGemini3Model(modelId) {
  return isGemini3ProModel(modelId) || isGemini3FlashModel(modelId);
}
function isRetryableError(status, errorText) {
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return /resource.?exhausted|rate.?limit|overloaded|service.?unavailable|other.?side.?closed/i.test(errorText);
}
function extractErrorMessage(errorText) {
  try {
    const parsed = JSON.parse(errorText);
    if (parsed.error?.message) {
      return parsed.error.message;
    }
  } catch {
  }
  return errorText;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Request was aborted"));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new Error("Request was aborted"));
    });
  });
}
var streamGoogleGeminiCli = (model, context, options) => {
  const stream = new AssistantMessageEventStream();
  (async () => {
    const output = {
      role: "assistant",
      content: [],
      api: "google-gemini-cli",
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
      const apiKeyRaw = options?.apiKey;
      if (!apiKeyRaw) {
        throw new Error("Google Cloud Code Assist requires OAuth authentication. Use /login to authenticate.");
      }
      let accessToken;
      let projectId;
      try {
        const parsed = JSON.parse(apiKeyRaw);
        accessToken = parsed.token;
        projectId = parsed.projectId;
      } catch {
        throw new Error("Invalid Google Cloud Code Assist credentials. Use /login to re-authenticate.");
      }
      if (!accessToken || !projectId) {
        throw new Error("Missing token or projectId in Google Cloud credentials. Use /login to re-authenticate.");
      }
      const isAntigravity = model.provider === "google-antigravity";
      const baseUrl = model.baseUrl?.trim();
      const endpoints = baseUrl ? [baseUrl] : isAntigravity ? ANTIGRAVITY_ENDPOINT_FALLBACKS : [DEFAULT_ENDPOINT];
      let requestBody = buildRequest(model, context, projectId, options, isAntigravity);
      const nextRequestBody = await options?.onPayload?.(requestBody, model);
      if (nextRequestBody !== void 0) {
        requestBody = nextRequestBody;
      }
      const headers = isAntigravity ? getAntigravityHeaders() : GEMINI_CLI_HEADERS;
      const requestHeaders = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...headers,
        ...needsClaudeThinkingBetaHeader(model) ? { "anthropic-beta": CLAUDE_THINKING_BETA_HEADER } : {},
        ...options?.headers
      };
      const requestBodyJson = JSON.stringify(requestBody);
      let response;
      let lastError;
      let requestUrl;
      let endpointIndex = 0;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (options?.signal?.aborted) {
          throw new Error("Request was aborted");
        }
        try {
          const endpoint = endpoints[endpointIndex];
          requestUrl = `${endpoint}/v1internal:streamGenerateContent?alt=sse`;
          response = await fetch(requestUrl, {
            method: "POST",
            headers: requestHeaders,
            body: requestBodyJson,
            signal: options?.signal
          });
          if (response.ok) {
            break;
          }
          const errorText = await response.text();
          if ((response.status === 403 || response.status === 404) && endpointIndex < endpoints.length - 1) {
            endpointIndex++;
            continue;
          }
          if (attempt < MAX_RETRIES && isRetryableError(response.status, errorText)) {
            if (endpointIndex < endpoints.length - 1) {
              endpointIndex++;
            }
            const serverDelay = extractRetryDelay(errorText, response);
            const delayMs = serverDelay ?? BASE_DELAY_MS * 2 ** attempt;
            const maxDelayMs = options?.maxRetryDelayMs ?? 6e4;
            if (maxDelayMs > 0 && serverDelay && serverDelay > maxDelayMs) {
              const delaySeconds = Math.ceil(serverDelay / 1e3);
              throw new Error(`Server requested ${delaySeconds}s retry delay (max: ${Math.ceil(maxDelayMs / 1e3)}s). ${extractErrorMessage(errorText)}`);
            }
            await sleep(delayMs, options?.signal);
            continue;
          }
          throw new Error(`Cloud Code Assist API error (${response.status}): ${extractErrorMessage(errorText)}`);
        } catch (error) {
          if (error instanceof Error) {
            if (error.name === "AbortError" || error.message === "Request was aborted") {
              throw new Error("Request was aborted");
            }
          }
          lastError = error instanceof Error ? error : new Error(String(error));
          if (lastError.message === "fetch failed" && lastError.cause instanceof Error) {
            lastError = new Error(`Network error: ${lastError.cause.message}`);
          }
          if (attempt < MAX_RETRIES) {
            const delayMs = BASE_DELAY_MS * 2 ** attempt;
            await sleep(delayMs, options?.signal);
            continue;
          }
          throw lastError;
        }
      }
      if (!response || !response.ok) {
        throw lastError ?? new Error("Failed to get response after retries");
      }
      let started = false;
      const ensureStarted = () => {
        if (!started) {
          stream.push({ type: "start", partial: output });
          started = true;
        }
      };
      const resetOutput = () => {
        output.content = [];
        output.usage = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        };
        output.stopReason = "stop";
        output.errorMessage = void 0;
        output.timestamp = Date.now();
        started = false;
      };
      const streamResponse = async (activeResponse) => {
        if (!activeResponse.body) {
          throw new Error("No response body");
        }
        let hasContent = false;
        let currentBlock = null;
        const blocks = output.content;
        const blockIndex = () => blocks.length - 1;
        const reader = activeResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const abortHandler = () => {
          void reader.cancel().catch(() => {
          });
        };
        options?.signal?.addEventListener("abort", abortHandler);
        try {
          while (true) {
            if (options?.signal?.aborted) {
              throw new Error("Request was aborted");
            }
            const { done, value } = await reader.read();
            if (done)
              break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (!line.startsWith("data:"))
                continue;
              const jsonStr = line.slice(5).trim();
              if (!jsonStr)
                continue;
              let chunk;
              try {
                chunk = JSON.parse(jsonStr);
              } catch {
                continue;
              }
              const responseData = chunk.response;
              if (!responseData)
                continue;
              output.responseId ||= responseData.responseId;
              const candidate = responseData.candidates?.[0];
              if (candidate?.content?.parts) {
                for (const part of candidate.content.parts) {
                  if (part.text !== void 0) {
                    hasContent = true;
                    const isThinking = isThinkingPart(part);
                    if (!currentBlock || isThinking && currentBlock.type !== "thinking" || !isThinking && currentBlock.type !== "text") {
                      if (currentBlock) {
                        if (currentBlock.type === "text") {
                          stream.push({
                            type: "text_end",
                            contentIndex: blocks.length - 1,
                            content: currentBlock.text,
                            partial: output
                          });
                        } else {
                          stream.push({
                            type: "thinking_end",
                            contentIndex: blockIndex(),
                            content: currentBlock.thinking,
                            partial: output
                          });
                        }
                      }
                      if (isThinking) {
                        currentBlock = { type: "thinking", thinking: "", thinkingSignature: void 0 };
                        output.content.push(currentBlock);
                        ensureStarted();
                        stream.push({
                          type: "thinking_start",
                          contentIndex: blockIndex(),
                          partial: output
                        });
                      } else {
                        currentBlock = { type: "text", text: "" };
                        output.content.push(currentBlock);
                        ensureStarted();
                        stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
                      }
                    }
                    if (currentBlock.type === "thinking") {
                      currentBlock.thinking += part.text;
                      currentBlock.thinkingSignature = retainThoughtSignature(currentBlock.thinkingSignature, part.thoughtSignature);
                      stream.push({
                        type: "thinking_delta",
                        contentIndex: blockIndex(),
                        delta: part.text,
                        partial: output
                      });
                    } else {
                      currentBlock.text += part.text;
                      currentBlock.textSignature = retainThoughtSignature(currentBlock.textSignature, part.thoughtSignature);
                      stream.push({
                        type: "text_delta",
                        contentIndex: blockIndex(),
                        delta: part.text,
                        partial: output
                      });
                    }
                  }
                  if (part.functionCall) {
                    hasContent = true;
                    if (currentBlock) {
                      if (currentBlock.type === "text") {
                        stream.push({
                          type: "text_end",
                          contentIndex: blockIndex(),
                          content: currentBlock.text,
                          partial: output
                        });
                      } else {
                        stream.push({
                          type: "thinking_end",
                          contentIndex: blockIndex(),
                          content: currentBlock.thinking,
                          partial: output
                        });
                      }
                      currentBlock = null;
                    }
                    const providedId = part.functionCall.id;
                    const needsNewId = !providedId || output.content.some((b) => b.type === "toolCall" && b.id === providedId);
                    const toolCallId = needsNewId ? `${part.functionCall.name}_${Date.now()}_${++toolCallCounter}` : providedId;
                    const toolCall = {
                      type: "toolCall",
                      id: toolCallId,
                      name: part.functionCall.name || "",
                      arguments: part.functionCall.args ?? {},
                      ...part.thoughtSignature && { thoughtSignature: part.thoughtSignature }
                    };
                    output.content.push(toolCall);
                    ensureStarted();
                    stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
                    stream.push({
                      type: "toolcall_delta",
                      contentIndex: blockIndex(),
                      delta: JSON.stringify(toolCall.arguments),
                      partial: output
                    });
                    stream.push({
                      type: "toolcall_end",
                      contentIndex: blockIndex(),
                      toolCall,
                      partial: output
                    });
                  }
                }
              }
              if (candidate?.finishReason) {
                output.stopReason = mapStopReasonString(candidate.finishReason);
                if (output.content.some((b) => b.type === "toolCall")) {
                  output.stopReason = "toolUse";
                }
              }
              if (responseData.usageMetadata) {
                const promptTokens = responseData.usageMetadata.promptTokenCount || 0;
                const cacheReadTokens = responseData.usageMetadata.cachedContentTokenCount || 0;
                output.usage = {
                  input: promptTokens - cacheReadTokens,
                  output: (responseData.usageMetadata.candidatesTokenCount || 0) + (responseData.usageMetadata.thoughtsTokenCount || 0),
                  cacheRead: cacheReadTokens,
                  cacheWrite: 0,
                  totalTokens: responseData.usageMetadata.totalTokenCount || 0,
                  cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    total: 0
                  }
                };
                calculateCost(model, output.usage);
              }
            }
          }
        } finally {
          options?.signal?.removeEventListener("abort", abortHandler);
        }
        if (currentBlock) {
          if (currentBlock.type === "text") {
            stream.push({
              type: "text_end",
              contentIndex: blockIndex(),
              content: currentBlock.text,
              partial: output
            });
          } else {
            stream.push({
              type: "thinking_end",
              contentIndex: blockIndex(),
              content: currentBlock.thinking,
              partial: output
            });
          }
        }
        return hasContent;
      };
      let receivedContent = false;
      let currentResponse = response;
      for (let emptyAttempt = 0; emptyAttempt <= MAX_EMPTY_STREAM_RETRIES; emptyAttempt++) {
        if (options?.signal?.aborted) {
          throw new Error("Request was aborted");
        }
        if (emptyAttempt > 0) {
          const backoffMs = EMPTY_STREAM_BASE_DELAY_MS * 2 ** (emptyAttempt - 1);
          await sleep(backoffMs, options?.signal);
          if (!requestUrl) {
            throw new Error("Missing request URL");
          }
          currentResponse = await fetch(requestUrl, {
            method: "POST",
            headers: requestHeaders,
            body: requestBodyJson,
            signal: options?.signal
          });
          if (!currentResponse.ok) {
            const retryErrorText = await currentResponse.text();
            throw new Error(`Cloud Code Assist API error (${currentResponse.status}): ${retryErrorText}`);
          }
        }
        const streamed = await streamResponse(currentResponse);
        if (streamed) {
          receivedContent = true;
          break;
        }
        if (emptyAttempt < MAX_EMPTY_STREAM_RETRIES) {
          resetOutput();
        }
      }
      if (!receivedContent) {
        throw new Error("Cloud Code Assist API returned an empty response");
      }
      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }
      if (output.stopReason === "aborted" || output.stopReason === "error") {
        throw new Error("An unknown error occurred");
      }
      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      for (const block of output.content) {
        if ("index" in block) {
          delete block.index;
        }
      }
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();
  return stream;
};
var streamSimpleGoogleGeminiCli = (model, context, options) => {
  const apiKey = options?.apiKey;
  if (!apiKey) {
    throw new Error("Google Cloud Code Assist requires OAuth authentication. Use /login to authenticate.");
  }
  const base = buildBaseOptions(model, options, apiKey);
  if (!options?.reasoning) {
    return streamGoogleGeminiCli(model, context, {
      ...base,
      thinking: { enabled: false }
    });
  }
  const effort = clampReasoning(options.reasoning);
  if (isGemini3Model(model.id)) {
    return streamGoogleGeminiCli(model, context, {
      ...base,
      thinking: {
        enabled: true,
        level: getGeminiCliThinkingLevel(effort, model.id)
      }
    });
  }
  const defaultBudgets = {
    minimal: 1024,
    low: 2048,
    medium: 8192,
    high: 16384
  };
  const budgets = { ...defaultBudgets, ...options.thinkingBudgets };
  const minOutputTokens = 1024;
  let thinkingBudget = budgets[effort];
  const maxTokens = Math.min((base.maxTokens || 0) + thinkingBudget, model.maxTokens);
  if (maxTokens <= thinkingBudget) {
    thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
  }
  return streamGoogleGeminiCli(model, context, {
    ...base,
    maxTokens,
    thinking: {
      enabled: true,
      budgetTokens: thinkingBudget
    }
  });
};
function buildRequest(model, context, projectId, options = {}, isAntigravity = false) {
  const contents = convertMessages(model, context);
  const generationConfig = {};
  if (options.temperature !== void 0) {
    generationConfig.temperature = options.temperature;
  }
  if (options.maxTokens !== void 0) {
    generationConfig.maxOutputTokens = options.maxTokens;
  }
  if (options.thinking?.enabled && model.reasoning) {
    generationConfig.thinkingConfig = {
      includeThoughts: true
    };
    if (options.thinking.level !== void 0) {
      generationConfig.thinkingConfig.thinkingLevel = options.thinking.level;
    } else if (options.thinking.budgetTokens !== void 0) {
      generationConfig.thinkingConfig.thinkingBudget = options.thinking.budgetTokens;
    }
  } else if (model.reasoning && options.thinking && !options.thinking.enabled) {
    generationConfig.thinkingConfig = getDisabledThinkingConfig(model.id);
  }
  const request = {
    contents
  };
  request.sessionId = options.sessionId;
  if (context.systemPrompt) {
    request.systemInstruction = {
      parts: [{ text: sanitizeSurrogates(context.systemPrompt) }]
    };
  }
  if (Object.keys(generationConfig).length > 0) {
    request.generationConfig = generationConfig;
  }
  if (context.tools && context.tools.length > 0) {
    const useParameters = model.id.startsWith("claude-");
    request.tools = convertTools(context.tools, useParameters);
    if (options.toolChoice) {
      request.toolConfig = {
        functionCallingConfig: {
          mode: mapToolChoice(options.toolChoice)
        }
      };
    }
  }
  if (isAntigravity) {
    const existingParts = request.systemInstruction?.parts ?? [];
    request.systemInstruction = {
      role: "user",
      parts: [
        { text: ANTIGRAVITY_SYSTEM_INSTRUCTION },
        { text: `Please ignore following [ignore]${ANTIGRAVITY_SYSTEM_INSTRUCTION}[/ignore]` },
        ...existingParts
      ]
    };
  }
  return {
    project: projectId,
    model: model.id,
    request,
    ...isAntigravity ? { requestType: "agent" } : {},
    userAgent: isAntigravity ? "antigravity" : "pi-coding-agent",
    requestId: `${isAntigravity ? "agent" : "pi"}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  };
}
function getDisabledThinkingConfig(modelId) {
  if (isGemini3ProModel(modelId)) {
    return { thinkingLevel: "LOW" };
  }
  if (isGemini3FlashModel(modelId)) {
    return { thinkingLevel: "MINIMAL" };
  }
  return { thinkingBudget: 0 };
}
function getGeminiCliThinkingLevel(effort, modelId) {
  if (isGemini3ProModel(modelId)) {
    switch (effort) {
      case "minimal":
      case "low":
        return "LOW";
      case "medium":
      case "high":
        return "HIGH";
    }
  }
  switch (effort) {
    case "minimal":
      return "MINIMAL";
    case "low":
      return "LOW";
    case "medium":
      return "MEDIUM";
    case "high":
      return "HIGH";
  }
}
export {
  buildRequest,
  extractRetryDelay,
  streamGoogleGeminiCli,
  streamSimpleGoogleGeminiCli
};
