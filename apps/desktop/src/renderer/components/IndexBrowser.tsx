import { useEffect, useState, type ReactNode } from "react";
import type { IndexBrowseItem, NoteTreeResult, NoteVaultGroup, PaperCollectionGroup, PaperTreeItem, PaperTreeResult, ZoteroNoteGroup, ZoteroNoteTreeResult } from "../types";
import { browseIndex, getIndexTree } from "../api";
import { Input } from "./ui/input";
import { cn } from "../lib/cn";
import { IconBook, IconChevron, IconDocument, IconFolder, IconNote, IconX } from "./Icons";
import { MarkdownContent } from "./ChatMessages";

const INDEX_TABS = ["papers", "notes", "zotero_notes", "memories"] as const;
type IndexTab = (typeof INDEX_TABS)[number];
const TAB_LABELS: Record<IndexTab, string> = { papers: "Papers", notes: "Obsidian Notes", zotero_notes: "Zotero Notes", memories: "Memories" };

type ViewMode = "tree" | "flat";

/** Collapsible section wrapper */
function TreeSection({ title, badge, defaultOpen, icon, children }: {
  title: string;
  badge?: string | number;
  defaultOpen?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="border border-zinc-200 rounded-lg bg-white overflow-hidden">
      <button
        type="button"
        className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-zinc-50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className={cn("shrink-0 text-zinc-400 transition-transform duration-150", open && "rotate-90")}>
          <IconChevron />
        </span>
        {icon}
        <span className="flex-1 min-w-0 text-sm font-semibold text-zinc-900 truncate">{title}</span>
        {badge !== undefined && (
          <span className="shrink-0 text-xs font-bold text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full">{badge}</span>
        )}
      </button>
      {open && <div className="border-t border-zinc-200">{children}</div>}
    </div>
  );
}

/** Single paper row inside a collection tree */
function PaperRow({ paper, onSelect }: { paper: PaperTreeItem; onSelect: (paperId: string) => void }) {
  return (
    <button
      type="button"
      className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-zinc-50 transition-colors border-b border-zinc-50 last:border-b-0"
      onClick={() => onSelect(paper.paper_id)}
    >
      <IconDocument className="shrink-0 text-zinc-400" />
      <div className="flex-1 min-w-0">
        <span className="text-sm text-zinc-800 truncate block">{paper.title}</span>
        <span className="text-xs text-zinc-400 block mt-0.5">
          {paper.authors?.split(";")[0]?.trim() || ""}
          {paper.year ? ` · ${paper.year}` : ""}
          {paper.total_pages ? ` · ${paper.total_pages} pages` : ""}
          {paper.total_chunks ? ` · ${paper.total_chunks} chunks` : ""}
        </span>
      </div>
      <IconChevron className="shrink-0 text-zinc-300" />
    </button>
  );
}

