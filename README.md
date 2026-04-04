# llm-kb

LLM-powered knowledge base. Drop documents, build a wiki, ask questions.

Inspired by [Karpathy's LLM Knowledge Bases](https://x.com/karpathy/status/2039805659525644595).

```bash
npx llm-kb run ./my-documents
```

## What It Does

- **Ingest** — drop PDFs, Excel, Word, PowerPoint, images, or text into a folder
- **Parse** — automatically converts to markdown (LiteParse for PDFs, ExcelJS for spreadsheets, Mammoth for Word)
- **Index** — LLM reads all sources, maintains an index with summaries and topics
- **Query** — ask questions, get answers with citations
- **Research** — answers saved back to the wiki, compounding knowledge
- **Eval** — checks answers against sources, reports failures

## Tutorial

Building this in public: [themindfulai.dev](https://themindfulai.dev/articles/building-karpathy-knowledge-base-part-1)

## License

MIT
