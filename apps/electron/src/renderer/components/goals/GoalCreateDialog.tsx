import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CreateGoalInput, Goal } from '@craft-agent/shared/goals/types'
import { validGoalInput } from './goal-model'
import { errorMessage } from './useGoals'

interface GoalCreateDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  onCreate(input: CreateGoalInput): Promise<Goal>
  onCreated(goal: Goal): void
}

export function GoalCreateDialog({ open, onOpenChange, onCreate, onCreated }: GoalCreateDialogProps) {
  const { t } = useTranslation()
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [criteria, setCriteria] = React.useState([{ id: 0, text: '' }])
  const nextId = React.useRef(1)
  const mounted = React.useRef(false)
  React.useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const submitting = React.useRef(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const input: CreateGoalInput = { title: title.trim(), description: description.trim(), criteria: criteria.map(c => c.text.trim()) }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting.current || !validGoalInput(input)) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      const goal = await onCreate(input)
      // A workspace or panel change may have unmounted the form during IPC.
      if (mounted.current) {
        onOpenChange(false)
        onCreated(goal)
      }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={value => { if (!submitting.current) onOpenChange(value) }}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{t('goals.new', { defaultValue: 'New goal' })}</DialogTitle>
          <DialogDescription>{t('goals.createHint', { defaultValue: 'Describe the outcome and what must be independently verified before it is done.' })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="goal-title" className="text-label font-medium">{t('goals.name', { defaultValue: 'Title' })}</label>
            <Input id="goal-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={240} required disabled={busy} placeholder={t('goals.titlePlaceholder', { defaultValue: 'What would you like to achieve?' })} />
          </div>
          <div className="space-y-2">
            <label htmlFor="goal-description" className="text-label font-medium">{t('goals.description', { defaultValue: 'Description' })}</label>
            <Textarea id="goal-description" value={description} onChange={e => setDescription(e.target.value)} maxLength={20000} disabled={busy} placeholder={t('goals.descriptionPlaceholder', { defaultValue: 'Context, constraints, and anything the agent should know.' })} />
          </div>
          <fieldset disabled={busy} className="space-y-2">
            <legend className="text-label font-medium mb-2">{t('goals.doneWhen', { defaultValue: 'Done when' })} <span className="text-tertiary font-normal">{criteria.length}/8</span></legend>
            {criteria.map((criterion, index) => (
              <div key={criterion.id} className="flex items-center gap-2">
                <span className="text-label-sm text-tertiary w-4 tabular-nums">{index + 1}</span>
                <Input aria-label={t('goals.criterionLabel', { defaultValue: 'Criterion {{number}}', number: index + 1 })} value={criterion.text} onChange={e => setCriteria(rows => rows.map(row => row.id === criterion.id ? { ...row, text: e.target.value } : row))} maxLength={2000} required placeholder={t('goals.criterionPlaceholder', { defaultValue: 'An observable, verifiable result' })} />
                <IconButton type="button" icon={<X />} aria-label={t('goals.removeCriterion', { defaultValue: 'Remove criterion {{number}}', number: index + 1 })} disabled={busy || criteria.length === 1} onClick={() => setCriteria(rows => rows.filter(row => row.id !== criterion.id))} />
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" disabled={busy || criteria.length >= 8} onClick={() => setCriteria(rows => [...rows, { id: nextId.current++, text: '' }])}><Plus />{t('goals.addCriterion', { defaultValue: 'Add criterion' })}</Button>
          </fieldset>
          {error && <p role="alert" className="text-label text-destructive whitespace-pre-wrap break-words">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>{t('goals.cancel', { defaultValue: 'Cancel' })}</Button>
            <Button type="submit" disabled={busy || !validGoalInput(input)}>{busy ? t('goals.creating', { defaultValue: 'Creating…' }) : t('goals.create', { defaultValue: 'Create goal' })}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
