import * as React from 'react'
import { useAtomValue } from 'jotai'
import { format, formatDistanceToNow, startOfWeek, subWeeks } from 'date-fns'
import { ArrowDown, ArrowLeft, Check, ChevronDown, ChevronRight, Copy, Download, FileText, Folder, Link2, List, Loader2, MoreHorizontal, Plus, Search, SlidersHorizontal, Star, Trash2, Upload, Users, X } from 'lucide-react'
import { TiptapMarkdownEditor } from '@craft-agent/ui'
import ReactMarkdown from 'react-markdown'
import type { WorkspaceDocument } from '@craft-agent/shared/documents/types'
import { toast } from 'sonner'
import { projectsAtom } from '@/atoms/projects'
import * as storage from '@/lib/local-storage'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DocumentSaveQueue } from './document-save-queue'
import './documents.css'

export interface DocumentsHomeProps {
  workspaceId: string
  documentId?: string
  onOpenDocument: (id: string) => void
  onBack: () => void
}

type Tab = 'recent' | 'mine' | 'shared'
const recoveryStore = {
  getItem: (key: string) => storage.get<string | null>(storage.KEYS.documentDraft, null, key),
  setItem: (key: string, value: string) => storage.set(storage.KEYS.documentDraft, value, key),
  removeItem: (key: string) => storage.remove(storage.KEYS.documentDraft, key),
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const relativeTime = (date: string) => formatDistanceToNow(new Date(date), { addSuffix: true })

function downloadDocument(doc: WorkspaceDocument) {
  const markdown = `# ${doc.title}\n\n${doc.content}\n`
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${doc.title.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'Untitled'}.md`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Linear-inspired native document library and full-width editor, using the app's tokens. */
export function DocumentsHome({ workspaceId, documentId, onOpenDocument, onBack }: DocumentsHomeProps) {
  const projects = useAtomValue(projectsAtom)
  const [documents, setDocuments] = React.useState<WorkspaceDocument[]>([])
  const [selected, setSelected] = React.useState<WorkspaceDocument | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [tab, setTab] = React.useState<Tab>('recent')
  const [query, setQuery] = React.useState('')
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [projectFilter, setProjectFilter] = React.useState('all')
  const [favoritesOnly, setFavoritesOnly] = React.useState(false)
  const [sort, setSort] = React.useState('updated')
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const fileInput = React.useRef<HTMLInputElement>(null)
  const requestRef = React.useRef(0)

  const refresh = React.useCallback(async () => {
    const request = ++requestRef.current
    try {
      const list = await window.electronAPI.getDocuments(workspaceId)
      if (request === requestRef.current) { setDocuments(list); setError(null); setLoading(false) }
    } catch (err) { if (request === requestRef.current) { setError(message(err)); setLoading(false) } }
  }, [workspaceId])

  React.useEffect(() => {
    setLoading(true); setDocuments([]); setSelected(null)
    void refresh()
    const unsubscribe = window.electronAPI.onDocumentsChanged(wsId => { if (wsId === workspaceId) void refresh() })
    return () => { requestRef.current++; unsubscribe() }
  }, [workspaceId, refresh])

  React.useEffect(() => {
    if (!documentId) { setSelected(null); return }
    let active = true
    setSelected(null); setError(null)
    window.electronAPI.getDocument(workspaceId, documentId).then(doc => {
      if (active) { setSelected(doc); if (!doc) setError('This document no longer exists.') }
    }).catch(err => { if (active) setError(message(err)) })
    return () => { active = false }
  }, [workspaceId, documentId])

  const create = async (input: { title?: string; content?: string; projectId?: string | null } = {}) => {
    if (creating) return
    setCreating(true)
    try {
      const doc = await window.electronAPI.createDocument(workspaceId, input)
      await refresh()
      onOpenDocument(doc.id)
    } catch (err) { toast.error('Could not create document', { description: message(err) }) }
    finally { setCreating(false) }
  }

  const filtered = React.useMemo(() => {
    if (tab === 'shared') return [] // No remote sharing service is configured; never invent a shared inbox.
    const term = query.toLowerCase().trim()
    return documents.filter(doc =>
      (!term || `${doc.title}\n${doc.content}`.toLowerCase().includes(term)) &&
      (!favoritesOnly || doc.favorite) &&
      (projectFilter === 'all' || (projectFilter === 'none' ? !doc.projectId : doc.projectId === projectFilter)),
    ).sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title) : (sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt)))
  }, [documents, tab, query, projectFilter, favoritesOnly, sort])
  const groups = React.useMemo(() => {
    const week = startOfWeek(new Date(), { weekStartsOn: 1 }).getTime()
    const lastWeek = subWeeks(new Date(week), 1).getTime()
    const buckets = new Map<string, WorkspaceDocument[]>()
    for (const doc of filtered) {
      const date = new Date(sort === 'created' ? doc.createdAt : doc.updatedAt).getTime()
      const group = sort === 'name' ? 'All documents' : date >= week ? 'This week' : date >= lastWeek ? 'Last week' : 'Earlier'
      buckets.set(group, [...(buckets.get(group) ?? []), doc])
    }
    return [...buckets]
  }, [filtered, sort])
  const projectName = (id: string | null) => projects.find(p => p.config.id === id)?.config.name ?? 'Workspace'

  if (documentId) {
    if (!selected) return <div className="documents-surface"><header className="documents-header"><button className="documents-action" onClick={onBack}><ArrowLeft size={14} /> Documents</button></header><div className="documents-empty" role={error ? 'alert' : 'status'}>{error ? <><FileText size={28} /><h2>Document unavailable</h2><p>{error}</p><Button variant="ghost" onClick={onBack}>Back to Documents</Button></> : <><Loader2 className="animate-spin" size={20} /><p>Loading document…</p></>}</div></div>
    return <DocumentEditor key={`${workspaceId}:${selected.id}`} document={selected} workspaceId={workspaceId} projects={projects.map(p => ({ id: p.config.id, name: p.config.name }))} onBack={onBack} onOpenDocument={onOpenDocument} onChanged={refresh} />
  }

  return <section className="documents-surface" aria-label="Documents">
    <header className="documents-header"><div className="documents-heading">Documents <DropdownMenu><DropdownMenuTrigger asChild><button className="documents-icon" aria-label="Documents actions"><MoreHorizontal size={16} /></button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onClick={() => fileInput.current?.click()}><Upload size={14} /> Import Markdown</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div><button className="documents-action" onClick={() => void create()} disabled={creating}>{creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} New document</button></header>
    <input ref={fileInput} type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" className="sr-only" aria-label="Import Markdown file" onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
      if (file.size > 8 * 1024 * 1024) { toast.error('Choose a document smaller than 8 MB'); return }
      try { await create({ title: file.name.replace(/\.(md|markdown|txt)$/i, ''), content: await file.text() }) } catch (err) { toast.error(message(err)) }
    }} />
    <div className="documents-toolbar"><div className="documents-tabs" role="tablist" aria-label="Document views">{([['recent', 'Recent'], ['mine', 'My documents'], ['shared', 'Shared with me']] as const).map(([value, label]) => <button key={value} id={`documents-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls="documents-library" className={`documents-tab ${tab === value ? 'is-active' : ''}`} onClick={() => setTab(value)}>{label}</button>)}</div><div className="documents-toolbar-actions"><label className="documents-search"><Search size={14} /><input aria-label="Search documents" placeholder="Search documents…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={12} /></button>}</label><button className={`documents-icon documents-filter-toggle ${filtersOpen ? 'is-active' : ''}`} aria-label="Filter and sort documents" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={15} /></button></div></div>
    {filtersOpen && <div className="documents-filters"><label>Project <select aria-label="Filter by project" value={projectFilter} onChange={e => setProjectFilter(e.target.value)}><option value="all">All projects</option><option value="none">Workspace documents</option>{projects.map(p => <option key={p.config.id} value={p.config.id}>{p.config.name}</option>)}</select></label><label>Sort <select aria-label="Sort documents" value={sort} onChange={e => setSort(e.target.value)}><option value="updated">Last updated</option><option value="created">Created date</option><option value="name">Name</option></select></label><button className={`documents-action ${favoritesOnly ? 'is-active' : ''}`} aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(!favoritesOnly)}><Star size={14} fill={favoritesOnly ? 'currentColor' : 'none'} /> Favorites</button></div>}
    <div id="documents-library" role="tabpanel" aria-labelledby={`documents-tab-${tab}`} className="documents-library">
      {error ? <div className="documents-empty" role="alert"><FileText size={28} /><h2>Couldn’t load your documents</h2><p>{error}</p><Button variant="ghost" onClick={() => void refresh()}>Try again</Button></div> : loading ? <div className="documents-empty" role="status"><Loader2 size={20} className="animate-spin" /><p>Loading documents…</p></div> : tab === 'shared' ? <div className="documents-empty"><Users size={30} /><h2>No documents shared with you</h2><p>Documents in this app are local to your workspace. External sharing and collaborative editing aren’t connected yet.</p><button className="documents-action" onClick={() => setTab('recent')}>View workspace documents <ChevronRight size={14} /></button></div> : filtered.length === 0 ? <div className="documents-empty"><FileText size={32} /><h2>{documents.length ? 'No matching documents' : 'Your workspace, in writing'}</h2><p>{documents.length ? 'Try a different search or filter.' : 'Keep plans, decisions, and ideas together. Create a document or bring in a Markdown file.'}</p>{documents.length ? <button className="documents-action" onClick={() => { setQuery(''); setProjectFilter('all'); setFavoritesOnly(false) }}>Clear filters</button> : <div className="documents-empty-actions"><Button onClick={() => void create()} disabled={creating}><Plus size={14} /> New document</Button><Button variant="ghost" onClick={() => fileInput.current?.click()}><Upload size={14} /> Import Markdown</Button></div>}</div> : <>
        <div className="documents-previews" aria-label="Recent documents">{filtered.slice(0, 5).map(doc => <button key={doc.id} className="documents-card" onClick={() => onOpenDocument(doc.id)}><FileText size={15} className="documents-muted" /><strong>{doc.title}</strong><span className="documents-card-date">Updated {relativeTime(doc.updatedAt)}</span><div className="documents-card-preview" aria-hidden="true">{doc.content ? <ReactMarkdown components={{ a: ({ children }) => <span>{children}</span> }}>{doc.content.slice(0, 2000)}</ReactMarkdown> : <span className="documents-muted">No content yet</span>}</div></button>)}</div>
        <div className="documents-table" role="table" aria-label="Workspace documents"><div className="documents-table-head" role="row"><span role="columnheader">Name</span><span role="columnheader">Visibility</span><span role="columnheader">Last activity <ArrowDown size={11} /></span></div>{groups.map(([group, docs]) => <div role="rowgroup" key={group}><button className="documents-group" aria-expanded={!collapsed.has(group)} onClick={() => setCollapsed(current => { const next = new Set(current); next.has(group) ? next.delete(group) : next.add(group); return next })}><ChevronDown size={12} className={collapsed.has(group) ? 'is-collapsed' : ''} />{group}<span>{docs.length}</span></button>{!collapsed.has(group) && docs.map(doc => <div className="documents-table-row" key={doc.id} role="row"><button className="documents-name-cell" role="cell" onClick={() => onOpenDocument(doc.id)}><FileText size={15} /><span>{doc.title}</span>{doc.favorite && <Star size={12} fill="currentColor" />}</button><span className="documents-visibility" role="cell">{doc.projectId ? <Folder size={14} /> : <Users size={14} />}<span>{projectName(doc.projectId)}</span></span><span className="documents-activity" role="cell">Updated {format(new Date(doc.updatedAt), 'MMM d')}</span></div>)}</div>)}</div>
      </>}
    </div>
  </section>
}

