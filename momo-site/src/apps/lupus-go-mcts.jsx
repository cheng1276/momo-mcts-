import { useState, useRef } from "react";

/* ============================================================
   對弈紅斑性狼瘡 — MCTS 治療決策模擬器
   治療選項依據：ACR 2025 SLE 指引、ACR 2024 狼瘡腎炎指引、
   EULAR 2023 SLE 建議、EULAR 2025 腎炎更新（簡化教學模型）
   ⚕️ 演算法教學用途，非醫療建議。
   ============================================================ */

// ---------- 視覺常數（狼瘡紫蝶主題）----------
const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
const SERIF = "'Songti TC','Noto Serif TC',serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const K = {
  bg: "#120b19", panel: "#191024", panel2: "#140c1e", line: "#2c2140",
  text: "#ece6f5", dim: "#9d8fb8",
  wis: "#b197f7",      // 醫方・紫藤
  rose: "#f8617f",     // 疾病・緋紅
  amber: "#f2b53f",    // 類固醇
  teal: "#2ed3b7",     // 腎功能
  sky: "#45b1f5",      // 血清學
  lime: "#a3d945",     // 感染風險
  orange: "#fb923c",   // 器官損傷
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = v => (v * 100).toFixed(1);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 遊戲模型 ----------
const MAX_TURNS = 20; // 每手 = 一季（3 個月），共 5 年
const WIN_STREAK = 4; // 連續 4 季達 DORIS 緩解 → 勝

const ACTIONS = [
  { id: "hcq", icon: "🧬", name: "HCQ 羥氯奎寧", short: "HCQ", color: K.wis,
    desc: "抗瘧疾基石用藥：降低復發、損傷與死亡率，長期持續使用",
    guide: "ACR 2025：強烈建議幾乎所有病人使用並長期持續（≤5 mg/kg/day），緩解期亦不停藥", src: "ACR 2025" },
  { id: "pulse", icon: "⚡", name: "靜脈類固醇脈衝", short: "脈衝", color: K.amber,
    desc: "IV methylprednisolone 快速壓制器官威脅性發作，之後須積極減量",
    guide: "ACR 2025／EULAR 2023：器官威脅性發作先脈衝再快速減量；類固醇僅作「橋接治療」", src: "ACR 2025" },
  { id: "taper", icon: "📉", name: "類固醇減量", short: "減量", color: K.amber,
    desc: "逐步降低 prednisone，朝 ≤5 mg/day 甚至停用邁進；活動度高時減量恐反彈",
    guide: "EULAR 2023：維持劑量應 ≤5 mg/day（prednisone 當量），可能時完全停用", src: "EULAR 2023" },
  { id: "is", icon: "💊", name: "傳統免疫抑制劑", short: "免疫抑制", color: "#e08de0",
    desc: "MTX／AZA／MMF：協助控制疾病並讓類固醇減得下來；腎炎以 MMF 為錨定藥",
    guide: "EULAR 2023：控制不佳或無法將類固醇減至 5 mg 以下時，應及早加入", src: "EULAR 2023" },
  { id: "beli", icon: "🎯", name: "Belimumab 貝利尤單抗", short: "Belimumab", color: K.sky,
    desc: "抗 BAFF 生物製劑：血清學改善明顯、顯著降低復發；腎炎三合一選項之一",
    guide: "EULAR 2023：生物製劑可及早使用，不必等傳統藥物失敗；ACR 2024 腎炎：MMF＋belimumab 為三合一方案", src: "EULAR'23／ACR'24" },
  { id: "anif", icon: "🌗", name: "Anifrolumab 阿尼魯單抗", short: "Anifrolumab", color: "#7ec8f8",
    desc: "抗第一型干擾素受體：皮膚黏膜與肌肉關節表現效果佳；帶狀疱疹風險略增",
    guide: "EULAR 2023 納入之新生物製劑；重度活動性腎炎證據不足（本模型中腎炎時效果打折）", src: "EULAR 2023" },
  { id: "cyc", icon: "☢️", name: "低劑量環磷醯胺", short: "CYC", color: K.rose,
    desc: "Euro-Lupus 方案：器官威脅性疾病的強力武器，但感染與長期毒性代價高",
    guide: "EULAR 2023：CYC 用於器官威脅性疾病；腎炎可作錨定藥並可合併 belimumab", src: "EULAR 2023" },
  { id: "cni", icon: "🫘", name: "CNI（Voclosporin 等）", short: "CNI", color: K.teal, nephOnly: true,
    desc: "鈣調磷酸酶抑制劑：快速降蛋白尿、保護腎功能；與 MMF 併用效果更佳",
    guide: "ACR 2024 腎炎三合一：類固醇＋MMF＋CNI（voclosporin／tacrolimus）為 III/IV 型方案之一", src: "ACR 2024 LN" },
  { id: "observe", icon: "🩺", name: "監測與生活型態", short: "監測", color: "#9d8fb8",
    desc: "防曬、疫苗、心血管與腎臟保護、定期回診，讓免疫抑制負荷沉澱",
    guide: "治療達標（T2T）：以 DORIS 緩解／LLDAS 為目標定期評估；腎炎每 6–12 月篩檢蛋白尿", src: "ACR'24／T2T" },
];
const A = Object.fromEntries(ACTIONS.map(a => [a.id, a]));
const availOf = neph => ACTIONS.filter(a => !a.nephOnly || neph).map(a => a.id);

