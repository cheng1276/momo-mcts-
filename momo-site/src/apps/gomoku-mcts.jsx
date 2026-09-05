import { useState, useRef, useEffect } from "react";

/* ============================================================
   五子棋・MCTS 棋院 — 戰術型蒙地卡羅樹搜尋
   ・15×15 自由規則（無禁手、六連亦勝）；你執黑先行
   ・教學重點：純隨機模擬在五子棋行不通——rollout 內建
     「連五／擋四／搶活三」戰術常識，這是與黑白棋不同的一課
   ・思考透視、⚡威脅提示、💡提示、悔棋；四檔難度含 🐢 六歲小海龜
   ============================================================ */

// ---------- 視覺（深夜棋院・靛藍與木紋）----------
const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
const SERIF = "'Songti TC','Noto Serif TC',serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const K = {
  bg: "#12131c", panel: "#1a1c28", line: "#2c3042",
  text: "#eae6dc", dim: "#9299ad",
  wood: "#d8a95f", woodD: "#8a6428", grid: "#6e4f22",
  amber: "#e0a458", amberD: "#8a5f28", purple: "#a78bfa", purpleD: "#7a54d8",
  rose: "#ef6f6f", teal: "#3ecfae",
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = Math.random;
const ri = n => Math.floor(rnd() * n);

