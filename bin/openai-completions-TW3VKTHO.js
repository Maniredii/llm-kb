import {
  buildCopilotDynamicHeaders,
  hasCopilotVisionInput
} from "./chunk-65KFH7OI.js";
import {
  OpenAI
} from "./chunk-XFV534WU.js";
import {
  parseStreamingJson
} from "./chunk-3YMNGUZZ.js";
import {
  getEnvApiKey
} from "./chunk-LDHOKBJA.js";
import {
  buildBaseOptions,
  clampReasoning,
  sanitizeSurrogates,
  transformMessages
} from "./chunk-XCXTZJGO.js";
import {
  AssistantMessageEventStream,
  calculateCost,
  supportsXhigh
} from "./chunk-5PYKQQLA.js";
import "./chunk-EAQYK3U2.js";

// node_modules/@mariozechner/pi-ai/dist/providers/openai-completions.js
function hasToolHistory(messages) {
  for (const msg of messages) {
    if (msg.role === "toolResult") {
      return true;
    }
    if (msg.role === "assistant") {
      if (msg.content.some((block) => block.type === "toolCall")) {
        return true;
      }
    }
  }
  return false;
}
var streamOpenAICompletions = (model, context, options) => {
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
      const openaiStream = await client.chat.completions.create(params, { signal: options?.signal });
      stream.push({ type: "start", partial: output });
      let currentBlock = null;
      const blocks = output.content;
      const blockIndex = () => blocks.length - 1;
      const finishCurrentBlock = (block) => {
        if (block) {
          if (block.type === "text") {
            stream.push({
              type: "text_end",
              contentIndex: blockIndex(),
              content: block.text,
              partial: output
            });
          } else if (block.type === "thinking") {
            stream.push({
              type: "thinking_end",
              contentIndex: blockIndex(),
              content: block.thinking,
              partial: output
            });
          } else if (block.type === "toolCall") {
            block.arguments = parseStreamingJson(block.partialArgs);
            delete block.partialArgs;
            stream.push({
              type: "toolcall_end",
              contentIndex: blockIndex(),
              toolCall: block,
              partial: output
            });
          }
        }
      };
      for await (const chunk of openaiStream) {
        if (!chunk || typeof chunk !== "object")
          continue;
        output.responseId ||= chunk.id;
        if (chunk.usage) {
          output.usage = parseChunkUsage(chunk.usage, model);
        }
        const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : void 0;
        if (!choice)
          continue;
        if (!chunk.usage && choice.usage) {
          output.usage = parseChunkUsage(choice.usage, model);
        }
        if (choice.finish_reason) {
          const finishReasonResult = mapStopReason(choice.finish_reason);
          output.stopReason = finishReasonResult.stopReason;
          if (finishReasonResult.errorMessage) {
            output.errorMessage = finishReasonResult.errorMessage;
          }
        }
        if (choice.delta) {
          if (choice.delta.content !== null && choice.delta.content !== void 0 && choice.delta.content.length > 0) {
            if (!currentBlock || currentBlock.type !== "text") {
              finishCurrentBlock(currentBlock);
              currentBlock = { type: "text", text: "" };
              output.content.push(currentBlock);
              stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
            }
            if (currentBlock.type === "text") {
              currentBlock.text += choice.delta.content;
              stream.push({
                type: "text_delta",
                contentIndex: blockIndex(),
                delta: choice.delta.content,
                partial: output
              });
            }
          }
          const reasoningFields = ["reasoning_content", "reasoning", "reasoning_text"];
          let foundReasoningField = null;
          for (const field of reasoningFields) {
            if (choice.delta[field] !== null && choice.delta[field] !== void 0 && choice.delta[field].length > 0) {
              if (!foundReasoningField) {
                foundReasoningField = field;
                break;
              }
            }
          }
          if (foundReasoningField) {
            if (!currentBlock || currentBlock.type !== "thinking") {
              finishCurrentBlock(currentBlock);
              currentBlock = {
                type: "thinking",
                thinking: "",
                thinkingSignature: foundReasoningField
              };
              output.content.push(currentBlock);
              stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
            }
            if (currentBlock.type === "thinking") {
              const delta = choice.delta[foundReasoningField];
              currentBlock.thinking += delta;
              stream.push({
                type: "thinking_delta",
                contentIndex: blockIndex(),
                delta,
                partial: output
              });
            }
          }
          if (choice?.delta?.tool_calls) {
            for (const toolCall of choice.delta.tool_calls) {
              if (!currentBlock || currentBlock.type !== "toolCall" || toolCall.id && currentBlock.id !== toolCall.id) {
                finishCurrentBlock(currentBlock);
                currentBlock = {
                  type: "toolCall",
                  id: toolCall.id || "",
                  name: toolCall.function?.name || "",
                  arguments: {},
                  partialArgs: ""
                };
                output.content.push(currentBlock);
                stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
              }
              if (currentBlock.type === "toolCall") {
                if (toolCall.id)
                  currentBlock.id = toolCall.id;
                if (toolCall.function?.name)
                  currentBlock.name = toolCall.function.name;
                let delta = "";
                if (toolCall.function?.arguments) {
                  delta = toolCall.function.arguments;
                  currentBlock.partialArgs += toolCall.function.arguments;
                  currentBlock.arguments = parseStreamingJson(currentBlock.partialArgs);
                }
                stream.push({
                  type: "toolcall_delta",
                  contentIndex: blockIndex(),
                  delta,
                  partial: output
                });
              }
            }
          }
          const reasoningDetails = choice.delta.reasoning_details;
          if (reasoningDetails && Array.isArray(reasoningDetails)) {
            for (const detail of reasoningDetails) {
              if (detail.type === "reasoning.encrypted" && detail.id && detail.data) {
                const matchingToolCall = output.content.find((b) => b.type === "toolCall" && b.id === detail.id);
                if (matchingToolCall) {
                  matchingToolCall.thoughtSignature = JSON.stringify(detail);
                }
              }
            }
          }
        }
      }
      finishCurrentBlock(currentBlock);
      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }
      if (output.stopReason === "aborted") {
        throw new Error("Request was aborted");
      }
      if (output.stopReason === "error") {
        throw new Error(output.errorMessage || "Provider returned an error stop reason");
      }
      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      for (const block of output.content)
        delete block.index;
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      const rawMetadata = error?.error?.metadata?.raw;
      if (rawMetadata)
        output.errorMessage += `
${rawMetadata}`;
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();
  return stream;
};
var streamSimpleOpenAICompletions = (model, context, options) => {
  const apiKey = options?.apiKey || getEnvApiKey(model.provider);
  if (!apiKey) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }
  const base = buildBaseOptions(model, options, apiKey);
  const reasoningEffort = supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning);
  const toolChoice = options?.toolChoice;
  return streamOpenAICompletions(model, context, {
    ...base,
    reasoningEffort,
    toolChoice
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
  const compat = getCompat(model);
  const messages = convertMessages(model, context, compat);
  maybeAddOpenRouterAnthropicCacheControl(model, messages);
  const params = {
    model: model.id,
    messages,
    stream: true
  };
  if (compat.supportsUsageInStreaming !== false) {
    params.stream_options = { include_usage: true };
  }
  if (compat.supportsStore) {
    params.store = false;
  }
  if (options?.maxTokens) {
    if (compat.maxTokensField === "max_tokens") {
      params.max_tokens = options.maxTokens;
    } else {
      params.max_completion_tokens = options.maxTokens;
    }
  }
  if (options?.temperature !== void 0) {
    params.temperature = options.temperature;
  }
  if (context.tools) {
    params.tools = convertTools(context.tools, compat);
    if (compat.zaiToolStream) {
      params.tool_stream = true;
    }
  } else if (hasToolHistory(context.messages)) {
    params.tools = [];
  }
  if (options?.toolChoice) {
    params.tool_choice = options.toolChoice;
  }
  if (compat.thinkingFormat === "zai" && model.reasoning) {
    params.enable_thinking = !!options?.reasoningEffort;
  } else if (compat.thinkingFormat === "qwen" && model.reasoning) {
    params.enable_thinking = !!options?.reasoningEffort;
  } else if (compat.thinkingFormat === "qwen-chat-template" && model.reasoning) {
    params.chat_template_kwargs = { enable_thinking: !!options?.reasoningEffort };
  } else if (compat.thinkingFormat === "openrouter" && model.reasoning) {
    const openRouterParams = params;
    if (options?.reasoningEffort) {
      openRouterParams.reasoning = {
        effort: mapReasoningEffort(options.reasoningEffort, compat.reasoningEffortMap)
      };
    } else {
      openRouterParams.reasoning = { effort: "none" };
    }
  } else if (options?.reasoningEffort && model.reasoning && compat.supportsReasoningEffort) {
    params.reasoning_effort = mapReasoningEffort(options.reasoningEffort, compat.reasoningEffortMap);
  }
  if (model.baseUrl.includes("openrouter.ai") && model.compat?.openRouterRouting) {
    params.provider = model.compat.openRouterRouting;
  }
  if (model.baseUrl.includes("ai-gateway.vercel.sh") && model.compat?.vercelGatewayRouting) {
    const routing = model.compat.vercelGatewayRouting;
    if (routing.only || routing.order) {
      const gatewayOptions = {};
      if (routing.only)
        gatewayOptions.only = routing.only;
      if (routing.order)
        gatewayOptions.order = routing.order;
      params.providerOptions = { gateway: gatewayOptions };
    }
  }
  return params;
}
function mapReasoningEffort(effort, reasoningEffortMap) {
  return reasoningEffortMap[effort] ?? effort;
}
function maybeAddOpenRouterAnthropicCacheControl(model, messages) {
  if (model.provider !== "openrouter" || !model.id.startsWith("anthropic/"))
    return;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user" && msg.role !== "assistant")
      continue;
    const content = msg.content;
    if (typeof content === "string") {
      msg.content = [
        Object.assign({ type: "text", text: content }, { cache_control: { type: "ephemeral" } })
      ];
      return;
    }
    if (!Array.isArray(content))
      continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const part = content[j];
      if (part?.type === "text") {
        Object.assign(part, { cache_control: { type: "ephemeral" } });
        return;
      }
    }
  }
}
function convertMessages(model, context, compat) {
  const params = [];
  const normalizeToolCallId = (id) => {
    if (id.includes("|")) {
      const [callId] = id.split("|");
      return callId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    }
    if (model.provider === "openai")
      return id.length > 40 ? id.slice(0, 40) : id;
    return id;
  };
  const transformedMessages = transformMessages(context.messages, model, (id) => normalizeToolCallId(id));
  if (context.systemPrompt) {
    const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole;
    const role = useDeveloperRole ? "developer" : "system";
    params.push({ role, content: sanitizeSurrogates(context.systemPrompt) });
  }
  let lastRole = null;
  for (let i = 0; i < transformedMessages.length; i++) {
    const msg = transformedMessages[i];
    if (compat.requiresAssistantAfterToolResult && lastRole === "toolResult" && msg.role === "user") {
      params.push({
        role: "assistant",
        content: "I have processed the tool results."
      });
    }
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        params.push({
          role: "user",
          content: sanitizeSurrogates(msg.content)
        });
      } else {
        const content = msg.content.map((item) => {
          if (item.type === "text") {
            return {
              type: "text",
              text: sanitizeSurrogates(item.text)
            };
          } else {
            return {
              type: "image_url",
              image_url: {
                url: `data:${item.mimeType};base64,${item.data}`
              }
            };
          }
        });
        const filteredContent = !model.input.includes("image") ? content.filter((c) => c.type !== "image_url") : content;
        if (filteredContent.length === 0)
          continue;
        params.push({
          role: "user",
          content: filteredContent
        });
      }
    } else if (msg.role === "assistant") {
      const assistantMsg = {
        role: "assistant",
        content: compat.requiresAssistantAfterToolResult ? "" : null
      };
      const textBlocks = msg.content.filter((b) => b.type === "text");
      const nonEmptyTextBlocks = textBlocks.filter((b) => b.text && b.text.trim().length > 0);
      if (nonEmptyTextBlocks.length > 0) {
        assistantMsg.content = nonEmptyTextBlocks.map((b) => sanitizeSurrogates(b.text)).join("");
      }
      const thinkingBlocks = msg.content.filter((b) => b.type === "thinking");
      const nonEmptyThinkingBlocks = thinkingBlocks.filter((b) => b.thinking && b.thinking.trim().length > 0);
      if (nonEmptyThinkingBlocks.length > 0) {
        if (compat.requiresThinkingAsText) {
          const thinkingText = nonEmptyThinkingBlocks.map((b) => b.thinking).join("\n\n");
          const textContent = assistantMsg.content;
          if (textContent) {
            textContent.unshift({ type: "text", text: thinkingText });
          } else {
            assistantMsg.content = [{ type: "text", text: thinkingText }];
          }
        } else {
          const signature = nonEmptyThinkingBlocks[0].thinkingSignature;
          if (signature && signature.length > 0) {
            assistantMsg[signature] = nonEmptyThinkingBlocks.map((b) => b.thinking).join("\n");
          }
        }
      }
      const toolCalls = msg.content.filter((b) => b.type === "toolCall");
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments)
          }
        }));
        const reasoningDetails = toolCalls.filter((tc) => tc.thoughtSignature).map((tc) => {
          try {
            return JSON.parse(tc.thoughtSignature);
          } catch {
            return null;
          }
        }).filter(Boolean);
        if (reasoningDetails.length > 0) {
          assistantMsg.reasoning_details = reasoningDetails;
        }
      }
      const content = assistantMsg.content;
      const hasContent = content !== null && content !== void 0 && (typeof content === "string" ? content.length > 0 : content.length > 0);
      if (!hasContent && !assistantMsg.tool_calls) {
        continue;
      }
      params.push(assistantMsg);
    } else if (msg.role === "toolResult") {
      const imageBlocks = [];
      let j = i;
      for (; j < transformedMessages.length && transformedMessages[j].role === "toolResult"; j++) {
        const toolMsg = transformedMessages[j];
        const textResult = toolMsg.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
        const hasImages = toolMsg.content.some((c) => c.type === "image");
        const hasText = textResult.length > 0;
        const toolResultMsg = {
          role: "tool",
          content: sanitizeSurrogates(hasText ? textResult : "(see attached image)"),
          tool_call_id: toolMsg.toolCallId
        };
        if (compat.requiresToolResultName && toolMsg.toolName) {
          toolResultMsg.name = toolMsg.toolName;
        }
        params.push(toolResultMsg);
        if (hasImages && model.input.includes("image")) {
          for (const block of toolMsg.content) {
            if (block.type === "image") {
              imageBlocks.push({
                type: "image_url",
                image_url: {
                  url: `data:${block.mimeType};base64,${block.data}`
                }
              });
            }
          }
        }
      }
      i = j - 1;
      if (imageBlocks.length > 0) {
        if (compat.requiresAssistantAfterToolResult) {
          params.push({
            role: "assistant",
            content: "I have processed the tool results."
          });
        }
        params.push({
          role: "user",
          content: [
            {
              type: "text",
              text: "Attached image(s) from tool result:"
            },
            ...imageBlocks
          ]
        });
        lastRole = "user";
      } else {
        lastRole = "toolResult";
      }
      continue;
    }
    lastRole = msg.role;
  }
  return params;
}
function convertTools(tools, compat) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      // TypeBox already generates JSON Schema
      // Only include strict if provider supports it. Some reject unknown fields.
      ...compat.supportsStrictMode !== false && { strict: false }
    }
  }));
}
function parseChunkUsage(rawUsage, model) {
  const cachedTokens = rawUsage.prompt_tokens_details?.cached_tokens || 0;
  const reasoningTokens = rawUsage.completion_tokens_details?.reasoning_tokens || 0;
  const input = (rawUsage.prompt_tokens || 0) - cachedTokens;
  const outputTokens = (rawUsage.completion_tokens || 0) + reasoningTokens;
  const usage = {
    input,
    output: outputTokens,
    cacheRead: cachedTokens,
    cacheWrite: 0,
    totalTokens: input + outputTokens + cachedTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
  calculateCost(model, usage);
  return usage;
}
function mapStopReason(reason) {
  if (reason === null)
    return { stopReason: "stop" };
  switch (reason) {
    case "stop":
    case "end":
      return { stopReason: "stop" };
    case "length":
      return { stopReason: "length" };
    case "function_call":
    case "tool_calls":
      return { stopReason: "toolUse" };
    case "content_filter":
      return { stopReason: "error", errorMessage: "Provider finish_reason: content_filter" };
    case "network_error":
      return { stopReason: "error", errorMessage: "Provider finish_reason: network_error" };
    default:
      return {
        stopReason: "error",
        errorMessage: `Provider finish_reason: ${reason}`
      };
  }
}
function detectCompat(model) {
  const provider = model.provider;
  const baseUrl = model.baseUrl;
  const isZai = provider === "zai" || baseUrl.includes("api.z.ai");
  const isNonStandard = provider === "cerebras" || baseUrl.includes("cerebras.ai") || provider === "xai" || baseUrl.includes("api.x.ai") || baseUrl.includes("chutes.ai") || baseUrl.includes("deepseek.com") || isZai || provider === "opencode" || baseUrl.includes("opencode.ai");
  const useMaxTokens = baseUrl.includes("chutes.ai");
  const isGrok = provider === "xai" || baseUrl.includes("api.x.ai");
  const isGroq = provider === "groq" || baseUrl.includes("groq.com");
  const reasoningEffortMap = isGroq && model.id === "qwen/qwen3-32b" ? {
    minimal: "default",
    low: "default",
    medium: "default",
    high: "default",
    xhigh: "default"
  } : {};
  return {
    supportsStore: !isNonStandard,
    supportsDeveloperRole: !isNonStandard,
    supportsReasoningEffort: !isGrok && !isZai,
    reasoningEffortMap,
    supportsUsageInStreaming: true,
    maxTokensField: useMaxTokens ? "max_tokens" : "max_completion_tokens",
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: false,
    thinkingFormat: isZai ? "zai" : provider === "openrouter" || baseUrl.includes("openrouter.ai") ? "openrouter" : "openai",
    openRouterRouting: {},
    vercelGatewayRouting: {},
    zaiToolStream: false,
    supportsStrictMode: true
  };
}
function getCompat(model) {
  const detected = detectCompat(model);
  if (!model.compat)
    return detected;
  return {
    supportsStore: model.compat.supportsStore ?? detected.supportsStore,
    supportsDeveloperRole: model.compat.supportsDeveloperRole ?? detected.supportsDeveloperRole,
    supportsReasoningEffort: model.compat.supportsReasoningEffort ?? detected.supportsReasoningEffort,
    reasoningEffortMap: model.compat.reasoningEffortMap ?? detected.reasoningEffortMap,
    supportsUsageInStreaming: model.compat.supportsUsageInStreaming ?? detected.supportsUsageInStreaming,
    maxTokensField: model.compat.maxTokensField ?? detected.maxTokensField,
    requiresToolResultName: model.compat.requiresToolResultName ?? detected.requiresToolResultName,
    requiresAssistantAfterToolResult: model.compat.requiresAssistantAfterToolResult ?? detected.requiresAssistantAfterToolResult,
    requiresThinkingAsText: model.compat.requiresThinkingAsText ?? detected.requiresThinkingAsText,
    thinkingFormat: model.compat.thinkingFormat ?? detected.thinkingFormat,
    openRouterRouting: model.compat.openRouterRouting ?? {},
    vercelGatewayRouting: model.compat.vercelGatewayRouting ?? detected.vercelGatewayRouting,
    zaiToolStream: model.compat.zaiToolStream ?? detected.zaiToolStream,
    supportsStrictMode: model.compat.supportsStrictMode ?? detected.supportsStrictMode
  };
}
export {
  convertMessages,
  streamOpenAICompletions,
  streamSimpleOpenAICompletions
};
