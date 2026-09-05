import { useState, useRef } from "react";

/* ============================================================
   京都行程・壓力測試器 — 把行程書丟進蒙地卡羅跑一千趟
   ・依《2027 冬遊京都·最終行程書》建模：四天、五個硬錨、A/B 備案
   ・每趟模擬：隨機天氣・交通誤差・排隊・孩子電量動態・突發事件
   ・代理照「行程書的決策規則」現場改判（電量低→撤退、雨→備案 C…）
   ・輸出：硬錨達成率、最脆弱時段、電量曲線、備案觸發率
   ============================================================ */

const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
const SERIF = "'Songti TC','Noto Serif TC',serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const K = {
  bg: "#f5f1ea", panel: "#ffffff", line: "#e3dccf", text: "#2b2a27", dim: "#7a7468",
  ink: "#3b2f2f", red: "#c0392b", redL: "#fdecea", amber: "#c98a1a", amberL: "#fff5dd",
  green: "#2e8b57", greenL: "#e8f5ec", blue: "#2f6fa8", blueL: "#e8f0fa", purple: "#7b5ea7",
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = Math.random;
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const hm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const T = (h, m = 0) => h * 60 + m;

// ---------- 可調參數 ----------
const DEFAULTS = {
  kidStamina: 50,     // 孩子耐力（0 弱 ~ 100 強）
  buffer: 0,          // 全程額外緩衝分鐘（正 = 每段多留、負 = 更貼）
  vip: false,         // D2 已購 VIP 導覽
  d1Route: "A",       // D1 台灣端 A 包車 / B 自駕（影響 D1 起始電量）
  d2Route: "B",       // D2 去程 A JR / B 京阪
  d3Plan: "A",        // D3 下午 A 寶可夢 / B 植物園 / C 水族館 / auto 依規則
  d4Early: false,     // D4 提早一小時 08:35 出門
  snowRate: 18,       // 飄雪機率 %
  strictKid: false,   // 嚴格模式：孩子電量 <25 即視為崩潰
};

// ---------- 事件與工具 ----------
function travel(base, sd = 0.12, weather = 0, extra = 0) {
  return Math.max(base * 0.8, base * (1 + gauss() * sd) + weather * base * 0.15 + extra);
}
let RATE_MUL = 1; // 由 kidStamina 決定：耐力低 → 耗損快、回血慢
const drain = (kid, mins, rate, cold = 0) => clamp(kid - mins * (rate + cold) * RATE_MUL, 0, 100);
const recover = (kid, mins, rate) => clamp(kid + mins * rate / Math.sqrt(RATE_MUL), 0, 100);
const MELT = P => (P.strictKid ? 25 : 15);

// ---------- 單日模擬 ----------
// 回傳 {anchors:{name:{hit,slack}}, events:[], curve:[{t,kid}], meltdowns, plan}
function simDay1(P, W) {
  const ev = [], curve = [], anchors = {};
  const cold = W.snow ? 0.06 : W.rain ? 0.03 : 0;
  // 04:00 起床，包車 A 可車上續睡；B 自駕孩子醒著
  let kid = P.d1Route === "A" ? 78 + gauss() * 6 : 68 + gauss() * 7;
  kid = clamp(kid + (P.kidStamina - 50) * 0.3, 40, 100);
  let t = T(10, 45); // 抵關西
  curve.push({ t: T(5, 0), kid: kid + 5 }); curve.push({ t, kid });
  // 出關 + 行李
  const outT = travel(55, 0.3, 0);
  t += outT;
  ev.push({ t, txt: `出關完成（${Math.round(outT)} 分）` });
  // 12:16 HARUKA — 硬錨 1
  const harukaT = T(12, 16);
  const walk = travel(12, 0.2);
  const arrive = t + walk;
  const slack = harukaT - arrive;
  if (slack >= 0) { anchors.haruka1 = { hit: true, slack }; ev.push({ t: arrive, txt: `抵 JR 關西空港駅，餘裕 ${Math.round(slack)} 分`, ok: true }); t = harukaT + 82; }
  else if (slack > -30 && rnd() < 0.85) { anchors.haruka1 = { hit: true, slack, changed: true }; ev.push({ t: arrive, txt: `錯過 12:16，改劃 12:46 班（免費改一次）`, warn: true }); t = T(12, 46) + 82; }
  else { anchors.haruka1 = { hit: false, slack }; ev.push({ t: arrive, txt: `HARUKA 嚴重延誤：改搭 13:16`, bad: true }); t = T(13, 16) + 82; }
  kid = drain(kid, 82, 0.05); // 車上
  // 京都駅 → 飯店
  t += 5 + travel(12, 0.3, W.rain ? 1 : 0);
  ev.push({ t, txt: "抵希爾頓，辦入住/寄行李" });
  const roomReady = rnd() < 0.55;
  if (roomReady) { kid = recover(kid, 40, 0.5); t += 45; ev.push({ t, txt: "房間已備妥，回房喘口氣", ok: true }); }
  else { t += 25; kid = recover(kid, 25, 0.25); ev.push({ t, txt: "房未備妥，酒廊等候" }); }
  curve.push({ t, kid });
  // 寺町通散步 → 四条購物圈（軟行程：電量低就縮）
  const startWalk = Math.max(t, T(15, 0));
  t = startWalk;
  const shopping = ["寺町通散步", "OTABI KYOTO", "Nintendo KYOTO", "高島屋 B1"];
  let done = 0;
  for (const s of shopping) {
    if (kid < 30) { ev.push({ t, txt: `孩子電量 ${Math.round(kid)}%，${s} 之後全部略過，攔車回飯店`, warn: true }); break; }
    const dur = travel(s === "Nintendo KYOTO" ? 25 : s === "高島屋 B1" ? 35 : 18, 0.35);
    // 角色商店失控機率
    if (s === "Nintendo KYOTO" && rnd() < 0.3) { ev.push({ t: t + dur, txt: "任天堂店時間盒失守（+15 分、小爭執）", warn: true }); t += 15; kid -= 6; }
    t += dur; kid = drain(kid, dur, 0.3, cold); done++;
    curve.push({ t, kid });
  }
  // 回飯店
  t += travel(12, 0.3);
  ev.push({ t, txt: `回房開飯（完成 ${done}/4 站）` });
  kid = recover(kid, 60, 0.35);
  // 早睡達成？
  const sleepT = Math.max(t + 60, T(18, 45)) + 60 + (rnd() < 0.5 ? 20 : 95);
  const goodSleep = sleepT <= T(20, 45);
  ev.push({ t: sleepT, txt: goodSleep ? "20:30 前入睡 ✓" : `入睡 ${hm(sleepT)}（明日電量 −8）`, ok: goodSleep, warn: !goodSleep });
  curve.push({ t: sleepT, kid });
  const minKid = Math.min(...curve.map(c => c.kid));
  return { anchors, ev, curve, kidEnd: goodSleep ? 1 : 0, meltdown: minKid < MELT(P) };
}

