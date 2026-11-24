import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowLeft, Check, ChevronRight, Circle, CircleAlert, CircleCheck, Clock, ExternalLink, FileCode, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, ListFilter, Loader2, MoreHorizontal, RotateCw, Search, SlidersHorizontal } from 'lucide-react'
import { UnifiedDiffViewer } from '@craft-agent/ui'
import ReactMarkdown from 'react-markdown'
import type { ReviewDetail, ReviewItem, ReviewRef, ReviewsQueue } from '@craft-agent/shared/protocol'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/useTheme'
import * as storage from '@/lib/local-storage'
import { groupReviews, isReviewSnoozed, normalizeReviewPreferences, parseReviewKey, repoName, reviewKey, reviewStatus, type ReviewPreferences, type ReviewTab } from './reviews-model'
import './reviews.css'

const zeroFilters = { query: '', repo: '', label: '' }
const stages = { open: GitPullRequest, draft: GitPullRequestDraft, merged: GitMerge, closed: GitPullRequestClosed }
const checkIcons = { success: CircleCheck, failure: CircleAlert, pending: Clock, none: Circle }
const relative = (iso: string) => {
  const date = Date.parse(iso)
  if (!Number.isFinite(date)) return ''
  const hours = Math.max(0, Math.floor((Date.now() - date) / 3_600_000))
  return hours === 0 ? 'Now' : hours < 24 ? `${hours}h` : hours < 168 ? `${Math.floor(hours / 24)}d` : new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const at = (iso: string) => Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString() : undefined
const err = (error: unknown) => error instanceof Error ? error.message : 'Could not load GitHub reviews.'
// GitHub content is untrusted. Render markdown without raw HTML or remote images.
function ReviewMarkdown({ children, open }: { children: string; open: (url: string) => void }) {
  return <div className="reviews-markdown"><ReactMarkdown skipHtml components={{ img: () => null, a: ({ href, children }) => href?.startsWith('https://')
    ? <button className="reviews-md-link" onClick={() => open(href)}>{children}</button> : <span>{children}</span> }}>{children}</ReactMarkdown></div>
}

export function ReviewsHome({ workspaceId, selectedKey, onSelect, onCount, api = defaultApi }: {
  workspaceId: string; selectedKey?: string; onSelect: (key?: string) => void; onCount?: (count: number) => void; api?: ReviewsApi
}) {
  const [prefs, setPrefs] = useState(() => normalizeReviewPreferences(storage.get<unknown>(storage.KEYS.reviewPreferences, null, workspaceId)))
  const [tab, setTab] = useState<ReviewTab>('toReview')
  const [queue, setQueue] = useState<ReviewsQueue | null>(null)
  const [detail, setDetail] = useState<ReviewDetail | null>(null)
  const [loadVersion, reload] = useState(0)
  const [detailVersion, reloadDetail] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState(zeroFilters)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [now, setNow] = useState(Date.now)
  const list = useRef<HTMLDivElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const ref = useMemo(() => selectedKey ? parseReviewKey(selectedKey) : null, [selectedKey])
  const canonicalKey = ref ? reviewKey(ref) : undefined
  const update = (patch: Partial<ReviewPreferences>) => {
    setNow(Date.now())
    setPrefs(previous => {
      const value = normalizeReviewPreferences({ ...previous, ...patch })
      return value
    })
  }
  useEffect(() => { storage.set(storage.KEYS.reviewPreferences, prefs, workspaceId) }, [workspaceId, prefs])
  useEffect(() => {
    let active = true
    setLoading(true); setError(null); setQueue(null)
    api.list(workspaceId, prefs.includeTeams).then(value => { if (active) setQueue(value) })
      .catch(error => { if (active) setError(err(error)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [workspaceId, prefs.includeTeams, loadVersion, api])
  useEffect(() => {
    let active = true
    setDetail(null); setDetailError(null)
    if (ref) api.get(workspaceId, ref).then(value => { if (active) setDetail(value) })
      .catch(error => { if (active) setDetailError(err(error)) })
    return () => { active = false }
  }, [workspaceId, ref, detailVersion, api])
  useEffect(() => {
    const next = Math.min(Infinity, ...Object.values(prefs.snoozed).map(item => item.until).filter(until => until > now))
    if (!Number.isFinite(next)) return
    const timer = setTimeout(() => setNow(Date.now()), Math.max(10, Math.min(next - Date.now() + 10, 2 ** 31 - 1)))
    return () => clearTimeout(timer)
  }, [prefs.snoozed, now])
  useEffect(() => { if (searchOpen) search.current?.focus() }, [searchOpen])

  const queueItems = queue?.[tab] ?? []
  const groups = groupReviews(queueItems, prefs, filters, now)
  const requestedCount = (queue?.toReview ?? []).filter(item => item.state === 'open' && !isReviewSnoozed(item, prefs, now)).length
  useEffect(() => { onCount?.(prefs.showCounter ? requestedCount : 0) }, [requestedCount, onCount, prefs.showCounter])
  const repositories = [...new Set(queueItems.map(repoName))].sort()
  const labels = [...new Set(queueItems.flatMap(item => item.labels))].sort()
  const tabChanged = (value: ReviewTab) => { setTab(value); setFilters(zeroFilters); setCollapsed(new Set()); onSelect() }
  const activeDetail = detail && selectedKey && reviewKey(detail.item) === canonicalKey ? detail : null
  const selected = activeDetail?.item ?? (selectedKey ? [...(queue?.toReview ?? []), ...(queue?.created ?? [])].find(item => reviewKey(item) === canonicalKey) : null)
  const open = (url: string) => { void api.open(url) }
  const snooze = (item: ReviewItem, minutes?: number, untilUpdate?: boolean) => {
    const key = reviewKey(item)
    const next = { ...prefs.snoozed }
    if (minutes) next[key] = { until: Date.now() + minutes * 60_000, ...(untilUpdate ? { updatedAt: item.updatedAt } : {}) }
    else delete next[key]
    update({ snoozed: next })
    if (minutes && !prefs.showSnoozed) onSelect()
  }
  const quitSearch = () => { setSearchOpen(false); setFilters(previous => ({ ...previous, query: '' })) }
  const handleKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || !(e.target instanceof HTMLElement)) return
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setSearchOpen(true); search.current?.focus(); return }
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input,select,textarea,[contenteditable],[role=menu],.reviews-detail')) return
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'j' && e.key !== 'k') return
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-review-row]') ?? [])
    if (!rows.length) return
    e.preventDefault()
    const focused = rows.findIndex(row => row === document.activeElement)
    const delta = e.key === 'ArrowUp' || e.key === 'k' ? -1 : 1
    rows[focused < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, focused + delta))]?.focus()
  }
  return <section className={`reviews-surface${selectedKey ? ' reviews-selected' : ''}`} aria-label="Reviews" onKeyDown={handleKey}>
    <aside className="reviews-queue" aria-label="Pull request queue">
      <header className="reviews-header"><h1>Reviews</h1><div className="reviews-actions">
        <button className="reviews-icon" aria-label="Search reviews" title="Search reviews" onClick={() => searchOpen ? quitSearch() : setSearchOpen(true)}><Search size={15} /></button>
        <button className="reviews-icon" aria-label="Refresh reviews" title="Refresh reviews" onClick={() => reload(v => v + 1)} disabled={loading}><RotateCw size={14} /></button>
        <Popover><PopoverTrigger asChild><button className="reviews-icon" aria-label="Filter reviews" title="Filter reviews"><ListFilter size={15} /></button></PopoverTrigger><PopoverContent align="end" className="reviews-popover">
          <label>Repository <select value={filters.repo} onChange={e => setFilters({ ...filters, repo: e.target.value })}><option value="">All repositories</option>{repositories.map(option => <option key={option}>{option}</option>)}</select></label>
          <label>GitHub labels <select value={filters.label} onChange={e => setFilters({ ...filters, label: e.target.value })}><option value="">All labels</option>{labels.map(option => <option key={option}>{option}</option>)}</select></label>
          <Button variant="ghost" size="sm" onClick={() => setFilters(zeroFilters)}>Clear filters</Button>
        </PopoverContent></Popover>
        <ReviewDisplayOptions prefs={prefs} update={update} />
      </div></header>
      <div className="reviews-tabs" aria-label="Review views">{(['toReview', 'created'] as const).map(value => <button key={value} aria-pressed={tab === value} onClick={() => tabChanged(value)}>{value === 'toReview' ? 'To Review' : 'Created'} {value === 'toReview' && prefs.showCounter && requestedCount > 0 && <span>{requestedCount}</span>}</button>)}</div>
      {searchOpen && <label className="reviews-search"><Search size={14} /><input ref={search} value={filters.query} placeholder="Find pull requests…" aria-label="Find pull requests" onChange={e => setFilters({ ...filters, query: e.target.value })} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); quitSearch() } }} /></label>}
      <div className="reviews-list" ref={list}>
        {loading ? <ReviewEmpty icon={Loader2} title="Loading reviews…" /> : error ? <ReviewEmpty icon={CircleAlert} title="Couldn’t load reviews" copy={error}><Button variant="ghost" size="sm" onClick={() => reload(v => v + 1)}>Try again</Button></ReviewEmpty> : !groups.length
          ? <ReviewEmpty icon={GitPullRequest} title={filters.query || filters.repo || filters.label ? 'No matching pull requests' : tab === 'toReview' ? 'No reviews waiting for you' : 'No pull requests to show'} copy={queue?.viewer ? `Signed in to GitHub as ${queue.viewer}.` : undefined} />
          : groups.map(([name, items]) => <section key={name} aria-label={name}>
            {prefs.grouping !== 'none' && <button className="reviews-group" aria-expanded={!collapsed.has(name)} onClick={() => setCollapsed(previous => { const next = new Set(previous); next.has(name) ? next.delete(name) : next.add(name); return next })}><ChevronRight size={13} className={collapsed.has(name) ? '' : 'rotate-90'} />{name}<span>{items.length}</span></button>}
            {!collapsed.has(name) && items.map(item => {
              const key = reviewKey(item), Icon = stages[item.state], CheckIcon = checkIcons[item.checks]
              return <button type="button" key={key} data-review-row={key} className="reviews-row" aria-current={canonicalKey === key ? 'true' : undefined} onClick={() => onSelect(key)}>
                <Icon className={`reviews-state-${item.state}`} size={16} />
                <span className="reviews-row-main"><strong>{item.title}</strong><span>{[
                  prefs.properties.includes('repository') ? repoName(item) : null,
                  prefs.properties.includes('id') ? `#${item.number}` : null,
                  prefs.properties.includes('author') ? item.author : null,
                ].filter(Boolean).join(' · ')}</span></span>
                <span className="reviews-row-end">{isReviewSnoozed(item, prefs, now) ? <Clock size={13} aria-label="Snoozed" /> : prefs.properties.includes('checks') && item.checks !== 'none' && <CheckIcon className={`reviews-check-${item.checks}`} aria-label={`Checks: ${item.checks}`} size={13} />}{relative(item.updatedAt)}</span>
              </button>
            })}
          </section>)}
        {queue?.truncated && <p className="reviews-muted-note">Showing the most recent results returned by GitHub.</p>}
      </div>
    </aside>
    <div className="reviews-detail" aria-label="Pull request detail">
      {!selectedKey ? <ReviewEmpty icon={GitPullRequest} title="Select a pull request" copy="See the discussion, checks, and code changes here." /> : <>
        <header className="reviews-header"><div className="reviews-detail-title"><button className="reviews-icon" aria-label="Back to Reviews" onClick={() => onSelect()}><ArrowLeft size={15} /></button><span>{selected ? `${repoName(selected)} #${selected.number}` : 'Pull request'}</span></div>
          {selected && <div className="reviews-actions"><DropdownMenu><DropdownMenuTrigger asChild><button className="reviews-icon" title="Review actions" aria-label="Review actions"><MoreHorizontal size={16} /></button></DropdownMenuTrigger><DropdownMenuContent align="end">
            {isReviewSnoozed(selected, prefs, now) ? <DropdownMenuItem onSelect={() => snooze(selected)}>Unsnooze</DropdownMenuItem> : <><DropdownMenuItem onSelect={() => snooze(selected, 60)}>Snooze for one hour</DropdownMenuItem><DropdownMenuItem onSelect={() => snooze(selected, 1440)}>Snooze until tomorrow</DropdownMenuItem><DropdownMenuItem onSelect={() => snooze(selected, 10080, true)}>Snooze until updated (up to one week)</DropdownMenuItem></>}
            <DropdownMenuItem onSelect={() => reloadDetail(v => v + 1)}>Refresh pull request</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu><button className="reviews-button" onClick={() => open(selected.url)}><ExternalLink size={13} /> Open in GitHub</button></div>}
        </header>
        {detailError ? <ReviewEmpty icon={CircleAlert} title="Couldn’t load pull request" copy={detailError}><Button variant="ghost" size="sm" onClick={() => reloadDetail(v => v + 1)}>Retry</Button></ReviewEmpty>
          : !ref ? <ReviewEmpty icon={CircleAlert} title="Invalid pull request link" />
          : !activeDetail ? <ReviewEmpty icon={Loader2} title="Loading pull request…" /> : <ReviewDetailPane key={selectedKey} detail={activeDetail} prefs={prefs} update={update} open={open} />}
      </>}
    </div>
  </section>
}

