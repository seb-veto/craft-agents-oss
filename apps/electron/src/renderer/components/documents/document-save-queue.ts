import type { DocumentUpdateInput, WorkspaceDocument } from '@craft-agent/shared/documents/types'

export type DocumentPatch = Omit<DocumentUpdateInput, 'expectedRevision'>
export interface DraftSnapshot {
  document: WorkspaceDocument
  status: 'saved' | 'saving' | 'unsaved' | 'error'
  error: string | null
}
interface RecoveryStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

/** One serialized autosave stream per open document; navigation flushes without dropping an edit. */
export class DocumentSaveQueue {
  private base: WorkspaceDocument
  private pending: DocumentPatch = {}
  private inFlight: DocumentPatch = {}
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | null = null
  private listeners = new Set<() => void>()
  private snapshot: DraftSnapshot
  private recoveryKey: string
  constructor(
    workspaceId: string,
    document: WorkspaceDocument,
    private save: (patch: DocumentUpdateInput) => Promise<WorkspaceDocument>,
    private recovery?: RecoveryStore,
    private delay = 500,
  ) {
    this.base = document
    this.recoveryKey = `craft-document-draft:${workspaceId}:${document.id}`
    this.snapshot = { document, status: 'saved', error: null }
    try {
      const raw = this.recovery?.getItem(this.recoveryKey)
      if (raw) {
        const draft = JSON.parse(raw)
        if (draft && typeof draft.title === 'string' && typeof draft.content === 'string') {
          this.pending = { title: draft.title, content: draft.content }
          this.snapshot = { document: { ...document, ...this.pending }, status: 'unsaved', error: null }
          if (draft.revision !== document.revision) this.snapshot = { ...this.snapshot, status: 'error', error: 'A recovered draft differs from the saved version. Save a copy to keep both versions.' }
          // Scheduling starts in activate(), never during a React render.
        }
      }
    } catch { /* Unavailable storage must not prevent server persistence. */ }
  }
  getSnapshot = (): DraftSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private publish(status: DraftSnapshot['status'], error: string | null = null): void {
    this.snapshot = { document: { ...this.base, ...this.inFlight, ...this.pending }, status, error }
    for (const fn of this.listeners) fn()
  }
  private persistRecovery(): void {
    try { this.recovery?.setItem(this.recoveryKey, JSON.stringify({ title: this.snapshot.document.title, content: this.snapshot.document.content, revision: this.base.revision })) } catch { /* RPC save still proceeds. */ }
  }
  private schedule(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush() }, this.delay)
  }
  activate(): void { if (Object.keys(this.pending).length && this.snapshot.status !== 'error') this.schedule() }
  update(patch: DocumentPatch): void {
    this.pending = { ...this.pending, ...patch }
    // Keep a conflict sticky. Continuing to type must never retry against an unknown revision.
    this.publish(this.snapshot.status === 'error' ? 'error' : 'unsaved', this.snapshot.error)
    this.persistRecovery()
    if (this.snapshot.status !== 'error') this.schedule()
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    if (this.running) { await this.running; return this.flush() }
    if (!Object.keys(this.pending).length || this.snapshot.status === 'error') return
    const patch = this.pending
    this.pending = {}
    this.inFlight = patch
    this.publish('saving')
    this.running = (async () => {
      try {
        this.base = await this.save({ ...patch, expectedRevision: this.base.revision })
        this.inFlight = {}
        this.publish(Object.keys(this.pending).length ? 'unsaved' : 'saved')
        if (Object.keys(this.pending).length) this.persistRecovery()
        else { try { this.recovery?.removeItem(this.recoveryKey) } catch { /* optional recovery */ } }
      } catch (error) {
        this.pending = { ...patch, ...this.pending }
        this.inFlight = {}
        this.publish('error', error instanceof Error ? error.message : 'Unable to save document')
        this.persistRecovery()
      }
    })()
    await this.running
    this.running = null
    if (Object.keys(this.pending).length && this.getSnapshot().status !== 'error') await this.flush()
  }
  async retry(): Promise<void> {
    if (this.snapshot.error?.includes('CONFLICT') || this.snapshot.error?.includes('recovered draft')) return
    this.publish('unsaved')
    await this.flush()
  }
  dispose(): void { clearTimeout(this.timer); void this.flush() }
}
