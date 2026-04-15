# ── llm-kb Docker Image ──────────────────────────────────────────────────────
# Multi-stage build: builder → production
# Bundles Node.js app + Ollama for a fully self-contained local-first KB
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source & build
COPY tsconfig.json vitest.config.ts ./
COPY src/ src/
RUN npm run build

# ── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:22-slim AS production

LABEL maintainer="Satish Venkatakrishnan <satish@deltaxy.ai>"
LABEL description="LLM-powered knowledge base with verified citations"
LABEL org.opencontainers.image.source="https://github.com/satish860/llm-kb"

# Install curl for health checks & Ollama install
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

WORKDIR /app

# Copy built artifacts from builder
COPY --from=builder /app/bin/ ./bin/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY package.json ./

# Copy the entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create a non-root user for security
RUN groupadd -r llmkb && useradd -r -g llmkb -m llmkb

# Default documents volume mount point
RUN mkdir -p /data/documents && chown -R llmkb:llmkb /data

# Expose the web UI port
EXPOSE 3947

# Health check — verify both the web UI and Ollama are responsive
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3947/api/status || exit 1

# Environment variable defaults
ENV LLM_KB_PORT=3947
ENV OLLAMA_MODEL=llama3
ENV OLLAMA_HOST=http://127.0.0.1:11434

# The entrypoint starts Ollama, pulls the model, then launches llm-kb
ENTRYPOINT ["/docker-entrypoint.sh"]

# Default: start the web UI pointing at /data/documents
CMD ["ui", "/data/documents", "--port", "3947"]
