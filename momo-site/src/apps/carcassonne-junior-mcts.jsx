import { useState, useRef, useEffect, useMemo } from "react";

/* ============================================================
   卡卡頌兒童版 — 鋪路小鎮（向《My First Carcassonne》致敬的改編）
   ・輪流抽板塊拼進 7×7 小鎮（邊要對邊：路接路、草接草）
   ・一條路「兩頭都封住」就完成：路上印著誰家的小孩，誰就把
     自己的小木偶放上去——先放完 8 個小木偶的人獲勝！
   ・抽牌未知 → 蒙蒙鎮長用 open-loop MCTS：把剩下的牌堆
     在腦中重洗幾百遍，挑最常獲勝的一步
   ============================================================ */

// ---------- 視覺（法國鄉間繪本風）----------
const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const K = {
  bg: "#7ec4a3", panel: "#fff8e9", panelEdge: "#d9b878", ink: "#4a3524", sub: "#8a7154",
  grass: "#a4d488", grassD: "#7cae62", road: "#f0e2b6", roadEdge: "#c9a96a",
  red: "#e5484d", redD: "#b23238", purple: "#8e6cf0", purpleD: "#6a4bd0",
  sun: "#ffb84d", sunEdge: "#d98a1f", teal: "#2bbfa3", tealEdge: "#1d8f7a",
  wall: "#b98d5e",
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = Math.random;
const ri = n => Math.floor(rnd() * n);

// ---------- 音訊引擎 ----------
let AC = null, sfxG = null, musG = null, noiseBuf = null;
let musicPlaying = false, musicTimer = null, nextLoopT = 0;
function ctx() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === "suspended") AC.resume();
  return AC;
}
function bus(kind) {
  const ac = ctx();
  if (kind === "music") {
    if (!musG) { musG = ac.createGain(); musG.gain.value = 0.12; musG.connect(ac.destination); }
    return musG;
  }
  if (!sfxG) { sfxG = ac.createGain(); sfxG.gain.value = 0.5; sfxG.connect(ac.destination); }
  return sfxG;
}
function tone(freq, t, dur, type, vol, dest, slideTo) {
  const ac = ctx();
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.03);
}
function noise(t, dur, vol, freq, type, dest) {
  const ac = ctx();
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, (ac.sampleRate * 0.5) | 0, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ac.createBufferSource(); src.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = type || "bandpass"; f.frequency.value = freq; f.Q.value = 1;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t); src.stop(t + dur + 0.03);
}
const SFX = {
  draw() { const t = ctx().currentTime, d = bus("sfx"); noise(t, 0.08, 0.25, 3000, "highpass", d); tone(660, t + 0.02, 0.06, "triangle", 0.1, d); },
  rotate() { const t = ctx().currentTime, d = bus("sfx"); tone(700, t, 0.05, "triangle", 0.12, d, 950); },
  place() { const t = ctx().currentTime, d = bus("sfx"); noise(t, 0.04, 0.35, 2400, "bandpass", d); tone(220, t, 0.09, "square", 0.1, d); },
  complete() { const t = ctx().currentTime, d = bus("sfx"); [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.07, 0.14, "triangle", 0.18, d)); },
  pawn() { const t = ctx().currentTime, d = bus("sfx"); tone(880, t, 0.06, "sine", 0.16, d, 1175); },
  discard() { const t = ctx().currentTime, d = bus("sfx"); noise(t, 0.15, 0.2, 900, "bandpass", d); tone(300, t, 0.12, "sine", 0.08, d, 160); },
  bad() { const t = ctx().currentTime, d = bus("sfx"); tone(200, t, 0.09, "square", 0.08, d, 150); },
  win() { const t = ctx().currentTime, d = bus("sfx"); [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.09, 0.16, "triangle", 0.2, d)); [659, 784, 1047, 1568].forEach(f => tone(f, t + 0.5, 0.6, "sine", 0.09, d)); },
  lose() { const t = ctx().currentTime, d = bus("sfx"); tone(392, t, 0.25, "triangle", 0.14, d); tone(311, t + 0.25, 0.4, "triangle", 0.14, d); },
};
// 背景音樂：郊遊小圓舞曲（F 大調，96 BPM）
const BPM = 96, BEAT = 60 / BPM, LOOP_BEATS = 16;
const MELODY = [
  698, null, 880, null, 1047, null, 880, null,
  784, null, 698, null, 587, null, null, null,
  698, null, 880, null, 1047, null, 1175, null,
  1047, null, 880, null, 698, null, null, null,
];
const BASS = [175, 175, 233, 233, 175, 175, 262, 233];
function scheduleLoop(t0) {
  const m = bus("music");
  MELODY.forEach((f, i) => { if (f) tone(f, t0 + i * BEAT * 0.5, BEAT * 0.44, "triangle", 0.16, m); });
  BASS.forEach((f, i) => tone(f, t0 + i * BEAT * 2, BEAT * 1.6, "sine", 0.2, m));
  for (let b = 0.5; b < LOOP_BEATS; b += 2) noise(t0 + b * BEAT, 0.03, 0.07, 6500, "highpass", m);
}
function startMusic() {
  const ac = ctx();
  bus("music").gain.setTargetAtTime(0.12, ac.currentTime, 0.1);
  if (musicPlaying) return;
  musicPlaying = true;
  nextLoopT = ac.currentTime + 0.08;
  const run = () => {
    if (!musicPlaying) return;
    scheduleLoop(nextLoopT);
    nextLoopT += LOOP_BEATS * BEAT;
    musicTimer = setTimeout(run, Math.max(50, (nextLoopT - ctx().currentTime - 0.4) * 1000));
  };
  run();
}
function stopMusic() {
  musicPlaying = false;
  clearTimeout(musicTimer);
  if (musG) { try { musG.disconnect(); } catch (e) { /* noop */ } }
  musG = null;
}

