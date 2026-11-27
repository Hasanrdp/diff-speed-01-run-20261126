// A faster drop-in for makefun-diff 1.0.0.
//
// run(input) returns exactly the patch makefun-diff 1.0.0 returns for the
// same { old, new }: the same line split, the same Myers greedy search with
// the same tie-break, and the same patch text. The speed comes from three
// changes over the reference:
//   - lines are interned once to small integers, so the search compares
//     integers in typed arrays instead of strings and path objects;
//   - the search keeps only the furthest old-line count per diagonal, in
//     flat Int32Arrays, and rebuilds the script by walking that trace back;
//   - the search only visits diagonals that can still reach the end: a
//     cheap greedy script gives an upper bound on the edit distance, and
//     any diagonal further than the remaining budget from the end diagonal
//     cannot lie on a shortest script, so it is skipped. A bound that ever
//     proved too small falls back to the unbanded search, so the answer
//     never depends on the greedy script being tight.
//
// Nothing is cached between cases: every call interns and searches fresh,
// and the result depends only on its input.

/** The patch's first word. */
const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** A text's lines as interned ids, each line with its "\n" (the last one without, when the text does not end in one). */
function tokenize(text, intern) {
  const ids = [];
  const len = text.length;
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl < 0) {
      if (start < len) ids.push(intern(text.slice(start)));
      break;
    }
    ids.push(intern(text.slice(start, nl + 1)));
    start = nl + 1;
  }
  return Int32Array.from(ids);
}

/** Append a run, merging it with the previous one when it continues it. */
function pushRun(runs, kind, count) {
  if (count <= 0) return;
  const last = runs[runs.length - 1];
  if (last !== undefined && last[0] === kind) last[1] += count;
  else runs.push([kind, count]);
}

/** The length of one concrete edit script, found greedily: an upper bound on the shortest script. */
function greedyBound(a, b) {
  // Two windows: the narrower one sometimes tracks the true alignment
  // better, the wider one the other times; either script is a valid bound.
  return Math.min(greedyWalk(a, b, 32), greedyWalk(a, b, 64));
}

/** One greedy walk: match what matches, insert or delete what a short lookahead says, drop the rest. */
function greedyWalk(a, b, W) {
  const n = a.length;
  const m = b.length;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    // Is a[i] a few lines ahead in b, with the line after it matching too?
    // Then the lines before it in b are insertions.
    let t = 0;
    const jLast = Math.min(m - 1, j + W);
    for (let k = j + 1; k <= jLast; k++) {
      if (b[k] === a[i] && (k + 1 >= m || i + 1 >= n || b[k + 1] === a[i + 1])) {
        t = k - j;
        break;
      }
    }
    if (t > 0) {
      edits += t;
      j += t;
      continue;
    }
    // Is b[j] a few lines ahead in a, with the line after it matching too?
    // Then the lines before it in a are deletions.
    let s = 0;
    const iLast = Math.min(n - 1, i + W);
    for (let k = i + 1; k <= iLast; k++) {
      if (a[k] === b[j] && (k + 1 >= n || j + 1 >= m || a[k + 1] === b[j + 1])) {
        s = k - i;
        break;
      }
    }
    if (s > 0) {
      edits += s;
      i += s;
      continue;
    }
    // Nothing near matches: drop a[i] and move on.
    edits++;
    i++;
  }
  return edits + (n - i) + (m - j);
}

/**
 * Myers's greedy search from the first lines, keeping on each diagonal the
 * path reaching furthest into the old text, the deletion when a deletion
 * and an insertion reach the same point, never moving past either text's
 * end, and following every run of equal lines as far as it goes. Only
 * diagonals within the remaining budget of the end diagonal are visited.
 * Returns the distance and the trace of furthest counts, or null when the
 * bound runs out before both ends are reached.
 */
