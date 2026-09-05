import { useState, useMemo } from "react";

/* ============================================================
   台股・蒙地卡羅勝率模擬器
   ・自訂上市個股或 ETF：貼上歷史收盤價（證交所／Yahoo／券商匯出）或手動設定參數
   ・方法：GBM 常態、GBM 厚尾 t、歷史重抽樣、區塊重抽樣
   ・含台股交易成本：手續費 0.1425%×2、證交稅（個股 0.3%／ETF 0.1%）
   ・輸出：期末勝率、達標率、停損停利出場機率、扇形圖、報酬分布、
           持有期間 vs 勝率曲線、報酬假設敏感度
   ⚠ 教育與研究用途，非投資建議。
   ============================================================ */

const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const K = {
  bg: "#f3f5f8", panel: "#ffffff", line: "#e1e6ee", text: "#1c2330", dim: "#6c7788",
  up: "#d63b34", upL: "#fdeeed", down: "#1a9a5f", downL: "#e6f6ee",   // 台股慣例：紅漲綠跌
  blue: "#2c66d9", blueL: "#e9f0fd", amber: "#c4841a", amberL: "#fff5df", ink: "#22304a",
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const money = v => `NT$ ${Math.round(v).toLocaleString()}`;
const signColor = v => (v > 0 ? K.up : v < 0 ? K.down : K.text);

// ---------- 亂數（可重現）----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRandn(rand) {
  let spare = null;
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u, v, s;
    do { u = rand() * 2 - 1; v = rand() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * m; return u * m;
  };
}

// ---------- 解析貼上的價格 ----------
function tokenizeLine(l) {
  if (l.includes('"')) {
    const out = []; const re = /"([^"]*)"|([^,]+)/g; let m;
    while ((m = re.exec(l))) out.push((m[1] !== undefined ? m[1] : m[2]).trim());
    return out.filter(x => x !== "");
  }
  let parts = l.split(/[,\t;]+/);
  if (parts.length === 1) parts = l.split(/\s+/);
  return parts.map(x => x.trim()).filter(x => x !== "");
}
const toNum = s => { const v = parseFloat(String(s).replace(/,/g, "")); return isFinite(v) ? v : NaN; };
const dateVal = s => {
  const m = String(s).match(/(\d{2,4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})/);
  if (!m) return null; let y = +m[1]; if (y < 1911) y += 1911;
  return y * 10000 + (+m[2]) * 100 + (+m[3]);
};
function parsePrices(text, forceCol) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = lines.map(tokenizeLine).filter(r => r.length);
  if (!rows.length) return { prices: [], msg: "" };
  let start = 0, col = null, colName = "";
  // 找表頭（前 6 列內含 收盤/Close）
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const r = rows[i];
    let idx = r.findIndex(f => /adj|調整/i.test(f) && /close|收盤/i.test(f));
    if (idx < 0) idx = r.findIndex(f => /收盤|close/i.test(f));
    if (idx >= 0) { start = i + 1; col = idx; colName = r[idx]; break; }
  }
  if (col === null && rows[0].some(f => isNaN(toNum(f)) && dateVal(f) === null)) start = 1;
  const data = rows.slice(start);
  const ncols = data.reduce((m, r) => Math.max(m, r.length), 0);
  if (forceCol) { col = forceCol - 1; colName = `第 ${forceCol} 欄（手動指定）`; }
  if (col === null) {
    if (ncols === 1) { col = 0; colName = "單欄數值"; }
    else if (ncols >= 7 && ncols <= 8) { col = 4; colName = "第 5 欄（猜測 Yahoo 格式 Close）"; }
    else if (ncols >= 9) { col = 6; colName = "第 7 欄（猜測證交所格式 收盤價）"; }
    else { col = ncols - 1; colName = `第 ${ncols} 欄（最後一欄）`; }
  }
  const prices = [], dates = [];
  for (const r of data) {
    const v = toNum(r[col]);
    if (!isFinite(v) || v <= 0) continue;
    prices.push(v);
    let dv = null; for (const f of r) { const d = dateVal(f); if (d !== null) { dv = d; break; } }
    dates.push(dv);
  }
  let reversed = false;
  const firstD = dates.find(x => x !== null);
  const lastD = [...dates].reverse().find(x => x !== null);
  if (firstD != null && lastD != null && firstD > lastD) { prices.reverse(); dates.reverse(); reversed = true; }
  const dstr = v => (v == null || !isFinite(v) || v < 0) ? "" : `${Math.floor(v / 10000)}/${String(Math.floor(v / 100) % 100).padStart(2, "0")}/${String(v % 100).padStart(2, "0")}`;
  const hasD = firstD != null && lastD != null;
  return { prices, dates, col, colName, ncols, reversed, from: hasD ? dstr(Math.min(firstD, lastD)) : "", to: hasD ? dstr(Math.max(firstD, lastD)) : "" };
}
function statsFromPrices(p) {
  if (!p || p.length < 3) return null;
  const r = [];
  for (let i = 1; i < p.length; i++) { const v = Math.log(p[i] / p[i - 1]); if (isFinite(v)) r.push(v); }
  const n = r.length; if (n < 2) return null;
  let s = 0; for (const x of r) s += x; const mean = s / n;
  let v2 = 0; for (const x of r) v2 += (x - mean) * (x - mean); const sd = Math.sqrt(v2 / (n - 1));
  const sigA = sd * Math.sqrt(252), muLogA = mean * 252, muA = muLogA + 0.5 * sigA * sigA;
  let peak = p[0], mdd = 0; for (const x of p) { if (x > peak) peak = x; const d = 1 - x / peak; if (d > mdd) mdd = d; }
  let worst = Infinity, best = -Infinity; for (const x of r) { if (x < worst) worst = x; if (x > best) best = x; }
  const years = n / 252, total = p[p.length - 1] / p[0] - 1;
  const cagr = years > 0 ? Math.pow(1 + total, 1 / years) - 1 : 0;
  return { rets: r, n, mean, sd, sigA, muA, muLogA, mdd, worst, best, years, total, cagr };
}