// ---------- 板塊與棋盤引擎 ----------
// 方向：0=上 1=右 2=下 3=左；邊：路(true)或草(false)
const NB = 7, CELLS = NB * NB, START = 3 * NB + 3;
const DXY = [[0, -1], [1, 0], [0, 1], [-1, 0]];
// 板塊型：segs = 路段（edges：碰到的邊；cap：段內封閉端數）
const TYPES = {
  through: { segs: [{ edges: [0, 2], cap: 0 }], glyph: null },
  curve: { segs: [{ edges: [0, 1], cap: 0 }], glyph: null },
  dcurve: { segs: [{ edges: [0, 1], cap: 0 }, { edges: [2, 3], cap: 0 }], glyph: null },
  tee: { segs: [{ edges: [0], cap: 1 }, { edges: [1], cap: 1 }, { edges: [3], cap: 1 }], glyph: "house" },
  cross: { segs: [{ edges: [0], cap: 1 }, { edges: [1], cap: 1 }, { edges: [2], cap: 1 }, { edges: [3], cap: 1 }], glyph: "fountain" },
  dead: { segs: [{ edges: [0], cap: 1 }], glyph: "house" },
};
const DECK_MIX = [["through", 8], ["curve", 8], ["dcurve", 4], ["tee", 6], ["cross", 4], ["dead", 6]];
const PAWN_GOAL = 8;
// 世界座標的邊：canonical e → (e+rot)%4
const wEdge = (e, rot) => (e + rot) % 4;
function edgeRoadWorld(tile) {
  const er = [false, false, false, false];
  for (const s of TYPES[tile.type].segs) for (const e of s.edges) er[wEdge(e, tile.rot)] = true;
  return er;
}
function worldSegs(tile) {
  return TYPES[tile.type].segs.map((s, i) => ({ edges: s.edges.map(e => wEdge(e, tile.rot)), cap: s.cap, kids: tile.segKids[i], i }));
}
// 建牌堆：64 個路段中隨機挑 30 段，各印一個小孩（紅/紫各 15）
function buildDeck() {
  const deck = [];
  for (const [type, n] of DECK_MIX) for (let i = 0; i < n; i++) deck.push({ type, rot: 0, segKids: TYPES[type].segs.map(() => []) });
  const slots = [];
  deck.forEach((t, ti) => TYPES[t.type].segs.forEach((s, si) => slots.push([ti, si])));
  for (let i = slots.length - 1; i > 0; i--) { const j = ri(i + 1); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  const kids = [...Array(15).fill("R"), ...Array(15).fill("M")];
  for (let i = kids.length - 1; i > 0; i--) { const j = ri(i + 1); [kids[i], kids[j]] = [kids[j], kids[i]]; }
  kids.forEach((c, i) => { const [ti, si] = slots[i]; deck[ti].segKids[si].push(c); });
  return deck;
}
function shuffled(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = ri(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; }
function mkGame() {
  let deck = buildDeck();
  // 起始板塊：抽一張十字放中央
  const ci = deck.findIndex(t => t.type === "cross");
  const startTile = { ...deck[ci], rot: 0 };
  deck.splice(ci, 1);
  deck = shuffled(deck);
  const grid = Array(CELLS).fill(null);
  grid[START] = startTile;
  const g = {
    grid, deck, scored: new Set(), pawns: [0, 0], // [紅, 紫]
    pawnMarks: {}, turn: 1, current: null, winner: 0, discards: 0,
  };
  drawNorm(g);
  return g;
}
const cloneG = g => ({
  ...g, grid: g.grid.slice(), deck: g.deck.slice(), scored: new Set(g.scored),
  pawns: g.pawns.slice(), pawnMarks: { ...g.pawnMarks },
});
// 合法放置：格空、至少一鄰居、四邊路草相符
function canPlace(grid, cell, tile) {
  if (grid[cell] !== null) return false;
  const x = cell % NB, y = (cell / NB) | 0;
  const er = edgeRoadWorld(tile);
  let hasNb = false;
  for (let d = 0; d < 4; d++) {
    const nx = x + DXY[d][0], ny = y + DXY[d][1];
    if (nx < 0 || nx >= NB || ny < 0 || ny >= NB) continue;
    const nt = grid[ny * NB + nx];
    if (!nt) continue;
    hasNb = true;
    if (edgeRoadWorld(nt)[(d + 2) % 4] !== er[d]) return false;
  }
  return hasNb;
}
function legalPlacements(grid, tileBase) {
  const out = [];
  for (let rot = 0; rot < 4; rot++) {
    const t = { ...tileBase, rot };
    for (let c = 0; c < CELLS; c++) if (canPlace(grid, c, t)) out.push({ cell: c, rot });
  }
  return out;
}
// 完成偵測：以 (cell,segIdx) 為節點 BFS；回傳完成的路清單（不改動狀態）
function detectComplete(grid, scored, cell, tile) {
  const virt = grid.slice(); virt[cell] = tile;
  const segsAt = c => worldSegs(virt[c]);
  const done = [];
  const seen = new Set();
  for (const s0 of segsAt(cell)) {
    const k0 = cell * 8 + s0.i;
    if (seen.has(k0) || scored.has(k0)) continue;
    const comp = [], stack = [[cell, s0]];
    const local = new Set([k0]);
    let open = 0, oldScored = false;
    while (stack.length) {
      const [c, s] = stack.pop();
      comp.push([c, s]);
      const x = c % NB, y = (c / NB) | 0;
      for (const e of s.edges) {
        const nx = x + DXY[e][0], ny = y + DXY[e][1];
        if (nx < 0 || nx >= NB || ny < 0 || ny >= NB) continue; // 城牆＝封住
        const nc = ny * NB + nx;
        if (!virt[nc]) { open++; continue; }
        const ns = segsAt(nc).find(z => z.edges.includes((e + 2) % 4));
        if (!ns) continue;
        const nk = nc * 8 + ns.i;
        if (scored.has(nk)) oldScored = true;
        if (!local.has(nk)) { local.add(nk); stack.push([nc, ns]); }
      }
    }
    for (const k of local) seen.add(k);
    if (open === 0 && !oldScored) {
      let gr = 0, gm = 0;
      for (const [, s] of comp) for (const kd of s.kids) { if (kd === "R") gr++; else gm++; }
      done.push({ keys: [...local], cells: [...new Set(comp.map(([c]) => c))], gr, gm });
    }
  }
  return done;
}
// 抽牌正規化：抽到完全放不下的板塊就自動棄掉再抽
function drawNorm(g) {
  while (true) {
    if (g.winner) return;
    if (!g.deck.length) { finalCompare(g); return; }
    g.current = g.deck.pop();
    if (legalPlacements(g.grid, g.current).length) return;
    g.discards++;
    g.current = null;
  }
}
function finalCompare(g) {
  g.current = null;
  g.winner = g.pawns[0] === g.pawns[1] ? 3 : (g.pawns[0] > g.pawns[1] ? 1 : 2);
}
// 套用一步（不含訊息）：回傳完成清單供動畫
function applyPlace(g, a) {
  const tile = { ...g.current, rot: a.rot };
  const done = detectComplete(g.grid, g.scored, a.cell, tile);
  g.grid[a.cell] = tile;
  for (const rd of done) {
    for (const k of rd.keys) g.scored.add(k);
    const addR = Math.min(rd.gr, PAWN_GOAL * 2 - 0), addM = rd.gm;
    // 平均撒在這條路的板塊上（純視覺）
    let i = 0;
    for (let n = 0; n < rd.gr; n++) { const c = rd.cells[i++ % rd.cells.length]; const pm = g.pawnMarks[c] || { r: 0, m: 0 }; pm.r++; g.pawnMarks[c] = pm; }
    for (let n = 0; n < rd.gm; n++) { const c = rd.cells[i++ % rd.cells.length]; const pm = g.pawnMarks[c] || { r: 0, m: 0 }; pm.m++; g.pawnMarks[c] = pm; }
    g.pawns[0] = Math.min(PAWN_GOAL, g.pawns[0] + rd.gr);
    g.pawns[1] = Math.min(PAWN_GOAL, g.pawns[1] + rd.gm);
  }
  if (g.pawns[0] >= PAWN_GOAL || g.pawns[1] >= PAWN_GOAL) {
    if (g.pawns[0] >= PAWN_GOAL && g.pawns[1] >= PAWN_GOAL) g.winner = g.turn; // 同時達成：完成者勝
    else g.winner = g.pawns[0] >= PAWN_GOAL ? 1 : 2;
    g.current = null;
    return done;
  }
  g.turn = 3 - g.turn;
  drawNorm(g);
  return done;
}

// ---------- open-loop MCTS（抽牌未知：每次模擬重洗剩餘牌堆）----------
const keyOf = a => `${a.cell}|${a.rot}`;
function immediateGain(g, a, me) {
  const tile = { ...g.current, rot: a.rot };
  const done = detectComplete(g.grid, g.scored, a.cell, tile);
  let gr = 0, gm = 0;
  for (const rd of done) { gr += rd.gr; gm += rd.gm; }
  return me === 1 ? gr - 0.85 * gm : gm - 0.85 * gr;
}
function rolloutPick(g) {
  const legal = legalPlacements(g.grid, g.current);
  if (legal.length === 1) return legal[0];
  let best = null, bs = -Infinity;
  const tries = Math.min(9, legal.length);
  for (let k = 0; k < tries; k++) {
    const a = legal[ri(legal.length)];
    const s = immediateGain(g, a, g.turn) * 10 + rnd();
    if (s > bs) { bs = s; best = a; }
  }
  return best;
}
function evalG(g) {
  if (g.winner === 2) return 1;
  if (g.winner === 1) return 0;
  if (g.winner === 3) return 0.5;
  return clamp(0.5 + 0.07 * (g.pawns[1] - g.pawns[0]), 0.05, 0.95);
}
function stepSim(g, a) {
  applyPlace(g, a);
  return g;
}
function mctsDecide(g0, iters, C = 1.25) {
  const root = { kids: new Map(), visits: 0, val: 0 };
  const rootLegal = legalPlacements(g0.grid, g0.current);
  if (rootLegal.length === 1) return { action: rootLegal[0], total: 0, stats: [] };
  for (let it = 0; it < iters; it++) {
    let s = cloneG(g0);
    s.deck = shuffled(s.deck); // open-loop：未來抽牌每次重洗
    let node = root;
    const path = [root];
    let guard = 0;
    while (s.winner === 0 && guard++ < 40) {
      const legal = legalPlacements(s.grid, s.current);
      if (!legal.length) break;
      const keys = legal.map(keyOf);
      const un = [];
      for (let i = 0; i < keys.length; i++) if (!node.kids.has(keys[i])) un.push(i);
      if (un.length) {
        const i = un[ri(un.length)];
        const child = { kids: new Map(), visits: 0, val: 0 };
        node.kids.set(keys[i], child);
        stepSim(s, legal[i]);
        path.push(child); node = child;
        break;
      }
      const actor = s.turn;
      let bi = 0, bn = null, bv = -Infinity;
      const lnN = Math.log(node.visits + 1);
      for (let i = 0; i < keys.length; i++) {
        const kd = node.kids.get(keys[i]);
        const q = kd.val / kd.visits;
        const u = (actor === 2 ? q : 1 - q) + C * Math.sqrt(lnN / kd.visits);
        if (u > bv) { bv = u; bi = i; bn = kd; }
      }
      stepSim(s, legal[bi]);
      path.push(bn); node = bn;
    }
    let steps = 0;
    while (s.winner === 0 && steps++ < 45) {
      const a = rolloutPick(s);
      if (!a) break;
      stepSim(s, a);
    }
    const v = evalG(s);
    for (const n of path) { n.visits++; n.val += v; }
  }
  let best = rootLegal[0], bv = -1;
  const stats = [];
  for (const a of rootLegal) {
    const kd = root.kids.get(keyOf(a));
    if (!kd) continue;
    stats.push({ a, visits: kd.visits, wr: kd.val / kd.visits });
    if (kd.visits > bv) { bv = kd.visits; best = a; }
  }
  stats.sort((x, y) => y.visits - x.visits);
  return { action: best, total: root.visits, stats: stats.slice(0, 4) };
}
// 🐣 小鴿子（給小小孩）：大多隨便放，偶爾撿現成
function doveDecide(g) {
  const legal = legalPlacements(g.grid, g.current);
  if (rnd() < 0.65) return { action: legal[ri(legal.length)], dove: "wander" };
  let best = legal[0], bs = -Infinity;
  for (let k = 0; k < 6; k++) {
    const a = legal[ri(legal.length)];
    const s = immediateGain(g, a, 2);
    if (s > bs) { bs = s; best = a; }
  }
  return { action: best, dove: "peck" };
}

// ---------- 板塊繪圖 ----------
const TS = 46, HALF = TS / 2;
const MID = [[HALF, 0], [TS, HALF], [HALF, TS], [0, HALF]];
function segPath(edges) {
  if (edges.length === 2) {
    const [a, b] = edges;
    const [ax, ay] = MID[a], [bx, by] = MID[b];
    if ((a + 2) % 4 === b || (b + 2) % 4 === a) return `M ${ax} ${ay} L ${bx} ${by}`;
    return `M ${ax} ${ay} Q ${HALF} ${HALF} ${bx} ${by}`;
  }
  const [a] = edges;
  const [ax, ay] = MID[a];
  return `M ${ax} ${ay} L ${HALF} ${HALF}`;
}
function segKidPos(edges, n, idx) {
  if (edges.length === 2) {
    const [a, b] = edges;
    const [ax, ay] = MID[a], [bx, by] = MID[b];
    const straight = (a + 2) % 4 === b || (b + 2) % 4 === a;
    const t = n === 1 ? 0.5 : idx === 0 ? 0.32 : 0.68;
    if (straight) return [ax + (bx - ax) * t, ay + (by - ay) * t];
    const u = 1 - t;
    return [u * u * ax + 2 * u * t * HALF + t * t * bx, u * u * ay + 2 * u * t * HALF + t * t * by];
  }
  const [a] = edges;
  const [ax, ay] = MID[a];
  return [ax + (HALF - ax) * 0.45, ay + (HALF - ay) * 0.45];
}
function TileSVG({ tile, size = TS, ghost = false }) {
  const segs = worldSegs(tile);
  const glyph = TYPES[tile.type].glyph;
  return (
    <svg viewBox={`0 0 ${TS} ${TS}`} width={size} height={size} style={{ display: "block", opacity: ghost ? 0.55 : 1 }}>
      <rect x={0.5} y={0.5} width={TS - 1} height={TS - 1} rx={5} fill={K.grass} stroke={K.grassD} strokeWidth={1.4} />
      <circle cx={9} cy={9} r={2.2} fill="#8cc06e" /><circle cx={37} cy={38} r={2.6} fill="#8cc06e" />
      {segs.map((s, i) => (
        <g key={i}>
          <path d={segPath(s.edges)} stroke={K.roadEdge} strokeWidth={11} fill="none" strokeLinecap="round" />
          <path d={segPath(s.edges)} stroke={K.road} strokeWidth={8} fill="none" strokeLinecap="round" />
        </g>
      ))}
      {glyph === "house" && <text x={HALF} y={HALF + 5.5} textAnchor="middle" fontSize={15}>🏠</text>}
      {glyph === "fountain" && <text x={HALF} y={HALF + 5.5} textAnchor="middle" fontSize={15}>⛲</text>}
      {segs.map((s, i) => s.kids.map((kd, j) => {
        const [x, y] = segKidPos(s.edges, s.kids.length, j);
        return (
          <g key={`${i}-${j}`}>
            <circle cx={x} cy={y} r={5.2} fill={kd === "R" ? K.red : K.purple} stroke="#fff" strokeWidth={1.6} />
            <circle cx={x - 1.4} cy={y - 1.2} r={0.9} fill="#fff" /><circle cx={x + 1.4} cy={y - 1.2} r={0.9} fill="#fff" />
          </g>
        );
      }))}
    </svg>
  );
}

// ---------- UI 小元件 ----------
function Btn({ children, onClick, disabled, color = K.sun, edge = K.sunEdge, fg = K.ink, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      fontFamily: FONT, fontSize: 14, fontWeight: 900, letterSpacing: 0.5,
      padding: "10px 14px", borderRadius: 14, cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.4 : 1, border: `3px solid ${edge}`, borderBottomWidth: 5,
      background: color, color: fg, ...style,
    }}>{children}</button>
  );
}
function Card({ children, style }) {
  return (
    <section style={{
      background: K.panel, border: `3px solid ${K.panelEdge}`, borderRadius: 20,
      padding: "14px 14px 16px", marginBottom: 12, ...style,
    }}>{children}</section>
  );
}

