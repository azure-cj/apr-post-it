// Makes src/ui/startup/ph-land.json, the land under the startup map's dots.
// From APG GIS's regions (apg-gis public/geo/regions.json): the edges two regions
// share are borders, the rest is coast, chained into closed loops, simplified to
// 0.015 degrees (under a pixel on the startup screen) and specks under 0.001
// square degrees dropped. Each ring is [lng, lat, lng, lat, ...] at 2 decimals.
//
//   node scripts/ph-land.mjs ../../../../apg-gis/public/geo/regions.json src/ui/startup/ph-land.json 0.015 0.001
import { readFileSync, writeFileSync } from 'node:fs';
const [src, out, tolArg, minAreaArg] = process.argv.slice(2);
const TOL = Number(tolArg ?? 0.01), MIN_AREA = Number(minAreaArg ?? 0.0006);
const g = JSON.parse(readFileSync(src, 'utf8'));
const id = (p) => p[0] + ',' + p[1];
const key = (a, b) => { const p = id(a), q = id(b); return p < q ? p + '|' + q : q + '|' + p; };
const edges = new Map();
const all = [];
for (const f of g.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) for (const ring of poly) for (let i = 0; i + 1 < ring.length; i++) {
    if (id(ring[i]) === id(ring[i + 1])) continue;
    const k = key(ring[i], ring[i + 1]);
    edges.set(k, (edges.get(k) ?? 0) + 1);
    all.push([ring[i], ring[i + 1]]);
  }
}
const coast = all.filter(([a, b]) => edges.get(key(a, b)) === 1);
const next = new Map();
for (const [a, b] of coast) { const k = id(a); if (!next.has(k)) next.set(k, []); next.get(k).push(b); }
const used = new Set();
const loops = []; let open = 0;
for (const [a, b] of coast) {
  if (used.has(id(a) + '>' + id(b))) continue;
  const loop = [a]; let cur = a, nxt = b;
  for (let guard = 0; guard < 100000; guard++) {
    used.add(id(cur) + '>' + id(nxt)); loop.push(nxt);
    if (id(nxt) === id(a)) break;
    const options = (next.get(id(nxt)) ?? []).filter((c) => !used.has(id(nxt) + '>' + id(c)));
    if (!options.length) { open++; break; }
    cur = nxt; nxt = options[0];
  }
  loops.push(loop);
}
const area = (r) => { let s = 0; for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(s / 2); };
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop(); const [x1, y1] = pts[s], [x2, y2] = pts[e];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1e-12;
    let best = -1, at = -1;
    for (let i = s + 1; i < e; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / len; if (d > best) { best = d; at = i; } }
    if (best > tol) { keep[at] = 1; stack.push([s, at], [at, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const rings = [];
let points = 0;
for (const loop of loops) {
  if (area(loop) < MIN_AREA) continue;
  // Split the closed loop in two so its far side survives the simplifying.
  const half = Math.floor(loop.length / 2);
  const s = [...dp(loop.slice(0, half + 1), TOL), ...dp(loop.slice(half), TOL).slice(1)];
  const flat = [];
  let last = '';
  for (const [x, y] of s) { const p = `${x.toFixed(2)},${y.toFixed(2)}`; if (p === last) continue; last = p; flat.push(+x.toFixed(2), +y.toFixed(2)); }
  if (flat.length >= 8) { rings.push(flat); points += flat.length / 2; }
}
const text = JSON.stringify(rings);
writeFileSync(out, text + '\n');
console.log({ coastEdges: coast.length, loops: loops.length, open, kept: rings.length, points, bytes: text.length });
