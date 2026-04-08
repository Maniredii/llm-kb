# llm-kb — Phase 6: Web UI with Source Verification

> **Current state (v0.5.0):** TUI chat with structured citations, bounding box data from PDF source JSON, wiki with page-level citations, eval with citation metrics.
>
> **What's missing:** You can't visually verify citations. The bbox coordinates exist in the answer — but you can't see them on the actual PDF page. The TUI shows `✅ bbox (138,334 → 525,381)` but what does that look like?
>
> **This phase:** A web UI where you click a citation and see the highlighted rectangle on the PDF page.

---

## Design Reference

The UI follows the **Hercules V2 design language** — warm paper tones, serif headings, minimal chrome. Not a generic chat UI. It should feel like a professional document research tool.

### Color Palette (from Hercules)

```
Paper:        #f8f6f3  (background)
Paper Warm:   #f2efe9  (cards, chat bubbles)
Paper Dim:    #e8e4dd  (borders, separators)
Ink:          #1a1520  (primary text)
Ink Soft:     #4a4340  (body text)
Ink Faint:    #7a7470  (muted text)
Mid:          #9b9590  (labels, metadata)
Mid Light:    #c4bfb8  (subtle borders)
Purple:       #4F2D7F  (brand accent, user bubbles)
Purple Soft:  #6B4C9A  (hover states)
Purple BG:    #2A1845  (sidebar background)
Teal:         #0d7d85  (streaming indicator, info)
Good:         #2d8a4e  (success, verified)
Warn:         #b87a00  (warnings)
Urgent:       #c41d2e  (errors)
```

### Typography

- **Headings:** Serif (Georgia, Fraunces) — `font-serif`
- **Body:** Sans (Instrument Sans, system-ui) — `font-sans`
- **Code/Data:** Mono (JetBrains Mono) — `font-mono`
- **Sizes:** Body 14px, Labels 10px uppercase, Data 13px mono

### Component Patterns (from Hercules chat)

- **User messages:** Right-aligned, purple rounded bubble (`bg-[#4F2D7F] text-white rounded-2xl rounded-br-md`)
- **Assistant messages:** Left-aligned, warm paper bubble (`bg-[#f2efe9] rounded-2xl rounded-bl-md`)
- **Tool cards:** Bordered card with status dot (teal pulse = running, green = done, red = error)
- **Thinking indicator:** Three bouncing dots in purple
- **Input bar:** Rounded pill with send button, bottom of chat panel
- **Completion stats:** Subtle text below assistant message (tokens, cost, tool calls)

---

## Architecture

### No Framework. Single HTML File.

The spec says "single HTML file, no build step, no React." This is a localhost tool, not a production app. The HTML file includes inline CSS + JS. Libraries loaded from CDN:

- **pdf.js** — render PDF pages client-side (Mozilla CDN)
- **marked.js** — render markdown in chat messages (CDN)

### Server Stack

```
src/web/server.ts    — Hono HTTP server + WebSocket
src/web/bridge.ts    — Routes agent session events → WebSocket JSON
src/web/public/      — Static HTML/CSS/JS (single index.html)
```

### New Dependency

```
hono — lightweight HTTP framework (~200KB)
```

### Endpoints

```
GET  /                      → index.html (SPA)
GET  /api/status            → KB stats (sources, wiki, config)
GET  /api/sources            → list of source files [{name, pages, hasJson}]
GET  /api/pdf/:filename     → serve original PDF from user's folder
GET  /api/bbox/:filename    → serve bbox JSON from .llm-kb/wiki/sources/
GET  /api/wiki              → wiki.md content
WS   /ws/chat               → streaming agent session
```

---

## Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  llm-kb                                    [Chat] [Wiki] [Src] │
├────────────────────────────┬────────────────────────────────────┤
│                            │                                    │
│  Chat Panel                │  Source Viewer                     │
│                            │                                    │
│  ⟡ claude-sonnet-4-6      │  ┌────────────────────────────┐    │
│                            │  │                            │    │
│  ▸ Reading file.md         │  │   PDF page rendered        │    │
│  ▸ Running bash            │  │   via pdf.js               │    │
│                            │  │                            │    │
│  The divorce was granted   │  │   ┌──────────────────┐     │    │
│  on 17 August 2020. [1]    │  │   │ ██ HIGHLIGHTED ██ │     │    │
│                            │  │   │ ██ BBOX REGION ██ │     │    │
│  ── Citations ──           │  │   └──────────────────┘     │    │
│  [1] 📄 List.pdf, p.3     │  │                            │    │
│      ✅ bbox               │  └────────────────────────────┘    │
│                            │                                    │
│  ┌──────────────────────┐  │  ◄ Page 3 of 3 ►                  │
│  │ Ask anything...      │  │  [Fit] [100%] [200%]              │
│  └──────────────────────┘  │                                    │
├────────────────────────────┴────────────────────────────────────┤
│  3 sources · 12 wiki concepts · 100% bbox coverage              │
└─────────────────────────────────────────────────────────────────┘
```

- **Left panel (50%):** Chat — messages stream in, citations at bottom
- **Right panel (50%):** Source Viewer — PDF page with SVG highlight overlay
- **Responsive:** On narrow screens (<768px), stacked vertically
- **Status bar:** Bottom — source count, wiki concepts, citation stats

---

## WebSocket Protocol

Client → Server:
```json
{ "type": "message", "text": "When was the divorce granted?" }
{ "type": "stop" }
```

Server → Client:
```json
{ "type": "status", "model": "claude-sonnet-4-6" }
{ "type": "thinking_start" }
{ "type": "thinking_delta", "text": "..." }
{ "type": "thinking_end" }
{ "type": "tool_start", "id": "tc1", "label": "Reading file.md", "name": "read" }
{ "type": "tool_end", "id": "tc1", "isError": false }
{ "type": "text_start" }
{ "type": "text_delta", "text": "..." }
{ "type": "text_end" }
{ "type": "citations", "data": [
  { "file": "doc.pdf", "page": 3, "quote": "...", "bbox": {"x":138,"y":334,"width":387,"height":47} },
  { "file": "doc.pdf", "pages": [17,18], "quote": "...", "bbox": [{"page":17,...},{"page":18,...}] }
]}
{ "type": "done", "elapsed": 42.0, "filesRead": 3, "citationCount": 2 }
```

The `citations` event is sent after `text_end` — parsed from the answer using `parseCitations()`.

---

## Source Viewer — PDF Rendering

### Client-Side pdf.js

The browser loads the raw PDF via `GET /api/pdf/:filename`. pdf.js renders a single page to a `<canvas>` element at 2x scale for retina.

```javascript
const pdf = await pdfjsLib.getDocument('/api/pdf/document.pdf').promise;
const page = await pdf.getPage(pageNum);
const viewport = page.getViewport({ scale: 2 });
const canvas = document.getElementById('pdf-canvas');
canvas.width = viewport.width;
canvas.height = viewport.height;
await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
```

### SVG Highlight Overlay

An SVG layer positioned absolutely over the canvas. Bounding boxes from citations are scaled to match the canvas coordinates.

```html
<div class="source-viewer" style="position: relative;">
  <canvas id="pdf-canvas"></canvas>
  <svg class="highlights" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;">
    <rect x="138" y="334" width="387" height="47"
          fill="rgba(79, 45, 127, 0.15)"
          stroke="rgba(79, 45, 127, 0.4)"
          stroke-width="2"
          rx="3" />
  </svg>
