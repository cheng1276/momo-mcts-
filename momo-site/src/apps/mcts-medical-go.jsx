import { useState, useRef } from "react";

/* ============================================================
   MCTS 醫療對弈模擬器 —「把治療當作下棋，對手是疾病」
   教學示範用途，非醫療建議。
   ============================================================ */

// ---------- 視覺常數 ----------
const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
const SERIF = "'Songti TC','Noto Serif TC',serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const K = {
  bg: "#0b1116", panel: "#121b22", panel2: "#0e161d", line: "#223038",
  text: "#e3ecf1", dim: "#7e93a0",
  teal: "#2dd4bf", rose: "#fb7185", amber: "#f5b942", purple: "#a78bfa", sky: "#38bdf8", green: "#34d399",
};

// ---------- 遊戲模型 ----------
const MAX_TURNS = 24;

const ACTIONS = [
  { id: "intense",  name: "強化化療", icon: "💥", color: K.rose,
    desc: "大幅殺傷腫瘤，但重創體能、毒性劇增" },
  { id: "standard", name: "標準化療", icon: "💊", color: "#fb923c",
    desc: "穩定縮小腫瘤，中等副作用" },
  { id: "targeted", name: "標靶治療", icon: "🎯", color: K.sky,
    desc: "副作用低，但疾病可能逐漸產生抗藥性" },
  { id: "immuno",   name: "免疫治療", icon: "🛡️", color: K.purple,
    desc: "效果隨病人體能提升，且不受抗藥性影響" },
  { id: "support",  name: "支持療法", icon: "🌿", color: K.green,
    desc: "恢復體能、代謝毒性，但腫瘤會趁機生長" },
];
const A = Object.fromEntries(ACTIONS.map(a => [a.id, a]));

