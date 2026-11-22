/**
 * Server actions — the ONLY write path in LabelRoom.
 *
 * Actions run with RBAC off (see src/server/action-routes.ts), so each one
 * authorizes the caller itself: room membership via team_members, owner-only
 * operations via room.ownerId. Reads stay RBAC-enforced in the RecordRoom.
 *
 * Blind rating invariant (enforced here, then by the 'shared' read rule):
 *   a label or comment on item X is readable by user U only if U has labeled X,
 *   or the room owner revealed X to U for adjudication.
 * `syncItemVisibility` recomputes that from scratch after every write, so two
 * raters submitting the same item at the same moment still end up seeing each
 * other (the DO serializes writes; the later sync observes both labels).
 */

import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  JUDGE_RATER_ID,
  LIMITS,
  buildJudgePrompt,
  cleanText,
  createRoomInput,
  extractText,
  labelId,
  memberId,
  parseItems,
  parseJudgeReply,
  type Comment,
  type Item,
  type Label,
  type Member,
  type Room,
} from '../lib/room'
import { computeRoomStats } from '../lib/stats'

const JUDGE_MODEL = 'claude-haiku-5-5'

interface Rec<T> {
  recordId: string
  data: T
}

const fail = (error: string): ActionResult<never> => ({ success: false, error })
const ok = <T>(data: T): ActionResult<T> => ({ success: true, data })

async function get<T>(tools: ActionTools, collection: string, id: unknown): Promise<Rec<T> | null> {
  if (typeof id !== 'string' || !id) return null
  const r = await tools.get(collection, id)
  if (!r.success) return null
  return (r.data as unknown as { record: Rec<T> }).record
}

async function query<T>(tools: ActionTools, collection: string, where: Record<string, string>): Promise<Rec<T>[]> {
  const r = await tools.query(collection, { where, limit: 1000 })
  if (!r.success) return []
  return (r.data as unknown as { records: Rec<T>[] }).records
}

async function displayName(tools: ActionTools, userId: string): Promise<string> {
  const u = await get<{ name?: string; email?: string }>(tools, 'users', userId)
  return cleanText(u?.data.name, 60) || cleanText(u?.data.email?.split('@')[0], 60) || 'Rater'
}

/** Loads room + caller's membership; refuses non-members. */
async function requireMember(tools: ActionTools, userId: string, roomId: unknown) {
  const room = await get<Room>(tools, 'rooms', roomId)
  if (!room) return { error: fail('Room not found') }
  const member = await get<Member>(tools, 'team_members', memberId(room.recordId, userId))
  if (!member || member.data.status !== 'active') return { error: fail('Join this room first') }
  return { room, member, isOwner: room.data.ownerId === userId }
}

async function requireOwner(tools: ActionTools, userId: string, roomId: unknown) {
  const res = await requireMember(tools, userId, roomId)
  if (res.error) return res
  if (!res.isOwner) return { error: fail('Only the room owner can do that') }
  return res
}

async function itemInRoom(tools: ActionTools, itemId: unknown) {
  const item = await get<Item>(tools, 'items', itemId)
  return item
}

function sameSet(a: string[] | undefined, b: string[]): boolean {
  const sa = new Set(a ?? [])
  return sa.size === b.length && b.every((x) => sa.has(x))
}

/**
 * Recompute who can read the labels and comments on one item:
 * every human who has labeled it, plus everyone it was revealed to.
 * (A row's own author always reads it via ownerField, so they're omitted.)
 */
async function syncItemVisibility(tools: ActionTools, item: Rec<Item>): Promise<void> {
  const labels = await query<Label>(tools, 'labels', { itemId: item.recordId })
  const comments = await query<Comment>(tools, 'comments', { itemId: item.recordId })
  const viewers = new Set<string>(item.data.revealedTo ?? [])
  for (const l of labels) if (l.data.source === 'human') viewers.add(l.data.raterId)
  const all = [...viewers].sort()

  for (const l of labels) {
    const next = all.filter((u) => u !== l.data.raterId)
    if (!sameSet(l.data.canSee, next)) await tools.update('labels', l.recordId, { canSee: next })
  }
  for (const c of comments) {
    const next = all.filter((u) => u !== c.data.authorId)
    if (!sameSet(c.data.canSee, next)) await tools.update('comments', c.recordId, { canSee: next })
  }
}