interface EditorProps { document: WorkspaceDocument; workspaceId: string; projects: { id: string; name: string }[]; onBack: () => void; onOpenDocument: (id: string) => void; onChanged: () => Promise<void> }
function DocumentEditor({ document: initial, workspaceId, projects, onBack, onOpenDocument, onChanged }: EditorProps) {
  const [queue] = React.useState(() => new DocumentSaveQueue(workspaceId, initial, patch => window.electronAPI.updateDocument(workspaceId, initial.id, patch), recoveryStore))
  const { document: doc, status, error } = React.useSyncExternalStore(queue.subscribe, queue.getSnapshot)
  const [shareOpen, setShareOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [outlineOpen, setOutlineOpen] = React.useState(false)
  const [sourceMode, setSourceMode] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { queue.activate(); return () => queue.dispose() }, [queue])
  React.useEffect(() => {
    const save = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); void queue.flush() } }
    window.addEventListener('keydown', save)
    return () => window.removeEventListener('keydown', save)
  }, [queue])
  React.useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (queue.getSnapshot().status !== 'saved') { void queue.flush(); event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [queue])

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`vetoagents://workspace/${encodeURIComponent(workspaceId)}/documents/document/${doc.id}`); toast.success('Document link copied') } catch (err) { toast.error('Could not copy link', { description: message(err) }) }
  }
  const duplicate = async () => {
    try {
      const current = queue.getSnapshot().document
      const copy = await window.electronAPI.createDocument(workspaceId, { title: `${current.title || 'Untitled'} (copy)`.slice(0, 500), content: current.content, projectId: current.projectId })
      await onChanged(); onOpenDocument(copy.id)
    } catch (err) { toast.error('Could not save a copy', { description: message(err) }) }
  }
  const remove = async () => {
    setDeleting(true); setActionError(null)
    try {
      await queue.flush()
      if (queue.getSnapshot().status === 'error') throw new Error('Save a copy of your unsaved draft before deleting this document.')
      await window.electronAPI.deleteDocument(workspaceId, doc.id)
      await onChanged(); onBack()
    } catch (err) { setActionError(message(err)); setDeleting(false) }
  }
  const headings = [...doc.content.matchAll(/^(#{1,3})\s+(.+)$/gm)].map(match => ({ level: match[1]!.length, text: match[2]!.replace(/[*_`]/g, '') }))
  const project = projects.find(p => p.id === doc.projectId)
  return <section className="documents-surface documents-editor-view" aria-label={`Document: ${doc.title}`}>
    <header className="documents-header"><nav className="documents-breadcrumb" aria-label="Document breadcrumb">{project && <><Folder size={14} /><span>{project.name}</span><ChevronRight size={12} /></>}<button onClick={onBack}>Documents</button><ChevronRight size={12} /><FileText size={14} /><span className="documents-breadcrumb-title">{doc.title || 'Untitled'}</span><button className={`documents-icon ${doc.favorite ? 'is-active' : ''}`} aria-label={doc.favorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={doc.favorite} onClick={() => queue.update({ favorite: !doc.favorite })}><Star size={14} fill={doc.favorite ? 'currentColor' : 'none'} /></button><DropdownMenu><DropdownMenuTrigger asChild><button className="documents-icon" aria-label="Document actions"><MoreHorizontal size={16} /></button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onClick={() => void duplicate()}><Copy size={14} /> Duplicate</DropdownMenuItem><DropdownMenuItem onClick={() => downloadDocument(doc)}><Download size={14} /> Export Markdown</DropdownMenuItem><DropdownMenuItem onClick={() => setSourceMode(!sourceMode)}><FileText size={14} /> {sourceMode ? 'Rich text editor' : 'Edit Markdown source'}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-destructive"><Trash2 size={14} /> Delete document…</DropdownMenuItem></DropdownMenuContent></DropdownMenu></nav><div className="documents-toolbar-actions"><span className={`documents-save-status ${status === 'error' ? 'has-error' : ''}`} role="status" aria-live="polite">{status === 'saving' ? <Loader2 size={11} className="animate-spin" /> : status === 'saved' ? <Check size={11} /> : null}{status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : status === 'error' ? 'Not saved' : 'Unsaved'}</span><button className="documents-action" onClick={() => setShareOpen(true)}><Users size={14} /> Share</button><button className="documents-icon" aria-label="Copy document link" onClick={() => void copyLink()}><Link2 size={14} /></button></div></header>
    {error && <div className="documents-save-error" role="alert"><span>{error}</span><button onClick={() => void queue.retry()}>Retry</button><button onClick={() => void duplicate()}>Save a copy</button><button onClick={() => downloadDocument(doc)}>Export draft</button></div>}
    <div className="documents-editor-scroll" ref={contentRef}><button className="documents-outline-toggle documents-icon" aria-label="Toggle document outline" aria-expanded={outlineOpen} onClick={() => setOutlineOpen(!outlineOpen)}><List size={15} /></button>{outlineOpen && <aside className="documents-outline" aria-label="Document outline"><strong>On this page</strong>{headings.length ? headings.map((heading, i) => <button key={i} style={{ paddingInlineStart: (heading.level - 1) * 10 }} onClick={() => { const elements = contentRef.current?.querySelectorAll('.tiptap-prose h1, .tiptap-prose h2, .tiptap-prose h3'); elements?.[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}>{heading.text}</button>) : <p>Add headings to build an outline.</p>}</aside>}
      <article className="documents-writing-canvas"><input className="documents-title-input" aria-label="Document title" placeholder="Untitled" value={doc.title === 'Untitled' && !doc.content ? '' : doc.title} maxLength={500} onChange={e => queue.update({ title: e.target.value })} autoFocus={!initial.content && initial.title === 'Untitled'} /><div className="documents-meta"><span className="documents-author-avatar" aria-label="Local workspace document"><FileText size={10} /></span><span>Updated {relativeTime(doc.updatedAt)}</span><span className="documents-meta-dot">·</span><label className="documents-project-label"><select aria-label="Document project" value={doc.projectId ?? ''} onChange={e => queue.update({ projectId: e.target.value || null })}><option value="">Workspace</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown size={10} /></label></div>
        {sourceMode ? <textarea className="documents-source-editor" aria-label="Document Markdown source" value={doc.content} onChange={e => queue.update({ content: e.target.value })} spellCheck={false} /> : <TiptapMarkdownEditor content={doc.content} onUpdate={content => queue.update({ content })} placeholder="Write something, or press ‘/’ for commands…" markdownEngine="official" className="documents-rich-editor" />}
        {!doc.content && <p className="documents-editor-hint">Markdown shortcuts, slash commands, images, code, and diagrams.</p>}
      </article>
    </div>
    <Dialog open={shareOpen} onOpenChange={setShareOpen}><DialogContent><DialogHeader><DialogTitle>Share document</DialogTitle><DialogDescription>This document is saved locally in your workspace. Its link opens it in this app; it does not grant access or publish it online.</DialogDescription></DialogHeader><div className="documents-share-location"><Users size={16} /><div><strong>{project?.name ?? 'Workspace'}</strong><p>Local workspace document</p></div></div><div className="documents-empty-actions"><Button variant="ghost" onClick={() => void copyLink()}><Link2 size={14} /> Copy internal link</Button><Button variant="ghost" onClick={() => downloadDocument(doc)}><Download size={14} /> Export Markdown</Button></div><p className="text-xs text-muted-foreground">External sharing and live collaboration are not connected.</p></DialogContent></Dialog>
    <Dialog open={deleteOpen} onOpenChange={open => { if (!deleting) { setDeleteOpen(open); setActionError(null) } }}><DialogContent><DialogHeader><DialogTitle>Delete document?</DialogTitle><DialogDescription>“{doc.title || 'Untitled'}” will be permanently removed from this workspace. Export a copy first if you need to keep it.</DialogDescription></DialogHeader>{actionError && <p role="alert" className="text-destructive text-sm">{actionError}</p>}<DialogFooter><Button variant="ghost" disabled={deleting} onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="danger-solid" disabled={deleting} onClick={() => void remove()}>{deleting ? 'Deleting…' : 'Delete document'}</Button></DialogFooter></DialogContent></Dialog>
  </section>
}