const PRESETS = {
  early: { label: "早期", tumor: 42, fitness: 82, toxicity: 5,  resistance: 0 },
  mid:   { label: "中期", tumor: 62, fitness: 70, toxicity: 10, resistance: 0.05 },
  late:  { label: "晚期", tumor: 82, fitness: 55, toxicity: 15, resistance: 0.12 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mkState = p => ({ tumor: p.tumor, fitness: p.fitness, toxicity: p.toxicity, resistance: p.resistance, turn: 0 });
const snap = s => ({ tumor: s.tumor, fitness: s.fitness, toxicity: s.toxicity });

// 醫師落子：施行一種治療
function doctorStep(s, aid, rnd, notes) {
  const t = { ...s };
  const tol = t.toxicity > 50 ? Math.max(0.35, 1 - (t.toxicity - 50) / 110) : 1; // 毒性高→身體無法承受足量
  const eff = Math.max(0.15, 1 - t.resistance) * tol;                            // 抗藥性削弱藥效
  const jit = 0.7 + rnd() * 0.6;                                                 // 個體反應差異 ±30%
  let dmg = 0, extra = "";
  switch (aid) {
    case "intense":  dmg = 24 * eff * jit; t.fitness -= 13; t.toxicity += 17; break;
    case "standard": dmg = 15 * eff * jit; t.fitness -= 7;  t.toxicity += 9;  break;
    case "targeted": dmg = 13 * eff * jit; t.fitness -= 3;  t.toxicity += 4;
                     t.resistance = Math.min(0.6, t.resistance + 0.05);
                     if (notes) extra = "，抗藥性 +5%"; break;
    case "immuno":   dmg = (3 + t.fitness * 0.13) * tol * jit; t.fitness -= 4; t.toxicity += 5; break;
    case "support":  t.fitness += 13; t.toxicity -= 13; break;
    default: break;
  }
  t.tumor = clamp(t.tumor - dmg, 0, 100);
  t.fitness = clamp(t.fitness, 0, 100);
  t.toxicity = clamp(t.toxicity, 0, 100);
  const note = !notes ? "" :
    aid === "support" ? "體能 +13、毒性 −13" : `腫瘤 −${dmg.toFixed(1)}${extra}`;
  return [t, note];
}

// 疾病落子：隨機演變（機率型對手）
function diseaseStep(s, rnd, notes) {
  const t = { ...s };
  let note = "";
  const r = rnd();
  const pAgg = 0.10 + (t.fitness < 35 ? 0.10 : 0) + (t.tumor > 70 ? 0.06 : 0);
  const pRes = t.resistance < 0.55 ? 0.14 : 0.04;
  const pDor = 0.12;
  if (r < pAgg) { t.tumor += 9 + t.tumor * 0.16; if (notes) note = "快速惡化！腫瘤大幅增長"; }
  else if (r < pAgg + pRes) {
    t.resistance = Math.min(0.6, t.resistance + 0.12);
    t.tumor += 2 + t.tumor * 0.05;
    if (notes) note = "產生抗藥性，藥效下降";
  }
  else if (r < pAgg + pRes + pDor) { t.tumor += 0.5; if (notes) note = "暫時潛伏，變化不大"; }
  else { t.tumor += 3 + t.tumor * 0.09; if (notes) note = "持續增殖"; }
  // 生理背景：自然恢復與代謝
  t.fitness += 2.5; t.toxicity -= 3.5;
  if (t.toxicity > 55 && rnd() < (t.toxicity - 55) / 130) {
    t.fitness -= 14;
    if (notes) note += "；⚠ 嚴重副作用發作（體能 −14）";
  }
  t.tumor = clamp(t.tumor, 0, 100);
  t.fitness = clamp(t.fitness, 0, 100);
  t.toxicity = clamp(t.toxicity, 0, 100);
  return [t, note];
}

// 一手 = 醫師落子 + 疾病回應
function step(s, aid, rnd, notes) {
  let [t, dn] = doctorStep(s, aid, rnd, notes);
  if (t.tumor <= 1 || t.fitness <= 0 || t.toxicity >= 100) {
    t = { ...t, turn: t.turn + 1 };
    return { state: t, doctorNote: dn, diseaseNote: notes ? "（局面已定，疾病無法回應）" : "" };
  }
  const [u, xn] = diseaseStep(t, rnd, notes);
  return { state: { ...u, turn: u.turn + 1 }, doctorNote: dn, diseaseNote: xn };
}

function terminalOf(s) {
  if (s.tumor <= 1) return "remission";
  if (s.fitness <= 0) return "death";
  if (s.toxicity >= 100) return "toxfail";
  if (s.tumor >= 100) return "progression";
  if (s.turn >= MAX_TURNS) return "timeout";
  return null;
}

// 終局評分（0～1，1 = 完全緩解）
function scoreOf(s) {
  const t = terminalOf(s);
  if (t === "remission") return 0.9 + 0.1 * (s.fitness / 100);
  if (t === "death") return 0;
  if (t === "toxfail") return 0.05;
  if (t === "progression") return 0.02;
  return clamp(0.25 + 0.35 * (1 - s.tumor / 100) + 0.2 * (s.fitness / 100) - 0.1 * (s.toxicity / 100), 0.1, 0.8);
}

// ---------- MCTS（open-loop，對付隨機型對手） ----------
function mkNode(parent, action) {
  return { parent, action, children: [], untried: ACTIONS.map(a => a.id), visits: 0, value: 0 };
}
function selectUCB(node, C) {
  let best = null, bv = -Infinity;
  const lnN = Math.log(node.visits + 1);
  for (const ch of node.children) {
    const u = ch.value / ch.visits + C * Math.sqrt(lnN / ch.visits);
    if (u > bv) { bv = u; best = ch; }
  }
  return best;
}
function runMCTS(rootState, iters, C) {
  const root = mkNode(null, null);
  const rnd = Math.random;
  for (let i = 0; i < iters; i++) {
    let node = root;
    let s = { ...rootState };
    // 1. 選擇 Selection
    while (!terminalOf(s) && node.untried.length === 0 && node.children.length > 0) {
      node = selectUCB(node, C);
      s = step(s, node.action, rnd, false).state;
    }
    // 2. 擴展 Expansion
    if (!terminalOf(s) && node.untried.length > 0) {
      const idx = Math.floor(rnd() * node.untried.length);
      const aid = node.untried.splice(idx, 1)[0];
      const child = mkNode(node, aid);
      node.children.push(child);
      s = step(s, aid, rnd, false).state;
      node = child;
    }
    // 3. 模擬 Simulation（隨機推演到終局）
    let guard = 0;
    while (!terminalOf(s) && guard++ < MAX_TURNS + 2) {
      const aid = ACTIONS[Math.floor(rnd() * ACTIONS.length)].id;
      s = step(s, aid, rnd, false).state;
    }
    const sc = scoreOf(s);
    // 4. 回傳 Backpropagation
    while (node) { node.visits++; node.value += sc; node = node.parent; }
  }
  return root;
}
function summarize(root) {
  const kids = [...root.children].sort((a, b) => b.visits - a.visits);
  return {
    total: root.visits,
    avg: root.value / Math.max(1, root.visits),
    best: kids[0]?.action,
    actions: kids.map(k => ({
      action: k.action, visits: k.visits, score: k.value / Math.max(1, k.visits),
      children: [...k.children].sort((a, b) => b.visits - a.visits).slice(0, 3)
        .map(g => ({ action: g.action, visits: g.visits, score: g.value / Math.max(1, g.visits) })),
    })),
  };
}

// ---------- 小工具 ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
function scoreColor(p) {
  const q = clamp((p - 0.2) / 0.7, 0, 1);
  const a = [251, 113, 133], b = [45, 212, 191];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * q));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
const pct = v => (v * 100).toFixed(1);

// ---------- UI 元件 ----------
function Card({ title, sub, children, accent }) {
  return (
    <section style={{
      background: K.panel, border: `1px solid ${K.line}`, borderRadius: 14,
      padding: "16px 16px 18px", marginBottom: 14,
    }}>
      {title && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: accent || K.teal, display: "inline-block" }} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: 1, color: K.text }}>{title}</h2>
          </div>
          {sub && <p style={{ margin: "4px 0 0 16px", fontSize: 12, color: K.dim }}>{sub}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

function StatBar({ label, value, color, suffix = "", hint }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: K.dim }}>{label}{hint && <span style={{ opacity: 0.7 }}>・{hint}</span>}</span>
        <span style={{ fontFamily: MONO, color, fontWeight: 700 }}>{value.toFixed(1)}{suffix}</span>
      </div>
      <div style={{ height: 8, background: K.panel2, borderRadius: 99, overflow: "hidden", border: `1px solid ${K.line}` }}>
        <div style={{ width: `${clamp(value, 0, 100)}%`, height: "100%", background: color, borderRadius: 99, transition: "width .45s ease" }} />
      </div>
    </div>
  );
}