// ---------- 蒙地卡羅 ----------
function simulate(cfg) {
  const { paths, days, muA, sigA, method, hist, blockLen, tDf, feeRate, taxRate, stopLoss, takeProfit, seed, cps } = cfg;
  const rand = mulberry32(seed), randn = makeRandn(rand);
  const drift = (muA - 0.5 * sigA * sigA) / 252, sd = sigA / Math.sqrt(252);
  const costMul = (1 - feeRate - taxRate) / (1 + feeRate);
  let histAdj = null, hn = 0;
  if ((method === "boot" || method === "block") && hist && hist.length >= 30) {
    hn = hist.length; let m = 0; for (const x of hist) m += x; m /= hn;
    histAdj = new Float64Array(hn); for (let i = 0; i < hn; i++) histAdj[i] = hist[i] - m + drift;
  }
  const useBoot = !!histAdj;
  const tScale = Math.sqrt((tDf - 2) / tDf);
  const cpArr = [...new Set(cps.filter(d => d >= 1 && d <= days))].sort((a, b) => a - b);
  const cpVals = cpArr.map(() => new Float32Array(paths));
  const finalHold = new Float64Array(paths), finalStrat = new Float64Array(paths);
  const maxDD = new Float32Array(paths), exitType = new Uint8Array(paths);
  for (let p = 0; p < paths; p++) {
    let logS = 0, peak = 0, dd = 0, exited = false, ev = 1, et = 0, cpi = 0, blockLeft = 0, bStart = 0;
    for (let d = 1; d <= days; d++) {
      let step;
      if (useBoot) {
        if (method === "block") {
          if (blockLeft <= 0) { bStart = Math.floor(rand() * hn); blockLeft = blockLen; }
          step = histAdj[bStart % hn]; bStart++; blockLeft--;
        } else step = histAdj[Math.floor(rand() * hn)];
      } else if (method === "t") {
        // Bailey (1994) 極座標法：直接生成 Student-t，每步兩個均勻亂數
        let u, v, w;
        do { u = 2 * rand() - 1; v = 2 * rand() - 1; w = u * u + v * v; } while (w >= 1 || w === 0);
        const tv = u * Math.sqrt(tDf * (Math.pow(w, -2 / tDf) - 1) / w);
        step = drift + sd * tv * tScale;
      } else step = drift + sd * randn();
      logS += step;
      if (logS > peak) peak = logS;
      const cur = peak - logS; if (cur > dd) dd = cur;
      if (!exited) {
        const net = Math.exp(logS) * costMul - 1;
        if (stopLoss > 0 && net <= -stopLoss) { exited = true; ev = net + 1; et = 1; }
        else if (takeProfit > 0 && net >= takeProfit) { exited = true; ev = net + 1; et = 2; }
      }
      if (cpi < cpArr.length && d === cpArr[cpi]) { cpVals[cpi][p] = Math.exp(logS) * costMul - 1; cpi++; }
    }
    const fh = Math.exp(logS) * costMul;
    finalHold[p] = fh; finalStrat[p] = exited ? ev : fh; maxDD[p] = 1 - Math.exp(-dd); exitType[p] = et;
  }
  return { paths, days, cpArr, cpVals, finalHold, finalStrat, maxDD, exitType, usedBoot: useBoot };
}
function aggregate(sim, target) {
  const { finalStrat, finalHold, maxDD, exitType, cpArr, cpVals, paths } = sim;
  const s = Float64Array.from(finalStrat).sort();
  const q = p => s[Math.min(paths - 1, Math.floor(p * (paths - 1)))];
  let wins = 0, winsH = 0, tgt = 0, tp = 0, sl = 0, sum = 0;
  for (let i = 0; i < paths; i++) {
    if (finalStrat[i] > 1) wins++;
    if (finalHold[i] > 1) winsH++;
    if (finalStrat[i] - 1 >= target) tgt++;
    if (exitType[i] === 1) sl++; else if (exitType[i] === 2) tp++;
    sum += finalStrat[i];
  }
  const k5 = Math.max(1, Math.floor(paths * 0.05));
  let es = 0; for (let i = 0; i < k5; i++) es += s[i]; es /= k5;
  const ddS = Float32Array.from(maxDD).sort();
  const hist = (() => {
    const lo = q(0.005) - 1, hi = q(0.995) - 1, nb = 40, w = (hi - lo) / nb || 1;
    const bins = new Array(nb).fill(0);
    for (let i = 0; i < paths; i++) { const b = clamp(Math.floor((finalStrat[i] - 1 - lo) / w), 0, nb - 1); bins[b]++; }
    return { lo, hi, w, bins };
  })();
  const fan = cpArr.map((d, i) => {
    const a = Float32Array.from(cpVals[i]).sort();
    const g = p => a[Math.min(paths - 1, Math.floor(p * (paths - 1)))];
    return { d, p5: g(0.05), p25: g(0.25), p50: g(0.5), p75: g(0.75), p95: g(0.95) };
  });
  return {
    win: wins / paths, winHold: winsH / paths, targetRate: tgt / paths, pTP: tp / paths, pSL: sl / paths,
    mean: sum / paths - 1, p5: q(0.05) - 1, p25: q(0.25) - 1, p50: q(0.5) - 1, p75: q(0.75) - 1, p95: q(0.95) - 1,
    es5: es - 1, ddMed: ddS[Math.floor(paths / 2)], ddP95: ddS[Math.floor(paths * 0.95)], hist, fan,
  };
}

