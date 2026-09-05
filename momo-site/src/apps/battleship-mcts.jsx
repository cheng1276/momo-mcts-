import { useState, useRef, useEffect } from "react";

/* ============================================================
   戰艦棋・蒙地卡羅艦隊 — 隱藏資訊下的決定化蒙地卡羅
   ・蒙蒙提督看不到你的艦位：每回合抽樣數百個「與觀測一致」的
     可能世界 → 疊成信念熱圖 → 對最熱候選格各模擬完賽選勝率最高
   ・你可以隨時打開他的熱圖，看貝氏信念如何隨命中逐步收斂
   ============================================================ */

// ---------- 視覺（深夜作戰室・聲納綠）----------
const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
const SERIF = "'Songti TC','Noto Serif TC',serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const K = {
  bg: "#081018", panel: "#101c28", line: "#22364a",
  text: "#e6eef5", dim: "#89a0b3",
  sea: "#0d2438", seaHit: "#3a1620",
  green: "#3fe0a8", greenD: "#1d8f6d", amber: "#e8b45a", amberD: "#8a6428",
  red: "#ff5d5d", redD: "#c23b3b", steel: "#5b7186", steelD: "#37485a",
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
  fire() { const t = ctx().currentTime, d = bus("sfx"); noise(t, 0.14, 0.3, 900, "bandpass", d); tone(520, t, 0.16, "sine", 0.12, d, 180); },
  splash() { const t = ctx().currentTime, d = bus("sfx"); noise(t + 0.05, 0.28, 0.3, 500, "lowpass", d); tone(300, t + 0.05, 0.2, "sine", 0.1, d, 140); },
  hit() { const t = ctx().currentTime, d = bus("sfx"); noise(t, 0.25, 0.45, 150, "lowpass", d); tone(80, t, 0.22, "sine", 0.3, d, 45); noise(t, 0.1, 0.25, 2500, "bandpass", d); },
  sunk() {
    const t = ctx().currentTime, d = bus("sfx");
    noise(t, 0.4, 0.5, 120, "lowpass", d); tone(60, t, 0.4, "sine", 0.32, d, 35);
    tone(440, t + 0.35, 0.18, "square", 0.09, d); tone(349, t + 0.55, 0.24, "square", 0.09, d);
  },
  place() { const t = ctx().currentTime, d = bus("sfx"); noise(t, 0.04, 0.3, 2200, "bandpass", d); tone(160, t, 0.08, "square", 0.1, d); },
  rotate() { const t = ctx().currentTime, d = bus("sfx"); tone(700, t, 0.05, "triangle", 0.12, d, 900); },
  ping() { const t = ctx().currentTime, d = bus("sfx"); tone(1568, t, 0.3, "sine", 0.1, d); tone(1568, t + 0.35, 0.22, "sine", 0.05, d); },
  hint() { const t = ctx().currentTime, d = bus("sfx"); tone(880, t, 0.07, "sine", 0.14, d); tone(1175, t + 0.08, 0.1, "sine", 0.12, d); },
  bad() { const t = ctx().currentTime, d = bus("sfx"); tone(200, t, 0.09, "square", 0.08, d, 150); },
  win() { const t = ctx().currentTime, d = bus("sfx"); [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.09, 0.16, "triangle", 0.2, d)); [659, 784, 1047, 1568].forEach(f => tone(f, t + 0.5, 0.6, "sine", 0.09, d)); },
  lose() { const t = ctx().currentTime, d = bus("sfx"); tone(392, t, 0.25, "triangle", 0.14, d); tone(311, t + 0.25, 0.4, "triangle", 0.14, d); },
};
// 背景音樂：深海巡航（A 小調，72 BPM，含聲納 ping）
const BPM = 72, BEAT = 60 / BPM, LOOP_BEATS = 16;
const MELODY = [
  440, null, null, null, 523, null, 440, null,
  392, null, null, null, 330, null, null, null,
  440, null, null, 523, 587, null, 523, null,
  440, null, 392, null, 330, null, null, null,
];
const BASS = [55, 55, 65.4, 65.4, 73.4, 73.4, 65.4, 55];
function scheduleLoop(t0) {
  const m = bus("music");
  MELODY.forEach((f, i) => { if (f) tone(f, t0 + i * BEAT * 0.5, BEAT * 0.46, "triangle", 0.14, m); });
  BASS.forEach((f, i) => tone(f, t0 + i * BEAT * 2, BEAT * 1.8, "sine", 0.26, m));
  tone(1568, t0 + 3.5 * BEAT, 0.3, "sine", 0.05, m);
  tone(1568, t0 + 11.5 * BEAT, 0.3, "sine", 0.04, m);
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

// ---------- 戰艦棋引擎 ----------
const N = 8, CELLS = 64;
const FLEET = [
  { len: 4, name: "戰艦", icon: "🚢" },
  { len: 3, name: "巡洋艦", icon: "⛴️" },
  { len: 3, name: "潛水艇", icon: "🌊" },
  { len: 2, name: "驅逐艦", icon: "🚤" },
];
const coord = i => "ABCDEFGH"[i % N] + (((i / N) | 0) + 1);
// 預先算好每種長度的所有擺法
const PLACE = {};
for (const L of [2, 3, 4]) {
  const arr = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (c + L <= N) arr.push(Array.from({ length: L }, (_, k) => r * N + c + k));
    if (r + L <= N) arr.push(Array.from({ length: L }, (_, k) => (r + k) * N + c));
  }
  PLACE[L] = arr;
}
function randomFleet() {
  const occ = new Int8Array(CELLS).fill(-1);
  const ships = [];
  for (let s = 0; s < FLEET.length; s++) {
    let cells = null;
    for (let t = 0; t < 500; t++) {
      const p = PLACE[FLEET[s].len][ri(PLACE[FLEET[s].len].length)];
      if (p.every(c => occ[c] === -1)) { cells = p; break; }
    }
    for (const c of cells) occ[c] = s;
    ships.push({ ...FLEET[s], cells, hitCount: 0, sunk: false });
  }
  return { ships, occ };
}
// 對 board 開火：回傳 {res:'miss'|'hit', sunkShip|null, ships'}
function shootAt(ships, occ, cell) {
  const si = occ[cell];
  if (si < 0) return { res: "miss", sunkShip: null, ships };
  const ns = ships.map(s => ({ ...s }));
  ns[si].hitCount++;
  if (ns[si].hitCount >= ns[si].len) { ns[si].sunk = true; return { res: "hit", sunkShip: ns[si], ships: ns }; }
  return { res: "hit", sunkShip: null, ships: ns };
}
const allSunk = ships => ships.every(s => s.sunk);