// 病程曲線
function Spark({ history }) {
  if (history.length < 2) return null;
  const n = history.length;
  const pts = key => history.map((h, i) => `${(i / (n - 1)) * 300},${100 - clamp(h[key], 0, 100)}`).join(" ");
  const Leg = ({ c, t }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginRight: 12, fontSize: 11, color: K.dim }}>
      <span style={{ width: 14, height: 3, background: c, borderRadius: 2 }} />{t}
    </span>
  );
  return (
    <div style={{ marginTop: 6 }}>
      <svg width="100%" height="86" viewBox="0 0 300 100" preserveAspectRatio="none"
        style={{ background: K.panel2, border: `1px solid ${K.line}`, borderRadius: 10, display: "block" }}>
        {[25, 50, 75].map(y => <line key={y} x1="0" x2="300" y1={y} y2={y} stroke={K.line} strokeWidth="1" />)}
        <polyline points={pts("tumor")} fill="none" stroke={K.rose} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        <polyline points={pts("fitness")} fill="none" stroke={K.teal} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        <polyline points={pts("toxicity")} fill="none" stroke={K.amber} strokeWidth="2" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ marginTop: 6 }}>
        <Leg c={K.rose} t="腫瘤負荷" /><Leg c={K.teal} t="病人體能" /><Leg c={K.amber} t="累積毒性" />
      </div>
    </div>
  );
}

