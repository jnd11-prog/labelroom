/**
 * LabelRoom collections.
 *
 * Reads are enforced by the RecordRoom (Durable Object) before anything is sent
 * over the WebSocket. Writes go only through server actions (src/actions), so
 * every collection here is `create/update/delete: false` for client roles.
 *
 * Room scoping uses the SDK's built-in 'team' level: a user can read a row whose
 * `roomId` (teamField) matches a `team_members` row { teamId: roomId, userId, status: 'active' }.
 *
 * Blind rating uses 'shared': a label is readable by its rater (ownerField) and by
 * the users listed in `canSee` — the raters who have already labeled that item,
 * plus anyone the room owner revealed the item to for adjudication.
 */

import type { CollectionSchema } from 'deepspace/schema'

const NO_CLIENT_WRITES = { create: false, update: false, delete: false } as const

export const teamMembersSchema: CollectionSchema = {
  name: 'team_members',
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'status', storage: 'text', interpretation: 'plain' },
    { name: 'role', storage: 'text', interpretation: { kind: 'select', options: ['owner', 'rater'] } },
    { name: 'name', storage: 'text', interpretation: 'plain' },
  ],
  teamField: 'teamId',
  ownerField: 'userId',
  uniqueOn: ['teamId', 'userId'],
  permissions: {
    viewer: { read: 'team', ...NO_CLIENT_WRITES },
    member: { read: 'team', ...NO_CLIENT_WRITES },
    admin: { read: 'team', ...NO_CLIENT_WRITES },
  },
}

export const roomsSchema: CollectionSchema = {
  name: 'rooms',
  columns: [
    /** Equals the record's own id, so 'team' can scope the room row itself. */
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    { name: 'rubric', storage: 'text', interpretation: 'plain' },
    { name: 'labelOptions', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'ownerId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'itemCount', storage: 'number', interpretation: 'plain' },
    { name: 'judgeStatus', storage: 'text', interpretation: 'plain' },
    { name: 'judgeModel', storage: 'text', interpretation: 'plain' },
    { name: 'judgeRunAt', storage: 'text', interpretation: 'plain' },
  ],
  teamField: 'roomId',
  permissions: {
    viewer: { read: 'team', ...NO_CLIENT_WRITES },
    member: { read: 'team', ...NO_CLIENT_WRITES },
    admin: { read: 'team', ...NO_CLIENT_WRITES },
  },
}

export const itemsSchema: CollectionSchema = {
  name: 'items',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'order', storage: 'number', interpretation: 'plain' },
    { name: 'prompt', storage: 'text', interpretation: 'plain' },
    { name: 'output', storage: 'text', interpretation: 'plain', required: true },
    { name: 'goldLabel', storage: 'text', interpretation: 'plain' },
    /** Users the owner revealed this item's labels to (adjudication). They can no longer rate it. */
    { name: 'revealedTo', storage: 'text', interpretation: { kind: 'json' } },
  ],
  teamField: 'roomId',
  permissions: {
    viewer: { read: 'team', ...NO_CLIENT_WRITES },
    member: { read: 'team', ...NO_CLIENT_WRITES },
    admin: { read: 'team', ...NO_CLIENT_WRITES },
  },
}

export const labelsSchema: CollectionSchema = {
  name: 'labels',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'itemId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    /** A user id for humans; the literal 'judge' for the AI judge. */
    { name: 'raterId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'value', storage: 'text', interpretation: 'plain', required: true },
    { name: 'source', storage: 'text', interpretation: { kind: 'select', options: ['human', 'judge'] } },
    /** Who else may read this label (see file header). */
    { name: 'canSee', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'rationale', storage: 'text', interpretation: 'plain' },
  ],
  ownerField: 'raterId',
  collaboratorsField: 'canSee',
  uniqueOn: ['itemId', 'raterId'],
  permissions: {
    viewer: { read: 'shared', ...NO_CLIENT_WRITES },
    member: { read: 'shared', ...NO_CLIENT_WRITES },
    admin: { read: 'shared', ...NO_CLIENT_WRITES },
  },
}

export const commentsSchema: CollectionSchema = {
  name: 'comments',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'itemId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'authorId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'authorName', storage: 'text', interpretation: 'plain' },
    { name: 'body', storage: 'text', interpretation: 'plain', required: true },
    /**
     * Same blind rule as labels: discussing a split item reveals how people
     * labeled it, so a comment is readable only by those who already labeled
     * (or were revealed) that item.
     */
    { name: 'canSee', storage: 'text', interpretation: { kind: 'json' } },
  ],
  ownerField: 'authorId',
  collaboratorsField: 'canSee',
  permissions: {
    viewer: { read: 'shared', ...NO_CLIENT_WRITES },
    member: { read: 'shared', ...NO_CLIENT_WRITES },
    admin: { read: 'shared', ...NO_CLIENT_WRITES },
  },
}

/**
 * Derived, room-readable aggregates (kappa, progress, split ids), recomputed by
 * the worker after every write. A cache of `labels`, never the source of truth.
 */
export const roomStatsSchema: CollectionSchema = {
  name: 'room_stats',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'stats', storage: 'text', interpretation: { kind: 'json' } },
  ],
  teamField: 'roomId',
  permissions: {
    viewer: { read: 'team', ...NO_CLIENT_WRITES },
    member: { read: 'team', ...NO_CLIENT_WRITES },
    admin: { read: 'team', ...NO_CLIENT_WRITES },
  },
}