export interface ReviewsApi { list(workspaceId: string, includeTeams: boolean): Promise<ReviewsQueue>; get(workspaceId: string, ref: ReviewRef): Promise<ReviewDetail>; open(url: string): void | Promise<void> }
const defaultApi: ReviewsApi = { list: (workspace, teams) => window.electronAPI.listReviews(workspace, teams), get: (workspace, ref) => window.electronAPI.getReview(workspace, ref), open: url => window.electronAPI.openUrl(url) }
function ReviewEmpty({ icon: Icon, title, copy, children }: { icon: typeof GitPullRequest; title: string; copy?: string; children?: React.ReactNode }) {
  return <div className="reviews-empty" role="status"><Icon size={27} strokeWidth={1.4} className={Icon === Loader2 ? 'animate-spin' : undefined} /><strong>{title}</strong>{copy && <p>{copy}</p>}{children}</div>
}

function ReviewDisplayOptions({ prefs, update }: { prefs: ReviewPreferences; update: (patch: Partial<ReviewPreferences>) => void }) {
  return <Popover><PopoverTrigger asChild><button className="reviews-icon" aria-label="Review display options" title="Review display options"><SlidersHorizontal size={15} /></button></PopoverTrigger>
    <PopoverContent align="end" className="reviews-popover">
      <label>Grouping <select value={prefs.grouping} onChange={e => update({ grouping: e.target.value as ReviewPreferences['grouping'] })}><option value="status">Status</option><option value="repository">Repository</option><option value="author">Author</option><option value="size">Size</option><option value="none">No grouping</option></select></label>
      <label>Ordering <select value={prefs.ordering} onChange={e => update({ ordering: e.target.value as ReviewPreferences['ordering'] })}><option value="opened">Opened</option><option value="updated">Updated</option><option value="size">Size</option></select></label><hr />
      <label>Closed reviews <select value={prefs.closed} onChange={e => update({ closed: e.target.value as ReviewPreferences['closed'] })}><option value="none">None</option><option value="week">Past week</option><option value="all">All loaded</option></select></label>
      {([{ key: 'showDrafts', label: 'Show drafts' }, { key: 'includeTeams', label: 'Show team reviews' }, { key: 'showSnoozed', label: 'Show snoozed' }, { key: 'showCounter', label: 'Show in sidebar counter' }] as const).map(({ key, label }) => <div className="reviews-setting" key={key}><span>{label}</span><Switch checked={prefs[key]} aria-label={label} onCheckedChange={checked => update({ [key]: checked })} /></div>)}<hr />
      <div className="reviews-properties"><span>Display properties</span><div className="reviews-tabs">{(['repository', 'id', 'author', 'checks'] as const).map(key => <button aria-pressed={prefs.properties.includes(key)} key={key} onClick={() => update({ properties: prefs.properties.includes(key) ? prefs.properties.filter(p => p !== key) : [...prefs.properties, key] })}>{key === 'id' ? 'ID' : key[0]!.toUpperCase() + key.slice(1)}</button>)}</div></div>
    </PopoverContent></Popover>
}

