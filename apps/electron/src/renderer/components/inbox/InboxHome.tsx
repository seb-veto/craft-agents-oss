import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AlertCircle, ArrowLeft, Bell, Bot, CheckCheck, Clock3, ExternalLink, Flag, Inbox, KeyRound, ListChecks, Mail, MailOpen, MoreHorizontal, Search, ShieldAlert, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAppShellContext } from '@/context/AppShellContext'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { getSessionTitle } from '@/utils/session'
import { isSnoozed, type InboxEntry, type InboxPreferences } from './inbox-model'
import type { WorkspaceInbox } from './useWorkspaceInbox'
import './inbox.css'

type Tab = 'priority' | 'other'
const kinds = {
  approval: { icon: ShieldAlert, text: 'Approval requested' },
  credential: { icon: KeyRound, text: 'Sign-in requested' },
  error: { icon: AlertCircle, text: 'Session reported an error' },
  review: { icon: ListChecks, text: 'Ready for review' },
  plan: { icon: ListChecks, text: 'Agent submitted a plan' },
  response: { icon: Mail, text: 'Agent replied' },
} as const
const durationMinutes = [60, 180, 1440, 10080] as const
const durations = ['One hour', 'Three hours', 'One day', 'One week'] as const

export function inboxRelativeTime(timestamp: number, now: number): string {
  if (!timestamp) return ''
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000))
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : minutes < 10080 ? `${Math.floor(minutes / 1440)}d` : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp)
}

