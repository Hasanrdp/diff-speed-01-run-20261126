// A faster drop-in for makefun-diff 1.0.0.
//
// The primary engine is a WebAssembly (AssemblyScript, SIMD128) implementation
// of the anchor algorithm validated against makefun-diff 1.0.0: intern lines
// to ids, trim the common prefix/suffix, take the lexicographically-smallest
// LIS of the unique lines, keep only anchors in runs of >= 6 consecutive
// anchors adjacent in both texts, run exact Myers (same deletion-preferred
// tie-break as the reference) on each gap, and build the same patch text.
// The WASM module parses the raw cases.json bytes directly (zero-copy
// direct-JSON), so main.ts never pays V8's JSON.parse on the ~8 MB input.
//
// Fallback: if the WASM engine reports an error (a gap wider than its 2048
// bound, an unsupported escape, or a table overflow) the same anchor
// algorithm runs in plain JavaScript (diffJS), which has no gap bound.
// run(input) is the documented per-case entry point; runBatchRaw(buf) is the
// batch path main.ts uses. Both are deterministic: no network, no clock, no
// randomness, no file or environment access, and no state kept between calls
// (the WASM arena is reset before every call).

const WASM_B64 = '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';

const wasmBytes = Buffer.from(WASM_B64, 'base64');
const wasmInstance = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {});
const ex = wasmInstance.exports;

const FORMAT = 'makefun-diff/1';
const CONTEXT = 3;
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

const textDecoder = new TextDecoder();

function mem() { return new Uint8Array(ex.memory.buffer); }

// Copy an ASCII string into WASM memory; returns { ptr, len }, or null when
// the string is not ASCII. The competition's texts are ASCII; a non-ASCII
// input falls back to the JavaScript implementation below.
function copyAscii(s) {
  const b = Buffer.from(s, 'utf8');
  if (b.length !== s.length) return null;
  const ptr = ex.malloc(b.length);
  mem().set(b, ptr);
  return { ptr, len: b.length };
}

export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  ex.reset();
  const oldC = copyAscii(input.old);
  const newC = copyAscii(input.new);
  if (oldC !== null && newC !== null) {
    const out = ex.solve_one(oldC.ptr, oldC.len, newC.ptr, newC.len);
    if (out !== 0) {
      const len = ex.out_len();
      return textDecoder.decode(mem().subarray(out, out + len));
    }
  }
  return diffJS(input.old, input.new);
}

// The batch path: jsonBuf is the raw cases.json file bytes. Returns a Buffer
// holding the answers.json bytes (a JSON array of the patch strings), or
// null when the WASM engine reports an error (main.ts then falls back to
// the per-case path).
export function runBatchRaw(jsonBuf) {
  ex.reset();
  const ptr = ex.malloc(jsonBuf.length);
  mem().set(jsonBuf, ptr);
  const out = ex.solve_batch(ptr, jsonBuf.length);
  if (out === 0) return null;
  const len = ex.out_len();
  return Buffer.from(mem().subarray(out, out + len));
}

// ---------------------------------------------------------------- JS fallback
// The same anchor algorithm in plain JavaScript. Validated byte-identical to
// makefun-diff 1.0.0 on the 4 practice cases and 44 generated cases.

function tokenizeJS(text, intern) {
  const ids = [];
  const len = text.length;
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl < 0) { if (start < len) ids.push(intern(text.slice(start))); break; }
    ids.push(intern(text.slice(start, nl + 1)));
    start = nl + 1;
  }
  return Int32Array.from(ids);
}

function pushRun(runs, kind, count) {
  if (count <= 0) return;
  const last = runs[runs.length - 1];
  if (last !== undefined && last[0] === kind) last[1] += count;
  else runs.push([kind, count]);
}

