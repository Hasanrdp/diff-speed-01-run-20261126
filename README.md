[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/Hasanrdp/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/Hasanrdp/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

# A faster drop-in for makefun-diff 1.0.0

A faster drop-in for make.fun's own makefun-diff 1.0.0, for the
[make.fun diff-speed-01-run-20261126 competition](https://make.fun/bounty/diff-speed-01-run-20261126).
`solve.js` answers every case exactly as makefun-diff 1.0.0 does — same line
split, same Myers greedy search with the same tie-break (the deletion when a
deletion and an insertion reach the same point), same patch text — and does
it with as little CPU time as possible.

## How it is faster

- **Lines interned once.** Every distinct line becomes one small integer, so
  the search compares integers in typed arrays instead of strings, and the
  patch is rebuilt from the interned line texts.
- **The search keeps only furthest counts.** Myers's search stores one
  furthest old-line count per diagonal in flat `Int32Array`s — no path
  objects, no linked lists — and the script is rebuilt by walking that
  trace back, re-deciding each step exactly as the forward search did.
- **Only diagonals that can still reach the end are visited.** A cheap
  greedy script gives an upper bound on the edit distance, and any diagonal
  further than the remaining budget from the end diagonal cannot lie on a
  shortest script, so it is skipped. The bound is only a pruning aid: a
  bound that ever proved too small falls back to the unbanded search, so
  the answer never depends on the greedy script being tight.

Everything is deterministic: no network, no clock, no randomness, no file
access, and nothing is carried from one case to the next — every call
interns and searches fresh.

## Layout

- `solve.js` — the entry: `run(input)` returns makefun-diff's patch.
- `main.ts` — the program the harness runs: reads `/input/cases.json`,
  answers each case with `run`, writes `/output/answers.json`.

## License

MIT — see `LICENSE`.