// 病例範本
const PRESETS = {
  mild:   { label: "輕度・皮膚關節型", sledai: 6,  age: 28, gc: 5,  sdi: 0, sero: 30, neph: false, renal: 100, hcq: true,  is: false, inf: 0 },
  mod:    { label: "中度・血清活動型", sledai: 12, age: 36, gc: 10, sdi: 1, sero: 65, neph: false, renal: 100, hcq: false, is: false, inf: 0 },
  severe: { label: "重度・狼瘡腎炎",   sledai: 18, age: 30, gc: 15, sdi: 1, sero: 80, neph: true,  renal: 65,  hcq: false, is: false, inf: 1 },
};

function mkState(f) {
  return {
    activity: clamp(f.sledai * 3.33, 0, 100),
    damage: clamp(f.sdi * 10, 0, 100),
    renal: f.neph ? f.renal : 100,
    serology: f.sero,
    gcDose: f.gc,
    isLoad: f.is ? 20 : 5,
    onHCQ: f.hcq, onIS: f.is, onBio: "none", onCNI: false,
    nephritis: f.neph, age: f.age, infBase: f.inf,
    remStreak: 0, turn: 0,
  };
}

// ---- 醫師落子 ----
function doctorStep(s, aid, rnd, notes) {
  const t = { ...s };
  let note = "";
  const jit = () => 0.75 + rnd() * 0.5;
  switch (aid) {
    case "hcq":
      if (!t.onHCQ) { t.onHCQ = true; t.activity -= 5; t.serology -= 6; if (notes) note = "開始 HCQ，建立基石治療（復發率下降）"; }
      else { t.activity -= 2; if (notes) note = "持續 HCQ 並安排眼科視網膜監測"; }
      break;
    case "pulse": {
      const d = 24 * jit();
      t.activity -= d; t.gcDose = Math.max(t.gcDose, 22); t.damage += 1.5; t.isLoad += 8;
      if (notes) note = `脈衝壓制發作：活動度 −${d.toFixed(0)}，prednisone 升至 ${t.gcDose.toFixed(0)} mg（須儘快減量）`;
      break;
    }
    case "taper": {
      const from = t.gcDose;
      t.gcDose = Math.max(0, Math.min(from - 5, from * 0.55));
      if (notes) note = `prednisone ${from.toFixed(1)} → ${t.gcDose.toFixed(1)} mg/day`;
      if (t.activity > 28 && rnd() < 0.4) { t.activity += 7; if (notes) note += "；活動度尚高，減量後小幅反彈 +7"; }
      break;
    }
    case "is":
      if (!t.onIS) {
        t.onIS = true; const d = (9 + 4 * rnd());
        t.activity -= d; t.serology -= 6; t.isLoad += 10;
        if (t.nephritis) t.renal += 2.5;
        if (notes) note = `加入${t.nephritis ? " MMF（腎炎錨定藥）" : "免疫抑制劑（MTX／AZA／MMF）"}：活動度 −${d.toFixed(0)}`;
      } else {
        const d = 5 + 3 * rnd(); t.activity -= d;
        if (notes) note = `優化免疫抑制劑劑量：活動度 −${d.toFixed(0)}`;
      }
      break;
    case "beli": {
      const first = t.onBio !== "beli";
      const d = (first ? 7 : 12) + 4 * rnd();
      t.onBio = "beli"; t.activity -= d; t.serology -= 12; t.isLoad += first ? 5 : 2;
      if (notes) note = `${first ? "加入" : "持續"} belimumab：活動度 −${d.toFixed(0)}，血清學明顯改善`;
      break;
    }
    case "anif": {
      let d = (13 + 5 * rnd());
      let cap = "";
      if (t.nephritis && t.renal < 75) { d *= 0.55; cap = "（活動性腎炎，效果受限）"; }
      t.onBio = "anif"; t.activity -= d; t.serology -= 6; t.isLoad += 7;
      if (notes) note = `Anifrolumab：活動度 −${d.toFixed(0)}${cap}，皮膚關節反應佳`;
      break;
    }
    case "cyc": {
      const d = (20 + 8 * rnd());
      t.activity -= d; t.serology -= 8; t.damage += 1.5; t.isLoad += 20;
      if (t.nephritis) t.renal += 6;
      if (notes) note = `Euro-Lupus 低劑量 CYC：活動度 −${d.toFixed(0)}${t.nephritis ? "，腎功能改善" : ""}（感染風險上升）`;
      break;
    }
    case "cni": {
      t.onCNI = true;
      const g = 5 + 3 * rnd() + (t.onIS ? 3 : 0);
      t.renal += g; const d = 5 + 3 * rnd(); t.activity -= d; t.isLoad += 8;
      if (notes) note = `CNI 快速降蛋白尿：腎功能 +${g.toFixed(0)}${t.onIS ? "（與 MMF 併用加成）" : ""}`;
      break;
    }
    case "observe":
      t.activity -= 1; t.isLoad = Math.max(0, t.isLoad - 12);
      if (notes) note = "防曬、疫苗接種、心腎保護與定期追蹤；免疫抑制負荷沉澱";
      break;
    default: break;
  }
  t.activity = clamp(t.activity, 0, 100);
  t.serology = clamp(t.serology, 0, 100);
  t.damage = clamp(t.damage, 0, 100);
  t.renal = clamp(t.renal, 0, 100);
  t.gcDose = clamp(t.gcDose, 0, 60);
  t.isLoad = clamp(t.isLoad, 0, 100);
  return [t, note];
}

