import { useState, useRef, useEffect } from "react";

/* ============================================================
   關卡鍛造坊 — 用 MCTS 生成「保證可解、難度可控」的倉庫番謎題
   ・可解性：反向拉動法（構造上保證，不是碰運氣）
   ・難度：MCTS 在可解空間中搜尋最難的盤面
   ・驗證：BFS 求解器量出真實最短推法，並可播放解答
   ============================================================ */

// ---------- 視覺（深夜倉庫・木箱職人）----------
const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
const SERIF = "'Songti TC','Noto Serif TC',serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const K = {
  bg: "#100e0a", panel: "#1b1710", panel2: "#151209", line: "#2f291d",
  text: "#efe8d8", dim: "#9b9179",
  amber: "#e2a95c", amberD: "#8a5f28", teal: "#46d6ac", rose: "#ef6f6f",
  floor: "#1d1912", wall: "#3b3322", wallEdge: "#4d4128",
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DIRS = [
  { dx: 0, dy: -1, arrow: "↑", name: "上" },
  { dx: 0, dy: 1, arrow: "↓", name: "下" },
  { dx: -1, dy: 0, arrow: "←", name: "左" },
  { dx: 1, dy: 0, arrow: "→", name: "右" },
];

// ---------- 音訊引擎（Web Audio 即時合成，無外部音檔）----------
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
    if (!musG) { musG = ac.createGain(); musG.gain.value = 0.13; musG.connect(ac.destination); }
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
// --- 音效 ---
const SFX = {
  step() { const t = ctx().currentTime, d = bus("sfx"); tone(190 + Math.random() * 30, t, 0.05, "triangle", 0.12, d); },
  push() { const t = ctx().currentTime, d = bus("sfx"); noise(t, 0.14, 0.35, 260, "lowpass", d); tone(85, t, 0.12, "sine", 0.3, d, 55); },
  bump() { const t = ctx().currentTime, d = bus("sfx"); tone(70, t, 0.07, "square", 0.1, d, 50); },
  goal() { const t = ctx().currentTime, d = bus("sfx"); tone(1047, t, 0.16, "sine", 0.22, d); tone(1568, t + 0.07, 0.2, "sine", 0.16, d); },
  undo() { const t = ctx().currentTime, d = bus("sfx"); tone(420, t, 0.09, "triangle", 0.14, d, 240); },
  win() {
    const t = ctx().currentTime, d = bus("sfx");
    [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.1, 0.18, "triangle", 0.22, d));
    [523, 659, 784, 1319].forEach(f => tone(f, t + 0.45, 0.55, "sine", 0.1, d));
  },
  forge() {
    const t = ctx().currentTime, d = bus("sfx");
    noise(t, 0.05, 0.4, 2400, "bandpass", d); tone(1170, t, 0.1, "square", 0.1, d, 900);
    noise(t + 0.13, 0.05, 0.3, 2000, "bandpass", d); tone(880, t + 0.13, 0.1, "square", 0.08, d, 700);
    tone(660, t + 0.3, 0.3, "sine", 0.14, d, 1320);
  },
};
// --- 背景音樂：A 小調五聲音階的夜間工坊小調（16 拍循環，前瞻排程）---
const BPM = 92, BEAT = 60 / BPM, LOOP_BEATS = 16;
const MELODY = [ // 每半拍一格，null 為休止
  440, null, 523, null, 659, null, 587, 523,
  440, null, 392, null, 330, null, null, null,
  440, null, 523, null, 659, null, 784, 659,
  587, 523, 440, null, 392, null, null, null,
];
const BASS = [110, 110, 98, 82.4, 110, 110, 98, 123.5]; // 每 2 拍一音
function scheduleLoop(t0) {
  const m = bus("music");
  MELODY.forEach((f, i) => { if (f) tone(f, t0 + i * BEAT * 0.5, BEAT * 0.48, "triangle", 0.2, m); });
  BASS.forEach((f, i) => tone(f, t0 + i * BEAT * 2, BEAT * 1.6, "sine", 0.24, m));
  for (let b = 0; b < LOOP_BEATS; b += 2) noise(t0 + b * BEAT, 0.03, 0.1, 5000, "highpass", m);
}
function startMusic() {
  const ac = ctx();
  bus("music").gain.setTargetAtTime(0.13, ac.currentTime, 0.1);
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
  if (musG) { try { musG.disconnect(); } catch (e) { /* noop */ } musG = null; }
}

