import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SortableList } from '@/components/ui/sortable-list'
import { Switch } from '@/components/ui/switch'
import { moveSidebarItem, normalizeSidebarLayout, type SidebarLayout, type WorkspaceSidebarId } from './sidebar-layout'

export interface SidebarOption { id: WorkspaceSidebarId; title: string; icon: ReactNode }

/** Render only while open so closing without Apply discards the working draft. */
export function CustomizeSidebarDialog({ layout, options, onClose, onApply, onRestoreFocus }: {
  layout: SidebarLayout
  options: SidebarOption[]
  onClose: () => void
  onRestoreFocus: () => void
  onApply: (layout: SidebarLayout) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(() => normalizeSidebarLayout(layout))
  const byId = new Map(options.map(item => [item.id, item]))
  const entries = draft.order.flatMap(id => { const item = byId.get(id); return item ? [item] : [] })
  const hidden = new Set(draft.hidden)

  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[440px]" onCloseAutoFocus={event => {
      event.preventDefault()
      onRestoreFocus()
    }}>
      <DialogHeader>
        <DialogTitle>{t('sidebar.customize', { defaultValue: 'Customize sidebar' })}</DialogTitle>
        <DialogDescription>{t('sidebar.customizeDescription', { defaultValue: 'Reorder workspace items and choose which to show. Items you turn off stay accessible under More.' })}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <div className="flex items-center justify-between px-2 text-label-sm font-medium text-tertiary">
          <span>{t('sidebar.workspaceSection')}</span>
          <span>{t('sidebar.showInSidebar', { defaultValue: 'Show in sidebar' })}</span>
        </div>
        <SortableList items={entries} onReorder={items => setDraft(current => ({ ...current, order: normalizeSidebarLayout({ order: items.map(item => item.id) }).order }))}
          showOverlay={false} className="grid gap-px rounded-lg border border-separator p-1"
          renderItem={(item, dragging) => {
            const idx = entries.findIndex(entry => entry.id === item.id)
            return <div className={`group flex min-h-10 items-center gap-2 rounded-md px-2 text-label ${dragging ? 'bg-fill-hover' : 'hover:bg-fill-hover'}`}>
              <GripVertical className="size-4 shrink-0 text-tertiary" aria-hidden="true" />
              <span className="flex size-4 shrink-0 items-center justify-center text-secondary">{item.icon}</span>
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              <div data-no-dnd="true" className="flex shrink-0 items-center gap-1.5" onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation() }}>
                <Button type="button" variant="ghost" size="icon" className="size-6" disabled={idx === 0}
                  aria-label={t('sidebar.moveUp', { name: item.title, defaultValue: 'Move {{name}} up' })}
                  onClick={() => setDraft(current => ({ ...current, order: moveSidebarItem(current.order, item.id, -1) }))}><ArrowUp className="size-3.5" /></Button>
                <Button type="button" variant="ghost" size="icon" className="size-6" disabled={idx === entries.length - 1}
                  aria-label={t('sidebar.moveDown', { name: item.title, defaultValue: 'Move {{name}} down' })}
                  onClick={() => setDraft(current => ({ ...current, order: moveSidebarItem(current.order, item.id, 1) }))}><ArrowDown className="size-3.5" /></Button>
                <Switch checked={!hidden.has(item.id)} aria-label={t('sidebar.showItem', { name: item.title, defaultValue: 'Show {{name}} in sidebar' })}
                  onCheckedChange={checked => setDraft(current => ({ ...current, hidden: checked ? current.hidden.filter(id => id !== item.id) : [...current.hidden, item.id] }))} />
              </div>
            </div>
          }} />
      </div>
      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="ghost" onClick={() => setDraft(normalizeSidebarLayout(null))}>{t('sidebar.resetDefaults', { defaultValue: 'Reset to default' })}</Button>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="button" onClick={() => onApply(draft)}>{t('sidebar.applyCustomization', { defaultValue: 'Apply' })}</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
