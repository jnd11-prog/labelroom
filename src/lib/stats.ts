/**
 * Room-level stats snapshot, computed in the worker after every write and
 * stored as one `room_stats` row per room.
 *
 * Why not compute in the browser? Blind rating means each viewer only receives
 * the labels on items they've already labeled, so client-side kappa would be
 * different (and wrong) for every viewer. The worker sees all labels and
 * publishes only aggregates — no individual label values leave it this way.
 */

import { JUDGE_ID, cohensKappa, pairwiseKappa, progress, splitItems, type KappaResult, type LabelRow, type Ratings } from './agreement'

export interface RoomStats {
  itemCount: number
  /** raterId -> share of items labeled (0..1); includes members with no labels yet. */
  progress: Record<string, number>
  /** raterId -> number of items labeled */
  counts: Record<string, number>
  pairs: { a: string; b: string; result: KappaResult }[]
  /** Item ids where humans disagree. */
  splits: string[]
  /** Number of humans who labeled each item. */
  labeledBy: Record<string, number>
  goldCount: number
  /** kappa of each rater (and 'judge') against the gold labels. */
  vsGold: Record<string, KappaResult>
  /** kappa of the judge against each human. */
  judgeVsHuman: Record<string, KappaResult>
  judgeCount: number
  updatedAt: string
}

export function computeRoomStats(
  rows: LabelRow[],
  items: { id: string; goldLabel?: string }[],
  memberIds: string[],
  now: string = new Date().toISOString(),
): RoomStats {
  const itemIds = new Set(items.map((i) => i.id))
  const live = rows.filter((r) => itemIds.has(r.itemId))
  const humans = live.filter((r) => r.source === 'human')
  const judgeRows = live.filter((r) => r.source === 'judge')

  const prog = progress(humans, items.length)
  const counts: Record<string, number> = {}
  const progressOut: Record<string, number> = {}
  for (const m of memberIds) {
    progressOut[m] = 0
    counts[m] = 0
  }
  for (const [rater, share] of prog) progressOut[rater] = share
  for (const r of humans) counts[r.raterId] = (counts[r.raterId] ?? 0) + 1

  const labeledBy: Record<string, number> = {}
  for (const r of humans) labeledBy[r.itemId] = (labeledBy[r.itemId] ?? 0) + 1

  const gold: Ratings = new Map()
  for (const i of items) if (i.goldLabel) gold.set(i.id, i.goldLabel)

  const byRater = new Map<string, Ratings>()
  for (const r of live) {
    const key = r.source === 'judge' ? JUDGE_ID : r.raterId
    if (!byRater.has(key)) byRater.set(key, new Map())
    byRater.get(key)!.set(r.itemId, r.value)
  }

  const vsGold: Record<string, KappaResult> = {}
  for (const [rater, ratings] of byRater) vsGold[rater] = cohensKappa(ratings, gold)

  const judgeVsHuman: Record<string, KappaResult> = {}
  const judge = byRater.get(JUDGE_ID)
  if (judge) {
    for (const [rater, ratings] of byRater) if (rater !== JUDGE_ID) judgeVsHuman[rater] = cohensKappa(judge, ratings)
  }

  return {
    itemCount: items.length,
    progress: progressOut,
    counts,
    pairs: pairwiseKappa(humans),
    splits: splitItems(humans),
    labeledBy,
    goldCount: gold.size,
    vsGold,
    judgeVsHuman,
    judgeCount: judgeRows.length,
    updatedAt: now,
  }
}