// ---------- 盤面基礎 ----------
function makeRoom(W, H, density, rng) {
  for (let t = 0; t < 120; t++) {
    const cells = new Uint8Array(W * H); // 0 地板 1 牆
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) cells[y * W + x] = 1;
      else if (rng() < density) cells[y * W + x] = 1;
    }
    const floors = [];
    for (let i = 0; i < W * H; i++) if (cells[i] === 0) floors.push(i);
    if (floors.length < 12) continue;
    // 連通性
    const seen = new Uint8Array(W * H);
    const q = [floors[0]]; seen[floors[0]] = 1; let cnt = 1;
    while (q.length) {
      const c = q.pop(); const x = c % W, y = (c / W) | 0;
      for (const d of DIRS) {
        const nx = x + d.dx, ny = y + d.dy, n = ny * W + nx;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && cells[n] === 0 && !seen[n]) { seen[n] = 1; cnt++; q.push(n); }
      }
    }
    if (cnt === floors.length) return cells;
  }
  // 保底：空房
  const cells = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) cells[y * W + x] = 1;
  return cells;
}

function reach(cells, W, H, boxSet, from) {
  const seen = new Uint8Array(W * H);
  if (from < 0) return seen;
  const q = [from]; seen[from] = 1;
  while (q.length) {
    const c = q.pop(); const x = c % W, y = (c / W) | 0;
    for (const d of DIRS) {
      const nx = x + d.dx, ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (cells[n] === 0 && !boxSet.has(n) && !seen[n]) { seen[n] = 1; q.push(n); }
    }
  }
  return seen;
}

function distToGoals(cells, W, H, goals) {
  const dist = new Int16Array(W * H).fill(-1);
  const q = [];
  for (const g of goals) { dist[g] = 0; q.push(g); }
  let head = 0;
  while (head < q.length) {
    const c = q[head++]; const x = c % W, y = (c / W) | 0;
    for (const d of DIRS) {
      const nx = x + d.dx, ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (cells[n] === 0 && dist[n] === -1) { dist[n] = dist[c] + 1; q.push(n); }
    }
  }
  return dist;
}

// 反向拉動：合法拉法（箱 b 往 d 方向被拉一格）
function legalPulls(cells, W, H, boxes, player) {
  const boxSet = new Set(boxes);
  const R = reach(cells, W, H, boxSet, player);
  const out = [];
  for (let bi = 0; bi < boxes.length; bi++) {
    const b = boxes[bi]; const bx = b % W, by = (b / W) | 0;
    for (let di = 0; di < 4; di++) {
      const d = DIRS[di];
      const p1x = bx + d.dx, p1y = by + d.dy, p2x = bx + 2 * d.dx, p2y = by + 2 * d.dy;
      if (p2x < 0 || p2y < 0 || p2x >= W || p2y >= H) continue;
      const p1 = p1y * W + p1x, p2 = p2y * W + p2x;
      if (cells[p1] || cells[p2] || boxSet.has(p1) || boxSet.has(p2)) continue;
      if (!R[p1]) continue;
      out.push({ bi, di });
    }
  }
  return out;
}
function applyPull(W, s, pull) {
  const d = DIRS[pull.di];
  const b = s.boxes[pull.bi];
  const p1 = b + d.dy * W + d.dx, p2 = b + 2 * d.dy * W + 2 * d.dx;
  const boxes = s.boxes.slice(); boxes[pull.bi] = p1;
  return { boxes, player: p2, depth: s.depth + 1 };
}

// 難度啟發式（rollout 評分用；真實難度以求解器為準）
function heuristic(W, s, goalSet, dist, startPlayer) {
  let h = 2.0 * s.depth;
  for (const b of s.boxes) {
    const d = dist[b] < 0 ? 0 : dist[b];
    h += 3.0 * d;
    if (goalSet.has(b)) h -= 18;
  }
  for (let i = 0; i < s.boxes.length; i++) for (let j = i + 1; j < s.boxes.length; j++) {
    const a = s.boxes[i], c = s.boxes[j];
    const m = Math.abs(a % W - c % W) + Math.abs(((a / W) | 0) - ((c / W) | 0));
    if (m <= 2) h += 2;
  }
  h += 0.6 * (Math.abs(s.player % W - startPlayer % W) + Math.abs(((s.player / W) | 0) - ((startPlayer / W) | 0)));
  return h;
}