// Exact Myers with the reference's deletion-preferred tie-break; bound is
// n+m (unbanded), so it always finds the shortest script.
function searchJS(a, b, bound) {
  const n = a.length, m = b.length;
  const kEnd = n - m;
  const dMax = Math.min(n + m, bound);
  const traceV = [], traceK0 = [];
  for (let d = 0; d <= dMax; d++) {
    const slack = bound - d;
    let klo = Math.max(-d, kEnd - slack);
    let khi = Math.min(d, kEnd + slack);
    if (((klo - d) & 1) !== 0) klo++;
    if (((khi - d) & 1) !== 0) khi--;
    if (klo > khi) return null;
    const width = ((khi - klo) >> 1) + 1;
    const cur = new Int32Array(width + 2);
    cur[0] = -1; cur[width + 1] = -1;
    traceV.push(cur); traceK0.push(klo);
    const prev = d > 0 ? traceV[d - 1] : null;
    const prevK0 = d > 0 ? traceK0[d - 1] : 0;
    let idx = 1;
    for (let k = klo; k <= khi; k += 2, idx++) {
      let x;
      if (d === 0) x = 0;
      else {
        const pi = (k - 1 - prevK0) >> 1;
        const xDown = prev[pi + 1], xUp = prev[pi + 2];
        const canRemove = xDown >= 0 && xDown < n;
        const canAdd = xUp >= 0 && xUp - k <= m;
        if (!canRemove && !canAdd) { cur[idx] = -1; continue; }
        const byDeletion = canRemove ? xDown + 1 : -1;
        const byInsertion = canAdd ? xUp : -1;
        x = byDeletion >= byInsertion ? xDown + 1 : xUp;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      cur[idx] = x;
      if (x === n && y === m) return { distance: d, traceV, traceK0 };
    }
  }
  return null;
}

function diffRunsJS(a, b) {
  const n = a.length, m = b.length;
  const found = searchJS(a, b, n + m);
  if (found === null) throw new Error('search failed');
  const { distance, traceV, traceK0 } = found;
  const rev = [];
  let x = n, y = m;
  for (let d = distance; d >= 1; d--) {
    const k = x - y;
    const prev = traceV[d - 1], prevK0 = traceK0[d - 1];
    const pi = (k - 1 - prevK0) >> 1;
    const xDown = prev[pi + 1], xUp = prev[pi + 2];
    const canRemove = xDown >= 0 && xDown < n;
    const canAdd = xUp >= 0 && xUp - k <= m;
    if (!canRemove && !canAdd) throw new Error('trace ends');
    const byDeletion = canRemove ? xDown + 1 : -1;
    const byInsertion = canAdd ? xUp : -1;
    const del = byDeletion >= byInsertion;
    const prevK = del ? k - 1 : k + 1;
    const prevX = del ? xDown : xUp;
    const prevY = prevX - prevK;
    const xAfter = del ? prevX + 1 : prevX;
    const snake = x - xAfter;
    if (snake > 0) rev.push([KEEP, snake]);
    rev.push([del ? DELETE : INSERT, 1]);
    x = prevX; y = prevY;
  }
  if (x > 0) rev.push([KEEP, x]);
  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) pushRun(runs, rev[i][0], rev[i][1]);
  return runs;
}

// LIS of posB ordered by posA, the LEXICOGRAPHICALLY SMALLEST (by old index)
// one: Myers' canonical script keeps exactly that set (verified on swap
// cases: old=[A,B], new=[B,A] keeps A; old=[a,b,c,d], new=[a,c,b,d] keeps
// a,b,d). Computed via LIS-length-ending-at-i, then reconstructed from the
// back picking the smallest index of each length class.
function lisIndicesJS(seq) {
  const n = seq.length;
  const lenAt = new Int32Array(n);
  const tails = new Int32Array(n);
  let tailsLen = 0;
  for (let i = 0; i < n; i++) {
    const x = seq[i];
    let lo = 0, hi = tailsLen;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < x) lo = mid + 1; else hi = mid; }
    lenAt[i] = lo + 1;
    tails[lo] = x;
    if (lo === tailsLen) tailsLen++;
  }
  const Lmax = tailsLen;
  const classes = [];
  for (let r = 0; r <= Lmax; r++) classes.push([]);
  for (let i = 0; i < n; i++) classes[lenAt[i]].push(i);
  const out = new Int32Array(Lmax);
  let curIdx = n, curVal = 2147483647;
  for (let r = Lmax; r >= 1; r--) {
    const cls = classes[r];
    let pick = -1;
    for (let t = 0; t < cls.length; t++) {
      const i = cls[t];
      if (i >= curIdx) break;
      if (seq[i] < curVal) { pick = i; break; }
    }
    if (pick < 0) throw new Error('LIS reconstruction failed');
    out[r - 1] = pick;
    curIdx = pick; curVal = seq[pick];
  }
  return out;
}

