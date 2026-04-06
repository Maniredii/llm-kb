import {
  convertResponsesMessages,
  convertResponsesTools,
  processResponsesStream
} from "./chunk-IFS3OKBN.js";
import "./chunk-UEODFF7H.js";
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

// node_modules/@mariozechner/pi-ai/dist/providers/openai-codex-responses.js
var _os = null;
var dynamicImport = (specifier) => import(specifier);
var NODE_OS_SPECIFIER = "node:os";
if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
  dynamicImport(NODE_OS_SPECIFIER).then((m) => {
    _os = m;
  });
}
var DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
var JWT_CLAIM_PATH = "https://api.openai.com/auth";
var MAX_RETRIES = 3;
var BASE_DELAY_MS = 1e3;
var CODEX_TOOL_CALL_PROVIDERS = /* @__PURE__ */ new Set(["openai", "openai-codex", "opencode"]);
var CODEX_RESPONSE_STATUSES = /* @__PURE__ */ new Set([
  "completed",
  "incomplete",
  "failed",
  "cancelled",
  "queued",
  "in_progress"
]);
function isRetryableError(status, errorText) {
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return /rate.?limit|overloaded|service.?unavailable|upstream.?connect|connection.?refused/i.test(errorText);
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
var streamOpenAICodexResponses = (model, context, options) => {
  const stream = new AssistantMessageEventStream();
  (async () => {
    const output = {
      role: "assistant",
      content: [],
      api: "openai-codex-responses",
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
      if (!apiKey) {
        throw new Error(`No API key for provider: ${model.provider}`);
      }
      const accountId = extractAccountId(apiKey);
      let body = buildRequestBody(model, context, options);
      const nextBody = await options?.onPayload?.(body, model);
      if (nextBody !== void 0) {
        body = nextBody;
      }
      const websocketRequestId = options?.sessionId || createCodexRequestId();
      const sseHeaders = buildSSEHeaders(model.headers, options?.headers, accountId, apiKey, options?.sessionId);
      const websocketHeaders = buildWebSocketHeaders(model.headers, options?.headers, accountId, apiKey, websocketRequestId);
      const bodyJson = JSON.stringify(body);
      const transport = options?.transport || "sse";
      if (transport !== "sse") {
        let websocketStarted = false;
        try {
          await processWebSocketStream(resolveCodexWebSocketUrl(model.baseUrl), body, websocketHeaders, output, stream, model, () => {
            websocketStarted = true;
          }, options);
          if (options?.signal?.aborted) {
            throw new Error("Request was aborted");
          }
          stream.push({
            type: "done",
            reason: output.stopReason,
            message: output
          });
          stream.end();
          return;
        } catch (error) {
          if (transport === "websocket" || websocketStarted) {
            throw error;
          }
        }
      }
      let response;
      let lastError;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (options?.signal?.aborted) {
          throw new Error("Request was aborted");
        }
        try {
          response = await fetch(resolveCodexUrl(model.baseUrl), {
            method: "POST",
            headers: sseHeaders,
            body: bodyJson,
            signal: options?.signal
          });
          if (response.ok) {
            break;
          }
          const errorText = await response.text();
          if (attempt < MAX_RETRIES && isRetryableError(response.status, errorText)) {
            const delayMs = BASE_DELAY_MS * 2 ** attempt;
            await sleep(delayMs, options?.signal);
            continue;
          }
          const fakeResponse = new Response(errorText, {
            status: response.status,
            statusText: response.statusText
          });
          const info = await parseErrorResponse(fakeResponse);
          throw new Error(info.friendlyMessage || info.message);
        } catch (error) {
          if (error instanceof Error) {
            if (error.name === "AbortError" || error.message === "Request was aborted") {
              throw new Error("Request was aborted");
            }
          }
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < MAX_RETRIES && !lastError.message.includes("usage limit")) {
            const delayMs = BASE_DELAY_MS * 2 ** attempt;
            await sleep(delayMs, options?.signal);
            continue;
          }
          throw lastError;
        }
      }
      if (!response?.ok) {
        throw lastError ?? new Error("Failed after retries");
      }
      if (!response.body) {
        throw new Error("No response body");
      }
      stream.push({ type: "start", partial: output });
      await processStream(response, output, stream, model);
      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }
      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();
  return stream;
};
var streamSimpleOpenAICodexResponses = (model, context, options) => {
  const apiKey = options?.apiKey || getEnvApiKey(model.provider);
  if (!apiKey) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }
  const base = buildBaseOptions(model, options, apiKey);
  const reasoningEffort = supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning);
  return streamOpenAICodexResponses(model, context, {
    ...base,
    reasoningEffort
  });
};
function buildRequestBody(model, context, options) {
  const messages = convertResponsesMessages(model, context, CODEX_TOOL_CALL_PROVIDERS, {
    includeSystemPrompt: false
  });
  const body = {
    model: model.id,
    store: false,
    stream: true,
    instructions: context.systemPrompt,
    input: messages,
    text: { verbosity: options?.textVerbosity || "medium" },
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: options?.sessionId,
    tool_choice: "auto",
    parallel_tool_calls: true
  };
  if (options?.temperature !== void 0) {
    body.temperature = options.temperature;
  }
  if (context.tools) {
    body.tools = convertResponsesTools(context.tools, { strict: null });
  }
  if (options?.reasoningEffort !== void 0) {
    body.reasoning = {
      effort: clampReasoningEffort(model.id, options.reasoningEffort),
      summary: options.reasoningSummary ?? "auto"
    };
  }
  return body;
}
function clampReasoningEffort(modelId, effort) {
  const id = modelId.includes("/") ? modelId.split("/").pop() : modelId;
  if ((id.startsWith("gpt-5.2") || id.startsWith("gpt-5.3") || id.startsWith("gpt-5.4")) && effort === "minimal")
    return "low";
  if (id === "gpt-5.1" && effort === "xhigh")
    return "high";
  if (id === "gpt-5.1-codex-mini")
    return effort === "high" || effort === "xhigh" ? "high" : "medium";
  return effort;
}
function resolveCodexUrl(baseUrl) {
  const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : DEFAULT_CODEX_BASE_URL;
  const normalized = raw.replace(/\/+$/, "");
  if (normalized.endsWith("/codex/responses"))
    return normalized;
  if (normalized.endsWith("/codex"))
    return `${normalized}/responses`;
  return `${normalized}/codex/responses`;
}
function resolveCodexWebSocketUrl(baseUrl) {
  const url = new URL(resolveCodexUrl(baseUrl));
  if (url.protocol === "https:")
    url.protocol = "wss:";
  if (url.protocol === "http:")
    url.protocol = "ws:";
  return url.toString();
}
async function processStream(response, output, stream, model) {
  await processResponsesStream(mapCodexEvents(parseSSE(response)), output, stream, model);
}
async function* mapCodexEvents(events) {
  for await (const event of events) {
    const type = typeof event.type === "string" ? event.type : void 0;
    if (!type)
      continue;
    if (type === "error") {
      const code = event.code || "";
      const message = event.message || "";
      throw new Error(`Codex error: ${message || code || JSON.stringify(event)}`);
    }
    if (type === "response.failed") {
      const msg = event.response?.error?.message;
      throw new Error(msg || "Codex response failed");
    }
    if (type === "response.done" || type === "response.completed" || type === "response.incomplete") {
      const response = event.response;
      const normalizedResponse = response ? { ...response, status: normalizeCodexStatus(response.status) } : response;
      yield { ...event, type: "response.completed", response: normalizedResponse };
      return;
    }
    yield event;
  }
}
function normalizeCodexStatus(status) {
  if (typeof status !== "string")
    return void 0;
  return CODEX_RESPONSE_STATUSES.has(status) ? status : void 0;
}
async function* parseSSE(response) {
  if (!response.body)
    return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done)
        break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
        if (dataLines.length > 0) {
          const data = dataLines.join("\n").trim();
          if (data && data !== "[DONE]") {
            try {
              yield JSON.parse(data);
            } catch {
            }
          }
        }
        idx = buffer.indexOf("\n\n");
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
    }
    try {
      reader.releaseLock();
    } catch {
    }
  }
}
var OPENAI_BETA_RESPONSES_WEBSOCKETS = "responses_websockets=2026-02-06";
var SESSION_WEBSOCKET_CACHE_TTL_MS = 5 * 60 * 1e3;
var websocketSessionCache = /* @__PURE__ */ new Map();
function getWebSocketConstructor() {
  const ctor = globalThis.WebSocket;
  if (typeof ctor !== "function")
    return null;
  return ctor;
}
function headersToRecord(headers) {
  const out = {};
  for (const [key, value] of headers.entries()) {
    out[key] = value;
  }
  return out;
}
function getWebSocketReadyState(socket) {
  const readyState = socket.readyState;
  return typeof readyState === "number" ? readyState : void 0;
}
function isWebSocketReusable(socket) {
  const readyState = getWebSocketReadyState(socket);
  return readyState === void 0 || readyState === 1;
}
function closeWebSocketSilently(socket, code = 1e3, reason = "done") {
  try {
    socket.close(code, reason);
  } catch {
  }
}
function scheduleSessionWebSocketExpiry(sessionId, entry) {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
  }
  entry.idleTimer = setTimeout(() => {
    if (entry.busy)
      return;
    closeWebSocketSilently(entry.socket, 1e3, "idle_timeout");
    websocketSessionCache.delete(sessionId);
  }, SESSION_WEBSOCKET_CACHE_TTL_MS);
}
async function connectWebSocket(url, headers, signal) {
  const WebSocketCtor = getWebSocketConstructor();
  if (!WebSocketCtor) {
    throw new Error("WebSocket transport is not available in this runtime");
  }
  const wsHeaders = headersToRecord(headers);
  delete wsHeaders["OpenAI-Beta"];
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket;
    try {
      socket = new WebSocketCtor(url, { headers: wsHeaders });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const onOpen = () => {
      if (settled)
        return;
      settled = true;
      cleanup();
      resolve(socket);
    };
    const onError = (event) => {
      const error = extractWebSocketError(event);
      if (settled)
        return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onClose = (event) => {
      const error = extractWebSocketCloseError(event);
      if (settled)
        return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      if (settled)
        return;
      settled = true;
      cleanup();
      socket.close(1e3, "aborted");
      reject(new Error("Request was aborted"));
    };
    const cleanup = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
    signal?.addEventListener("abort", onAbort);
  });
}
async function acquireWebSocket(url, headers, sessionId, signal) {
  if (!sessionId) {
    const socket2 = await connectWebSocket(url, headers, signal);
    return {
      socket: socket2,
      release: ({ keep } = {}) => {
        if (keep === false) {
          closeWebSocketSilently(socket2);
          return;
        }
        closeWebSocketSilently(socket2);
      }
    };
  }
  const cached = websocketSessionCache.get(sessionId);
  if (cached) {
    if (cached.idleTimer) {
      clearTimeout(cached.idleTimer);
      cached.idleTimer = void 0;
    }
    if (!cached.busy && isWebSocketReusable(cached.socket)) {
      cached.busy = true;
      return {
        socket: cached.socket,
        release: ({ keep } = {}) => {
          if (!keep || !isWebSocketReusable(cached.socket)) {
            closeWebSocketSilently(cached.socket);
            websocketSessionCache.delete(sessionId);
            return;
          }
          cached.busy = false;
          scheduleSessionWebSocketExpiry(sessionId, cached);
        }
      };
    }
    if (cached.busy) {
      const socket2 = await connectWebSocket(url, headers, signal);
      return {
        socket: socket2,
        release: () => {
          closeWebSocketSilently(socket2);
        }
      };
    }
    if (!isWebSocketReusable(cached.socket)) {
      closeWebSocketSilently(cached.socket);
      websocketSessionCache.delete(sessionId);
    }
  }
  const socket = await connectWebSocket(url, headers, signal);
  const entry = { socket, busy: true };
  websocketSessionCache.set(sessionId, entry);
  return {
    socket,
    release: ({ keep } = {}) => {
      if (!keep || !isWebSocketReusable(entry.socket)) {
        closeWebSocketSilently(entry.socket);
        if (entry.idleTimer)
          clearTimeout(entry.idleTimer);
        if (websocketSessionCache.get(sessionId) === entry) {
          websocketSessionCache.delete(sessionId);
        }
        return;
      }
      entry.busy = false;
      scheduleSessionWebSocketExpiry(sessionId, entry);
    }
  };
}
function extractWebSocketError(event) {
  if (event && typeof event === "object" && "message" in event) {
    const message = event.message;
    if (typeof message === "string" && message.length > 0) {
      return new Error(message);
    }
  }
  return new Error("WebSocket error");
}
function extractWebSocketCloseError(event) {
  if (event && typeof event === "object") {
    const code = "code" in event ? event.code : void 0;
    const reason = "reason" in event ? event.reason : void 0;
    const codeText = typeof code === "number" ? ` ${code}` : "";
    const reasonText = typeof reason === "string" && reason.length > 0 ? ` ${reason}` : "";
    return new Error(`WebSocket closed${codeText}${reasonText}`.trim());
  }
  return new Error("WebSocket closed");
}
async function decodeWebSocketData(data) {
  if (typeof data === "string")
    return data;
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }
  if (ArrayBuffer.isView(data)) {
    const view = data;
    return new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  if (data && typeof data === "object" && "arrayBuffer" in data) {
    const blobLike = data;
    const arrayBuffer = await blobLike.arrayBuffer();
    return new TextDecoder().decode(new Uint8Array(arrayBuffer));
  }
  return null;
}
async function* parseWebSocket(socket, signal) {
  const queue = [];
  let pending = null;
  let done = false;
  let failed = null;
  let sawCompletion = false;
  const wake = () => {
    if (!pending)
      return;
    const resolve = pending;
    pending = null;
    resolve();
  };
  const onMessage = (event) => {
    void (async () => {
      if (!event || typeof event !== "object" || !("data" in event))
        return;
      const text = await decodeWebSocketData(event.data);
      if (!text)
        return;
      try {
        const parsed = JSON.parse(text);
        const type = typeof parsed.type === "string" ? parsed.type : "";
        if (type === "response.completed" || type === "response.done" || type === "response.incomplete") {
          sawCompletion = true;
          done = true;
        }
        queue.push(parsed);
        wake();
      } catch {
      }
    })();
  };
  const onError = (event) => {
    failed = extractWebSocketError(event);
    done = true;
    wake();
  };
  const onClose = (event) => {
    if (sawCompletion) {
      done = true;
      wake();
      return;
    }
    if (!failed) {
      failed = extractWebSocketCloseError(event);
    }
    done = true;
    wake();
  };
  const onAbort = () => {
    failed = new Error("Request was aborted");
    done = true;
    wake();
  };
  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", onError);
  socket.addEventListener("close", onClose);
  signal?.addEventListener("abort", onAbort);
  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error("Request was aborted");
      }
      if (queue.length > 0) {
        yield queue.shift();
        continue;
      }
      if (done)
        break;
      await new Promise((resolve) => {
        pending = resolve;
      });
    }
    if (failed) {
      throw failed;
    }
    if (!sawCompletion) {
      throw new Error("WebSocket stream closed before response.completed");
    }
  } finally {
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("error", onError);
    socket.removeEventListener("close", onClose);
    signal?.removeEventListener("abort", onAbort);
  }
}
async function processWebSocketStream(url, body, headers, output, stream, model, onStart, options) {
  const { socket, release } = await acquireWebSocket(url, headers, options?.sessionId, options?.signal);
  let keepConnection = true;
  try {
    socket.send(JSON.stringify({ type: "response.create", ...body }));
    onStart();
    stream.push({ type: "start", partial: output });
    await processResponsesStream(mapCodexEvents(parseWebSocket(socket, options?.signal)), output, stream, model);
    if (options?.signal?.aborted) {
      keepConnection = false;
    }
  } catch (error) {
    keepConnection = false;
    throw error;
  } finally {
    release({ keep: keepConnection });
  }
}
async function parseErrorResponse(response) {
  const raw = await response.text();
  let message = raw || response.statusText || "Request failed";
  let friendlyMessage;
  try {
    const parsed = JSON.parse(raw);
    const err = parsed?.error;
    if (err) {
      const code = err.code || err.type || "";
      if (/usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(code) || response.status === 429) {
        const plan = err.plan_type ? ` (${err.plan_type.toLowerCase()} plan)` : "";
        const mins = err.resets_at ? Math.max(0, Math.round((err.resets_at * 1e3 - Date.now()) / 6e4)) : void 0;
        const when = mins !== void 0 ? ` Try again in ~${mins} min.` : "";
        friendlyMessage = `You have hit your ChatGPT usage limit${plan}.${when}`.trim();
      }
      message = err.message || friendlyMessage || message;
    }
  } catch {
  }
  return { message, friendlyMessage };
}
function extractAccountId(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3)
      throw new Error("Invalid token");
    const payload = JSON.parse(atob(parts[1]));
    const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
    if (!accountId)
      throw new Error("No account ID in token");
    return accountId;
  } catch {
    throw new Error("Failed to extract accountId from token");
  }
}
function createCodexRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `codex_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
function buildBaseCodexHeaders(initHeaders, additionalHeaders, accountId, token) {
  const headers = new Headers(initHeaders);
  for (const [key, value] of Object.entries(additionalHeaders || {})) {
    headers.set(key, value);
  }
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("chatgpt-account-id", accountId);
  headers.set("originator", "pi");
  const userAgent = _os ? `pi (${_os.platform()} ${_os.release()}; ${_os.arch()})` : "pi (browser)";
  headers.set("User-Agent", userAgent);
  return headers;
}
function buildSSEHeaders(initHeaders, additionalHeaders, accountId, token, sessionId) {
  const headers = buildBaseCodexHeaders(initHeaders, additionalHeaders, accountId, token);
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");
  if (sessionId) {
    headers.set("session_id", sessionId);
  }
  return headers;
}
function buildWebSocketHeaders(initHeaders, additionalHeaders, accountId, token, requestId) {
  const headers = buildBaseCodexHeaders(initHeaders, additionalHeaders, accountId, token);
  headers.delete("accept");
  headers.delete("content-type");
  headers.delete("OpenAI-Beta");
  headers.delete("openai-beta");
  headers.set("OpenAI-Beta", OPENAI_BETA_RESPONSES_WEBSOCKETS);
  headers.set("x-client-request-id", requestId);
  headers.set("session_id", requestId);
  return headers;
}
export {
  streamOpenAICodexResponses,
  streamSimpleOpenAICodexResponses
};
