#!/usr/bin/env node
'use strict';

// Builds the review-graph page from a data file (REFERENCE.md §2 is the schema).
//
// Lays out any node without explicit x/y from its lane and row, validates every
// reference (edges, findings, code excerpts, screenshots, review order), writes the
// page beside the data file, and prints the `files` list the Artifact publish needs.
//
// Usage:
//   node build.js graph.data.json                   # writes <dir>/<slug>.html
//   node build.js graph.data.json --out x.html
//   node build.js graph.data.json --check           # validate only
//   node build.js graph.data.json --optimize-rows   # re-row lane-placed nodes to cut edges
//                                                    # hidden under cards; saves rows to the data file
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parse, generate, prettyGenerate, toS, inspect } = require('./json_compat');

const LANE_WIDTH = 300;
const ROW_HEIGHT = 160;
const NODE_W = 232;
const NODE_H = 120;
const NODE_KINDS = ['added', 'modified', 'behavior', 'removed', 'unchanged', 'context'];
const EDGE_KINDS = ['added', 'removed', 'modified', 'impacted', 'unchanged', 'context'];
const RELATIONS = ['render', 'nav', 'call', 'use', 'net', 'resolve', 'read', 'write', 'async', 'test'];
const SEVERITIES = ['high', 'med', 'low', 'nit'];
const REVIEWABLE = ['added', 'modified', 'behavior', 'removed'];

function abort(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}

const present = (value) => value !== null && value !== undefined && value !== false;
const or = (value, fallback) => (present(value) ? value : fallback);
const chars = (value) => [...toS(value)];
const expandPath = (file) => path.resolve(file.replace(/^~(?=$|\/)/, os.homedir()));

// Sums floats the way the layout cost was tuned: compensated (Kahan-Babuska), not left to right.
function sum(values) {
  let total = 0;
  let compensation = 0;
  for (const value of values) {
    const next = total + value;
    compensation += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total;
    total = next;
  }
  return total + compensation;
}

// A layout cost to one decimal, as the original Ruby build.rb printed it (kept so its output
// stays identical): David Gay's dtoa fast path, which treats a dropped part within rounding
// error of one half as a tie and rounds it to even (2.45 -> 2.4, 0.35 -> 0.4), where
// toFixed(1) rounds the exact binary value (2.5, 0.3).
function fixed1(value) {
  if (!(value > 0) || !Number.isFinite(value)) return value.toFixed(1);
  // k: the decimal exponent of the leading digit, estimated and corrected as dtoa does.
  let exponent = Math.floor(Math.log2(value));
  let mantissa = value / 2 ** exponent;
  if (mantissa >= 2) { mantissa /= 2; exponent++; } else if (mantissa < 1) { mantissa *= 2; exponent--; }
  const estimate = (mantissa - 1.5) * 0.289529654602168 + 0.1760912590558 + exponent * 0.301029995663981;
  let k = Math.trunc(estimate);
  if (estimate < 0 && estimate !== k) k--;
  let kCheck = true;
  if (k >= 0 && k <= 22) {
    if (value < 10 ** k) k--;
    kCheck = false;
  }
  let ilim = k + 2; // digits to generate: through the first decimal
  if (ilim < 0 || ilim > 14 || Math.abs(k) >= 16) return value.toFixed(1); // dtoa's exact path
  let d = k > 0 ? value / 10 ** k : value * 10 ** -k;
  let ieps = 2;
  if (kCheck && d < 1 && ilim > 0) {
    if (ilim <= 1) return value.toFixed(1);
    ilim--; k--; d *= 10; ieps++;
  }
  let eps = (ieps * d + 7) * 2 ** -52;
  if (ilim === 0) {
    d -= 5;
    if (d > eps) return assembleDigits([1], k + 1);
    if (d < -eps) return '0.0';
    return value.toFixed(1);
  }
  eps *= 10 ** (ilim - 1);
  const digits = [];
  for (let i = 1; ; i++, d *= 10) {
    const digit = Math.trunc(d);
    d -= digit;
    if (!d) ilim = i;
    digits.push(digit);
    if (i < ilim) continue;
    if (d > 0.5 + eps || (!(d < 0.5 - eps) && digit % 2 === 1)) {
      let j = digits.length - 1;
      while (j >= 0 && digits[j] === 9) digits[j--] = 0;
      if (j < 0) { digits.unshift(1); k++; } else digits[j]++;
    }
    return assembleDigits(digits, k);
  }
}

