import { useState, useRef, useEffect } from "react";

/* ============================================================
   黑白棋・MCTS 棋院 — 經典 closed-loop 蒙地卡羅樹搜尋
   ・你執黑 ⚫，蒙蒙大師執白 ⚪（完全資訊、無隨機 → 樹上每個節點記住棋盤）
   ・思考透視：候選著法的模擬次數與勝率、AI 自評勝率曲線
   ・💡 提示：用同一套 MCTS 幫你想
   ============================================================ */

// ---------- 視覺（深夜棋社・呢絨與木框）----------
const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
const SERIF = "'Songti TC','Noto Serif TC',serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const K = {
  bg: "#0f1512", panel: "#17211b", line: "#2b3a30",
  text: "#ece7d8", dim: "#93a396",
  felt: "#2f7d52", feltEdge: "#245f3f", wood: "#8a5a2b", woodD: "#6d4520",
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
  place() { const t = ctx().currentTime, d = bus("sfx"); noise(t, 0.04, 0.35, 1800, "bandpass", d); tone(320, t, 0.07, "triangle", 0.18, d); },
  flips(n) { const t = ctx().currentTime, d = bus("sfx"); const m = Math.min(6, n); for (let i = 0; i < m; i++) tone(520 + i * 70, t + 0.06 + i * 0.05, 0.05, "sine", 0.11, d); },
  pass() { const t = ctx().currentTime, d = bus("sfx"); tone(400, t, 0.18, "triangle", 0.12, d, 250); },
  hint() { const t = ctx().currentTime, d = bus("sfx"); tone(880, t, 0.07, "sine", 0.14, d); tone(1175, t + 0.08, 0.1, "sine", 0.12, d); },
  bad() { const t = ctx().currentTime, d = bus("sfx"); tone(200, t, 0.09, "square", 0.08, d, 150); },
  win() { const t = ctx().currentTime, d = bus("sfx"); [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.09, 0.16, "triangle", 0.2, d)); [659, 784, 1047, 1568].forEach(f => tone(f, t + 0.5, 0.6, "sine", 0.09, d)); },
  lose() { const t = ctx().currentTime, d = bus("sfx"); tone(392, t, 0.25, "triangle", 0.14, d); tone(311, t + 0.25, 0.4, "triangle", 0.14, d); },
};
// 背景音樂：深夜棋社的慵懶小調（A 小調五聲，80 BPM）
const BPM = 80, BEAT = 60 / BPM, LOOP_BEATS = 16;
const MELODY = [
  659, null, null, 587, 523, null, 440, null,
  523, null, 587, null, 659, null, null, null,
  440, null, 523, null, 587, 523, 440, null,
  392, null, 330, null, 440, null, null, null,
];
const BASS = [110, 131, 147, 165, 110, 131, 98, 110];
function scheduleLoop(t0) {
  const m = bus("music");
  MELODY.forEach((f, i) => { if (f) tone(f, t0 + i * BEAT * 0.5, BEAT * 0.46, "triangle", 0.16, m); });
  BASS.forEach((f, i) => tone(f, t0 + i * BEAT * 2, BEAT * 1.7, "sine", 0.22, m));
  for (let b = 2; b < LOOP_BEATS; b += 4) noise(t0 + b * BEAT, 0.03, 0.05, 6500, "highpass", m);
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

// ---------- 黑白棋引擎 ----------
// 0 空、1 黑（你）、2 白（蒙蒙大師）
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const CORNERS = [0, 7, 56, 63];
// 角落未定時的危險格（C 格與 X 格）→ 對應的角落
const DANGER = { 1: 0, 8: 0, 9: 0, 6: 7, 15: 7, 14: 7, 48: 56, 57: 56, 49: 56, 62: 63, 55: 63, 54: 63 };

function mkBoard() {
  const b = Array(64).fill(0);
  b[27] = 2; b[28] = 1; b[35] = 1; b[36] = 2;
  return b;
}
function movesFor(board, p) {
  const opp = 3 - p, out = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const i = r * 8 + c;
    if (board[i] !== 0) continue;
    let ok = false;
    for (let d = 0; d < 8 && !ok; d++) {
      const dr = DIRS[d][0], dc = DIRS[d][1];
      let rr = r + dr, cc = c + dc, seen = 0;
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && board[rr * 8 + cc] === opp) { rr += dr; cc += dc; seen++; }
      if (seen > 0 && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && board[rr * 8 + cc] === p) ok = true;
    }
    if (ok) out.push(i);
  }
  return out;
}
function applyM(board, p, i, collect) {
  const opp = 3 - p, r = (i / 8) | 0, c = i % 8;
  board[i] = p;
  const flipped = collect ? [] : null;
  for (let d = 0; d < 8; d++) {
    const dr = DIRS[d][0], dc = DIRS[d][1];
    let rr = r + dr, cc = c + dc;
    const line = [];
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && board[rr * 8 + cc] === opp) { line.push(rr * 8 + cc); rr += dr; cc += dc; }
    if (line.length && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && board[rr * 8 + cc] === p) {
      for (const j of line) { board[j] = p; if (flipped) flipped.push(j); }
    }
  }
  return flipped;
}
const countOf = (board, p) => board.reduce((s, v) => s + (v === p ? 1 : 0), 0);
const coord = i => "ABCDEFGH"[i % 8] + (((i / 8) | 0) + 1);