// ---------- 參考參數（示範用・粗略歷史特徵，非即時、非保證）----------
const PRESETS = [
  { id: "custom", code: "", name: "自訂標的", type: "stock", mu: 8, sig: 25, yld: 2 },
  { id: "0050", code: "0050", name: "元大台灣50", type: "etf", mu: 7, sig: 20, yld: 3 },
  { id: "006208", code: "006208", name: "富邦台50", type: "etf", mu: 7, sig: 20, yld: 3 },
  { id: "0056", code: "0056", name: "元大高股息", type: "etf", mu: 3, sig: 16, yld: 6 },
  { id: "00878", code: "00878", name: "國泰永續高股息", type: "etf", mu: 3, sig: 15, yld: 7 },
  { id: "2330", code: "2330", name: "台積電", type: "stock", mu: 15, sig: 28, yld: 1.5 },
  { id: "2317", code: "2317", name: "鴻海", type: "stock", mu: 6, sig: 28, yld: 4 },
  { id: "2412", code: "2412", name: "中華電", type: "stock", mu: 2, sig: 12, yld: 4 },
  { id: "TAIEX", code: "加權指數", name: "台股大盤（含息概念）", type: "etf", mu: 6, sig: 18, yld: 3 },
];
const HORIZONS = [{ m: 1, d: 21, l: "1 個月" }, { m: 3, d: 63, l: "3 個月" }, { m: 6, d: 126, l: "6 個月" }, { m: 12, d: 252, l: "1 年" }, { m: 24, d: 504, l: "2 年" }, { m: 36, d: 756, l: "3 年" }, { m: 60, d: 1260, l: "5 年" }];
const CURVE_CPS = [21, 63, 126, 252, 504, 756, 1260];
const CURVE_LBL = ["1月", "3月", "6月", "1年", "2年", "3年", "5年"];