// Digits d1 d2 ... with d1 in the 10^k place, written with one decimal.
function assembleDigits(digits, k) {
  let text = digits.join('');
  let point = k + 1;
  if (point <= 0) { text = '0'.repeat(1 - point) + text; point = 1; }
  if (text.length < point) text += '0'.repeat(point - text.length);
  return `${text.slice(0, point)}.${(text.slice(point) + '0').slice(0, 1)}`;
}

// Mersenne Twister (MT19937) seeded from one 32-bit word, drawing integers in 0..limit by
// masked rejection, so a PR number always gives the same --optimize-rows result.
class Random {
  constructor(seed) {
    this.state = new Uint32Array(624);
    this.state[0] = seed >>> 0;
    for (let index = 1; index < 624; index++) {
      const previous = this.state[index - 1] ^ (this.state[index - 1] >>> 30);
      this.state[index] = (Math.imul(1812433253, previous) + index) >>> 0;
    }
    this.index = 624;
  }

  int32() {
    const state = this.state;
    if (this.index >= 624) {
      for (let index = 0; index < 624; index++) {
        const y = (state[index] & 0x80000000) | (state[(index + 1) % 624] & 0x7fffffff);
        state[index] = state[(index + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.index = 0;
    }
    let y = state[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  upTo(limit) {
    if (!limit) return 0;
    let mask = limit;
    for (let shift = 1; shift < 32; shift <<= 1) mask |= mask >>> shift;
    for (;;) {
      const value = (this.int32() & mask) >>> 0;
      if (value <= limit) return value;
    }
  }

  sample(array) {
    return array[array.length < 2 ? 0 : this.upTo(array.length - 1)];
  }
}

// Same cubic the page draws (template geom()): side to side across lanes, top/bottom within one.
function curve(sx0, sy0, tx0, ty0) {
  if (tx0 >= sx0 + NODE_W - 10) {
    const [sx, sy, tx, ty] = [sx0 + NODE_W, sy0 + NODE_H / 2, tx0, ty0 + NODE_H / 2];
    const dx = Math.max(60, (tx - sx) * 0.5);
    return [[sx, sy], [sx + dx, sy], [tx - dx, ty], [tx, ty]];
  } else if (tx0 + NODE_W <= sx0 + 10) {
    const [sx, sy, tx, ty] = [sx0, sy0 + NODE_H / 2, tx0 + NODE_W, ty0 + NODE_H / 2];
    const dx = Math.max(60, (sx - tx) * 0.5);
    return [[sx, sy], [sx - dx, sy], [tx + dx, ty], [tx, ty]];
  }
  const down = ty0 > sy0;
  const [sx, sy] = [sx0 + NODE_W / 2, down ? sy0 + NODE_H : +sy0];
  const [tx, ty] = [tx0 + NODE_W / 2, down ? +ty0 : ty0 + NODE_H];
  const dy = Math.max(50, Math.abs(ty - sy) * 0.5) * (down ? 1 : -1);
  return [[sx, sy], [sx, sy + dy], [tx, ty - dy], [tx, ty]];
}

function point(points, t) {
  const u = 1 - t;
  const weights = [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3];
  return [0, 1].map((axis) => sum(points.map((pt, index) => pt[axis] * weights[index])));
}

// The card an edge runs under, if any: xy is Map {id => [x, y]}.
function hiddenUnder(edge, xy) {
  const from = xy.get(edge.from ?? null);
  const to = xy.get(edge.to ?? null);
  if (!from || !to) return undefined;
  const points = curve(...from, ...to);
  const samples = Array.from({ length: 15 }, (_, step) => point(points, (step + 1) / 16));
  const xs = samples.map((sample) => sample[0]);
  const ys = samples.map((sample) => sample[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (const [id, [x, y]] of xy) {
    if (id === (edge.from ?? null) || id === (edge.to ?? null)) continue;
    if (x + NODE_W < minX || x > maxX || y + NODE_H < minY || y > maxY) continue;
    if (samples.some(([px, py]) => px > x + 6 && px < x + NODE_W - 6 && py > y + 6 && py < y + NODE_H - 6)) return [id];
  }
  return undefined;
}

function layoutCost(rows, laneOf, fixedXy, edges) {
  const xy = new Map([...fixedXy, ...[...rows].map(([id, row]) => [id, [laneOf.get(id) * LANE_WIDTH, row * ROW_HEIGHT]])]);
  return sum(edges.map((edge) => {
    const weight = edge.rel === 'test' ? 1 : 3;
    return (hiddenUnder(edge, xy) ? weight : 0) + 0.05 * Math.abs((rows.get(edge.from ?? null) ?? 0) - (rows.get(edge.to ?? null) ?? 0));
  }));
}

const argv = process.argv.slice(2);
const dataPath = argv.find((arg) => !arg.startsWith('--') && !toS(argv.at(argv.indexOf(arg) - 1)).startsWith('--out')) ??
  abort('usage: node build.js graph.data.json [--out page.html] [--check] [--optimize-rows]');
const checkOnly = argv.includes('--check');
const optimize = argv.includes('--optimize-rows');
const outIndex = argv.indexOf('--out');
const data = parse(fs.readFileSync(dataPath, 'utf8'));
const dataDir = path.dirname(expandPath(dataPath));
const pr = 'pr' in data ? data.pr : abort('data has no `pr` block');
const slug = or(data.slug, `pr${toS(pr.number)}-review-graph`);
const outPath = outIndex !== -1 ? expandPath(argv[outIndex + 1]) : path.resolve(dataDir, `${slug}.html`);
const pageDir = path.dirname(outPath);

const errors = [];
const warnings = [];
const lanes = or(data.lanes, []);
const laneIndex = new Map();
lanes.forEach((lane, index) => {
  laneIndex.set(index, index);
  if (present(lane.id)) laneIndex.set(lane.id, index);
});
if (lanes.length === 0) errors.push('no lanes');
const nodes = or(data.nodes, []);
const edges = or(data.edges, []);
const ids = nodes.map((node) => node.id ?? null);
const tally = (items, keyOf = (item) => item) => {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, { item: counts.get(key)?.item ?? item, count: (counts.get(key)?.count ?? 0) + 1 });
  }
  return [...counts.values()];
};
const duplicateIds = tally(ids).filter(({ count }) => count > 1).map(({ item }) => item);
if (duplicateIds.length) errors.push(`duplicate node ids: ${duplicateIds.map(toS).join(', ')}`);

// ---------- layout ----------
const lanePlaced = nodes.filter((node) => node.x == null || node.y == null);
const laneOf = new Map();
let rows = new Map();
const nextRow = new Map();
for (const node of lanePlaced) {
  const lane = laneIndex.get(node.lane ?? null);
  if (lane === undefined) {
    errors.push(`node ${toS(node.id)}: lane ${inspect(node.lane)} is not a lane id or index`);
    continue;
  }
  laneOf.set(node.id ?? null, lane);
  rows.set(node.id ?? null, or(node.row, nextRow.get(lane) ?? 0));
  nextRow.set(lane, Math.max(nextRow.get(lane) ?? 0, Math.ceil(rows.get(node.id ?? null)) + 1));
}
const fixedXy = new Map(nodes.filter((node) => !lanePlaced.includes(node)).map((node) => [node.id ?? null, [node.x, node.y]]));

const maxOf = (values) => (values.length ? Math.trunc(Math.max(...values)) : 0);
if (optimize && errors.length === 0) {
  const maxRow = Math.max(maxOf([...rows.values()]), maxOf([...nextRow.values()])) + 2;
  let best = layoutCost(rows, laneOf, fixedXy, edges);
  const before = best;
  const random = new Random(Math.trunc(Number(pr.number) || 0));
  const iterations = rows.size * 60;
  for (let step = 0; step < iterations; step++) {
    const id = random.sample([...rows.keys()]);
    const candidate = new Map(rows);
    const target = random.upTo(maxRow);
    let occupant;
    for (const [other, row] of candidate) {
      if (other !== id && laneOf.get(other) === laneOf.get(id) && Math.abs(row - target) < 1) {
        occupant = [other];
        break;
      }
    }
    if (occupant) candidate.set(occupant[0], candidate.get(id));
    candidate.set(id, target);
    const score = layoutCost(candidate, laneOf, fixedXy, edges);
    if (!(score < best)) continue;
    best = score;
    rows = candidate;
  }
  // Close the gaps the search left at the top of each lane, keeping relative order.
  const top = rows.size ? Math.min(...rows.values()) : 0;
  for (const [id, row] of rows) rows.set(id, new Number(row - top));
  for (const node of lanePlaced) if (rows.has(node.id ?? null)) node.row = rows.get(node.id ?? null);
  const saved = parse(fs.readFileSync(dataPath, 'utf8'));
  for (const node of saved.nodes) if (rows.has(node.id ?? null)) node.row = rows.get(node.id ?? null);
  fs.writeFileSync(dataPath, prettyGenerate(saved) + '\n');
  console.log(`optimize-rows: layout cost ${fixed1(before)} -> ${fixed1(best)}; rows saved to ${dataPath}`);
}
const roundHalfAway = (value) => Math.sign(value) * Math.round(Math.abs(value));
for (const node of lanePlaced) {
  if (!laneOf.has(node.id ?? null)) continue;
  node.x = laneOf.get(node.id ?? null) * LANE_WIDTH;
  node.y = roundHalfAway(rows.get(node.id ?? null) * ROW_HEIGHT);
}

// ---------- nodes ----------
const longNames = [];
for (const node of nodes) {
  const label = or(node.id, node.name);
  for (const key of ['id', 'type', 'name', 'sub', 'kind']) if (toS(node[key]) === '') errors.push(`node ${toS(label)}: missing ${key}`);
  if (!NODE_KINDS.includes(node.kind)) errors.push(`node ${toS(label)}: unknown kind ${inspect(node.kind)}`);
  const bullets = or(node.bullets, []);
  if (bullets.length > 2) warnings.push(`node ${toS(label)}: more than 2 bullets; the card shows two`);
  for (const bullet of bullets) {
    if (chars(bullet).length > 45) warnings.push(`node ${toS(label)}: bullet over 45 chars is cut off: ${inspect(chars(bullet).slice(0, 50).join(''))}`);
  }
  if (chars(node.name).length > 24) longNames.push(node.id ?? null);
  if (toS(node.summary) === '' && node.kind !== 'context') warnings.push(`node ${toS(label)}: no summary`);
  if (REVIEWABLE.includes(node.kind) && node.code == null) warnings.push(`node ${toS(label)}: changed node with no code excerpt`);
  for (const image of or(node.images, [])) {
    const src = toS(image.src);
    const imagePath = path.resolve(pageDir, src);
    let isFile = false;
    try { isFile = fs.statSync(imagePath).isFile(); } catch { isFile = false; }
    if (!isFile) errors.push(`node ${toS(label)}: image ${toS(image.src)} not found at ${imagePath}`);
  }
}
const byId = new Map(nodes.map((node) => [node.id ?? null, node]));

const code = or(data.code, {});
const hasCode = (key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(code, key);
for (const node of nodes) {
  if (present(node.code) && !hasCode(node.code)) errors.push(`node ${toS(node.id)}: code ${inspect(node.code)} not in \`code\``);
}
for (const [key, lines] of Object.entries(code)) {
  if (!Array.isArray(lines)) {
    errors.push(`code ${key}: must be an array of lines`);
    continue;
  }
  if (lines.length > 60) warnings.push(`code ${key}: ${lines.length} lines; keep excerpts under ~60`);
  const bad = lines.filter((line) => !(line === '' || '+- @'.includes([...line][0])));
  if (bad.length) errors.push(`code ${key}: lines must start with +, -, space or @ (${inspect(bad[0])})`);
}

// ---------- edges ----------
const edgeIds = edges.map((edge) => edge.id ?? null);
if (new Set(edgeIds).size !== edgeIds.length) errors.push('duplicate edge ids');
for (const edge of edges) {
  const label = or(edge.id, `${toS(edge.from)}->${toS(edge.to)}`);
  if (!byId.has(edge.from ?? null)) errors.push(`edge ${toS(label)}: unknown from ${inspect(edge.from)}`);
  if (!byId.has(edge.to ?? null)) errors.push(`edge ${toS(label)}: unknown to ${inspect(edge.to)}`);
  if (!RELATIONS.includes(edge.rel)) errors.push(`edge ${toS(label)}: unknown rel ${inspect(edge.rel)}`);
  if (!EDGE_KINDS.includes(edge.kind)) errors.push(`edge ${toS(label)}: unknown kind ${inspect(edge.kind)}`);
  if (present(edge.code) && !hasCode(edge.code)) errors.push(`edge ${toS(label)}: code ${inspect(edge.code)} not in \`code\``);
  if (['added', 'removed', 'modified', 'impacted'].includes(edge.kind) && edge.rel !== 'test' && toS(edge.detail) === '') {
    warnings.push(`edge ${toS(label)}: changed edge with no detail`);
  }
  if (chars(edge.label).length > 32) warnings.push(`edge ${toS(label)}: label over 32 chars (fine if it's a verbatim identifier)`);
}
const pairs = edges.map((edge) => [edge.from ?? null, edge.to ?? null, edge.rel ?? null]);
const pairCounts = tally(pairs, generate);
if (pairCounts.length !== pairs.length) {
  warnings.push(`duplicate edges: ${pairCounts.filter(({ count }) => count > 1).map(({ item }) => item.map(toS).join('->')).join(', ')}`);
}
const connected = new Set(edges.flatMap((edge) => [edge.from ?? null, edge.to ?? null]));
for (const id of ids.filter((id) => !connected.has(id))) warnings.push(`node ${toS(id)}: no edges`);

// ---------- findings, order, boundaries ----------
const findings = or(data.findings, []);
for (const finding of findings) {
  if (!byId.has(finding.node ?? null)) errors.push(`finding ${toS(finding.id)}: unknown node ${inspect(finding.node)}`);
  if (!SEVERITIES.includes(finding.sev)) errors.push(`finding ${toS(finding.id)}: unknown sev ${inspect(finding.sev)}`);
  for (const id of or(finding.alsoNodes, [])) if (!byId.has(id ?? null)) errors.push(`finding ${toS(finding.id)}: unknown alsoNodes ${toS(id)}`);
}
for (const id of or(data.order, [])) if (!byId.has(id ?? null)) errors.push(`order: unknown node ${toS(id)}`);
const toI = (value) => {
  if (typeof value === 'number' || value instanceof Number) return Math.trunc(value);
  if (typeof value === 'string') return parseInt(value, 10) || 0;
  return 0;
};
for (const boundary of or(data.boundaries, [])) {
  const after = toI(boundary.afterLane);
  if (!(after >= 0 && after <= lanes.length - 2)) errors.push(`boundary after lane ${toS(boundary.afterLane)} is out of range`);
}

// ---------- layout checks ----------
if (errors.length === 0) {
  const xy = new Map(nodes.map((node) => [node.id ?? null, [node.x, node.y]]));
  const crossings = [];
  for (const edge of edges) {
    const under = hiddenUnder(edge, xy);
    if (under) crossings.push(`${toS(edge.id)} (${toS(edge.from)}->${toS(edge.to)} under ${toS(under[0])})`);
  }
  nodes.forEach((a, index) => {
    for (const b of nodes.slice(index + 1)) {
      if (Math.abs(a.x - b.x) < NODE_W && Math.abs(a.y - b.y) < NODE_H) {
        warnings.push(`nodes ${toS(a.id)} and ${toS(b.id)} overlap at (${toS(a.x)},${toS(a.y)})`);
      }
    }
  });
  if (crossings.length) warnings.push(`${crossings.length} edge(s) run under another card (try --optimize-rows, or move a node): ${crossings.join(', ')}`);

  // The page places each label at the first free spot along its edge (template renderGraph());
  // when none is free it falls back to the midpoint, on top of whatever is there.
  const boxes = [...xy.values()].map(([x, y]) => [x - 4, y - 4, NODE_W + 8, NODE_H + 8]);
  const placed = [];
  const stuck = [];
  for (const edge of edges) {
    if (toS(edge.label) === '') continue;
    const points = curve(...xy.get(edge.from ?? null), ...xy.get(edge.to ?? null));
    const width = Math.round(chars(edge.label).length * 6.2 + 22);
    const overlaps = (rect) => [...boxes, ...placed].some(([bx, by, bw, bh]) => rect[0] < bx + bw && rect[0] + rect[2] > bx && rect[1] < by + bh && rect[1] + rect[3] > by);
    const spot = [0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73, 0.2, 0.8]
      .map((t) => { const [px, py] = point(points, t); return [px - width / 2, py - 12, width, 24]; })
      .find((rect) => !overlaps(rect));
    const [px, py] = point(points, 0.5);
    const fallback = [px - width / 2, py - 12, width, 24];
    // Only a label over a card's chip and name (its top 56px) costs the reader anything.
    let covered;
    if (!spot) {
      for (const [id, [x, y]] of xy) {
        if (id === (edge.from ?? null) || id === (edge.to ?? null)) continue;
        if (fallback[0] < x + NODE_W && fallback[0] + width > x && fallback[1] < y + 56 && fallback[1] + 24 > y) {
          covered = [id];
          break;
        }
      }
    }
    if (covered) stuck.push(`${toS(edge.id)} (over ${toS(covered[0])})`);
    placed.push(spot || fallback);
  }
  if (stuck.length) warnings.push(`${stuck.length} edge label(s) will sit on another card's name (shorten them or move a node): ${stuck.join(', ')}`);
}
if (longNames.length) {
  warnings.push(`${longNames.length} name(s) over 24 chars are cut off on their cards (put the class in \`sub\`, the method in \`name\`): ${longNames.map(toS).join(', ')}`);
}

for (const warning of warnings) console.error(`warning: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`error: ${error}`);
  abort(`${errors.length} error(s); nothing written`);
}
console.log(`ok: ${nodes.length} nodes, ${edges.length} edges, ${findings.length} findings, ${Object.keys(code).length} code excerpts, ${warnings.length} warning(s)`);
if (checkOnly) process.exit(0);

const template = fs.readFileSync(path.join(__dirname, '..', 'assets', 'template.html'), 'utf8');
const json = generate(data).split('</').join('<\\/');
const title = or(data.title, `#${toS(pr.number)} Review Graph`);
const page = template.replace('__TITLE__', () => title.replaceAll('&', '&amp;').replaceAll('<', '&lt;')).replace('__DATA__', () => json);
fs.writeFileSync(outPath, page);
const images = [...new Set(nodes.flatMap((node) => or(node.images, []).map((image) => image.src ?? null)))]
  .sort((a, b) => Buffer.compare(Buffer.from(toS(a)), Buffer.from(toS(b))));
console.log(`wrote ${outPath} (${Buffer.byteLength(page)} bytes)`);
console.log(`publish: file_path=${outPath} root=${pageDir}`);
console.log(`files: ${generate(images)}`);