// ---- 疾病落子（機率型對手）＋生理背景 ----
function diseaseStep(s, rnd, notes) {
  const t = { ...s };
  let note = "";
  // 復發事件
  const pSev = clamp(0.05 + t.serology * 0.0016 + (t.onHCQ ? 0 : 0.07) + (t.activity > 45 ? 0.04 : 0)
    - (t.onBio !== "none" ? 0.035 : 0) - (t.onIS ? 0.02 : 0), 0.01, 0.35);
  const pMild = clamp(0.16 + t.serology * 0.0012 - (t.onHCQ ? 0.06 : 0) - (t.onBio !== "none" ? 0.03 : 0), 0.03, 0.35);
  const pSero = 0.12;
  const r = rnd();
  if (r < pSev) {
    const d = 16 + 8 * rnd(); t.activity += d;
    if (t.nephritis) { t.renal -= 7; if (notes) note = `重度復發——腎炎惡化！活動度 +${d.toFixed(0)}，腎功能 −7`; }
    else if (notes) note = `重度復發！活動度 +${d.toFixed(0)}`;
  } else if (r < pSev + pMild) {
    const d = 7 + 4 * rnd(); t.activity += d;
    if (notes) note = `輕度發作（皮疹／關節痛）：活動度 +${d.toFixed(0)}`;
  } else if (r < pSev + pMild + pSero) {
    t.serology += 12;
    if (notes) note = "血清學惡化：抗 dsDNA 上升、補體下降（復發前兆）";
  } else {
    t.activity -= 2;
    if (notes) note = "病情平穩";
  }
  // 感染事件（免疫抑制的代價）
  const pInf = clamp(t.isLoad * 0.0035 + t.gcDose * 0.005 + (t.age > 60 ? 0.04 : 0) + t.infBase * 0.035, 0, 0.5);
  if (rnd() < pInf) {
    if (rnd() < 0.25) { t.damage += 15; t.activity += 5; if (notes) note += "；⚠ 嚴重感染住院（不可逆損傷 +15）"; }
    else { t.damage += 4; t.activity += 3; if (notes) note += "；感染事件（損傷 +4）"; }
  }
  // 生理背景：藥物維持效果、損傷累積、腎臟變化
  t.activity -= (t.onHCQ ? 2 : 0) + (t.onIS ? 2.5 : 0) + (t.onBio !== "none" ? 3.5 : 0) + (t.onCNI ? 1 : 0) + t.gcDose * 0.12;
  t.serology += (t.activity - t.serology) * 0.08;
  t.damage += t.activity * 0.035 + Math.max(0, t.gcDose - 7.5) * 0.07 + (t.renal < 40 ? 1.2 : 0);
  if (t.nephritis) {
    if (t.activity > 35) t.renal -= (t.activity - 35) * 0.09;
    else if (t.activity < 15 && t.renal < 95) t.renal += 0.8;
  }
  if (t.gcDose > 12) t.gcDose *= 0.82; // 脈衝後的常規快速減量（<12 mg 需靠「類固醇減量」這手棋）
  t.isLoad *= 0.82;
  // 收斂與緩解計數（DORIS 簡化：活動度≤10 且 prednisone≤5）
  t.activity = clamp(t.activity, 0, 100);
  t.serology = clamp(t.serology, 0, 100);
  t.damage = clamp(t.damage, 0, 100);
  t.renal = clamp(t.renal, 0, 100);
  t.isLoad = clamp(t.isLoad, 0, 100);
  t.remStreak = (t.activity <= 10 && t.gcDose <= 5) ? t.remStreak + 1 : 0;
  return [t, note];
}

function step(s, aid, rnd, notes) {
  let [t, dn] = doctorStep(s, aid, rnd, notes);
  if (t.damage >= 100 || t.renal <= 5) {
    t = { ...t, turn: t.turn + 1 };
    return { state: t, doctorNote: dn, diseaseNote: notes ? "（局面已定）" : "" };
  }
  const [u, xn] = diseaseStep(t, rnd, notes);
  return { state: { ...u, turn: u.turn + 1 }, doctorNote: dn, diseaseNote: xn };
}

function terminalOf(s) {
  if (s.remStreak >= WIN_STREAK) return "remission";
  if (s.damage >= 100) return "damage";
  if (s.renal <= 5) return "esrd";
  if (s.turn >= MAX_TURNS) return "timeout";
  return null;
}

function scoreOf(s) {
  const t = terminalOf(s);
  if (t === "remission") return 0.88 + 0.12 * (1 - s.damage / 100);
  if (t === "damage") return 0;
  if (t === "esrd") return 0.05;
  return clamp(
    0.18 + 0.26 * (1 - s.activity / 100) + 0.22 * (1 - s.damage / 100)
    + 0.08 * (s.gcDose <= 7.5 ? 1 : 0) + (s.nephritis ? 0.12 * (s.renal / 100) : 0.06),
    0.08, 0.78
  );
}

