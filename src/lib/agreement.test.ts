import { describe, expect, it } from 'vitest'
import {
  band,
  cohensKappa,
  formatKappa,
  kappaVsGold,
  pairwiseKappa,
  progress,
  splitItems,
  type LabelRow,
  type Ratings,
} from './agreement'

/** Build two raters' Ratings from a 2x2 contingency table (yes/no). */
function fromTable(yy: number, yn: number, ny: number, nn: number): [Ratings, Ratings] {
  const a: Ratings = new Map()
  const b: Ratings = new Map()
  let i = 0
  const add = (count: number, la: string, lb: string) => {
    for (let k = 0; k < count; k++, i++) {
      a.set(`i${i}`, la)
      b.set(`i${i}`, lb)
    }
  }
  add(yy, 'yes', 'yes')
  add(yn, 'yes', 'no')
  add(ny, 'no', 'yes')
  add(nn, 'no', 'no')
  return [a, b]
}

function expectKappa(r: ReturnType<typeof cohensKappa>, kappa: number) {
  expect(r.kind).toBe('ok')
  if (r.kind === 'ok') expect(r.kappa).toBeCloseTo(kappa, 4)
}

describe("Cohen's kappa — worked examples", () => {
  it('20/5/10/15 → p_o .70, p_e .50, κ .40', () => {
    const r = cohensKappa(...fromTable(20, 5, 10, 15))
    expectKappa(r, 0.4)
    if (r.kind === 'ok') {
      expect(r.observed).toBeCloseTo(0.7, 6)
      expect(r.expected).toBeCloseTo(0.5, 6)
    }
  })

  it('same % agreement, different κ (why not plain % agreement)', () => {
    // Both tables agree on 60/100 items.
    expectKappa(cohensKappa(...fromTable(45, 15, 25, 15)), 0.06 / 0.46) // ≈ 0.1304
    expectKappa(cohensKappa(...fromTable(25, 35, 5, 35)), 0.14 / 0.54) // ≈ 0.2593
  })

  it('perfect agreement with variation → 1', () => {
    expectKappa(cohensKappa(...fromTable(3, 0, 0, 3)), 1)
  })

  it('negative κ is reported, not clamped', () => {
    const r = cohensKappa(...fromTable(0, 3, 3, 0))
    expectKappa(r, -1)
    expect(band(-1)).toBe('below chance')
  })

  it('three labels', () => {
    // A: y y p n n ; B: y p p n y  -> p_o = 3/5
    const a: Ratings = new Map([['1', 'y'], ['2', 'y'], ['3', 'p'], ['4', 'n'], ['5', 'n']])
    const b: Ratings = new Map([['1', 'y'], ['2', 'p'], ['3', 'p'], ['4', 'n'], ['5', 'y']])
    // pA: y .4 p .2 n .4 ; pB: y .4 p .4 n .2 -> p_e = .16 + .08 + .08 = .32
    expectKappa(cohensKappa(a, b), (0.6 - 0.32) / (1 - 0.32))
  })
})

describe("Cohen's kappa — edge cases", () => {
  it('fewer than 5 shared items → insufficient', () => {
    const r = cohensKappa(...fromTable(2, 1, 1, 0))
    expect(r).toEqual({ kind: 'insufficient', n: 4 })
    expect(formatKappa(r)).toBe('not enough overlap (4/5)')
  })

  it('only counts shared items', () => {
    const [a, b] = fromTable(20, 5, 10, 15)
    a.set('extra-a', 'yes')
    b.set('extra-b', 'no')
    const r = cohensKappa(a, b)
    expect(r.kind === 'ok' && r.n).toBe(50)
  })

  it('p_e = 1 (both used one label for everything) → no variation', () => {
    const r = cohensKappa(...fromTable(6, 0, 0, 0))
    expect(r.kind).toBe('no-variation')
    expect(formatKappa(r)).toBe('no variation')
  })

  it('bands', () => {
    expect(band(0.39)).toBe('weak')
    expect(band(0.4)).toBe('moderate')
    expect(band(0.6)).toBe('substantial')
    expect(band(0.81)).toBe('strong')
  })
})

describe('room helpers', () => {
  const rows: LabelRow[] = [
    { itemId: 'x', raterId: 'ana', value: 'Yes', source: 'human' },
    { itemId: 'x', raterId: 'ben', value: 'No', source: 'human' },
    { itemId: 'y', raterId: 'ana', value: 'Yes', source: 'human' },
    { itemId: 'y', raterId: 'ben', value: 'Yes', source: 'human' },
    { itemId: 'z', raterId: 'ana', value: 'No', source: 'human' },
    { itemId: 'x', raterId: 'owner', value: 'No', source: 'judge' },
  ]

  it('split items need ≥2 humans who disagree; judge is ignored', () => {
    expect(splitItems(rows)).toEqual(['x'])
  })

  it('progress per human rater', () => {
    const p = progress(rows, 4)
    expect(p.get('ana')).toBe(0.75)
    expect(p.get('ben')).toBe(0.5)
    expect(p.has('judge')).toBe(false)
  })

  it('pairwise only over humans', () => {
    const pairs = pairwiseKappa(rows)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ a: 'ana', b: 'ben', result: { kind: 'insufficient', n: 2 } })
  })

  it('judge vs gold', () => {
    const [judge, gold] = fromTable(4, 1, 0, 3)
    expectKappa(kappaVsGold(judge, gold), (7 / 8 - (5 / 8) * (4 / 8) - (3 / 8) * (4 / 8)) / (1 - (5 / 8) * (4 / 8) - (3 / 8) * (4 / 8)))
    expect(kappaVsGold(undefined, gold).kind).toBe('insufficient')
  })
})

import { computeRoomStats } from './stats'

describe('computeRoomStats', () => {
  it('aggregates without exposing label values', () => {
    const items = ['1', '2', '3', '4', '5', '6'].map((id) => ({ id, goldLabel: id === '6' ? '' : 'Yes' }))
    const rows: LabelRow[] = []
    for (const it of items) {
      rows.push({ itemId: it.id, raterId: 'ana', value: 'Yes', source: 'human' })
      rows.push({ itemId: it.id, raterId: 'ben', value: it.id === '2' ? 'No' : 'Yes', source: 'human' })
      rows.push({ itemId: it.id, raterId: 'judge', value: 'Yes', source: 'judge' })
    }
    const s = computeRoomStats(rows, items, ['ana', 'ben', 'cat'], 'T')
    expect(s.progress).toEqual({ ana: 1, ben: 1, cat: 0 })
    expect(s.splits).toEqual(['2'])
    expect(s.labeledBy['2']).toBe(2)
    expect(s.goldCount).toBe(5)
    // ana used one label for every item, gold too -> no variation
    expect(s.vsGold.ana.kind).toBe('no-variation')
    expect(s.judgeCount).toBe(6)
    expect(JSON.stringify(s)).not.toContain('"No"')
  })
})