function simDay2(P, W, prevSleep) {
  const ev = [], curve = [], anchors = {};
  const cold = W.snow ? 0.08 : W.rain ? 0.04 : W.temp < 3 ? 0.03 : 0;
  let kid = clamp(80 + (P.kidStamina - 50) * 0.35 - (prevSleep ? 0 : 8) + gauss() * 5, 30, 100);
  let t = T(7, 0);
  curve.push({ t, kid });
  // 歲修：鷹馬停駛
  const hippo = rnd() < 0.15;
  if (hippo) ev.push({ t: T(7, 5), txt: "官網運休：鷹馬停駛，上午改小小兵＋太空幻想", warn: true });
  // 去程
  let arrive;
  if (P.d2Route === "A") {
    const taxi = travel(12, 0.3, W.rain ? 1 : 0);
    const seated = rnd() < 0.55;
    arrive = T(7, 30) + taxi + 8 + 50 + (seated ? 0 : 0);
    kid = drain(kid, 50, seated ? 0.05 : 0.14);
    ev.push({ t: arrive, txt: `JR 路線抵環球${seated ? "（有座）" : "（站到大阪）"}` });
  } else {
    arrive = T(7, 40) + 45 + travel(25, 0.15);
    kid = recover(kid, 45, 0.15);
    ev.push({ t: arrive, txt: "京阪 Premium Car 抵環球（車上補眠）", ok: true });
  }
  t = Math.max(arrive, T(9, 0));
  curve.push({ t, kid });
  // 上午
  const queue = W.rain ? 0.7 : 1.0; // 雨天人少
  const rides = hippo ? ["小小兵", "太空幻想", "活米村散步", "互動魔杖"] : ["活米村散步", "互動魔杖", "鷹馬", "城堡湖畔"];
  for (const r of rides) {
    const q = travel(15, 0.5) * queue;
    const dur = q + 20;
    t += dur; kid = drain(kid, dur, 0.26, cold);
    if (r === "鷹馬" && rnd() < 0.2) { const extra = travel(20, 0.4); t += extra; kid = drain(kid, extra, 0.3, cold); ev.push({ t, txt: `鷹馬隊伍拉長（+${Math.round(extra)} 分）`, warn: true }); }
    curve.push({ t, kid });
    if (kid < 25) { ev.push({ t, txt: `孩子電量 ${Math.round(kid)}%，上午提前收工`, warn: true }); break; }
  }
  // 午餐
  if (P.vip) { t = Math.max(t, T(11, 0)) + 90; kid = recover(kid, 90, 0.3); ev.push({ t, txt: "Luminant 午餐（VIP）", ok: true }); }
  else {
    const early = t <= T(11, 20);
    if (early || rnd() < 0.5) { const q = early ? travel(10, 0.4) : travel(40, 0.4); t += q + 50; kid = recover(kid, 50, 0.3) ; kid = drain(kid, q, 0.2); ev.push({ t, txt: `三根掃帚午餐（排 ${Math.round(q)} 分）`, warn: q > 30 }); }
    else { t += 15 + 55; kid = recover(kid, 55, 0.3); ev.push({ t, txt: "改 SAIDO 保險案午餐" }); }
  }
  curve.push({ t, kid });
  // 下午環球奇境
  let leave;
  const stops = ["電子號碼券設施", "史努比", "小小兵冰凍雷射"];
  for (const s of stops) {
    if (kid < 30) { ev.push({ t, txt: `孩子電量 ${Math.round(kid)}%，提前撤退`, warn: true }); break; }
    if (t > T(14, 30)) { ev.push({ t, txt: "14:30 依計畫撤退" }); break; }
    const dur = travel(35, 0.4); t += dur; kid = drain(kid, dur, 0.24, cold);
    curve.push({ t, kid });
  }
  leave = Math.max(t, T(14, 30));
  // 回程
  const backT = travel(20, 0.15) + 5 + 12 + travel(55, 0.08) + 5;
  const rest = P.vip ? 0 : 0;
  t = leave + backT + rest;
  kid = recover(kid, 55, 0.2);
  ev.push({ t, txt: `京阪 Premium Car 回三条，步行到家` });
  curve.push({ t, kid });
  // 泳池
  if (kid > 35 && t < T(18, 30)) { t += 45 + 25; kid = drain(kid, 45, 0.15); ev.push({ t, txt: "B1 泳池 45 分 ✓", ok: true }); }
  else ev.push({ t, txt: `跳過泳池（電量 ${Math.round(kid)}%／時間）`, warn: true });
  // 晚餐
  const dinner = t < T(19, 20) ? "酒廊晚餐" : "客房餐";
  t += 60; kid = recover(kid, 60, 0.35);
  ev.push({ t, txt: dinner });
  const sleepT = Math.max(t, T(19, 30)) + 45 + (kid < 30 ? 0 : 30) + (rnd() < 0.35 ? 45 : 0);
  const goodSleep = sleepT <= T(21, 15);
  ev.push({ t: sleepT, txt: goodSleep ? "21:15 前入睡 ✓" : `入睡 ${hm(sleepT)}`, ok: goodSleep });
  curve.push({ t: sleepT, kid });
  const minKid = Math.min(...curve.map(c => c.kid));
  return { anchors, ev, curve, kidEnd: goodSleep ? 1 : 0, meltdown: minKid < MELT(P), hippo };
}