// ---------- MCTS：在「保證可解」的空間裡搜最難的一關 ----------
// 轉移完全確定 → closed-loop：每個節點記住自己的盤面
function mctsScramble(cells, W, H, goals, startBoxes, startPlayer, depthMax, iters, C) {
  const goalSet = new Set(goals);
  const dist = distToGoals(cells, W, H, goals);
  const mk = (parent, pull, state) => ({
    parent, pull, state, kids: [],
    untried: state.depth < depthMax ? legalPulls(cells, W, H, state.boxes, state.player) : [],
    visits: 0, val: 0,
  });
  const root = mk(null, null, { boxes: startBoxes.slice(), player: startPlayer, depth: 0 });
  let best = { score: -Infinity, state: root.state };
  let expanded = 0;
  const consider = s => {
    const sc = heuristic(W, s, goalSet, dist, startPlayer);
    if (sc > best.score) best = { score: sc, state: s };
    return sc;
  };
  for (let it = 0; it < iters; it++) {
    let node = root;
    // 1. 選擇
    while (node.untried.length === 0 && node.kids.length > 0) {
      let bn = null, bv = -Infinity;
      const lnN = Math.log(node.visits + 1);
      for (const ch of node.kids) {
        const u = ch.val / ch.visits + C * Math.sqrt(lnN / ch.visits);
        if (u > bv) { bv = u; bn = ch; }
      }
      node = bn;
    }
    // 2. 擴展
    if (node.untried.length > 0) {
      const pull = node.untried.splice(Math.floor(Math.random() * node.untried.length), 1)[0];
      const child = mk(node, pull, applyPull(W, node.state, pull));
      node.kids.push(child); node = child; expanded++;
    }
    // 3. 模擬（隨機亂拉到深度上限＝AI 自動試玩）
    let s = node.state;
    while (s.depth < depthMax) {
      const pulls = legalPulls(cells, W, H, s.boxes, s.player);
      if (!pulls.length) break;
      s = applyPull(W, s, pulls[Math.floor(Math.random() * pulls.length)]);
    }
    const sc = consider(s);
    // 4. 回傳（正規化到 0–1 供 UCB 使用）
    const norm = sc / (sc + 80);
    let n = node;
    while (n) { n.visits++; n.val += norm; n = n.parent; }
  }
  const rootTop = [...root.kids].sort((a, b) => b.visits - a.visits).slice(0, 6).map(k => {
    const b = root.state.boxes[k.pull.bi];
    return {
      label: `箱(${(b / W) | 0},${b % W}) ${DIRS[k.pull.di].arrow}`,
      visits: k.visits, score: k.val / Math.max(1, k.visits),
    };
  });
  return { best, expanded, rootTop };
}

