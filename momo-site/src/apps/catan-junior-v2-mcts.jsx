import { useState, useRef, useEffect } from "react";

/* ============================================================
   新卡坦島兒童版 — 雙島鏈與幽靈島
   ・佈局貼近桌遊原作：兩座對稱的海島各 8 個海盜窩位，四種資源
     （木材／山羊／糖蜜／彎刀）各成對出現，中央為幽靈島與市集
   ・擲骰次數不設上限：真的要蓋滿 7 個海盜窩才分勝負
   ・對手「鬍鬍船長」由 open-loop MCTS 驅動（骰子隨機）
   ============================================================ */

// ---------- 視覺（陽光海盜繪本風）----------
const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const K = {
  sea: "#3fa8cf", seaDeep: "#2b86ad", seaLite: "#6cc6e4",
  panel: "#fff6e3", panelEdge: "#e2b96c", sand: "#ffe9b0", sandEdge: "#d8a24a",
  ink: "#43301f", sub: "#8a6d4f",
  p0: "#ff5d5d", p0d: "#c23b3b",
  p1: "#8e6cf0", p1d: "#6a4bd0",
  sun: "#ffb84d", sunEdge: "#d98a1f", teal: "#2bbfa3", tealEdge: "#1d8f7a",
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
  dice() { const t = ctx().currentTime, d = bus("sfx"); for (let i = 0; i < 3; i++) noise(t + i * 0.06, 0.04, 0.3, 1500 + ri(800), "bandpass", d); tone(520, t + 0.2, 0.08, "triangle", 0.16, d); },
  collect() { const t = ctx().currentTime, d = bus("sfx"); tone(784, t, 0.09, "sine", 0.18, d); tone(1047, t + 0.08, 0.12, "sine", 0.16, d); },
  ship() { const t = ctx().currentTime, d = bus("sfx"); noise(t, 0.18, 0.3, 500, "lowpass", d); tone(330, t, 0.15, "sine", 0.14, d, 220); },
  build() { const t = ctx().currentTime, d = bus("sfx"); noise(t, 0.05, 0.35, 2200, "bandpass", d); tone(180, t, 0.09, "square", 0.12, d); noise(t + 0.12, 0.05, 0.28, 1800, "bandpass", d); },
  coco() { const t = ctx().currentTime, d = bus("sfx"); tone(1568, t, 0.07, "square", 0.1, d); tone(1976, t + 0.09, 0.09, "square", 0.1, d); },
  trade() { const t = ctx().currentTime, d = bus("sfx"); tone(988, t, 0.06, "triangle", 0.14, d); tone(1319, t + 0.06, 0.1, "triangle", 0.12, d); },
  ghost() { const t = ctx().currentTime, d = bus("sfx"); tone(600, t, 0.5, "sine", 0.14, d, 180); tone(450, t + 0.1, 0.5, "sine", 0.08, d, 140); },
  bad() { const t = ctx().currentTime, d = bus("sfx"); tone(220, t, 0.12, "square", 0.08, d, 160); },
  win() { const t = ctx().currentTime, d = bus("sfx"); [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.09, 0.16, "triangle", 0.2, d)); [659, 784, 1047, 1568].forEach(f => tone(f, t + 0.5, 0.6, "sine", 0.09, d)); },
  lose() { const t = ctx().currentTime, d = bus("sfx"); tone(392, t, 0.25, "triangle", 0.14, d); tone(311, t + 0.25, 0.4, "triangle", 0.14, d); },
};
const BPM = 104, BEAT = 60 / BPM, LOOP_BEATS = 16;
const MELODY = [
  523, null, 659, 784, 880, null, 784, 659,
  523, null, 587, 659, 523, null, null, null,
  659, null, 784, 880, 1047, null, 880, 784,
  659, 784, 880, null, 784, null, null, null,
];
const BASS = [131, 131, 196, 196, 220, 220, 175, 196];
function scheduleLoop(t0) {
  const m = bus("music");
  MELODY.forEach((f, i) => { if (f) tone(f, t0 + i * BEAT * 0.5, BEAT * 0.45, "triangle", 0.18, m); });
  BASS.forEach((f, i) => tone(f, t0 + i * BEAT * 2, BEAT * 1.5, "sine", 0.22, m));
  for (let b = 1; b < LOOP_BEATS; b += 2) noise(t0 + b * BEAT, 0.03, 0.08, 6000, "highpass", m);
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

// ---------- 地圖：雙島鏈（貼近原作）----------
// 四種資源島 + 金幣（金幣為萬用交易貨幣，可在市集換）
const RES = ["wood", "goat", "mol", "cut", "gold"];
const RICON = ["🪵", "🐐", "🍯", "⚔️", "🪙"];
const RNAME = ["木材", "山羊", "糖蜜", "彎刀", "金幣"];
// 16 個海盜窩位：左島（0–7）與右島（8–15）各成一環，兩島頂端與底端各以一條跨海航線相連
// 資源／點數對稱：同資源在兩島各出現兩次，配不同骰數（骰 1–5，6 = 幽靈）
const LEFT_RES = [0, 1, 2, 3, 0, 1, 2, 3];   // 木羊蜜刀 木羊蜜刀
const LEFT_NUM = [3, 4, 2, 5, 1, 2, 5, 4];
const RIGHT_RES = [3, 2, 1, 0, 3, 2, 1, 0];  // 鏡像：刀蜜羊木 刀蜜羊木
const RIGHT_NUM = [3, 4, 2, 5, 1, 2, 5, 4];
const SITE_RES = [...LEFT_RES, ...RIGHT_RES];
const SITE_NUM = [...LEFT_NUM, ...RIGHT_NUM];
const N = 16;
const NAMES = SITE_RES.map((r, i) => `${["木木", "咩咩", "甜甜", "亮亮"][r]}${i < 8 ? "西" : "東"}${["礁", "灣", "岬", "洲"][(i % 8) >> 1]}`);

// 航線：每島 8 條環邊 + 2 條跨海橋（頂端 3–8? 用固定索引）
// 左島環：0-1,1-2,...,7-0 ；右島環：8-9,...,15-8
// 跨海：左島頂(0) ↔ 右島頂(8)；左島底(4) ↔ 右島底(12)
const EDGES = [];
for (let i = 0; i < 8; i++) EDGES.push([i, (i + 1) % 8]);
for (let i = 0; i < 8; i++) EDGES.push([8 + i, 8 + ((i + 1) % 8)]);
EDGES.push([0, 8]); EDGES.push([4, 12]);
const E = EDGES.length; // 18
const ADJ_EDGES = Array.from({ length: N }, () => []);
EDGES.forEach(([a, b], e) => { ADJ_EDGES[a].push(e); ADJ_EDGES[b].push(e); });

// 座標（兩個橢圓環 + 中央幽靈島）
const CX = 240, CY = 235;
function posOf(i) {
  const isLeft = i < 8;
  const k = i % 8;
  const cx = isLeft ? 112 : 368;
  const ang = (-90 + k * 45) * Math.PI / 180;
  const rx = 78, ry = 150;
  return [cx + rx * Math.cos(ang), CY + ry * Math.sin(ang)];
}
const COST = { ship: [1, 1, 0, 0, 0], lair: [1, 1, 1, 1, 0], coco: [0, 0, 1, 1, 1] };
const WIN_LAIRS = 7;
const PNAME = ["小紅", "鬍鬍船長"], PICON = ["🔴", "🟣"];

function mkGame() {
  const owners = Array(N).fill(-1);
  // 起始（對稱）：小紅在西島頂端(0)與東島底端(12)；鬍鬍在西島底端(4)與東島頂端(8)
  owners[0] = 0; owners[12] = 0;
  owners[4] = 1; owners[8] = 1;
  return {
    owners, ships: Array(E).fill(-1), ghost: -1,
    hands: [[1, 1, 0, 0, 0], [1, 1, 0, 0, 0]], coco: [0, 0],
    turn: 0, phase: "roll", lastDice: 0, rolls: 0, winner: -1,
    stuckStreak: 0,
  };
}
const cloneG = g => ({
  ...g, owners: g.owners.slice(), ships: g.ships.slice(),
  hands: [g.hands[0].slice(), g.hands[1].slice()], coco: g.coco.slice(),
});
const lairsOf = (g, p) => g.owners.reduce((s, o) => s + (o === p ? 1 : 0), 0);
const shipsOf = (g, p) => g.ships.reduce((s, o) => s + (o === p ? 1 : 0), 0);
const canPay = (h, c) => c.every((v, i) => h[i] >= v);
const pay = (h, c) => c.forEach((v, i) => { h[i] -= v; });

function legalShipEdges(g, p) {
  const out = [];
  for (let e = 0; e < E; e++) {
    if (g.ships[e] !== -1) continue;
    const [a, b] = EDGES[e];
    const nearLair = g.owners[a] === p || g.owners[b] === p;
    const nearShip = ADJ_EDGES[a].some(x => g.ships[x] === p) || ADJ_EDGES[b].some(x => g.ships[x] === p);
    if (nearLair || nearShip) out.push(e);
  }
  return out;
}
function legalLairSites(g, p) {
  const out = [];
  for (let s = 0; s < N; s++) {
    if (g.owners[s] !== -1) continue;
    if (ADJ_EDGES[s].some(e => g.ships[e] === p)) out.push(s);
  }
  return out;
}
function legalActions(g) {
  if (g.winner !== -1) return [];
  const p = g.turn, h = g.hands[p];
  if (g.phase === "ghostPlace") {
    const acts = [];
    for (let s = 0; s < N; s++) if (s !== g.ghost) acts.push({ t: "ghost", site: s });
    return acts;
  }
  if (g.phase === "ghostTake") return [0, 1, 2, 3, 4].map(i => ({ t: "take", res: i }));
  const acts = [{ t: "end" }];
  if (canPay(h, COST.ship)) for (const e of legalShipEdges(g, p)) acts.push({ t: "ship", edge: e });
  if (canPay(h, COST.lair)) for (const s of legalLairSites(g, p)) acts.push({ t: "lair", site: s });
  if (canPay(h, COST.coco)) acts.push({ t: "coco" });
  // 市集：2 個一樣的換 1 個任選；金幣 1 枚可換任一資源（原作市集精神）
  for (let gv = 0; gv < 5; gv++) if (h[gv] >= 2) for (let gt = 0; gt < 5; gt++) if (gt !== gv) acts.push({ t: "trade", give: gv, get: gt });
  if (h[4] >= 1) for (let gt = 0; gt < 4; gt++) acts.push({ t: "gold", get: gt });
  return acts;
}
const keyOf = a => `${a.t}|${a.edge ?? ""}|${a.site ?? ""}|${a.give ?? ""}|${a.get ?? ""}|${a.res ?? ""}`;

function endCheck(g) {
  for (const p of [0, 1]) if (lairsOf(g, p) >= WIN_LAIRS) { g.winner = p; g.phase = "over"; return; }
  // 沒有擲骰上限；只有在「所有島都蓋滿」這種極端情況才比海盜窩數
  if (g.owners.every(o => o !== -1)) {
    const l0 = lairsOf(g, 0), l1 = lairsOf(g, 1);
    g.winner = l0 === l1 ? 2 : (l0 > l1 ? 0 : 1);
    g.phase = "over";
  }
}
function doRoll(g0, msgs) {
  const g = cloneG(g0);
  g.rolls++;
  const d = 1 + ri(6);
  g.lastDice = d;
  if (d === 6) {
    g.phase = "ghostPlace";
    if (msgs) msgs.push(`${PICON[g.turn]} 骰出 👻！${PNAME[g.turn]}要移動幽靈船長`);
  } else {
    const got = [[], []];
    for (let s = 0; s < N; s++) {
      if (SITE_NUM[s] === d && g.owners[s] !== -1 && g.ghost !== s) {
        g.hands[g.owners[s]][SITE_RES[s]]++;
        got[g.owners[s]].push(RICON[SITE_RES[s]]);
      }
    }
    g.phase = "build";
    if (msgs) {
      const parts = [0, 1].filter(p => got[p].length).map(p => `${PNAME[p]} 拿到 ${got[p].join("")}`);
      msgs.push(`🎲 ${d}！${parts.length ? parts.join("，") : "這次沒有島送禮物"}`);
    }
  }
  endCheck(g);
  return g;
}
const COCOS = [
  { icon: "🎁", name: "百寶箱" }, { icon: "🌬️", name: "順風" },
  { icon: "👋", name: "驅靈號角" }, { icon: "🪙", name: "金幣雨" },
];
function applyAction(g0, a, msgs) {
  const g = cloneG(g0);
  const p = g.turn, h = g.hands[p];
  switch (a.t) {
    case "end":
      g.turn = 1 - p; g.phase = "roll";
      if (msgs) msgs.push(`${PICON[p]} ${PNAME[p]} 結束回合`);
      break;
    case "ship":
      pay(h, COST.ship); g.ships[a.edge] = p;
      if (msgs) msgs.push(`${PICON[p]} ${PNAME[p]} 造了一艘船 ⛵${a.edge >= 16 ? "（跨海航線！）" : ""}`);
      break;
    case "lair":
      pay(h, COST.lair); g.owners[a.site] = p;
      if (msgs) msgs.push(`${PICON[p]} ${PNAME[p]} 在${NAMES[a.site]}蓋了海盜窩 🏠（${lairsOf(g, p)}/${WIN_LAIRS}）`);
      break;
    case "trade":
      h[a.give] -= 2; h[a.get] += 1;
      if (msgs) msgs.push(`${PICON[p]} ${PNAME[p]} 用 ${RICON[a.give]}${RICON[a.give]} 換了 ${RICON[a.get]}`);
      break;
    case "gold":
      h[4] -= 1; h[a.get] += 1;
      if (msgs) msgs.push(`${PICON[p]} ${PNAME[p]} 在市集用 🪙 換了 ${RICON[a.get]}`);
      break;
    case "ghost":
      g.ghost = a.site; g.phase = "ghostTake";
      if (msgs) msgs.push(`👻 幽靈船長飄到了${NAMES[a.site]}（那裡暫停送禮物）`);
      break;
    case "take":
      h[a.res]++; g.phase = "build";
      if (msgs) msgs.push(`${PICON[p]} ${PNAME[p]} 從銀行拿了 1 個 ${RICON[a.res]}`);
      break;
    case "coco": {
      pay(h, COST.coco); g.coco[p]++;
      const c = ri(4);
      if (c === 0) { const r1 = ri(4), r2 = ri(4); h[r1]++; h[r2]++; if (msgs) msgs.push(`🦜 ${PNAME[p]} 抽到${COCOS[0].icon}百寶箱：獲得 ${RICON[r1]}${RICON[r2]}`); }
      else if (c === 1) {
        const es = legalShipEdges(g, p);
        if (es.length) { g.ships[es[ri(es.length)]] = p; if (msgs) msgs.push(`🦜 ${PNAME[p]} 抽到${COCOS[1].icon}順風：免費多了一艘船 ⛵`); }
        else { h[0]++; if (msgs) msgs.push(`🦜 ${PNAME[p]} 抽到${COCOS[1].icon}順風：沒地方放船，改拿 🪵`); }
      }
      else if (c === 2) { g.ghost = -1; h[4]++; if (msgs) msgs.push(`🦜 ${PNAME[p]} 抽到${COCOS[2].icon}驅靈號角：幽靈船長回家了，還拿到 🪙`); }
      else { h[4] += 2; if (msgs) msgs.push(`🦜 ${PNAME[p]} 抽到${COCOS[3].icon}金幣雨：🪙🪙`); }
      break;
    }
    default: break;
  }
  endCheck(g);
  return g;
}

// ---------- MCTS（open-loop）----------
function stepSim(g, a) {
  let s = applyAction(g, a);
  while (s.winner === -1 && s.phase === "roll") s = doRoll(s);
  return s;
}
function evalG(g) {
  if (g.winner === 1) return 1;
  if (g.winner === 0) return 0;
  if (g.winner === 2) return 0.5;
  let v = 0.5 + 0.09 * (lairsOf(g, 1) - lairsOf(g, 0));
  v += 0.015 * (shipsOf(g, 1) - shipsOf(g, 0));
  const hs = p => Math.min(8, g.hands[p].reduce((a, b) => a + b, 0));
  v += 0.006 * (hs(1) - hs(0));
  return clamp(v, 0.03, 0.97);
}
function rolloutPick(legal) {
  const by = t => legal.filter(a => a.t === t);
  const lair = by("lair"); if (lair.length && rnd() < 0.85) return lair[ri(lair.length)];
  const ship = by("ship"); if (ship.length && rnd() < 0.5) return ship[ri(ship.length)];
  const gold = by("gold"); if (gold.length && rnd() < 0.5) return gold[ri(gold.length)];
  const coco = by("coco"); if (coco.length && rnd() < 0.3) return coco[0];
  if (rnd() < 0.55) { const e = by("end"); if (e.length) return e[0]; }
  return legal[ri(legal.length)];
}
function mctsDecide(g0, iters, C = 1.2) {
  const root = { kids: new Map(), visits: 0, val: 0 };
  for (let it = 0; it < iters; it++) {
    let s = cloneG(g0);
    let node = root;
    const path = [root];
    let guard = 0;
    while (s.winner === -1 && guard++ < 50) {
      const legal = legalActions(s);
      if (!legal.length) break;
      const keys = legal.map(keyOf);
      const unIdx = [];
      for (let i = 0; i < keys.length; i++) if (!node.kids.has(keys[i])) unIdx.push(i);
      if (unIdx.length) {
        const i = unIdx[ri(unIdx.length)];
        const child = { kids: new Map(), visits: 0, val: 0 };
        node.kids.set(keys[i], child);
        s = stepSim(s, legal[i]);
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
      s = stepSim(s, legal[bi]);
      path.push(bn); node = bn;
    }
    let steps = 0;
    const rollLimit = g0.rolls + 40;
    while (s.winner === -1 && steps++ < 200 && s.rolls < rollLimit) {
      const legal = legalActions(s);
      if (!legal.length) break;
      s = stepSim(s, rolloutPick(legal));
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
  return { action: best, total: root.visits };
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
  const [log, setLog] = useState(["⚓ 出航囉！兩座大島、一座幽靈島——先蓋滿 7 個海盜窩的人獲勝！輪到你，按下骰子吧！"]);
  const [mode, setMode] = useState(null); // 'ship' | 'lair' | 'trade' | 'gold' | null
  const [tGive, setTGive] = useState(-1);
  const [tGet, setTGet] = useState(-1);
  const [thinking, setThinking] = useState(false);
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

  const human = g.turn === 0 && g.winner === -1;
  const legalShips = human && g.phase === "build" ? legalShipEdges(g, 0) : [];
  const legalLairs = human && g.phase === "build" ? legalLairSites(g, 0) : [];
  const canShip = human && g.phase === "build" && canPay(g.hands[0], COST.ship) && legalShips.length > 0;
  const canLair = human && g.phase === "build" && canPay(g.hands[0], COST.lair) && legalLairs.length > 0;
  const canCoco = human && g.phase === "build" && canPay(g.hands[0], COST.coco);
  const canTrade = human && g.phase === "build" && g.hands[0].some(v => v >= 2);
  const canGold = human && g.phase === "build" && g.hands[0][4] >= 1;

  function humanRoll() {
    if (!human || g.phase !== "roll") return;
    fx("dice");
    const msgs = [];
    const ng = commit(doRoll(g, msgs));
    pushLog(msgs);
    if (ng.lastDice === 6) fx("ghost"); else fx("collect");
  }
  function doA(a) {
    const msgs = [];
    const ng = commit(applyAction(gRef.current, a, msgs));
    pushLog(msgs);
    if (a.t === "ship") fx("ship");
    if (a.t === "lair") fx("build");
    if (a.t === "trade" || a.t === "gold") fx("trade");
    if (a.t === "coco") fx("coco");
    if (a.t === "take") fx("collect");
    if (ng.winner !== -1) { fx(ng.winner === 0 ? "win" : "lose"); return; }
    if (a.t === "end") runAI();
  }
  function clickIsle(s) {
    if (!human) return;
    if (g.phase === "ghostPlace") { if (s !== g.ghost) { fx("ghost"); doA({ t: "ghost", site: s }); } return; }
    if (mode === "lair" && legalLairs.includes(s)) { setMode(null); doA({ t: "lair", site: s }); }
    else if (mode === "lair") fx("bad");
  }
  function clickEdge(e) {
    if (!human) return;
    if (mode === "ship" && legalShips.includes(e)) { setMode(null); doA({ t: "ship", edge: e }); }
    else if (mode === "ship") fx("bad");
  }
  function confirmTrade() {
    if (tGive < 0 || tGet < 0 || tGive === tGet || g.hands[0][tGive] < 2) { fx("bad"); return; }
    setMode(null); setTGive(-1); setTGet(-1);
    doA({ t: "trade", give: tGive, get: tGet });
  }
  async function runAI() {
    if (aiBusy.current) return;
    aiBusy.current = true;
    const my = epoch.current;
    let s = gRef.current;
    while (s.winner === -1 && s.turn === 1 && epoch.current === my) {
      if (s.phase === "roll") {
        await sleep(750);
        if (epoch.current !== my) break;
        fx("dice");
        const msgs = [];
        s = commit(doRoll(s, msgs));
        pushLog(msgs);
        if (s.lastDice === 6) fx("ghost"); else fx("collect");
        continue;
      }
      setThinking(true);
      await sleep(120);
      if (epoch.current !== my) { setThinking(false); break; }
      const { action } = mctsDecide(s, 600);
      setThinking(false);
      await sleep(400);
      if (epoch.current !== my) break;
      const msgs = [];
      s = commit(applyAction(s, action, msgs));
      pushLog(msgs);
      if (action.t === "ship") fx("ship");
      if (action.t === "lair") fx("build");
      if (action.t === "coco") fx("coco");
      if (action.t === "trade" || action.t === "gold") fx("trade");
      if (action.t === "take") fx("collect");
      await sleep(650);
    }
    aiBusy.current = false;
    if (epoch.current === my && s.winner !== -1) fx(s.winner === 0 ? "win" : "lose");
  }
  function restart() {
    epoch.current++;
    aiBusy.current = false;
    commit(mkGame());
    setLog(["⚓ 新的一局！輪到你，按下骰子吧！"]);
    setMode(null); setThinking(false);
  }

  const IR = 24;
  const hintText = g.winner !== -1
    ? (g.winner === 2 ? "平手！再來一局吧" : g.winner === 0 ? "你贏了！🎉" : "鬍鬍船長贏了！再挑戰一次 💪")
    : thinking ? "🧠 鬍鬍船長思考中…（MCTS 模擬 600 局）"
    : !human ? "🟣 鬍鬍船長的回合…"
    : g.phase === "roll" ? "輪到你！按下 🎲 骰子"
    : g.phase === "ghostPlace" ? "點一座島，把幽靈船長 👻 放過去！"
    : g.phase === "ghostTake" ? "從銀行拿 1 個資源，點下面選一個！"
    : mode === "ship" ? "點一條發亮的航線放船 ⛵（跨海航線也可以！）"
    : mode === "lair" ? "點一座發亮的島蓋海盜窩 🏠"
    : "蓋東西、去市集，或按「結束回合」";

  return (
    <div style={{ minHeight: "100vh", background: K.sea, color: K.ink, fontFamily: FONT }}>
      <style>{`
        @keyframes pulse { 0%,100%{stroke-opacity:.9} 50%{stroke-opacity:.25} }
        @keyframes pulseE { 0%,100%{opacity:.9} 50%{opacity:.3} }
        @keyframes bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes pop { 0%{transform:scale(.5)} 70%{transform:scale(1.15)} 100%{transform:scale(1)} }
      `}</style>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 12px 40px" }}>

        <header style={{ textAlign: "center", marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: 2, color: "#fff", textShadow: `0 3px 0 ${K.seaDeep}` }}>
            🏴‍☠️ 新卡坦島兒童版 🦜
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#eafaff", fontWeight: 700 }}>
            兩座大島・一座幽靈島・不限回合，先蓋滿 {WIN_LAIRS} 個海盜窩才算贏！
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 8, flexWrap: "wrap" }}>
            <Btn onClick={toggleMusic} color={musicOn ? K.teal : "#fff"} edge={musicOn ? K.tealEdge : "#bcd6de"}
              fg={musicOn ? "#fff" : K.ink} style={{ padding: "6px 12px", fontSize: 12 }}>
              {musicOn ? "🎵 音樂 開" : "🎵 音樂 關"}
            </Btn>
            <Btn onClick={() => { if (!sfxOn) { try { ctx(); } catch (e) { /* noop */ } } setSfxOn(!sfxOn); }}
              color={sfxOn ? K.teal : "#fff"} edge={sfxOn ? K.tealEdge : "#bcd6de"} fg={sfxOn ? "#fff" : K.ink}
              style={{ padding: "6px 12px", fontSize: 12 }}>
              {sfxOn ? "🔊 音效 開" : "🔇 音效 關"}
            </Btn>
            <Btn onClick={restart} color="#fff" edge="#bcd6de" style={{ padding: "6px 12px", fontSize: 12 }}>↺ 重新開始</Btn>
          </div>
        </header>

        {/* 計分板 */}
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
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
                <div style={{ fontSize: 15, letterSpacing: 2, margin: "4px 0" }}>
                  {Array.from({ length: WIN_LAIRS }, (_, i) => (
                    <span key={i} style={{ color: i < lairsOf(g, p) ? col : "#d9c9a8" }}>{i < lairsOf(g, p) ? "🏠" : "○"}</span>
                  ))}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: K.sub }}>
                  {RES.map((_, i) => `${RICON[i]}${g.hands[p][i]}`).join(" ")}　🦜{g.coco[p]}
                </div>
              </Card>
            );
          })}
        </div>

        <div style={{
          background: "#fff", border: `3px solid ${K.panelEdge}`, borderRadius: 14,
          padding: "8px 12px", marginBottom: 12, fontWeight: 900, fontSize: 13.5, textAlign: "center",
          animation: thinking ? "pulseE 1s infinite" : "none",
        }}>{hintText}</div>

        {g.winner !== -1 && (
          <Card style={{
            textAlign: "center", background: g.winner === 0 ? "#eafff3" : "#fff0f0",
            border: `3px solid ${g.winner === 0 ? K.teal : K.p0}`, animation: "pop .5s ease",
          }}>
            <div style={{ fontSize: 26, fontWeight: 900 }}>
              {g.winner === 2 ? "🤝 平手！" : g.winner === 0 ? "🏆🎉 你贏了！小紅萬歲！" : "😅 鬍鬍船長贏了！"}
            </div>
            <div style={{ fontSize: 13, color: K.sub, margin: "6px 0 10px" }}>
              海盜窩 {lairsOf(g, 0)} : {lairsOf(g, 1)}｜共擲了 {g.rolls} 次骰子
            </div>
            <Btn onClick={restart} color={K.teal} edge={K.tealEdge} fg="#fff">🔁 再玩一次</Btn>
          </Card>
        )}

        {/* 盤面 */}
        <Card style={{ padding: 8 }}>
          <svg viewBox="0 0 480 470" style={{ width: "100%", display: "block" }}>
            <rect x="4" y="4" width="472" height="462" rx="26" fill={K.seaLite} stroke={K.seaDeep} strokeWidth={4} />
            {/* 兩座大島（沙灘底） */}
            <ellipse cx={112} cy={CY} rx={96} ry={170} fill="#f7dfa4" stroke={K.sandEdge} strokeWidth={3} opacity={0.55} />
            <ellipse cx={368} cy={CY} rx={96} ry={170} fill="#f7dfa4" stroke={K.sandEdge} strokeWidth={3} opacity={0.55} />
            <ellipse cx={112} cy={CY} rx={54} ry={116} fill="#cfe8c1" stroke="#9fc98d" strokeWidth={2} opacity={0.6} />
            <ellipse cx={368} cy={CY} rx={54} ry={116} fill="#cfe8c1" stroke="#9fc98d" strokeWidth={2} opacity={0.6} />
            <text x={112} y={CY + 6} textAnchor="middle" fontSize={11} fontWeight="900" fill="#7a9b6a" fontFamily={FONT}>西島</text>
            <text x={368} y={CY + 6} textAnchor="middle" fontSize={11} fontWeight="900" fill="#7a9b6a" fontFamily={FONT}>東島</text>
            {/* 幽靈島（中央） */}
            <g>
              <ellipse cx={CX} cy={CY + 2} rx={30} ry={24} fill="#00000022" />
              <ellipse cx={CX} cy={CY} rx={30} ry={24} fill="#d9cfe6" stroke="#9c86b8" strokeWidth={3} />
              <text x={CX} y={CY - 2} textAnchor="middle" fontSize={20}>{g.ghost === -1 ? "👻" : "🏝️"}</text>
              <text x={CX} y={CY + 16} textAnchor="middle" fontSize={8.5} fontWeight="900" fill="#6d5a86" fontFamily={FONT}>{g.ghost === -1 ? "幽靈島・船長在家" : "幽靈島"}</text>
            </g>
            {/* 骰子（左上角） */}
            <g>
              <rect x={14} y={14} width={50} height={54} rx={12} fill="#fff" stroke={K.panelEdge} strokeWidth={3.5} />
              <text x={39} y={41} textAnchor="middle" fontSize={20}>{g.lastDice === 6 ? "👻" : "🎲"}</text>
              <text x={39} y={58} textAnchor="middle" fontSize={12} fontWeight="900" fill={K.ink} fontFamily={FONT}>
                {g.lastDice === 0 ? "—" : g.lastDice === 6 ? "6!" : g.lastDice}
              </text>
              <text x={39} y={80} textAnchor="middle" fontSize={9} fill="#fff" fontWeight="900" fontFamily={MONO}>擲骰 {g.rolls}</text>
            </g>
            {/* 市集標記（右上角） */}
            <g>
              <rect x={412} y={14} width={54} height={54} rx={12} fill="#fff" stroke={K.panelEdge} strokeWidth={3.5} />
              <text x={439} y={44} textAnchor="middle" fontSize={22}>🏪</text>
              <text x={439} y={60} textAnchor="middle" fontSize={8.5} fontWeight="900" fill={K.sub} fontFamily={FONT}>市集</text>
            </g>

            {/* 航線 */}
            {EDGES.map(([a, b], e) => {
              const [ax, ay] = posOf(a), [bx, by] = posOf(b);
              const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
              const ux = dx / L, uy = dy / L;
              const x1 = ax + ux * (IR + 2), y1 = ay + uy * (IR + 2);
              const x2 = bx - ux * (IR + 2), y2 = by - uy * (IR + 2);
              const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
              const owner = g.ships[e];
              const hl = mode === "ship" && legalShips.includes(e);
              const bridge = e >= 16;
              return (
                <g key={"e" + e} onClick={() => clickEdge(e)} style={{ cursor: hl ? "pointer" : "default" }}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={owner === -1 ? "#ffffff" : (owner === 0 ? K.p0 : K.p1)}
                    strokeWidth={owner === -1 ? (bridge ? 3.5 : 3) : 6}
                    strokeDasharray={owner === -1 ? (bridge ? "7 6" : "4 5") : "none"}
                    strokeLinecap="round" opacity={owner === -1 ? 0.85 : 1}
                    style={hl ? { animation: "pulseE 0.9s infinite" } : {}} />
                  {hl && <circle cx={mx} cy={my} r={11} fill="none" stroke={K.p0} strokeWidth={3} style={{ animation: "pulseE 0.9s infinite" }} />}
                  {owner !== -1 && (
                    <g>
                      <circle cx={mx} cy={my} r={10} fill={owner === 0 ? K.p0 : K.p1} stroke="#fff" strokeWidth={2.5} />
                      <text x={mx} y={my + 4.5} textAnchor="middle" fontSize={12}>⛵</text>
                    </g>
                  )}
                  <circle cx={mx} cy={my} r={15} fill="transparent" />
                </g>
              );
            })}
            {/* 海盜窩位 */}
            {Array.from({ length: N }, (_, s) => {
              const [x, y] = posOf(s);
              const owner = g.owners[s];
              const hlL = mode === "lair" && legalLairs.includes(s);
              const hlG = human && g.phase === "ghostPlace" && s !== g.ghost;
              return (
                <g key={"s" + s} onClick={() => clickIsle(s)} style={{ cursor: (hlL || hlG) ? "pointer" : "default" }}>
                  <circle cx={x} cy={y + 2} r={IR} fill="#00000022" />
                  <circle cx={x} cy={y} r={IR} fill={K.sand} stroke={owner === -1 ? K.sandEdge : (owner === 0 ? K.p0 : K.p1)} strokeWidth={owner === -1 ? 3 : 5} />
                  {(hlL || hlG) && <circle cx={x} cy={y} r={30} fill="none" stroke={hlG ? "#8899aa" : K.p0} strokeWidth={4} style={{ animation: "pulse 0.9s infinite" }} />}
                  <text x={x} y={y + 7} textAnchor="middle" fontSize={19}>{RICON[SITE_RES[s]]}</text>
                  <circle cx={x} cy={y - IR + 3} r={9.5} fill="#fff" stroke={K.sandEdge} strokeWidth={2.5} />
                  <text x={x} y={y - IR + 7} textAnchor="middle" fontSize={11.5} fontWeight="900" fill={K.ink} fontFamily={FONT}>{SITE_NUM[s]}</text>
                  {owner !== -1 && (
                    <g>
                      <circle cx={x + IR - 7} cy={y + IR - 9} r={9} fill={owner === 0 ? K.p0 : K.p1} stroke="#fff" strokeWidth={2} />
                      <text x={x + IR - 7} y={y + IR - 5} textAnchor="middle" fontSize={10}>🏠</text>
                    </g>
                  )}
                  {g.ghost === s && (
                    <text x={x - IR + 6} y={y - IR + 16} fontSize={20} style={{ animation: "bob 1.4s infinite" }}>👻</text>
                  )}
                </g>
              );
            })}
          </svg>
        </Card>

        {/* 操作區 */}
        {g.winner === -1 && (
          <Card>
            {human && g.phase === "roll" && (
              <Btn onClick={humanRoll} color={K.sun} style={{ width: "100%", padding: "14px 0", fontSize: 18 }}>
                🎲 擲骰子！
              </Btn>
            )}
            {human && g.phase === "ghostTake" && (
              <div>
                <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 8 }}>從銀行拿 1 個：</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {RES.map((_, i) => (
                    <Btn key={i} onClick={() => doA({ t: "take", res: i })} color="#fff" edge={K.panelEdge}
                      style={{ flex: 1, minWidth: 56, fontSize: 18, padding: "10px 0" }}>{RICON[i]}</Btn>
                  ))}
                </div>
              </div>
            )}
            {human && g.phase === "build" && mode !== "trade" && mode !== "gold" && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn onClick={() => setMode(mode === "ship" ? null : "ship")} disabled={!canShip}
                  color={mode === "ship" ? K.p0 : "#fff"} edge={mode === "ship" ? K.p0d : K.panelEdge}
                  fg={mode === "ship" ? "#fff" : K.ink} style={{ flex: "1 1 45%" }}>
                  ⛵ 造船 <span style={{ fontSize: 11 }}>🪵🐐</span>
                </Btn>
                <Btn onClick={() => setMode(mode === "lair" ? null : "lair")} disabled={!canLair}
                  color={mode === "lair" ? K.p0 : "#fff"} edge={mode === "lair" ? K.p0d : K.panelEdge}
                  fg={mode === "lair" ? "#fff" : K.ink} style={{ flex: "1 1 45%" }}>
                  🏠 蓋海盜窩 <span style={{ fontSize: 11 }}>🪵🐐🍯⚔️</span>
                </Btn>
                <Btn onClick={() => doA({ t: "coco" })} disabled={!canCoco} color="#fff" edge={K.panelEdge} style={{ flex: "1 1 45%" }}>
                  🦜 鸚可卡 <span style={{ fontSize: 11 }}>⚔️🍯🪙</span>
                </Btn>
                <Btn onClick={() => { setMode("trade"); setTGive(-1); setTGet(-1); }} disabled={!canTrade}
                  color="#fff" edge={K.panelEdge} style={{ flex: "1 1 45%" }}>
                  🏪 市集 2 換 1
                </Btn>
                <Btn onClick={() => setMode("gold")} disabled={!canGold} color="#fff" edge={K.panelEdge} style={{ flex: "1 1 45%" }}>
                  🪙 金幣換 1 個
                </Btn>
                <Btn onClick={() => { setMode(null); doA({ t: "end" }); }} color={K.teal} edge={K.tealEdge} fg="#fff"
                  style={{ flex: "1 1 100%", padding: "12px 0" }}>
                  ✅ 結束回合
                </Btn>
              </div>
            )}
            {human && g.phase === "build" && mode === "trade" && (
              <div>
                <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6 }}>給市集 2 個一樣的：</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {RES.map((_, i) => (
                    <Btn key={i} onClick={() => setTGive(i)} disabled={g.hands[0][i] < 2}
                      color={tGive === i ? K.p0 : "#fff"} edge={tGive === i ? K.p0d : K.panelEdge}
                      fg={tGive === i ? "#fff" : K.ink} style={{ flex: 1, fontSize: 16, padding: "8px 0" }}>{RICON[i]}</Btn>
                  ))}
                </div>
                <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6 }}>換 1 個：</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {RES.map((_, i) => (
                    <Btn key={i} onClick={() => setTGet(i)} disabled={i === tGive}
                      color={tGet === i ? K.teal : "#fff"} edge={tGet === i ? K.tealEdge : K.panelEdge}
                      fg={tGet === i ? "#fff" : K.ink} style={{ flex: 1, fontSize: 16, padding: "8px 0" }}>{RICON[i]}</Btn>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn onClick={confirmTrade} color={K.teal} edge={K.tealEdge} fg="#fff" style={{ flex: 1 }}>成交！</Btn>
                  <Btn onClick={() => setMode(null)} color="#fff" edge={K.panelEdge} style={{ flex: 1 }}>取消</Btn>
                </div>
              </div>
            )}
            {human && g.phase === "build" && mode === "gold" && (
              <div>
                <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6 }}>用 1 枚 🪙 換：</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {[0, 1, 2, 3].map(i => (
                    <Btn key={i} onClick={() => { setMode(null); doA({ t: "gold", get: i }); }}
                      color="#fff" edge={K.panelEdge} style={{ flex: 1, fontSize: 16, padding: "8px 0" }}>{RICON[i]}</Btn>
                  ))}
                </div>
                <Btn onClick={() => setMode(null)} color="#fff" edge={K.panelEdge} style={{ width: "100%" }}>取消</Btn>
              </div>
            )}
            {!human && (
              <div style={{ textAlign: "center", fontWeight: 900, color: K.p1d, padding: "6px 0" }}>
                🟣 鬍鬍船長的回合{thinking ? "：正在腦中亂玩 600 局挑最好的一步…" : "…"}
              </div>
            )}
          </Card>
        )}

        {/* 航海日誌 */}
        <Card>
          <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 8 }}>📜 航海日誌</div>
          <div style={{ maxHeight: 180, overflowY: "auto" }}>
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
            <summary style={{ fontWeight: 900, fontSize: 14, cursor: "pointer" }}>📖 怎麼玩？（給小海盜和爸媽）</summary>
            <div style={{ fontSize: 13, lineHeight: 1.9, marginTop: 8 }}>
              🗺️ 地圖：西島與東島各有 8 個海盜窩位（四種資源各出現兩次），兩島之間有兩條跨海航線；中央是幽靈島與市集。<br />
              🎲 擲骰子：骰到幾號，那些號碼的島就送資源給島上有海盜窩的人（雙方都會拿）。<b>回合不設上限</b>——真的要蓋滿 {WIN_LAIRS} 個海盜窩才分勝負。<br />
              👻 骰到 6：幽靈船長出動！把他放到一座島（那座島暫停送禮），再從銀行拿 1 個資源。<br />
              ⛵ 造船（🪵＋🐐）：船要接在自己的海盜窩或船旁邊；跨海航線可以帶你到另一座島。<br />
              🏠 蓋海盜窩（🪵＋🐐＋🍯＋⚔️）：要蓋在自己船隻旁邊的空位上。<br />
              🦜 鸚可卡（⚔️＋🍯＋🪙）：抽一張驚喜卡，馬上發動！<br />
              🏪 市集：2 個一樣的資源換 1 個任選；1 枚 🪙 金幣可換任一資源。<br />
              🏆 先蓋滿 {WIN_LAIRS} 個海盜窩就贏！<br />
              <span style={{ color: K.sub }}>🧠 鬍鬍船長的祕密：每次輪到他，他會在腦中把接下來的比賽隨機亂玩 600 遍（蒙地卡羅樹搜尋），然後挑出被驗證最多次的那一步。</span>
            </div>
          </details>
        </Card>
      </div>
    </div>
  );
}