function simDay3(P, W, prevSleep) {
  const ev = [], curve = [], anchors = {};
  const cold = W.snow ? 0.07 : W.rain ? 0.035 : W.temp < 3 ? 0.025 : 0;
  let kid = clamp(84 + (P.kidStamina - 50) * 0.35 - (prevSleep ? 0 : 8) + gauss() * 5, 30, 100);
  let t = T(9, 15);
  curve.push({ t: T(8, 0), kid });
  // 出町柳
  t += travel(11, 0.2);
  // 豆餅排隊
  const q = travel(20, 0.6); t += q; kid = drain(kid, q, 0.15, cold);
  ev.push({ t, txt: `出町ふたば排隊 ${Math.round(q)} 分`, warn: q > 30 });
  // 跳石：乾燥才嘗
  if (!W.rain && !W.snow && rnd() < 0.5) { t += 8; ev.push({ t, txt: "鴨川跳石淺嘗（乾燥日）" }); if (rnd() < 0.05) { kid -= 15; t += 15; ev.push({ t, txt: "跳石滑倒小哭（+15 分安撫）", bad: true }); } }
  else { t += 3; }
  // 糺の森 + さるや + 本殿 + 河合（代理會看錶：落後就縮短各段）
  const plan3 = [["糺の森參道", 15, 0.15], ["さるや申餅", 25, -0.15], ["下鴨本殿", 25, 0.18], ["河合神社", 22, 0.15]];
  const sched3 = [T(10, 15), T(10, 40), T(11, 5), T(11, 24)]; // 行程書各段應結束時間
  for (let i = 0; i < plan3.length; i++) {
    const [name, base, rate] = plan3[i];
    let dur = travel(base, 0.25);
    const behind = t + dur - sched3[i];
    if (behind > 5) { const cut = Math.min(dur * 0.45, behind); dur -= cut; ev.push({ t: t + dur, txt: `${name}縮短 ${Math.round(cut)} 分追進度`, warn: cut > 10 }); }
    t += dur;
    kid = rate < 0 ? recover(kid, dur, -rate) : drain(kid, dur, rate, cold);
    curve.push({ t, kid });
  }
  // 手水濕手套事件
  if (W.temp < 4 && rnd() < 0.2) { kid -= 8; ev.push({ t, txt: "手水弄濕手套，孩子鬧脾氣（電量 −8）", warn: true }); }
  // 11:30 下鴨茶寮 — 硬錨 2
  const walk = travel(6, 0.3);
  const arr = t + walk;
  const slack = T(11, 30) - arr;
  if (slack >= -10) { anchors.chaso = { hit: true, slack }; ev.push({ t: arr, txt: `下鴨茶寮到店（餘裕 ${Math.round(slack)} 分）`, ok: slack >= 0, warn: slack < 0 }); t = Math.max(arr, T(11, 30)); }
  else { anchors.chaso = { hit: false, slack }; ev.push({ t: arr, txt: `下鴨茶寮遲到 ${Math.round(-slack)} 分`, bad: true }); t = arr; }
  t += 115; kid = recover(kid, 115, 0.3);
  curve.push({ t, kid });
  // 三井別邸
  const teaOpen = rnd() < 0.8;
  const dur = teaOpen ? 40 : 30; t += 1 + dur; kid = teaOpen ? recover(kid, 20, 0.2) : drain(kid, dur, 0.12, cold);
  ev.push({ t, txt: teaOpen ? "三井別邸＋座敷喫茶 ✓" : "別邸座敷喫茶今日不供應，只看庭園" });
  curve.push({ t, kid });
  // 下午分歧
  let plan = P.d3Plan;
  if (plan === "auto") plan = (W.rain || W.snow) ? "C" : (kid < 45 ? "C" : (W.temp >= 6 && rnd() < 0.4 ? "B" : "A"));
  let afterT;
  if (plan === "A") {
    t += travel(15, 0.3, W.rain ? 1 : 0); const shop = travel(75, 0.3); t += shop; kid = drain(kid, shop, 0.2);
    if (rnd() < 0.3) { t += 15; ev.push({ t, txt: "寶可夢中心預算談判超時 +15", warn: true }); }
    ev.push({ t, txt: "Plan A 寶可夢中心京都" });
    t += travel(12, 0.3); // 回飯店
    afterT = t; kid = recover(kid, Math.max(0, T(17, 15) - t), 0.4);
  } else if (plan === "B") {
    t += travel(7, 0.3); const dur2 = travel(70, 0.3); t += dur2; kid = drain(kid, dur2, 0.16, cold * 0.4);
    ev.push({ t, txt: "Plan B 府立植物園（溫室）" });
    t += 25 + travel(15, 0.3); afterT = t; kid = recover(kid, Math.max(0, T(17, 15) - t), 0.4);
  } else {
    t += travel(20, 0.3, W.rain ? 1 : 0); const dur2 = travel(80, 0.3); t += dur2; kid = drain(kid, dur2, 0.14);
    ev.push({ t, txt: "Plan C 京都水族館" });
    t += travel(15, 0.3); afterT = t; kid = recover(kid, Math.max(0, T(17, 15) - t), 0.4);
  }
  curve.push({ t: afterT, kid });
  // 17:30 三嶋亭 — 硬錨 3
  const arr3 = Math.max(afterT, T(17, 10)) + travel(6, 0.3);
  const slack3 = T(17, 30) - arr3;
  if (slack3 >= -10) { anchors.mishima = { hit: true, slack: slack3 }; ev.push({ t: arr3, txt: `三嶋亭到店（餘裕 ${Math.round(slack3)} 分）`, ok: slack3 >= 0, warn: slack3 < 0 }); }
  else { anchors.mishima = { hit: false, slack: slack3 }; ev.push({ t: arr3, txt: `三嶋亭遲到 ${Math.round(-slack3)} 分（取消費風險）`, bad: true }); }
  const meltAtDinner = kid < 25;
  if (meltAtDinner) ev.push({ t: arr3, txt: `孩子電量 ${Math.round(kid)}% 進個室——晚餐品質打折`, warn: true });
  t = Math.max(arr3, T(17, 30)) + 110; kid = recover(kid, 60, 0.3);
  const sleepT = t + 60;
  ev.push({ t: sleepT, txt: `入睡 ${hm(sleepT)}` });
  curve.push({ t: sleepT, kid });
  const minKid = Math.min(...curve.map(c => c.kid));
  return { anchors, ev, curve, kidEnd: sleepT <= T(21, 30) ? 1 : 0, meltdown: meltAtDinner || minKid < MELT(P), plan };
}