interface InboxHomeProps { inbox: WorkspaceInbox; selectedId?: string; onSelect: (id?: string) => void; onOpenSession: (id: string) => void; renderSession: (id: string) => ReactNode }
export function InboxHome({ inbox, selectedId, onSelect, onOpenSession, renderSession }: InboxHomeProps) {
  const { onMarkSessionRead, onMarkSessionUnread } = useAppShellContext()
  const { visible, unread, now, preferences: prefs, setOptions, dismiss, restore, snooze } = inbox
  const selected = visible.find(entry => entry.session.id === selectedId)
  const [tab, setTab] = useState<Tab>(() => selected && !selected.priority ? 'other' : 'priority')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const priorityUnread = unread.filter(entry => entry.priority).length
  const term = query.trim().toLowerCase()
  const matched = visible.filter(entry => (!prefs.prioritize || (tab === 'priority') === entry.priority) && (!term ||
    [getSessionTitle(entry.session), kinds[entry.kind].text, entry.session.id, entry.session.sessionStatus].some(value => value?.toLowerCase().includes(term))))
  const groups = new Map<string, InboxEntry[]>()
  for (const item of matched) {
    const group = prefs.grouping === 'type' && item.unread ? kinds[item.kind].text : ''
    const bucket = groups.get(group) ?? []
    bucket.push(item)
    groups.set(group, bucket)
  }
  const items = [...groups.values()].flat()


  useEffect(() => { if (searchOpen) searchInput.current?.focus() }, [searchOpen])
  const choose = (entry: InboxEntry) => {
    if (entry.unread) onMarkSessionRead(entry.session.id)
    onSelect(entry.session.id)
  }
  const toggleRead = (entry: InboxEntry) => (entry.unread ? onMarkSessionRead : onMarkSessionUnread)(entry.session.id)
  const selectTab = (next: Tab) => { setTab(next); if (selected && selected.priority !== (next === 'priority')) onSelect() }
  const markAll = () => { for (const entry of unread) onMarkSessionRead(entry.session.id) }
  const dismissItems = (targets: InboxEntry[]) => {
    if (!targets.length) return
    dismiss(targets)
    if (targets.some(entry => entry.session.id === selectedId)) onSelect()
    toast(targets.length === 1 ? 'Notification removed from Inbox' : `${targets.length} notifications removed from Inbox`, {
      action: { label: 'Undo', onClick: () => restore(targets) },
    })
  }
  const delay = (entry: InboxEntry, minutes?: number) => {
    snooze(entry, minutes ? Date.now() + minutes * 60_000 : undefined)
    if (minutes && !prefs.showSnoozed && entry.session.id === selectedId) onSelect()
  }
  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || !(e.target instanceof HTMLElement)) return
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setSearchOpen(true); searchInput.current?.focus(); return }
    if (e.target.closest('input,textarea,select,[contenteditable=true],[role=menu],[role=menuitem],[data-inbox-chat]')) return
    if (e.metaKey || e.ctrlKey) return
    if (e.key === 'Escape' && searchOpen) { setSearchOpen(false); setQuery(''); return }
    const focused = e.target.closest<HTMLElement>('[data-inbox-row]')?.dataset.inboxRow
    const current = items.find(entry => entry.session.id === (focused ?? selectedId))
    const key = e.key.toLowerCase()
    if (['j', 'k', 'arrowdown', 'arrowup'].includes(key) && items.length && !e.altKey) {
      e.preventDefault()
      const index = current ? items.indexOf(current) : -1
      const next = items[index < 0 ? 0 : Math.max(0, Math.min(items.length - 1, index + (key === 'k' || key === 'arrowup' ? -1 : 1)))]!
      choose(next)
      const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-inbox-row]') ?? []).find(node => node.dataset.inboxRow === next.session.id)
      row?.focus()
    } else if (key === 'u' && e.altKey) { e.preventDefault(); markAll() }
    else if (key === 'u' && current) { e.preventDefault(); toggleRead(current) }
    else if (key === 'h' && current) { e.preventDefault(); if (current !== selected) choose(current); setSnoozeOpen(true) }
    else if (key === 'backspace' && e.shiftKey) { e.preventDefault(); dismissItems(visible.filter(entry => !entry.unread)) }
    else if (key === 'backspace' && current) { e.preventDefault(); dismissItems([current]) }
  }

  return <section className={`inbox-surface${selected ? ' inbox-has-detail' : ''}`} aria-label="Inbox" onKeyDown={keyDown}>
    <aside className="inbox-list-pane" aria-label="Notifications">
      <header className="inbox-bar"><h1>Inbox</h1><div className="inbox-actions">
        <button className="inbox-icon" title="Search notifications" aria-label="Search notifications" onClick={() => { if (searchOpen) setQuery(''); setSearchOpen(!searchOpen) }}><Search size={15} /></button>
        <Popover><PopoverTrigger asChild><button className="inbox-icon" title="Display options" aria-label="Display options"><SlidersHorizontal size={15} /></button></PopoverTrigger>
          <PopoverContent align="end" className="inbox-display-options" onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation() }}>
            <div><span>Enable priority inbox</span><Switch aria-label="Enable priority inbox" checked={prefs.prioritize} onCheckedChange={checked => setOptions({ prioritize: checked })} /></div>
            <label>Include in priority inbox <select disabled={!prefs.prioritize} value={prefs.priorityFilter} onChange={e => setOptions({ priorityFilter: e.target.value as InboxPreferences['priorityFilter'] })}><option value="all">All priority activity</option><option value="action">Needs action</option><option value="flagged">Flagged sessions</option></select></label>
            <label>Badge count <select value={prefs.badge} onChange={e => setOptions({ badge: e.target.value as InboxPreferences['badge'] })}><option value="all">Priority &amp; Other</option><option value="priority">Priority only</option><option value="none">None</option></select></label>
            <hr />
            <label>Group unreads by <select value={prefs.grouping} onChange={e => setOptions({ grouping: e.target.value as InboxPreferences['grouping'] })}><option value="none">No grouping</option><option value="type">Activity type</option></select></label>
            <label>Ordering <select value={prefs.ordering} onChange={e => setOptions({ ordering: e.target.value as InboxPreferences['ordering'] })}><option value="newest">Newest</option><option value="oldest">Oldest</option></select></label>
            <hr />
            <div><span>Show snoozed</span><Switch aria-label="Show snoozed" checked={prefs.showSnoozed} onCheckedChange={checked => setOptions({ showSnoozed: checked })} /></div>
            <div><span>Show unread first</span><Switch aria-label="Show unread first" checked={prefs.unreadFirst} onCheckedChange={checked => setOptions({ unreadFirst: checked })} /></div>
          </PopoverContent></Popover>
        <DropdownMenu><DropdownMenuTrigger asChild><button className="inbox-icon" title="Inbox actions" aria-label="Inbox actions"><MoreHorizontal size={16} /></button></DropdownMenuTrigger><DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={markAll} disabled={!unread.length}><CheckCheck size={14} /> Mark all as read</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => dismissItems(visible.filter(entry => !entry.unread))} disabled={!visible.some(entry => !entry.unread)}><Trash2 size={14} /> Remove all read notifications</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
      </div></header>
      {prefs.prioritize && <div className="inbox-tabs" role="tablist" aria-label="Notification priority">{(['priority', 'other'] as const).map(value => <button key={value} id={`inbox-tab-${value}`} role="tab" tabIndex={tab === value ? 0 : -1} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); selectTab(value === 'priority' ? 'other' : 'priority'); (event.currentTarget.parentElement?.querySelector(`[id="inbox-tab-${value === 'priority' ? 'other' : 'priority'}"]`) as HTMLElement | null)?.focus() } }} aria-controls="inbox-list" aria-selected={tab === value} onClick={() => selectTab(value)}>{value === 'priority' ? 'Priority' : 'Other'} <span>{value === 'priority' ? priorityUnread : unread.length - priorityUnread}</span></button>)}</div>}
      {searchOpen && <div className="inbox-search"><Search size={14} /><input ref={searchInput} aria-label="Find notifications" placeholder="Find notifications…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setSearchOpen(false); setQuery('') } }} /><button className="inbox-icon" aria-label="Close search" onClick={() => { setSearchOpen(false); setQuery('') }}><X size={14} /></button></div>}
      <div id="inbox-list" ref={listRef} className="inbox-notifications" {...(prefs.prioritize ? { role: 'tabpanel', 'aria-labelledby': `inbox-tab-${tab}` } : {})}>
        {items.length ? [...groups].map(([group, entries]) => <div key={group}>{group && <h2 className="inbox-group-label">{group}</h2>}{entries.map(entry => {
          const title = getSessionTitle(entry.session)
          const KindIcon = kinds[entry.kind].icon
          const snoozed = isSnoozed(entry, prefs, now)
          return <ContextMenu key={entry.session.id}><ContextMenuTrigger asChild>
            <button type="button" className="inbox-row" data-inbox-row={entry.session.id} aria-current={entry === selected ? 'true' : undefined} aria-label={`${entry.unread ? 'Unread: ' : ''}${title}, ${kinds[entry.kind].text}${snoozed ? ', snoozed' : ''}`} onClick={() => choose(entry)}>
              <span className="inbox-avatar"><Bot size={17} /><span className="inbox-avatar-event"><KindIcon size={10} /></span></span>
              <span className="inbox-row-copy"><span className="inbox-row-title">{entry.unread && <i aria-hidden="true" />}<span>{title}</span></span><span className="inbox-row-subtitle">{kinds[entry.kind].text}</span></span>
              <span className="inbox-row-meta">{snoozed ? <Clock3 size={13} /> : entry.session.isFlagged ? <Flag size={13} /> : <KindIcon size={13} />}{entry.activityAt > 0 && <time dateTime={new Date(entry.activityAt).toISOString()}>{inboxRelativeTime(entry.activityAt, now)}</time>}</span>
            </button>
          </ContextMenuTrigger><ContextMenuContent>
            <ContextMenuItem onSelect={() => toggleRead(entry)}>{entry.unread ? 'Mark as read' : 'Mark as unread'}</ContextMenuItem>
            {snoozed ? <ContextMenuItem onSelect={() => delay(entry)}>Unsnooze</ContextMenuItem> : <ContextMenuSub><ContextMenuSubTrigger>Snooze</ContextMenuSubTrigger><ContextMenuSubContent>{durations.map((label, i) => <ContextMenuItem key={label} onSelect={() => delay(entry, durationMinutes[i])}>{label}</ContextMenuItem>)}</ContextMenuSubContent></ContextMenuSub>}
            <ContextMenuItem onSelect={() => onOpenSession(entry.session.id)}>Open session</ContextMenuItem><ContextMenuSeparator />
            <ContextMenuItem onSelect={() => dismissItems([entry])}>Remove notification</ContextMenuItem>
          </ContextMenuContent></ContextMenu>
        })}</div>) : <div className="inbox-empty"><Inbox size={28} strokeWidth={1.4} /><strong>{term ? 'No matching notifications' : 'You’re all caught up'}</strong><span>{term ? 'Try a different search.' : 'New session updates will appear here.'}</span></div>}
      </div>
    </aside>
    <div className="inbox-detail-pane" aria-label="Notification detail">
      {selected ? <><header className="inbox-bar inbox-detail-bar"><div className="inbox-detail-title"><button className="inbox-icon" aria-label="Back to Inbox list" title="Back to Inbox list" onClick={() => onSelect()}><ArrowLeft size={15} /></button><span>{getSessionTitle(selected.session)}</span></div><div className="inbox-actions">
        <button className="inbox-icon" aria-label={selected.unread ? 'Mark as read' : 'Mark as unread'} title={selected.unread ? 'Mark as read' : 'Mark as unread'} onClick={() => toggleRead(selected)}>{selected.unread ? <MailOpen size={15} /> : <Mail size={15} />}</button>
        <DropdownMenu open={snoozeOpen} onOpenChange={setSnoozeOpen}><DropdownMenuTrigger asChild><button className="inbox-icon" aria-label="Snooze notification" title="Snooze notification"><Clock3 size={15} /></button></DropdownMenuTrigger><DropdownMenuContent align="end">{isSnoozed(selected, prefs, now) ? <DropdownMenuItem onSelect={() => delay(selected)}>Unsnooze</DropdownMenuItem> : durations.map((label, i) => <DropdownMenuItem key={label} onSelect={() => delay(selected, durationMinutes[i])}>{label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
        <button className="inbox-icon" aria-label="Remove notification" title="Remove notification" onClick={() => dismissItems([selected])}><Trash2 size={15} /></button>
        <button className="inbox-icon" aria-label="Open session outside Inbox" title="Open session outside Inbox" onClick={() => onOpenSession(selected.session.id)}><ExternalLink size={15} /></button>
      </div></header><div data-inbox-chat className="inbox-chat">{renderSession(selected.session.id)}</div></> : <div className="inbox-empty"><Bell size={30} strokeWidth={1.35} /><strong>Select a notification</strong><span>View its session and take action without leaving Inbox.</span></div>}
    </div>
  </section>
}