</div>
```

### Coordinate Mapping

PDF bbox coordinates are in PDF point space (72 DPI). The canvas renders at `scale * 72 DPI`. The SVG viewBox must match the PDF page dimensions so bbox coordinates map 1:1.

```
SVG viewBox = "0 0 {page.width} {page.height}"   (in PDF points)
Bbox rect   = x, y, width, height                 (already in PDF points)
```

The canvas size is `page.width * scale` × `page.height * scale`, but the SVG scales automatically via viewBox.

### Interaction

- **Click citation chip in chat** → Source Viewer loads that file + page, shows highlights
- **Hover citation** → highlight pulses (CSS animation)
- **Page navigation:** ◄ ► buttons, page number display
- **Zoom:** Fit width, 100%, 200% (changes pdf.js scale factor)

---

## Agent Bridge

### `src/web/bridge.ts`

Wraps the same `createChat()` from `query.ts`. Routes session events to WebSocket.

```typescript
function bridgeToWebSocket(session: AgentSession, ws: WebSocket): void {
  session.subscribe((event) => {
    // Same event types as subscribeDisplay in query.ts
    // Transform to WebSocket JSON protocol
    // Parse citations from answer on text_end
  });
}
```

This is a thin adapter. The agent session is identical to TUI mode — same AGENTS.md, same tools, same wiki. The Web UI is just a different display target.

---

## Slices (Build Order)

| Slice | What | Effort | Delivers |
|---|---|---|---|
| **W1** | Hono server + `llm-kb ui` command + serve static HTML | 0.5 day | Browser opens at localhost:3947 |
| **W2** | WebSocket chat — send message, receive streaming events | 1 day | Basic chat works in browser |
| **W3** | Agent bridge — route session events to WebSocket JSON | 0.5 day | Full streaming: thinking, tools, text |
| **W4** | Chat panel UI — messages, tool cards, thinking dots | 1 day | Chat looks like Hercules |
| **W5** | Citation parsing on client + citation chips below answers | 0.5 day | Clickable [1] [2] chips |
| **W6** | PDF endpoint + client-side pdf.js page rendering | 1 day | Right panel shows PDF page |
| **W7** | SVG highlight overlay — click citation → highlight bbox | 0.5 day | The magic moment |
| **W8** | Citation verification — cross-check agent's bbox using `citations.ts` | 0.5 day | ✅/⚠️/❌ per citation |
| **W9** | Wiki tab + status bar + polish | 0.5 day | Complete UI |
| **Total** | | **~6 days** | |

### Critical Path

W1 → W2 → W3 → W4 (chat works) → W5 (citations clickable) → W6 → W7 (highlight on PDF).

W8 (verification) and W9 (wiki/polish) are independent and can come after.

---

## CLI Changes

```
llm-kb ui <folder>     — Start web UI (new command)
  --port <n>           — Port number (default: 3947)
  --no-open            — Don't auto-open browser
```

Internally: runs `scan + parse + index` (same as `run`), starts Hono server, opens browser, creates agent session on first WebSocket connection.

---

## File Changes Summary

### New Files
| File | What |
|---|---|
| `src/web/server.ts` | Hono HTTP + WebSocket server |
| `src/web/bridge.ts` | Agent session → WebSocket event adapter |
| `src/web/public/index.html` | Single-file SPA (inline CSS/JS, ~800 lines) |

### Modified Files
| File | What Changes |
|---|---|
| `src/cli.ts` | Add `ui` command |
| `package.json` | Add `hono` dependency |

---

## What NOT to Build

- ❌ React/Next.js/any framework (single HTML, vanilla JS)
- ❌ User auth (localhost only)
- ❌ Multiple simultaneous users (single agent session)
- ❌ Full PDF viewer with scroll (single page at a time, nav buttons)
- ❌ Edit wiki from UI (edit files directly)
- ❌ Server-side PDF rendering (client-side pdf.js only)
- ❌ Annotation/editing of highlights (read-only verification)
- ❌ Dark mode (light only, Hercules style)
- ❌ Mobile optimization (desktop-first, responsive is nice-to-have)

---

## Definition of Done

- [ ] `llm-kb ui ./docs` opens browser at localhost:3947
- [ ] Chat panel streams thinking, tool calls, answer text
- [ ] Clicking a citation chip loads the PDF page in Source Viewer
- [ ] SVG highlights overlay on the correct bounding boxes (verified visually)
- [ ] Hover citation → highlight pulses in viewer
- [ ] Page navigation (prev/next) works
- [ ] Wiki tab renders wiki.md with clickable source references
- [ ] Status bar shows source count, wiki concepts, citation stats
- [ ] Same agent session as TUI — no new AI logic
- [ ] Citation verification: ✅ confirmed, ⚠️ approximate, ❌ mismatch

---

*Phase 6 spec written April 8, 2026. DeltaXY.*
*The bounding boxes are verified. Now let's see them.*