/** Chunk detail viewer shown when drilling into a paper/note */
function ChunkViewer({ baseUrl, collection, groupId, groupField, title, onBack }: {
  baseUrl: string;
  collection: string;
  groupId: string;
  groupField: string;
  title: string;
  onBack: () => void;
}) {
  const [items, setItems] = useState<IndexBrowseItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    browseIndex(baseUrl, collection as "papers" | "notes" | "zotero_notes" | "memories", 2000, 0, true)
      .then((res) => {
        const filtered = res.items.filter((item) => String(item.metadata[groupField]) === groupId);
        filtered.sort((a, b) => ((a.metadata.chunk_index as number) || 0) - ((b.metadata.chunk_index as number) || 0));
        setItems(filtered);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [baseUrl, collection, groupId, groupField]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-200 bg-white shrink-0">
        <button type="button" className="text-zinc-400 hover:text-zinc-900 transition-colors p-1" onClick={onBack}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11L5 7l4-4" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-zinc-900 truncate">{title}</h3>
          <span className="text-xs text-zinc-400">{items.length} chunks</span>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && <p className="py-8 text-center text-sm text-zinc-400">Loading chunks...</p>}
        {!loading && items.length === 0 && <p className="py-8 text-center text-sm text-zinc-400">No chunks found.</p>}
        {items.map((chunk, i) => {
          const pageStart = chunk.metadata.page_start as number | undefined;
          const pageEnd = chunk.metadata.page_end as number | undefined;
          const pageLabel = pageStart
            ? pageStart === pageEnd ? `p.${pageStart}` : `pp.${pageStart}-${pageEnd}`
            : "";
          return (
            <div key={chunk.id} className="px-5 py-4 border-b border-zinc-200">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Chunk {(chunk.metadata.chunk_index as number) ?? i}
                </span>
                {pageLabel && (
                  <span className="text-xs font-medium text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">
                    {pageLabel}
                  </span>
                )}
              </div>
              <div className="text-sm text-zinc-700 leading-relaxed prose prose-sm max-w-none">
                <MarkdownContent content={chunk.text} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IndexBrowser({ baseUrl, onClose }: { baseUrl: string; onClose: () => void }) {
  const [tab, setTab] = useState<IndexTab>("papers");
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  // Tree data
  const [paperTree, setPaperTree] = useState<PaperTreeResult | null>(null);
  const [noteTree, setNoteTree] = useState<NoteTreeResult | null>(null);
  const [zoteroNoteTree, setZoteroNoteTree] = useState<ZoteroNoteTreeResult | null>(null);

  // Flat data (for memories which don't have tree view)
  const [flatItems, setFlatItems] = useState<IndexBrowseItem[]>([]);
  const [flatTotal, setFlatTotal] = useState(0);

  // Drill-down state
  const [drillDown, setDrillDown] = useState<{ collection: string; groupId: string; groupField: string; title: string } | null>(null);

  // Expanded sections tracking
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    if (!baseUrl) return;
    setLoading(true);
    setDrillDown(null);
    setFilter("");

    if (tab === "memories") {
      browseIndex(baseUrl, "memories", 500, 0, false)
        .then((res) => { setFlatItems(res.items); setFlatTotal(res.total); })
        .catch(() => { setFlatItems([]); setFlatTotal(0); })
        .finally(() => setLoading(false));
      return;
    }

    if (viewMode === "tree") {
      getIndexTree(baseUrl, tab)
        .then((res) => {
          if (tab === "papers") setPaperTree(res as PaperTreeResult);
          else if (tab === "notes") setNoteTree(res as NoteTreeResult);
          else setZoteroNoteTree(res as ZoteroNoteTreeResult);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      browseIndex(baseUrl, tab, 500, 0, false)
        .then((res) => { setFlatItems(res.items); setFlatTotal(res.total); })
        .catch(() => { setFlatItems([]); setFlatTotal(0); })
        .finally(() => setLoading(false));
    }
  }, [baseUrl, tab, viewMode]);

  // If drilling down into a specific paper/note, show chunk viewer
  if (drillDown) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 bg-white shrink-0">
          <h2 className="text-base font-bold text-zinc-900">Index Browser</h2>
          <button type="button" className="text-zinc-400 hover:text-zinc-900 transition-colors p-1" onClick={onClose}><IconX /></button>
        </div>
        <ChunkViewer
          baseUrl={baseUrl}
          collection={drillDown.collection}
          groupId={drillDown.groupId}
          groupField={drillDown.groupField}
          title={drillDown.title}
          onBack={() => setDrillDown(null)}
        />
      </div>
    );
  }

  const filterLower = filter.toLowerCase();

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 bg-white shrink-0">
        <h2 className="text-base font-bold text-zinc-900">Index Browser</h2>
        <button type="button" className="text-zinc-400 hover:text-zinc-900 transition-colors p-1" onClick={onClose}><IconX /></button>
      </div>

      {/* Tabs + view toggle */}
      <div className="flex items-center gap-1 px-5 py-2 border-b border-zinc-200 bg-white shrink-0 overflow-x-auto">
        {INDEX_TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors",
              tab === t ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            )}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {tab !== "memories" && (
            <div className="flex border border-zinc-200 rounded-lg overflow-hidden">
              <button
                type="button"
                className={cn("px-2 py-1 text-xs font-medium", viewMode === "tree" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100")}
                onClick={() => setViewMode("tree")}
              >
                Tree
              </button>
              <button
                type="button"
                className={cn("px-2 py-1 text-xs font-medium", viewMode === "flat" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100")}
                onClick={() => setViewMode("flat")}
              >
                Flat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filter */}
      <div className="px-5 py-2 shrink-0 bg-white border-b border-zinc-200">
        <Input placeholder="Filter by title..." value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 text-sm" />
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
        {loading && <p className="py-8 text-center text-sm text-zinc-400">Loading...</p>}

        {/* ── Papers tree ── */}
        {!loading && tab === "papers" && viewMode === "tree" && paperTree && (
          <div className="flex flex-col gap-2">
            <div className="text-xs text-zinc-400 mb-1">{paperTree.total_papers} papers in {paperTree.groups.length} collections</div>
            {paperTree.groups
              .filter((g) => !filterLower || g.name.toLowerCase().includes(filterLower) || g.papers.some((p) => p.title.toLowerCase().includes(filterLower)))
              .map((group) => (
                <TreeSection
                  key={group.name}
                  title={group.name}
                  badge={group.paper_count}
                  icon={<IconFolder className="shrink-0 text-amber-500 w-4 h-4" />}
                  defaultOpen={paperTree.groups.length <= 5}
                >
                  {group.papers
                    .filter((p) => !filterLower || p.title.toLowerCase().includes(filterLower) || p.authors?.toLowerCase().includes(filterLower))
                    .map((paper) => (
                      <PaperRow
                        key={paper.paper_id}
                        paper={paper}
                        onSelect={(id) => setDrillDown({ collection: "papers", groupId: id, groupField: "paper_id", title: paper.title })}
                      />
                    ))}
                </TreeSection>
              ))}
          </div>
        )}

        {/* ── Notes tree ── */}
        {!loading && tab === "notes" && viewMode === "tree" && noteTree && (
          <div className="flex flex-col gap-2">
            <div className="text-xs text-zinc-400 mb-1">{noteTree.total_notes} notes in {noteTree.groups.length} vaults</div>
            {noteTree.groups.map((vault) => (
              <TreeSection
                key={vault.name}
                title={vault.name}
                badge={vault.total_notes}
                icon={<IconBook className="shrink-0 text-purple-500 w-4 h-4" />}
                defaultOpen={true}
              >
                {vault.folders
                  .filter((f) => !filterLower || f.path.toLowerCase().includes(filterLower) || f.notes.some((n) => n.title.toLowerCase().includes(filterLower)))
                  .map((folder) => (
                    <div key={folder.path}>
                      <div className="flex items-center gap-2 px-4 py-2 bg-zinc-50 border-b border-zinc-200">
                        <IconFolder className="shrink-0 text-zinc-400 w-3.5 h-3.5" />
                        <span className="text-xs font-medium text-zinc-500">{folder.path}</span>
                        <span className="text-xs text-zinc-400 ml-auto">{folder.note_count}</span>
                      </div>
                      {folder.notes
                        .filter((n) => !filterLower || n.title.toLowerCase().includes(filterLower))
                        .map((note) => (
                          <button
                            key={note.note_id}
                            type="button"
                            className="flex items-center gap-2 w-full pl-8 pr-4 py-2 text-left hover:bg-zinc-50 transition-colors border-b border-zinc-50 last:border-b-0"
                            onClick={() => setDrillDown({ collection: "notes", groupId: note.note_id, groupField: "note_id", title: note.title })}
                          >
                            <IconNote className="shrink-0 text-zinc-400" />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm text-zinc-800 truncate block">{note.title}</span>
                              <span className="text-xs text-zinc-400">{note.total_chunks} chunks</span>
                            </div>
                            <IconChevron className="shrink-0 text-zinc-300" />
                          </button>
                        ))}
                    </div>
                  ))}
              </TreeSection>
            ))}
          </div>
        )}

        {/* ── Zotero Notes tree ── */}
        {!loading && tab === "zotero_notes" && viewMode === "tree" && zoteroNoteTree && (
          <div className="flex flex-col gap-2">
            <div className="text-xs text-zinc-400 mb-1">{zoteroNoteTree.total_notes} notes across {zoteroNoteTree.groups.length} papers</div>
            {zoteroNoteTree.groups
              .filter((g) => !filterLower || g.parent_title.toLowerCase().includes(filterLower))
              .map((group) => (
                <TreeSection
                  key={group.parent_title}
                  title={group.parent_title}
                  badge={group.note_count}
                  icon={<IconDocument className="shrink-0 text-blue-500 w-4 h-4" />}
                  defaultOpen={zoteroNoteTree.groups.length <= 10}
                >
                  {group.notes.map((note) => (
                    <button
                      key={note.note_id}
                      type="button"
                      className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-zinc-50 transition-colors border-b border-zinc-50 last:border-b-0"
                      onClick={() => setDrillDown({ collection: "zotero_notes", groupId: note.note_id, groupField: "note_id", title: `${note.parent_title} (${note.note_type})` })}
                    >
                      <span className={cn(
                        "shrink-0 text-xs font-bold uppercase px-1.5 py-0.5 rounded",
                        note.note_type === "annotation" ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600"
                      )}>
                        {note.note_type}
                      </span>
                      <span className="flex-1 min-w-0 text-sm text-zinc-700 truncate">{note.total_chunks} chunks</span>
                      <IconChevron className="shrink-0 text-zinc-300" />
                    </button>
                  ))}
                </TreeSection>
              ))}
          </div>
        )}

        {/* ── Flat view (for any tab or memories) ── */}
        {!loading && (tab === "memories" || viewMode === "flat") && (() => {
          const grouped = new Map<string, { title: string; meta: Record<string, unknown>; chunks: IndexBrowseItem[] }>();
          for (const item of flatItems) {
            const m = item.metadata;
            const groupKey = String(m.paper_id || m.note_id || m.session_id || item.id);
            const title = String(m.title || m.parent_title || m.note_id || m.paper_id || item.id);
            if (!grouped.has(groupKey)) grouped.set(groupKey, { title, meta: m, chunks: [] });
            grouped.get(groupKey)!.chunks.push(item);
          }
          let arr = Array.from(grouped.entries()).map(([key, g]) => ({ key, ...g }));
          if (filterLower) {
            arr = arr.filter((g) => g.title.toLowerCase().includes(filterLower) || g.chunks.some((c) => c.text.toLowerCase().includes(filterLower)));
          }

          if (arr.length === 0) {
            return <p className="py-8 text-center text-sm text-zinc-400">{filter ? "No matches." : `No ${tab} indexed yet.`}</p>;
          }

          return (
            <div className="flex flex-col gap-2">
              <div className="text-xs text-zinc-400 mb-1">{flatTotal} chunks / {arr.length} sources</div>
              {arr.map((group) => {
                const groupField = tab === "papers" ? "paper_id" : tab === "notes" ? "note_id" : "";
                return (
                  <div key={group.key} className="border border-zinc-200 rounded-lg bg-white overflow-hidden">
                    <button
                      type="button"
                      className="flex items-center gap-3 w-full px-4 py-3 text-left cursor-pointer transition-colors hover:bg-zinc-50"
                      onClick={() => {
                        if (groupField) {
                          setDrillDown({ collection: tab, groupId: group.key, groupField, title: group.title });
                        }
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold truncate block">{group.title}</span>
                        <span className="text-xs text-zinc-400 block mt-0.5">
                          {group.chunks.length} chunk{group.chunks.length !== 1 ? "s" : ""}
                          {group.meta.authors ? ` · ${String(group.meta.authors).split(";")[0].trim()}` : ""}
                          {group.meta.year ? ` · ${String(group.meta.year)}` : ""}
                          {group.meta.page_start ? ` · pp.${group.meta.page_start}-${group.meta.page_end}` : ""}
                          {group.meta.collections ? ` · ${String(group.meta.collections).split(";")[0].trim()}` : ""}
                        </span>
                      </div>
                      <IconChevron className="shrink-0 text-zinc-400" />
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default IndexBrowser;