// ---------- MCTS（open-loop，處理隨機型對手） ----------
function mkNode(parent, action, avail) {
  return { parent, action, children: [], untried: [...avail], visits: 0, value: 0 };
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
function runMCTS(rootState, iters, C, avail) {
  const root = mkNode(null, null, avail);
  const rnd = Math.random;
  for (let i = 0; i < iters; i++) {
    let node = root;
    let s = { ...rootState };
    while (!terminalOf(s) && node.untried.length === 0 && node.children.length > 0) {
      node = selectUCB(node, C);
      s = step(s, node.action, rnd, false).state;
    }
    if (!terminalOf(s) && node.untried.length > 0) {
      const idx = Math.floor(rnd() * node.untried.length);
      const aid = node.untried.splice(idx, 1)[0];
      const child = mkNode(node, aid, avail);
      node.children.push(child);
      s = step(s, aid, rnd, false).state;
      node = child;
    }
    let guard = 0;
    while (!terminalOf(s) && guard++ < MAX_TURNS + 2) {
      s = step(s, avail[Math.floor(rnd() * avail.length)], rnd, false).state;
    }
    const sc = scoreOf(s);
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
function scoreColor(p) {
  const q = clamp((p - 0.2) / 0.7, 0, 1);
  const a = [248, 97, 127], b = [177, 151, 247];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * q));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ---------- UI 小元件 ----------
function Butterfly({ size = 44, lit = true }) {
  const f = lit ? K.wis : "#3a2d52";
  const f2 = lit ? "#8f6ef0" : "#2c2140";
  return (
    <svg width={size} height={size * 0.83} viewBox="0 0 48 40" style={{ flexShrink: 0 }}>
      <path d="M24 20 C 16 5, 3 5, 4 15 C 5 23, 16 24, 24 21 Z" fill={f} />
      <path d="M24 20 C 32 5, 45 5, 44 15 C 43 23, 32 24, 24 21 Z" fill={f} />
      <path d="M24 22 C 17 31, 7 35, 9 27 C 10 21.5, 18 21.5, 24 22 Z" fill={f2} />
      <path d="M24 22 C 31 31, 41 35, 39 27 C 38 21.5, 30 21.5, 24 22 Z" fill={f2} />
      <ellipse cx="24" cy="21" rx="1.9" ry="7.5" fill={lit ? "#e9defc" : "#4a3c66"} />
      <path d="M23 14 C 21 10, 20 9, 19 8" stroke={lit ? "#e9defc" : "#4a3c66"} strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <path d="M25 14 C 27 10, 28 9, 29 8" stroke={lit ? "#e9defc" : "#4a3c66"} strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Card({ title, sub, children, accent }) {
  return (
    <section style={{ background: K.panel, border: `1px solid ${K.line}`, borderRadius: 14, padding: "16px 16px 18px", marginBottom: 14 }}>
      {title && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: accent || K.wis, display: "inline-block" }} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: 1, color: K.text }}>{title}</h2>
          </div>
          {sub && <p style={{ margin: "4px 0 0 16px", fontSize: 12, color: K.dim }}>{sub}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

function StatBar({ label, value, color, max = 100, suffix = "", hint, marker }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: K.dim }}>{label}{hint && <span style={{ opacity: 0.75 }}>・{hint}</span>}</span>
        <span style={{ fontFamily: MONO, color, fontWeight: 700 }}>{value.toFixed(1)}{suffix}</span>
      </div>
      <div style={{ position: "relative", height: 8, background: K.panel2, borderRadius: 99, overflow: "hidden", border: `1px solid ${K.line}` }}>
        <div style={{ width: `${clamp(value / max * 100, 0, 100)}%`, height: "100%", background: color, borderRadius: 99, transition: "width .45s ease" }} />
        {marker != null && <div style={{ position: "absolute", left: `${(marker / max) * 100}%`, top: -1, bottom: -1, width: 2, background: K.text, opacity: 0.7 }} />}
      </div>
    </div>
  );
}

function Btn({ children, onClick, disabled, kind = "solid", color = K.wis, style }) {
  const base = {
    fontFamily: FONT, fontSize: 13.5, fontWeight: 700, letterSpacing: 0.5,
    padding: "10px 16px", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1, transition: "transform .1s ease",
    border: `1px solid ${kind === "solid" ? color : K.line}`,
    background: kind === "solid" ? color : "transparent",
    color: kind === "solid" ? "#1c1030" : K.text,
  };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...style }}
    onMouseDown={e => !disabled && (e.currentTarget.style.transform = "scale(.97)")}
    onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}
    onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}>{children}</button>;
}

function Slider({ label, value, onChange, min, max, step = 1, unit = "", hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
        <span style={{ color: K.dim }}>{label}{hint && <span style={{ opacity: 0.7 }}>・{hint}</span>}</span>
        <span style={{ fontFamily: MONO, color: K.text, fontWeight: 700 }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        style={{ width: "100%", accentColor: K.wis }} />
    </div>
  );
}

function Toggle({ label, value, onChange, hint }) {
  return (
    <button onClick={() => onChange(!value)} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
      background: value ? "rgba(177,151,247,.12)" : K.panel2, color: K.text,
      border: `1px solid ${value ? K.wis : K.line}`, borderRadius: 10,
      padding: "10px 12px", marginBottom: 10, cursor: "pointer", fontFamily: FONT, fontSize: 13,
    }}>
      <span>{label}{hint && <span style={{ color: K.dim, fontSize: 11.5 }}>・{hint}</span>}</span>
      <span style={{ fontWeight: 900, color: value ? K.wis : K.dim }}>{value ? "是 ✓" : "否"}</span>
    </button>
  );
}

function Spark({ history, neph }) {
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
      <svg width="100%" height="88" viewBox="0 0 300 100" preserveAspectRatio="none"
        style={{ background: K.panel2, border: `1px solid ${K.line}`, borderRadius: 10, display: "block" }}>
        {[25, 50, 75].map(y => <line key={y} x1="0" x2="300" y1={y} y2={y} stroke={K.line} strokeWidth="1" />)}
        <polyline points={pts("activity")} fill="none" stroke={K.rose} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        <polyline points={pts("damage")} fill="none" stroke={K.orange} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        {neph && <polyline points={pts("renal")} fill="none" stroke={K.teal} strokeWidth="2" vectorEffect="non-scaling-stroke" />}
        <polyline points={pts("gc")} fill="none" stroke={K.amber} strokeWidth="2" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ marginTop: 6 }}>
        <Leg c={K.rose} t="疾病活動度" /><Leg c={K.orange} t="器官損傷" />
        {neph && <Leg c={K.teal} t="腎功能" />}<Leg c={K.amber} t="類固醇×2" />
      </div>
    </div>
  );
}