// ---------- 音訊引擎（Web Audio 即時合成）----------
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
    if (!musG) { musG = ac.createGain(); musG.gain.value = 0.11; musG.connect(ac.destination); }
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
  place() { const t = ctx().currentTime, d = bus("sfx"); noise(t, 0.03, 0.4, 2600, "bandpass", d); tone(420, t, 0.06, "triangle", 0.18, d, 260); },
  hint() { const t = ctx().currentTime, d = bus("sfx"); tone(880, t, 0.07, "sine", 0.14, d); tone(1175, t + 0.08, 0.1, "sine", 0.12, d); },
  undo() { const t = ctx().currentTime, d = bus("sfx"); tone(420, t, 0.09, "triangle", 0.14, d, 240); },
  warn() { const t = ctx().currentTime, d = bus("sfx"); tone(660, t, 0.08, "square", 0.07, d); tone(660, t + 0.1, 0.08, "square", 0.07, d); },
  bad() { const t = ctx().currentTime, d = bus("sfx"); tone(200, t, 0.09, "square", 0.08, d, 150); },
  win() { const t = ctx().currentTime, d = bus("sfx"); [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.09, 0.16, "triangle", 0.2, d)); [659, 784, 1047, 1568].forEach(f => tone(f, t + 0.5, 0.6, "sine", 0.09, d)); },
  lose() { const t = ctx().currentTime, d = bus("sfx"); tone(392, t, 0.25, "triangle", 0.14, d); tone(311, t + 0.25, 0.4, "triangle", 0.14, d); },
};
// 背景音樂：夜雨棋窗（A 羽調五聲，84 BPM）
const BPM = 84, BEAT = 60 / BPM, LOOP_BEATS = 16;
const MELODY = [
  880, null, 784, null, 659, null, 587, 659,
  523, null, null, null, 587, 659, 784, null,
  880, null, 1047, null, 880, 784, 659, null,
  587, null, 523, null, 440, null, null, null,
];
const BASS = [110, 110, 98, 98, 131, 131, 98, 110];
function scheduleLoop(t0) {
  const m = bus("music");
  MELODY.forEach((f, i) => { if (f) tone(f, t0 + i * BEAT * 0.5, BEAT * 0.44, "triangle", 0.15, m); });
  BASS.forEach((f, i) => tone(f, t0 + i * BEAT * 2, BEAT * 1.7, "sine", 0.2, m));
  tone(1760, t0 + 7.5 * BEAT, 0.2, "sine", 0.04, m);
  tone(1568, t0 + 15.5 * BEAT, 0.25, "sine", 0.04, m);
}
function startMusic() {
  const ac = ctx();
  bus("music").gain.setTargetAtTime(0.11, ac.currentTime, 0.1);
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

// ---------- 五子棋引擎 ----------
// 0 空、1 黑（你）、2 白（蒙蒙大師）
const N = 15, CELLS = N * N, CENTER = 7 * N + 7;
const DX = [1, 0, 1, 1], DY = [0, 1, 1, -1];
const inb = (x, y) => x >= 0 && x < N && y >= 0 && y < N;
const coord = c => `${"ABCDEFGHJKLMNOP"[c % N]}${((c / N) | 0) + 1}`;

function lineInfo(board, c, p, d) {
  const dx = DX[d], dy = DY[d], x0 = c % N, y0 = (c / N) | 0;
  let cnt = 1;
  let x = x0 + dx, y = y0 + dy;
  while (inb(x, y) && board[y * N + x] === p) { cnt++; x += dx; y += dy; }
  const openA = inb(x, y) && board[y * N + x] === 0;
  x = x0 - dx; y = y0 - dy;
  while (inb(x, y) && board[y * N + x] === p) { cnt++; x -= dx; y -= dy; }
  const openB = inb(x, y) && board[y * N + x] === 0;
  return { cnt, open: (openA ? 1 : 0) + (openB ? 1 : 0) };
}
function winAt(board, c, p) {
  for (let d = 0; d < 4; d++) if (lineInfo(board, c, p, d).cnt >= 5) return true;
  return false;
}
function winLine(board, c, p) {
  for (let d = 0; d < 4; d++) {
    const dx = DX[d], dy = DY[d];
    const cells = [c];
    let x = c % N + dx, y = ((c / N) | 0) + dy;
    while (inb(x, y) && board[y * N + x] === p) { cells.push(y * N + x); x += dx; y += dy; }
    x = c % N - dx; y = ((c / N) | 0) - dy;
    while (inb(x, y) && board[y * N + x] === p) { cells.push(y * N + x); x -= dx; y -= dy; }
    if (cells.length >= 5) return cells;
  }
  return null;
}
const patVal = (cnt, open) =>
  cnt >= 5 ? 100000
  : cnt === 4 ? (open === 2 ? 12000 : open === 1 ? 4200 : 0)
  : cnt === 3 ? (open === 2 ? 3200 : open === 1 ? 180 : 0)
  : cnt === 2 ? (open === 2 ? 160 : open === 1 ? 25 : 0)
  : cnt === 1 ? (open === 2 ? 6 : 1) : 0;
function patScore(board, c, p) {
  let s = 0;
  for (let d = 0; d < 4; d++) { const li = lineInfo(board, c, p, d); s += patVal(li.cnt, li.open); }
  return s;
}
function moveScore(board, c, p) {
  const x = c % N, y = (c / N) | 0;
  const ctr = 6 - Math.max(Math.abs(x - 7), Math.abs(y - 7)) * 0.5;
  return 2 * patScore(board, c, p) + patScore(board, c, 3 - p) + ctr;
}
// 候選：距任一棋子切比雪夫距離 ≤2 的空點
function candsOf(board) {
  const mask = new Uint8Array(CELLS), list = [];
  let any = false;
  for (let c = 0; c < CELLS; c++) {
    if (board[c] === 0) continue;
    any = true;
    const x = c % N, y = (c / N) | 0;
    for (let dy2 = -2; dy2 <= 2; dy2++) for (let dx2 = -2; dx2 <= 2; dx2++) {
      const nx = x + dx2, ny = y + dy2;
      if (!inb(nx, ny)) continue;
      const nc = ny * N + nx;
      if (board[nc] === 0 && !mask[nc]) { mask[nc] = 1; list.push(nc); }
    }
  }
  if (!any) { mask[CENTER] = 1; list.push(CENTER); }
  return { mask, list };
}
function addNbrs(board, mask, list, c) {
  const x = c % N, y = (c / N) | 0;
  for (let dy2 = -2; dy2 <= 2; dy2++) for (let dx2 = -2; dx2 <= 2; dx2++) {
    const nx = x + dx2, ny = y + dy2;
    if (!inb(nx, ny)) continue;
    const nc = ny * N + nx;
    if (board[nc] === 0 && !mask[nc]) { mask[nc] = 1; list.push(nc); }
  }
}
function fiveCells(board, list, p) {
  const out = [];
  for (const c of list) if (board[c] === 0 && winAt(board, c, p)) out.push(c);
  return out;
}
// 落此點可形成「活四」（＿●●●●＿，下一手兩頭連五、無法全擋）
function openFourCells(board, list, p) {
  const out = [];
  for (const c of list) {
    if (board[c] !== 0) continue;
    for (let d = 0; d < 4; d++) {
      const li = lineInfo(board, c, p, d);
      if (li.cnt === 4 && li.open === 2) { out.push(c); break; }
    }
  }
  return out;
}
// 戰術型隨機推演：連五 → 擋五 → 依評分挑點（純隨機在五子棋是噪音）
function rollout(board, list, mask, player, maxPlies) {
  let mover = player;
  for (let ply = 0; ply < maxPlies; ply++) {
    const my5 = fiveCells(board, list, mover);
    if (my5.length) return mover === 2 ? 1 : 0;
    const op5 = fiveCells(board, list, 3 - mover);
    let c = -1;
    if (op5.length) c = op5[ri(op5.length)];
    else {
      let bs = -Infinity;
      for (let k = 0; k < 14; k++) {
        const cc = list[ri(list.length)];
        if (board[cc] !== 0) continue;
        const s = moveScore(board, cc, mover) + rnd() * 12;
        if (s > bs) { bs = s; c = cc; }
      }
      if (c < 0) { for (const cc of list) if (board[cc] === 0) { c = cc; break; } }
      if (c < 0) return 0.5;
    }
    board[c] = mover;
    if (winAt(board, c, mover)) return mover === 2 ? 1 : 0;
    addNbrs(board, mask, list, c);
    mover = 3 - mover;
  }
  return 0.5;
}
// 節點的候選手：強制手階梯（連五→擋五→做活四→防活四＋反擊），否則取評分前 12
function orderedMoves(board, p) {
  const { list } = candsOf(board);
  const m5 = fiveCells(board, list, p);
  if (m5.length) return [m5[0]];
  const o5 = fiveCells(board, list, 3 - p);
  if (o5.length) return o5.slice(0, 4);
  const m4 = openFourCells(board, list, p);
  if (m4.length) return [m4[0]]; // 做出活四＝下一手保證連五
  const scored = [];
  for (const c of list) if (board[c] === 0) scored.push([moveScore(board, c, p), c]);
  scored.sort((a, b) => b[0] - a[0]);
  const top = scored.slice(0, 12).map(x => x[1]);
  const o4 = openFourCells(board, list, 3 - p);
  if (o4.length) {
    const set = new Set(o4.slice(0, 3));
    for (const c of top) { if (set.size >= 9) break; set.add(c); }
    return [...set];
  }
  return top;
}
function mkNode(board, player, move, parent, tv) {
  return { board, player, move, parent, kids: [], untried: tv >= 0 ? [] : orderedMoves(board, player), visits: 0, val: 0, tv: tv == null ? -1 : tv };
}
function mctsRun(board0, player0, iters, C = 1.25) {
  const root = mkNode(board0.slice(), player0, -1, null, -1);
  for (let it = 0; it < iters; it++) {
    let node = root;
    while (node.tv < 0 && node.untried.length === 0 && node.kids.length > 0) {
      let bn = null, bv = -Infinity;
      const lnN = Math.log(node.visits + 1);
      for (const ch of node.kids) {
        const q = ch.val / ch.visits;
        const u = (node.player === 2 ? q : 1 - q) + C * Math.sqrt(lnN / ch.visits);
        if (u > bv) { bv = u; bn = ch; }
      }
      node = bn;
    }
    let v;
    if (node.tv >= 0) v = node.tv;
    else if (node.untried.length === 0) v = 0.5; // 盤面已滿
    else {
      const m = node.untried.splice(ri(node.untried.length), 1)[0];
      const nb = node.board.slice();
      nb[m] = node.player;
      const won = winAt(nb, m, node.player);
      const child = mkNode(nb, 3 - node.player, m, node, won ? (node.player === 2 ? 1 : 0) : -1);
      node.kids.push(child); node = child;
      if (won) v = child.tv;
      else {
        const rb = nb.slice();
        const { mask, list } = candsOf(rb);
        v = rollout(rb, list, mask, child.player, 40);
      }
    }
    while (node) { node.visits++; node.val += v; node = node.parent; }
  }
  const persp = q => (player0 === 2 ? q : 1 - q);
  const stats = root.kids
    .map(k => ({ move: k.move, visits: k.visits, wr: persp(k.val / Math.max(1, k.visits)) }))
    .sort((a, b) => b.visits - a.visits);
  return { best: stats.length ? stats[0].move : -1, stats: stats.slice(0, 4), selfWr: persp(root.val / Math.max(1, root.visits)), total: root.visits };
}
// 決策入口：先處理強制手（連五／擋五），再交給 MCTS
function aiDecide(board, player, iters) {
  const { list } = candsOf(board);
  const my5 = fiveCells(board, list, player);
  if (my5.length) return { best: my5[0], forced: "win", stats: [], selfWr: player === 2 ? 1 : 1, total: 0 };
  const op5 = fiveCells(board, list, 3 - player);
  if (op5.length) return { best: op5[0], forced: "block", stats: [], selfWr: 0.5, total: 0 };
  return mctsRun(board, player, iters);
}
// 🐢 小海龜（6 歲難度）：只看一步、常分心、偶爾忘記擋
function kidMove(board) {
  const { list } = candsOf(board);
  const my5 = fiveCells(board, list, 2);
  if (my5.length && rnd() < 0.7) return { c: my5[0], why: "win" };
  const op5 = fiveCells(board, list, 1);
  if (op5.length && rnd() < 0.6) return { c: op5[ri(op5.length)], why: "block" };
  const empt = list.filter(c => board[c] === 0);
  if (!empt.length) return { c: -1, why: "none" };
  if (rnd() < 0.35) return { c: empt[ri(empt.length)], why: "wander" };
  let best = empt[0], bs = -Infinity;
  for (let k = 0; k < 8; k++) {
    const cc = empt[ri(empt.length)];
    const s = moveScore(board, cc, 2) + rnd() * 400;
    if (s > bs) { bs = s; best = cc; }
  }
  return { c: best, why: "ok" };
}

// ---------- UI 小元件 ----------
function Btn({ children, onClick, disabled, kind = "solid", color = K.amber, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      fontFamily: FONT, fontSize: 13.5, fontWeight: 700, letterSpacing: 0.5,
      padding: "9px 14px", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.4 : 1,
      border: `1px solid ${kind === "solid" ? color : K.line}`,
      background: kind === "solid" ? color : "transparent",
      color: kind === "solid" ? "#241a08" : K.text, ...style,
    }}>{children}</button>
  );
}
function Card({ title, sub, children, accent }) {
  return (
    <section style={{ background: K.panel, border: `1px solid ${K.line}`, borderRadius: 14, padding: "14px 14px 16px", marginBottom: 12 }}>
      {title && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: accent || K.amber }} />
            <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, letterSpacing: 1 }}>{title}</h2>
          </div>
          {sub && <p style={{ margin: "3px 0 0 16px", fontSize: 11.5, color: K.dim }}>{sub}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------- 主元件 ----------
export default function App() {
  const [g, setG] = useState(() => ({ board: Array(CELLS).fill(0), player: 1, winner: 0, lastMove: -1, winCells: null, moves: 0 }));
  const [log, setLog] = useState(["⚫ 你執黑先行。連成五顆（直・橫・斜）就獲勝！中央天元是好起點。"]);
  const [iters, setIters] = useState(600);
  const [think, setThink] = useState(null);
  const [wrHist, setWrHist] = useState([]);
  const [hintCell, setHintCell] = useState(-1);
  const [showThreat, setShowThreat] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [hinting, setHinting] = useState(false);
  const [sfxOn, setSfxOn] = useState(true);
  const [musicOn, setMusicOn] = useState(false);
  const gRef = useRef(g); gRef.current = g;
  const sfxRef = useRef(true); sfxRef.current = sfxOn;
  const aiBusy = useRef(false);
  const epoch = useRef(0);
  const histRef = useRef([]);

  const kid = iters === 40;
  const AIN = kid ? "小海龜學徒" : "蒙蒙大師";
  const AII = kid ? "🐢" : "🧙";

  const fx = n => { if (sfxRef.current) { try { SFX[n](); } catch (e) { /* noop */ } } };
  const pushLog = m => setLog(l => [m, ...l].slice(0, 40));
  const commit = ng => { setG(ng); gRef.current = ng; return ng; };
  function toggleMusic() {
    if (musicOn) { stopMusic(); setMusicOn(false); }
    else { try { startMusic(); setMusicOn(true); } catch (e) { /* noop */ } }
  }
  useEffect(() => () => stopMusic(), []);

  const human = g.player === 1 && g.winner === 0 && !thinking && !aiBusy.current;
  // 威脅點（教學）：琥珀＝你差一步連五；紫＝對方差一步連五
  const threats = (() => {
    if (!showThreat || g.winner !== 0) return { mine: new Set(), theirs: new Set() };
    const { list } = candsOf(g.board);
    return { mine: new Set(fiveCells(g.board, list, 1)), theirs: new Set(fiveCells(g.board, list, 2)) };
  })();

  function applyMove(s, c, p) {
    const nb = s.board.slice();
    nb[c] = p;
    const wl = winAt(nb, c, p) ? winLine(nb, c, p) : null;
    const full = s.moves + 1 >= CELLS;
    return { board: nb, player: 3 - p, winner: wl ? p : (full ? 3 : 0), lastMove: c, winCells: wl, moves: s.moves + 1 };
  }
  function humanPlay(c) {
    if (!human || g.board[c] !== 0) { if (human && g.board[c] !== 0) fx("bad"); return; }
    histRef.current.push({ g: { ...g, board: g.board.slice() }, wrLen: wrHist.length, think });
    setHintCell(-1);
    fx("place");
    const ng = commit(applyMove(g, c, 1));
    pushLog(`⚫ 你下在 ${coord(c)}`);
    if (ng.winner === 1) { fx("win"); pushLog("🏆 五連達成——你贏了！"); return; }
    if (ng.winner === 3) { pushLog("🤝 盤面下滿，平手"); return; }
    if (showThreat) { const { list } = candsOf(ng.board); if (fiveCells(ng.board, list, 2).length) fx("warn"); }
    runAI();
  }
  async function runAI() {
    if (aiBusy.current) return;
    aiBusy.current = true;
    const my = epoch.current;
    let s = gRef.current;
    if (s.winner === 0 && s.player === 2) {
      setThinking(true);
      await sleep(kid ? 500 : 60);
      if (epoch.current !== my) { setThinking(false); aiBusy.current = false; return; }
      let move, note = "", res = null;
      if (kid) {
        const km = kidMove(s.board);
        move = km.c;
        note = km.why === "win" ? "🐢 小海龜學徒眼睛一亮，連成五顆！"
          : km.why === "block" ? `🐢 小海龜學徒下在 ${coord(move)}，擋住了你！`
          : km.why === "wander" ? `🐢 小海龜學徒東張西望，隨手下在 ${coord(move)}`
          : `🐢 小海龜學徒下在 ${coord(move)}`;
      } else {
        const t0 = performance.now();
        res = aiDecide(s.board, 2, iters);
        const ms = performance.now() - t0;
        move = res.best;
        setThink({ who: "ai", stats: res.stats, selfWr: res.selfWr, total: res.total, ms, forced: res.forced });
        if (!res.forced) setWrHist(h => [...h, res.selfWr]);
        note = res.forced === "win" ? `⚪ ${AIN} 下在 ${coord(move)}——連五！`
          : res.forced === "block" ? `⚪ ${AIN} 下在 ${coord(move)}，擋住你的四`
          : `⚪ ${AIN} 下在 ${coord(move)}（模擬 ${res.total} 局，自評勝率 ${(res.selfWr * 100).toFixed(0)}%）`;
      }
      setThinking(false);
      await sleep(kid ? 250 : 320);
      if (epoch.current !== my || move < 0) { aiBusy.current = false; return; }
      fx("place");
      s = commit(applyMove(s, move, 2));
      pushLog(note);
      if (s.winner === 2) { fx("lose"); pushLog(`${AII} ${AIN} 五連達成`); }
      else if (s.winner === 3) pushLog("🤝 盤面下滿，平手");
      else if (showThreat) { const { list } = candsOf(s.board); if (fiveCells(s.board, list, 2).length) fx("warn"); }
    }
    aiBusy.current = false;
  }
  async function doHint() {
    if (!human || hinting) return;
    setHinting(true);
    await sleep(50);
    const res = aiDecide(gRef.current.board, 1, 800);
    setHinting(false);
    if (res.best >= 0) {
      setHintCell(res.best);
      setThink({ who: "hint", stats: res.stats, selfWr: res.selfWr, total: res.total, ms: 0, forced: res.forced });
      fx("hint");
      pushLog(res.forced === "win" ? `💡 提示：${coord(res.best)} 可以直接連五！`
        : res.forced === "block" ? `💡 提示：對方即將連五，必須擋 ${coord(res.best)}！`
        : `💡 提示：MCTS 建議下 ${coord(res.best)}`);
    }
  }
  function undo() {
    if (!histRef.current.length || thinking || aiBusy.current) { fx("bad"); return; }
    const snap = histRef.current.pop();
    epoch.current++;
    commit(snap.g);
    setWrHist(h => h.slice(0, snap.wrLen));
    setThink(snap.think);
    setHintCell(-1);
    fx("undo");
    pushLog("⏪ 悔棋：回到你上一手之前");
  }
  function restart() {
    epoch.current++;
    aiBusy.current = false;
    histRef.current = [];
    commit({ board: Array(CELLS).fill(0), player: 1, winner: 0, lastMove: -1, winCells: null, moves: 0 });
    setLog(["⚫ 新的一局！你執黑先行。"]);
    setThink(null); setWrHist([]); setHintCell(-1); setThinking(false);
  }
  function changeLevel(v) {
    setIters(v);
    if (v === 40) setShowThreat(true);
  }

  const status = g.winner !== 0
    ? (g.winner === 3 ? "🤝 平手！" : g.winner === 1 ? "🏆 你贏了！" : `${AII} ${AIN} 獲勝`)
    : thinking ? (kid ? "🐢 小海龜學徒想一下下…" : `🧠 ${AIN}思考中…（MCTS 模擬 ${iters} 局）`)
    : hinting ? "💡 MCTS 幫你推演中…"
    : g.player === 1 ? "輪到你（⚫ 黑）" : `${AII} ${AIN}的回合…`;

  // 棋盤幾何
  const PAD = 22, CW = 28, SZ = PAD * 2 + CW * (N - 1);
  const px = c => PAD + (c % N) * CW, py = c => PAD + ((c / N) | 0) * CW;
  const STARS = [3 * N + 3, 3 * N + 11, 11 * N + 3, 11 * N + 11, CENTER];
  const winSet = new Set(g.winCells || []);

  return (
    <div style={{ minHeight: "100vh", background: K.bg, color: K.text, fontFamily: FONT }}>
      <style>{`
        @keyframes pulseH { 0%,100%{opacity:.95} 50%{opacity:.25} }
        @keyframes glowW { 0%,100%{stroke-opacity:.9} 50%{stroke-opacity:.3} }
      `}</style>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "18px 12px 40px" }}>

        {/* 標題 */}
        <header style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
          <div style={{ display: "flex" }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "radial-gradient(circle at 32% 28%, #555, #000)", border: "1px solid #000" }} />
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "radial-gradient(circle at 32% 28%, #fff, #ccc5b2)", marginLeft: -8, border: "1px solid #a99" }} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontFamily: SERIF, fontSize: 24, fontWeight: 900, letterSpacing: 2 }}>
              五子棋<span style={{ color: K.amber }}>・</span>MCTS 棋院
            </h1>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: K.dim }}>
              先連五者勝。這局的課題：純隨機模擬在五子棋行不通——推演必須帶著戰術常識。
            </p>
          </div>
        </header>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <Btn kind={musicOn ? "solid" : "ghost"} color={K.teal} onClick={toggleMusic}
            style={{ padding: "6px 12px", fontSize: 12, color: musicOn ? "#04231c" : K.text }}>
            {musicOn ? "🎵 音樂 開" : "🎵 音樂 關"}
          </Btn>
          <Btn kind={sfxOn ? "solid" : "ghost"} color={K.teal}
            onClick={() => { if (!sfxOn) { try { ctx(); } catch (e) { /* noop */ } } setSfxOn(!sfxOn); }}
            style={{ padding: "6px 12px", fontSize: 12, color: sfxOn ? "#04231c" : K.text }}>
            {sfxOn ? "🔊 音效 開" : "🔇 音效 關"}
          </Btn>
          <label style={{ fontSize: 12, color: K.dim, display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
            棋力
            <select value={iters} onChange={e => changeLevel(+e.target.value)}
              style={{ background: K.panel, color: K.text, border: `1px solid ${K.line}`, borderRadius: 8, padding: "5px 8px", fontFamily: FONT, fontWeight: 700 }}>
              <option value={40}>🐢 小海龜（6 歲小棋手）</option>
              <option value={300}>見習（300 局）</option>
              <option value={1200}>棋士（1200 局）</option>
              <option value={4000}>名人（4000 局）</option>
            </select>
          </label>
        </div>

        {/* 狀態列 */}
        <div style={{
          background: K.panel, border: `1px solid ${K.line}`, borderRadius: 12,
          padding: "8px 12px", marginBottom: 10, fontWeight: 700, fontSize: 13, textAlign: "center",
        }}>{status}</div>

        {/* 棋盤 */}
        <div style={{
          background: "#0d0e15", border: `1px solid ${K.line}`, borderRadius: 16,
          padding: 8, width: "fit-content", margin: "0 auto 12px", maxWidth: "100%",
        }}>
          <svg viewBox={`0 0 ${SZ} ${SZ}`} style={{ width: "100%", maxWidth: 452, display: "block" }}>
            <defs>
              <radialGradient id="bs" cx="32%" cy="28%" r="75%">
                <stop offset="0%" stopColor="#5a5a5a" /><stop offset="55%" stopColor="#121212" /><stop offset="100%" stopColor="#000" />
              </radialGradient>
              <radialGradient id="ws" cx="32%" cy="28%" r="75%">
                <stop offset="0%" stopColor="#ffffff" /><stop offset="55%" stopColor="#e8e2d2" /><stop offset="100%" stopColor="#bdb5a0" />
              </radialGradient>
            </defs>
            <rect x={0} y={0} width={SZ} height={SZ} rx={10} fill={K.wood} stroke={K.woodD} strokeWidth={3} />
            {Array.from({ length: N }, (_, i) => (
              <g key={i}>
                <line x1={PAD} x2={SZ - PAD} y1={PAD + i * CW} y2={PAD + i * CW} stroke={K.grid} strokeWidth={i === 0 || i === N - 1 ? 2 : 1} />
                <line y1={PAD} y2={SZ - PAD} x1={PAD + i * CW} x2={PAD + i * CW} stroke={K.grid} strokeWidth={i === 0 || i === N - 1 ? 2 : 1} />
              </g>
            ))}
            {STARS.map(c => <circle key={c} cx={px(c)} cy={py(c)} r={3.2} fill={K.grid} />)}
            {/* 威脅提示 */}
            {[...threats.mine].map(c => <circle key={"tm" + c} cx={px(c)} cy={py(c)} r={11} fill="none" stroke={K.amber} strokeWidth={3} style={{ animation: "pulseH 0.9s infinite" }} />)}
            {[...threats.theirs].map(c => <circle key={"tt" + c} cx={px(c)} cy={py(c)} r={11} fill="none" stroke={K.purple} strokeWidth={3} style={{ animation: "pulseH 0.9s infinite" }} />)}
            {/* 提示點 */}
            {hintCell >= 0 && human && <circle cx={px(hintCell)} cy={py(hintCell)} r={12} fill="none" stroke={K.teal} strokeWidth={3.5} style={{ animation: "pulseH 0.9s infinite" }} />}
            {/* 棋子 */}
            {g.board.map((v, c) => v === 0 ? null : (
              <g key={"s" + c}>
                <circle cx={px(c) + 1} cy={py(c) + 1.5} r={12.5} fill="#00000066" />
                <circle cx={px(c)} cy={py(c)} r={12.5} fill={v === 1 ? "url(#bs)" : "url(#ws)"} stroke={v === 1 ? "#000" : "#a8a091"} strokeWidth={0.8} />
                {winSet.has(c) && <circle cx={px(c)} cy={py(c)} r={12.5} fill="none" stroke={K.amber} strokeWidth={3} style={{ animation: "glowW 1s infinite" }} />}
                {g.lastMove === c && !winSet.has(c) && <circle cx={px(c)} cy={py(c)} r={3.4} fill={K.rose} />}
              </g>
            ))}
            {/* 點擊區 */}
            {g.winner === 0 && g.board.map((v, c) => v !== 0 ? null : (
              <circle key={"h" + c} cx={px(c)} cy={py(c)} r={13.5} fill="transparent" style={{ cursor: human ? "pointer" : "default" }} onClick={() => humanPlay(c)} />
            ))}
          </svg>
        </div>

        {/* 操作 */}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <Btn onClick={doHint} disabled={!human || hinting}>💡 提示（MCTS 幫你想）</Btn>
          <Btn kind={showThreat ? "solid" : "ghost"} color={K.purple}
            onClick={() => setShowThreat(t => !t)} style={{ color: showThreat ? "#1c1030" : K.text }}>
            ⚡ 威脅提示 {showThreat ? "開" : "關"}
          </Btn>
          <Btn kind="ghost" onClick={undo} disabled={!histRef.current.length || thinking}>⏪ 悔棋</Btn>
          <Btn kind="ghost" onClick={restart}>↺ 重新開始</Btn>
        </div>

        {/* 勝利橫幅 */}
        {g.winner !== 0 && (
          <Card accent={g.winner === 1 ? K.teal : K.rose}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 900 }}>
                {g.winner === 3 ? "🤝 平手！" : g.winner === 1 ? (kid ? "🏆🎉 你打敗小海龜學徒了！" : "🏆🎉 你贏了蒙地卡羅！") : (kid ? "🐢 小海龜學徒贏了，再來一局！" : "😅 蒙蒙大師獲勝！")}
              </div>
              <div style={{ fontSize: 12.5, color: K.dim, margin: "6px 0 10px", fontFamily: MONO }}>共 {g.moves} 手</div>
              <Btn onClick={restart} color={K.teal} style={{ color: "#04231c" }}>🔁 再來一局</Btn>
            </div>
          </Card>
        )}

        {/* 思考透視 */}
        <Card title="思考透視" accent={K.purple}
          sub={kid ? "小海龜學徒只看一步，沒有搜尋樹可以看——升級難度就能打開蒙蒙大師的腦"
            : think ? (think.who === "ai"
              ? (think.forced ? `${AIN}上一手是強制手（${think.forced === "win" ? "連五" : "擋五"}），不需搜尋`
                : `${AIN}上一手：模擬 ${think.total} 局・${think.ms.toFixed(0)} ms`)
              : "💡 給你的提示（800 局）")
            : `${AIN}落子後，這裡會顯示候選著法統計`}>
          {!kid && think && !think.forced ? (
            <div>
              {think.stats.map((s, i) => {
                const maxV = think.stats[0].visits;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontFamily: MONO, fontSize: 12.5, width: 38, fontWeight: 700, color: i === 0 ? K.amber : K.text }}>{coord(s.move)}</span>
                    <div style={{ flex: 1, height: 8, background: K.bg, borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${(s.visits / maxV) * 100}%`, height: "100%", background: i === 0 ? K.amber : K.purple, opacity: i === 0 ? 1 : 0.7 }} />
                    </div>
                    <span style={{ fontFamily: MONO, fontSize: 11.5, color: K.dim, width: 110, textAlign: "right" }}>
                      {s.visits} 局・勝率 {(s.wr * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
              <p style={{ fontSize: 11, color: K.dim, margin: "8px 0 0" }}>
                ※ 採「模擬次數最多」的一手（robust child）；連五與擋五為強制手，直接執行不搜尋。
              </p>
            </div>
          ) : !kid && think && think.forced ? (
            <p style={{ fontSize: 12.5, color: K.text, margin: 0 }}>
              {think.forced === "win" ? "⚔️ 有連五點就直接下——搜尋在必勝面前是多餘的。" : "🛡 對方一步就連五——擋，沒有第二種選擇。"}
            </p>
          ) : (
            <p style={{ fontSize: 12.5, color: K.dim, margin: 0 }}>（尚無資料）</p>
          )}
          {!kid && wrHist.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11.5, color: K.dim, marginBottom: 4 }}>{AIN}的自評勝率曲線（每手更新）</div>
              <svg width="100%" height="70" viewBox="0 0 300 100" preserveAspectRatio="none"
                style={{ background: K.bg, border: `1px solid ${K.line}`, borderRadius: 10, display: "block" }}>
                <line x1="0" x2="300" y1="50" y2="50" stroke={K.line} strokeWidth="1" strokeDasharray="4 4" />
                <polyline
                  points={wrHist.map((w, i) => `${(i / (wrHist.length - 1)) * 300},${100 - w * 100}`).join(" ")}
                  fill="none" stroke={K.purple} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
              </svg>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: K.dim, fontFamily: MONO }}>
                <span>開局</span><span>50%＝五五波</span><span>現在 {(wrHist[wrHist.length - 1] * 100).toFixed(0)}%</span>
              </div>
            </div>
          )}
        </Card>

        {/* 對局紀錄 */}
        <Card title="對局紀錄" accent={K.amber}>
          <div style={{ maxHeight: 150, overflowY: "auto" }}>
            {log.map((m, i) => (
              <div key={i} style={{
                fontSize: 12.5, color: i === 0 ? K.text : K.dim, fontWeight: i === 0 ? 700 : 400,
                padding: "4px 6px", borderRadius: 8, background: i === 0 ? K.bg : "transparent", marginBottom: 2,
              }}>{m}</div>
            ))}
          </div>
        </Card>

        {/* 教學 */}
        <Card title="教學：從入門到看懂 AI" accent={K.teal}>
          <details style={{ marginBottom: 8 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>📖 規則與新手三課</summary>
            <div style={{ fontSize: 12.5, lineHeight: 1.9, marginTop: 8 }}>
              ⚫ 你執黑先行，雙方輪流在交叉點落子，<b>先把五顆連成一線</b>（直、橫、斜皆可）就獲勝。本 App 採自由規則：無禁手、六連以上也算贏（職業「連珠」對黑棋有禁手，那是進階課）。<br /><br />
              <b>第一課・活三必應</b>：兩端都空的三連叫「活三」（＿●●●＿）。放著不管，下一手就變成兩端都能連五的「活四」——到時擋一頭、另一頭照樣贏。所以看到活三：擋掉，或用更兇的攻擊反制。<br />
              <b>第二課・衝四必擋</b>：只剩一個口的四連叫「衝四」，不擋<b>立刻</b>輸，但擋得住；「活四」兩端皆空＝勝負已定。開「⚡ 威脅提示」就能看到這些點：琥珀圈＝你差一步連五，紫圈＝對方差一步連五（快擋！）。<br />
              <b>第三課・讓對方擋不完</b>：單一威脅都能被擋——高手靠「雙活三」「四三」同時做出兩個威脅，一手棋逼出兩個必應點，對方只剩一隻手。<br />
              <span style={{ color: K.dim }}>冷知識：自由規則的五子棋，理論上黑棋（先手）必勝——所以正式比賽才需要禁手與交換規則來平衡。</span>
            </div>
          </details>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>🧠 蒙蒙大師的祕密（與黑白棋不同的一課）</summary>
            <div style={{ fontSize: 12.5, lineHeight: 1.9, marginTop: 8 }}>
              和黑白棋一樣，這裡是完全資訊、零隨機——closed-loop MCTS，樹上每個節點記住整個棋盤。但有個關鍵差異：黑白棋用「純隨機亂下」推演到終局就能得到有用的統計；五子棋不行——<b>隨機亂下幾乎永遠湊不出五連</b>，模擬出來的勝負全是噪音。<br />
              所以蒙蒙大師的推演帶著三條戰術常識：①自己能連五就連 ②對方要連五就擋 ③其餘依「活三＞衝四＞活二」的棋形評分挑點；搜尋樹也只展開評分最高的候選（15×15 有 225 個點，全展開會淹死）。這是 MCTS 的通用心法：<b>模擬器的品質決定搜尋的品質</b>——跟醫療模擬、股票模擬是同一句話。<br />
              🐢 小海龜難度（6 歲小棋手）：學徒完全不做樹搜尋、只看一步，還常常分心亂走、偶爾忘記擋——搭配「⚡ 威脅提示」（小海龜模式自動開啟），讓小棋手練習看見「差一步就贏」的點。練好了，一階一階挑戰見習、棋士、名人。
            </div>
          </details>
        </Card>
      </div>
    </div>
  );
}