// ---------- BFS 求解器（推的狀態空間）：驗證＋量難度＋解答 ----------
function solve(cells, W, H, goals, boxes0, player0, cap = 220000) {
  const goalSet = new Set(goals);
  const isCornerDead = b => {
    if (goalSet.has(b)) return false;
    const wU = cells[b - W] === 1, wD = cells[b + W] === 1, wL = cells[b - 1] === 1, wR = cells[b + 1] === 1;
    return (wU && wL) || (wU && wR) || (wD && wL) || (wD && wR);
  };
  const keyOf = (boxes, R) => {
    let rep = -1;
    for (let i = 0; i < R.length; i++) if (R[i]) { rep = i; break; }
    return boxes.join(",") + "|" + rep;
  };
  const start = { boxes: [...boxes0].sort((a, b) => a - b), player: player0 };
  const R0 = reach(cells, W, H, new Set(start.boxes), start.player);
  const startKey = keyOf(start.boxes, R0);
  const parent = new Map(); parent.set(startKey, null);
  const info = new Map(); info.set(startKey, start);
  let frontier = [startKey];
  let depth = 0, explored = 1, goalKey = null;
  const solvedNow = k => info.get(k).boxes.every(b => goalSet.has(b));
  if (solvedNow(startKey)) goalKey = startKey;
  while (frontier.length && !goalKey) {
    const next = [];
    for (const k of frontier) {
      const st = info.get(k);
      const boxSet = new Set(st.boxes);
      const R = reach(cells, W, H, boxSet, st.player);
      for (let bi = 0; bi < st.boxes.length; bi++) {
        const b = st.boxes[bi]; const bx = b % W, by = (b / W) | 0;
        for (let di = 0; di < 4; di++) {
          const d = DIRS[di];
          const fromX = bx - d.dx, fromY = by - d.dy, toX = bx + d.dx, toY = by + d.dy;
          if (fromX < 0 || fromY < 0 || fromX >= W || fromY >= H || toX < 0 || toY < 0 || toX >= W || toY >= H) continue;
          const from = fromY * W + fromX, to = toY * W + toX;
          if (cells[from] || cells[to] || boxSet.has(from) || boxSet.has(to) || !R[from]) continue;
          if (isCornerDead(to)) continue;
          const nb = st.boxes.slice(); nb[bi] = to; nb.sort((x, y) => x - y);
          const nR = reach(cells, W, H, new Set(nb), b);
          const nk = keyOf(nb, nR);
          if (parent.has(nk)) continue;
          parent.set(nk, { from: k, box: b, di, stand: from });
          info.set(nk, { boxes: nb, player: b });
          explored++;
          if (explored > cap) return null;
          if (nb.every(x => goalSet.has(x))) { goalKey = nk; break; }
          next.push(nk);
        }
        if (goalKey) break;
      }
      if (goalKey) break;
    }
    frontier = next; depth++;
  }
  if (!goalKey) return null;
  // 回溯推序列
  const pushSeq = [];
  let k = goalKey;
  while (parent.get(k)) {
    const e = parent.get(k);
    pushSeq.push(e);
    k = e.from;
  }
  pushSeq.reverse();
  // 展開成完整步（走路＋推）
  const moves = [];
  let boxes = [...boxes0].sort((a, b) => a - b);
  let pl = player0;
  for (const p of pushSeq) {
    // 走到推點 p.stand
    const boxSet = new Set(boxes);
    const prev = new Int32Array(W * H).fill(-2);
    const q = [pl]; prev[pl] = -1;
    while (q.length) {
      const c = q.shift();
      if (c === p.stand) break;
      const x = c % W, y = (c / W) | 0;
      for (let di = 0; di < 4; di++) {
        const nx = x + DIRS[di].dx, ny = y + DIRS[di].dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (cells[n] === 0 && !boxSet.has(n) && prev[n] === -2) { prev[n] = c * 4 + di; q.push(n); }
      }
    }
    const walk = [];
    let c = p.stand;
    while (prev[c] !== -1) { walk.push(prev[c] % 4); c = (prev[c] / 4) | 0; }
    walk.reverse();
    for (const di of walk) moves.push({ di, push: false });
    moves.push({ di: p.di, push: true });
    // 更新
    const idx = boxes.indexOf(p.box);
    boxes[idx] = p.box + DIRS[p.di].dy * W + DIRS[p.di].dx;
    boxes.sort((a, b) => a - b);
    pl = p.box;
  }
  return { pushes: pushSeq.length, moves, explored };
}

// ---------- 生成管線 ----------
function generateLevel(params) {
  const { W, H, nBoxes, density, depthMax, iters, C } = params;
  const rng = Math.random;
  let bestLv = null;
  let attempts = 0;
  const t0 = performance.now();
  for (let a = 0; a < 4; a++) {
    attempts++;
    const cells = makeRoom(W, H, density, rng);
    // 放終點（需至少一個合法拉向）＋玩家
    const floors = [];
    for (let i = 0; i < W * H; i++) if (cells[i] === 0) floors.push(i);
    if (floors.length < nBoxes * 3 + 4) continue;
    let goals = null, player = -1;
    for (let t = 0; t < 250; t++) {
      const g = [];
      const pool = floors.slice();
      for (let i = 0; i < nBoxes; i++) g.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      const gs = new Set(g);
      const ok = g.every(b => DIRS.some(d => {
        const p1 = b + d.dy * W + d.dx, p2 = b + 2 * d.dy * W + 2 * d.dx;
        const p2x = b % W + 2 * d.dx, p2y = ((b / W) | 0) + 2 * d.dy;
        if (p2x < 0 || p2y < 0 || p2x >= W || p2y >= H) return false;
        return !cells[p1] && !cells[p2] && !gs.has(p1) && !gs.has(p2);
      }));
      if (!ok) continue;
      const pc = pool[Math.floor(rng() * pool.length)];
      if (legalPulls(cells, W, H, g, pc).length === 0) continue;
      goals = g; player = pc; break;
    }
    if (!goals) continue;
    // MCTS 打亂
    const { best, expanded, rootTop } = mctsScramble(cells, W, H, goals, goals, player, depthMax, iters, C);
    // 驗證＋量難度
    const sol = solve(cells, W, H, goals, best.state.boxes, best.state.player);
    if (!sol) continue;
    const lv = {
      W, H, cells, goals, goalSet: new Set(goals),
      boxes0: best.state.boxes.slice(), player0: best.state.player,
      solution: sol,
      gen: { iters, expanded, heur: best.score, depthUsed: best.state.depth, rootTop, attempts },
    };
    if (!bestLv || sol.pushes > bestLv.solution.pushes) bestLv = lv;
    if (bestLv.solution.pushes >= Math.max(4, depthMax * 0.45)) break;
  }
  if (bestLv) bestLv.gen.ms = performance.now() - t0;
  return bestLv;
}

