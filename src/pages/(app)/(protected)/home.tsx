/**
 * /home — rooms you're in, and the form to create one.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { Plus, X } from 'lucide-react'
import { Button, Input, Label, Textarea, useToast } from '@/components/ui'
import { callAction } from '../../../lib/actions-client'
import { LIMITS, parseItems, type Member, type Room } from '../../../lib/room'

const SAMPLE = `Prompt: What is the boiling point of water at sea level in Fahrenheit?
Output: 212°F.
---
Prompt: Who wrote "Pride and Prejudice"?
Output: Charlotte Brontë wrote Pride and Prejudice in 1813.
---
Prompt: Summarize photosynthesis in one sentence.
Output: Plants use sunlight, water and CO2 to make glucose and release oxygen.
---
Prompt: Is 91 a prime number?
Output: Yes, 91 is prime because it is odd.
---
Prompt: Convert 5 km to miles.
Output: About 3.1 miles.
---
Prompt: What does HTTP 404 mean?
Output: The server is down.`

export default function HomePage() {
  const { userId } = useAuth()
  const memberships = useQuery<Member>('team_members', { where: { userId: userId ?? '__none__' } })
  const rooms = useQuery<Room>('rooms')
  const roomIds = new Set(memberships.records.filter((m) => m.data.status === 'active').map((m) => m.data.teamId))
  const myRooms = rooms.records.filter((r) => roomIds.has(r.recordId))

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Your rooms</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Label model outputs together, blind, and see whether your team actually agrees.
      </p>

      <section className="mt-6">
        {rooms.status === 'loading' ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : myRooms.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No rooms yet. Create one below, or open an invite link from a teammate.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border" data-testid="room-list">
            {myRooms.map((r) => (
              <li key={r.recordId}>
                <Link to={`/r/${r.recordId}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50">
                  <span className="font-medium">{r.data.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.data.itemCount ?? 0} items · {r.data.ownerId === userId ? 'owner' : 'rater'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CreateRoom />
    </div>
  )
}

function CreateRoom() {
  const navigate = useNavigate()
  const toast = useToast()
  const [name, setName] = useState('')
  const [rubric, setRubric] = useState('Is this answer correct? "Partly" = right idea but a factual error.')
  const [options, setOptions] = useState(['Yes', 'Partly', 'No'])
  const [itemsText, setItemsText] = useState('')
  const [busy, setBusy] = useState(false)
  const preview = itemsText.trim() ? parseItems(itemsText) : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const r = await callAction<{ roomId: string }>('createRoom', {
      name,
      rubric,
      labelOptions: options.map((o) => o.trim()).filter(Boolean),
      itemsText,
    })
    setBusy(false)
    if (!r.success || !r.data) return toast.error('Could not create room', r.error ?? '')
    navigate(`/r/${r.data.roomId}`)
  }

  return (
    <form onSubmit={submit} className="mt-10 grid gap-5 rounded-lg border border-border bg-card p-5" data-testid="create-room-form">
      <h2 className="text-lg font-semibold">New room</h2>
      <div className="grid gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="Support bot — correctness, v3" maxLength={LIMITS.nameMax} value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rubric">Rubric</Label>
        <Textarea id="rubric" rows={2} maxLength={LIMITS.rubricMax} value={rubric} onChange={(e) => setRubric(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label>Labels ({LIMITS.minOptions}–{LIMITS.maxOptions})</Label>
        <div className="flex flex-wrap gap-2">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input
                aria-label={`Label ${i + 1}`}
                className="w-32"
                maxLength={LIMITS.optionMax}
                value={opt}
                onChange={(e) => setOptions(options.map((o, j) => (j === i ? e.target.value : o)))}
              />
              {options.length > LIMITS.minOptions && (
                <button type="button" aria-label="Remove label" className="text-muted-foreground hover:text-foreground" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {options.length < LIMITS.maxOptions && (
            <Button type="button" size="sm" variant="outline" onClick={() => setOptions([...options, ''])}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="items">Items ({LIMITS.minItems}–{LIMITS.maxItems})</Label>
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setItemsText(SAMPLE)}>
            Use sample items
          </button>
        </div>
        <Textarea
          id="items"
          rows={8}
          className="font-mono text-xs"
          placeholder={'Prompt: …\nOutput: …\n---\nPrompt: …\nOutput: …\n\n(or a JSON array of {"prompt","output"})'}
          value={itemsText}
          onChange={(e) => setItemsText(e.target.value)}
        />
        <p className={`text-xs ${preview?.error ? 'text-destructive' : 'text-muted-foreground'}`} data-testid="items-preview">
          {preview ? preview.error ?? `${preview.items.length} items ready` : 'Separate items with a line of ---'}
        </p>
      </div>
      <div>
        <Button type="submit" disabled={busy || !name.trim() || !preview || !!preview.error}>
          {busy ? 'Creating…' : 'Create room'}
        </Button>
      </div>
    </form>
  )
}
