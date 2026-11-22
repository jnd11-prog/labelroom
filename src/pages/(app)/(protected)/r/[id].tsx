/**
 * /r/:id — a labeling room.
 *
 * Everything here is a live read. The RecordRoom only sends this client:
 *   - rooms/items/members/stats of rooms it belongs to ('team'),
 *   - its own labels, plus others' labels/comments on items it has labeled ('shared').
 * So "blind until you submit" holds on the wire, not just in this UI.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth, usePresenceRoom, useQuery } from 'deepspace'
import { Bot, Check, ChevronLeft, ChevronRight, Copy, Eye, MessageSquare, Users } from 'lucide-react'
import { Button, Modal, Textarea, useToast } from '@/components/ui'
import { callAction } from '../../../../lib/actions-client'
import { JUDGE_ID, MIN_OVERLAP, band, formatKappa, type KappaResult } from '../../../../lib/agreement'
import type { RoomStats } from '../../../../lib/stats'
import { JUDGE_RATER_ID, LIMITS, type Comment, type Item, type Label, type Member, type Room } from '../../../../lib/room'

interface Rec<T> {
  recordId: string
  data: T
  createdAt?: string
}

export default function RoomPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { userId } = useAuth()
  const me = userId ?? ''
  const membership = useQuery<Member>('team_members', { where: { teamId: id, userId: me } })
  const roomQ = useQuery<Room>('rooms', { where: { roomId: id } })
  const room = roomQ.records[0] as Rec<Room> | undefined
  const isMember = membership.records.some((m) => m.data.status === 'active')

  if (membership.status === 'loading' || (isMember && roomQ.status === 'loading')) return <Centered>Loading…</Centered>
  if (!isMember) return <JoinPanel roomId={id} />
  if (!room) return <Centered>This room doesn't exist.</Centered>
  return <RoomView room={room} me={me} />
}

function JoinPanel({ roomId }: { roomId: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <Centered>
      <div className="max-w-sm rounded-lg border border-border bg-card p-6 text-left">
        <h1 className="text-lg font-semibold text-foreground">You're invited to a LabelRoom</h1>
        <p className="mt-2 text-sm">
          You'll rate model outputs blind: nobody's labels are visible to you until you submit your own, and yours stay hidden the same way.
        </p>
        <Button
          className="mt-5 w-full"
          disabled={busy}
          data-testid="join-room"
          onClick={async () => {
            setBusy(true)
            const r = await callAction('joinRoom', { roomId })
            if (!r.success) {
              setBusy(false)
              return toast.error('Could not join', r.error ?? '')
            }
            // The room's records are scoped by membership; reconnect so the new
            // membership is applied to this socket's subscriptions.
            window.location.reload()
          }}
        >
          {busy ? 'Joining…' : 'Join room'}
        </Button>
      </div>
    </Centered>
  )
}

function RoomView({ room, me }: { room: Rec<Room>; me: string }) {
  const roomId = room.recordId
  const isOwner = room.data.ownerId === me
  const itemsQ = useQuery<Item>('items', { where: { roomId }, orderBy: 'order', orderDir: 'asc', limit: 100 })
  const labelsQ = useQuery<Label>('labels', { where: { roomId }, limit: 2000 })
  const commentsQ = useQuery<Comment>('comments', { where: { roomId }, orderBy: 'createdAt', orderDir: 'asc', limit: 2000 })
  const membersQ = useQuery<Member>('team_members', { where: { teamId: roomId } })
  const statsQ = useQuery<{ roomId: string; stats: RoomStats }>('room_stats', { where: { roomId } })
  const stats = statsQ.records[0]?.data.stats

  const items = useMemo(() => [...itemsQ.records].sort((a, b) => a.data.order - b.data.order), [itemsQ.records]) as Rec<Item>[]
  const labels = labelsQ.records as Rec<Label>[]
  const names = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of membersQ.records) m.set(r.data.userId, r.data.name || 'Rater')
    m.set(JUDGE_ID, 'AI judge')
    return m
  }, [membersQ.records])
  const nameOf = (uid: string) => (uid === me ? 'You' : names.get(uid) ?? 'Rater')

  const myLabels = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of labels) if (l.data.raterId === me && l.data.source === 'human') m.set(l.data.itemId, l.data.value)
    return m
  }, [labels, me])

  const [index, setIndex] = useState<number | null>(null)
  const firstUnlabeled = items.findIndex((it) => !myLabels.has(it.recordId) && !(it.data.revealedTo ?? []).includes(me))
  const current = index ?? (firstUnlabeled === -1 ? Math.max(0, items.length - 1) : firstUnlabeled)
  const [openItem, setOpenItem] = useState<string | null>(null)

  const presence = usePresenceRoom(`labelroom:${roomId}`)
  useEffect(() => {
    presence.updateState({ item: current + 1 })
  }, [current])

  if (itemsQ.status === 'loading') return <Centered>Loading items…</Centered>

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/home" className="text-sm text-muted-foreground hover:text-foreground">
            ← Rooms
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight" data-testid="room-name">
            {room.data.name}
          </h1>
          {room.data.rubric && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{room.data.rubric}</p>}
        </div>
        <PresenceBar peers={presence.peers} />
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <RatingCard
          room={room}
          items={items}
          labels={labels}
          index={current}
          setIndex={setIndex}
          me={me}
          myLabels={myLabels}
          nameOf={nameOf}
          onDiscuss={setOpenItem}
        />
        <aside className="grid content-start gap-4">
          {isOwner && <OwnerPanel room={room} />}
          <StatsPanel stats={stats} nameOf={nameOf} />
          <SplitList stats={stats} items={items} myLabels={myLabels} me={me} onOpen={setOpenItem} />
        </aside>
      </div>

      {openItem && (
        <ItemDetail
          room={room}
          item={items.find((i) => i.recordId === openItem)!}
          labels={labels.filter((l) => l.data.itemId === openItem)}
          comments={(commentsQ.records as Rec<Comment>[]).filter((c) => c.data.itemId === openItem)}
          me={me}
          isOwner={isOwner}
          nameOf={nameOf}
          onClose={() => setOpenItem(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function RatingCard(props: {
  room: Rec<Room>
  items: Rec<Item>[]
  labels: Rec<Label>[]
  index: number
  setIndex: (i: number) => void
  me: string
  myLabels: Map<string, string>
  nameOf: (uid: string) => string
  onDiscuss: (itemId: string) => void
}) {
  const { room, items, labels, index, setIndex, me, myLabels, nameOf, onDiscuss } = props
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const item = items[index]
  if (!item) return <Centered>No items in this room.</Centered>

  const mine = myLabels.get(item.recordId)
  const revealed = (item.data.revealedTo ?? []).includes(me)
  const others = labels.filter((l) => l.data.itemId === item.recordId && l.data.raterId !== me)
  const done = myLabels.size

  async function submit(value: string) {
    setBusy(value)
    const r = await callAction('submitLabel', { itemId: item.recordId, value })
    setBusy(null)
    if (!r.success) toast.error('Label not saved', r.error ?? '')
  }

  return (
    <section className="rounded-xl border border-border bg-card" data-testid="rating-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3 text-sm">
        <span className="tabular-nums text-muted-foreground" data-testid="item-position">
          Item {index + 1} of {items.length}
        </span>
        <span className="tabular-nums text-muted-foreground">
          You've labeled {done}/{items.length}
        </span>
      </div>

      <div className="grid gap-4 p-5">
        {item.data.prompt && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prompt</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{item.data.prompt}</p>
          </div>
        )}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Model output</p>
          <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm" data-testid="item-output">
            {item.data.output}
          </p>
        </div>

        {revealed && !mine ? (
          <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
            You revealed this item to adjudicate it, so you can't label it blind.
          </p>
        ) : (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {mine ? 'Your label (final)' : 'Your label'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2" data-testid="label-options">
              {room.data.labelOptions.map((opt) => (
                <Button
                  key={opt}
                  variant={mine === opt ? 'default' : 'outline'}
                  disabled={!!busy || (!!mine && mine !== opt)}
                  onClick={() => !mine && submit(opt)}
                  data-testid={`label-${opt}`}
                >
                  {mine === opt && <Check className="h-4 w-4" />}
                  {busy === opt ? 'Saving…' : opt}
                </Button>
              ))}
            </div>
          </div>
        )}

        {(mine || revealed) && (
          <div className="rounded-md border border-border p-3" data-testid="others-labels">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Other labels</p>
            {others.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Nobody else has labeled this yet. Theirs will appear here live.</p>
            ) : (
              <ul className="mt-2 grid gap-1 text-sm">
                {others.map((l) => (
                  <li key={l.recordId} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      {l.data.raterId === JUDGE_RATER_ID && <Bot className="h-3.5 w-3.5" />}
                      {nameOf(l.data.raterId)}
                    </span>
                    <span className={l.data.value === (mine ?? '') ? 'text-foreground' : 'font-medium text-amber-600 dark:text-amber-400'}>
                      {l.data.value}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {item.data.goldLabel && <p className="mt-2 text-sm">Gold: <span className="font-medium">{item.data.goldLabel}</span></p>}
            <button className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => onDiscuss(item.recordId)}>
              <MessageSquare className="h-3.5 w-3.5" /> Discuss this item
            </button>
          </div>
        )}
        {!mine && !revealed && (
          <p className="text-xs text-muted-foreground">Others' labels for this item stay hidden until you submit yours.</p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-5 py-3">
        <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <ChevronLeft className="h-4 w-4" /> Prev
        </Button>
        <Button variant="ghost" size="sm" disabled={index >= items.length - 1} onClick={() => setIndex(index + 1)} data-testid="next-item">
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------

function KappaCell({ result }: { result: KappaResult | undefined }) {
  if (!result) return <span className="text-muted-foreground">—</span>
  if (result.kind !== 'ok') return <span className="text-xs text-muted-foreground">{formatKappa(result)}</span>
  const b = band(result.kappa)
  const tone =
    b === 'strong' || b === 'substantial'
      ? 'text-emerald-700 dark:text-emerald-400'
      : b === 'moderate'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-red-700 dark:text-red-400'
  return (
    <span className="tabular-nums">
      <span className="font-medium">{formatKappa(result)}</span> <span className={`text-xs ${tone}`}>{b}</span>
      <span className="ml-1 text-xs text-muted-foreground">n={result.n}</span>
    </span>
  )
}

function StatsPanel({ stats, nameOf }: { stats: RoomStats | undefined; nameOf: (uid: string) => string }) {
  if (!stats) return null
  const raters = Object.keys(stats.progress).sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
  const judgeGold = stats.vsGold[JUDGE_ID]
  return (
    <section className="rounded-lg border border-border bg-card p-4" data-testid="stats-panel">
      <h2 className="text-sm font-medium">Agreement</h2>

      <h3 className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">Progress</h3>
      <ul className="mt-1 grid gap-1.5">
        {raters.map((r) => (
          <li key={r} className="text-sm">
            <div className="flex justify-between">
              <span>{nameOf(r)}</span>
              <span className="tabular-nums text-muted-foreground">
                {stats.counts[r] ?? 0}/{stats.itemCount}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-muted">
              <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.round((stats.progress[r] ?? 0) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">Cohen's κ by pair</h3>
      {stats.pairs.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Needs two raters.</p>
      ) : (
        <ul className="mt-1 grid gap-1 text-sm" data-testid="kappa-pairs">
          {stats.pairs.map((p) => (
            <li key={`${p.a}-${p.b}`} className="flex flex-wrap justify-between gap-x-2">
              <span>
                {nameOf(p.a)} × {nameOf(p.b)}
              </span>
              <KappaCell result={p.result} />
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-4 flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
        <Bot className="h-3.5 w-3.5" /> AI judge
      </h3>
      {stats.judgeCount === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Not run yet.</p>
      ) : (
        <ul className="mt-1 grid gap-1 text-sm" data-testid="judge-stats">
          <li className="flex flex-wrap justify-between gap-x-2">
            <span>vs gold ({stats.goldCount})</span>
            <KappaCell result={judgeGold} />
          </li>
          {Object.entries(stats.judgeVsHuman).map(([r, res]) => (
            <li key={r} className="flex flex-wrap justify-between gap-x-2">
              <span>vs {nameOf(r)}</span>
              <KappaCell result={res} />
            </li>
          ))}
        </ul>
      )}

      {stats.goldCount > 0 && (
        <>
          <h3 className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">Raters vs gold</h3>
          <ul className="mt-1 grid gap-1 text-sm">
            {raters.map((r) => (
              <li key={r} className="flex flex-wrap justify-between gap-x-2">
                <span>{nameOf(r)}</span>
                <KappaCell result={stats.vsGold[r]} />
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        κ corrects % agreement for chance. Bands (&lt;0.4 weak · 0.4–0.6 moderate · 0.6–0.8 substantial · &gt;0.8 strong) are
        conventions, not laws. Needs {MIN_OVERLAP}+ shared items.
      </p>
    </section>
  )
}

function SplitList(props: {
  stats: RoomStats | undefined
  items: Rec<Item>[]
  myLabels: Map<string, string>
  me: string
  onOpen: (id: string) => void
}) {
  const { stats, items, myLabels, me, onOpen } = props
  if (!stats) return null
  const byId = new Map(items.map((i) => [i.recordId, i]))
  const splits = stats.splits.map((id) => byId.get(id)).filter((x): x is Rec<Item> => !!x)
  return (
    <section className="rounded-lg border border-border bg-card p-4" data-testid="split-list">
      <h2 className="text-sm font-medium">Split items ({splits.length})</h2>
      {splits.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">No disagreements yet.</p>
      ) : (
        <ul className="mt-2 grid gap-1.5">
          {splits.map((it) => {
            const canSee = myLabels.has(it.recordId) || (it.data.revealedTo ?? []).includes(me)
            return (
              <li key={it.recordId}>
                <button
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!canSee}
                  onClick={() => onOpen(it.recordId)}
                >
                  <span className="min-w-0 truncate">
                    <span className="tabular-nums text-muted-foreground">#{it.data.order}</span> {it.data.prompt || it.data.output}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {it.data.goldLabel ? `gold: ${it.data.goldLabel}` : canSee ? 'open' : 'label it to see'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function OwnerPanel({ room }: { room: Rec<Room> }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const link = typeof window !== 'undefined' ? `${window.location.origin}/r/${room.recordId}` : ''
  const running = room.data.judgeStatus === 'running'
  return (
    <section className="rounded-lg border border-border bg-card p-4" data-testid="owner-panel">
      <h2 className="text-sm font-medium">Invite raters</h2>
      <div className="mt-2 flex gap-2">
        <input readOnly value={link} className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs" data-testid="invite-link" />
        <Button size="sm" variant="outline" aria-label="Copy invite link" onClick={() => navigator.clipboard?.writeText(link).then(() => toast.success('Invite link copied'))}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="text-sm">
          <p className="font-medium">AI judge</p>
          <p className="text-xs text-muted-foreground">{running ? 'Running…' : room.data.judgeStatus || 'Rates every item with this rubric'}</p>
        </div>
        <Button
          size="sm"
          disabled={busy || running}
          data-testid="run-judge"
          onClick={async () => {
            setBusy(true)
            const r = await callAction<{ stored: number; rejected: number }>('runJudge', { roomId: room.recordId })
            setBusy(false)
            if (!r.success) return toast.error('Judge failed', r.error ?? '')
            toast.success(`Judge rated ${r.data?.stored ?? 0} items`, r.data?.rejected ? `${r.data.rejected} answers were off-rubric and rejected` : undefined)
          }}
        >
          <Bot className="h-4 w-4" /> {busy ? 'Judging…' : 'Run judge'}
        </Button>
      </div>
    </section>
  )
}

function ItemDetail(props: {
  room: Rec<Room>
  item: Rec<Item>
  labels: Rec<Label>[]
  comments: Rec<Comment>[]
  me: string
  isOwner: boolean
  nameOf: (uid: string) => string
  onClose: () => void
}) {
  const { room, item, labels, comments, me, isOwner, nameOf, onClose } = props
  const toast = useToast()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const hasLabeled = labels.some((l) => l.data.raterId === me && l.data.source === 'human')
  const revealed = (item.data.revealedTo ?? []).includes(me)
  const canSee = hasLabeled || revealed

  async function act(name: string, params: Record<string, unknown>) {
    setBusy(true)
    const r = await callAction(name, params)
    setBusy(false)
    if (!r.success) toast.error('Something went wrong', r.error ?? '')
    return r.success
  }

  return (
    <Modal open onClose={onClose} size="lg" aria-label={`Item #${item.data.order}`}>
      <h2 className="mb-3 text-lg font-semibold">Item #{item.data.order}</h2>
      <div className="grid max-h-[70vh] gap-4 overflow-y-auto text-sm" data-testid="item-detail">
        {item.data.prompt && <p className="whitespace-pre-wrap text-muted-foreground">{item.data.prompt}</p>}
        <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3">{item.data.output}</p>

        {!canSee ? (
          <div className="rounded-md border border-border p-3">
            <p className="text-muted-foreground">Labels and discussion are hidden until you label this item.</p>
            {isOwner && (
              <Button size="sm" variant="outline" className="mt-3" disabled={busy} onClick={() => act('revealItem', { itemId: item.recordId })} data-testid="reveal-item">
                <Eye className="h-4 w-4" /> Reveal to adjudicate (you won't be able to label it)
              </Button>
            )}
          </div>
        ) : (
          <>
            <ul className="grid gap-1">
              {labels.map((l) => (
                <li key={l.recordId} className="flex justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    {l.data.raterId === JUDGE_RATER_ID && <Bot className="h-3.5 w-3.5" />}
                    {nameOf(l.data.raterId)}
                  </span>
                  <span className="font-medium">{l.data.value}</span>
                </li>
              ))}
            </ul>

            {isOwner && (
              <div data-testid="gold-picker">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Gold label</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {room.data.labelOptions.map((opt) => (
                    <Button
                      key={opt}
                      size="sm"
                      variant={item.data.goldLabel === opt ? 'default' : 'outline'}
                      disabled={busy}
                      onClick={() => act('setGold', { itemId: item.recordId, value: item.data.goldLabel === opt ? '' : opt })}
                    >
                      {opt}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {!isOwner && item.data.goldLabel && <p>Gold: <span className="font-medium">{item.data.goldLabel}</span></p>}

            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Discussion</p>
              {comments.length === 0 ? (
                <p className="mt-1 text-muted-foreground">No comments yet. Why did you pick your label?</p>
              ) : (
                <ul className="mt-2 grid gap-2" data-testid="comments">
                  {comments.map((c) => (
                    <li key={c.recordId}>
                      <span className="font-medium">{c.data.authorId === me ? 'You' : c.data.authorName}</span>{' '}
                      <span className="whitespace-pre-wrap">{c.data.body}</span>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="mt-3 grid gap-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (await act('addComment', { itemId: item.recordId, body })) setBody('')
                }}
              >
                <Textarea rows={2} maxLength={LIMITS.commentMax} value={body} onChange={(e) => setBody(e.target.value)} placeholder="The rubric doesn't say whether…" />
                <div>
                  <Button size="sm" type="submit" disabled={busy || !body.trim()}>
                    Comment
                  </Button>
                </div>
              </form>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function PresenceBar({ peers }: { peers: { userId: string; userName: string; state: Record<string, unknown> }[] }) {
  const unique = [...new Map(peers.map((p) => [p.userId, p])).values()]
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="presence">
      <Users className="h-4 w-4" />
      {unique.length === 0 ? (
        <span>Just you</span>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {unique.map((p) => (
            <li key={p.userId} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />
              {p.userName}
              {typeof p.state.item === 'number' && <span className="text-muted-foreground"> · item {p.state.item}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[40vh] items-center justify-center px-6 text-center text-muted-foreground">{children}</div>
}
