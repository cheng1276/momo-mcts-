import { useState, useRef, useEffect } from "react";

/* ============================================================
   尋龍多米諾 — 小小訓龍師的拼板尋蛋之旅
   ・選一塊骨牌拼進自己的龍之島；同地形相鄰就撿蛋
   ・翻蛋：🐉 寶寶龍 = 1 分；🐚 空蛋殼 = 拿走龍媽媽（終局 +1）
   ・稀有地形蛋少但幾乎都有龍 — 機率的第一堂課
   ・對手「蒙蒙大師」由 open-loop MCTS 驅動（抽蛋隨機）
   ============================================================ */

// ---------- 視覺（龍寶寶托兒所・粉彩繪本風）----------
const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const K = {
  bg: "#b7a4ea", bgDeep: "#8f77cf",
  panel: "#fff7ec", panelEdge: "#caa6e8", ink: "#3d2b4f", sub: "#8a7699",
  p0: "#ff8f4d", p0d: "#d96a24",   // 你（小龍）
  p1: "#6a7df0", p1d: "#4a5cd0",   // 蒙蒙大師（MCTS）
  gold: "#ffcf5c", goldEdge: "#d9a326", teal: "#2bbfa3", tealEdge: "#1d8f7a",
};
// 六種地形
const TNAME = ["草原", "森林", "沙漠", "山脈", "冰川", "火山"];
const TICON = ["🌿", "🌲", "🏜️", "⛰️", "❄️", "🌋"];
const TCOL = ["#8fd66d", "#3f9e6b", "#f0c75e", "#aab3bd", "#a8ddf0", "#f07a5f"];
const TDARK = ["#5da344", "#2a7a4e", "#c99c2e", "#7d868f", "#6fb4cc", "#c14e36"];
const CAMP = 6;

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
  pick() { const t = ctx().currentTime, d = bus("sfx"); tone(660, t, 0.07, "triangle", 0.16, d, 880); },
  place() { const t = ctx().currentTime, d = bus("sfx"); noise(t, 0.1, 0.3, 300, "lowpass", d); tone(140, t, 0.09, "sine", 0.2, d); },
  egg() { const t = ctx().currentTime, d = bus("sfx"); tone(300, t, 0.12, "sine", 0.18, d, 520); },
  dragon() { const t = ctx().currentTime, d = bus("sfx"); tone(180, t, 0.22, "sawtooth", 0.1, d, 420); tone(1047, t + 0.16, 0.14, "triangle", 0.16, d, 1319); },
  shell() { const t = ctx().currentTime, d = bus("sfx"); noise(t, 0.04, 0.3, 3000, "highpass", d); noise(t + 0.07, 0.04, 0.22, 2400, "highpass", d); tone(500, t + 0.1, 0.14, "triangle", 0.1, d, 300); },
  mommy() { const t = ctx().currentTime, d = bus("sfx"); tone(392, t, 0.14, "triangle", 0.14, d); tone(494, t + 0.13, 0.2, "triangle", 0.14, d); },
  bad() { const t = ctx().currentTime, d = bus("sfx"); tone(220, t, 0.1, "square", 0.08, d, 160); },
  win() { const t = ctx().currentTime, d = bus("sfx"); [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.09, 0.16, "triangle", 0.2, d)); [659, 784, 1047, 1568].forEach(f => tone(f, t + 0.5, 0.6, "sine", 0.09, d)); },
  lose() { const t = ctx().currentTime, d = bus("sfx"); tone(392, t, 0.25, "triangle", 0.14, d); tone(311, t + 0.25, 0.4, "triangle", 0.14, d); },
};
// 背景音樂：小龍搖籃曲（A 小調五聲，88 BPM，16 拍循環）
const BPM = 88, BEAT = 60 / BPM, LOOP_BEATS = 16;
const MELODY = [
  659, null, 523, null, 587, 659, 523, null,
  440, null, 523, 587, 523, null, null, null,
  659, null, 784, null, 659, 587, 523, 587,
  659, null, 523, null, 440, null, null, null,
];
const BASS = [110, 110, 131, 131, 147, 147, 131, 98];
function scheduleLoop(t0) {
  const m = bus("music");
  MELODY.forEach((f, i) => { if (f) tone(f, t0 + i * BEAT * 0.5, BEAT * 0.46, "triangle", 0.17, m); });
  BASS.forEach((f, i) => tone(f, t0 + i * BEAT * 2, BEAT * 1.6, "sine", 0.22, m));
  for (let b = 1; b < LOOP_BEATS; b += 2) noise(t0 + b * BEAT, 0.03, 0.06, 6500, "highpass", m);
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
  if (musG) { try { musG.disconnect(); } catch (e) { /* noop */ } musG = null; }
}