// 搜尋樹（棋譜風：棋子大小 = 模擬次數，顏色 = 期望評分）
function TreeView({ summary }) {
  if (!summary) return null;
  const kids = summary.actions;
  const maxV = Math.max(1, ...kids.map(k => k.visits));
  const H = 60 + kids.length * 74;
  return (
    <div style={{ overflowX: "auto", marginTop: 14, borderTop: `1px dashed ${K.line}`, paddingTop: 12 }}>
      <div style={{ fontSize: 12, color: K.dim, marginBottom: 6 }}>
        搜尋樹（前兩層）｜棋子大小 = 模擬次數，顏色 = 期望評分
      </div>
      <svg width={660} height={H} style={{ display: "block" }}>
        {/* 根節點 */}
        <circle cx={52} cy={H / 2} r={16} fill={K.panel2} stroke={K.text} strokeWidth={1.5} />
        <text x={52} y={H / 2 + 4} textAnchor="middle" fontSize={11} fill={K.text} fontFamily={FONT}>局面</text>
        {kids.map((k, i) => {
          const y = 44 + i * 74;
          const r = 7 + 13 * Math.sqrt(k.visits / maxV);
          const col = scoreColor(k.score);
          const gMax = Math.max(1, ...k.children.map(g => g.visits));
          return (
            <g key={k.action}>
              <path d={`M 68 ${H / 2} C 150 ${H / 2}, 170 ${y}, ${236 - r} ${y}`}
                fill="none" stroke={col} strokeOpacity={0.75}
                strokeWidth={1 + 6 * (k.visits / maxV)} />
              <circle cx={236} cy={y} r={r} fill={col} fillOpacity={0.9} stroke={K.bg} strokeWidth={2} />
              <text x={262} y={y - 2} fontSize={12.5} fill={K.text} fontFamily={FONT} fontWeight={700}>
                {A[k.action].icon} {A[k.action].name}
              </text>
              <text x={262} y={y + 13} fontSize={11} fill={K.dim} fontFamily={MONO}>
                {k.visits}次 · 評分{pct(k.score)}
              </text>
              {k.children.map((g, j) => {
                const gy = y + (j - (k.children.length - 1) / 2) * 26;
                const gr = 3.5 + 5 * Math.sqrt(g.visits / gMax);
                return (
                  <g key={g.action + j}>
                    <line x1={236 + r} y1={y} x2={472 - gr} y2={gy}
                      stroke={scoreColor(g.score)} strokeOpacity={0.5}
                      strokeWidth={0.8 + 2.5 * (g.visits / gMax)} />
                    <circle cx={472} cy={gy} r={gr} fill={scoreColor(g.score)} fillOpacity={0.85} />
                    <text x={484} y={gy + 4} fontSize={10.5} fill={K.dim} fontFamily={FONT}>
                      {A[g.action].name} <tspan fontFamily={MONO}>{g.visits}</tspan>
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Btn({ children, onClick, disabled, kind = "solid", color = K.teal, style }) {
  const base = {
    fontFamily: FONT, fontSize: 13.5, fontWeight: 700, letterSpacing: 0.5,
    padding: "10px 16px", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1, transition: "transform .1s ease, opacity .2s",
    border: `1px solid ${kind === "solid" ? color : K.line}`,
    background: kind === "solid" ? color : "transparent",
    color: kind === "solid" ? "#06231f" : K.text,
  };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...style }}
    onMouseDown={e => !disabled && (e.currentTarget.style.transform = "scale(.97)")}
    onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}
    onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}>{children}</button>;
}

// 標題旁的小棋盤：青子（醫）對黑子（疾）
function MiniGoban() {
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" style={{ flexShrink: 0 }}>
      <rect x="1" y="1" width="44" height="44" rx="6" fill="#1a2830" stroke={K.line} />
      {[12, 23, 34].map(p => (
        <g key={p}>
          <line x1={p} y1="8" x2={p} y2="38" stroke={K.dim} strokeOpacity=".5" />
          <line x1="8" y1={p} x2="38" y2={p} stroke={K.dim} strokeOpacity=".5" />
        </g>
      ))}
      <circle cx="12" cy="12" r="5.5" fill={K.teal} />
      <circle cx="34" cy="34" r="5.5" fill={K.rose} />
      <circle cx="23" cy="23" r="5.5" fill={K.teal} opacity=".9" />
    </svg>
  );
}

// ---------- 主元件 ----------
export default function App() {
  const [presetKey, setPresetKey] = useState("mid");
  const [game, setGame] = useState(() => mkState(PRESETS.mid));
  const [history, setHistory] = useState(() => [snap(mkState(PRESETS.mid))]);
  const [log, setLog] = useState([]);
  const [summary, setSummary] = useState(null);
  const [iters, setIters] = useState(1500);
  const [cParam, setCParam] = useState(1.4);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const autoRef = useRef(false);

  const outcome = terminalOf(game);
  const fresh = summary && summary.atTurn === game.turn;

  function reset(k) {
    autoRef.current = false; setAuto(false);
    setPresetKey(k);
    const s = mkState(PRESETS[k]);
    setGame(s); setHistory([snap(s)]); setLog([]); setSummary(null);
  }

  function applyTo(s, aid) {
    const res = step(s, aid, Math.random, true);
    setGame(res.state);
    setLog(l => [{ turn: s.turn + 1, aid, d: res.doctorNote, x: res.diseaseNote }, ...l]);
    setHistory(h => [...h, snap(res.state)]);
    return res.state;
  }

  function doSearch() {
    if (outcome || busy) return;
    setBusy(true);
    setTimeout(() => {
      const t0 = performance.now();
      const root = runMCTS(game, iters, cParam);
      const ms = performance.now() - t0;
      setSummary({ ...summarize(root), ms, atTurn: game.turn });
      setBusy(false);
    }, 30);
  }

  function play(aid) {
    if (outcome || busy || auto) return;
    applyTo(game, aid);
    setSummary(null);
  }

  async function autoPlay() {
    if (autoRef.current) { autoRef.current = false; setAuto(false); return; }
    autoRef.current = true; setAuto(true);
    let s = game;
    while (autoRef.current && !terminalOf(s)) {
      setBusy(true);
      await sleep(40);
      const root = runMCTS(s, iters, cParam);
      const sum = summarize(root);
      setSummary({ ...sum, atTurn: s.turn });
      setBusy(false);
      await sleep(700);
      if (!autoRef.current) break;
      s = applyTo(s, sum.best);
      setSummary(null);
      await sleep(500);
    }
    autoRef.current = false; setAuto(false);
  }

  const OUTCOMES = {
    remission:  { t: "🎉 完全緩解", d: "腫瘤已清除，這一局醫方勝。", c: K.teal },
    death:      { t: "🕯 治療失敗（體能耗竭）", d: "病人的體能撐不住了。回顧棋譜，看看哪一手該收、哪一手該攻。", c: K.rose },
    toxfail:    { t: "☠️ 治療失敗（毒性過載）", d: "累積毒性壓垮了身體。攻得太急，也是一種輸法。", c: K.rose },
    progression:{ t: "🌑 治療失敗（疾病全面惡化）", d: "腫瘤負荷已達上限。守得太久，讓對手佔滿了棋盤。", c: K.rose },
    timeout:    { t: "⏳ 24 個療程結束：帶病共存", d: "沒有分出勝負——這在真實醫療中，往往也是一種可接受的結果。", c: K.amber },
  };

  return (
    <div style={{ minHeight: "100vh", background: K.bg, color: K.text, fontFamily: FONT }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "20px 14px 48px" }}>

        {/* ===== 標題 ===== */}
        <header style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 10 }}>
          <MiniGoban />
          <div>
            <h1 style={{ margin: 0, fontFamily: SERIF, fontSize: 26, fontWeight: 900, letterSpacing: 2, lineHeight: 1.2 }}>
              對弈疾病<span style={{ color: K.teal }}>・</span>MCTS 醫療決策模擬
            </h1>
            <p style={{ margin: "3px 0 0", fontSize: 12.5, color: K.dim }}>
              醫師執<span style={{ color: K.teal, fontWeight: 700 }}>青</span>，疾病執<span style={{ color: K.rose, fontWeight: 700 }}>緋</span>。用蒙地卡羅樹搜尋，在千百次模擬推演中找出下一手治療。
            </p>
          </div>
        </header>

        <div style={{
          fontSize: 12, color: K.amber, background: "rgba(245,185,66,.08)",
          border: `1px solid rgba(245,185,66,.3)`, borderRadius: 10, padding: "8px 12px", marginBottom: 16,
        }}>
          ⚕️ 本 App 為演算法教學模擬，數值皆為虛構的簡化模型，<b>不是醫療建議</b>；真實臨床決策請諮詢醫師。
        </div>

        {/* ===== 終局橫幅 ===== */}
        {outcome && (
          <div style={{
            border: `1px solid ${OUTCOMES[outcome].c}`, background: `${OUTCOMES[outcome].c}18`,
            borderRadius: 14, padding: "16px 18px", marginBottom: 14,
          }}>
            <div style={{ fontSize: 19, fontWeight: 900, color: OUTCOMES[outcome].c }}>{OUTCOMES[outcome].t}</div>
            <div style={{ fontSize: 13, color: K.text, margin: "6px 0 12px" }}>{OUTCOMES[outcome].d}</div>
            <Btn onClick={() => reset(presetKey)}>再下一局</Btn>
          </div>
        )}

        {/* ===== 病況監測 ===== */}
        <Card title="病況監測" accent={K.rose}
          sub={`第 ${game.turn} 手 / 共 ${MAX_TURNS} 個療程`}>
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {Object.entries(PRESETS).map(([k, p]) => (
              <Btn key={k} kind={presetKey === k ? "solid" : "ghost"}
                color={presetKey === k ? K.teal : undefined}
                onClick={() => reset(k)} disabled={auto}
                style={{ padding: "6px 14px", fontSize: 12.5 }}>
                {p.label}病例
              </Btn>
            ))}
            <Btn kind="ghost" onClick={() => reset(presetKey)} disabled={auto}
              style={{ padding: "6px 14px", fontSize: 12.5, marginLeft: "auto" }}>↺ 重開</Btn>
          </div>
          <StatBar label="腫瘤負荷" hint="歸零即緩解" value={game.tumor} color={K.rose} />
          <StatBar label="病人體能" hint="耗盡即敗局" value={game.fitness} color={K.teal} />
          <StatBar label="累積毒性" hint="滿載即敗局" value={game.toxicity} color={K.amber} />
          <StatBar label="抗藥性" hint="削弱化療與標靶" value={game.resistance * 100} color={K.purple} suffix="%" />
          <Spark history={history} />
        </Card>

        {/* ===== MCTS 搜尋與落子 ===== */}
        <Card title="MCTS 搜尋・決定下一手" accent={K.teal}
          sub="每次搜尋 = 從目前局面出發，隨機推演上千局未來，統計哪一手治療的期望結局最好">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: K.dim }}>
              模擬局數{" "}
              <select value={iters} onChange={e => setIters(+e.target.value)} disabled={auto}
                style={{ background: K.panel2, color: K.text, border: `1px solid ${K.line}`, borderRadius: 8, padding: "5px 8px", fontFamily: MONO }}>
                {[300, 1500, 4000, 8000].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: K.dim, display: "flex", alignItems: "center", gap: 6 }}>
              探索係數 C
              <input type="range" min="0.5" max="2.5" step="0.1" value={cParam}
                onChange={e => setCParam(+e.target.value)} disabled={auto} style={{ width: 90, accentColor: K.teal }} />
              <span style={{ fontFamily: MONO, color: K.text }}>{cParam.toFixed(1)}</span>
            </label>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <Btn onClick={doSearch} disabled={!!outcome || busy || auto}>
              {busy && !auto ? "推演中…" : "🔍 執行 MCTS 搜尋"}
            </Btn>
            <Btn kind={auto ? "solid" : "ghost"} color={K.purple} onClick={autoPlay} disabled={!!outcome && !auto}>
              {auto ? "■ 停止自動對弈" : "🤖 AI 自動對弈到終局"}
            </Btn>
          </div>

          {fresh && (
            <div style={{
              fontSize: 12.5, color: K.dim, marginBottom: 10, fontFamily: MONO,
              background: K.panel2, border: `1px solid ${K.line}`, borderRadius: 10, padding: "8px 12px",
            }}>
              共推演 {summary.total} 局{summary.ms ? `（${summary.ms.toFixed(0)} ms）` : ""}｜局面整體期望評分 {pct(summary.avg)} / 100
            </div>
          )}

          {/* 五種行動 */}
          {ACTIONS.map(act => {
            const st = fresh ? summary.actions.find(x => x.action === act.id) : null;
            const isBest = fresh && summary.best === act.id;
            const maxV = fresh ? Math.max(...summary.actions.map(x => x.visits)) : 1;
            return (
              <div key={act.id} style={{
                border: `1px solid ${isBest ? K.teal : K.line}`,
                background: isBest ? "rgba(45,212,191,.07)" : K.panel2,
                borderRadius: 12, padding: "10px 12px", marginBottom: 8,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      {act.icon} {act.name}
                      {isBest && <span style={{
                        marginLeft: 8, fontSize: 10.5, color: "#06231f", background: K.teal,
                        borderRadius: 99, padding: "2px 8px", fontWeight: 900, verticalAlign: "2px",
                      }}>MCTS 建議</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: K.dim, marginTop: 2 }}>{act.desc}</div>
                  </div>
                  <Btn kind={isBest ? "solid" : "ghost"} onClick={() => play(act.id)}
                    disabled={!!outcome || busy || auto}
                    style={{ padding: "7px 14px", fontSize: 12.5, flexShrink: 0 }}>落子</Btn>
                </div>
                {st && (
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, height: 7, background: K.bg, borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${(st.visits / maxV) * 100}%`, height: "100%", background: scoreColor(st.score), transition: "width .4s" }} />
                    </div>
                    <span style={{ fontFamily: MONO, fontSize: 11.5, color: K.dim, whiteSpace: "nowrap" }}>
                      {st.visits} 次｜評分 <b style={{ color: scoreColor(st.score) }}>{pct(st.score)}</b>
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          <p style={{ fontSize: 11.5, color: K.dim, margin: "10px 0 0" }}>
            ※ 建議採用「模擬次數最多」的那一手（robust child）——被反覆探訪代表統計上最可信，而非單看評分最高。
          </p>

          {fresh && <TreeView summary={summary} />}
        </Card>

        {/* ===== 棋譜 ===== */}
        <Card title="對弈棋譜" accent={K.amber} sub="每一手：醫師落子 → 疾病回應">
          {log.length === 0 ? (
            <p style={{ fontSize: 13, color: K.dim, margin: 0 }}>尚未落子。先執行一次 MCTS 搜尋，或直接選一種治療。</p>
          ) : (
            <div style={{ maxHeight: 260, overflowY: "auto", paddingRight: 4 }}>
              {log.map((e, i) => (
                <div key={i} style={{
                  borderLeft: `3px solid ${A[e.aid].color}`, background: K.panel2,
                  borderRadius: "0 10px 10px 0", padding: "8px 12px", marginBottom: 8, fontSize: 12.5,
                }}>
                  <span style={{ fontFamily: MONO, color: K.dim }}>第{String(e.turn).padStart(2, "0")}手</span>
                  <span style={{ margin: "0 6px", fontWeight: 700 }}>{A[e.aid].icon} {A[e.aid].name}</span>
                  <span style={{ color: K.teal }}>{e.d}</span>
                  <div style={{ color: K.rose, marginTop: 3 }}>疾病：{e.x}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ===== 原理 ===== */}
        <Card title="這局棋怎麼對應到醫療？" accent={K.purple}>
          <div style={{ fontSize: 13, lineHeight: 1.85, color: K.text }}>
            <p style={{ margin: "0 0 10px" }}>
              <b style={{ color: K.teal }}>棋盤局面</b> ↔ 病人狀態（腫瘤、體能、毒性、抗藥性）；
              <b style={{ color: K.teal }}>我方落子</b> ↔ 選擇一種治療；
              <b style={{ color: K.rose }}>對手落子</b> ↔ 疾病的隨機演變；
              <b>終局勝負</b> ↔ 緩解、惡化或帶病共存。
              與圍棋不同的是，疾病不是「最優對抗」的棋手，而是<b>機率型對手</b>——所以這裡用的是能處理隨機性的 open-loop MCTS：樹記錄的是行動序列，每次推演都重新擲骰疾病的回應，統計值自然平均掉了運氣成分。
            </p>
            <details style={{ marginBottom: 8 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, color: K.teal }}>MCTS 四步驟（本 App 的實作）</summary>
              <p style={{ margin: "8px 0 0" }}>
                ① <b>選擇</b>：從根往下，用 UCB1 公式「平均評分 + C·√(ln N / n)」在「開發已知好棋」與「探索冷門棋」之間取捨——C 越大越愛冒險。
                ② <b>擴展</b>：走到還有未試治療的節點時，隨機展開一個新分支。
                ③ <b>模擬</b>：從新分支起隨機亂下到終局（最多 24 手），得到一個 0～1 的結局評分。
                ④ <b>回傳</b>：把評分沿路徑回填給所有祖先節點。重複上千次後，好的治療路線會被走得又深又粗。
              </p>
            </details>
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 700, color: K.amber }}>侷限與真實世界</summary>
              <p style={{ margin: "8px 0 0" }}>
                真實醫療的狀態空間、不確定性與倫理遠比這 4 個數值複雜：病況只能部分觀測（更接近 POMDP）、行動後果延遲數月、而且不能像下棋那樣「重開一局」。學界確實在研究以 MCTS／強化學習輔助放療劑量規劃、敗血症用藥、化療排程等，但都是輔助醫師、而非取代醫師。這個模擬的目的只有一個：讓你親手感受「搜尋 + 統計」如何在不確定的世界裡找出穩健的下一手。
              </p>
            </details>
          </div>
        </Card>

        <footer style={{ textAlign: "center", fontSize: 11, color: K.dim, marginTop: 4 }}>
          蒙地卡羅樹搜尋 Monte Carlo Tree Search・教學模擬・非醫療建議
        </footer>
      </div>
    </div>
  );
}