// ---------- 決定化蒙地卡羅（IS-MCTS 的核心）----------
// 觀測 = shots(0未知/1未中/2命中) + 已沉船的格子（沉沒即揭露）
function obsOf(shots, ships) {
  const blocked = new Set(), sunkCells = new Set(), pending = [];
  ships.forEach(s => { if (s.sunk) s.cells.forEach(c => { sunkCells.add(c); blocked.add(c); }); });
  for (let c = 0; c < CELLS; c++) {
    if (shots[c] === 1) blocked.add(c);
    else if (shots[c] === 2 && !sunkCells.has(c)) pending.push(c);
  }
  const remaining = ships.filter(s => !s.sunk).map(s => s.len);
  return { blocked, pending, remaining, sunkCells };
}
// 抽一個與觀測一致的世界：剩餘船艦的完整擺法
function sampleWorld(obs) {
  const { blocked, pending, remaining } = obs;
  for (let t = 0; t < 30; t++) {
    const occ = new Set();
    const placedCells = [];
    const uncov = new Set(pending);
    const order = remaining.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = ri(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    let ok = true;
    for (const L of order) {
      const legal = PLACE[L].filter(p => p.every(c => !blocked.has(c) && !occ.has(c)));
      if (!legal.length) { ok = false; break; }
      let pool = legal;
      if (uncov.size) {
        const cov = legal.filter(p => p.some(c => uncov.has(c)));
        if (cov.length && rnd() < 0.92) pool = cov;
      }
      const p = pool[ri(pool.length)];
      for (const c of p) { occ.add(c); uncov.delete(c); }
      placedCells.push(p);
    }
    if (ok && uncov.size === 0) return placedCells;
  }
  return null;
}
// 信念熱圖 + 世界樣本
function beliefSample(shots, ships, nWant) {
  const obs = obsOf(shots, ships);
  const heat = new Float64Array(CELLS);
  const worlds = [];
  let tries = 0;
  while (worlds.length < nWant && tries++ < nWant * 5) {
    const w = sampleWorld(obs);
    if (!w) continue;
    worlds.push(w);
    for (const p of w) for (const c of p) if (shots[c] === 0) heat[c]++;
  }
  return { heat, worlds, obs };
}
// 推演用的簡易「搜獵＋鎖定」射擊策略（在已知世界中快速完賽）
function policyShot(shots, sunkCells, minLen) {
  const pending = [];
  for (let c = 0; c < CELLS; c++) if (shots[c] === 2 && !sunkCells.has(c)) pending.push(c);
  const unknown = c => shots[c] === 0;
  if (pending.length >= 2) {
    // 共線延伸
    const a = pending[0], b = pending[1];
    const dr = ((b / N) | 0) - ((a / N) | 0), dc = (b % N) - (a % N);
    if (dr === 0 || dc === 0) {
      const line = pending.slice().sort((x, y) => x - y);
      const step = dr === 0 ? 1 : N;
      const lo = line[0] - step, hi = line[line.length - 1] + step;
      const okLo = lo >= 0 && (dr !== 0 || ((lo / N) | 0) === ((line[0] / N) | 0)) && unknown(lo);
      const okHi = hi < CELLS && (dr !== 0 || ((hi / N) | 0) === ((line[0] / N) | 0)) && unknown(hi);
      if (okLo && okHi) return rnd() < 0.5 ? lo : hi;
      if (okLo) return lo;
      if (okHi) return hi;
    }
  }
  if (pending.length) {
    const p = pending[ri(pending.length)];
    const r = (p / N) | 0, c = p % N;
    const nb = [];
    if (c > 0 && unknown(p - 1)) nb.push(p - 1);
    if (c < N - 1 && unknown(p + 1)) nb.push(p + 1);
    if (r > 0 && unknown(p - N)) nb.push(p - N);
    if (r < N - 1 && unknown(p + N)) nb.push(p + N);
    if (nb.length) return nb[ri(nb.length)];
  }
  // 棋盤格搜獵
  const par = [];
  const any = [];
  for (let c = 0; c < CELLS; c++) if (unknown(c)) {
    any.push(c);
    if ((((c / N) | 0) + (c % N)) % Math.max(2, Math.min(minLen, 2)) === 0) par.push(c);
  }
  if (par.length) return par[ri(par.length)];
  return any.length ? any[ri(any.length)] : -1;
}
// 在單一世界中把整場比賽打完：AI 先打 firstShot，回傳 AI 是否獲勝
function simRace(firstShot, world, worldLens, aiSideObs, humanSideReal) {
  // AI 攻擊方（打世界 world）
  const wOcc = new Int8Array(CELLS).fill(-1);
  world.forEach((p, i) => p.forEach(c => { wOcc[c] = i; }));
  const aShots = aiSideObs.shots.slice();
  const wHit = world.map(p => p.reduce((s, c) => s + (aShots[c] === 2 ? 1 : 0), 0));
  const wSunkCells = new Set(aiSideObs.sunkCellsArr);
  let wRemain = wHit.filter((h, i) => h < worldLens[i]).length;
  // 人類攻擊方（打 AI 的真實艦隊）
  const hShots = humanSideReal.shots.slice();
  const rHit = humanSideReal.hitCounts.slice();
  const rSunkCells = new Set(humanSideReal.sunkCellsArr);
  let rRemain = rHit.filter((h, i) => h < humanSideReal.lens[i]).length;
  const rOcc = humanSideReal.occ;

  const aiFire = cell => {
    const si = wOcc[cell];
    if (si < 0) { aShots[cell] = 1; return; }
    aShots[cell] = 2; wHit[si]++;
    if (wHit[si] >= worldLens[si]) { world[si].forEach(c => wSunkCells.add(c)); wRemain--; }
  };
  const huFire = cell => {
    const si = rOcc[cell];
    if (si < 0) { hShots[cell] = 1; return; }
    hShots[cell] = 2; rHit[si]++;
    if (rHit[si] >= humanSideReal.lens[si]) { humanSideReal.cellsOf[si].forEach(c => rSunkCells.add(c)); rRemain--; }
  };
  aiFire(firstShot);
  if (wRemain === 0) return 1;
  for (let t = 0; t < 140; t++) {
    const hc = policyShot(hShots, rSunkCells, 2);
    if (hc >= 0) huFire(hc);
    if (rRemain === 0) return 0;
    const ac = policyShot(aShots, wSunkCells, 2);
    if (ac >= 0) aiFire(ac);
    if (wRemain === 0) return 1;
  }
  return wRemain <= rRemain ? 1 : 0;
}
// 蒙蒙提督的完整決策
function admiralDecide(hShips, hOcc, shotsH, aShips, aOcc, shotsA) {
  const t0 = performance.now();
  const { heat, worlds, obs } = beliefSample(shotsH, hShips, 420);
  // 候選格：熱度前 6
  const cands = [];
  for (let c = 0; c < CELLS; c++) if (shotsH[c] === 0 && heat[c] > 0) cands.push(c);
  cands.sort((a, b) => heat[b] - heat[a]);
  let top = cands.slice(0, 6);
  if (!top.length) {
    const un = [];
    for (let c = 0; c < CELLS; c++) if (shotsH[c] === 0) un.push(c);
    top = [un[ri(un.length)]];
  }
  // 對每個候選格，在抽樣世界中模擬完賽
  const aiSideObs = { shots: shotsH, sunkCellsArr: [...obs.sunkCells] };
  const hObs = obsOf(shotsA, aShips);
  const humanSideReal = {
    shots: shotsA, occ: aOcc,
    lens: aShips.map(s => s.len),
    hitCounts: aShips.map(s => s.hitCount),
    cellsOf: aShips.map(s => s.cells),
    sunkCellsArr: [...hObs.sunkCells],
  };
  const stats = top.map(cell => {
    let wins = 0, nsim = 0;
    const M = Math.min(worlds.length, 130);
    for (let k = 0; k < M; k++) {
      const w = worlds[(k * 7 + ri(3)) % worlds.length];
      const lens = w.map(p => p.length);
      wins += simRace(cell, w.map(p => p.slice()), lens, aiSideObs, humanSideReal);
      nsim++;
    }
    return { cell, wr: nsim ? wins / nsim : 0.5, n: nsim };
  });
  stats.sort((a, b) => b.wr - a.wr || heat[b.cell] - heat[a.cell]);
  const maxHeat = Math.max(1, ...heat);
  return {
    cell: stats[0].cell,
    stats: stats.slice(0, 4),
    samples: worlds.length,
    sims: stats.reduce((s, x) => s + x.n, 0),
    heat: Array.from(heat, h => h / maxHeat),
    ms: performance.now() - t0,
  };
}

// ---------- UI 小元件 ----------
function Btn({ children, onClick, disabled, kind = "solid", color = K.amber, fg = "#241a08", style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      fontFamily: FONT, fontSize: 13.5, fontWeight: 700, letterSpacing: 0.5,
      padding: "9px 14px", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.4 : 1,
      border: `1px solid ${kind === "solid" ? color : K.line}`,
      background: kind === "solid" ? color : "transparent",
      color: kind === "solid" ? fg : K.text, ...style,
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
function FleetStatus({ ships, own, color }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {ships.map((s, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 5,
          background: K.bg, border: `1px solid ${s.sunk ? K.red : K.line}`,
          borderRadius: 10, padding: "4px 8px", opacity: s.sunk ? 0.75 : 1,
        }}>
          <span style={{ fontSize: 12 }}>{s.icon}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: s.sunk ? K.red : color, textDecoration: s.sunk ? "line-through" : "none" }}>{s.name}</span>
          <span style={{ display: "flex", gap: 2 }}>
            {Array.from({ length: s.len }, (_, k) => (
              <span key={k} style={{
                width: 8, height: 8, borderRadius: 2,
                background: s.sunk ? K.red : own ? (k < s.hitCount ? K.red : K.steel) : (s.sunk ? K.red : K.steelD),
              }} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- 主元件 ----------
export default function App() {
  const [phase, setPhase] = useState("setup");
  // 佈陣
  const [setupShips, setSetupShips] = useState(FLEET.map(f => ({ ...f, cells: null })));
  const [sel, setSel] = useState(0);
  const [orient, setOrient] = useState("H");
  // 戰局
  const [g, setG] = useState(null); // {hShips,hOcc,aShips,aOcc,shotsA,shotsH,turn,winner}
  const [log, setLog] = useState([]);
  const [think, setThink] = useState(null);
  const [showBelief, setShowBelief] = useState(true);
  const [hintCell, setHintCell] = useState(-1);
  const [thinking, setThinking] = useState(false);
  const [sfxOn, setSfxOn] = useState(true);
  const [musicOn, setMusicOn] = useState(false);
  const gRef = useRef(null); gRef.current = g;
  const sfxRef = useRef(true); sfxRef.current = sfxOn;
  const aiBusy = useRef(false);
  const epoch = useRef(0);

  const fx = n => { if (sfxRef.current) { try { SFX[n](); } catch (e) { /* noop */ } } };
  const pushLog = m => setLog(l => [m, ...l].slice(0, 40));
  const commit = ng => { setG(ng); gRef.current = ng; return ng; };
  function toggleMusic() {
    if (musicOn) { stopMusic(); setMusicOn(false); }
    else { try { startMusic(); setMusicOn(true); } catch (e) { /* noop */ } }
  }
  useEffect(() => () => stopMusic(), []);

  // ---- 佈陣操作 ----
  const setupOcc = (() => {
    const o = new Int8Array(CELLS).fill(-1);
    setupShips.forEach((s, i) => { if (s.cells) s.cells.forEach(c => { o[c] = i; }); });
    return o;
  })();
  function setupTap(cell) {
    const at = setupOcc[cell];
    if (at >= 0) { fx("place"); setSetupShips(ss => ss.map((s, i) => i === at ? { ...s, cells: null } : s)); setSel(at); return; }
    if (sel < 0 || setupShips[sel].cells) { fx("bad"); return; }
    const L = setupShips[sel].len;
    const r = (cell / N) | 0, c = cell % N;
    if (orient === "H" && c + L > N) { fx("bad"); return; }
    if (orient === "V" && r + L > N) { fx("bad"); return; }
    const cells = Array.from({ length: L }, (_, k) => orient === "H" ? cell + k : cell + k * N);
    if (!cells.every(x => setupOcc[x] === -1)) { fx("bad"); return; }
    fx("place");
    setSetupShips(ss => {
      const ns = ss.map((s, i) => i === sel ? { ...s, cells } : s);
      const nxt = ns.findIndex(s => !s.cells);
      setSel(nxt);
      return ns;
    });
  }
  function randomSetup() {
    fx("place");
    const f = randomFleet();
    setSetupShips(FLEET.map((spec, i) => ({ ...spec, cells: f.ships[i].cells })));
    setSel(-1);
  }
  function startBattle() {
    if (setupShips.some(s => !s.cells)) { fx("bad"); return; }
    const hOcc = new Int8Array(CELLS).fill(-1);
    const hShips = setupShips.map((s, i) => { s.cells.forEach(c => { hOcc[c] = i; }); return { ...s, hitCount: 0, sunk: false }; });
    const a = randomFleet();
    commit({
      hShips, hOcc, aShips: a.ships, aOcc: a.occ,
      shotsA: new Int8Array(CELLS), shotsH: new Int8Array(CELLS),
      turn: "h", winner: null,
    });
    setLog(["⚓ 開戰！點敵方海域的格子開火。蒙蒙提督看不到你的艦位——他只能靠推理。"]);
    setThink(null); setHintCell(-1);
    setPhase("battle");
    fx("ping");
  }

  // ---- 開火 ----
  function humanShoot(cell) {
    const s = gRef.current;
    if (!s || s.winner || s.turn !== "h" || thinking || s.shotsA[cell] !== 0) { if (s && s.shotsA[cell] !== 0) fx("bad"); return; }
    setHintCell(-1);
    fx("fire");
    const { res, sunkShip, ships } = shootAt(s.aShips, s.aOcc, cell);
    const shotsA = s.shotsA.slice();
    shotsA[cell] = res === "hit" ? 2 : 1;
    const ng = { ...s, aShips: ships, shotsA };
    if (res === "miss") { fx("splash"); pushLog(`🎯 你砲擊 ${coord(cell)}——落空`); }
    else if (sunkShip) { fx("sunk"); pushLog(`💥 你擊沉了敵軍${sunkShip.name}（${sunkShip.len} 格）！`); }
    else { fx("hit"); pushLog(`💥 你命中 ${coord(cell)}！`); }
    if (allSunk(ships)) {
      ng.winner = "h";
      commit(ng); fx("win");
      pushLog("🏆 敵方艦隊全滅——你贏了蒙蒙提督！");
      return;
    }
    ng.turn = "a";
    commit(ng);
    runAI();
  }
  async function runAI() {
    if (aiBusy.current) return;
    aiBusy.current = true;
    const my = epoch.current;
    let s = gRef.current;
    if (s && !s.winner && s.turn === "a") {
      setThinking(true);
      fx("ping");
      await sleep(450);
      if (epoch.current !== my) { setThinking(false); aiBusy.current = false; return; }
      const res = admiralDecide(s.hShips, s.hOcc, s.shotsH, s.aShips, s.aOcc, s.shotsA);
      setThink(res);
      setThinking(false);
      await sleep(400);
      if (epoch.current !== my) { aiBusy.current = false; return; }
      s = gRef.current;
      fx("fire");
      const { res: rr, sunkShip, ships } = shootAt(s.hShips, s.hOcc, res.cell);
      const shotsH = s.shotsH.slice();
      shotsH[res.cell] = rr === "hit" ? 2 : 1;
      const ng = { ...s, hShips: ships, shotsH };
      await sleep(150);
      if (rr === "miss") { fx("splash"); pushLog(`🎖️ 蒙蒙提督砲擊 ${coord(res.cell)}——落空（抽樣 ${res.samples} 個世界・模擬 ${res.sims} 局）`); }
      else if (sunkShip) { fx("sunk"); pushLog(`🔥 蒙蒙提督擊沉了你的${sunkShip.name}！`); }
      else { fx("hit"); pushLog(`🔥 蒙蒙提督命中 ${coord(res.cell)}！`); }
      if (allSunk(ships)) {
        ng.winner = "a";
        commit(ng); fx("lose");
        pushLog("我方艦隊全滅……蒙蒙提督獲勝。");
        aiBusy.current = false;
        return;
      }
      ng.turn = "h";
      commit(ng);
    }
    aiBusy.current = false;
  }
  async function doHint() {
    const s = gRef.current;
    if (!s || s.winner || s.turn !== "h" || thinking) return;
    await sleep(30);
    const { heat } = beliefSample(s.shotsA, s.aShips, 380);
    let best = -1, bv = -1;
    for (let c = 0; c < CELLS; c++) if (s.shotsA[c] === 0 && heat[c] > bv) { bv = heat[c]; best = c; }
    if (best >= 0) { setHintCell(best); fx("hint"); pushLog(`💡 提示：信念抽樣認為 ${coord(best)} 藏船機率最高`); }
  }
  function restart() {
    epoch.current++;
    aiBusy.current = false;
    setPhase("setup");
    setSetupShips(FLEET.map(f => ({ ...f, cells: null })));
    setSel(0); setOrient("H");
    commit(null);
    setLog([]); setThink(null); setHintCell(-1); setThinking(false);
  }

  // ---- 版面 ----
  const cellSz = 38;
  const Grid = ({ children }) => (
    <div style={{
      display: "grid", gridTemplateColumns: `repeat(${N}, ${cellSz}px)`, gap: 2,
      background: K.line, padding: 2, borderRadius: 8, width: "fit-content", margin: "0 auto",
    }}>{children}</div>
  );
  const status = phase === "setup" ? "🛠 佈署你的艦隊"
    : g?.winner ? (g.winner === "h" ? "🏆 你贏了！" : "蒙蒙提督獲勝")
    : thinking ? "🧠 蒙蒙提督推理中…（抽樣可能世界＋模擬完賽）"
    : g?.turn === "h" ? "輪到你——點敵方海域開火" : "🎖️ 蒙蒙提督瞄準中…";

  return (
    <div style={{ minHeight: "100vh", background: K.bg, color: K.text, fontFamily: FONT }}>
      <style>{`
        @keyframes pulseH { 0%,100%{box-shadow:0 0 0 3px ${K.amber}cc inset} 50%{box-shadow:0 0 0 1px ${K.amber}33 inset} }
        @keyframes boom { 0%{transform:scale(.3)} 60%{transform:scale(1.3)} 100%{transform:scale(1)} }
      `}</style>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "18px 12px 40px" }}>

        <header style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 34 }}>⚓</div>
          <div>
            <h1 style={{ margin: 0, fontFamily: SERIF, fontSize: 24, fontWeight: 900, letterSpacing: 2 }}>
              戰艦棋<span style={{ color: K.green }}>・</span>蒙地卡羅艦隊
            </h1>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: K.dim }}>
              隱藏資訊的戰場——蒙蒙提督靠「決定化」推理：抽樣可能世界，疊成信念熱圖。
            </p>
          </div>
        </header>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <Btn kind={musicOn ? "solid" : "ghost"} color={K.green} fg="#04231a" onClick={toggleMusic}
            style={{ padding: "6px 12px", fontSize: 12 }}>{musicOn ? "🎵 音樂 開" : "🎵 音樂 關"}</Btn>
          <Btn kind={sfxOn ? "solid" : "ghost"} color={K.green} fg="#04231a"
            onClick={() => { if (!sfxOn) { try { ctx(); } catch (e) { /* noop */ } } setSfxOn(!sfxOn); }}
            style={{ padding: "6px 12px", fontSize: 12 }}>{sfxOn ? "🔊 音效 開" : "🔇 音效 關"}</Btn>
          <Btn kind="ghost" onClick={restart} style={{ padding: "6px 12px", fontSize: 12 }}>↺ 重新開始</Btn>
        </div>

        <div style={{
          background: K.panel, border: `1px solid ${K.line}`, borderRadius: 12,
          padding: "8px 12px", marginBottom: 12, fontWeight: 700, fontSize: 13, textAlign: "center",
        }}>{status}</div>

        {/* ===== 佈陣階段 ===== */}
        {phase === "setup" && (
          <Card title="艦隊佈署" accent={K.amber} sub="點選一艘船，再點海域放置（船頭在點擊格，向右／向下延伸）；點已放置的船可拿起重放">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {setupShips.map((s, i) => (
                <Btn key={i} kind={sel === i ? "solid" : "ghost"}
                  color={s.cells ? K.green : K.amber} fg={s.cells ? "#04231a" : "#241a08"}
                  onClick={() => { setSel(i); fx("rotate"); }}
                  style={{ padding: "7px 10px", fontSize: 12 }}>
                  {s.icon} {s.name}（{s.len}）{s.cells ? " ✓" : ""}
                </Btn>
              ))}
              <Btn kind="ghost" onClick={() => { setOrient(o => o === "H" ? "V" : "H"); fx("rotate"); }}
                style={{ padding: "7px 10px", fontSize: 12 }}>
                {orient === "H" ? "↔ 橫放" : "↕ 直放"}
              </Btn>
            </div>
            <Grid>
              {Array.from({ length: CELLS }, (_, i) => {
                const at = setupOcc[i];
                return (
                  <div key={i} onClick={() => setupTap(i)} style={{
                    width: cellSz, height: cellSz, background: at >= 0 ? K.steel : K.sea,
                    border: `1px solid ${at >= 0 ? K.steelD : "transparent"}`,
                    borderRadius: 4, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
                  }}>{at >= 0 ? setupShips[at].icon : ""}</div>
                );
              })}
            </Grid>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
              <Btn kind="ghost" onClick={randomSetup}>🎲 隨機佈陣</Btn>
              <Btn onClick={startBattle} disabled={setupShips.some(s => !s.cells)} color={K.green} fg="#04231a">
                ⚓ 開戰！
              </Btn>
            </div>
          </Card>
        )}

        {/* ===== 戰鬥階段 ===== */}
        {phase === "battle" && g && (
          <div>
            {g.winner && (
              <Card accent={g.winner === "h" ? K.green : K.red}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 900 }}>
                    {g.winner === "h" ? "🏆🎉 敵方艦隊全滅，你贏了！" : "😅 我方艦隊全滅，蒙蒙提督獲勝！"}
                  </div>
                  <div style={{ margin: "10px 0 0" }}>
                    <Btn onClick={restart} color={K.green} fg="#04231a">🔁 再戰一場</Btn>
                  </div>
                </div>
              </Card>
            )}

            {/* 敵方海域 */}
            <Card title="敵方海域（點格開火）" accent={K.red}
              sub={`敵艦隊：${g.aShips.filter(s => !s.sunk).length} 艘仍在海上`}>
              <div style={{ marginBottom: 8 }}><FleetStatus ships={g.aShips} own={false} color={K.dim} /></div>
              <Grid>
                {Array.from({ length: CELLS }, (_, i) => {
                  const sh = g.shotsA[i];
                  const si = g.aOcc[i];
                  const sunkHere = si >= 0 && g.aShips[si].sunk;
                  const revealLost = g.winner && si >= 0 && sh === 0;
                  const canFire = !g.winner && g.turn === "h" && !thinking && sh === 0;
                  return (
                    <div key={i} onClick={() => humanShoot(i)} style={{
                      width: cellSz, height: cellSz, borderRadius: 4,
                      background: sunkHere ? K.seaHit : sh === 2 ? "#4a1f2b" : K.sea,
                      border: `1px solid ${sunkHere ? K.red : "transparent"}`,
                      cursor: canFire ? "crosshair" : "default",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                      animation: hintCell === i ? "pulseH 0.9s infinite" : "none",
                      opacity: revealLost ? 0.85 : 1,
                    }}>
                      {sunkHere ? "⚓" : sh === 2 ? <span style={{ animation: "boom .35s ease" }}>💥</span>
                        : sh === 1 ? <span style={{ width: 8, height: 8, borderRadius: 99, background: "#e6eef577" }} />
                        : revealLost ? <span style={{ opacity: 0.5 }}>🚢</span> : ""}
                    </div>
                  );
                })}
              </Grid>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                <Btn onClick={doHint} disabled={!!g.winner || g.turn !== "h" || thinking}>💡 提示（信念抽樣）</Btn>
              </div>
            </Card>

            {/* 我方海域 */}
            <Card title="我方海域" accent={K.amber}
              sub="蒙蒙提督的信念熱圖：越紅代表他越相信那裡藏著你的船">
              <div style={{ marginBottom: 8 }}><FleetStatus ships={g.hShips} own={true} color={K.amber} /></div>
              <Grid>
                {Array.from({ length: CELLS }, (_, i) => {
                  const sh = g.shotsH[i];
                  const si = g.hOcc[i];
                  const sunkHere = si >= 0 && g.hShips[si].sunk;
                  const h = showBelief && think && sh === 0 ? think.heat[i] : 0;
                  return (
                    <div key={i} style={{
                      width: cellSz, height: cellSz, borderRadius: 4,
                      background: sunkHere ? K.seaHit
                        : sh === 2 ? "#4a1f2b"
                        : h > 0 ? `rgba(255,93,93,${0.1 + h * 0.55})`
                        : si >= 0 ? K.steel : K.sea,
                      border: `1px solid ${sunkHere ? K.red : si >= 0 ? K.steelD : "transparent"}`,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
                    }}>
                      {sunkHere ? "🔥" : sh === 2 ? "💥" : sh === 1 ? <span style={{ width: 8, height: 8, borderRadius: 99, background: "#e6eef555" }} /> : si >= 0 ? g.hShips[si].icon : ""}
                    </div>
                  );
                })}
              </Grid>
              <div style={{ textAlign: "center", marginTop: 10 }}>
                <Btn kind={showBelief ? "solid" : "ghost"} color={K.red} fg="#2a0808"
                  onClick={() => setShowBelief(b => !b)} style={{ padding: "7px 14px", fontSize: 12 }}>
                  {showBelief ? "🧠 信念熱圖 開" : "🧠 信念熱圖 關"}
                </Btn>
              </div>
            </Card>

            {/* 提督推理 */}
            <Card title="蒙蒙提督的推理" accent={K.green}
              sub={think ? `抽樣 ${think.samples} 個與觀測一致的世界・完賽模擬 ${think.sims} 局・${think.ms.toFixed(0)} ms` : "提督開火後，這裡會顯示他的候選格與勝率"}>
              {think ? (
                <div>
                  {think.stats.map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <span style={{ fontFamily: MONO, fontSize: 12.5, width: 34, fontWeight: 700, color: i === 0 ? K.green : K.text }}>{coord(s.cell)}</span>
                      <div style={{ flex: 1, height: 8, background: K.bg, borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ width: `${s.wr * 100}%`, height: "100%", background: i === 0 ? K.green : K.steel }} />
                      </div>
                      <span style={{ fontFamily: MONO, fontSize: 11.5, color: K.dim, width: 108, textAlign: "right" }}>
                        勝率 {(s.wr * 100).toFixed(0)}%・{s.n} 局
                      </span>
                    </div>
                  ))}
                  <p style={{ fontSize: 11, color: K.dim, margin: "8px 0 0" }}>
                    ※ 流程：信念抽樣（哪些艦位安排與所有命中／落空一致？）→ 熱圖排序 → 候選格逐一模擬完賽。
                  </p>
                </div>
              ) : <p style={{ fontSize: 12.5, color: K.dim, margin: 0 }}>（尚無資料）</p>}
            </Card>

            {/* 戰報 */}
            <Card title="戰報" accent={K.amber}>
              <div style={{ maxHeight: 150, overflowY: "auto" }}>
                {log.map((m, i) => (
                  <div key={i} style={{
                    fontSize: 12.5, color: i === 0 ? K.text : K.dim, fontWeight: i === 0 ? 700 : 400,
                    padding: "4px 6px", borderRadius: 8, background: i === 0 ? K.bg : "transparent", marginBottom: 2,
                  }}>{m}</div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* 規則 */}
        <Card title="怎麼玩？" accent={K.green}>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>規則與蒙蒙提督的祕密</summary>
            <div style={{ fontSize: 12.5, lineHeight: 1.9, marginTop: 8 }}>
              ⚓ 雙方各有 4 艘船（4・3・3・2 格），輪流對敵方海域開火一發。命中會顯示 💥，整艘打完會「擊沉」並揭露船位。先讓對方全滅的一方獲勝。<br />
              🧠 蒙蒙提督的祕密：他看不到你的棋盤——這是「隱藏資訊」賽局。他的做法是 Information-Set 蒙地卡羅的核心「決定化」：①抽樣數百個與所有觀測（命中、落空、沉沒）一致的可能艦位世界 ②疊加成信念熱圖（我方海域上那片紅） ③取最熱的幾格，各自在抽樣世界中把整場比賽模擬打完，選勝率最高的一格開火。你每被命中一次，他的熱圖就收斂一分——那就是貝氏更新的樣子。<br />
              💡 你的提示按鈕用的是同一套信念抽樣，公平對決。
            </div>
          </details>
        </Card>
      </div>
    </div>
  );
}