// ---------- 遊戲資料 ----------
// 28 塊骨牌（地形半格數：草14 森12 沙10 山8 冰6 火6）
const DOMS = [
  [0, 0], [0, 0], [0, 1], [0, 1], [0, 1], [0, 1], [0, 2], [0, 2], [0, 3], [0, 3], [0, 4], [0, 5],
  [1, 1], [1, 1], [1, 2], [1, 2], [1, 3], [1, 4],
  [2, 2], [2, 3], [2, 3], [2, 4], [2, 5],
  [3, 3], [3, 4],
  [4, 4],
  [5, 5], [5, 5],
];
// 蛋池：{蛋數, 其中寶寶龍數} — 越稀有的地形，中獎率越高！
const POOL0 = [
  { eggs: 14, dragons: 7 }, { eggs: 12, dragons: 7 }, { eggs: 10, dragons: 6 },
  { eggs: 8, dragons: 5 }, { eggs: 6, dragons: 4 }, { eggs: 6, dragons: 5 },
];
const W = 7, CELLS = W * W, CENTER = 3 * W + 3;
const PNAME = ["小龍", "蒙蒙大師"], PICON = ["🐣", "🧙"];

function mkGame() {
  const deck = DOMS.map((_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) { const j = ri(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const board = () => { const b = Array(CELLS).fill(-1); b[CENTER] = CAMP; return b; };
  return {
    deck: deck.slice(4), market: deck.slice(0, 4),
    boards: [board(), board()],
    score: [0, 0], shells: [0, 0], mommy: -1,
    pools: POOL0.map(p => ({ ...p })),
    turn: 0, phase: "pick", picked: -1, pickedSlot: -1,
    winner: -1,
  };
}
const cloneG = g => ({
  ...g, deck: g.deck.slice(), market: g.market.slice(),
  boards: [g.boards[0].slice(), g.boards[1].slice()],
  score: g.score.slice(), shells: g.shells.slice(),
  pools: g.pools.map(p => ({ ...p })),
});
const finalScore = (g, p) => g.score[p] + (g.mommy === p ? 1 : 0);

const NB = i => {
  const x = i % W, y = (i / W) | 0, out = [];
  if (x > 0) out.push(i - 1);
  if (x < W - 1) out.push(i + 1);
  if (y > 0) out.push(i - W);
  if (y < W - 1) out.push(i + W);
  return out;
};
const NBT = Array.from({ length: CELLS }, (_, i) => NB(i));
// 骨牌 d 在棋盤 board 上所有合法的（第一半 a, 第二半 b）擺法
function legalPairs(board, dIdx) {
  const [t1, t2] = DOMS[dIdx];
  const out = [];
  for (let a = 0; a < CELLS; a++) {
    if (board[a] !== -1) continue;
    for (const b of NBT[a]) {
      if (board[b] !== -1) continue;
      if (t1 === t2 && b < a) continue; // 同地形去重
      let touch = false;
      for (const n of NBT[a]) if (n !== b && board[n] !== -1) { touch = true; break; }
      if (!touch) for (const n of NBT[b]) if (n !== a && board[n] !== -1) { touch = true; break; }
      if (touch) out.push([a, b]);
    }
  }
  return out;
}
function legalActions(g) {
  if (g.winner !== -1) return [];
  if (g.phase === "pick") {
    const acts = [];
    for (let s = 0; s < 4; s++)
      if (g.market[s] !== -1 && legalPairs(g.boards[g.turn], g.market[s]).length > 0)
        acts.push({ t: "pick", slot: s });
    if (!acts.length && g.market.some(m => m !== -1)) acts.push({ t: "skip" });
    return acts;
  }
  return legalPairs(g.boards[g.turn], g.picked).map(([a, b]) => ({ t: "place", a, b }));
}
const keyOf = a => `${a.t}|${a.slot ?? ""}|${a.a ?? ""}|${a.b ?? ""}`;

function endCheck(g) {
  if (g.phase === "pick" && g.market.every(m => m === -1)) {
    const f0 = finalScore(g, 0), f1 = finalScore(g, 1);
    g.winner = f0 === f1 ? 2 : (f0 > f1 ? 0 : 1);
    g.phase = "over";
  }
}
function applyAction(g0, a, msgs, drawsOut) {
  const g = cloneG(g0);
  const p = g.turn;
  if (a.t === "pick") {
    g.picked = g.market[a.slot]; g.pickedSlot = a.slot;
    g.market[a.slot] = -1; g.phase = "place";
    if (msgs) {
      const [t1, t2] = DOMS[g.picked];
      msgs.push(`${PICON[p]} ${PNAME[p]} 選了骨牌 ${TICON[t1]}${TICON[t2]}`);
    }
    return g;
  }
  if (a.t === "skip") {
    const s = g.market.findIndex(m => m !== -1);
    g.market[s] = g.deck.length ? g.deck.shift() : -1;
    if (g.deck.length === 0 && g.market[s] === -1) { /* 已空 */ }
    g.turn = 1 - p; g.phase = "pick";
    if (msgs) msgs.push(`${PICON[p]} ${PNAME[p]} 沒有地方可以放，跳過並換掉一塊骨牌`);
    endCheck(g);
    return g;
  }
  // place
  const [t1, t2] = DOMS[g.picked];
  const board = g.boards[p];
  const matches = [];
  for (const n of NBT[a.a]) if (n !== a.b && board[n] === t1) matches.push(t1);
  for (const n of NBT[a.b]) if (n !== a.a && board[n] === t2) matches.push(t2);
  board[a.a] = t1; board[a.b] = t2;
  for (const t of matches) {
    const pool = g.pools[t];
    if (pool.eggs <= 0) continue;
    const dragon = rnd() < pool.dragons / pool.eggs;
    pool.eggs--;
    if (dragon) { pool.dragons--; g.score[p]++; }
    else { g.shells[p]++; g.mommy = p; }
    if (drawsOut) drawsOut.push({ t, dragon });
  }
  if (msgs) {
    if (matches.length === 0) msgs.push(`${PICON[p]} ${PNAME[p]} 拼上骨牌——沒有相鄰配對，這次沒撿到蛋`);
    else {
      const got = drawsOut || [];
      const txt = got.map(d => (d.dragon ? "🐉" : "🐚")).join("");
      msgs.push(`${PICON[p]} ${PNAME[p]} 撿到 ${matches.length} 顆蛋，翻開是 ${txt}${got.some(d => !d.dragon) ? "（拿走龍媽媽 👑）" : ""}`);
    }
  }
  // 補牌、換人
  g.market[g.pickedSlot] = g.deck.length ? g.deck.shift() : -1;
  g.picked = -1; g.pickedSlot = -1;
  g.turn = 1 - p; g.phase = "pick";
  endCheck(g);
  return g;
}

// ---------- MCTS（open-loop：抽蛋與補牌都靠每次重新抽）----------
function evalG(g) {
  if (g.winner === 1) return 1;
  if (g.winner === 0) return 0;
  if (g.winner === 2) return 0.5;
  return clamp(0.5 + 0.07 * (finalScore(g, 1) - finalScore(g, 0)), 0.05, 0.95);
}
function evPlace(g, dIdx, a, b) {
  const [t1, t2] = DOMS[dIdx];
  const board = g.boards[g.turn];
  let ev = 0;
  const ratio = t => (g.pools[t].eggs > 0 ? g.pools[t].dragons / g.pools[t].eggs : 0);
  for (const n of NBT[a]) if (n !== b && board[n] === t1) ev += ratio(t1);
  for (const n of NBT[b]) if (n !== a && board[n] === t2) ev += ratio(t2);
  return ev;
}
function rolloutPick(g, legal) {
  if (legal[0].t === "place") {
    // 抽樣 12 個擺法，挑期望寶寶龍最多的
    let best = legal[ri(legal.length)], bv = -1;
    const n = Math.min(12, legal.length);
    for (let i = 0; i < n; i++) {
      const a = legal[ri(legal.length)];
      const v = evPlace(g, g.picked, a.a, a.b) + rnd() * 0.15;
      if (v > bv) { bv = v; best = a; }
    }
    return best;
  }
  if (legal[0].t === "skip") return legal[0];
  if (rnd() < 0.5) return legal[ri(legal.length)];
  // 偏好含稀有地形的骨牌
  let best = legal[0], bv = -1;
  for (const a of legal) {
    const [t1, t2] = DOMS[g.market[a.slot]];
    const r = t => (g.pools[t].eggs > 0 ? g.pools[t].dragons / g.pools[t].eggs : 0);
    const v = r(t1) + r(t2) + rnd() * 0.3;
    if (v > bv) { bv = v; best = a; }
  }
  return best;
}
function mctsDecide(g0, iters, C = 1.15) {
  const root = { kids: new Map(), visits: 0, val: 0 };
  for (let it = 0; it < iters; it++) {
    let s = cloneG(g0);
    let node = root;
    const path = [root];
    let guard = 0;
    while (s.winner === -1 && guard++ < 60) {
      const legal = legalActions(s);
      if (!legal.length) break;
      const keys = legal.map(keyOf);
      const unIdx = [];
      for (let i = 0; i < keys.length; i++) if (!node.kids.has(keys[i])) unIdx.push(i);
      if (unIdx.length) {
        const i = unIdx[ri(unIdx.length)];
        const child = { kids: new Map(), visits: 0, val: 0 };
        node.kids.set(keys[i], child);
        s = applyAction(s, legal[i]);
        path.push(child); node = child;
        break;
      }
      const actor = s.turn;
      let bi = 0, bn = null, bv = -Infinity;
      const lnN = Math.log(node.visits + 1);
      for (let i = 0; i < keys.length; i++) {
        const k = node.kids.get(keys[i]);
        const q = k.val / k.visits;
        const u = (actor === 1 ? q : 1 - q) + C * Math.sqrt(lnN / k.visits);
        if (u > bv) { bv = u; bi = i; bn = k; }
      }
      s = applyAction(s, legal[bi]);
      path.push(bn); node = bn;
    }
    let steps = 0;
    while (s.winner === -1 && steps++ < 120) {
      const legal = legalActions(s);
      if (!legal.length) break;
      s = applyAction(s, rolloutPick(s, legal));
    }
    const v = evalG(s);
    for (const n of path) { n.visits++; n.val += v; }
  }
  const legal = legalActions(g0);
  let best = legal[0], bv = -1;
  for (const a of legal) {
    const k = root.kids.get(keyOf(a));
    if (k && k.visits > bv) { bv = k.visits; best = a; }
  }
  return best;
}

// ---------- UI 小元件 ----------
function Btn({ children, onClick, disabled, color = K.gold, edge = K.goldEdge, fg = K.ink, style }) {
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
      padding: "12px 12px 14px", marginBottom: 12, ...style,
    }}>{children}</section>
  );
}
function HalfCell({ t, size = 30 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 8, background: TCOL[t],
      border: `2.5px solid ${TDARK[t]}`, display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.55,
    }}>{TICON[t]}</div>
  );
}