function search(a, b, bound) {
  const n = a.length;
  const m = b.length;
  const kEnd = n - m;
  const dMax = Math.min(n + m, bound);
  const traceV = [];
  const traceK0 = [];
  for (let d = 0; d <= dMax; d++) {
    const slack = bound - d;
    let klo = Math.max(-d, kEnd - slack);
    let khi = Math.min(d, kEnd + slack);
    if (((klo - d) & 1) !== 0) klo++;
    if (((khi - d) & 1) !== 0) khi--;
    if (klo > khi) return null;
    const width = ((khi - klo) >> 1) + 1;
    // One sentinel slot at each end, both -1 (no path): the diagonals just
    // outside the slice then read as no path with no bounds check.
    const cur = new Int32Array(width + 2);
    cur[0] = -1;
    cur[width + 1] = -1;
    traceV.push(cur);
    traceK0.push(klo);
    const prev = d > 0 ? traceV[d - 1] : null;
    const prevK0 = d > 0 ? traceK0[d - 1] : 0;
    let idx = 1;
    for (let k = klo; k <= khi; k += 2, idx++) {
      let x;
      if (d === 0) {
        x = 0;
      } else {
        const pi = (k - 1 - prevK0) >> 1;
        const xDown = prev[pi + 1];
        const xUp = prev[pi + 2];
        const canRemove = xDown >= 0 && xDown < n;
        const canAdd = xUp >= 0 && xUp - k <= m;
        if (!canRemove && !canAdd) {
          cur[idx] = -1;
          continue;
        }
        const byDeletion = canRemove ? xDown + 1 : -1;
        const byInsertion = canAdd ? xUp : -1;
        x = byDeletion >= byInsertion ? xDown + 1 : xUp;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      cur[idx] = x;
      if (x === n && y === m) return { distance: d, traceV, traceK0 };
    }
  }
  return null;
}

/** The runs of the edit script of a into b: [kind, count] in order. */
function diffRuns(a, b) {
  const n = a.length;
  const m = b.length;
  let found = search(a, b, greedyBound(a, b));
  if (found === null) found = search(a, b, Infinity);
  if (found === null) throw new Error('makefun-diff: the search ended without reaching both ends');
  const { distance, traceV, traceK0 } = found;

  // Walk the trace back from both ends, re-deciding each step exactly as
  // the forward search did, and collect the script in reverse.
  const rev = [];
  let x = n;
  let y = m;
  for (let d = distance; d >= 1; d--) {
    const k = x - y;
    const prev = traceV[d - 1];
    const prevK0 = traceK0[d - 1];
    const pi = (k - 1 - prevK0) >> 1;
    const xDown = prev[pi + 1];
    const xUp = prev[pi + 2];
    const canRemove = xDown >= 0 && xDown < n;
    const canAdd = xUp >= 0 && xUp - k <= m;
    if (!canRemove && !canAdd) throw new Error('makefun-diff: the trace ends before the start');
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
    x = prevX;
    y = prevY;
  }
  if (x > 0) rev.push([KEEP, x]);
  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) pushRun(runs, rev[i][0], rev[i][1]);
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? `${op}${line}` : `${op}${line}\n%\n`;
}

/** make.fun's own patch of the two texts, from the edit runs and the line texts. */
function buildPatch(runs, oldLines, newLines, lineText) {
  const n = oldLines.length;
  const m = newLines.length;

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const [kind, count] of runs) {
    if (kind === KEEP) {
      o += count;
      p += count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DELETE) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', lineText[oldLines[at]]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', lineText[oldLines[c.o + i]]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', lineText[newLines[c.p + i]]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', lineText[oldLines[at]]));
  }
  return out.join('');
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const lineIds = new Map();
  const lineText = [];
  const intern = (line) => {
    let id = lineIds.get(line);
    if (id === undefined) {
      id = lineText.length;
      lineIds.set(line, id);
      lineText.push(line);
    }
    return id;
  };
  const oldLines = tokenize(input.old, intern);
  const newLines = tokenize(input.new, intern);
  const n = oldLines.length;
  const m = newLines.length;

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && oldLines[n - 1 - suffix] === newLines[m - 1 - suffix]) suffix++;

  const runs = [];
  pushRun(runs, KEEP, prefix);
  for (const [kind, count] of diffRuns(oldLines.subarray(prefix, n - suffix), newLines.subarray(prefix, m - suffix))) {
    pushRun(runs, kind, count);
  }
  pushRun(runs, KEEP, suffix);
  return buildPatch(runs, oldLines, newLines, lineText);
}