// ---------- 主元件 ----------
export default function App() {
  const [g, setG] = useState(mkGame);
  const [rot, setRot] = useState(0);
  const [level, setLevel] = useState(350);
  const [log, setLog] = useState(["🏰 歡迎來到鋪路小鎮！輪到你抽的板塊了——選好方向，點發亮的格子放下去。"]);
  const [think, setThink] = useState(null);
  const [flash, setFlash] = useState([]);
  const [helper, setHelper] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [sfxOn, setSfxOn] = useState(true);
  const [musicOn, setMusicOn] = useState(false);
  const gRef = useRef(g); gRef.current = g;
  const sfxRef = useRef(true); sfxRef.current = sfxOn;
  const aiBusy = useRef(false);
  const epoch = useRef(0);

  const dove = level === 30;
  const AIN = dove ? "小鴿子" : "蒙蒙鎮長";
  const AII = dove ? "🐣" : "🎩";

  const fx = n => { if (sfxRef.current) { try { SFX[n](); } catch (e) { /* noop */ } } };
  const pushLog = m => setLog(l => [m, ...l].slice(0, 40));
  const commit = ng => { setG(ng); gRef.current = ng; return ng; };
  function toggleMusic() {
    if (musicOn) { stopMusic(); setMusicOn(false); }
    else { try { startMusic(); setMusicOn(true); } catch (e) { /* noop */ } }
  }
  useEffect(() => () => stopMusic(), []);

  const human = g.turn === 1 && g.winner === 0 && g.current && !thinking && !aiBusy.current;
  const myTile = human ? { ...g.current, rot } : null;
  const legalNow = useMemo(() => {
    if (!myTile) return new Set();
    const s = new Set();
    for (let c = 0; c < CELLS; c++) if (canPlace(g.grid, c, myTile)) s.add(c);
    return s;
  }, [g, rot, human]); // eslint-disable-line
  const anyRotLegal = useMemo(() => (human ? legalPlacements(g.grid, g.current).length > 0 : true), [g, human]);
  // 完成偵測小幫手：這一格放下去會完成幾條路、你拿幾個小木偶
  const gains = useMemo(() => {
    if (!myTile || !helper) return {};
    const out = {};
    for (const c of legalNow) {
      const done = detectComplete(g.grid, g.scored, c, myTile);
      if (!done.length) continue;
      let gr = 0, gm = 0;
      for (const rd of done) { gr += rd.gr; gm += rd.gm; }
      if (gr || gm) out[c] = { gr, gm };
    }
    return out;
  }, [legalNow, myTile, helper, g]);

  function rotate() {
    if (!human) return;
    fx("rotate");
    setRot(r => (r + 1) % 4);
  }
  function humanPlace(c) {
    if (!human) return;
    if (!legalNow.has(c)) { fx("bad"); return; }
    fx("place");
    const ng = cloneG(gRef.current);
    ng.turn = 1;
    const done = applyPlace(ng, { cell: c, rot });
    afterMove(ng, done, 1, `🔴 你把板塊放在第 ${((c / NB) | 0) + 1} 排`);
    setRot(0);
    if (ng.winner === 0) runAI();
  }
  function afterMove(ng, done, who, baseMsg) {
    const prevDisc = gRef.current.discards || 0;
    commit(ng);
    if (done.length) {
      fx("complete");
      const cells = done.flatMap(d => d.cells);
      setFlash(cells);
      setTimeout(() => setFlash([]), 1400);
      for (const rd of done) {
        const bits = [];
        if (rd.gr) bits.push(`小紅 +${rd.gr} 🔴`);
        if (rd.gm) bits.push(`${AIN} +${rd.gm} 🟣`);
        pushLog(`✨ 一條路完成了（${rd.cells.length} 塊）！${bits.length ? bits.join("、") : "路上沒有小孩，大家拍拍手"}`);
        if (rd.gr || rd.gm) setTimeout(() => fx("pawn"), 250);
      }
    } else pushLog(baseMsg);
    if (ng.discards > prevDisc) {
      pushLog(`🗑 有板塊完全放不下，自動棄掉重抽`);
    }
    if (ng.winner) {
      fx(ng.winner === 1 ? "win" : ng.winner === 2 ? "lose" : "complete");
      pushLog(ng.winner === 3 ? `🤝 平手！雙方都放了 ${ng.pawns[0]} 個小木偶`
        : ng.winner === 1 ? "🏆 你先把 8 個小木偶都放上路了——你贏了！"
        : `${AII} ${AIN} 先放完 8 個小木偶，獲勝！`);
    }
  }
  async function runAI() {
    if (aiBusy.current) return;
    aiBusy.current = true;
    const my = epoch.current;
    let s = gRef.current;
    if (s.winner === 0 && s.turn === 2 && s.current) {
      setThinking(true);
      await sleep(dove ? 550 : 120);
      if (epoch.current !== my) { setThinking(false); aiBusy.current = false; return; }
      let action, note, res = null;
      if (dove) {
        const d = doveDecide(s);
        action = d.action;
        note = d.dove === "wander" ? "🐣 小鴿子叼著板塊隨便一放" : "🐣 小鴿子眼睛一亮，放在好地方！";
      } else {
        const t0 = performance.now();
        res = mctsDecide(s, level);
        res.ms = performance.now() - t0;
        action = res.action;
        note = `🎩 ${AIN} 放好板塊（模擬 ${res.total} 局）`;
        setThink(res);
      }
      setThinking(false);
      await sleep(350);
      if (epoch.current !== my) { aiBusy.current = false; return; }
      s = cloneG(gRef.current);
      s.turn = 2;
      fx("place");
      const done = applyPlace(s, action);
      afterMove(s, done, 2, note);
    }
    aiBusy.current = false;
  }
  function restart() {
    epoch.current++;
    aiBusy.current = false;
    commit(mkGame());
    setRot(0);
    setLog(["🏰 新的小鎮開工！輪到你先放。"]);
    setThink(null); setFlash([]); setThinking(false);
  }

  const status = g.winner !== 0
    ? (g.winner === 3 ? "🤝 平手！" : g.winner === 1 ? "🏆 你贏了！" : `${AII} ${AIN} 獲勝`)
    : thinking ? (dove ? "🐣 小鴿子歪著頭想…" : `🧠 ${AIN}思考中…（把剩下的牌堆重洗 ${level} 遍）`)
    : !g.current ? "整理牌堆中…"
    : g.turn === 1 ? (anyRotLegal ? "輪到你！轉好方向，點發亮的格子" : "這塊放不下，自動棄掉…")
    : `${AII} ${AIN}的回合…`;

  const cellPx = 46;

  return (
    <div style={{ minHeight: "100vh", background: K.bg, color: K.ink, fontFamily: FONT }}>
      <style>{`
        @keyframes pulseC { 0%,100%{opacity:.9} 50%{opacity:.35} }
        @keyframes popIn { 0%{transform:scale(.4)} 70%{transform:scale(1.15)} 100%{transform:scale(1)} }
        @keyframes flashR { 0%,100%{fill-opacity:.0} 50%{fill-opacity:.45} }
      `}</style>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 12px 40px" }}>

        <header style={{ textAlign: "center", marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 900, letterSpacing: 2, color: "#fff", textShadow: "0 3px 0 #4e8f74" }}>
            🏰 卡卡頌兒童版 🛤️
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#eafff5", fontWeight: 700 }}>
            鋪路、蓋小鎮——路完成時，路上是誰家的小孩，誰就放小木偶。先放完 8 個就贏！
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 8, flexWrap: "wrap" }}>
            <Btn onClick={toggleMusic} color={musicOn ? K.teal : "#fff"} edge={musicOn ? K.tealEdge : "#bcd6ce"}
              fg={musicOn ? "#fff" : K.ink} style={{ padding: "6px 12px", fontSize: 12 }}>
              {musicOn ? "🎵 音樂 開" : "🎵 音樂 關"}
            </Btn>
            <Btn onClick={() => { if (!sfxOn) { try { ctx(); } catch (e) { /* noop */ } } setSfxOn(!sfxOn); }}
              color={sfxOn ? K.teal : "#fff"} edge={sfxOn ? K.tealEdge : "#bcd6ce"} fg={sfxOn ? "#fff" : K.ink}
              style={{ padding: "6px 12px", fontSize: 12 }}>
              {sfxOn ? "🔊 音效 開" : "🔇 音效 關"}
            </Btn>
            <Btn onClick={restart} color="#fff" edge="#bcd6ce" style={{ padding: "6px 12px", fontSize: 12 }}>↺ 重新開始</Btn>
            <select value={level} onChange={e => setLevel(+e.target.value)}
              style={{ fontFamily: FONT, fontWeight: 900, fontSize: 12, borderRadius: 12, border: `3px solid ${K.panelEdge}`, padding: "5px 8px", background: "#fff", color: K.ink }}>
              <option value={30}>🐣 小鴿子（小小孩）</option>
              <option value={350}>🎩 蒙蒙鎮長（350 局）</option>
              <option value={900}>🎓 鎮長大師（900 局）</option>
            </select>
          </div>
        </header>

        {/* 計分板 */}
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          {[0, 1].map(p => {
            const active = g.turn === p + 1 && g.winner === 0;
            const col = p === 0 ? K.red : K.purple, cold = p === 0 ? K.redD : K.purpleD;
            return (
              <Card key={p} style={{
                flex: 1, marginBottom: 0, padding: "10px 12px",
                border: `3px solid ${active ? col : K.panelEdge}`,
                boxShadow: active ? `0 0 0 3px ${col}55` : "none",
              }}>
                <div style={{ fontWeight: 900, fontSize: 14, color: cold }}>
                  {p === 0 ? "🔴 小紅（你）" : `${AII} ${AIN}`}
                  {p === 1 && !dove && <span style={{ fontSize: 10, background: K.purple, color: "#fff", borderRadius: 8, padding: "1px 6px", marginLeft: 6 }}>MCTS</span>}
                </div>
                <div style={{ fontSize: 15, letterSpacing: 1, margin: "4px 0" }}>
                  {Array.from({ length: PAWN_GOAL }, (_, i) => (
                    <span key={i} style={{ opacity: i < g.pawns[p] ? 1 : 0.22 }}>{p === 0 ? "🔴" : "🟣"}</span>
                  ))}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11.5, color: K.sub, fontWeight: 700 }}>
                  已放 {g.pawns[p]}/{PAWN_GOAL} 個小木偶
                </div>
              </Card>
            );
          })}
        </div>

        <div style={{
          background: "#fff", border: `3px solid ${K.panelEdge}`, borderRadius: 14,
          padding: "8px 12px", marginBottom: 10, fontWeight: 900, fontSize: 13.5, textAlign: "center",
        }}>{status}</div>

        {g.winner !== 0 && (
          <Card style={{
            textAlign: "center", background: g.winner === 1 ? "#eafff3" : "#fff0f0",
            border: `3px solid ${g.winner === 1 ? K.teal : K.red}`, animation: "popIn .5s ease",
          }}>
            <div style={{ fontSize: 25, fontWeight: 900 }}>
              {g.winner === 3 ? "🤝 平手！" : g.winner === 1 ? "🏆🎉 你贏了！" : `${AII} ${AIN} 獲勝！`}
            </div>
            <div style={{ fontSize: 13, color: K.sub, margin: "6px 0 10px" }}>
              小木偶 {g.pawns[0]} : {g.pawns[1]}｜牌堆剩 {g.deck.length} 塊
            </div>
            <Btn onClick={restart} color={K.teal} edge={K.tealEdge} fg="#fff">🔁 再蓋一座小鎮</Btn>
          </Card>
        )}

        {/* 手上的板塊 */}
        {human && g.current && (
          <Card style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6 }}>你抽到的板塊（牌堆剩 {g.deck.length}）</div>
              <div style={{ border: `3px solid ${K.panelEdge}`, borderRadius: 12, padding: 4, width: "fit-content", background: "#fff" }}>
                <TileSVG tile={myTile} size={84} />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Btn onClick={rotate}>↻ 轉個方向</Btn>
              <Btn onClick={() => setHelper(h => !h)} color={helper ? K.teal : "#fff"} edge={helper ? K.tealEdge : "#bcd6ce"}
                fg={helper ? "#fff" : K.ink} style={{ fontSize: 12, padding: "8px 10px" }}>
                ✨ 完成偵測 {helper ? "開" : "關"}
              </Btn>
              <div style={{ fontSize: 11.5, color: K.sub, maxWidth: 190, lineHeight: 1.6 }}>
                發亮的格子可以放；有 ✨ 數字的格子放下去會完成道路、馬上拿小木偶！
              </div>
            </div>
          </Card>
        )}

        {/* 小鎮棋盤 */}
        <Card style={{ padding: 10 }}>
          <div style={{
            display: "grid", gridTemplateColumns: `repeat(${NB}, ${cellPx}px)`, gap: 3,
            background: K.wall, padding: 8, borderRadius: 14, width: "fit-content", margin: "0 auto",
            border: `4px solid #8a6540`,
          }}>
            {Array.from({ length: CELLS }, (_, c) => {
              const t = g.grid[c];
              const legal = legalNow.has(c);
              const gn = gains[c];
              const pm = g.pawnMarks[c];
              const flashing = flash.includes(c);
              return (
                <div key={c} onClick={() => humanPlace(c)} style={{
                  width: cellPx, height: cellPx, borderRadius: 6, position: "relative",
                  background: t ? "transparent" : "#9db98c55",
                  outline: legal ? `3px solid ${K.sun}` : "none", outlineOffset: -2,
                  cursor: legal ? "pointer" : "default",
                  animation: legal && !gn ? "pulseC 1.2s infinite" : "none",
                }}>
                  {t && <TileSVG tile={t} size={cellPx} />}
                  {flashing && (
                    <svg width={cellPx} height={cellPx} style={{ position: "absolute", inset: 0 }}>
                      <rect x={1} y={1} width={cellPx - 2} height={cellPx - 2} rx={6} fill={K.sun} style={{ animation: "flashR 0.7s 2" }} />
                    </svg>
                  )}
                  {gn && (
                    <div style={{
                      position: "absolute", top: -6, right: -6, background: gn.gr >= (gn.gm || 0) ? K.red : K.purple,
                      color: "#fff", borderRadius: 10, fontSize: 10.5, fontWeight: 900, padding: "2px 5px",
                      border: "2px solid #fff", animation: "pulseC 0.9s infinite",
                    }}>✨{gn.gr ? `+${gn.gr}` : `紫+${gn.gm}`}</div>
                  )}
                  {pm && (pm.r > 0 || pm.m > 0) && (
                    <div style={{ position: "absolute", bottom: 1, left: 2, display: "flex", gap: 1 }}>
                      {pm.r > 0 && <span style={{ fontSize: 10, background: "#ffffffd9", borderRadius: 8, padding: "0 3px", fontWeight: 900, color: K.redD }}>🔴{pm.r > 1 ? pm.r : ""}</span>}
                      {pm.m > 0 && <span style={{ fontSize: 10, background: "#ffffffd9", borderRadius: 8, padding: "0 3px", fontWeight: 900, color: K.purpleD }}>🟣{pm.m > 1 ? pm.m : ""}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ textAlign: "center", fontSize: 11.5, color: K.sub, marginTop: 8, fontWeight: 700 }}>
            🧱 小鎮外圍是城牆：路碰到城牆就算封住囉
          </div>
        </Card>

        {/* 鎮長的思考 */}
        {!dove && (
          <Card>
            <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 6 }}>🧠 {AIN}的思考透視</div>
            {think && think.stats && think.stats.length ? (
              <div>
                <div style={{ fontSize: 11.5, color: K.sub, marginBottom: 8 }}>
                  抽牌看不見未來——他把剩餘牌堆重洗 {think.total} 遍、每遍玩到終局，統計每個放法的勝率（open-loop MCTS）・{think.ms?.toFixed(0)} ms
                </div>
                {think.stats.map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                    <span style={{ fontFamily: MONO, fontSize: 11.5, width: 86, fontWeight: 700, color: i === 0 ? K.purpleD : K.sub }}>
                      {String.fromCharCode(65 + s.a.cell % NB)}{((s.a.cell / NB) | 0) + 1}・轉{s.a.rot * 90}°
                    </span>
                    <div style={{ flex: 1, height: 8, background: "#f0e6cf", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${s.wr * 100}%`, height: "100%", background: i === 0 ? K.purple : "#c9b8f5" }} />
                    </div>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: K.sub, width: 96, textAlign: "right" }}>{s.visits} 局・{(s.wr * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            ) : <div style={{ fontSize: 12.5, color: K.sub }}>（{AIN}放過板塊後，這裡會顯示他考慮過的位置）</div>}
          </Card>
        )}

        {/* 日誌 */}
        <Card>
          <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 8 }}>📜 小鎮日誌</div>
          <div style={{ maxHeight: 160, overflowY: "auto" }}>
            {log.map((m, i) => (
              <div key={i} style={{
                fontSize: 12.5, fontWeight: 700, color: i === 0 ? K.ink : K.sub,
                background: i === 0 ? "#fff" : "transparent",
                borderRadius: 10, padding: "5px 8px", marginBottom: 3,
              }}>{m}</div>
            ))}
          </div>
        </Card>

        {/* 規則 */}
        <Card>
          <details>
            <summary style={{ fontWeight: 900, fontSize: 14, cursor: "pointer" }}>📖 怎麼玩？（給小鎮民和爸媽）</summary>
            <div style={{ fontSize: 13, lineHeight: 1.9, marginTop: 8 }}>
              🧩 輪到你就會抽一塊板塊：轉好方向，放進發亮的格子——邊要對邊（<b>路接路、草接草</b>），而且要貼著已有的板塊。完全放不下的板塊會自動棄掉重抽。<br />
              🛤️ 板塊上的路會越接越長。一條路「<b>兩頭都封住</b>」就完成——封住的方式：接到 🏠 房子、⛲ 廣場、繞成一圈，或碰到小鎮的城牆。<br />
              🧒 路上印著彩色小孩：路完成時，上面有幾個你家（🔴）的小孩，你就放幾個小木偶；紫色小孩則是{AIN}的。同一條路常常兩家都有——挑「你比較多」的路來完成才划算！<br />
              🏆 先把 <b>8 個小木偶</b>全放上路的人獲勝；牌堆用完就比誰放得多。若一塊板塊讓兩人同時達成 8 個，放板塊的人獲勝。<br />
              ✨ 「完成偵測」小幫手會標出「這一格放下去馬上完成道路」的位置和可拿的小木偶數——給小小鎮民的透視眼鏡。<br />
              <span style={{ color: K.sub }}>🧠 {`蒙蒙鎮長的祕密：抽牌是未知的，所以他用 open-loop MCTS——每次模擬把「剩下的牌堆」重新洗過、在腦中玩到終局，重複幾百遍後挑被驗證最多次的放法。和卡坦島的鬍鬍船長是同一門功夫，對付的都是「看不見的未來」。`}</span><br />
              <span style={{ color: K.sub }}>※ 本遊戲為向《My First Carcassonne》致敬的雙人改編版（7×7 城牆、雙色小孩、規則微調），適合親子同樂，非官方版本。</span>
            </div>
          </details>
        </Card>
      </div>
    </div>
  );
}