// ---------- 主元件 ----------
export default function App() {
  const [g, setG] = useState(mkGame);
  const [log, setLog] = useState(["🥚 出發尋龍囉！點一塊骨牌，拼進你的龍之島。同地形相鄰就能撿蛋！"]);
  const [sel, setSel] = useState(-1);        // 你選中的市場格
  const [firstCell, setFirstCell] = useState(-1);
  const [reveals, setReveals] = useState([]); // 翻蛋動畫 [{t,dragon,st:'egg'|'flip'}]
  const [thinking, setThinking] = useState(false);
  const [animBusy, setAnimBusy] = useState(false);
  const [sfxOn, setSfxOn] = useState(true);
  const [musicOn, setMusicOn] = useState(false);
  const gRef = useRef(g); gRef.current = g;
  const sfxRef = useRef(true); sfxRef.current = sfxOn;
  const aiBusy = useRef(false);
  const epoch = useRef(0);

  const fx = n => { if (sfxRef.current) { try { SFX[n](); } catch (e) { /* noop */ } } };
  const pushLog = msgs => { if (msgs.length) setLog(l => [...msgs.slice().reverse(), ...l].slice(0, 40)); };
  const commit = ng => { setG(ng); gRef.current = ng; return ng; };
  function toggleMusic() {
    if (musicOn) { stopMusic(); setMusicOn(false); }
    else { try { startMusic(); setMusicOn(true); } catch (e) { /* noop */ } }
  }
  useEffect(() => () => stopMusic(), []);

  const human = g.turn === 0 && g.winner === -1 && !animBusy;
  const myPairs = sel >= 0 && g.market[sel] !== -1 ? legalPairs(g.boards[0], g.market[sel]) : [];
  const firstSet = new Set(myPairs.map(p => p[0]).concat(myPairs.filter(([, b]) => true).map(p => p[1])));
  // 第一格候選：任何出現在合法擺法中的格子
  const secondSet = firstCell >= 0
    ? new Set(myPairs.filter(([a]) => a === firstCell).map(([, b]) => b)
        .concat(myPairs.filter(([, b]) => b === firstCell).map(([a]) => a)))
    : new Set();
  const humanStuck = human && g.phase === "pick" &&
    legalActions(g).length === 1 && legalActions(g)[0].t === "skip";

  async function revealDraws(draws, my) {
    if (!draws.length) return;
    setAnimBusy(true);
    const list = draws.map(d => ({ ...d, st: "egg" }));
    setReveals(list.slice());
    for (let i = 0; i < list.length; i++) {
      if (epoch.current !== my) break;
      fx("egg");
      await sleep(520);
      if (epoch.current !== my) break;
      list[i] = { ...list[i], st: "flip" };
      setReveals(list.slice());
      fx(list[i].dragon ? "dragon" : "shell");
      if (!list[i].dragon) { await sleep(150); fx("mommy"); }
      await sleep(480);
    }
    await sleep(350);
    setReveals([]);
    setAnimBusy(false);
  }

  // ---- 你的操作 ----
  function clickMarket(s) {
    if (!human || g.phase !== "pick" || g.market[s] === -1) return;
    if (legalPairs(g.boards[0], g.market[s]).length === 0) { fx("bad"); return; }
    fx("pick");
    setSel(s === sel ? -1 : s);
    setFirstCell(-1);
  }
  async function clickCell(c) {
    if (!human || sel < 0) return;
    if (firstCell === -1) {
      if (firstSet.has(c)) { fx("pick"); setFirstCell(c); }
      else fx("bad");
      return;
    }
    if (secondSet.has(c)) {
      const my = epoch.current;
      const slot = sel;
      setSel(-1); setFirstCell(-1);
      const msgs = [], draws = [];
      let ng = applyAction(gRef.current, { t: "pick", slot }, msgs);
      // 依點擊順序決定半格方向
      const dIdx = ng.picked;
      const pair = legalPairs(ng.boards[0], dIdx).find(([a, b]) => a === firstCell && b === c);
      const act = pair ? { t: "place", a: firstCell, b: c } : { t: "place", a: c, b: firstCell };
      ng = applyAction(ng, act, msgs, draws);
      commit(ng);
      pushLog(msgs);
      fx("place");
      await revealDraws(draws, my);
      if (epoch.current !== my) return;
      if (ng.winner !== -1) { fx(ng.winner === 0 ? "win" : "lose"); return; }
      runAI();
    } else if (firstSet.has(c)) {
      fx("pick"); setFirstCell(c);
    } else fx("bad");
  }
  async function humanSkip() {
    if (!humanStuck) return;
    const my = epoch.current;
    const msgs = [];
    const ng = commit(applyAction(gRef.current, { t: "skip" }, msgs));
    pushLog(msgs);
    if (ng.winner !== -1) { fx(ng.winner === 0 ? "win" : "lose"); return; }
    if (epoch.current === my) runAI();
  }

  // ---- 蒙蒙大師的回合 ----
  async function runAI() {
    if (aiBusy.current) return;
    aiBusy.current = true;
    const my = epoch.current;
    let s = gRef.current;
    while (s.winner === -1 && s.turn === 1 && epoch.current === my) {
      setThinking(true);
      await sleep(150);
      if (epoch.current !== my) { setThinking(false); break; }
      const action = mctsDecide(s, s.phase === "pick" ? 350 : 350);
      setThinking(false);
      await sleep(350);
      if (epoch.current !== my) break;
      const msgs = [], draws = [];
      s = commit(applyAction(s, action, msgs, draws));
      pushLog(msgs);
      if (action.t === "pick") fx("pick");
      if (action.t === "place") { fx("place"); await revealDraws(draws, my); }
      await sleep(450);
    }
    aiBusy.current = false;
    if (epoch.current === my && s.winner !== -1) fx(s.winner === 0 ? "win" : "lose");
  }

  function restart() {
    epoch.current++;
    aiBusy.current = false;
    commit(mkGame());
    setLog(["🥚 新的一局！點一塊骨牌開始尋龍！"]);
    setSel(-1); setFirstCell(-1); setReveals([]); setThinking(false); setAnimBusy(false);
  }

  const hintText = g.winner !== -1
    ? (g.winner === 2 ? "平手！再來一局吧" : g.winner === 0 ? "你找到最多寶寶龍！🎉" : "蒙蒙大師贏了！再挑戰一次 💪")
    : animBusy ? "🥚 翻蛋中…"
    : thinking ? "🧠 蒙蒙大師思考中…（MCTS 模擬 350 局）"
    : !human ? "🧙 蒙蒙大師的回合…"
    : humanStuck ? "沒有骨牌放得下！按「跳過」換一塊"
    : sel < 0 ? "輪到你！點下面一塊骨牌"
    : firstCell === -1 ? `點島上發亮的格子，放 ${TICON[DOMS[g.market[sel]][0]]} 這一半`
    : `再點旁邊發亮的格子，放 ${TICON[DOMS[g.market[sel]][1]]} 那一半`;

  const grid = (p, cell, click, small) => {
    const size = small ? 26 : 42;
    const board = g.boards[p];
    return (
      <div style={{
        display: "grid", gridTemplateColumns: `repeat(${W}, ${size}px)`, gap: 3,
        justifyContent: "center", background: "#e8ddf5", padding: 6,
        borderRadius: 14, border: `3px solid ${K.panelEdge}`, width: "fit-content", margin: "0 auto",
      }}>
        {board.map((t, i) => {
          const isFirst = !small && firstCell === i;
          const hlA = !small && human && sel >= 0 && firstCell === -1 && firstSet.has(i);
          const hlB = !small && human && firstCell >= 0 && secondSet.has(i);
          const ghost = isFirst ? DOMS[g.market[sel]][0] : -1;
          return (
            <div key={i} onClick={click ? () => click(i) : undefined} style={{
              width: size, height: size, borderRadius: small ? 5 : 8,
              background: t === -1 ? (ghost >= 0 ? TCOL[ghost] : "#f7f1e6")
                : t === CAMP ? "#d9b98c" : TCOL[t],
              opacity: ghost >= 0 ? 0.6 : 1,
              border: t === -1
                ? `2px ${hlA || hlB ? "solid" : "dashed"} ${hlA || hlB ? K.p0 : "#cbbfa8"}`
                : `2.5px solid ${t === CAMP ? "#a8854f" : TDARK[t]}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: size * 0.55, cursor: (hlA || hlB) ? "pointer" : "default",
              animation: (hlA || hlB) ? "glow 0.9s infinite" : "none",
              boxSizing: "border-box",
            }}>
              {t === CAMP ? "🏕️" : t >= 0 ? TICON[t] : ghost >= 0 ? TICON[ghost] : ""}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: K.bg, color: K.ink, fontFamily: FONT }}>
      <style>{`
        @keyframes glow { 0%,100%{box-shadow:0 0 0 3px ${K.p0}88} 50%{box-shadow:0 0 0 1px ${K.p0}22} }
        @keyframes pop { 0%{transform:scale(.4)} 70%{transform:scale(1.2)} 100%{transform:scale(1)} }
        @keyframes wobble { 0%,100%{transform:rotate(-6deg)} 50%{transform:rotate(6deg)} }
      `}</style>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 12px 40px" }}>

        {/* 標題 */}
        <header style={{ textAlign: "center", marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: 2, color: "#fff", textShadow: `0 3px 0 ${K.bgDeep}` }}>
            🐉 尋龍多米諾 🥚
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#f3edff", fontWeight: 700 }}>
            拼骨牌、撿龍蛋——找到最多寶寶龍的訓龍師獲勝！
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 8, flexWrap: "wrap" }}>
            <Btn onClick={toggleMusic} color={musicOn ? K.teal : "#fff"} edge={musicOn ? K.tealEdge : "#cfc2e0"}
              fg={musicOn ? "#fff" : K.ink} style={{ padding: "6px 12px", fontSize: 12 }}>
              {musicOn ? "🎵 音樂 開" : "🎵 音樂 關"}
            </Btn>
            <Btn onClick={() => { if (!sfxOn) { try { ctx(); } catch (e) { /* noop */ } } setSfxOn(!sfxOn); }}
              color={sfxOn ? K.teal : "#fff"} edge={sfxOn ? K.tealEdge : "#cfc2e0"} fg={sfxOn ? "#fff" : K.ink}
              style={{ padding: "6px 12px", fontSize: 12 }}>
              {sfxOn ? "🔊 音效 開" : "🔇 音效 關"}
            </Btn>
            <Btn onClick={restart} color="#fff" edge="#cfc2e0" style={{ padding: "6px 12px", fontSize: 12 }}>↺ 重新開始</Btn>
          </div>
        </header>

        {/* 計分板 */}
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          {[0, 1].map(p => {
            const active = g.turn === p && g.winner === -1;
            const col = p === 0 ? K.p0 : K.p1, cold = p === 0 ? K.p0d : K.p1d;
            return (
              <Card key={p} style={{
                flex: 1, marginBottom: 0, padding: "10px 12px",
                border: `3px solid ${active ? col : K.panelEdge}`,
                boxShadow: active ? `0 0 0 3px ${col}55` : "none",
              }}>
                <div style={{ fontWeight: 900, fontSize: 14, color: cold }}>
                  {PICON[p]} {PNAME[p]}{p === 1 && <span style={{ fontSize: 10, background: K.p1, color: "#fff", borderRadius: 8, padding: "1px 6px", marginLeft: 6 }}>MCTS</span>}
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, margin: "3px 0" }}>
                  🐉 × {g.score[p]}
                  {g.mommy === p && <span style={{ fontSize: 13, marginLeft: 8, color: K.goldEdge }}>👑 龍媽媽 +1</span>}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: K.sub }}>
                  🐚 蛋殼 {g.shells[p]}
                </div>
              </Card>
            );
          })}
        </div>

        {/* 蛋池 */}
        <Card style={{ padding: "8px 10px" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
            {g.pools.map((pl, t) => (
              <div key={t} style={{
                display: "flex", alignItems: "center", gap: 4, background: "#fff",
                border: `2.5px solid ${TDARK[t]}`, borderRadius: 12, padding: "3px 8px",
                fontSize: 12, fontWeight: 900,
              }}>
                {TICON[t]} <span style={{ fontFamily: MONO }}>🐉{pl.dragons}/🥚{pl.eggs}</span>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", fontSize: 11, color: K.sub, fontWeight: 700, marginTop: 5 }}>
            蛋池是公開的：🌋 火山蛋很少，但幾乎顆顆有龍！
          </div>
        </Card>

        {/* 提示列 */}
        <div style={{
          background: "#fff", border: `3px solid ${K.panelEdge}`, borderRadius: 14,
          padding: "8px 12px", marginBottom: 10, fontWeight: 900, fontSize: 13.5, textAlign: "center",
        }}>{hintText}</div>

        {/* 勝利橫幅 */}
        {g.winner !== -1 && (
          <Card style={{
            textAlign: "center", background: g.winner === 0 ? "#eafff3" : "#fff0f0",
            border: `3px solid ${g.winner === 0 ? K.teal : K.p0}`, animation: "pop .5s ease",
          }}>
            <div style={{ fontSize: 24, fontWeight: 900 }}>
              {g.winner === 2 ? "🤝 平手！" : g.winner === 0 ? "🏆🎉 你是最棒的訓龍師！" : "😅 蒙蒙大師贏了！"}
            </div>
            <div style={{ fontSize: 13, color: K.sub, margin: "6px 0 10px" }}>
              {PNAME[0]} {g.score[0]}🐉{g.mommy === 0 ? "＋👑1" : ""} ＝ {finalScore(g, 0)} 分　vs　
              {PNAME[1]} {g.score[1]}🐉{g.mommy === 1 ? "＋👑1" : ""} ＝ {finalScore(g, 1)} 分
            </div>
            <Btn onClick={restart} color={K.teal} edge={K.tealEdge} fg="#fff">🔁 再玩一次</Btn>
          </Card>
        )}

        {/* 骨牌市場 */}
        {g.winner === -1 && (
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 900, fontSize: 14 }}>🧩 骨牌市場</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: K.sub, fontFamily: MONO }}>牌堆剩 {g.deck.length}</div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {g.market.map((d, s) => (
                <div key={s} onClick={() => clickMarket(s)} style={{
                  display: "flex", gap: 3, padding: 6, borderRadius: 12,
                  background: d === -1 ? "#eee4d6" : "#fff",
                  border: `3px solid ${sel === s ? K.p0 : K.panelEdge}`,
                  boxShadow: sel === s ? `0 0 0 3px ${K.p0}66` : "none",
                  cursor: d !== -1 && human && g.phase === "pick" ? "pointer" : "default",
                  opacity: d === -1 ? 0.4 : (human && g.phase === "pick" && legalPairs(g.boards[0], d).length === 0 ? 0.45 : 1),
                  minWidth: 72, minHeight: 42, alignItems: "center", justifyContent: "center",
                }}>
                  {d === -1 ? <span style={{ fontSize: 12, color: K.sub, fontWeight: 700 }}>已拿走</span>
                    : <><HalfCell t={DOMS[d][0]} /><HalfCell t={DOMS[d][1]} /></>}
                </div>
              ))}
            </div>
            {sel >= 0 && (
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <Btn onClick={() => { setSel(-1); setFirstCell(-1); }} color="#fff" edge={K.panelEdge}
                  style={{ padding: "6px 14px", fontSize: 12 }}>✖ 取消選牌</Btn>
              </div>
            )}
            {humanStuck && (
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <Btn onClick={humanSkip} color={K.gold}>⏭ 跳過（換掉一塊骨牌）</Btn>
              </div>
            )}
          </Card>
        )}

        {/* 翻蛋動畫列 */}
        {reveals.length > 0 && (
          <Card style={{ background: "#fffceb", textAlign: "center" }}>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              {reveals.map((r, i) => (
                <div key={i} style={{
                  width: 52, height: 52, borderRadius: 16, background: "#fff",
                  border: `3px solid ${TDARK[r.t]}`, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 28, animation: r.st === "egg" ? "wobble 0.5s infinite" : "pop 0.4s ease",
                }}>
                  {r.st === "egg" ? "🥚" : r.dragon ? "🐉" : "🐚"}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* 你的龍之島 */}
        <Card>
          <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 8, color: K.p0d }}>🐣 你的龍之島</div>
          {grid(0, null, clickCell, false)}
        </Card>

        {/* 蒙蒙大師的島 */}
        <Card>
          <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 8, color: K.p1d }}>
            🧙 蒙蒙大師的島{thinking && <span style={{ fontSize: 12, marginLeft: 8 }}>🧠 思考中…</span>}
          </div>
          {grid(1, null, null, true)}
        </Card>

        {/* 訓龍日誌 */}
        <Card>
          <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 8 }}>📜 訓龍日誌</div>
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
            <summary style={{ fontWeight: 900, fontSize: 14, cursor: "pointer" }}>📖 怎麼玩？（給小訓龍師和爸媽）</summary>
            <div style={{ fontSize: 13, lineHeight: 1.9, marginTop: 8 }}>
              🧩 輪到你：從市場選 1 塊骨牌，拼到你的島上（要貼著已有的地塊，從 🏕️ 營地開始）。<br />
              🥚 撿蛋：新骨牌的每一半，每貼到一格「同樣地形」，就從那種地形的蛋池撿 1 顆蛋。貼到越多，撿越多！<br />
              🐉 翻蛋：是寶寶龍就得 1 分；是空蛋殼 🐚 就拿走「龍媽媽 👑」——終局多 1 分安慰獎。<br />
              📊 小祕密：蛋池是公開的！🌿 草原蛋多但一半是空殼，🌋 火山蛋少卻幾乎顆顆有龍——要拼常見地形多撿蛋，還是賭稀有地形？<br />
              🏆 骨牌拿完後，寶寶龍（＋龍媽媽）最多的人獲勝！<br />
              <span style={{ color: K.sub }}>🧠 蒙蒙大師的祕密：每一步他都在腦中把剩下的比賽亂玩 350 遍（蒙地卡羅樹搜尋），連「翻蛋的運氣」都一起模擬進去，再挑被驗證最多次的那一步。</span>
            </div>
          </details>
        </Card>
      </div>
    </div>
  );
}
