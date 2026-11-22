/**
 * Agreement statistics for LabelRoom.
 *
 * Pure TypeScript, no DeepSpace imports: shared by the UI (live stats panel)
 * and unit tests. Stats are always derived from label rows, never stored.
 *
 * Cohen's kappa for two raters over the items both labeled:
 *   kappa = (p_o - p_e) / (1 - p_e)
 *   p_o = share of shared items where the two agree
 *   p_e = sum over labels k of pA(k) * pB(k)   (agreement expected by chance)
 */

export const MIN_OVERLAP = 5

export type KappaResult =
  | { kind: 'ok'; kappa: number; n: number; observed: number; expected: number }
  | { kind: 'insufficient'; n: number }
  | { kind: 'no-variation'; n: number }

/** itemId -> label value */
export type Ratings = Map<string, string>

export function cohensKappa(a: Ratings, b: Ratings, minOverlap: number = MIN_OVERLAP): KappaResult {
  const shared: string[] = []
  for (const itemId of a.keys()) if (b.has(itemId)) shared.push(itemId)
  const n = shared.length
  if (n < minOverlap) return { kind: 'insufficient', n }

  let agree = 0
  const countA = new Map<string, number>()
  const countB = new Map<string, number>()
  for (const id of shared) {
    const la = a.get(id)!
    const lb = b.get(id)!
    if (la === lb) agree++
    countA.set(la, (countA.get(la) ?? 0) + 1)
    countB.set(lb, (countB.get(lb) ?? 0) + 1)
  }
  const observed = agree / n
  let expected = 0
  for (const [label, ca] of countA) expected += (ca / n) * ((countB.get(label) ?? 0) / n)

  // Both raters used a single (identical) label for everything: chance agreement
  // is 1 and kappa is 0/0. Report it rather than dividing by zero.
  if (1 - expected < 1e-12) return { kind: 'no-variation', n }
  // Negative kappa (worse than chance) is meaningful — never clamp it.
  return { kind: 'ok', kappa: (observed - expected) / (1 - expected), n, observed, expected }
}

/**
 * Plain-language band. These cutoffs are common conventions (in the spirit of
 * Landis & Koch), not laws — the UI says so.
 */
export function band(kappa: number): 'below chance' | 'weak' | 'moderate' | 'substantial' | 'strong' {
  if (kappa < 0) return 'below chance'
  if (kappa < 0.4) return 'weak'
  if (kappa < 0.6) return 'moderate'
  if (kappa < 0.8) return 'substantial'
  return 'strong'
}

export function formatKappa(r: KappaResult): string {
  if (r.kind === 'insufficient') return `not enough overlap (${r.n}/${MIN_OVERLAP})`
  if (r.kind === 'no-variation') return 'no variation'
  return r.kappa.toFixed(2)
}

// ---------------------------------------------------------------------------
// Room-level helpers over label rows
// ---------------------------------------------------------------------------

export interface LabelRow {
  itemId: string
  raterId: string
  value: string
  source: 'human' | 'judge'
}

export const JUDGE_ID = 'judge'

/** raterId -> Ratings, humans only (judge rows are keyed under JUDGE_ID separately). */
export function ratingsByRater(rows: LabelRow[]): Map<string, Ratings> {
  const out = new Map<string, Ratings>()
  for (const r of rows) {
    const key = r.source === 'judge' ? JUDGE_ID : r.raterId
    if (!out.has(key)) out.set(key, new Map())
    out.get(key)!.set(r.itemId, r.value)
  }
  return out
}

export interface PairStat {
  a: string
  b: string
  result: KappaResult
}

/** Cohen's kappa for every pair of human raters (stable order). */
export function pairwiseKappa(rows: LabelRow[]): PairStat[] {
  const byRater = ratingsByRater(rows.filter((r) => r.source === 'human'))
  const raters = [...byRater.keys()].sort()
  const out: PairStat[] = []
  for (let i = 0; i < raters.length; i++) {
    for (let j = i + 1; j < raters.length; j++) {
      out.push({ a: raters[i], b: raters[j], result: cohensKappa(byRater.get(raters[i])!, byRater.get(raters[j])!) })
    }
  }
  return out
}

/** Items where at least two humans labeled it and they did not all pick the same label. */
export function splitItems(rows: LabelRow[]): string[] {
  const byItem = new Map<string, Set<string>>()
  const counts = new Map<string, number>()
  for (const r of rows) {
    if (r.source !== 'human') continue
    if (!byItem.has(r.itemId)) byItem.set(r.itemId, new Set())
    byItem.get(r.itemId)!.add(r.value)
    counts.set(r.itemId, (counts.get(r.itemId) ?? 0) + 1)
  }
  return [...byItem.entries()]
    .filter(([id, values]) => (counts.get(id) ?? 0) >= 2 && values.size > 1)
    .map(([id]) => id)
}

/** Share of items each human rater has labeled (0..1). */
export function progress(rows: LabelRow[], itemCount: number): Map<string, number> {
  const byRater = ratingsByRater(rows.filter((r) => r.source === 'human'))
  const out = new Map<string, number>()
  for (const [rater, ratings] of byRater) out.set(rater, itemCount ? ratings.size / itemCount : 0)
  return out
}

/** Kappa of the AI judge (or any rater) against the gold labels. */
export function kappaVsGold(ratings: Ratings | undefined, gold: Ratings): KappaResult {
  return cohensKappa(ratings ?? new Map(), gold)
}