function simDay4(P, W, prevSleep) {
  const ev = [], curve = [], anchors = {};
  const cold = W.snow ? 0.06 : W.rain ? 0.03 : 0;
  let kid = clamp(82 + (P.kidStamina - 50) * 0.35 - (prevSleep ? 0 : 6) + gauss() * 5, 30, 100);
  const start = P.d4Early ? T(8, 35) : T(9, 40);
  let t = start;
  curve.push({ t: T(8, 0), kid });
  t += travel(10, 0.2);
  // 二条城
  const crowd = P.d4Early ? 0.5 : 1;
  const nijo = travel(90, 0.2) + (rnd() < 0.3 ? 15 * crowd : 0);
  t += nijo; kid = drain(kid, nijo, 0.2, cold + 0.02); // 地板冰
  ev.push({ t, txt: `二条城 ${Math.round(nijo)} 分${P.d4Early ? "（開門檔）" : ""}` });
  curve.push({ t, kid });
  if (P.d4Early && rnd() < 0.7) { t += 25; ev.push({ t, txt: "神泉苑法成橋彩蛋 ✓", ok: true }); }
  // 12:00 Téori — 硬錨 4
  const arr = t + travel(10, 0.2);
  const slack = T(12, 0) - arr;
  if (slack >= -10) { anchors.teori = { hit: true, slack }; ev.push({ t: arr, txt: `Téori 到店（餘裕 ${Math.round(slack)} 分）`, ok: slack >= 0, warn: slack < 0 }); }
  else { anchors.teori = { hit: false, slack }; ev.push({ t: arr, txt: `Téori 遲到 ${Math.round(-slack)} 分`, bad: true }); }
  t = Math.max(arr, T(12, 0)) + 70; kid = recover(kid, 70, 0.3);
  curve.push({ t, kid });
  // 錦市場（軟）
  const nishiki = travel(75, 0.3);
  const cut = kid < 40 || t + 10 + nishiki > T(14, 40);
  const nishikiDur = cut ? nishiki * 0.55 : nishiki;
  t += 10 + nishikiDur; kid = drain(kid, nishikiDur, 0.18);
  ev.push({ t, txt: cut ? `錦市場縮短版（${Math.round(nishikiDur)} 分）` : `錦市場完整版 ${Math.round(nishikiDur)} 分`, warn: cut });
  curve.push({ t, kid });
  // 回飯店退房
  t += 10 + travel(45, 0.25);
  const leaveHotel = Math.max(t, T(15, 40));
  const late = t > T(15, 40);
  if (late) ev.push({ t, txt: `退房收拾超時，${hm(t)} 才出門`, warn: true });
  // 週六市區
  const taxi = travel(12, 0.4, W.rain ? 1 : 0, rnd() < 0.15 ? 15 : 0);
  const arrSta = leaveHotel + taxi + 6;
  const slack5 = T(16, 16) - arrSta;
  if (slack5 >= 0) { anchors.haruka2 = { hit: true, slack: slack5 }; ev.push({ t: arrSta, txt: `京都駅上月台，餘裕 ${Math.round(slack5)} 分`, ok: true }); t = T(16, 16) + 80; }
  else { anchors.haruka2 = { hit: true, slack: slack5, changed: true }; ev.push({ t: arrSta, txt: `錯過 16:16，改 16:46 備用班（犧牲貴賓室）`, warn: true }); t = T(16, 46) + 80; }
  const lounge = t <= T(18, 30);
  ev.push({ t, txt: lounge ? "貴賓室晚餐 ✓" : "貴賓室時間不足，直接登機門", ok: lounge, warn: !lounge });
  curve.push({ t, kid });
  const minKid = Math.min(...curve.map(c => c.kid));
  return { anchors, ev, curve, kidEnd: 1, meltdown: minKid < MELT(P), lounge };
}

