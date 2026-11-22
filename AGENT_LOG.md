# Agent log

One row per meaningful agent session. Rows below were drafted by the agent. Edit the "What I checked / changed"
column with what you actually did.

| Date | What I asked the agent | What it produced | What I checked / changed |
|---|---|---|---|
| Nov 20 | Research DeepSpace (docs, skill, example repos) and propose an idea | Docs + SDK reading; first idea (office-hours queue) built and then discarded | Rejected the idea, wrote my own LabelRoom spec |
| Nov 22 | Implement the spec: κ module + tests first | `src/lib/agreement.ts`, 13 tests (textbook 2×2, same-%-different-κ, 3-label, edge cases) | _Check κ values by hand_ |
| Nov 22 | Answer the open question: can permissions express blind rating? | Read the SDK `canRead`/`broadcastChange` source: `'shared'` + a server-maintained `canSee` works, and broadcasts re-check per subscriber | _Verify live with two browsers + raw WS_ |
| Nov 22 | Schemas, server actions, room UI | 6 collections, 7 actions, room page (rating card, stats, splits, presence, judge) | _Review action auth checks_ |
| Nov 22 | — | Agent caught its own design leaks: (1) comments on split items would reveal labels → made comments blind too; (2) per-browser κ would be wrong under blindness → server-computed `room_stats`; (3) owner who sees all labels isn't blind → explicit "reveal to adjudicate" that blocks the owner's label | _Decide if you agree with each rule_ |
| Nov 22 | — | Noticed the SDK's `notifyTeamMembershipChange` reads `record.data.UserId` (capital U), so a new member's socket may not resubscribe → join reloads the page | _Confirm on the live app_ |