// ---------- MCTS（closed-loop：每個節點記住棋盤）----------
function rolloutMove(board, moves) {
  for (const m of moves) if (CORNERS.includes(m) && rnd() < 0.95) return m;
  if (rnd() < 0.7) {
    const safe = moves.filter(m => !(m in DANGER) || board[DANGER[m]] !== 0);
    if (safe.length) return safe[ri(safe.length)];
  }
  return moves[ri(moves.length)];
}
function rollout(board, p, smart) {
  let cur = p, plies = 0, passed = false;
  while (plies++ < 70) {
    const mv = movesFor(board, cur);
    if (!mv.length) {
      if (passed) break;
      passed = true; cur = 3 - cur; continue;
    }
    passed = false;
    applyM(board, cur, smart ? rolloutMove(board, mv) : mv[ri(mv.length)], false);
    cur = 3 - cur;
  }
  const diff = countOf(board, 2) - countOf(board, 1); // 白 − 黑
  if (diff === 0) return 0.5;
  return diff > 0 ? 0.75 + 0.25 * Math.min(1, diff / 28) : 0.25 - 0.25 * Math.min(1, -diff / 28);
}
function mkNode(board, player, move, parent) {
  const mv = movesFor(board, player);
  const node = { board, player, move, parent, kids: [], untried: null, visits: 0, val: 0, tv: -1 };
  if (mv.length) node.untried = mv;
  else if (movesFor(board, 3 - player).length) node.untried = [-1]; // 只能 PASS
  else {
    const diff = countOf(board, 2) - countOf(board, 1);
    node.tv = diff === 0 ? 0.5 : diff > 0 ? 1 : 0; // 終局
    node.untried = [];
  }
  return node;
}
function mctsRun(board0, player0, iters, C = 1.3, smart = true) {
  const root = mkNode(board0.slice(), player0, -2, null);
  for (let it = 0; it < iters; it++) {
    let node = root;
    // 選擇
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
    else {
      // 擴展
      const idx = ri(node.untried.length);
      const m = node.untried.splice(idx, 1)[0];
      const nb = node.board.slice();
      if (m >= 0) applyM(nb, node.player, m, false);
      const child = mkNode(nb, 3 - node.player, m, node);
      node.kids.push(child);
      node = child;
      // 模擬
      v = node.tv >= 0 ? node.tv : rollout(node.board.slice(), node.player, smart);
    }
    // 回傳
    while (node) { node.visits++; node.val += v; node = node.parent; }
  }
  // 統計（勝率轉成「根節點行動者」視角）
  const persp = q => (player0 === 2 ? q : 1 - q);
  const stats = root.kids
    .map(k => ({ move: k.move, visits: k.visits, wr: persp(k.val / Math.max(1, k.visits)) }))
    .sort((a, b) => b.visits - a.visits);
  return {
    best: stats.length ? stats[0].move : -1,
    stats: stats.slice(0, 4),
    selfWr: persp(root.val / Math.max(1, root.visits)),
    total: root.visits,
  };
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
function Disc({ p, flip }) {
  const dark = p === 1;
  return (
    <div style={{
      width: "82%", height: "82%", borderRadius: "50%",
      background: dark
        ? "radial-gradient(circle at 32% 28%, #555 0%, #111 55%, #000 100%)"
        : "radial-gradient(circle at 32% 28%, #ffffff 0%, #e8e2d2 55%, #c9c2ae 100%)",
      boxShadow: dark ? "0 2px 4px #000a, inset 0 -2px 3px #0008" : "0 2px 4px #0009, inset 0 -2px 3px #0003",
      animation: flip ? "flipA .45s ease" : "none",
    }} />
  );
}

// ---------- 主元件 ----------
export default function App() {
  const [g, setG] = useState(() => ({ board: mkBoard(), player: 1, winner: 0, lastMove: -1, flipped: [] }));
  const [log, setLog] = useState(["⚫ 你執黑先行。點棋盤上的小點落子，把白棋夾起來翻面！"]);
  const [iters, setIters] = useState(1500);
  const [think, setThink] = useState(null);   // {who, stats, selfWr, total, ms}
  const [wrHist, setWrHist] = useState([]);   // 蒙蒙自評勝率
  const [hintCell, setHintCell] = useState(-1);
  const [thinking, setThinking] = useState(false);
  const [hinting, setHinting] = useState(false);
  const [sfxOn, setSfxOn] = useState(true);
  const [musicOn, setMusicOn] = useState(false);
  const gRef = useRef(g); gRef.current = g;
  const sfxRef = useRef(true); sfxRef.current = sfxOn;
  const aiBusy = useRef(false);
  const epoch = useRef(0);
  const histRef = useRef([]); // 悔棋快照

  const fx = (n, arg) => { if (sfxRef.current) { try { SFX[n](arg); } catch (e) { /* noop */ } } };
  const pushLog = m => setLog(l => [m, ...l].slice(0, 40));
  const commit = ng => { setG(ng); gRef.current = ng; return ng; };
  function toggleMusic() {
    if (musicOn) { stopMusic(); setMusicOn(false); }
    else { try { startMusic(); setMusicOn(true); } catch (e) { /* noop */ } }
  }
  useEffect(() => () => stopMusic(), []);

  const kid = iters === 60;
  const human = g.player === 1 && g.winner === 0 && !thinking && !aiBusy.current;
  const humanMoves = g.winner === 0 && g.player === 1 ? movesFor(g.board, 1) : [];
  const nB = countOf(g.board, 1), nW = countOf(g.board, 2);

  function finish(ng) {
    const b = countOf(ng.board, 1), w = countOf(ng.board, 2);
    ng.winner = b === w ? 3 : b > w ? 1 : 2;
    pushLog(ng.winner === 3 ? `🤝 終局平手 ${b}:${w}` : ng.winner === 1 ? `🏆 終局！你以 ${b}:${w} 獲勝！` : `終局，${kid ? "小海龜學徒" : "蒙蒙大師"}以 ${w}:${b} 獲勝`);
    fx(ng.winner === 1 ? "win" : ng.winner === 3 ? "hint" : "lose");
  }
  const bothStuck = board => movesFor(board, 1).length === 0 && movesFor(board, 2).length === 0;

  function humanPlay(cell) {
    if (!human || !humanMoves.includes(cell)) { if (human) fx("bad"); return; }
    histRef.current.push({ g: { ...g, board: g.board.slice(), flipped: g.flipped.slice() }, wrLen: wrHist.length, think });
    setHintCell(-1);
    const nb = g.board.slice();
    const flipped = applyM(nb, 1, cell, true);
    fx("place"); fx("flips", flipped.length);
    pushLog(`⚫ 你下在 ${coord(cell)}，翻了 ${flipped.length} 子`);
    const ng = commit({ board: nb, player: 2, winner: 0, lastMove: cell, flipped });
    if (bothStuck(nb)) { finish(ng); commit({ ...ng }); return; }
    runAI();
  }

  async function runAI() {
    if (aiBusy.current) return;
    aiBusy.current = true;
    const my = epoch.current;
    let s = gRef.current;
    while (s.winner === 0 && s.player === 2 && epoch.current === my) {
      const mv = movesFor(s.board, 2);
      if (!mv.length) {
        if (movesFor(s.board, 1).length === 0) { finish(s); commit({ ...s, board: s.board.slice() }); finalizeWinner(); break; }
        await sleep(500);
        if (epoch.current !== my) break;
        fx("pass");
        pushLog(kid ? "🐢 小海龜學徒沒有合法步，PASS" : "⚪ 蒙蒙大師沒有合法步，PASS");
        s = commit({ ...s, player: 1, board: s.board.slice(), flipped: [] });
        break;
      }
      setThinking(true);
      await sleep(kid ? 450 : 60);
      if (epoch.current !== my) { setThinking(false); break; }
      const t0 = performance.now();
      const res = mctsRun(s.board, 2, kid ? 60 : iters, 1.3, !kid);
      const ms = performance.now() - t0;
      let chosen = res.best, distracted = false;
      if (kid && rnd() < 0.35) {
        chosen = mv[ri(mv.length)];
        distracted = chosen !== res.best;
      }
      setThinking(false);
      setThink({ who: "ai", ...res, ms });
      setWrHist(h => [...h, res.selfWr]);
      await sleep(350);
      if (epoch.current !== my) break;
      const nb = s.board.slice();
      const flipped = applyM(nb, 2, chosen, true);
      fx("place"); fx("flips", flipped.length);
      pushLog(kid
        ? (distracted
          ? `🐢 小海龜學徒東張西望，隨手下在 ${coord(chosen)}`
          : `🐢 小海龜學徒下在 ${coord(chosen)}（只想了 ${res.total} 局）`)
        : `⚪ 蒙蒙大師下在 ${coord(res.best)}（模擬 ${res.total} 局，自評勝率 ${(res.selfWr * 100).toFixed(0)}%）`);
      s = commit({ board: nb, player: 1, winner: 0, lastMove: chosen, flipped });
      if (bothStuck(nb)) { finish(s); finalizeWinner(); break; }
      // 你沒步 → 自動 PASS，蒙蒙繼續
      if (movesFor(nb, 1).length === 0) {
        await sleep(550);
        if (epoch.current !== my) break;
        fx("pass");
        pushLog("⚫ 你沒有合法步，自動 PASS");
        s = commit({ ...s, player: 2, board: s.board.slice(), flipped: [] });
        continue;
      }
      break;
    }
    aiBusy.current = false;
  }
  function finalizeWinner() {
    const s = gRef.current;
    const b = countOf(s.board, 1), w = countOf(s.board, 2);
    commit({ ...s, board: s.board.slice(), winner: b === w ? 3 : b > w ? 1 : 2 });
  }

  async function doHint() {
    if (!human || hinting) return;
    setHinting(true);
    await sleep(50);
    const res = mctsRun(gRef.current.board, 1, 1200);
    setHinting(false);
    if (res.best >= 0) {
      setHintCell(res.best);
      setThink({ who: "hint", ...res, ms: 0 });
      fx("hint");
      pushLog(`💡 提示：MCTS 建議你下 ${coord(res.best)}（勝率約 ${(res.stats[0].wr * 100).toFixed(0)}%）`);
    }
  }
  function undo() {
    if (!histRef.current.length || thinking || aiBusy.current) { fx("bad"); return; }
    const snap = histRef.current.pop();
    epoch.current++;
    aiBusy.current = false;
    commit(snap.g);
    setWrHist(h => h.slice(0, snap.wrLen));
    setThink(snap.think);
    setHintCell(-1);
    pushLog("⏪ 悔棋：回到你上一手之前");
  }
  function restart() {
    epoch.current++;
    aiBusy.current = false;
    histRef.current = [];
    commit({ board: mkBoard(), player: 1, winner: 0, lastMove: -1, flipped: [] });
    setLog(["⚫ 新的一局！你執黑先行。"]);
    setThink(null); setWrHist([]); setHintCell(-1); setThinking(false);
  }

  const flippedSet = new Set(g.flipped);
  const hintNow = human ? hintCell : -1;
  const status = g.winner !== 0
    ? (g.winner === 3 ? "🤝 平手！" : g.winner === 1 ? "🏆 你贏了！" : "蒙蒙大師獲勝")
    : thinking ? (kid ? "🐢 小海龜學徒想一下下…" : `🧠 蒙蒙大師思考中…（MCTS 模擬 ${iters} 局）`)
    : hinting ? "💡 MCTS 幫你推演中…"
    : g.player === 1 ? "輪到你（⚫ 黑）" : (kid ? "🐢 小海龜學徒的回合…" : "⚪ 蒙蒙大師的回合…");

  return (
    <div style={{ minHeight: "100vh", background: K.bg, color: K.text, fontFamily: FONT }}>
      <style>{`
        @keyframes flipA { 0%{transform:rotateY(0) scale(1)} 50%{transform:rotateY(90deg) scale(1.12)} 100%{transform:rotateY(0) scale(1)} }
        @keyframes pulseH { 0%,100%{box-shadow:0 0 0 3px ${K.amber}cc inset} 50%{box-shadow:0 0 0 1px ${K.amber}33 inset} }
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
              黑白棋<span style={{ color: K.amber }}>・</span>MCTS 棋院
            </h1>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: K.dim }}>
              完全資訊、零隨機——closed-loop MCTS 的教科書舞台。把 AI 的腦打開給你看。
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
            <select value={iters} onChange={e => setIters(+e.target.value)}
              style={{ background: K.panel, color: K.text, border: `1px solid ${K.line}`, borderRadius: 8, padding: "5px 8px", fontFamily: FONT, fontWeight: 700 }}>
              <option value={60}>🐢 小海龜（6 歲小棋手）</option>
              <option value={400}>見習（400 局）</option>
              <option value={1500}>棋士（1500 局）</option>
              <option value={3500}>名人（3500 局）</option>
            </select>
          </label>
        </div>

        {/* 計分 */}
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          {[{ p: 1, n: nB, name: "你", icon: "⚫", col: K.amber }, { p: 2, n: nW, name: kid ? "小海龜學徒" : "蒙蒙大師", icon: kid ? "🐢" : "⚪", col: K.purple }].map(x => (
            <div key={x.p} style={{
              flex: 1, background: K.panel, borderRadius: 12, padding: "10px 12px",
              border: `1px solid ${g.player === x.p && g.winner === 0 ? x.col : K.line}`,
              boxShadow: g.player === x.p && g.winner === 0 ? `0 0 0 2px ${x.col}44` : "none",
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: x.col }}>
                {x.icon} {x.name}{x.p === 2 && <span style={{ fontSize: 10, background: K.purple, color: "#1c1030", borderRadius: 8, padding: "1px 6px", marginLeft: 6, fontWeight: 900 }}>MCTS</span>}
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, fontFamily: MONO }}>{x.n}</div>
            </div>
          ))}
        </div>

        {/* 狀態列 */}
        <div style={{
          background: K.panel, border: `1px solid ${K.line}`, borderRadius: 12,
          padding: "8px 12px", marginBottom: 10, fontWeight: 700, fontSize: 13, textAlign: "center",
        }}>{status}</div>

        {/* 棋盤 */}
        <div style={{
          background: K.wood, border: `3px solid ${K.woodD}`, borderRadius: 16,
          padding: 10, width: "fit-content", margin: "0 auto 12px",
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 40px)", gap: 2, background: K.feltEdge, padding: 2, borderRadius: 8 }}>
            {g.board.map((v, i) => {
              const legal = humanMoves.includes(i);
              const isLast = g.lastMove === i;
              const isHint = hintNow === i;
              return (
                <div key={i} onClick={() => humanPlay(i)} style={{
                  width: 40, height: 40, background: K.felt, borderRadius: 4,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: legal ? "pointer" : "default", position: "relative",
                  animation: isHint ? "pulseH 0.9s infinite" : "none",
                }}>
                  {v !== 0 && <Disc p={v} flip={flippedSet.has(i) || isLast} />}
                  {v === 0 && legal && (
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: isHint ? K.amber : "#ece7d866" }} />
                  )}
                  {isLast && v !== 0 && (
                    <div style={{ position: "absolute", width: 7, height: 7, borderRadius: "50%", background: K.rose }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 操作 */}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <Btn onClick={doHint} disabled={!human || hinting}>💡 提示（MCTS 幫你想）</Btn>
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
              <div style={{ fontSize: 13, color: K.dim, margin: "6px 0 10px", fontFamily: MONO }}>⚫ {nB}　:　⚪ {nW}</div>
              <Btn onClick={restart} color={K.teal} style={{ color: "#04231c" }}>🔁 再來一局</Btn>
            </div>
          </Card>
        )}

        {/* 思考透視 */}
        <Card title="思考透視" accent={K.purple}
          sub={think ? (think.who === "ai" ? `${kid ? "小海龜學徒" : "蒙蒙大師"}上一手：模擬 ${think.total} 局・${think.ms.toFixed(0)} ms` : "💡 給你的提示（1200 局）") : `${kid ? "小海龜學徒" : "蒙蒙大師"}落子後，這裡會顯示候選著法統計`}>
          {think ? (
            <div>
              {think.stats.map((s, i) => {
                const maxV = think.stats[0].visits;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontFamily: MONO, fontSize: 12.5, width: 34, fontWeight: 700, color: i === 0 ? K.amber : K.text }}>{coord(s.move < 0 ? 0 : s.move)}</span>
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
                ※ 採「模擬次數最多」的一手（robust child），而非勝率最高——次數多代表統計上更可信。
              </p>
            </div>
          ) : (
            <p style={{ fontSize: 12.5, color: K.dim, margin: 0 }}>（尚無資料）</p>
          )}
          {wrHist.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11.5, color: K.dim, marginBottom: 4 }}>蒙蒙大師的自評勝率曲線（每手更新）</div>
              <svg width="100%" height="70" viewBox={`0 0 300 100`} preserveAspectRatio="none"
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

        {/* 規則 */}
        <Card title="怎麼玩？" accent={K.teal}>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>規則與蒙蒙大師的祕密</summary>
            <div style={{ fontSize: 12.5, lineHeight: 1.9, marginTop: 8, color: K.text }}>
              ⚫ 你執黑先行。落子必須「夾住」對方的棋子（直、橫、斜任一方向），被夾住的整排立刻翻面變成你的顏色。<br />
              ⏭ 沒有合法步時自動 PASS；雙方都無步可下時終局，棋子多的一方獲勝。<br />
              🏰 小訣竅：四個角落永遠不會被翻回去——搶角是王道，角落旁邊的格子則要小心奉送。<br />
              🧠 蒙蒙大師的祕密：這次棋盤沒有任何隨機，所以他用最純正的 closed-loop MCTS——樹上每個節點都記住整個棋盤，往下亂玩到終局統計黑白勝負，回傳更新，重複幾千次。他的模擬裡也懂得搶角與避開危險格，所以「名人」難度相當兇。<br />
              🐢 小海龜難度（6 歲小棋手）：學徒只想 60 局、模擬時完全亂下，還有 35% 機率分心亂走——慢慢練，練好了再去挑戰蒙蒙大師！
            </div>
          </details>
        </Card>
      </div>
    </div>
  );
}