// ---------- 整趟模擬 ----------
function sampleWeather(P) {
  return [0, 1, 2, 3].map(() => {
    const r = rnd();
    const snow = r < P.snowRate / 100;
    const rain = !snow && r < P.snowRate / 100 + 0.22;
    return { snow, rain, temp: 2 + rnd() * 7 };
  });
}
function simTrip(P) {
  RATE_MUL = 1.6 - (P.kidStamina / 100) * 1.0; // 耐力 20 → 1.4x；50 → 1.1x；90 → 0.7x
  const W = sampleWeather(P);
  const d1 = simDay1(P, W[0]);
  const d2 = simDay2(P, W[1], d1.kidEnd);
  const d3 = simDay3(P, W[2], d2.kidEnd);
  const d4 = simDay4(P, W[3], d3.kidEnd);
  const anchors = { ...d1.anchors, ...d2.anchors, ...d3.anchors, ...d4.anchors };
  const meltdowns = [d1, d2, d3, d4].filter(d => d.meltdown).length;
  // 評分（行程書的價值觀：硬錨最重、孩子不崩潰次之、體驗加分）
  let score = 100;
  for (const k of Object.keys(anchors)) { if (!anchors[k].hit) score -= 18; else if (anchors[k].changed) score -= 5; else if (anchors[k].slack < 0) score -= 4; }
  score -= meltdowns * 10;
  if (!d4.lounge) score -= 3;
  score = clamp(score, 0, 100);
  return { W, days: [d1, d2, d3, d4], anchors, meltdowns, score, d3plan: d3.plan, hippo: d2.hippo };
}
const ANCHORS = [
  { id: "haruka1", day: 1, name: "12:16 HARUKA 去程" },
  { id: "chaso", day: 3, name: "11:30 下鴨茶寮" },
  { id: "mishima", day: 3, name: "17:30 三嶋亭" },
  { id: "teori", day: 4, name: "12:00 Téori" },
  { id: "haruka2", day: 4, name: "16:16 HARUKA 回程" },
];
function runBatch(P, n) {
  const runs = [];
  for (let i = 0; i < n; i++) runs.push(simTrip(P));
  const stat = {};
  for (const a of ANCHORS) {
    const arr = runs.map(r => r.anchors[a.id]);
    stat[a.id] = {
      hit: arr.filter(x => x && x.hit && !x.changed).length / n,
      changed: arr.filter(x => x && x.hit && x.changed).length / n,
      miss: arr.filter(x => !x || !x.hit).length / n,
      slackAvg: arr.reduce((s, x) => s + (x ? x.slack : 0), 0) / n,
      slackP10: arr.map(x => x ? x.slack : 0).sort((a, b) => a - b)[Math.floor(n * 0.1)],
    };
  }
  const melt = [0, 1, 2, 3].map(d => runs.filter(r => r.days[d].meltdown).length / n);
  const scores = runs.map(r => r.score);
  const avg = scores.reduce((a, b) => a + b, 0) / n;
  const p10 = scores.slice().sort((a, b) => a - b)[Math.floor(n * 0.1)];
  const d3plans = { A: 0, B: 0, C: 0 };
  runs.forEach(r => { d3plans[r.d3plan]++; });
  const lounge = runs.filter(r => r.days[3].lounge).length / n;
  const goodSleep = [0, 1, 2].map(d => runs.filter(r => r.days[d].kidEnd).length / n);
  // 平均電量曲線（每日以 15 分格取樣）
  const grid = [];
  for (let m = T(7, 0); m <= T(22, 0); m += 30) grid.push(m);
  const curves = [0, 1, 2, 3].map(d => grid.map(m => {
    let s = 0, c = 0;
    for (const r of runs) {
      const cv = r.days[d].curve;
      // 線性插值
      let v = null;
      for (let i = 1; i < cv.length; i++) {
        if (cv[i - 1].t <= m && cv[i].t >= m) { const f = (m - cv[i - 1].t) / Math.max(1, cv[i].t - cv[i - 1].t); v = cv[i - 1].kid + f * (cv[i].kid - cv[i - 1].kid); break; }
      }
      if (v === null && cv.length && m < cv[0].t) v = cv[0].kid;
      if (v !== null) { s += v; c++; }
    }
    return c ? s / c : null;
  }));
  // 最脆弱事件：統計 bad/warn 文字出現率
  const warnCount = new Map();
  for (const r of runs) for (const d of r.days) for (const e of d.ev) if (e.warn || e.bad) {
    const key = e.txt.replace(/[\d.]+/g, "#");
    warnCount.set(key, (warnCount.get(key) || 0) + 1);
  }
  const topWarn = [...warnCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ txt: k, rate: v / n }));
  const worst = runs.slice().sort((a, b) => a.score - b.score)[0];
  const best = runs.slice().sort((a, b) => b.score - a.score)[0];
  return { n, stat, melt, avg, p10, d3plans, lounge, goodSleep, grid, curves, topWarn, worst, best, meltAvg: runs.reduce((s, r) => s + r.meltdowns, 0) / n };
}