function ReviewDetailPane({ detail, prefs, update, open }: { detail: ReviewDetail; prefs: ReviewPreferences; update: (patch: Partial<ReviewPreferences>) => void; open: (url: string) => void }) {
  const [tab, setTab] = useState<'activity' | 'changes'>('activity')
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified')
  const [fileQuery, setFileQuery] = useState('')
  const [path, setPath] = useState(detail.files[0]?.path ?? '')
  const [hideReviewed, setHideReviewed] = useState(false)
  const { isDark, shikiTheme } = useTheme()
  const key = reviewKey(detail.item)
  const fileRevision = (file: ReviewDetail['files'][number]) => {
    let hash = 2166136261
    for (const character of file.patch ?? `${file.status}:${detail.item.updatedAt}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
    return `${file.path}\0${hash >>> 0}`
  }
  const checked = new Set(prefs.reviewed[key] ?? [])
  const filtered = detail.files.filter(file => file.path.toLowerCase().includes(fileQuery.toLowerCase()) && (!hideReviewed || !checked.has(fileRevision(file))))
  const selected = filtered.find(file => file.path === path) ?? filtered[0]
  const state = reviewStatus(detail.item)
  const StateIcon = stages[detail.item.state]
  return <div className="reviews-detail-body">
    <div className="reviews-detail-tabs reviews-tabs"><button aria-pressed={tab === 'activity'} onClick={() => setTab('activity')}>Activity</button><button aria-pressed={tab === 'changes'} onClick={() => setTab('changes')}>Changes <ins>+{detail.item.additions}</ins> <del>−{detail.item.deletions}</del></button></div>
    {tab === 'activity' ? <div className="reviews-overview"><article>
      <h2>{detail.item.title}</h2><div className="reviews-byline"><StateIcon size={14} className={`reviews-state-${detail.item.state}`} />{state}<span>·</span>{detail.item.author || 'Unknown author'}<span>·</span><time dateTime={detail.item.updatedAt} title={at(detail.item.updatedAt)}>{relative(detail.item.updatedAt)}</time></div>
      <p className="reviews-branches"><code>{detail.item.headRef}</code><ChevronRight size={12} /><code>{detail.item.baseRef}</code></p>
      {detail.body ? <ReviewMarkdown open={open}>{detail.body}</ReviewMarkdown> : <p className="reviews-muted-note">No description.</p>}
      <h3>Activity</h3>{detail.activityTruncated && <p className="reviews-muted-note">Showing recent activity.</p>}{detail.activity.length ? detail.activity.map(item => <div className="reviews-activity" key={item.id}><span className="reviews-avatar">{item.author.slice(0, 2).toUpperCase() || '?'}</span><div><strong>{item.author || 'Unknown author'}</strong> <span>{item.kind === 'review' ? `${(item.state ?? 'reviewed').toLowerCase().replace(/_/g, ' ')}` : 'commented'} · {relative(item.createdAt)}</span>{item.body && <ReviewMarkdown open={open}>{item.body}</ReviewMarkdown>}</div></div>) : <p className="reviews-muted-note">No discussion yet.</p>}
    </article><aside className="reviews-properties-panel"><h3>Checks</h3>{detail.checksTruncated && <p>Showing a subset of checks.</p>}{detail.checks.length ? detail.checks.map((check, i) => <div key={`${check.name}-${i}`}><Circle size={12} className={/success|pass/i.test(check.status) ? 'reviews-check-success' : /fail|error/i.test(check.status) ? 'reviews-check-failure' : ''} /><span>{check.name}</span><small>{check.status.toLowerCase().replace(/_/g, ' ')}</small></div>) : <p>No checks reported.</p>}<h3>Labels</h3>{detail.item.labels.length ? detail.item.labels.map(label => <span className="reviews-label" key={label}>{label}</span>) : <p>No labels.</p>}<h3>Review on GitHub</h3><p>Leave comments, approve, request changes, or merge on GitHub.</p><button className="reviews-button" onClick={() => open(detail.item.url)}><ExternalLink size={13} /> Review on GitHub</button></aside></div>
    : <><div className="reviews-files-header"><span>{detail.item.changedFiles} {detail.item.changedFiles === 1 ? 'file' : 'files'} changed</span><label><Switch aria-label="Hide reviewed files" checked={hideReviewed} onCheckedChange={setHideReviewed} /> Hide reviewed</label><div className="reviews-tabs"><button aria-pressed={diffStyle === 'unified'} onClick={() => setDiffStyle('unified')}>Unified</button><button aria-pressed={diffStyle === 'split'} onClick={() => setDiffStyle('split')}>Split</button></div></div>
      {detail.filesTruncated && <div className="reviews-muted-note">Some files or large patches aren’t available here. <button className="reviews-md-link" onClick={() => open(`${detail.item.url}/files`)}>See all changes on GitHub</button>.</div>}
      <div className="reviews-files"><aside className="reviews-file-list"><label className="reviews-search"><Search size={13} /><input value={fileQuery} onChange={e => setFileQuery(e.target.value)} aria-label="Filter files" placeholder="Filter files…" /></label>{filtered.map(file => <button key={file.path} className="reviews-file" aria-current={file.path === selected?.path ? 'true' : undefined} onClick={() => setPath(file.path)} title={file.path}>{checked.has(fileRevision(file)) ? <Check size={13} /> : <FileCode size={13} />}<span>{file.path}</span></button>)}</aside>
      <div className="reviews-diff">{selected ? <div className="reviews-diff-card"><div className="reviews-diff-top"><FileCode size={14} /><span>{selected.path}</span><ins>+{selected.additions}</ins><del>−{selected.deletions}</del><label><input type="checkbox" checked={checked.has(fileRevision(selected))} onChange={e => { const paths = e.target.checked ? [...checked, fileRevision(selected)] : [...checked].filter(p => p !== fileRevision(selected)); update({ reviewed: { ...prefs.reviewed, [key]: paths } }) }} /> Reviewed</label></div>
      {selected.patch ? <UnifiedDiffViewer key={selected.path} unifiedDiff={selected.patch} filePath={selected.path.replace(/[\r\n]/g, ' ')} diffStyle={diffStyle} theme={isDark ? 'dark' : 'light'} shikiTheme={shikiTheme} /> : <ReviewEmpty icon={FileCode} title="Patch unavailable" copy="GitHub doesn’t return inline patches for every file."><Button variant="ghost" onClick={() => open(`${detail.item.url}/files`)}>Open files on GitHub</Button></ReviewEmpty>}</div> : <ReviewEmpty icon={FileCode} title="No files to display" />}</div></div></>}
  </div>
}