const starsOf = p => p < 4 ? 1 : p < 8 ? 2 : p < 13 ? 3 : p < 19 ? 4 : 5;

// ---------- 遊玩邏輯 ----------
function computeMove(lv, p, di) {
  if (p.won) return p;
  const W = lv.W, d = DIRS[di];
  const t = p.player + d.dy * W + d.dx;
  if (lv.cells[t]) return p;
  const bIdx = p.boxes.indexOf(t);
  let boxes = p.boxes, pushed = false;
  if (bIdx >= 0) {
    const t2 = t + d.dy * W + d.dx;
    if (lv.cells[t2] || p.boxes.includes(t2)) return p;
    boxes = p.boxes.slice(); boxes[bIdx] = t2; pushed = true;
  }
  const won = boxes.every(b => lv.goalSet.has(b));
  return {
    boxes, player: t, steps: p.steps + 1, pushes: p.pushes + (pushed ? 1 : 0),
    history: [...p.history.slice(-199), { boxes: p.boxes, player: p.player, steps: p.steps, pushes: p.pushes }],
    won,
  };
}
const freshPlay = lv => ({ boxes: lv.boxes0.slice(), player: lv.player0, steps: 0, pushes: 0, history: [], won: false });

// ---------- UI 元件 ----------
function Card({ title, sub, children, accent }) {
  return (
    <section style={{ background: K.panel, border: `1px solid ${K.line}`, borderRadius: 14, padding: "16px 16px 18px", marginBottom: 14 }}>
      {title && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: accent || K.amber }} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>{title}</h2>
          </div>
          {sub && <p style={{ margin: "4px 0 0 16px", fontSize: 12, color: K.dim }}>{sub}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
function Btn({ children, onClick, disabled, kind = "solid", color = K.amber, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      fontFamily: FONT, fontSize: 13.5, fontWeight: 700, letterSpacing: 0.5,
      padding: "10px 16px", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.45 : 1,
      border: `1px solid ${kind === "solid" ? color : K.line}`,
      background: kind === "solid" ? color : "transparent",
      color: kind === "solid" ? "#241a08" : K.text, ...style,
    }}>{children}</button>
  );
}
function Slider({ label, value, onChange, min, max, step = 1, unit = "", hint }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
        <span style={{ color: K.dim }}>{label}{hint && <span style={{ opacity: 0.7 }}>・{hint}</span>}</span>
        <span style={{ fontFamily: MONO, fontWeight: 700 }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)} style={{ width: "100%", accentColor: K.amber }} />
    </div>
  );
}

function Board({ lv, boxes, player }) {
  const { W, H, cells, goalSet } = lv;
  const S = 40;
  const boxSet = new Set(boxes);
  const tiles = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (cells[i]) {
      tiles.push(<rect key={"w" + i} x={x * S} y={y * S} width={S} height={S} fill={K.wall} stroke={K.wallEdge} strokeWidth={2} rx={3} />);
    } else {
      tiles.push(<rect key={"f" + i} x={x * S} y={y * S} width={S} height={S} fill={K.floor} stroke="#000" strokeOpacity={0.25} strokeWidth={1} />);
      if (goalSet.has(i)) {
        tiles.push(<circle key={"g" + i} cx={x * S + S / 2} cy={y * S + S / 2} r={8}
          fill={boxSet.has(i) ? K.teal : "none"} fillOpacity={0.25}
          stroke={K.teal} strokeWidth={2.5} strokeDasharray={boxSet.has(i) ? "none" : "3 3"} />);
      }
    }
  }
  const boxEls = boxes.map((b, bi) => {
    const x = b % W, y = (b / W) | 0;
    const on = goalSet.has(b);
    return (
      <g key={"b" + bi}>
        <rect x={x * S + 5} y={y * S + 5} width={S - 10} height={S - 10} rx={6}
          fill={on ? K.teal : K.amber} stroke={on ? "#1f7a5e" : K.amberD} strokeWidth={3} />
        <line x1={x * S + 10} y1={y * S + S / 2 - 4} x2={x * S + S - 10} y2={y * S + S / 2 - 4}
          stroke={on ? "#1f7a5e" : K.amberD} strokeWidth={2} strokeOpacity={0.7} />
        <line x1={x * S + 10} y1={y * S + S / 2 + 5} x2={x * S + S - 10} y2={y * S + S / 2 + 5}
          stroke={on ? "#1f7a5e" : K.amberD} strokeWidth={2} strokeOpacity={0.7} />
      </g>
    );
  });
  const px = player % W, py = (player / W) | 0;
  return (
    <svg viewBox={`0 0 ${W * S} ${H * S}`} style={{ width: "100%", maxWidth: 430, display: "block", margin: "0 auto", borderRadius: 12, background: "#0b0906" }}>
      {tiles}
      {boxEls}
      <circle cx={px * S + S / 2} cy={py * S + S / 2} r={13} fill="#f4e9c9" stroke={K.amber} strokeWidth={3} />
      <circle cx={px * S + S / 2 - 4} cy={py * S + S / 2 - 2} r={1.8} fill="#241a08" />
      <circle cx={px * S + S / 2 + 4} cy={py * S + S / 2 - 2} r={1.8} fill="#241a08" />
    </svg>
  );
}