/** Recompute the room's aggregate stats from all labels (worker sees everything). */
async function refreshStats(tools: ActionTools, roomId: string): Promise<void> {
  const [labels, items, members] = await Promise.all([
    query<Label>(tools, 'labels', { roomId }),
    query<Item>(tools, 'items', { roomId }),
    query<Member>(tools, 'team_members', { teamId: roomId }),
  ])
  const stats = computeRoomStats(
    labels.map((l) => ({ itemId: l.data.itemId, raterId: l.data.raterId, value: l.data.value, source: l.data.source })),
    items.map((i) => ({ id: i.recordId, goldLabel: i.data.goldLabel })),
    members.filter((m) => m.data.status === 'active').map((m) => m.data.userId),
  )
  await tools.create('room_stats', { roomId, stats }, roomId)
}

export const actions: Record<string, ActionHandler<Env>> = {
  /** Owner creates a room with its rubric, 2–4 labels and pasted items. */
  createRoom: async ({ userId, params, tools }) => {
    const input = createRoomInput.safeParse(params)
    if (!input.success) return fail(input.error.issues[0]?.message ?? 'Invalid room')
    const parsed = parseItems(input.data.itemsText)
    if (parsed.error) return fail(parsed.error)

    const roomId = `rm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const created = await tools.create(
      'rooms',
      {
        roomId,
        name: input.data.name,
        rubric: input.data.rubric,
        labelOptions: input.data.labelOptions,
        ownerId: userId,
        itemCount: parsed.items.length,
        judgeStatus: '',
      },
      roomId,
    )
    if (!created.success) return created

    const name = await displayName(tools, userId)
    await tools.create(
      'team_members',
      { teamId: roomId, userId, status: 'active', role: 'owner', name },
      memberId(roomId, userId),
    )
    for (const [i, it] of parsed.items.entries()) {
      await tools.create(
        'items',
        { roomId, order: i + 1, prompt: it.prompt, output: it.output, goldLabel: '', revealedTo: [] },
        `${roomId}_i${String(i + 1).padStart(3, '0')}`,
      )
    }
    await refreshStats(tools, roomId)
    return ok({ roomId, items: parsed.items.length })
  },

  /** Anyone with the invite link joins as a rater. Idempotent; never demotes the owner. */
  joinRoom: async ({ userId, params, tools }) => {
    const room = await get<Room>(tools, 'rooms', params.roomId)
    if (!room) return fail('Room not found')
    const id = memberId(room.recordId, userId)
    const existing = await get<Member>(tools, 'team_members', id)
    if (existing?.data.status === 'active') return ok({ joined: false })
    const name = await displayName(tools, userId)
    const r = await tools.create(
      'team_members',
      { teamId: room.recordId, userId, status: 'active', role: existing?.data.role ?? 'rater', name },
      id,
    )
    if (!r.success) return r
    await refreshStats(tools, room.recordId)
    return ok({ joined: true })
  },

  /**
   * Submit a blind label. Final once submitted: after submitting, the rater can
   * see the others' labels, so a change would no longer be independent.
   */
  submitLabel: async ({ userId, params, tools }) => {
    const item = await itemInRoom(tools, params.itemId)
    if (!item) return fail('Item not found')
    const auth = await requireMember(tools, userId, item.data.roomId)
    if (auth.error) return auth.error
    const value = typeof params.value === 'string' ? params.value : ''
    if (!auth.room.data.labelOptions.includes(value)) return fail('That label is not in this room’s rubric')
    if ((item.data.revealedTo ?? []).includes(userId)) {
      return fail('You revealed this item to adjudicate it, so your label would not be blind')
    }

    const id = labelId(item.recordId, userId)
    const existing = await get<Label>(tools, 'labels', id)
    if (existing) {
      if (existing.data.value === value) return ok({ labelId: id, unchanged: true }) // retry / double-click
      return fail('Labels are final once submitted')
    }
    const r = await tools.create(
      'labels',
      { roomId: item.data.roomId, itemId: item.recordId, raterId: userId, value, source: 'human', canSee: [] },
      id,
    )
    if (!r.success) {
      // uniqueOn(itemId, raterId) refusal from a concurrent duplicate is a success for the caller.
      const again = await get<Label>(tools, 'labels', id)
      if (again?.data.value === value) return ok({ labelId: id, unchanged: true })
      return r
    }
    await syncItemVisibility(tools, item)
    await refreshStats(tools, item.data.roomId)
    return ok({ labelId: id })
  },

  /** Owner reveals an item's labels to adjudicate a split. They can no longer label it blind. */
  revealItem: async ({ userId, params, tools }) => {
    const item = await itemInRoom(tools, params.itemId)
    if (!item) return fail('Item not found')
    const auth = await requireOwner(tools, userId, item.data.roomId)
    if (auth.error) return auth.error
    const revealedTo = [...new Set([...(item.data.revealedTo ?? []), userId])]
    await tools.update('items', item.recordId, { revealedTo })
    await syncItemVisibility(tools, { ...item, data: { ...item.data, revealedTo } })
    return ok({ revealed: true })
  },

  /** Owner sets (or clears with '') the gold label. */
  setGold: async ({ userId, params, tools }) => {
    const item = await itemInRoom(tools, params.itemId)
    if (!item) return fail('Item not found')
    const auth = await requireOwner(tools, userId, item.data.roomId)
    if (auth.error) return auth.error
    const value = typeof params.value === 'string' ? params.value : ''
    if (value && !auth.room.data.labelOptions.includes(value)) return fail('That label is not in this room’s rubric')
    const r = await tools.update('items', item.recordId, { goldLabel: value })
    if (!r.success) return r
    await refreshStats(tools, item.data.roomId)
    return r
  },

  /** Discussion on an item — only for people who can already see its labels. */
  addComment: async ({ userId, params, tools }) => {
    const item = await itemInRoom(tools, params.itemId)
    if (!item) return fail('Item not found')
    const auth = await requireMember(tools, userId, item.data.roomId)
    if (auth.error) return auth.error
    const body = cleanText(params.body, LIMITS.commentMax)
    if (!body) return fail('Write something first')
    const hasLabeled = !!(await get<Label>(tools, 'labels', labelId(item.recordId, userId)))
    const revealed = (item.data.revealedTo ?? []).includes(userId)
    if (!hasLabeled && !revealed) return fail('Label this item before discussing it')
    const r = await tools.create('comments', {
      roomId: item.data.roomId,
      itemId: item.recordId,
      authorId: userId,
      authorName: auth.member.data.name ?? (await displayName(tools, userId)),
      body,
      canSee: [],
    })
    if (!r.success) return r
    await syncItemVisibility(tools, item)
    return r
  },

  /**
   * Owner runs the AI judge over every item with the room's rubric. Labels are
   * validated against labelOptions; off-rubric or malformed answers are counted
   * as rejected and never stored. Owner-billed; cooldown per room.
   */
  runJudge: async ({ userId, params, tools }) => {
    const auth = await requireOwner(tools, userId, params.roomId)
    if (auth.error) return auth.error
    const room = auth.room
    const last = room.data.judgeRunAt ? Date.parse(room.data.judgeRunAt) : 0
    const wait = Math.ceil((last + LIMITS.judgeCooldownSec * 1000 - Date.now()) / 1000)
    if (wait > 0) return fail(`The judge just ran — try again in ${wait}s`)
    await tools.update('rooms', room.recordId, {
      judgeStatus: 'running',
      judgeRunAt: new Date().toISOString(),
      judgeModel: JUDGE_MODEL,
    })

    const items = (await query<Item>(tools, 'items', { roomId: room.recordId }))
      .sort((a, b) => a.data.order - b.data.order)
      .slice(0, LIMITS.maxItems)
    let stored = 0
    let rejected = 0
    let failedCalls = 0
    for (let i = 0; i < items.length; i += LIMITS.judgeBatch) {
      const batch = items.slice(i, i + LIMITS.judgeBatch)
      const prompt = buildJudgePrompt(room.data, batch.map((it) => ({ id: it.recordId, ...it.data })))
      const r = await tools.integration('anthropic/chat-completion', {
        model: JUDGE_MODEL,
        max_tokens: 1500,
        temperature: 0,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      })
      if (!r.success) {
        failedCalls++
        rejected += batch.length
        console.warn(`[judge] batch ${i / LIMITS.judgeBatch} failed: ${r.error}`)
        continue
      }
      const parsed = parseJudgeReply(extractText(r), new Set(batch.map((b) => b.recordId)), room.data.labelOptions)
      rejected += parsed.rejected
      for (const rating of parsed.ratings) {
        const item = batch.find((b) => b.recordId === rating.id)!
        await tools.create(
          'labels',
          {
            roomId: room.recordId,
            itemId: item.recordId,
            raterId: JUDGE_RATER_ID,
            value: rating.label,
            source: 'judge',
            rationale: rating.why,
            canSee: [],
          },
          labelId(item.recordId, JUDGE_RATER_ID),
        )
        await syncItemVisibility(tools, item)
        stored++
      }
    }
    const judgeStatus =
      failedCalls === Math.ceil(items.length / LIMITS.judgeBatch)
        ? 'failed'
        : `rated ${stored}/${items.length}${rejected ? ` · ${rejected} rejected` : ''}`
    await tools.update('rooms', room.recordId, { judgeStatus })
    await refreshStats(tools, room.recordId)
    return ok({ stored, rejected, failedCalls })
  },
}