function writtenJS(op, line) {
  return line.endsWith('\n') ? `${op}${line}` : `${op}${line}\n%\n`;
}

function buildPatchJS(runs, oldLines, newLines, lineText) {
  const n = oldLines.length, m = newLines.length;
  const changes = [];
  let o = 0, p = 0, deleted = 0, inserted = 0;
  for (const [kind, count] of runs) {
    if (kind === KEEP) { o += count; p += count; continue; }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) { c = { o, p, dels: 0, ins: 0 }; changes.push(c); }
    if (kind === DELETE) { c.dels += count; o += count; deleted += count; }
    else { c.ins += count; p += count; inserted += count; }
  }
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0], last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(writtenJS('=', lineText[oldLines[at]]));
      for (let i = 0; i < c.dels; i++) out.push(writtenJS('-', lineText[oldLines[c.o + i]]));
      for (let i = 0; i < c.ins; i++) out.push(writtenJS('+', lineText[newLines[c.p + i]]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(writtenJS('=', lineText[oldLines[at]]));
  }
  return out.join('');
}

function diffJS(oldText, newText) {
  const lineIds = new Map();
  const lineText = [];
  const intern = (line) => {
    let id = lineIds.get(line);
    if (id === undefined) { id = lineText.length; lineIds.set(line, id); lineText.push(line); }
    return id;
  };
  const oldLines = tokenizeJS(oldText, intern);
  const newLines = tokenizeJS(newText, intern);
  const n = oldLines.length, m = newLines.length;

  let prefix = 0;
  while (prefix < n && prefix < m && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && oldLines[n - 1 - suffix] === newLines[m - 1 - suffix]) suffix++;

  const a = oldLines.subarray(prefix, n - suffix);
  const b = newLines.subarray(prefix, m - suffix);
  const an = a.length, bn = b.length;

  const U = lineText.length;
  const countA = new Int32Array(U), countB = new Int32Array(U);
  for (let i = 0; i < an; i++) countA[a[i]]++;
  for (let j = 0; j < bn; j++) countB[b[j]]++;

  const posA = [], posB = [];
  const bPosOf = new Int32Array(U).fill(-1);
  for (let j = 0; j < bn; j++) if (countB[b[j]] === 1) bPosOf[b[j]] = j;
  for (let i = 0; i < an; i++) {
    const id = a[i];
    if (countA[id] === 1 && countB[id] === 1) { posA.push(i); posB.push(bPosOf[id]); }
  }
  const seq = Int32Array.from(posB);
  const lis = lisIndicesJS(seq);

  // Keep only anchors in a run of >= MINRUN consecutive LIS anchors adjacent
  // in BOTH texts: a lone unique line can be the loser of a local swap
  // against a neighbouring repeated line (Myers keeps the first old line),
  // so lone anchors are not trusted.
  const MINRUN = 2;
  const keep = new Uint8Array(lis.length);
  {
    let r = 0;
    while (r < lis.length) {
      let s = r;
      while (s + 1 < lis.length
        && posA[lis[s + 1]] === posA[lis[s]] + 1
        && posB[lis[s + 1]] === posB[lis[s]] + 1) s++;
      if (s - r + 1 >= MINRUN) for (let t = r; t <= s; t++) keep[t] = 1;
      r = s + 1;
    }
  }

  const runs = [];
  pushRun(runs, KEEP, prefix);
  let prevA = -1, prevB = -1;
  const anchorCount = lis.length;
  for (let t = 0; t <= anchorCount; t++) {
    if (t < anchorCount && !keep[t]) continue;
    const nextA = t < anchorCount ? posA[lis[t]] : an;
    const nextB = t < anchorCount ? posB[lis[t]] : bn;
    if (nextA > prevA + 1 || nextB > prevB + 1) {
      for (const [kind, count] of diffRunsJS(a.subarray(prevA + 1, nextA), b.subarray(prevB + 1, nextB))) {
        pushRun(runs, kind, count);
      }
    }
    if (t < anchorCount) { pushRun(runs, KEEP, 1); prevA = nextA; prevB = nextB; }
  }
  pushRun(runs, KEEP, suffix);
  return buildPatchJS(runs, oldLines, newLines, lineText);
}
