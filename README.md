# LabelRoom

**Live:** https://labelroom.app.space

A live room where a small team grades LLM outputs **blind** and sees, as they go, whether they actually agree.
Each rater scores the same outputs without seeing anyone else's label for an item until they've submitted their own.
The room shows Cohen's κ for every pair of raters, flags items where the humans split, and gives each split a
discussion thread. The owner then sets a gold label. An AI judge rates every item with the same rubric, and its
κ against gold appears next to the human pairs.

**Demo path:** owner creates a room ("Use sample items") → copies the invite link → a second user (another browser)
joins → both rate five items → κ and the split list update in both windows → open a split item, discuss, set gold →
Run judge → compare judge-vs-gold with the human pairs.

## DeepSpace integrations

| Primitive | Used for | Where |
|---|---|---|
| Auth | Sign-in. κ is per rater, so every label belongs to a real user | `(protected)` routes, verified JWT in actions |
| Data storage + real-time sync | Items, labels, comments and stats stream to every client | `useQuery` in `src/pages/(app)/(protected)/r/[id].tsx` |
| Permissions (RBAC) | Room scoping (`'team'` + `team_members`) and **blind rating** (`'shared'` + `canSee`) | `src/schemas/labelroom-schemas.ts` |
| Server actions | The only write path: validation, owner checks, visibility sync, stats | `src/actions/index.ts` |
| Presence | Who's in the room and which item they're on | `usePresenceRoom` in the room page |
| Integrations: `anthropic/chat-completion` | The AI judge (Claude Haiku 5.5), run in the worker, owner-billed | `runJudge` |

**Left out on purpose:**
- **Messaging:** the docs say bundled messaging supports *public channels only*. Split-item threads would leak labels to raters who haven't labeled yet, so threads are a `comments` collection with the same blind rule as labels.
- **Payments:** nothing to sell in a small-team eval tool.
- **Yjs / collaborative editing:** labels are single choices, not shared text.
- **Scheduled jobs:** stats are recomputed on every write. A nightly judge re-run would be a next step.
- **File uploads:** paste-in (block format or JSON) covers the demo. CSV upload is a stretch goal.

## How blind rating is enforced (server-side, not just UI)

The spec's open question was whether DeepSpace permissions can express "you may read others' labels on an item only
after labeling it yourself." They can, with one server-maintained field.

- `labels` uses `ownerField: 'raterId'` and `collaboratorsField: 'canSee'`, with `read: 'shared'`. A rater always
  reads their own label, and reads someone else's only if they're listed in that label's `canSee`.
- After every write on an item, the worker recomputes `canSee` for every label and comment on that item. The value
  is everyone who has labeled that item, plus anyone the owner revealed it to (`syncItemVisibility`).
- The RecordRoom checks `canRead` per subscriber before broadcasting. When `canSee` gains rater B, B's open
  subscription receives the other labels live, without a refresh.

Consequences, each a deliberate rule:
- **Labels are final once submitted.** After submitting you can see the others, so a changed label would no longer
  be independent. Resubmitting the same value is a no-op, which makes double-clicks and retries safe; the label id is
  deterministic (`itemId__raterId`) and `uniqueOn` backs that up.
- **Owner adjudication is explicit.** The owner sees labels only on items they labeled, or ones they chose to
  "Reveal to adjudicate". Revealing permanently blocks the owner from labeling that item.
- **Stats are computed by the worker, not the browser.** Each client only receives the labels it may see, so
  κ computed in the browser would differ by viewer. After each write the worker recomputes aggregates over all
  labels (`src/lib/stats.ts`) and stores them in one `room_stats` row per room. The row holds κ, progress and split
  ids, never individual label values. It's a cache of `labels`, not the source of truth.
- Clients have `create/update/delete: false` on every collection, so all writes go through server actions.

## Agreement math

`src/lib/agreement.ts` is pure TypeScript with no SDK imports. κ = (p_o − p_e)/(1 − p_e), computed over the items
both raters labeled.
- Fewer than 5 shared items → "not enough overlap".
- p_e = 1 → "no variation".
- Negative κ is shown, not clamped.
- The bands (<0.4 weak, 0.4–0.6 moderate, 0.6–0.8 substantial, >0.8 strong) are conventions, and the UI says so.

Tests (`src/lib/*.test.ts`, 21 cases) cover the textbook 2×2 example (p_o .70, p_e .50 → κ .40), two tables with the
same 60% agreement but κ .13 vs .26 (why κ rather than plain %), a 3-label case worked by hand, and every edge case.

## Main tradeoff

**Depth on one live, multi-user loop (blind rate → live κ → resolve → judge) over breadth.** The cost of
server-enforced blindness is that every write is a round-trip through a server action, and each action must do its
own authorization because actions run with RBAC off. I accepted that because a blind-rating tool that only hides
labels in the UI would be meaningless.

Cut: CSV upload, Fleiss' κ, bootstrap confidence intervals, export, label history, multiple rubrics per room.

## What the agent did / what I verified

_(Draft. See the agent log in `AGENT_LOG.md`. Fill in your own checks before submitting.)_

## Unfinished / next steps

- Fleiss' κ for 3+ raters, and a bootstrap CI per pair, so a small sample doesn't look certain.
- CSV upload and results export.
- The invite link is the capability: anyone holding it can join as a rater. A per-room join code or owner approval would come next.

## Run it

```bash
npm install
npx deepspace auth login
npx deepspace app init --json   # first time: registers the app id
npx deepspace dev start
npx deepspace deploy
```

Unit tests: `npx vitest run src/lib`.