function TreeView({ summary }) {
  if (!summary) return null;
  const kids = summary.actions;
  const maxV = Math.max(1, ...kids.map(k => k.visits));
  const H = 50 + kids.length * 64;
  return (
    <div style={{ overflowX: "auto", marginTop: 14, borderTop: `1px dashed ${K.line}`, paddingTop: 12 }}>
      <div style={{ fontSize: 12, color: K.dim, marginBottom: 6 }}>
        搜尋樹（前兩層）｜棋子大小 = 模擬次數，顏色 = 期望評分
      </div>
      <svg width={680} height={H} style={{ display: "block" }}>
        <circle cx={48} cy={H / 2} r={15} fill={K.panel2} stroke={K.text} strokeWidth={1.5} />
        <text x={48} y={H / 2 + 4} textAnchor="middle" fontSize={11} fill={K.text} fontFamily={FONT}>局面</text>
        {kids.map((k, i) => {
          const y = 38 + i * 64;
          const r = 6 + 12 * Math.sqrt(k.visits / maxV);
          const col = scoreColor(k.score);
          const gMax = Math.max(1, ...k.children.map(g => g.visits), 1);
          return (
            <g key={k.action}>
              <path d={`M 63 ${H / 2} C 140 ${H / 2}, 160 ${y}, ${226 - r} ${y}`}
                fill="none" stroke={col} strokeOpacity={0.75} strokeWidth={1 + 5.5 * (k.visits / maxV)} />
              <circle cx={226} cy={y} r={r} fill={col} fillOpacity={0.9} stroke={K.bg} strokeWidth={2} />
              <text x={250} y={y - 2} fontSize={12.5} fill={K.text} fontFamily={FONT} fontWeight={700}>
                {A[k.action].icon} {A[k.action].short}
              </text>
              <text x={250} y={y + 12} fontSize={10.5} fill={K.dim} fontFamily={MONO}>
                {k.visits}次 · 評分{pct(k.score)}
              </text>
              {k.children.map((g, j) => {
                const gy = y + (j - (k.children.length - 1) / 2) * 22;
                const gr = 3 + 4.5 * Math.sqrt(g.visits / gMax);
                return (
                  <g key={g.action + j}>
                    <line x1={226 + r} y1={y} x2={478 - gr} y2={gy}
                      stroke={scoreColor(g.score)} strokeOpacity={0.5} strokeWidth={0.8 + 2.2 * (g.visits / gMax)} />
                    <circle cx={478} cy={gy} r={gr} fill={scoreColor(g.score)} fillOpacity={0.85} />
                    <text x={489} y={gy + 3.5} fontSize={10} fill={K.dim} fontFamily={FONT}>
                      {A[g.action].short} <tspan fontFamily={MONO}>{g.visits}</tspan>
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

// ---------- 主元件 ----------
export default function App() {
  const [phase, setPhase] = useState("setup");
  const [form, setForm] = useState({ ...PRESETS.severe });
  const [game, setGame] = useState(null);
  const [history, setHistory] = useState([]);
  const [log, setLog] = useState([]);
  const [summary, setSummary] = useState(null);
  const [iters, setIters] = useState(1500);
  const [cParam, setCParam] = useState(1.4);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const autoRef = useRef(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const avail = game ? availOf(game.nephritis) : [];
  const outcome = game ? terminalOf(game) : null;
  const fresh = summary && game && summary.atTurn === game.turn;

  const snap = s => ({ activity: s.activity, damage: s.damage, renal: s.renal, gc: s.gcDose * 2 });

  function startGame() {
    const s = mkState(form);
    setGame(s); setHistory([snap(s)]); setLog([]); setSummary(null); setPhase("play");
  }
  function backToSetup() {
    autoRef.current = false; setAuto(false);
    setPhase("setup"); setGame(null); setSummary(null);
  }
  function applyTo(s, aid) {
    const res = step(s, aid, Math.random, true);
    setGame(res.state);
    setLog(l => [{ turn: s.turn + 1, aid, d: res.doctorNote, x: res.diseaseNote }, ...l]);
    setHistory(h => [...h, snap(res.state)]);
    return res.state;
  }
  function doSearch() {
    if (!game || outcome || busy) return;
    setBusy(true);
    setTimeout(() => {
      const t0 = performance.now();
      const root = runMCTS(game, iters, cParam, avail);
      const ms = performance.now() - t0;
      setSummary({ ...summarize(root), ms, atTurn: game.turn });
      setBusy(false);
    }, 30);
  }
  function play(aid) {
    if (!game || outcome || busy || auto) return;
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
      const root = runMCTS(s, iters, cParam, availOf(s.nephritis));
      const sum = summarize(root);
      setSummary({ ...sum, atTurn: s.turn });
      setBusy(false);
      await sleep(720);
      if (!autoRef.current) break;
      s = applyTo(s, sum.best);
      setSummary(null);
      await sleep(500);
    }
    autoRef.current = false; setAuto(false);
  }

  const OUTCOMES = {
    remission: { t: "🦋 持續緩解達標（DORIS）", d: "連續四季維持低活動度且 prednisone ≤5 mg——治療達標，這局醫方勝。", c: K.wis },
    damage:    { t: "🕯 治療失敗：重度不可逆器官損傷", d: "疾病活動、類固醇與感染的長期代價累積到了臨界。回顧棋譜，哪幾手可以更早達標？", c: K.rose },
    esrd:      { t: "🫘 治療失敗：進入末期腎病", d: "狼瘡腎炎未能及時控制。腎炎是 SLE 預後最重要的戰場之一。", c: K.rose },
    timeout:   { t: "⏳ 五年期滿：未達持續緩解", d: "疾病仍在活動或類固醇減不下來——現實中這意味著調整策略、繼續對弈。", c: K.amber },
  };

  const Disclaimer = () => (
    <div style={{
      fontSize: 12, color: K.amber, background: "rgba(242,181,63,.08)",
      border: "1px solid rgba(242,181,63,.3)", borderRadius: 10, padding: "8px 12px", marginBottom: 16,
    }}>
      ⚕️ 本 App 為演算法教學模擬：病程數值為虛構的簡化模型，治療選項雖對應真實指引精神，但<b>不是醫療建議</b>，不可用於實際臨床決策。SLE 治療請務必由風濕免疫科醫師評估。
    </div>
  );

  const Header = () => (
    <header style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 10 }}>
      <Butterfly size={52} />
      <div>
        <h1 style={{ margin: 0, fontFamily: SERIF, fontSize: 25, fontWeight: 900, letterSpacing: 2, lineHeight: 1.25 }}>
          對弈紅斑性狼瘡<span style={{ color: K.wis }}>・</span>MCTS
        </h1>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: K.dim }}>
          醫師執<span style={{ color: K.wis, fontWeight: 700 }}>紫</span>，狼瘡執<span style={{ color: K.rose, fontWeight: 700 }}>緋</span>。每手一季、五年為局；連續四季達 DORIS 緩解即勝。
        </p>
      </div>
    </header>
  );

  // ============ 設定畫面 ============
  if (phase === "setup") {
    return (
      <div style={{ minHeight: "100vh", background: K.bg, color: K.text, fontFamily: FONT }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "20px 14px 48px" }}>
          <Header />
          <Disclaimer />
          <Card title="選擇病例範本" accent={K.rose} sub="先套用範本，再逐項微調成你想模擬的病人">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Object.entries(PRESETS).map(([k, p]) => {
                const active = JSON.stringify({ ...form }) === JSON.stringify({ ...p });
                return (
                  <Btn key={k} kind={active ? "solid" : "ghost"} onClick={() => setForm({ ...p })}
                    style={{ padding: "8px 14px", fontSize: 12.5 }}>{p.label}</Btn>
                );
              })}
            </div>
          </Card>

          <Card title="病人參數" accent={K.wis} sub="所有數值皆可自行輸入">
            <Slider label="疾病活動度 SLEDAI-2K" value={form.sledai} onChange={v => set("sledai", v)}
              min={0} max={30} unit=" 分" hint="0–30，越高越活動" />
            <Slider label="年齡" value={form.age} onChange={v => set("age", v)} min={18} max={80} unit=" 歲" />
            <Slider label="目前 prednisone 劑量" value={form.gc} onChange={v => set("gc", v)}
              min={0} max={40} unit=" mg/day" hint="治療目標 ≤5" />
            <Slider label="既有不可逆器官損傷 SDI" value={form.sdi} onChange={v => set("sdi", v)}
              min={0} max={8} unit=" 分" hint="只會累積、不會回復" />
            <Slider label="血清學活性" value={form.sero} onChange={v => set("sero", v)}
              min={0} max={100} hint="抗 dsDNA 升高／補體低下的綜合指標" />
            <Toggle label="狼瘡腎炎（Lupus Nephritis）" value={form.neph} onChange={v => set("neph", v)}
              hint="開啟後將加入 CNI 治療選項與腎功能戰場" />
            {form.neph && (
              <Slider label="腎功能（相對 eGFR）" value={form.renal} onChange={v => set("renal", v)}
                min={20} max={100} unit=" %" hint="降至 5% 即末期腎病" />
            )}
            <Toggle label="已規律服用 HCQ 羥氯奎寧" value={form.hcq} onChange={v => set("hcq", v)} />
            <Toggle label="已使用傳統免疫抑制劑" value={form.is} onChange={v => set("is", v)} hint="MTX／AZA／MMF" />
            <div style={{ fontSize: 12.5, color: K.dim, margin: "4px 0 6px" }}>基礎感染風險（共病、過往感染史）</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              {["低", "中", "高"].map((t, i) => (
                <Btn key={t} kind={form.inf === i ? "solid" : "ghost"}
                  color={form.inf === i ? K.lime : undefined}
                  onClick={() => set("inf", i)} style={{ flex: 1, padding: "8px 0", fontSize: 12.5 }}>{t}</Btn>
              ))}
            </div>
          </Card>

          <Btn onClick={startGame} style={{ width: "100%", padding: "14px 0", fontSize: 15 }}>
            🦋 開始對弈（第 1 季）
          </Btn>

          <p style={{ fontSize: 11.5, color: K.dim, marginTop: 14, lineHeight: 1.7 }}>
            治療選項與標註依據：ACR 2025 SLE 治療指引、ACR 2024 狼瘡腎炎指引（三合一療法）、EULAR 2023 SLE 建議與 EULAR 2025 腎炎更新之核心精神，經大幅簡化為棋局參數。
          </p>
        </div>
      </div>
    );
  }

  // ============ 對弈畫面 ============
  const chips = [
    game.onHCQ && { t: "HCQ", c: K.wis },
    game.onIS && { t: game.nephritis ? "MMF" : "免疫抑制劑", c: "#e08de0" },
    game.onBio === "beli" && { t: "Belimumab", c: K.sky },
    game.onBio === "anif" && { t: "Anifrolumab", c: "#7ec8f8" },
    game.onCNI && { t: "CNI", c: K.teal },
  ].filter(Boolean);

  return (
    <div style={{ minHeight: "100vh", background: K.bg, color: K.text, fontFamily: FONT }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "20px 14px 48px" }}>
        <Header />
        <Disclaimer />

        {outcome && (
          <div style={{
            border: `1px solid ${OUTCOMES[outcome].c}`, background: `${OUTCOMES[outcome].c}18`,
            borderRadius: 14, padding: "16px 18px", marginBottom: 14,
          }}>
            <div style={{ fontSize: 19, fontWeight: 900, color: OUTCOMES[outcome].c }}>{OUTCOMES[outcome].t}</div>
            <div style={{ fontSize: 13, margin: "6px 0 12px" }}>{OUTCOMES[outcome].d}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <Btn onClick={() => { const s = mkState(form); setGame(s); setHistory([snap(s)]); setLog([]); setSummary(null); }}>同病例再下一局</Btn>
              <Btn kind="ghost" onClick={backToSetup}>調整病人參數</Btn>
            </div>
          </div>
        )}

        {/* 病況監測 */}
        <Card title="病況監測" accent={K.rose}
          sub={`第 ${game.turn} 季 / 共 ${MAX_TURNS} 季（5 年）`}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
            {chips.length === 0
              ? <span style={{ fontSize: 12, color: K.dim }}>目前用藥：僅類固醇／無</span>
              : chips.map(c => (
                <span key={c.t} style={{
                  fontSize: 11.5, fontWeight: 700, color: c.c, border: `1px solid ${c.c}`,
                  borderRadius: 99, padding: "3px 10px",
                }}>{c.t} ✓</span>
              ))}
            <Btn kind="ghost" onClick={backToSetup} disabled={auto}
              style={{ marginLeft: "auto", padding: "5px 12px", fontSize: 12 }}>⚙ 參數</Btn>
          </div>

          <StatBar label="疾病活動度" hint={`≈ SLEDAI ${(game.activity / 3.33).toFixed(0)} 分`} value={game.activity} color={K.rose} />
          <StatBar label="不可逆器官損傷" hint="只增不減，滿載即敗局" value={game.damage} color={K.orange} />
          {game.nephritis && <StatBar label="腎功能" hint="降至 5% 即末期腎病" value={game.renal} color={K.teal} suffix="%" />}
          <StatBar label="血清學活性" hint="抗 dsDNA／補體，復發的火種" value={game.serology} color={K.sky} />
          <StatBar label="Prednisone 劑量" hint="白線 = 5 mg 達標線" value={game.gcDose} max={40} suffix=" mg" color={K.amber} marker={5} />
          <StatBar label="感染風險（免疫抑制負荷）" value={game.isLoad} color={K.lime} />

          {/* 緩解蝶翼 */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10, marginTop: 12,
            background: K.panel2, border: `1px solid ${K.line}`, borderRadius: 12, padding: "10px 12px",
          }}>
            <div style={{ display: "flex", gap: 6 }}>
              {[0, 1, 2, 3].map(i => <Butterfly key={i} size={26} lit={i < game.remStreak} />)}
            </div>
            <div style={{ fontSize: 12, color: K.dim }}>
              持續緩解進度 <b style={{ color: K.wis, fontFamily: MONO }}>{game.remStreak}/{WIN_STREAK}</b> 季
              <div style={{ fontSize: 11 }}>DORIS 簡化標準：活動度 ≤10 且 prednisone ≤5 mg，連續四季即勝</div>
            </div>
          </div>
          <Spark history={history} neph={game.nephritis} />
        </Card>

        {/* MCTS 搜尋與落子 */}
        <Card title="MCTS 搜尋・決定本季治療" accent={K.wis}
          sub="從目前病況隨機推演上千個五年病程，統計哪一手治療的期望結局最好">
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
                onChange={e => setCParam(+e.target.value)} disabled={auto} style={{ width: 90, accentColor: K.wis }} />
              <span style={{ fontFamily: MONO, color: K.text }}>{cParam.toFixed(1)}</span>
            </label>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <Btn onClick={doSearch} disabled={!!outcome || busy || auto}>
              {busy && !auto ? "推演中…" : "🔍 執行 MCTS 搜尋"}
            </Btn>
            <Btn kind={auto ? "solid" : "ghost"} color={K.rose} onClick={autoPlay} disabled={!!outcome && !auto}>
              {auto ? "■ 停止自動對弈" : "🤖 AI 自動對弈到終局"}
            </Btn>
          </div>

          {fresh && (
            <div style={{
              fontSize: 12.5, color: K.dim, marginBottom: 10, fontFamily: MONO,
              background: K.panel2, border: `1px solid ${K.line}`, borderRadius: 10, padding: "8px 12px",
            }}>
              共推演 {summary.total} 個五年病程{summary.ms ? `（${summary.ms.toFixed(0)} ms）` : ""}｜局面整體期望評分 {pct(summary.avg)} / 100
            </div>
          )}

          {ACTIONS.filter(a => avail.includes(a.id)).map(act => {
            const st = fresh ? summary.actions.find(x => x.action === act.id) : null;
            const isBest = fresh && summary.best === act.id;
            const maxV = fresh ? Math.max(...summary.actions.map(x => x.visits)) : 1;
            return (
              <div key={act.id} style={{
                border: `1px solid ${isBest ? K.wis : K.line}`,
                background: isBest ? "rgba(177,151,247,.08)" : K.panel2,
                borderRadius: 12, padding: "10px 12px", marginBottom: 8,
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      {act.icon} {act.name}
                      {isBest && <span style={{
                        marginLeft: 8, fontSize: 10.5, color: "#1c1030", background: K.wis,
                        borderRadius: 99, padding: "2px 8px", fontWeight: 900, verticalAlign: "2px",
                      }}>MCTS 建議</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: K.dim, marginTop: 2 }}>{act.desc}</div>
                    <div style={{ fontSize: 11, color: act.color, marginTop: 4, lineHeight: 1.5 }}>
                      📋 {act.guide}
                    </div>
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
            ※ 建議採「模擬次數最多」的一手（robust child）——被反覆探訪代表統計上最可信，而非單看評分最高。
          </p>

          {fresh && <TreeView summary={summary} />}
        </Card>

        {/* 棋譜 */}
        <Card title="對弈棋譜" accent={K.amber} sub="每一季：醫師落子 → 狼瘡回應">
          {log.length === 0 ? (
            <p style={{ fontSize: 13, color: K.dim, margin: 0 }}>尚未落子。先執行一次 MCTS 搜尋，或直接選一種治療。</p>
          ) : (
            <div style={{ maxHeight: 280, overflowY: "auto", paddingRight: 4 }}>
              {log.map((e, i) => (
                <div key={i} style={{
                  borderLeft: `3px solid ${A[e.aid].color}`, background: K.panel2,
                  borderRadius: "0 10px 10px 0", padding: "8px 12px", marginBottom: 8, fontSize: 12.5,
                }}>
                  <span style={{ fontFamily: MONO, color: K.dim }}>第{String(e.turn).padStart(2, "0")}季</span>
                  <span style={{ margin: "0 6px", fontWeight: 700 }}>{A[e.aid].icon} {A[e.aid].name}</span>
                  <div style={{ color: K.wis, marginTop: 3 }}>醫方：{e.d}</div>
                  <div style={{ color: K.rose, marginTop: 2 }}>狼瘡：{e.x}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 原理與指引依據 */}
        <Card title="模型如何對應真實指引？" accent={K.sky}>
          <div style={{ fontSize: 13, lineHeight: 1.85 }}>
            <p style={{ margin: "0 0 10px" }}>
              <b style={{ color: K.wis }}>棋盤局面</b> ↔ 活動度、不可逆損傷、腎功能、血清學、類固醇劑量、感染風險六個戰場；
              <b style={{ color: K.wis }}>我方落子</b> ↔ 指引中的治療選項；
              <b style={{ color: K.rose }}>對手落子</b> ↔ 狼瘡的隨機復發、血清學惡化與感染事件；
              <b>勝利條件</b> ↔ 治療達標（treat-to-target）：連續四季 DORIS 緩解。
              狼瘡是機率型對手，因此採用 open-loop MCTS——每次推演重新擲骰疾病回應，統計值自然平均掉運氣。
            </p>
            <details style={{ marginBottom: 8 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, color: K.wis }}>模型內建的指引精神</summary>
              <p style={{ margin: "8px 0 0" }}>
                ① HCQ 是全局基石：在場上會持續降低復發機率與損傷累積，這正是它被建議終身使用的原因。
                ② 類固醇只是「橋接」：劑量 &gt;7.5 mg 會持續累積不可逆損傷，且勝利條件要求 ≤5 mg——你必須靠免疫抑制劑或生物製劑把類固醇「換下場」。
                ③ 生物製劑可及早使用：belimumab 壓血清學防復發、anifrolumab 快攻皮膚關節但腎炎受限。
                ④ 腎炎走三合一：類固醇＋MMF 再加 belimumab 或 CNI，對應 ACR 2024 腎炎指引。
                ⑤ 免疫抑制是雙面刃：negative space 是感染——壓得越重，感染骰子越危險。
              </p>
            </details>
            <details style={{ marginBottom: 8 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, color: K.sky }}>MCTS 四步驟</summary>
              <p style={{ margin: "8px 0 0" }}>
                ① <b>選擇</b>：UCB1 =「平均評分 + C·√(ln N / n)」，在開發好棋與探索冷門之間取捨。
                ② <b>擴展</b>：在還有未試治療的節點展開新分支。
                ③ <b>模擬</b>：隨機推演到五年終局，依緩解／損傷／腎功能給 0–1 評分。
                ④ <b>回傳</b>：評分沿路徑回填。重複上千次後，穩健的治療路線會被走得又深又粗。
              </p>
            </details>
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 700, color: K.amber }}>依據之指引（皆經大幅簡化）</summary>
              <p style={{ margin: "8px 0 0" }}>
                ・ACR 2025《SLE 治療指引》：HCQ 幾乎所有病人終身使用；類固醇最低劑量、最短時間；及早加入傳統或生物免疫治療以達緩解／低活動度。
                ・ACR 2024《狼瘡腎炎指引》：III/IV 型建議三合一（類固醇＋MMF＋belimumab，或 MMF＋CNI，或低劑量 CYC＋belimumab）。
                ・EULAR 2023《SLE 管理建議》：HCQ ≤5 mg/kg/day；維持類固醇 ≤5 mg/day 並儘可能停用；生物製劑不必等傳統藥失敗。
                ・EULAR 2025《SLE 腎臟侵犯更新》：早期合併治療、類固醇減停與治療里程碑。
                真實臨床遠比六個數值複雜（懷孕、抗磷脂症候群、神經精神狼瘡、藥物可近性……），本模擬僅為演算法教學。
              </p>
            </details>
          </div>
        </Card>

        <footer style={{ textAlign: "center", fontSize: 11, color: K.dim, marginTop: 4 }}>
          🦋 對弈紅斑性狼瘡・Monte Carlo Tree Search・教學模擬・非醫療建議
        </footer>
      </div>
    </div>
  );
}