// ---------- UI 小元件 ----------
function Card({ title, sub, children, accent = K.blue, style }) {
  return (
    <section style={{ background: K.panel, border: `1px solid ${K.line}`, borderRadius: 14, padding: "14px 16px 16px", marginBottom: 12, ...style }}>
      {title && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: accent }} />
            <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 800 }}>{title}</h2>
          </div>
          {sub && <p style={{ margin: "3px 0 0 16px", fontSize: 11.5, color: K.dim, lineHeight: 1.6 }}>{sub}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
function Btn({ children, onClick, disabled, kind = "solid", style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      fontFamily: FONT, fontSize: 13, fontWeight: 700, padding: "9px 14px", borderRadius: 10,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
      border: `1px solid ${kind === "solid" ? K.blue : K.line}`,
      background: kind === "solid" ? K.blue : "#fff", color: kind === "solid" ? "#fff" : K.text, ...style,
    }}>{children}</button>
  );
}
function Seg({ value, onChange, options, small }) {
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${K.line}`, borderRadius: 10, overflow: "hidden", flexWrap: "wrap" }}>
      {options.map(o => (
        <button key={String(o.v)} onClick={() => onChange(o.v)} disabled={o.disabled} style={{
          fontFamily: FONT, fontSize: small ? 11.5 : 12.5, fontWeight: 700, padding: small ? "5px 9px" : "6px 11px", border: "none",
          cursor: o.disabled ? "not-allowed" : "pointer", opacity: o.disabled ? 0.4 : 1,
          background: value === o.v ? K.ink : "#fff", color: value === o.v ? "#fff" : K.text,
        }}>{o.t}</button>
      ))}
    </div>
  );
}
function Row({ label, children, hint }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: `1px dashed ${K.line}`, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}{hint && <span style={{ color: K.dim, fontWeight: 400 }}>・{hint}</span>}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}
function Num({ value, onChange, min, max, step = 1, width = 76, suffix }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input type="number" value={value} min={min} max={max} step={step}
        onChange={e => onChange(e.target.value === "" ? "" : +e.target.value)}
        style={{ width, fontFamily: MONO, fontSize: 12.5, padding: "5px 7px", border: `1px solid ${K.line}`, borderRadius: 8 }} />
      {suffix && <span style={{ fontSize: 12, color: K.dim }}>{suffix}</span>}
    </span>
  );
}
function Toggle({ label, value, onChange }) {
  return (
    <button onClick={() => onChange(!value)} style={{
      fontFamily: FONT, fontSize: 12, fontWeight: 700, padding: "6px 10px", borderRadius: 10, cursor: "pointer",
      border: `1px solid ${value ? K.ink : K.line}`, background: value ? K.ink : "#fff", color: value ? "#fff" : K.text,
    }}>{value ? "✓ " : ""}{label}</button>
  );
}
function Stat({ label, value, sub, color }) {
  return (
    <div style={{ flex: "1 1 130px", background: K.bg, borderRadius: 12, padding: "10px 12px", border: `1px solid ${K.line}` }}>
      <div style={{ fontSize: 11, color: K.dim }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 900, fontFamily: MONO, color: color || K.text }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: K.dim, fontFamily: MONO }}>{sub}</div>}
    </div>
  );
}

// ---------- 圖表 ----------
function FanChart({ fan, days }) {
  if (!fan || !fan.length) return null;
  const W = 640, H = 220, L = 46, R = 12, Tp = 10, B = 26;
  let lo = 0, hi = 0;
  for (const f of fan) { lo = Math.min(lo, f.p5); hi = Math.max(hi, f.p95); }
  const pad = (hi - lo) * 0.08 || 0.05; lo -= pad; hi += pad;
  const x = d => L + (d / days) * (W - L - R);
  const y = v => Tp + (1 - (v - lo) / (hi - lo)) * (H - Tp - B);
  const band = (a, b) => `M ${fan.map(f => `${x(f.d)},${y(f[a])}`).join(" L ")} L ${[...fan].reverse().map(f => `${x(f.d)},${y(f[b])}`).join(" L ")} Z`;
  const line = k => fan.map(f => `${x(f.d)},${y(f[k])}`).join(" ");
  const step = days <= 130 ? 21 : days <= 520 ? 63 : 252;
  const ticks = []; for (let d = step; d <= days; d += step) ticks.push(d);
  const tl = d => step === 21 ? `${d / 21}月` : step === 63 ? `${d / 21}月` : `${d / 252}年`;
  const yTicks = []; { const span = hi - lo; const st = span > 2 ? 0.5 : span > 1 ? 0.25 : span > 0.5 ? 0.1 : 0.05; for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) yTicks.push(+v.toFixed(4)); }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", background: K.bg, borderRadius: 10, border: `1px solid ${K.line}` }}>
      {yTicks.map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? K.text : K.line} strokeWidth={v === 0 ? 1.2 : 1} strokeDasharray={v === 0 ? "none" : "3 4"} /><text x={L - 5} y={y(v) + 3.5} fontSize={9.5} textAnchor="end" fill={K.dim} fontFamily={MONO}>{(v * 100).toFixed(0)}%</text></g>)}
      {ticks.map(d => <text key={d} x={x(d)} y={H - 8} fontSize={9.5} textAnchor="middle" fill={K.dim} fontFamily={MONO}>{tl(d)}</text>)}
      <path d={band("p95", "p5")} fill={K.blue} fillOpacity={0.13} />
      <path d={band("p75", "p25")} fill={K.blue} fillOpacity={0.25} />
      <polyline points={line("p50")} fill="none" stroke={K.blue} strokeWidth={2.2} />
      <polyline points={line("p5")} fill="none" stroke={K.down} strokeWidth={1} strokeDasharray="4 3" />
      <polyline points={line("p95")} fill="none" stroke={K.up} strokeWidth={1} strokeDasharray="4 3" />
    </svg>
  );
}
function Histo({ hist }) {
  const { lo, hi, w, bins } = hist; const W = 640, H = 150, L = 8, B = 22;
  const mx = Math.max(...bins) || 1; const bw = (W - 2 * L) / bins.length;
  const x = v => L + ((v - lo) / (hi - lo)) * (W - 2 * L);
  const ticks = []; { const span = hi - lo; const st = span > 2 ? 0.5 : span > 1 ? 0.25 : span > 0.4 ? 0.1 : 0.05; for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) ticks.push(+v.toFixed(4)); }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", background: K.bg, borderRadius: 10, border: `1px solid ${K.line}` }}>
      {bins.map((c, i) => { const c0 = lo + (i + 0.5) * w; return <rect key={i} x={L + i * bw + 0.5} y={H - B - (c / mx) * (H - B - 8)} width={Math.max(1, bw - 1)} height={(c / mx) * (H - B - 8)} fill={c0 >= 0 ? K.up : K.down} fillOpacity={0.75} />; })}
      {lo < 0 && hi > 0 && <line x1={x(0)} x2={x(0)} y1={6} y2={H - B} stroke={K.text} strokeWidth={1.4} />}
      {ticks.map(v => <text key={v} x={x(v)} y={H - 6} fontSize={9.5} textAnchor="middle" fill={K.dim} fontFamily={MONO}>{(v * 100).toFixed(0)}%</text>)}
    </svg>
  );
}

// ---------- 主元件 ----------
export default function App() {
  const [presetId, setPresetId] = useState("0050");
  const [code, setCode] = useState("0050");
  const [name, setName] = useState("元大台灣50");
  const [assetType, setAssetType] = useState("etf");
  const [mode, setMode] = useState("manual");
  const [pasteText, setPasteText] = useState("");
  const [forceCol, setForceCol] = useState(0);
  const [addYield, setAddYield] = useState(true);
  const [muPrice, setMuPrice] = useState(7);
  const [sig, setSig] = useState(20);
  const [yld, setYld] = useState(3);
  const [horizon, setHorizon] = useState(12);
  const [capital, setCapital] = useState(100000);
  const [target, setTarget] = useState(10);
  const [stopOn, setStopOn] = useState(false); const [stopPct, setStopPct] = useState(15);
  const [tpOn, setTpOn] = useState(false); const [tpPct, setTpPct] = useState(20);
  const [method, setMethod] = useState("gbm");
  const [blockLen, setBlockLen] = useState(10);
  const [scenario, setScenario] = useState("base"); const [customMu, setCustomMu] = useState(5);
  const [nPaths, setNPaths] = useState(10000);
  const [fee, setFee] = useState(0.1425);
  const [seed, setSeed] = useState(20260816);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);

  const parsed = useMemo(() => (mode === "paste" ? parsePrices(pasteText, forceCol || null) : null), [pasteText, forceCol, mode]);
  const hstats = useMemo(() => (parsed && parsed.prices.length >= 3 ? statsFromPrices(parsed.prices) : null), [parsed]);

  const taxRate = assetType === "stock" ? 0.003 : 0.001;
  const yEff = (mode === "paste" ? (addYield ? yld : 0) : yld) / 100;
  const baseMuA = mode === "paste" ? (hstats ? hstats.muA + yEff : null) : muPrice / 100 + yEff;
  const baseSigA = mode === "paste" ? (hstats ? hstats.sigA : null) : sig / 100;
  const scenMuA = baseMuA == null ? null : scenario === "base" ? baseMuA : scenario === "half" ? baseMuA / 2 : scenario === "zero" ? 0 : customMu / 100;
  const bootOK = !!(hstats && hstats.n >= 30);
  const canRun = scenMuA != null && baseSigA != null && !((method === "boot" || method === "block") && !bootOK);
  const hz = HORIZONS.find(h => h.m === horizon) || HORIZONS[3];

  function applyPreset(id) {
    const p = PRESETS.find(x => x.id === id); if (!p) return;
    setPresetId(id); setCode(p.code); setName(p.name); setAssetType(p.type);
    setMuPrice(p.mu); setSig(p.sig); setYld(p.yld);
    setRes(null);
  }
  function loadDemo() {
    // 合成示範資料（GBM 生成，非任何真實標的）
    const rand = mulberry32(7), randn = makeRandn(rand);
    let s = 100; const lines = ["日期,收盤價（合成示範資料，非真實）"];
    const start = new Date(2024, 0, 2);
    for (let i = 0; i < 500; i++) {
      s *= Math.exp(0.0003 + 0.013 * randn());
      const d = new Date(start.getTime() + i * 1.45 * 86400000);
      lines.push(`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")},${s.toFixed(2)}`);
    }
    setPasteText(lines.join("\n")); setMode("paste"); setRes(null);
  }
  function run() {
    if (!canRun || busy) return;
    setBusy(true);
    setTimeout(() => {
      const t0 = performance.now();
      const base = {
        paths: nPaths, days: hz.d, muA: scenMuA, sigA: baseSigA, method,
        hist: hstats ? hstats.rets : null, blockLen: Math.max(2, blockLen), tDf: 4,
        feeRate: fee / 100, taxRate, stopLoss: stopOn ? stopPct / 100 : 0, takeProfit: tpOn ? tpPct / 100 : 0, seed,
      };
      const cps = []; for (let i = 1; i <= 48; i++) cps.push(Math.max(1, Math.round((i / 48) * hz.d)));
      const main = simulate({ ...base, cps });
      const agg = aggregate(main, target / 100);
      // 持有期間 vs 勝率（純持有，到 5 年）
      const cs = simulate({ ...base, paths: 3000, days: 1260, stopLoss: 0, takeProfit: 0, cps: CURVE_CPS, seed: seed + 1 });
      const curve = cs.cpArr.map((d, i) => { let w = 0; const a = cs.cpVals[i]; for (let j = 0; j < a.length; j++) if (a[j] > 0) w++; return { d, win: w / a.length }; });
      // 報酬假設敏感度（相對於基準假設）
      const sens = [{ l: "基準假設", f: 1 }, { l: "報酬減半", f: 0.5 }, { l: "零報酬", f: 0 }].map((sc, i) => {
        const s2 = simulate({ ...base, paths: 2000, muA: baseMuA * sc.f, cps: [], seed: seed + 2 + i });
        let w = 0; for (let j = 0; j < s2.paths; j++) if (s2.finalStrat[j] > 1) w++;
        return { ...sc, muA: baseMuA * sc.f, win: w / s2.paths };
      });
      setRes({ agg, curve, sens, ms: performance.now() - t0, usedBoot: main.usedBoot, cfg: { ...base, code, name, capital, target, horizon: hz, scenario } });
      setBusy(false);
    }, 30);
  }

  const methodOpts = [
    { v: "gbm", t: "GBM 常態" }, { v: "t", t: "GBM 厚尾 t(4)" },
    { v: "boot", t: "歷史重抽樣", disabled: !bootOK }, { v: "block", t: "區塊重抽樣", disabled: !bootOK },
  ];

  return (
    <div style={{ minHeight: "100vh", background: K.bg, color: K.text, fontFamily: FONT }}>
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "18px 12px 40px" }}>
        <header style={{ marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 900, letterSpacing: 1 }}>📈 台股・蒙地卡羅勝率模擬器</h1>
          <p style={{ margin: "3px 0 0", fontSize: 12.5, color: K.dim, lineHeight: 1.6 }}>
            自訂上市個股或 ETF，用上萬條隨機價格路徑估算「持有一段時間後獲利的機率」。紅漲綠跌（台股慣例）。
          </p>
        </header>
        <div style={{ fontSize: 12, color: K.amber, background: K.amberL, border: "1px solid #f0d9a4", borderRadius: 10, padding: "8px 12px", marginBottom: 12, lineHeight: 1.6 }}>
          ⚠ 教育與研究工具，<b>不是投資建議</b>，我也不是理財顧問。蒙地卡羅算的是「<b>如果</b>未來像你設定的報酬與波動，機率長什麼樣」——不是預言。本工具不連網抓價，請自行貼上資料或設定參數。
        </div>

        {/* 標的 */}
        <Card title="1️⃣ 標的與資料" sub="貼上歷史收盤價最準；沒有資料就用示範參數起步（粗略歷史特徵，非即時、非保證）">
          <Row label="參考起點">
            <select value={presetId} onChange={e => applyPreset(e.target.value)}
              style={{ fontFamily: FONT, fontSize: 12.5, padding: "6px 8px", border: `1px solid ${K.line}`, borderRadius: 8, background: "#fff" }}>
              {PRESETS.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} ${p.name}` : p.name}（示範參數）</option>)}
            </select>
          </Row>
          <Row label="代號／名稱">
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="代號" style={{ width: 80, fontFamily: MONO, fontSize: 12.5, padding: "5px 7px", border: `1px solid ${K.line}`, borderRadius: 8 }} />
            <input value={name} onChange={e => setName(e.target.value)} placeholder="名稱" style={{ width: 130, fontFamily: FONT, fontSize: 12.5, padding: "5px 7px", border: `1px solid ${K.line}`, borderRadius: 8 }} />
            <Seg value={assetType} onChange={setAssetType} small options={[{ v: "stock", t: "個股（稅 0.3%）" }, { v: "etf", t: "ETF（稅 0.1%）" }]} />
          </Row>
          <Row label="資料來源">
            <Seg value={mode} onChange={v => { setMode(v); setRes(null); }} options={[{ v: "manual", t: "手動設定參數" }, { v: "paste", t: "貼上歷史收盤價" }]} />
          </Row>
          {mode === "manual" ? (
            <div style={{ paddingTop: 6 }}>
              <Row label="年化價格報酬" hint="不含股利">
                <input type="range" min={-20} max={40} step={0.5} value={muPrice} onChange={e => setMuPrice(+e.target.value)} style={{ width: 150, accentColor: K.blue }} />
                <span style={{ fontFamily: MONO, fontSize: 12.5, width: 52 }}>{muPrice.toFixed(1)}%</span>
              </Row>
              <Row label="年化波動率" hint="標準差">
                <input type="range" min={5} max={80} step={0.5} value={sig} onChange={e => setSig(+e.target.value)} style={{ width: 150, accentColor: K.blue }} />
                <span style={{ fontFamily: MONO, fontSize: 12.5, width: 52 }}>{sig.toFixed(1)}%</span>
              </Row>
              <Row label="現金殖利率" hint="加回總報酬">
                <input type="range" min={0} max={12} step={0.1} value={yld} onChange={e => setYld(+e.target.value)} style={{ width: 150, accentColor: K.blue }} />
                <span style={{ fontFamily: MONO, fontSize: 12.5, width: 52 }}>{yld.toFixed(1)}%</span>
              </Row>
              <div style={{ fontSize: 11.5, color: K.dim, marginTop: 6 }}>→ 模擬用年化期望報酬 <b style={{ fontFamily: MONO }}>{((muPrice + yld)).toFixed(1)}%</b>・年化波動 <b style={{ fontFamily: MONO }}>{sig.toFixed(1)}%</b></div>
            </div>
          ) : (
            <div style={{ paddingTop: 8 }}>
              <textarea value={pasteText} onChange={e => { setPasteText(e.target.value); setRes(null); }}
                placeholder={"貼上每日收盤價（由舊到新或由新到舊皆可）。支援：\n・證交所「個股日成交資訊」CSV（含 收盤價 欄）\n・Yahoo 歷史資料 CSV（Date,Open,High,Low,Close,Adj Close,Volume）\n・或每行一個數字"}
                style={{ width: "100%", minHeight: 120, fontFamily: MONO, fontSize: 12, padding: 8, border: `1px solid ${K.line}`, borderRadius: 10, boxSizing: "border-box" }} />
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                <Btn kind="ghost" onClick={loadDemo} style={{ padding: "6px 10px", fontSize: 12 }}>載入合成示範資料（非真實）</Btn>
                <span style={{ fontSize: 12, color: K.dim }}>價格欄</span>
                <Num value={forceCol} onChange={v => setForceCol(v === "" ? 0 : Math.max(0, Math.floor(v)))} min={0} max={20} width={56} suffix="（0＝自動）" />
                <Toggle label={`資料未含股利 → 加回殖利率 ${yld}%`} value={addYield} onChange={setAddYield} />
                {addYield && <Num value={yld} onChange={v => setYld(v === "" ? 0 : v)} min={0} max={15} step={0.1} width={60} suffix="%" />}
              </div>
              {parsed && parsed.prices.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, background: K.bg, border: `1px solid ${K.line}`, borderRadius: 10, padding: "8px 10px", lineHeight: 1.8 }}>
                  解析：<b style={{ fontFamily: MONO }}>{parsed.prices.length}</b> 筆・使用 {parsed.colName}{parsed.reversed ? "・已自動反轉為由舊到新" : ""}{parsed.from ? `・${parsed.from} ～ ${parsed.to}` : ""}
                  ・首 {parsed.prices[0]} → 末 {parsed.prices[parsed.prices.length - 1]}
                  {hstats ? (
                    <div style={{ fontFamily: MONO, fontSize: 11.5, color: K.text }}>
                      年化報酬 <b style={{ color: signColor(hstats.muA) }}>{pct(hstats.muA)}</b>（CAGR {pct(hstats.cagr)}）・年化波動 <b>{pct(hstats.sigA)}</b>・期間總報酬 <span style={{ color: signColor(hstats.total) }}>{pct(hstats.total)}</span>・最大回撤 <span style={{ color: K.down }}>−{pct(hstats.mdd)}</span>・最差單日 <span style={{ color: K.down }}>{pct(hstats.worst)}</span>・約 {hstats.years.toFixed(1)} 年
                    </div>
                  ) : <div style={{ color: K.amber }}>資料不足 3 筆，無法估計參數</div>}
                  {hstats && hstats.n < 252 && <div style={{ color: K.amber }}>⚠ 少於一年的資料，估出的年化報酬極不可靠——建議只參考波動率，報酬用「情境」另行設定</div>}
                  {hstats && !bootOK && <div style={{ color: K.amber }}>⚠ 少於 30 筆，重抽樣方法停用</div>}
                </div>
              )}
              {parsed && parsed.prices.length === 0 && pasteText.trim() && <div style={{ marginTop: 8, fontSize: 12, color: K.amber }}>沒有解析到價格——試著手動指定「價格欄」</div>}
            </div>
          )}
        </Card>

        {/* 模擬設定 */}
        <Card title="2️⃣ 模擬設定">
          <Row label="持有期間">
            <Seg value={horizon} onChange={setHorizon} small options={HORIZONS.map(h => ({ v: h.m, t: h.l }))} />
          </Row>
          <Row label="投入本金">
            <Num value={capital} onChange={v => setCapital(v === "" ? 0 : v)} min={0} step={10000} width={110} suffix="元" />
          </Row>
          <Row label="目標報酬" hint="計算達標率">
            <Num value={target} onChange={v => setTarget(v === "" ? 0 : v)} min={-50} max={500} step={1} width={64} suffix="%" />
          </Row>
          <Row label="出場規則" hint="觸及即賣出（含成本後）">
            <Toggle label={`停損 −${stopPct}%`} value={stopOn} onChange={setStopOn} />
            {stopOn && <Num value={stopPct} onChange={v => setStopPct(v === "" ? 0 : v)} min={1} max={90} width={56} suffix="%" />}
            <Toggle label={`停利 +${tpPct}%`} value={tpOn} onChange={setTpOn} />
            {tpOn && <Num value={tpPct} onChange={v => setTpPct(v === "" ? 0 : v)} min={1} max={500} width={56} suffix="%" />}
          </Row>
          <Row label="模擬方法">
            <Seg value={method} onChange={setMethod} small options={methodOpts} />
          </Row>
          {method === "block" && (
            <Row label="區塊長度" hint="保留波動群聚"><Num value={blockLen} onChange={v => setBlockLen(v === "" ? 2 : v)} min={2} max={60} width={56} suffix="日" /></Row>
          )}
          <Row label="報酬情境" hint="這是最重要的假設">
            <Seg value={scenario} onChange={setScenario} small options={[{ v: "base", t: "基準" }, { v: "half", t: "減半" }, { v: "zero", t: "零報酬" }, { v: "custom", t: "自訂" }]} />
            {scenario === "custom" && <Num value={customMu} onChange={v => setCustomMu(v === "" ? 0 : v)} min={-30} max={60} step={0.5} width={64} suffix="% 年化" />}
          </Row>
          <Row label="交易成本" hint="買賣各收手續費；賣出加證交稅">
            <span style={{ fontSize: 12 }}>手續費</span><Num value={fee} onChange={v => setFee(v === "" ? 0 : v)} min={0} max={1} step={0.0025} width={70} suffix="%" />
            <span style={{ fontSize: 12, color: K.dim, fontFamily: MONO }}>證交稅 {assetType === "stock" ? "0.3" : "0.1"}%</span>
          </Row>
          <Row label="路徑數">
            <Seg value={nPaths} onChange={setNPaths} small options={[{ v: 2000, t: "2,000" }, { v: 10000, t: "10,000" }, { v: 20000, t: "20,000" }]} />
          </Row>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Btn onClick={run} disabled={!canRun || busy}>{busy ? "模擬中…" : `🎲 開始模擬（${nPaths.toLocaleString()} 條路徑）`}</Btn>
            <Btn kind="ghost" onClick={() => { setSeed(s => s + 1); }} disabled={busy}>🔀 換一組亂數種子</Btn>
            {scenMuA != null && baseSigA != null && (
              <span style={{ fontSize: 11.5, color: K.dim, fontFamily: MONO }}>
                模擬假設：年化報酬 {pct(scenMuA)}・波動 {pct(baseSigA)}{(method === "boot" || method === "block") ? "（波動形狀取自歷史）" : ""}
              </span>
            )}
          </div>
          {!canRun && <div style={{ fontSize: 12, color: K.amber, marginTop: 8 }}>{mode === "paste" && !hstats ? "請先貼上足夠的歷史價格，或改用「手動設定參數」" : "此方法需要 ≥30 筆歷史資料"}</div>}
        </Card>

        {res && (() => {
          const { agg, curve, sens, cfg } = res;
          const barrier = cfg.stopLoss > 0 || cfg.takeProfit > 0;
          return (
            <>
              <Card title={`3️⃣ 結果：${cfg.code} ${cfg.name}・持有 ${cfg.horizon.l}`} accent={K.up}
                sub={`${cfg.paths.toLocaleString()} 條路徑・${res.ms.toFixed(0)} ms・已扣手續費與證交稅・種子 ${cfg.seed}`}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  <Stat label={barrier ? "期末勝率（含出場規則）" : "期末勝率（獲利機率）"} value={pct(agg.win)} color={K.blue} sub={barrier ? `純持有 ${pct(agg.winHold)}` : "期末淨值 > 本金"} />
                  <Stat label={`達標率（報酬 ≥ ${cfg.target}%）`} value={pct(agg.targetRate)} color={K.blue} />
                  {barrier && <Stat label="停利先觸及" value={pct(agg.pTP)} color={K.up} sub={`停損先觸及 ${pct(agg.pSL)}`} />}
                  <Stat label="期望報酬（平均）" value={pct(agg.mean)} color={signColor(agg.mean)} sub={money(cfg.capital * (1 + agg.mean))} />
                  <Stat label="中位數報酬" value={pct(agg.p50)} color={signColor(agg.p50)} sub={money(cfg.capital * (1 + agg.p50))} />
                  <Stat label="最差 5%（VaR）" value={pct(agg.p5)} color={signColor(agg.p5)} sub={`尾端平均 ${pct(agg.es5)}`} />
                  <Stat label="最好 5%" value={pct(agg.p95)} color={signColor(agg.p95)} sub={money(cfg.capital * (1 + agg.p95))} />
                  <Stat label="途中最大回撤（中位）" value={`−${pct(agg.ddMed)}`} color={K.down} sub={`最糟 5% 達 −${pct(agg.ddP95)}`} />
                </div>
                <div style={{ fontSize: 11.5, color: K.dim, lineHeight: 1.7 }}>
                  本金 {money(cfg.capital)} → 期末區間（25%～75%）：<b style={{ fontFamily: MONO, color: signColor(agg.p25) }}>{money(cfg.capital * (1 + agg.p25))}</b> ～ <b style={{ fontFamily: MONO, color: signColor(agg.p75) }}>{money(cfg.capital * (1 + agg.p75))}</b>
                </div>
              </Card>

              <Card title="路徑扇形圖（含成本淨報酬）" sub="深藍帶 25%～75%、淺藍帶 5%～95%、實線中位數；虛線為 5%／95% 邊界">
                <FanChart fan={agg.fan} days={cfg.days} />
              </Card>

              <Card title="期末報酬分布" sub="紅＝獲利、綠＝虧損（台股慣例）；黑線為損益兩平">
                <Histo hist={agg.hist} />
              </Card>

              <Card title="持有期間 vs 勝率" accent={K.ink} sub="同一組假設、純持有不設出場，看時間如何改變獲利機率（3,000 條路徑）">
                <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 130, padding: "0 4px" }}>
                  {curve.map((c, i) => (
                    <div key={c.d} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: c.win >= 0.5 ? K.up : K.down }}>{pct(c.win, 0)}</span>
                      <div style={{ width: "100%", height: `${Math.max(2, c.win * 100)}px`, background: c.d === cfg.days ? K.blue : (c.win >= 0.5 ? K.up : K.down), opacity: c.d === cfg.days ? 1 : 0.55, borderRadius: "6px 6px 0 0" }} />
                      <span style={{ fontSize: 11, color: K.dim }}>{CURVE_LBL[i]}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, color: K.dim, marginTop: 6 }}>
                  {curve[curve.length - 1].win > curve[0].win + 0.1
                    ? "在正期望報酬假設下，時間會把勝率往上推——短線接近擲硬幣，長線由「報酬假設」主導。"
                    : "在這組假設下，拉長時間並沒有明顯提高勝率——請檢視報酬假設是否為零或負。"}
                </div>
              </Card>

              <Card title="報酬假設敏感度（最重要的一格）" accent={K.amber}
                sub="同樣的波動、同樣的持有期間，只改變「年化期望報酬」這一個假設，勝率會怎麼變">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {sens.map(s => (
                    <div key={s.l} style={{ flex: "1 1 150px", background: cfg.scenario === (s.f === 1 ? "base" : s.f === 0.5 ? "half" : "zero") ? K.blueL : K.bg, border: `1px solid ${K.line}`, borderRadius: 12, padding: "10px 12px" }}>
                      <div style={{ fontSize: 11.5, color: K.dim }}>{s.l}・年化 {pct(s.muA)}</div>
                      <div style={{ fontSize: 22, fontWeight: 900, fontFamily: MONO, color: s.win >= 0.5 ? K.up : K.down }}>{pct(s.win)}</div>
                      <div style={{ fontSize: 11, color: K.dim }}>期末勝率</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: K.text, marginTop: 8, lineHeight: 1.7 }}>
                  「零報酬」代表你對未來沒有任何看法、純粹擲硬幣——注意即使期望報酬為零，勝率仍<b>低於</b> 50%：這是波動拖累（volatility drag）加上交易成本的效果。
                  勝率的差距幾乎全部來自「你相信未來年化報酬是多少」，而這正是沒有人知道的數字。
                </div>
              </Card>
            </>
          );
        })()}

        <Card title="這個工具在算什麼、不在算什麼" accent={K.dim}>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>方法、假設與限制（請務必讀）</summary>
            <div style={{ fontSize: 12.5, lineHeight: 1.9, marginTop: 8 }}>
              <b>勝率的定義</b>：期末勝率＝持有到期末（或依規則出場）後，扣掉手續費與證交稅仍獲利的路徑比例；達標率＝報酬達到目標的比例；停損／停利先觸及＝哪一條線先被碰到。<br />
              <b>方法</b>：GBM 常態＝幾何布朗運動，固定波動、常態報酬；厚尾 t(4)＝用 t 分布製造更多極端日，較貼近真實崩跌頻率；歷史重抽樣＝從你貼的資料隨機抽每日報酬（保留肥尾但打散時序）；區塊重抽樣＝一次抽連續 N 天，保留波動群聚。報酬情境改變的是平均漂移，波動形狀不變。<br />
              <b>成本</b>：手續費預設 0.1425%（多數券商有折扣，可自行調整）買賣各一次；證交稅賣出時收，個股 0.3%、ETF 0.1%。<br />
              <b>沒有模擬</b>：股利所得稅與二代健保補充保費、除權息填息機率、盤中流動性與滑價、融資利息、匯率、政策與黑天鵝。貼上的若是未還原股利的收盤價，「加回殖利率」只是粗略近似。<br />
              <b>最重要的限制</b>：跟先前醫療模擬同一課——模擬器品質是天花板。圍棋規則已知，股價的「規則」沒人知道；歷史報酬與波動不代表未來。這裡的勝率是「把你的假設翻譯成機率」，不是預測；請一定看「報酬假設敏感度」那一格，並自行判斷或諮詢專業人士。<b>本工具非投資建議。</b>
            </div>
          </details>
        </Card>
      </div>
    </div>
  );
}