// ---------- 主元件 ----------
export default function App() {
  const [size, setSize] = useState(8);
  const [nBoxes, setNBoxes] = useState(2);
  const [density, setDensity] = useState(1); // 0低 1中 2高
  const [depthMax, setDepthMax] = useState(14);
  const [iters, setIters] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [genFail, setGenFail] = useState(false);
  const [lv, setLv] = useState(null);
  const [play, setPlay] = useState(null);
  const [playback, setPlayback] = useState(false);
  const [sfxOn, setSfxOn] = useState(true);
  const [musicOn, setMusicOn] = useState(false);
  const timerRef = useRef(null);
  const lvRef = useRef(null); lvRef.current = lv;
  const playRef = useRef(null); playRef.current = play;
  const playbackRef = useRef(false); playbackRef.current = playback;
  const sfxRef = useRef(true); sfxRef.current = sfxOn;

  const fx = n => { if (sfxRef.current) { try { SFX[n](); } catch (e) { /* noop */ } } };
  function toggleMusic() {
    if (musicOn) { stopMusic(); setMusicOn(false); }
    else { try { startMusic(); setMusicOn(true); } catch (e) { /* noop */ } }
  }

  const move = (di, force = false) => {
    const L = lvRef.current;
    if (!L || (playbackRef.current && !force)) return;
    const p = playRef.current;
    if (!p) return;
    const np = computeMove(L, p, di);
    if (np === p) { if (!force && !p.won) fx("bump"); return; }
    const onB = p.boxes.filter(b => L.goalSet.has(b)).length;
    const onA = np.boxes.filter(b => L.goalSet.has(b)).length;
    if (np.won) fx("win");
    else if (onA > onB) fx("goal");
    else if (np.pushes > p.pushes) fx("push");
    else fx("step");
    setPlay(np);
  };

  useEffect(() => {
    const h = e => {
      const map = { ArrowUp: 0, ArrowDown: 1, ArrowLeft: 2, ArrowRight: 3, w: 0, s: 1, a: 2, d: 3 };
      if (map[e.key] !== undefined) { e.preventDefault(); move(map[e.key]); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => () => { clearInterval(timerRef.current); stopMusic(); }, []);

  function forge() {
    if (busy) return;
    if (sfxRef.current) { try { ctx(); } catch (e) { /* noop */ } }
    clearInterval(timerRef.current); setPlayback(false);
    setBusy(true);
    setTimeout(() => {
      const dmap = [0.05, 0.12, 0.19];
      const level = generateLevel({ W: size, H: size, nBoxes, density: dmap[density], depthMax, iters, C: 1.3 });
      if (level) { setLv(level); setPlay(freshPlay(level)); setGenFail(false); fx("forge"); }
      else setGenFail(true);
      setBusy(false);
    }, 30);
  }

  function reset() {
    clearInterval(timerRef.current); setPlayback(false);
    if (lv) setPlay(freshPlay(lv));
  }
  function undo() {
    if (playbackRef.current) return;
    const p = playRef.current;
    if (!p || !p.history.length) return;
    fx("undo");
    const last = p.history[p.history.length - 1];
    setPlay({ ...last, history: p.history.slice(0, -1), won: false });
  }
  function showSolution() {
    if (!lv || playback) return;
    clearInterval(timerRef.current);
    let cur = freshPlay(lv);
    setPlay(cur); setPlayback(true); playbackRef.current = true;
    const moves = lv.solution.moves;
    let i = 0;
    timerRef.current = setInterval(() => {
      if (i >= moves.length) { clearInterval(timerRef.current); setPlayback(false); return; }
      const np = computeMove(lv, { ...cur, won: false }, moves[i].di);
      const onB = cur.boxes.filter(b => lv.goalSet.has(b)).length;
      const onA = np.boxes.filter(b => lv.goalSet.has(b)).length;
      if (np.won) fx("win");
      else if (onA > onB) fx("goal");
      else if (moves[i].push) fx("push");
      else fx("step");
      cur = np; setPlay(np); i++;
    }, 170);
  }

  const stars = lv ? starsOf(lv.solution.pushes) : 0;
  const maxV = lv ? Math.max(1, ...lv.gen.rootTop.map(r => r.visits)) : 1;

  return (
    <div style={{ minHeight: "100vh", background: K.bg, color: K.text, fontFamily: FONT }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "20px 14px 48px" }}>

        <header style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 6 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 10, background: K.amber, border: `3px solid ${K.amberD}`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, flexShrink: 0,
          }}>📦</div>
          <div>
            <h1 style={{ margin: 0, fontFamily: SERIF, fontSize: 25, fontWeight: 900, letterSpacing: 2, lineHeight: 1.25 }}>
              關卡鍛造坊<span style={{ color: K.amber }}>・</span>MCTS
            </h1>
            <p style={{ margin: "3px 0 0", fontSize: 12.5, color: K.dim }}>
              難度不是亂數——是搜尋出來的。反向拉動保證可解，MCTS 負責把關卡鍛造到最難。
            </p>
          </div>
        </header>
        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0 4px", flexWrap: "wrap" }}>
          <Btn kind={musicOn ? "solid" : "ghost"} color={K.teal} onClick={toggleMusic}
            style={{ padding: "6px 12px", fontSize: 12 }}>{musicOn ? "🎵 音樂 開" : "🎵 音樂 關"}</Btn>
          <Btn kind={sfxOn ? "solid" : "ghost"} onClick={() => { if (!sfxOn) { try { ctx(); } catch (e) { /* noop */ } } setSfxOn(!sfxOn); }}
            style={{ padding: "6px 12px", fontSize: 12 }}>{sfxOn ? "🔊 音效 開" : "🔇 音效 關"}</Btn>
          <span style={{ fontSize: 11, color: K.dim }}>行動裝置請關閉靜音鍵</span>
        </div>
        <p style={{ fontSize: 11.5, color: K.dim, margin: "6px 0 16px" }}>
          玩法：把所有木箱推到<span style={{ color: K.teal }}>青色圓點</span>上。只能推、不能拉。方向鍵／WASD 或下方按鈕操作。
        </p>

        {/* 鍛造參數 */}
        <Card title="鍛造參數" sub="規則完全已知（推箱子物理）→ 模擬器零誤差，這正是 MCTS 的主場">
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px" }}>
              <Slider label="盤面大小" value={size} onChange={setSize} min={7} max={10} unit={`×${size}`} />
              <Slider label="木箱數量" value={nBoxes} onChange={setNBoxes} min={1} max={4} unit=" 個" />
            </div>
            <div style={{ flex: "1 1 220px" }}>
              <Slider label="拉動深度（難度上限）" value={depthMax} onChange={setDepthMax} min={4} max={28} unit=" 步" hint="搜尋的打亂步數" />
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, color: K.dim }}>
                  牆壁密度{" "}
                  <select value={density} onChange={e => setDensity(+e.target.value)}
                    style={{ background: K.panel2, color: K.text, border: `1px solid ${K.line}`, borderRadius: 8, padding: "5px 8px" }}>
                    <option value={0}>低</option><option value={1}>中</option><option value={2}>高</option>
                  </select>
                </label>
                <label style={{ fontSize: 12, color: K.dim }}>
                  MCTS 模擬次數{" "}
                  <select value={iters} onChange={e => setIters(+e.target.value)}
                    style={{ background: K.panel2, color: K.text, border: `1px solid ${K.line}`, borderRadius: 8, padding: "5px 8px", fontFamily: MONO }}>
                    {[300, 1000, 3000].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              </div>
            </div>
          </div>
          <Btn onClick={forge} disabled={busy} style={{ width: "100%", padding: "13px 0", fontSize: 15, marginTop: 6 }}>
            {busy ? "鍛造中…（打亂 → 搜尋 → 驗證）" : "🔨 鍛造一關"}
          </Btn>
          {genFail && (
            <p style={{ fontSize: 12, color: K.rose, margin: "10px 0 0" }}>
              這組參數的狀態空間太大，驗證器超出上限——請縮小盤面、減少箱子或降低牆壁密度後再鍛造一次。
            </p>
          )}
        </Card>

        {/* 關卡 */}
        {lv && play && (
          <Card title="關卡" accent={K.teal}
            sub={`最短 ${lv.solution.pushes} 推・${lv.solution.moves.length} 步｜難度 ${"★".repeat(stars)}${"☆".repeat(5 - stars)}｜✓ 構造上保證可解`}>
            {play.won && (
              <div style={{
                border: `1px solid ${K.teal}`, background: "rgba(70,214,172,.1)", borderRadius: 12,
                padding: "12px 14px", marginBottom: 12, fontSize: 14, fontWeight: 700, color: K.teal,
              }}>
                🏆 破關！你用了 {play.pushes} 推・{play.steps} 步（最佳 {lv.solution.pushes} 推・{lv.solution.moves.length} 步）
                <div style={{ marginTop: 8 }}><Btn onClick={forge} disabled={busy}>🔨 再鍛造一關</Btn></div>
              </div>
            )}
            <Board lv={lv} boxes={play.boxes} player={play.player} />
            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 6, fontFamily: MONO, fontSize: 12, color: K.dim }}>
              步數 {play.steps}・推數 {play.pushes}{playback && <span style={{ color: K.amber }}>｜▶ 解答播放中…</span>}
            </div>

            {/* 十字鍵 */}
            <div style={{ display: "grid", gridTemplateColumns: "56px 56px 56px", gap: 6, justifyContent: "center", marginTop: 10 }}>
              <span />
              <Btn kind="ghost" onClick={() => move(0)} disabled={playback} style={{ padding: "12px 0", fontSize: 17 }}>▲</Btn>
              <span />
              <Btn kind="ghost" onClick={() => move(2)} disabled={playback} style={{ padding: "12px 0", fontSize: 17 }}>◀</Btn>
              <Btn kind="ghost" onClick={() => move(1)} disabled={playback} style={{ padding: "12px 0", fontSize: 17 }}>▼</Btn>
              <Btn kind="ghost" onClick={() => move(3)} disabled={playback} style={{ padding: "12px 0", fontSize: 17 }}>▶</Btn>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
              <Btn kind="ghost" onClick={undo} disabled={playback || !play.history.length}>⌫ 復原</Btn>
              <Btn kind="ghost" onClick={reset}>↺ 重來</Btn>
              <Btn kind="ghost" color={K.teal} onClick={showSolution} disabled={playback}>▶ 播放解答</Btn>
            </div>
          </Card>
        )}

        {/* 搜尋內幕 */}
        {lv && (
          <Card title="這一關是怎麼搜出來的" accent={K.amber}>
            <div style={{
              fontFamily: MONO, fontSize: 12, color: K.dim, background: K.panel2,
              border: `1px solid ${K.line}`, borderRadius: 10, padding: "8px 12px", marginBottom: 12, lineHeight: 1.8,
            }}>
              MCTS 模擬 {lv.gen.iters} 次｜展開 {lv.gen.expanded} 個節點｜採用打亂深度 {lv.gen.depthUsed} 步<br />
              驗證器探索 {lv.solution.explored} 個狀態 → 確認最短 {lv.solution.pushes} 推｜嘗試 {lv.gen.attempts} 個房間｜{lv.gen.ms.toFixed(0)} ms
            </div>
            <div style={{ fontSize: 12, color: K.dim, marginBottom: 6 }}>根節點第一步（拉法）的探訪分布：</div>
            {lv.gen.rootTop.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ fontFamily: MONO, fontSize: 11.5, width: 92, color: K.text }}>{r.label}</span>
                <div style={{ flex: 1, height: 7, background: K.panel2, borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ width: `${(r.visits / maxV) * 100}%`, height: "100%", background: K.amber }} />
                </div>
                <span style={{ fontFamily: MONO, fontSize: 11, color: K.dim, width: 52, textAlign: "right" }}>{r.visits} 次</span>
              </div>
            ))}
          </Card>
        )}

      </div>
    </div>
  );
}
