import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { cn } from "../lib/cn";
import type { ChatMessage, ConversationTurn, ToolResultCard } from "../types";
import { IconDocument, IconMic, IconNote, IconSpeaker } from "./Icons";

/* ------------------------------------------------------------------ */
/*  Status Pills                                                       */
/* ------------------------------------------------------------------ */

/** Pulsing recording indicator */
export function RecordingPill() {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 border border-red-200">
      <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
      <span className="text-xs font-semibold text-red-700">Recording</span>
    </div>
  );
}

/** Speaking indicator */
export function SpeakingPill() {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200">
      <IconSpeaker className="w-3.5 h-3.5 text-blue-600" />
      <span className="text-xs font-semibold text-blue-700">Speaking</span>
    </div>
  );
}

/** Transcribing indicator */
export function TranscribingPill() {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200">
      <IconMic className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
      <span className="text-xs font-semibold text-amber-700">Transcribing...</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Markdown chat bubble                                               */
/* ------------------------------------------------------------------ */

export function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p: ({ children }) => <p className="text-sm leading-relaxed mb-2 last:mb-0">{children}</p>,
        h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-3">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold mb-1.5 mt-2.5">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-bold mb-1 mt-2">{children}</h3>,
        ul: ({ children }) => <ul className="list-disc pl-5 mb-2 text-sm leading-relaxed">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 text-sm leading-relaxed">{children}</ol>,
        li: ({ children }) => <li className="mb-0.5">{children}</li>,
        code: ({ className, children, ...props }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <pre className="bg-zinc-900 text-zinc-100 rounded-lg p-3 mb-2 overflow-x-auto text-xs leading-relaxed">
                <code className={className} {...props}>{children}</code>
              </pre>
            );
          }
          return <code className="bg-zinc-100 text-zinc-800 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>{children}</code>;
        },
        blockquote: ({ children }) => (
          <blockquote className="border-l-3 border-zinc-300 pl-3 italic text-zinc-500 mb-2 text-sm">{children}</blockquote>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto mb-2">
            <table className="min-w-full text-sm border-collapse border border-zinc-200 rounded">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border border-zinc-200 px-3 py-1.5 bg-zinc-50 text-left font-semibold text-xs">{children}</th>,
        td: ({ children }) => <td className="border border-zinc-200 px-3 py-1.5 text-xs">{children}</td>,
        a: ({ href, children }) => <a href={href} className="text-blue-600 underline hover:text-blue-800" target="_blank" rel="noopener noreferrer">{children}</a>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        hr: () => <hr className="border-zinc-200 my-3" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

/* ------------------------------------------------------------------ */
/*  Citation-aware content & Tool result cards                         */
/* ------------------------------------------------------------------ */

/**
 * Parse and render citations in format [CITE:file_path|page|quoted_text]
 * Renders as clickable inline pill buttons that open the referenced source.
 * Shows quoted text on hover.
 */
/** Parse [CITE:path|page|text] tags out of content */
export type ParsedCitation = { filePath: string; page: number; quotedText: string; label: string; kind: "paper" | "note" | "file" };

function citationKind(filePath: string): ParsedCitation["kind"] {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".pdf")) return "paper";
  if (lower.endsWith(".md")) return "note";
  return "file";
}

function parseCitations(content: string): { cleanContent: string; citations: ParsedCitation[] } {
  const citations: ParsedCitation[] = [];
  const seen = new Set<string>();
  const cleanContent = content.replace(
    /\[CITE:([^|\]]+)(?:\|([^|\]]*))?(?:\|([^\]]*))?\]/g,
    (_match, filePath: string, pageStr?: string, text?: string) => {
      const fp = (filePath || "").trim();
      const page = parseInt((pageStr || "").trim(), 10) || 0;
      const quotedText = (text || "").trim();
      const kind = citationKind(fp);
      const fileName = (fp.split("/").pop() || "Source").replace(/\.(pdf|md)$/i, "");
      // Deduplicate by path+page
      const key = `${fp}|${page}`;
      if (!seen.has(key)) {
        seen.add(key);
        citations.push({ filePath: fp, page, quotedText, label: fileName, kind });
      }
      return ""; // strip from rendered text
    }
  );
  return { cleanContent: cleanContent.trim(), citations };
}