// ---------- UI ----------
function Card({ title, sub, children, accent = K.ink }) {
  return (
    <section style={{ background: K.panel, border: `1px solid ${K.line}`, borderRadius: 14, padding: "14px 16px 16px", marginBottom: 12 }}>
      {title && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: accent }} />
            <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, letterSpacing: 0.5 }}>{title}</h2>
          </div>
          {sub && <p style={{ margin: "3px 0 0 16px", fontSize: 11.5, color: K.dim }}>{sub}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
function Btn({ children, onClick, disabled, kind = "solid", style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      fontFamily: FONT, fontSize: 13, fontWeight: 700, padding: "8px 14px", borderRadius: 10,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
      border: `1px solid ${kind === "solid" ? K.ink : K.line}`,
      background: kind === "solid" ? K.ink : "#fff", color: kind === "solid" ? "#fff" : K.text, ...style,
    }}>{children}</button>
  );
}
function Seg({ value, onChange, options }) {
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${K.line}`, borderRadius: 10, overflow: "hidden" }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{
          fontFamily: FONT, fontSize: 12, fontWeight: 700, padding: "6px 10px", border: "none", cursor: "pointer",
          background: value === o.v ? K.ink : "#fff", color: value === o.v ? "#fff" : K.text,
        }}>{o.t}</button>
      ))}
    </div>
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
const pct = v => `${(v * 100).toFixed(0)}%`;
const rateColor = v => v >= 0.9 ? K.green : v >= 0.7 ? K.amber : K.red;

export default function App() {
  const [P, setP] = useState(DEFAULTS);
  const [n, setN] = useState(1000);
  const [res, setRes] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showRun, setShowRun] = useState("worst");
  const set = (k, v) => setP(p => ({ ...p, [k]: v }));

  function run() {
    setBusy(true);
    setTimeout(() => { setRes({ ...runBatch(P, n), P: { ...P } }); setBusy(false); }, 30);
  }
  function pin() { if (res) setBaseline(res); }

  const Row = ({ label, children }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: `1px dashed ${K.line}`, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12.5, color: K.text, fontWeight: 600 }}>{label}</span>{children}
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: K.bg, color: K.text, fontFamily: FONT }}>
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "18px 12px 40px" }}>
        <header style={{ marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontFamily: SERIF, fontSize: 24, fontWeight: 900, letterSpacing: 1.5 }}>
            冬遊京都・行程壓力測試器
          </h1>
          <p style={{ margin: "3px 0 0", fontSize: 12.5, color: K.dim }}>
            把《最終行程書》丟進蒙地卡羅跑一千趟：隨機天氣、交通誤差、排隊、孩子電量與突發事件——找出五個硬錨中誰最脆弱。
          </p>
        </header>

        {/* 參數 */}
        <Card title="模擬參數" sub="對應行程書的 A/B 並陳與可調決策；改一項、重跑、比較">
          <Row label="孩子耐力（6 歲・110cm）">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="range" min={20} max={90} value={P.kidStamina} onChange={e => set("kidStamina", +e.target.value)} style={{ width: 130, accentColor: K.ink }} />
              <span style={{ fontFamily: MONO, fontSize: 12, width: 28 }}>{P.kidStamina}</span>
            </div>
          </Row>
          <Row label="D1 台灣端">
            <Seg value={P.d1Route} onChange={v => set("d1Route", v)} options={[{ v: "A", t: "A 包車（車上續睡）" }, { v: "B", t: "B 自駕" }]} />
          </Row>
          <Row label="D2 環球去程">
            <Seg value={P.d2Route} onChange={v => set("d2Route", v)} options={[{ v: "A", t: "A JR 新快速" }, { v: "B", t: "B 京阪 Premium Car" }]} />
          </Row>
          <Row label="D2 VIP 私人導覽">
            <Toggle label="已購入 VIP（Luminant 用餐）" value={P.vip} onChange={v => set("vip", v)} />
          </Row>
          <Row label="D3 下午">
            <Seg value={P.d3Plan} onChange={v => set("d3Plan", v)} options={[{ v: "A", t: "A 寶可夢" }, { v: "B", t: "B 植物園" }, { v: "C", t: "C 水族館" }, { v: "auto", t: "現場改判" }]} />
          </Row>
          <Row label="D4 二条城">
            <Toggle label="提早一小時（08:35 出門・開門檔）" value={P.d4Early} onChange={v => set("d4Early", v)} />
          </Row>
          <Row label="崩潰判定">
            <Toggle label="嚴格（電量 <25% 即算崩潰）" value={P.strictKid} onChange={v => set("strictKid", v)} />
          </Row>
          <Row label="飄雪機率">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="range" min={0} max={50} value={P.snowRate} onChange={e => set("snowRate", +e.target.value)} style={{ width: 130, accentColor: K.ink }} />
              <span style={{ fontFamily: MONO, fontSize: 12, width: 34 }}>{P.snowRate}%</span>
            </div>
          </Row>
          <Row label="模擬趟數">
            <Seg value={n} onChange={setN} options={[{ v: 300, t: "300" }, { v: 1000, t: "1000" }, { v: 3000, t: "3000" }]} />
          </Row>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Btn onClick={run} disabled={busy}>{busy ? "模擬中…" : `▶ 跑 ${n} 趟`}</Btn>
            <Btn kind="ghost" onClick={pin} disabled={!res}>📌 釘為基準（用來比較）</Btn>
            {baseline && <Btn kind="ghost" onClick={() => setBaseline(null)}>✕ 清除基準</Btn>}
          </div>
        </Card>

        {res && (
          <>
            {/* 總覽 */}
            <Card title="總覽" accent={K.blue} sub={`${res.n} 趟｜評分：硬錨未達 −18、改班 −5、擦線 −4、孩子崩潰每次 −10、貴賓室沒吃到 −3`}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {[
                  { l: "平均行程評分", v: res.avg.toFixed(1), b: baseline?.avg?.toFixed(1), c: K.blue },
                  { l: "最差 10% 評分", v: res.p10.toFixed(0), b: baseline?.p10?.toFixed(0), c: K.amber },
                  { l: "平均崩潰次數", v: res.meltAvg.toFixed(2), b: baseline?.meltAvg?.toFixed(2), c: K.red },
                  { l: "回程貴賓室吃到", v: pct(res.lounge), b: baseline ? pct(baseline.lounge) : null, c: K.green },
                ].map((x, i) => (
                  <div key={i} style={{ flex: "1 1 140px", background: K.bg, borderRadius: 12, padding: "10px 12px", border: `1px solid ${K.line}` }}>
                    <div style={{ fontSize: 11, color: K.dim }}>{x.l}</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: x.c, fontFamily: MONO }}>{x.v}</div>
                    {x.b != null && <div style={{ fontSize: 11, color: K.dim, fontFamily: MONO }}>基準 {x.b}</div>}
                  </div>
                ))}
              </div>
            </Card>

            {/* 硬錨 */}
            <Card title="五個硬錨的達成率" accent={K.red} sub="行程書說『其餘一切皆可現場改判』——所以只看這五顆釘子牢不牢">
              {ANCHORS.map(a => {
                const s = res.stat[a.id], b = baseline?.stat?.[a.id];
                return (
                  <div key={a.id} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700 }}>D{a.day}・{a.name}</span>
                      <span style={{ fontFamily: MONO, color: rateColor(s.hit) }}>
                        準點 {pct(s.hit)}{s.changed > 0.005 && <span style={{ color: K.amber }}>・改班 {pct(s.changed)}</span>}{s.miss > 0.005 && <span style={{ color: K.red }}>・錯過 {pct(s.miss)}</span>}
                        {b && <span style={{ color: K.dim }}>（基準 {pct(b.hit)}）</span>}
                      </span>
                    </div>
                    <div style={{ height: 10, background: K.bg, borderRadius: 99, overflow: "hidden", display: "flex", border: `1px solid ${K.line}` }}>
                      <div style={{ width: `${s.hit * 100}%`, background: K.green }} />
                      <div style={{ width: `${s.changed * 100}%`, background: K.amber }} />
                      <div style={{ width: `${s.miss * 100}%`, background: K.red }} />
                    </div>
                    <div style={{ fontSize: 11, color: K.dim, marginTop: 3, fontFamily: MONO }}>
                      平均餘裕 {s.slackAvg.toFixed(0)} 分・最差 10% 餘裕 {s.slackP10.toFixed(0)} 分
                    </div>
                  </div>
                );
              })}
            </Card>

            {/* 孩子電量 */}
            <Card title="孩子電量：四天平均曲線" accent={K.purple} sub="每趟模擬的孩子電量取平均；紅線 25% = 崩潰警戒。看哪個時段最容易見底">
              <svg viewBox="0 0 640 170" style={{ width: "100%", display: "block", background: K.bg, borderRadius: 10, border: `1px solid ${K.line}` }}>
                {[25, 50, 75].map(v => <line key={v} x1={40} x2={630} y1={150 - v * 1.3} y2={150 - v * 1.3} stroke={v === 25 ? K.red : K.line} strokeDasharray="4 4" strokeWidth={1} />)}
                {[7, 10, 13, 16, 19, 22].map(h => (
                  <text key={h} x={40 + ((h * 60 - T(7, 0)) / (T(22, 0) - T(7, 0))) * 590} y={164} fontSize={9.5} fill={K.dim} textAnchor="middle" fontFamily={MONO}>{h}:00</text>
                ))}
                {["0%", "25%", "50%", "75%", "100%"].map((l, i) => <text key={l} x={34} y={153 - i * 32.5} fontSize={9} fill={K.dim} textAnchor="end" fontFamily={MONO}>{l}</text>)}
                {res.curves.map((cv, d) => {
                  const col = [K.blue, K.purple, K.amber, K.green][d];
                  const pts = cv.map((v, i) => v == null ? null : `${40 + (i / (cv.length - 1)) * 590},${150 - v * 1.3}`).filter(Boolean).join(" ");
                  return <polyline key={d} points={pts} fill="none" stroke={col} strokeWidth={2.2} />;
                })}
              </svg>
              <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap", fontSize: 11.5 }}>
                {["D1 移動日", "D2 環球", "D3 心願日", "D4 二条城·返程"].map((l, d) => (
                  <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 14, height: 3, background: [K.blue, K.purple, K.amber, K.green][d], borderRadius: 2 }} />
                    {l}・崩潰率 <b style={{ color: rateColor(1 - res.melt[d]) }}>{pct(res.melt[d])}</b>
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: K.dim, marginTop: 6 }}>
                前三晚達成「早睡」：D1 {pct(res.goodSleep[0])}・D2 {pct(res.goodSleep[1])}・D3 {pct(res.goodSleep[2])}
                {res.P.d3Plan === "auto" && <>｜D3 下午現場改判分布：A {res.d3plans.A}・B {res.d3plans.B}・C {res.d3plans.C}</>}
              </div>
            </Card>

            {/* 最常出現的警訊 */}
            <Card title="最常出現的警訊（脆弱點排行）" accent={K.amber} sub="出現率 = 一千趟裡有多少趟發生；# 代表數字被歸一">
              {res.topWarn.map((w, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontFamily: MONO, fontSize: 11.5, color: rateColor(1 - w.rate), width: 40, textAlign: "right" }}>{pct(w.rate)}</span>
                  <div style={{ flex: 1, height: 7, background: K.bg, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${w.rate * 100}%`, height: "100%", background: rateColor(1 - w.rate) }} />
                  </div>
                  <span style={{ fontSize: 12, flex: 2 }}>{w.txt}</span>
                </div>
              ))}
            </Card>

            {/* 單趟重播 */}
            <Card title="單趟重播" accent={K.ink} sub="看看最慘的那一趟／最順的那一趟究竟發生了什麼">
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <Btn kind={showRun === "worst" ? "solid" : "ghost"} onClick={() => setShowRun("worst")} style={{ padding: "6px 12px", fontSize: 12 }}>😱 最慘一趟（{res.worst.score} 分）</Btn>
                <Btn kind={showRun === "best" ? "solid" : "ghost"} onClick={() => setShowRun("best")} style={{ padding: "6px 12px", fontSize: 12 }}>🌤 最順一趟（{res.best.score} 分）</Btn>
              </div>
              {(() => {
                const r = showRun === "worst" ? res.worst : res.best;
                return (
                  <div>
                    <div style={{ fontSize: 11.5, color: K.dim, marginBottom: 8, fontFamily: MONO }}>
                      天氣：{r.W.map((w, i) => `D${i + 1} ${w.snow ? "❄️雪" : w.rain ? "🌧雨" : "☀️晴"} ${w.temp.toFixed(0)}°`).join("・")}｜D3 下午 Plan {r.d3plan}{r.hippo ? "｜鷹馬歲修" : ""}
                    </div>
                    {r.days.map((d, i) => (
                      <details key={i} open={i === (showRun === "worst" ? 2 : 0)} style={{ marginBottom: 6 }}>
                        <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 12.5 }}>
                          D{i + 1}{d.meltdown ? " ⚠ 孩子崩潰" : ""}
                        </summary>
                        <div style={{ paddingLeft: 12, marginTop: 4 }}>
                          {d.ev.map((e, j) => (
                            <div key={j} style={{ fontSize: 12, padding: "2px 0", color: e.bad ? K.red : e.warn ? K.amber : e.ok ? K.green : K.text }}>
                              <span style={{ fontFamily: MONO, color: K.dim, marginRight: 8 }}>{hm(e.t)}</span>{e.txt}
                            </div>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                );
              })()}
            </Card>
          </>
        )}

        <Card title="這個模型怎麼建的？" accent={K.dim}>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>假設與限制（請務必看）</summary>
            <div style={{ fontSize: 12.5, lineHeight: 1.85, marginTop: 8, color: K.text }}>
              ・<b>建模來源</b>：四天時間表、五個硬錨、A/B 並陳、備案 B/C、「易犯錯誤」欄全部轉成狀態機；代理照行程書自己寫的規則現場改判（電量低撤退、雨天走 C、時間不夠縮錦市場、錯過 HARUKA 改下一班）。<br />
              ・<b>隨機性</b>：交通時間 ±12–30%、排隊常態分布、雨雪機率、房間備妥與否、角色商店失控、鷹馬歲修 15%、跳石滑倒 5%、週六塞車等。<br />
              ・<b>孩子電量</b>是整個模型最粗的假設：戶外冷天掉得快、飯店與泳池回血、前一晚沒早睡隔天扣 8。這條曲線的用途是「比較方案」而非「預測絕對值」——D1 傍晚實際觀察後，用耐力滑桿校準即可。<br />
              ・<b>它不是</b>時刻表查詢、不是天氣預報；所有交通時間依行程書所載。真正的價值：把「哪段最容易翻車」從直覺變成統計，並讓 A/B 方案可量化比較——例如釘住基準後切換「D2 京阪 vs JR」或「D4 提早一小時」再跑一次。
            </div>
          </details>
        </Card>
      </div>
    </div>
  );
}
