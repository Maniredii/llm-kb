// node_modules/@mariozechner/pi-ai/dist/utils/sanitize-unicode.js
function sanitizeSurrogates(text) {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

// node_modules/@mariozechner/pi-ai/dist/providers/simple-options.js
function buildBaseOptions(model, options, apiKey) {
  return {
    temperature: options?.temperature,
    maxTokens: options?.maxTokens || Math.min(model.maxTokens, 32e3),
    signal: options?.signal,
    apiKey: apiKey || options?.apiKey,
    cacheRetention: options?.cacheRetention,
    sessionId: options?.sessionId,
    headers: options?.headers,
    onPayload: options?.onPayload,
    maxRetryDelayMs: options?.maxRetryDelayMs,
    metadata: options?.metadata
  };
}
function clampReasoning(effort) {
  return effort === "xhigh" ? "high" : effort;
}
function adjustMaxTokensForThinking(baseMaxTokens, modelMaxTokens, reasoningLevel, customBudgets) {
  const defaultBudgets = {
    minimal: 1024,
    low: 2048,
    medium: 8192,
    high: 16384
  };
  const budgets = { ...defaultBudgets, ...customBudgets };
  const minOutputTokens = 1024;
  const level = clampReasoning(reasoningLevel);
  let thinkingBudget = budgets[level];
  const maxTokens = Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);
  if (maxTokens <= thinkingBudget) {
    thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
  }
  return { maxTokens, thinkingBudget };
}

// node_modules/@mariozechner/pi-ai/dist/providers/transform-messages.js
function transformMessages(messages, model, normalizeToolCallId) {
  const toolCallIdMap = /* @__PURE__ */ new Map();
  const transformed = messages.map((msg) => {
    if (msg.role === "user") {
      return msg;
    }
    if (msg.role === "toolResult") {
      const normalizedId = toolCallIdMap.get(msg.toolCallId);
      if (normalizedId && normalizedId !== msg.toolCallId) {
        return { ...msg, toolCallId: normalizedId };
      }
      return msg;
    }
    if (msg.role === "assistant") {
      const assistantMsg = msg;
      const isSameModel = assistantMsg.provider === model.provider && assistantMsg.api === model.api && assistantMsg.model === model.id;
      const transformedContent = assistantMsg.content.flatMap((block) => {
        if (block.type === "thinking") {
          if (block.redacted) {
            return isSameModel ? block : [];
          }
          if (isSameModel && block.thinkingSignature)
            return block;
          if (!block.thinking || block.thinking.trim() === "")
            return [];
          if (isSameModel)
            return block;
          return {
            type: "text",
            text: block.thinking
          };
        }
        if (block.type === "text") {
          if (isSameModel)
            return block;
          return {
            type: "text",
            text: block.text
          };
        }
        if (block.type === "toolCall") {
          const toolCall = block;
          let normalizedToolCall = toolCall;
          if (!isSameModel && toolCall.thoughtSignature) {
            normalizedToolCall = { ...toolCall };
            delete normalizedToolCall.thoughtSignature;
          }
          if (!isSameModel && normalizeToolCallId) {
            const normalizedId = normalizeToolCallId(toolCall.id, model, assistantMsg);
            if (normalizedId !== toolCall.id) {
              toolCallIdMap.set(toolCall.id, normalizedId);
              normalizedToolCall = { ...normalizedToolCall, id: normalizedId };
            }
          }
          return normalizedToolCall;
        }
        return block;
      });
      return {
        ...assistantMsg,
        content: transformedContent
      };
    }
    return msg;
  });
  const result = [];
  let pendingToolCalls = [];
  let existingToolResultIds = /* @__PURE__ */ new Set();
  for (let i = 0; i < transformed.length; i++) {
    const msg = transformed[i];
    if (msg.role === "assistant") {
      if (pendingToolCalls.length > 0) {
        for (const tc of pendingToolCalls) {
          if (!existingToolResultIds.has(tc.id)) {
            result.push({
              role: "toolResult",
              toolCallId: tc.id,
              toolName: tc.name,
              content: [{ type: "text", text: "No result provided" }],
              isError: true,
              timestamp: Date.now()
            });
          }
        }
        pendingToolCalls = [];
        existingToolResultIds = /* @__PURE__ */ new Set();
      }
      const assistantMsg = msg;
      if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
        continue;
      }
      const toolCalls = assistantMsg.content.filter((b) => b.type === "toolCall");
      if (toolCalls.length > 0) {
        pendingToolCalls = toolCalls;
        existingToolResultIds = /* @__PURE__ */ new Set();
      }
      result.push(msg);
    } else if (msg.role === "toolResult") {
      existingToolResultIds.add(msg.toolCallId);
      result.push(msg);
    } else if (msg.role === "user") {
      if (pendingToolCalls.length > 0) {
        for (const tc of pendingToolCalls) {
          if (!existingToolResultIds.has(tc.id)) {
            result.push({
              role: "toolResult",
              toolCallId: tc.id,
              toolName: tc.name,
              content: [{ type: "text", text: "No result provided" }],
              isError: true,
              timestamp: Date.now()
            });
          }
        }
        pendingToolCalls = [];
        existingToolResultIds = /* @__PURE__ */ new Set();
      }
      result.push(msg);
    } else {
      result.push(msg);
    }
  }
  return result;
}

export {
  sanitizeSurrogates,
  buildBaseOptions,
  clampReasoning,
  adjustMaxTokensForThinking,
  transformMessages
};
