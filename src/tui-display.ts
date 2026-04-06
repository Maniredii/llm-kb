import {
  TUI, Container, Spacer, Text, Markdown, ProcessTerminal,
  type MarkdownTheme, Input,
} from "@mariozechner/pi-tui";
import chalk from "chalk";

// ── Markdown theme (matches Pi's look) ──────────────────────────────────────

function createMarkdownTheme(): MarkdownTheme {
  return {
    heading:         (t) => chalk.bold(t),
    link:            (t) => chalk.cyan(t),
    linkUrl:         (t) => chalk.dim(t),
    code:            (t) => chalk.cyan(t),
    codeBlock:       (t) => chalk.dim(t),
    codeBlockBorder: (t) => chalk.dim(t),
    quote:           (t) => chalk.italic(t),
    quoteBorder:     (t) => chalk.dim(t),
    hr:              (t) => chalk.dim(t),
    listBullet:      (t) => chalk.dim(t),
    bold:            (t) => chalk.bold(t),
    italic:          (t) => chalk.italic(t),
    underline:       (t) => chalk.underline(t),
    strikethrough:   (t) => chalk.strikethrough(t),
  };
}

const mdTheme = createMarkdownTheme();

// ── Helper to create dim text ───────────────────────────────────────────────

function dimText(text: string, px = 1, py = 0): Text {
  return new Text(chalk.dim(text), px, py);
}

// ── Chat display (manages TUI components for one conversation) ──────────────

export class ChatDisplay {
  private tui: TUI;
  private terminal: ProcessTerminal;
  private messageArea: Container;
  private inputArea: Container;
  private input: Input;
  private separator: Text;

  // Current response components (reset per prompt)
  private currentResponse: Container | null = null;
  private thinkingText: Text | null = null;
  private toolsContainer: Container | null = null;
  private answerMd: Markdown | null = null;
  private completionText: Text | null = null;

  private filesReadCount = 0;
  private shownToolCalls = new Set<string>();
  private startTime = Date.now();

  onSubmit?: (text: string) => void;

  constructor() {
    this.terminal = new ProcessTerminal();
    this.tui = new TUI(this.terminal);

    // Layout: messages + separator + input
    this.messageArea = new Container();
    this.tui.addChild(this.messageArea);

    this.inputArea = new Container();
    const hrLine = chalk.hex("#c678dd")("\u2500".repeat(80));
    this.separator = new Text(hrLine, 0, 0);
    this.inputArea.addChild(this.separator);

    this.input = new Input();
    this.input.onSubmit = (text) => {
      if (text.trim() && this.onSubmit) {
        this.addUserMessage(text.trim());
        this.onSubmit(text.trim());
      }
      this.input.setValue("");
    };
    this.inputArea.addChild(this.input);
    this.inputArea.addChild(new Text(hrLine, 0, 0));

    this.tui.addChild(this.inputArea);
    this.tui.setFocus(this.input);
  }

  start(): void {
    this.tui.start();
    this.tui.requestRender();
  }

  stop(): void {
    this.tui.stop();
  }

  /** Add a user message bubble to the conversation */
  addUserMessage(text: string): void {
    this.messageArea.addChild(new Spacer(1));
    this.messageArea.addChild(new Text(chalk.bold(text), 1, 0));
    this.tui.requestRender();
  }

  // ── Per-prompt display lifecycle ────────────────────────────────────────

  /** Called on agent_start — reset state for new response */
  beginResponse(modelName: string): void {
    this.filesReadCount = 0;
    this.shownToolCalls = new Set();
    this.startTime = Date.now();
    this.thinkingText = null;
    this.toolsContainer = null;
    this.answerMd = null;
    this.completionText = null;

    this.currentResponse = new Container();
    this.currentResponse.addChild(new Spacer(1));
    this.currentResponse.addChild(dimText(`\u27e1 ${modelName}`));
    this.messageArea.addChild(this.currentResponse);
    this.tui.requestRender();
  }

  /** Append thinking text */
  appendThinking(text: string): void {
    if (!this.currentResponse) return;
    if (!this.thinkingText) {
      this.currentResponse.addChild(new Spacer(1));
      this.thinkingText = new Text(chalk.dim(chalk.italic(text)), 2, 0);
      this.currentResponse.addChild(dimText("\u25b8 Thinking"));
      this.currentResponse.addChild(this.thinkingText);
    } else {
      // Append to existing thinking text
      const prev = (this.thinkingText as any).text ?? "";
      this.thinkingText.setText(chalk.dim(chalk.italic(prev.replace(/\x1b\[[0-9;]*m/g, "") + text)));
    }
    this.tui.requestRender();
  }

  /** Show a tool call line */
  addToolCall(toolCallId: string, label: string, toolName: string): void {
    if (!this.currentResponse || this.shownToolCalls.has(toolCallId)) return;
    this.shownToolCalls.add(toolCallId);
    if (toolName === "read") this.filesReadCount++;

    if (!this.toolsContainer) {
      this.toolsContainer = new Container();
      this.currentResponse.addChild(new Spacer(1));
      this.currentResponse.addChild(this.toolsContainer);
    }
    this.toolsContainer.addChild(dimText(`  \u25b8 ${label}`));
    this.tui.requestRender();
  }

  /** Start the answer section with a separator */
  beginAnswer(): void {
    if (!this.currentResponse) return;
    if (this.answerMd) return; // already started

    this.currentResponse.addChild(new Spacer(1));
    const cols = this.terminal.columns || 80;
    this.currentResponse.addChild(dimText("\u2500".repeat(cols), 0));
    this.currentResponse.addChild(new Spacer(1));

    this.answerMd = new Markdown("", 1, 0, mdTheme);
    this.currentResponse.addChild(this.answerMd);
    this.tui.requestRender();
  }

  /** Append text to the answer (called on text_delta) */
  appendAnswer(text: string): void {
    if (!this.answerMd) this.beginAnswer();
    // Markdown component expects the full text — we accumulate
    const prev = (this.answerMd as any).text ?? "";
    this.answerMd!.setText(prev + text);
    this.tui.requestRender();
  }

  /** Show the completion bar */
  showCompletion(): void {
    if (!this.currentResponse) return;
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const source = this.filesReadCount > 0
      ? `${this.filesReadCount} file${this.filesReadCount !== 1 ? "s" : ""} read`
      : "wiki";
    const stats = `${elapsed}s \u00b7 ${source}`;
    const cols = this.terminal.columns || 80;
    const pad = Math.max(0, cols - stats.length - 4);
    const bar = chalk.dim("\u2500\u2500 " + stats + " " + "\u2500".repeat(pad));

    this.currentResponse.addChild(new Spacer(1));
    this.currentResponse.addChild(new Text(bar, 0, 0));
    this.currentResponse = null;
    this.tui.requestRender();
  }

  /** Re-enable the input after response completes */
  enableInput(): void {
    this.tui.setFocus(this.input);
    this.tui.requestRender();
  }

  /** Disable input during response */
  disableInput(): void {
    this.tui.setFocus(null);
  }
}
