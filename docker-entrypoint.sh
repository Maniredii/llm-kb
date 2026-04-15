#!/bin/bash
set -e

# ── llm-kb Docker Entrypoint ────────────────────────────────────────────────
# 1. Start Ollama server in the background
# 2. Wait for Ollama to be ready
# 3. Pull the configured model (if not already cached)
# 4. Run llm-kb (parse + index if needed, then start UI)
# ─────────────────────────────────────────────────────────────────────────────

MODEL="${OLLAMA_MODEL:-llama3}"
PORT="${LLM_KB_PORT:-3947}"

echo ""
echo "  ╭──────────────────────────────────────────╮"
echo "  │         llm-kb — Docker Edition          │"
echo "  ╰──────────────────────────────────────────╯"
echo ""

# ── Step 1: Start Ollama server ──────────────────────────────────────────────
echo "  📡 Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

# ── Step 2: Wait for Ollama to be ready ─────────────────────────────────────
echo "  ⏳ Waiting for Ollama to start..."
MAX_RETRIES=30
RETRY=0
until curl -s http://127.0.0.1:11434/api/tags > /dev/null 2>&1; do
    RETRY=$((RETRY + 1))
    if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
        echo "  ❌ Ollama failed to start after ${MAX_RETRIES}s"
        exit 1
    fi
    sleep 1
done
echo "  ✅ Ollama is running"

# ── Step 3: Pull the model (idempotent — skips if cached) ──────────────────
echo "  📦 Ensuring model '${MODEL}' is available..."
if ollama list | grep -q "^${MODEL}"; then
    echo "  ✅ Model '${MODEL}' already downloaded"
else
    echo "  ⬇️  Pulling '${MODEL}' (this may take a few minutes on first run)..."
    ollama pull "${MODEL}"
    echo "  ✅ Model '${MODEL}' ready"
fi

# ── Step 4: Prepare the knowledge base if documents exist ──────────────────
DOCS_DIR="/data/documents"

if [ ! -d "${DOCS_DIR}" ]; then
    mkdir -p "${DOCS_DIR}"
    echo "  📁 Created documents directory at ${DOCS_DIR}"
    echo "  💡 Mount your documents: docker run -v /path/to/docs:/data/documents llm-kb"
fi

# Check if we need to run initial parse/index
if [ -d "${DOCS_DIR}" ] && [ "$(ls -A ${DOCS_DIR} 2>/dev/null | grep -v '^\.' | head -1)" ]; then
    # Documents exist — ensure KB is initialized
    if [ ! -d "${DOCS_DIR}/.llm-kb/wiki/sources" ]; then
        echo ""
        echo "  📝 First run — parsing and indexing documents..."
        node /app/bin/cli.js run "${DOCS_DIR}" &
        RUN_PID=$!
        # Wait for the run command to finish initial setup (it will start watching)
        # Kill it after indexing since we want to start the UI instead
        sleep 10
        kill $RUN_PID 2>/dev/null || true
        wait $RUN_PID 2>/dev/null || true
        echo "  ✅ Initial indexing complete"
    fi
fi

# ── Step 5: Launch the Web UI ───────────────────────────────────────────────
echo ""
echo "  🌐 Starting llm-kb web UI on port ${PORT}..."
echo "  📂 Documents: ${DOCS_DIR}"
echo "  🤖 Model: ${MODEL}"
echo ""

# Handle graceful shutdown
cleanup() {
    echo ""
    echo "  Shutting down..."
    kill $OLLAMA_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# Start the web UI — pass through any extra arguments from CMD
if [ "$#" -gt 0 ]; then
    exec node /app/bin/cli.js "$@"
else
    exec node /app/bin/cli.js ui "${DOCS_DIR}" --port "${PORT}"
fi