export function CitationContent({ content }: { content: string }) {
  const { cleanContent, citations } = useMemo(() => parseCitations(content), [content]);

  return (
    <div>
      <MarkdownContent content={cleanContent} />
      {citations.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-zinc-100">
          {citations.map((cite, i) => (
            <CitationChip key={i} citation={cite} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Small clickable chip that opens the referenced source */
function CitationChip({ citation }: { citation: ParsedCitation }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const { filePath, page, quotedText, label, kind } = citation;

  function handleClick() {
    if (!filePath) return;
    if (page > 0) {
      void window.roxanne.openPdfAtPage(filePath, page);
    } else {
      void window.roxanne.openPath(filePath);
    }
  }

  // Truncate label for display
  const shortLabel = label.length > 30 ? label.slice(0, 28) + "…" : label;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={handleClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs font-medium hover:bg-blue-100 hover:border-blue-300 transition-colors cursor-pointer"
      >
        {kind === "note" ? <IconNote className="w-3 h-3 shrink-0" /> : <svg className="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 1h8a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" /><path d="M5 5h6M5 8h6M5 11h3" /></svg>}
        <span className="truncate max-w-[160px]">{shortLabel}</span>
        {page > 0 && <span className="text-blue-400 shrink-0">p.{page}</span>}
      </button>
      {showTooltip && quotedText && (
        <div className="absolute bottom-full left-0 mb-1.5 z-50 max-w-xs w-max pointer-events-none">
          <div className="bg-zinc-900 text-white text-xs leading-snug px-3 py-2 rounded-lg shadow-lg">
            <p className="italic">&ldquo;{quotedText.slice(0, 200)}{quotedText.length > 200 ? "…" : ""}&rdquo;</p>
            {page > 0 && <p className="mt-1 text-zinc-400 not-italic">Page {page}</p>}
          </div>
        </div>
      )}
    </span>
  );
}

export function toSpeechPlainText(text: string) {
  return text
    .replace(/\[CITE:[^\]]+\]/g, " ")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z0-9_-]*\n?/g, " ").replace(/```/g, " "))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\$\$([^$]+)\$\$/gs, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/\\([\[\](){}*_`#\-])/g, "$1")
    .replace(/(\*\*|__|~~|\*|_)/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripStreamingCitations(text: string, finalize = false) {
  const citePrefix = "[CITE:";
  let clean = "";
  let i = 0;

  while (i < text.length) {
    const remaining = text.slice(i);
    const remainingUpper = remaining.toUpperCase();

    if (remainingUpper.startsWith(citePrefix)) {
      const end = text.indexOf("]", i + citePrefix.length);
      if (end === -1) {
        return { clean, carry: finalize ? "" : text.slice(i) };
      }
      clean += " ";
      i = end + 1;
      continue;
    }

    if (!finalize && remaining[0] === "[" && citePrefix.startsWith(remainingUpper)) {
      return { clean, carry: text.slice(i) };
    }

    clean += text[i];
    i += 1;
  }

  return { clean, carry: "" };
}

export function buildConversationHistory(chatMessages: ChatMessage[]): ConversationTurn[] {
  return chatMessages
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.content.trim())
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));
}

function SourceSearchResultsCard({ payload }: { payload: unknown }) {
  const results = (payload as Array<Record<string, unknown>>) || [];
  if (!results.length) return null;
  return (
    <div className="flex flex-col gap-1 my-2">
      <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">Sources Found</span>
      {results.slice(0, 6).map((result, i) => {
        const sourceType = String(result.source_type || (result.absolute_path ? "note" : "paper"));
        const isNote = sourceType === "note";
        const filePath = (result.citation_path as string) || (result.file_path as string) || (result.absolute_path as string) || "";
        const page = Number(result.page_start ?? result.citation_page ?? 0) || 0;
        const excerpt = String(result.excerpt || result.chunk || "").slice(0, 220);
        const secondary = isNote
          ? `${result.vault_name ? `${String(result.vault_name)} · ` : ""}${String(result.relative_path || "")}`
          : `${result.authors ? String(result.authors).split(";")[0].trim() : ""}${result.year ? ` · ${String(result.year)}` : ""}${page ? ` · p.${page}` : ""}`;

        return (
          <button
            key={i}
            type="button"
            className="flex items-start gap-2 px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 transition-colors text-left"
            onClick={() => {
              if (!filePath) return;
              if (!isNote && page > 0) {
                void window.roxanne.openPdfAtPage(filePath, page);
                return;
              }
              void window.roxanne.openPath(filePath);
            }}
          >
            {isNote ? <IconNote className="shrink-0 text-amber-500 mt-0.5" /> : <IconDocument className="shrink-0 text-blue-500 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <span className="text-xs font-semibold text-zinc-800 truncate block">{String(result.title || "Untitled")}</span>
              {secondary && <span className="text-xs text-zinc-400 truncate block">{secondary}</span>}
              {excerpt && <p className="text-xs text-zinc-600 leading-relaxed line-clamp-2 mt-1">{excerpt}</p>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Card for search_zotero results */
function SearchResultsCard({ payload }: { payload: unknown }) {
  const results = (payload as Array<Record<string, unknown>>) || [];
  if (!results.length) return null;
  return (
    <div className="flex flex-col gap-1 my-2">
      <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">Papers Found</span>
      {results.slice(0, 6).map((r, i) => (
        <button
          key={i}
          type="button"
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 transition-colors text-left"
          onClick={() => {
            const fp = r.file_path as string;
            if (fp) void window.roxanne.openPath(fp);
          }}
        >
          <IconDocument className="shrink-0 text-blue-500" />
          <div className="flex-1 min-w-0">
            <span className="text-xs font-semibold text-zinc-800 truncate block">{String(r.title || "Untitled")}</span>
            <span className="text-xs text-zinc-400">
              {r.authors ? String(r.authors).split(";")[0].trim() : ""}
              {r.year ? ` · ${r.year}` : ""}
              {r.collections ? ` · ${String(r.collections).split(";")[0].trim()}` : ""}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

/** Card for retrieve_paper_chunks results */
function ChunkResultsCard({ payload }: { payload: unknown }) {
  const chunks = (payload as Array<Record<string, unknown>>) || [];
  if (!chunks.length) return null;
  return (
    <div className="flex flex-col gap-1 my-2">
      <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-0.5">Retrieved Chunks</span>
      {chunks.slice(0, 3).map((c, i) => (
        <div key={i} className="px-3 py-2 rounded-lg border border-blue-100 bg-blue-50/50">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-bold text-blue-600">
              {String(c.title || "").slice(0, 60)}
            </span>
            {c.page_start != null && (
              <span className="text-xs font-medium text-blue-500 bg-blue-100 px-1.5 py-0.5 rounded">
                {String(c.page_start) === String(c.page_end) ? `p.${String(c.page_start)}` : `pp.${String(c.page_start)}-${String(c.page_end)}`}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-600 leading-relaxed line-clamp-3">{String(c.chunk || "").slice(0, 300)}</p>
        </div>
      ))}
    </div>
  );
}

/** Card for paper notes */
function NotesResultCard({ payload }: { payload: unknown }) {
  const data = payload as Record<string, unknown>;
  const notes = (data?.notes as Array<Record<string, unknown>>) || [];
  if (!notes.length) return null;
  return (
    <div className="flex flex-col gap-1 my-2">
      <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-0.5">Zotero Notes ({notes.length})</span>
      {notes.slice(0, 5).map((n, i) => (
        <div key={i} className="px-3 py-2 rounded-lg border border-amber-100 bg-amber-50/50">
          <p className="text-xs text-zinc-700 leading-relaxed">{String(n.text || "").slice(0, 400)}</p>
          <span className="text-xs text-zinc-400 mt-1 block">
            {n.date_modified ? `Modified: ${String(n.date_modified).slice(0, 10)}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Card for annotations */
function AnnotationsResultCard({ payload }: { payload: unknown }) {
  const data = payload as Record<string, unknown>;
  const annotations = (data?.annotations as Array<Record<string, unknown>>) || [];
  if (!annotations.length) return null;
  return (
    <div className="flex flex-col gap-1 my-2">
      <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-0.5">Annotations ({annotations.length})</span>
      {annotations.slice(0, 8).map((a, i) => (
        <div key={i} className="flex gap-2 px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50">
          <div
            className="shrink-0 w-1 rounded-full"
            style={{ backgroundColor: (a.color as string) || "#ffd400" }}
          />
          <div className="flex-1 min-w-0">
            {a.highlighted_text ? (
              <p className="text-xs text-zinc-700 italic leading-relaxed">&quot;{String(a.highlighted_text)}&quot;</p>
            ) : null}
            {a.comment ? (
              <p className="text-xs text-zinc-500 mt-0.5">{String(a.comment)}</p>
            ) : null}
            <span className="text-xs text-zinc-400">{a.page ? `p.${String(a.page)}` : ""} · {String(a.type || "highlight")}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Render tool result cards based on tool name */
export function ToolCard({ card }: { card: ToolResultCard }) {
  switch (card.tool) {
    case "search_sources":
    case "read_notes":
      return <SourceSearchResultsCard payload={card.payload} />;
    case "search_zotero":
    case "search_zotero_metadata":
      return <SearchResultsCard payload={card.payload} />;
    case "retrieve_paper_chunks":
      return <ChunkResultsCard payload={card.payload} />;
    case "get_paper_notes":
      return <NotesResultCard payload={card.payload} />;
    case "get_paper_annotations":
      return <AnnotationsResultCard payload={card.payload} />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Collapsible tool steps group (ChatGPT / Claude style)              */
/* ------------------------------------------------------------------ */

export type MessageGroup =
  | { kind: "user" | "assistant"; msg: ChatMessage }
  | { kind: "tool_steps"; steps: ChatMessage[] };

/** Group consecutive status + tool_card messages into collapsible step blocks */
export function groupMessages(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let pendingSteps: ChatMessage[] = [];

  function flushSteps() {
    if (pendingSteps.length > 0) {
      groups.push({ kind: "tool_steps", steps: [...pendingSteps] });
      pendingSteps = [];
    }
  }

  for (const msg of messages) {
    if (msg.role === "status" || msg.role === "tool_card") {
      pendingSteps.push(msg);
    } else {
      flushSteps();
      groups.push({ kind: msg.role as "user" | "assistant", msg });
    }
  }
  flushSteps();
  return groups;
}

/** Pretty label for a tool name */
function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    search_sources: "Searching sources",
    search_zotero: "Searching papers",
    search_zotero_metadata: "Searching metadata",
    retrieve_paper_chunks: "Reading paper chunks",
    get_paper_metadata: "Getting paper info",
    get_paper_notes: "Fetching notes",
    get_paper_annotations: "Fetching annotations",
    search_zotero_notes: "Searching notes",
    list_zotero_collections: "Listing collections",
    get_collection_papers: "Browsing collection",
    read_notes: "Reading Obsidian notes",
    write_note: "Writing note",
    open_pdf: "Opening PDF",
  };
  return labels[name] || name.replace(/_/g, " ");
}

/** A collapsible group of tool calls, like ChatGPT's "Searched 3 sources" */
export function ToolStepsGroup({ steps, isLatest }: { steps: ChatMessage[]; isLatest: boolean }) {
  const [expanded, setExpanded] = useState(false);

  // Extract status labels — backend now sends snappy labels directly
  const toolNames = steps
    .filter((s) => s.role === "status")
    .map((s) => s.content);

  const toolCards = steps.filter((s) => s.role === "tool_card" && s.toolCard);

  // While actively running (latest group), show spinner + current step
  if (isLatest) {
    const lastTool = toolNames[toolNames.length - 1] || "";
    return (
      <div className="self-start max-w-[min(85%,720px)] animate-[fade-in_200ms_ease-out_both]">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200">
          <svg className="w-3.5 h-3.5 text-zinc-400 animate-spin shrink-0" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M8 2a6 6 0 014.9 9.46" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="text-xs text-zinc-500 font-medium">{lastTool}</span>
          {toolNames.length > 1 && (
            <span className="text-xs text-zinc-400 ml-1">({toolNames.length} steps)</span>
          )}
        </div>
      </div>
    );
  }

  // Completed group — show collapsed summary, expandable
  const hasError = toolNames.some((n) => /^error/i.test(n));
  const summary = toolNames.length === 1
    ? toolNames[0]
    : hasError
      ? `Error (${toolNames.length} steps)`
      : `Used ${toolNames.length} tools`;

  return (
    <div className="self-start max-w-[min(85%,720px)] animate-[fade-in_200ms_ease-out_both]">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-50 border border-zinc-200 hover:bg-zinc-100 transition-colors group cursor-pointer"
      >
        {hasError ? (
          <svg className="w-3.5 h-3.5 text-red-500 shrink-0" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm-.5 3a.5.5 0 011 0v4a.5.5 0 01-1 0V4zm.5 7a.75.75 0 100-1.5.75.75 0 000 1.5z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm3.35 4.65a.5.5 0 00-.7 0L7 9.29 5.35 7.65a.5.5 0 10-.7.7l2 2a.5.5 0 00.7 0l4-4a.5.5 0 000-.7z" />
          </svg>
        )}
        <span className={cn("text-xs font-medium", hasError ? "text-red-600" : "text-zinc-500")}>{summary}</span>
        <svg
          className={cn(
            "w-3 h-3 text-zinc-400 transition-transform ml-1",
            expanded && "rotate-180"
          )}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M3 5l3 3 3-3" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2 pl-2 border-l-2 border-zinc-200 ml-4 animate-[fade-in_150ms_ease-out_both]">
          {steps.map((step) =>
            step.role === "status" ? (
              <div key={step.id} className={cn("flex items-center gap-2 text-xs", /^error/i.test(step.content) ? "text-red-500" : "text-zinc-400")}>
                <svg className={cn("w-3 h-3 shrink-0", /^error/i.test(step.content) ? "text-red-400" : "text-emerald-400")} viewBox="0 0 12 12" fill="currentColor">
                  {/^error/i.test(step.content) ? (
                    <path d="M6 0a6 6 0 110 12A6 6 0 016 0zM5.25 3.5v3.5h1.5V3.5h-1.5zM6 9.25a.75.75 0 100-1.5.75.75 0 000 1.5z" />
                  ) : (
                    <circle cx="6" cy="6" r="5" />
                  )}
                </svg>
                {step.content}
              </div>
            ) : step.role === "tool_card" && step.toolCard ? (
              <div key={step.id} className="ml-1">
                <ToolCard card={step.toolCard} />
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
