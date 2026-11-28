// The program the harness runs: `node /bot/main.ts` (node22). It reads every
// case from /input/cases.json and writes /output/answers.json: a JSON array
// of the answers, one per case and in the cases' order. Outside a container
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output.
//
// The fast path hands the raw cases.json bytes to solve.js's WASM engine,
// which parses the JSON itself (zero-copy direct-JSON) and returns the
// answers.json bytes directly, so V8 never pays JSON.parse on the ~8 MB
// input. If that path reports an error, main.ts falls back to the documented
// per-case path: JSON.parse the cases and answer each with run() from
// solve.js, then JSON.stringify the answers.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of its
// work runs under it (the rules: the house baseline runs with
// --no-incremental-marking, and an entry may tune V8's flags too).
setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL (a .js module carries no types). */
const { run, runBatchRaw } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => string;
  runBatchRaw: (json: Buffer) => Buffer | null;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const json = readFileSync(join(INPUT_DIR, 'cases.json'));
const fast = runBatchRaw(json);
if (fast !== null) {
  writeFileSync(join(OUTPUT_DIR, 'answers.json'), fast);
} else {
  const cases = JSON.parse(json.toString('utf8')) as { id: string; input: unknown }[];
  const answers: unknown[] = [];
  for (const c of cases) answers.push(run(c.input));
  writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
}
