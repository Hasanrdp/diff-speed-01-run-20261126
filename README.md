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

- **WebAssembly SIMD128 engine.** The diff runs in a small (~11 KB)
  AssemblyScript module compiled to WASM with SIMD128. Line scanning,
  string scanning and patch escaping all use 16-byte vector operations.
  The module is embedded in `solve.js` as base64 and instantiated
  synchronously (`new WebAssembly.Module` + `new WebAssembly.Instance`,
  no imports), so there is no build step and no async startup.
- **Zero-copy direct-JSON.** `main.ts` hands the raw `cases.json` bytes to
  the WASM engine, which finds and unescapes the `old`/`new` strings itself.
  V8 never pays `JSON.parse` on the ~8 MB input, and the answers are
  assembled as `answers.json` bytes directly.
- **Anchor decomposition instead of global Myers.** The true edit distance
  is ~3,500–4,000, so a global Myers search is ~D²/2 ≈ 7–10M steps per
  case. Instead the engine interns lines to ids, trims the common
  prefix/suffix, takes the lexicographically-smallest LIS of the unique
  lines, keeps only anchors in runs of >= 2 consecutive anchors adjacent
  in both texts, and runs exact Myers (same tie-break as the reference)
  on each small gap. The gaps are tiny, so the search is a few percent of
  the runtime.
- **Hash-as-identity interning.** A line's 64-bit hash is its identity in
  the intern table (collision probability ~1e-11 per case), so there is no
  byte-compare on a table hit and the table holds only hash + id.
- **Liftoff-only, no TurboFan warmup.** The module is small and the code is
  straight-line WASM, so it runs at full speed from the first call.

## Correctness

The anchor step is empirically validated, not formally proven: the
lexicographically-smallest LIS plus the run>=2 filter is byte-identical to
makefun-diff 1.0.0 on the 4 practice cases and on 48 generated cases
(11 seeds x 4 cases, built with the kit's own subject generator), and the
WASM engine matches on all 4 practice cases. If the WASM engine ever
reports an error (a gap wider than its 2048 bound, an unsupported escape,
or a table overflow), `solve.js` falls back to the same anchor algorithm
in plain JavaScript, which has no gap bound; if the batch path fails,
`main.ts` falls back to the per-case path (`JSON.parse` + `run` per case).

Everything is deterministic: no network, no clock, no randomness, no file
access, and nothing is carried from one case to the next — the WASM arena
is reset before every call.

## Layout

- `solve.js` — the entry: `run(input)` returns makefun-diff's patch for one
  case; `runBatchRaw(json)` answers a whole cases.json in the WASM engine
  and returns the `answers.json` bytes. The WASM module is embedded as
  base64; the same anchor algorithm is included in plain JavaScript as a
  fallback.
- `main.ts` — the program the harness runs: reads `/input/cases.json`,
  answers it with `runBatchRaw` (falling back to `run` per case), writes
  `/output/answers.json`.
- `engine.ts` — the AssemblyScript source of the WASM engine, for reference.

## License

MIT — see `LICENSE`.
