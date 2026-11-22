import { describe, expect, it } from 'vitest'
import { createRoomInput, extractText, parseItems, parseJudgeReply } from './room'

describe('parseItems', () => {
  it('parses --- blocks with Prompt/Output', () => {
    const r = parseItems('Prompt: 2+2?\nOutput: 4\n---\nPrompt: capital of France\nOutput: Paris,\nobviously.\n---\njust an output')
    expect(r.error).toBeUndefined()
    expect(r.items).toEqual([
      { prompt: '2+2?', output: '4' },
      { prompt: 'capital of France', output: 'Paris,\nobviously.' },
      { prompt: '', output: 'just an output' },
    ])
  })

  it('parses a JSON array with alternate keys', () => {
    const r = parseItems('[{"input":"a","output":"b"},{"question":"c","answer":"d"}]')
    expect(r.items).toEqual([
      { prompt: 'a', output: 'b' },
      { prompt: 'c', output: 'd' },
    ])
  })

  it('rejects too few / bad JSON', () => {
    expect(parseItems('Output: only one').error).toMatch(/at least 2/)
    expect(parseItems('[{').error).toMatch(/does not parse/)
  })
})

describe('createRoomInput', () => {
  it('requires 2–4 distinct labels', () => {
    expect(createRoomInput.safeParse({ name: 'x', labelOptions: ['Yes'], itemsText: '' }).success).toBe(false)
    expect(createRoomInput.safeParse({ name: 'x', labelOptions: ['Yes', 'yes'], itemsText: '' }).success).toBe(false)
    expect(createRoomInput.safeParse({ name: 'x', labelOptions: ['Yes', 'Partly', 'No'], itemsText: '' }).success).toBe(true)
  })
})

describe('parseJudgeReply', () => {
  const ids = new Set(['a', 'b', 'c'])
  const opts = ['Yes', 'Partly', 'No']

  it('keeps valid ratings and rejects off-rubric, unknown and duplicate ones', () => {
    const text =
      'Here you go:\n{"ratings":[{"id":"a","label":"Yes"},{"id":"b","label":"Maybe"},{"id":"zzz","label":"No"},{"id":"a","label":"No"}]}'
    const r = parseJudgeReply(text, ids, opts)
    expect(r.ratings).toEqual([{ id: 'a', label: 'Yes', why: '' }])
    expect(r.rejected).toBe(2)
  })

  it('rejects everything on malformed output', () => {
    expect(parseJudgeReply('no json', ids, opts)).toEqual({ ratings: [], rejected: 3 })
    expect(parseJudgeReply('{"ratings":"x"}', ids, opts)).toEqual({ ratings: [], rejected: 3 })
  })

  it('extracts text from Messages API shapes', () => {
    expect(extractText({ content: [{ type: 'text', text: 'hi' }] })).toBe('hi')
    expect(extractText({ success: true, data: { content: [{ type: 'text', text: 'yo' }] } })).toBe('yo')
  })
})
