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

- **Lines split and interned once.** The native `split('\n')` cuts each
  text into lines and every distinct line becomes one small integer, so the
  search compares integers in typed arrays instead of strings. A bare last
  line (no trailing newline) carries a sentinel key so it never equals a
  line that had one, and the patch prints it with the `%` marker.
- **The search is banded to the diagonals that matter.** One greedy walk
  gives an upper bound on the edit distance, and the search only visits
  diagonals within a fixed range around the end diagonal — the true
  shortest script's diagonals stay within a small wander of the straight
  drift from the start to the end (measured wander at most 40 lines; the
  band allows 256), so the band skips most of the work. The band does not
  depend on the greedy walk's own diagonal range, because that walk can
  derail. A band that ever proved too tight to reach the end falls back
  to the unbanded search, so the answer never depends on the band being
  wide enough to reach the end.
- **The search keeps only furthest counts, in one flat array.** Myers's
  search stores one furthest old-line count per diagonal in a single flat
  `Int32Array` — no path objects, no linked lists, no per-step allocation
  — and the script is rebuilt by walking that trace back, re-deciding each
  step exactly as the forward search did.
- **The patch builder avoids per-line string concatenation.** It pushes
  op, line and newline as separate pieces and joins once.

Everything is deterministic: no network, no clock, no randomness, no file
access, and nothing is carried from one case to the next — every call
interns and searches fresh.

## Layout

- `solve.js` — the entry: `run(input)` returns makefun-diff's patch.
- `main.ts` — the program the harness runs: reads `/input/cases.json`,
  answers each case with `run`, writes `/output/answers.json`.

## License

MIT — see `LICENSE`.
