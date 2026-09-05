import { useState, useRef, useEffect } from "react";

/* ============================================================
   ABC 蒙蒙學校 — 上課與挑戰分開的 MCTS 英文課（6 歲）
   ・📚 蒙蒙教室：只「教」——每堂 5 張教學卡（單字/對話），
     課程規劃師用 MCTS 挑「教什麼」，rollout 一路模擬到之後的挑戰賽
   ・🏆 挑戰島：只「考」——教過的內容才會出現，出題規劃師
     用 MCTS 做間隔提取（甜蜜點複習＋補信心＋聊天保底）
   ・孩子看到：小島冒險、聽聲音選圖、集星星、貼紙簿、煙火
   ・引擎裡面：每個單字有「記憶強度」，孩子有「興趣電量」；
     蒙蒙老師每一題前用 MCTS 把「剩下的整堂課」模擬幾百遍——
     該複習快忘記的？教新字？還是塞一題會的把信心補回來？
   ・記憶模型＝遺忘曲線＋間隔效應（近似），但每答一題就校正
   ============================================================ */

const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const K = {
  sky: "#7ec8e8", skyDeep: "#4d9ec4", cream: "#fff8e9", edge: "#e0bd7a",
  ink: "#4a3524", sub: "#8a7154",
  red: "#e5484d", green: "#3cb96a", greenD: "#2a8a4d", sun: "#ffb84d", sunEdge: "#d98a1f",
  purple: "#8e6cf0", purpleD: "#6a4bd0", teal: "#2bbfa3", tealEdge: "#1d8f7a", pink: "#f47fb2",
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = Math.random;
const ri = n => Math.floor(rnd() * n);
const pick = a => a[ri(a.length)];
const shuffled = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = ri(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// ---------- 單字庫（emoji 圖卡，9 大領域）----------
const RAW = [
  // 動物島
  ["cat", "貓", "🐱", "animal", 1], ["dog", "狗", "🐶", "animal", 1], ["fish", "魚", "🐟", "animal", 1],
  ["bird", "鳥", "🐦", "animal", 1], ["pig", "豬", "🐷", "animal", 1], ["cow", "牛", "🐮", "animal", 1],
  ["duck", "鴨子", "🦆", "animal", 2], ["frog", "青蛙", "🐸", "animal", 2], ["bear", "熊", "🐻", "animal", 1],
  ["lion", "獅子", "🦁", "animal", 2], ["monkey", "猴子", "🐵", "animal", 2], ["rabbit", "兔子", "🐰", "animal", 2],
  ["tiger", "老虎", "🐯", "animal", 2], ["elephant", "大象", "🐘", "animal", 3],
  // 點心島
  ["apple", "蘋果", "🍎", "food", 2], ["banana", "香蕉", "🍌", "food", 2], ["egg", "蛋", "🥚", "food", 1],
  ["milk", "牛奶", "🥛", "food", 1], ["cake", "蛋糕", "🍰", "food", 1], ["bread", "麵包", "🍞", "food", 2],
  ["candy", "糖果", "🍬", "food", 2], ["cookie", "餅乾", "🍪", "food", 2], ["grape", "葡萄", "🍇", "food", 2],
  ["juice", "果汁", "🧃", "food", 2], ["rice", "飯", "🍚", "food", 1], ["strawberry", "草莓", "🍓", "food", 3],
  ["pizza", "披薩", "🍕", "food", 2], ["watermelon", "西瓜", "🍉", "food", 3],
  // 彩虹數字島
  ["red", "紅色", "🔴", "colorNum", 1], ["blue", "藍色", "🔵", "colorNum", 1], ["green", "綠色", "🟢", "colorNum", 1],
  ["yellow", "黃色", "🟡", "colorNum", 2], ["black", "黑色", "⚫", "colorNum", 2], ["white", "白色", "⚪", "colorNum", 2],
  ["pink", "粉紅色", "🩷", "colorNum", 1], ["purple", "紫色", "🟣", "colorNum", 3],
  ["one", "一", "1️⃣", "colorNum", 1], ["two", "二", "2️⃣", "colorNum", 1], ["three", "三", "3️⃣", "colorNum", 2],
  ["four", "四", "4️⃣", "colorNum", 1], ["five", "五", "5️⃣", "colorNum", 1], ["six", "六", "6️⃣", "colorNum", 1],
  ["seven", "七", "7️⃣", "colorNum", 2], ["eight", "八", "8️⃣", "colorNum", 2], ["nine", "九", "9️⃣", "colorNum", 1],
  ["ten", "十", "🔟", "colorNum", 1],
  // 身體島
  ["eye", "眼睛", "👁️", "body", 1], ["ear", "耳朵", "👂", "body", 1], ["nose", "鼻子", "👃", "body", 1],
  ["mouth", "嘴巴", "👄", "body", 2], ["hand", "手", "✋", "body", 1], ["foot", "腳", "🦶", "body", 1],
  ["leg", "腿", "🦵", "body", 1], ["arm", "手臂", "💪", "body", 1], ["teeth", "牙齒", "🦷", "body", 2],
  ["face", "臉", "🙂", "body", 1],
  // 家人島
  ["mom", "媽媽", "👩", "family", 1], ["dad", "爸爸", "👨", "family", 1], ["baby", "寶寶", "👶", "family", 1],
  ["brother", "哥哥弟弟", "👦", "family", 2], ["sister", "姊姊妹妹", "👧", "family", 2],
  ["grandma", "奶奶", "👵", "family", 2], ["grandpa", "爺爺", "👴", "family", 2],
  ["family", "家人", "👨‍👩‍👧‍👦", "family", 3],
  // 學校島
  ["book", "書", "📖", "school", 1], ["pen", "筆", "🖊️", "school", 1], ["pencil", "鉛筆", "✏️", "school", 2],
  ["bag", "書包", "🎒", "school", 1], ["chair", "椅子", "🪑", "school", 2], ["crayon", "蠟筆", "🖍️", "school", 2],
  ["scissors", "剪刀", "✂️", "school", 3], ["teacher", "老師", "🧑‍🏫", "school", 2],
  ["friend", "朋友", "🧑‍🤝‍🧑", "school", 2], ["school", "學校", "🏫", "school", 2],
  // 心情島
  ["happy", "開心", "😄", "feel", 1], ["sad", "難過", "😢", "feel", 1], ["angry", "生氣", "😠", "feel", 2],
  ["tired", "好累", "🥱", "feel", 2], ["hungry", "肚子餓", "😋", "feel", 2], ["scared", "害怕", "😨", "feel", 2],
  ["hot", "好熱", "🥵", "feel", 1], ["cold", "好冷", "🥶", "feel", 1],
  // 生活島
  ["sun", "太陽", "☀️", "life", 1], ["moon", "月亮", "🌙", "life", 1], ["star", "星星", "⭐", "life", 1],
  ["rain", "雨", "🌧️", "life", 1], ["rainbow", "彩虹", "🌈", "life", 2], ["snow", "雪", "❄️", "life", 1],
  ["cloud", "雲", "☁️", "life", 2], ["sea", "海", "🌊", "life", 1], ["tree", "樹", "🌳", "life", 1],
  ["flower", "花", "🌸", "life", 2], ["car", "車", "🚗", "life", 1], ["bus", "公車", "🚌", "life", 1],
  ["ball", "球", "⚽", "life", 1], ["house", "房子", "🏠", "life", 2], ["water", "水", "💧", "life", 2],
  // 動一動島
  ["run", "跑", "🏃", "act", 1], ["walk", "走路", "🚶", "act", 1], ["jump", "跳", "🤸", "act", 1],
  ["dance", "跳舞", "💃", "act", 2], ["sing", "唱歌", "🎤", "act", 1], ["swim", "游泳", "🏊", "act", 2],
  ["sleep", "睡覺", "😴", "act", 2], ["eat", "吃", "🍽️", "act", 1], ["drink", "喝", "🥤", "act", 1],
  ["play", "玩", "🪀", "act", 1], ["read", "看書", "📚", "act", 2], ["draw", "畫畫", "🎨", "act", 1],
];
const WORDS = RAW.map(([en, zh, emoji, cat, diff], id) => ({ id, kind: "word", en, zh, emoji, cat, diff }));
const NV = WORDS.length;
// ---------- 對話庫（蒙蒙說 → 你回答 → 蒙蒙收尾）----------
const DLG_RAW = [
  ["Hello!", "哈囉！", "Hi!", "嗨！", "🙋", "Nice to see you!", 1],
  ["Good morning!", "早安！", "Good morning!", "早安！", "🌞", "What a sunny day!", 1],
  ["How are you?", "你好嗎？", "I'm fine, thank you!", "我很好，謝謝！", "😊", "I'm happy today!", 2],
  ["What's your name?", "你叫什麼名字？", "My name is Kiki.", "我叫奇奇。", "🐥", "Nice to meet you, Kiki!", 2],
  ["Thank you!", "謝謝你！", "You're welcome!", "不客氣！", "🎁", "You are so kind!", 2],
  ["I'm sorry.", "對不起。", "It's OK!", "沒關係！", "🤝", "Let's hug!", 2],
  ["Good night!", "晚安！", "Good night! Sweet dreams!", "晚安，好夢！", "🌛", "See you tomorrow!", 2],
  ["Bye-bye!", "掰掰！", "See you!", "再見！", "👋", "Take care!", 1],
  ["Do you like cats?", "你喜歡貓嗎？", "Yes, I do!", "喜歡！", "🐈", "Me too! I love cats!", 2],
  ["What is this?", "這是什麼？", "It's an apple!", "是蘋果！", "🍏", "Yummy! I like apples!", 2],
  ["What color is it?", "這是什麼顏色？", "It's red!", "是紅色！", "🎈", "Red is pretty!", 2],
  ["How old are you?", "你幾歲？", "I'm six years old!", "我六歲！", "🎂", "Wow, you are big!", 2],
  ["Let's play!", "一起玩吧！", "OK! Let's go!", "好，走吧！", "🛝", "Yay! So fun!", 1],
  ["Are you hungry?", "你餓了嗎？", "Yes! I want cake!", "餓了！我想吃蛋糕！", "🧁", "Here you are!", 2],
];
const DLGS = DLG_RAW.map(([prompt, promptZh, en, zh, emoji, follow, diff], i) =>
  ({ id: NV + i, kind: "dlg", en, zh, emoji, cat: "dlg", diff, prompt, promptZh, follow }));
const ALL = [...WORDS, ...DLGS];
const NIT = ALL.length;
const ISLANDS = [
  { id: "all", name: "全部島嶼", icon: "🧭", cats: null },
  { id: "animal", name: "動物島", icon: "🐾", cats: ["animal"] },
  { id: "food", name: "點心島", icon: "🍎", cats: ["food"] },
  { id: "colorNum", name: "彩虹數字島", icon: "🌈", cats: ["colorNum"] },
  { id: "body", name: "身體島", icon: "🖐️", cats: ["body"] },
  { id: "family", name: "家人島", icon: "👨‍👩‍👧‍👦", cats: ["family"] },
  { id: "school", name: "學校島", icon: "🏫", cats: ["school"] },
  { id: "feel", name: "心情島", icon: "😄", cats: ["feel"] },
  { id: "life", name: "生活島", icon: "🏠", cats: ["life"] },
  { id: "act", name: "動一動島", icon: "🏃", cats: ["act"] },
  { id: "dlg", name: "對話島", icon: "💬", cats: ["dlg"] },
];
const FUN_STICKERS = ["🦄", "🚀", "🍭", "🏆", "🎠", "🧸", "🪁", "🛸", "🦖", "👑", "🎪", "🐬", "🦋", "🐢", "🐙", "🦕", "🍩", "🦩", "🥨", "🍿", "🎡", "🎯", "🎳", "🛼", "🛴", "🚁", "⛵", "🪐", "🌠", "🔮", "🎻", "🥁", "🎺", "🏯", "🧿", "🪅", "🛖", "🗿", "🏓", "🪄"];
function awardSticker(stk) {                     // 沒抽過的優先；抽完改發「重複收藏 ×N」
  const remain = FUN_STICKERS.filter(x => !stk.includes(x));
  return remain.length ? pick(remain) : pick(FUN_STICKERS);
}
const TEACH_N = 5;
const QUIZ_N = 10;

// ---------- 記憶模型（誠實的近似：遺忘曲線＋間隔效應）----------
// 每字狀態 {s:強度0-1, last:上次出題序, seen:次數}；E:興趣電量 0-100
function freshLearner() {
  return { ws: ALL.map(() => ({ s: 0, last: -9, seen: 0 })), E: 70, q: 0, wrongStreak: 0, tc: 0 };
}
const MODES = ["listen", "word2pic", "letter", "pic2word", "spell"];
const MODE_EASE = { teach: 1, listen: 1.1, word2pic: 1.0, letter: 0.95, pic2word: 0.85, spell: 0.8, dlgReply: 0.9 };
function stageMode(w, word) {          // 挑戰島專用：只會拿到教過的內容
  if (word.kind === "dlg") return "dlgReply";
  if (w.seen === 0) return "listen";     // 保險絲（正常不會發生）
  if (w.s < 0.34) return "listen";
  if (w.s < 0.55) return "word2pic";
  if (w.s < 0.7) return "letter";
  if (word.en.length === 3) return "spell";
  return "pic2word";
}
function retention(w, now) {
  if (w.seen === 0) return 0.12;
  const gap = Math.max(0, now - w.last);
  const base = w.s * Math.pow(0.945, gap * (1 - 0.55 * w.s));
  const shortTerm = gap <= 2 ? (0.8 - 0.32 * gap) * (1 - base) : 0; // 剛看過：短期記憶撐著
  return Math.min(0.97, base + shortTerm);
}
function predictP(w, word, now, E, mode) {
  if (mode === "teach") return 0.98;
  const R = retention(w, now);
  const eF = 0.75 + 0.25 * (E / 100);
  const dF = 1 - 0.08 * (word.diff - 1);
  return clamp(0.25 + 0.75 * R * MODE_EASE[mode] * eF * dF, 0.08, 0.97);
}
function applyAnswer(st, wi, correct, pWas, mode = "quiz") {
  const w = st.ws[wi];
  const gap = Math.max(1, st.q - w.last);
  if (mode === "teach") {
    w.s = clamp(w.s + (1 - w.s) * 0.17, 0, 1);  // 介紹＝熟悉，不等於記住（測驗效應才是大補）
    st.tc = (st.tc || 0) + 1;                    // 新鮮感遞減：介紹卡塞太多會膩
    st.E = clamp(st.E + (st.tc <= 3 ? 5 : st.tc <= 6 ? 1 : -3), 0, 100);
    st.wrongStreak = 0;
  } else if (correct) {
    const spacing = 1 + Math.min(1.3, gap / 6);
    w.s = clamp(w.s + (1 - w.s) * 0.36 * spacing, 0, 1);
    st.E = clamp(st.E + (w.seen === 1 ? 5 : pWas > 0.85 ? 1 : 3) + (mode === "dlgReply" ? 1 : 0), 0, 100);
    st.wrongStreak = 0;
  } else {
    w.s = clamp(w.s * 0.72 + 0.06, 0, 1);
    st.E = clamp(st.E - 7, 0, 100);
    st.wrongStreak++;
  }
  w.last = st.q;
  w.seen++;
  st.q++;
}
// 一堂課結束的價值：保留量 ×（興趣門檻）＋覆蓋——兩者缺一不可
function sessionValue(st, poolIds) {
  let sSum = 0, covered = 0;
  for (const id of poolIds) {
    const w = st.ws[id];
    if (w.seen > 0) sSum += w.s * Math.pow(0.95, 6);
    if (w.s > 0.35) covered++;
  }
  return (sSum / 3) * (0.35 + 0.65 * st.E / 100) + 0.15 * Math.min(1, covered / 8);
}
const cloneL = st => ({ ws: st.ws.map(w => ({ ...w })), E: st.E, q: st.q, wrongStreak: st.wrongStreak, tc: st.tc || 0 });

// ---------- 兩位規劃師的候選 ----------
function candidatesQuiz(st, poolIds) {   // 挑戰島：只從「教過的」挑
  const now = st.q;
  const seen = poolIds.filter(id => st.ws[id].seen > 0);
  const pOf = id => predictP(st.ws[id], ALL[id], now, st.E, stageMode(st.ws[id], ALL[id]));
  const sweet = seen.slice().sort((a, b) => Math.abs(pOf(a) - 0.72) - Math.abs(pOf(b) - 0.72));
  const out = [];
  for (const id of sweet.slice(0, 3)) out.push({ id, tag: "review" });
  const rescue = seen.slice().sort((a, b) => retention(st.ws[a], now) - retention(st.ws[b], now))[0];
  if (rescue != null) out.push({ id: rescue, tag: "review" });
  if (st.wrongStreak >= 1 && seen.length) {
    let best = seen[0], bp = -1;
    for (const id of seen) { const p = pOf(id); if (p > bp) { bp = p; best = id; } }
    out.push({ id: best, tag: "confidence" });
  }
  const sd = seen.filter(id => ALL[id].kind === "dlg");
  if (sd.length && !out.some(c => ALL[c.id].kind === "dlg")) {
    let best = sd[0], bp = -1;
    for (const id of sd) { const p = pOf(id); if (p > bp) { bp = p; best = id; } }
    out.push({ id: best, tag: "review" });
  }
  const dedup = [], has = new Set();
  for (const c of out) if (!has.has(c.id)) { has.add(c.id); dedup.push(c); }
  return dedup.length ? dedup : seen.slice(0, 1).map(id => ({ id, tag: "review" }));
}
function candidatesTeach(st, poolIds) {  // 蒙蒙教室：新內容＋回爐重教
  const unseen = poolIds.filter(id => st.ws[id].seen === 0);
  const uw = [], ud = [];
  for (const id of unseen) (ALL[id].kind === "dlg" ? ud : uw).push(id);
  const byDiff = (a, b) => (ALL[a].diff - ALL[b].diff) || (a - b);
  uw.sort(byDiff); ud.sort(byDiff);
  const merged = [];
  let wi2 = 0, di = 0;
  while (wi2 < uw.length || di < ud.length) {           // 單字:對話 ≈ 2:1 穿插
    for (let k = 0; k < 2 && wi2 < uw.length; k++) merged.push(uw[wi2++]);
    if (di < ud.length) merged.push(ud[di++]);
  }
  const out = merged.slice(0, 5).map(id => ({ id, tag: "new" }));
  const struggling = poolIds
    .filter(id => st.ws[id].seen >= 2 && st.ws[id].s < 0.3)
    .sort((a, b) => st.ws[a].s - st.ws[b].s)
    .slice(0, 2);
  for (const id of struggling) out.push({ id, tag: "reteach" });
  const dedup = [], has = new Set();
  for (const c of out) if (!has.has(c.id)) { has.add(c.id); dedup.push(c); }
  return dedup;
}
function rolloutQuiz(st, poolIds, total) {
  let steps = 0;
  while (st.q < total && steps++ < 4) {
    const cands = candidatesQuiz(st, poolIds);
    if (!cands.length) break;
    const r = rnd();
    let c;
    if (r < 0.6) c = cands[0];
    else c = pick(cands);
    const word = ALL[c.id];
    const mode = stageMode(st.ws[c.id], word);
    const p = predictP(st.ws[c.id], word, st.q, st.E, mode);
    applyAnswer(st, c.id, rnd() < p, p, mode);
  }
  return sessionValue(st, poolIds);
}
function teacherDecide(st0, poolIds, total, iters) {
  const t0 = performance.now();
  const rootCands = candidatesQuiz(st0, poolIds);
  if (rootCands.length === 1) return { pick: rootCands[0], stats: [], total: 0, ms: 0 };
  const root = { kids: new Map(), visits: 0, val: 0 };
  for (let it = 0; it < iters; it++) {
    let st = cloneL(st0);
    let node = root;
    const path = [root];
    let depth = 0;
    while (st.q < total && depth++ < 4) {
      const cands = candidatesQuiz(st, poolIds);
      if (!cands.length) break;
      const keys = cands.map(c => `${c.id}`);
      const un = [];
      for (let i = 0; i < keys.length; i++) if (!node.kids.has(keys[i])) un.push(i);
      let idx;
      if (un.length) {
        idx = un[ri(un.length)];
        const child = { kids: new Map(), visits: 0, val: 0 };
        node.kids.set(keys[idx], child);
        const c = cands[idx];
        const word = ALL[c.id], mode = stageMode(st.ws[c.id], word);
        const p = predictP(st.ws[c.id], word, st.q, st.E, mode);
        applyAnswer(st, c.id, rnd() < p, p, mode);
        path.push(child);
        break;
      }
      let bi = 0, bn = null, bv = -Infinity;
      const lnN = Math.log(node.visits + 1);
      for (let i = 0; i < keys.length; i++) {
        const kd = node.kids.get(keys[i]);
        const u = kd.val / kd.visits + 0.8 * Math.sqrt(lnN / kd.visits);
        if (u > bv) { bv = u; bi = i; bn = kd; }
      }
      const c = cands[bi];
      const word = ALL[c.id], mode = stageMode(st.ws[c.id], word);
      const p = predictP(st.ws[c.id], word, st.q, st.E, mode);
      applyAnswer(st, c.id, rnd() < p, p, mode);
      path.push(bn); node = bn;
    }
    const v = rolloutQuiz(st, poolIds, total);
    for (const n of path) { n.visits++; n.val += v; }
  }
  let best = rootCands[0], bv = -1;
  const stats = [];
  for (const c of rootCands) {
    const kd = root.kids.get(`${c.id}`);
    if (!kd) continue;
    stats.push({ ...c, visits: kd.visits, val: kd.val / kd.visits });
    if (kd.visits > bv) { bv = kd.visits; best = c; }
  }
  stats.sort((a, b) => b.visits - a.visits);
  return { pick: best, stats: stats.slice(0, 4), total: root.visits, ms: performance.now() - t0 };
}

// ---------- 課程規劃師（教什麼？rollout 一路模擬到之後的挑戰賽）----------
function rolloutLesson(st, poolIds, slotsLeft) {
  for (let k = 0; k < slotsLeft; k++) {
    const cands = candidatesTeach(st, poolIds);
    if (!cands.length) break;
    const c = rnd() < 0.6 ? cands[0] : pick(cands);
    applyAnswer(st, c.id, true, 0.98, "teach");
  }
  st.q += 2;                                   // 下課休息
  return rolloutQuiz(st, poolIds, st.q + QUIZ_N);
}
function decideLesson(st0, poolIds, slotsLeft, iters) {
  const t0 = performance.now();
  const rootCands = candidatesTeach(st0, poolIds);
  if (!rootCands.length) return null;
  if (rootCands.length === 1) return { pick: rootCands[0], stats: [], total: 0, ms: 0 };
  const root = { kids: new Map(), visits: 0, val: 0 };
  for (let it = 0; it < iters; it++) {
    let st = cloneL(st0);
    let node = root;
    const path = [root];
    let depth = 0;
    while (depth < slotsLeft) {
      const cands = candidatesTeach(st, poolIds);
      if (!cands.length) break;
      const keys = cands.map(c => `${c.id}`);
      const un = [];
      for (let i = 0; i < keys.length; i++) if (!node.kids.has(keys[i])) un.push(i);
      let ci;
      if (un.length) {
        ci = un[ri(un.length)];
        const child = { kids: new Map(), visits: 0, val: 0 };
        node.kids.set(keys[ci], child);
        applyAnswer(st, cands[ci].id, true, 0.98, "teach");
        path.push(child);
        depth++;
        break;
      }
      let bi = 0, bn = null, bv = -Infinity;
      const lnN = Math.log(node.visits + 1);
      for (let i = 0; i < keys.length; i++) {
        const kd = node.kids.get(keys[i]);
        const u = kd.val / kd.visits + 0.8 * Math.sqrt(lnN / kd.visits);
        if (u > bv) { bv = u; bi = i; bn = kd; }
      }
      applyAnswer(st, cands[bi].id, true, 0.98, "teach");
      path.push(bn); node = bn;
      depth++;
    }
    const v = rolloutLesson(st, poolIds, slotsLeft - depth);
    for (const n of path) { n.visits++; n.val += v; }
  }
  let best = rootCands[0], bv = -1;
  const stats = [];
  for (const c of rootCands) {
    const kd = root.kids.get(`${c.id}`);
    if (!kd) continue;
    stats.push({ ...c, visits: kd.visits, val: kd.val / kd.visits });
    if (kd.visits > bv) { bv = kd.visits; best = c; }
  }
  stats.sort((a, b) => b.visits - a.visits);
  return { pick: best, stats: stats.slice(0, 4), total: root.visits, ms: performance.now() - t0 };
}

// ---------- 出題器 ----------
function buildQuestion(st, wordId, tag) {
  const word = ALL[wordId];
  const w = st.ws[wordId];
  const mode = stageMode(w, word);
  if (mode === "teach") {
    return { word, mode, tag };
  }
  if (mode === "dlgReply") {
    const others = shuffled(DLGS.filter(x => x.id !== wordId)).slice(0, 2);
    return { word, mode, tag, options: shuffled([word, ...others]) };
  }
  const others = shuffled(WORDS.filter(x => x.id !== wordId && (x.cat === word.cat ? rnd() < 0.8 : rnd() < 0.3))).slice(0, 3);
  while (others.length < 3) {
    const x = WORDS[ri(NV)];
    if (x.id !== wordId && !others.includes(x)) others.push(x);
  }
  if (mode === "spell") {
    const letters = word.en.split("");
    const decoys = shuffled("abcdefghijklmnoprstuw".split("").filter(c => !letters.includes(c))).slice(0, 2);
    return { word, mode, tag, tiles: shuffled([...letters, ...decoys]) };
  }
  if (mode === "letter") {
    const first = word.en[0];
    const decoys = shuffled("abcdefghijklmnoprstuw".split("").filter(c => c !== first)).slice(0, 3);
    return { word, mode, tag, options: shuffled([first, ...decoys]) };
  }
  return { word, mode, tag, options: shuffled([word, ...others]) };
}

// ---------- TTS 發音 ----------
let voiceEn = null;
function initVoices() {
  try {
    const load = () => {
      const vs = window.speechSynthesis.getVoices();
      voiceEn = vs.find(v => /en[-_]US/i.test(v.lang) && /google|samantha|natural/i.test(v.name))
        || vs.find(v => /en[-_]US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
  } catch (e) { /* noop */ }
}
function speak(text, rate = 0.8) {
  try {
    if (!window.speechSynthesis) return false;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US"; u.rate = rate; u.pitch = 1.05;
    if (voiceEn) u.voice = voiceEn;
    window.speechSynthesis.speak(u);
    return true;
  } catch (e) { return false; }
}
const hasTTS = () => { try { return !!window.speechSynthesis; } catch (e) { return false; } };
function speakSeq(parts, rate = 0.8) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    let i = 0;
    const next = () => {
      if (i >= parts.length) return;
      const u = new SpeechSynthesisUtterance(parts[i++]);
      u.lang = "en-US"; u.rate = rate; u.pitch = 1.05;
      if (voiceEn) u.voice = voiceEn;
      u.onend = () => setTimeout(next, 350);
      window.speechSynthesis.speak(u);
      setTimeout(() => { try { if (!window.speechSynthesis.speaking && i < parts.length) next(); } catch (e) { /* noop */ } }, 3500);
    };
    next();
  } catch (e) { /* noop */ }
}

// ---------- 音效 ----------
let AC = null, sfxG = null;
function ctx() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === "suspended") AC.resume();
  return AC;
}
function bus() {
  const ac = ctx();
  if (!sfxG) { sfxG = ac.createGain(); sfxG.gain.value = 0.5; sfxG.connect(ac.destination); }
  return sfxG;
}
function tone(freq, t, dur, type, vol, slideTo) {
  const ac = ctx(), dest = bus();
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.03);
}
const SFX = {
  tap() { const t = ctx().currentTime; tone(600, t, 0.05, "triangle", 0.12, 800); },
  good() { const t = ctx().currentTime; [659, 880, 1319].forEach((f, i) => tone(f, t + i * 0.07, 0.14, "triangle", 0.18)); },
  star() { const t = ctx().currentTime; tone(1568, t, 0.08, "sine", 0.15); tone(2093, t + 0.09, 0.14, "sine", 0.13); },
  soft() { const t = ctx().currentTime; tone(330, t, 0.12, "sine", 0.12, 262); },
  reveal() { const t = ctx().currentTime; tone(523, t, 0.1, "triangle", 0.12); tone(659, t + 0.1, 0.14, "triangle", 0.12); },
  fanfare() { const t = ctx().currentTime; [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, t + i * 0.1, 0.2, "triangle", 0.18)); [784, 1047, 1319].forEach(f => tone(f, t + 0.7, 0.7, "sine", 0.08)); },
  sticker() { const t = ctx().currentTime; [880, 1109, 1319, 1760].forEach((f, i) => tone(f, t + i * 0.06, 0.12, "sine", 0.14)); },
};

// ---------- 儲存（跨次進度：貼紙簿才有意義）----------
const SAVE_KEY = "abc-school-v1";
async function loadSave() {
  try {
    const r = await window.storage.get(SAVE_KEY);
    if (r && r.value) return JSON.parse(r.value);
  } catch (e) { /* 沒存過 */ }
  return null;
}
async function persist(data) {
  try { await window.storage.set(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* noop */ }
}

// ---------- UI 小元件 ----------
function Btn({ children, onClick, disabled, color = K.sun, edge = K.sunEdge, fg = K.ink, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      fontFamily: FONT, fontSize: 15, fontWeight: 900, letterSpacing: 0.5,
      padding: "12px 16px", borderRadius: 16, cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.45 : 1, border: `3px solid ${edge}`, borderBottomWidth: 6,
      background: color, color: fg, ...style,
    }}>{children}</button>
  );
}
function Card({ children, style }) {
  return (
    <section style={{
      background: K.cream, border: `3px solid ${K.edge}`, borderRadius: 20,
      padding: "14px 14px 16px", marginBottom: 12, ...style,
    }}>{children}</section>
  );
}
const TAGS = { review: { t: "複習快忘記的", c: K.teal }, new: { t: "教新內容", c: K.sun }, confidence: { t: "補一題信心", c: K.pink }, reteach: { t: "回爐再教", c: K.purple } };

// ---------- 主元件 ----------
export default function App() {
  const [phase, setPhase] = useState("home"); // home | play | reveal | done | book
  const [island, setIsland] = useState("all");
  const [learner, setLearner] = useState(freshLearner);
  const [poolIds, setPoolIds] = useState(WORDS.map(w => w.id));
  const [q, setQ] = useState(null);
  const [qNum, setQNum] = useState(0);
  const [firstTry, setFirstTry] = useState(true);
  const [wrongPick, setWrongPick] = useState(new Set());
  const [spellDone, setSpellDone] = useState("");
  const [stars, setStars] = useState(0);
  const [totalStars, setTotalStars] = useState(0);
  const [stickers, setStickers] = useState([]);
  const [sessionWords, setSessionWords] = useState([]);
  const [notes, setNotes] = useState(null);
  const [confetti, setConfetti] = useState(false);
  const [sfxOn, setSfxOn] = useState(true);
  const [sessions, setSessions] = useState(0);
  const [seeds, setSeeds] = useState(0);
  const [lessonQ, setLessonQ] = useState(null);   // {item, tag}
  const [lessonNum, setLessonNum] = useState(0);
  const [lessonList, setLessonList] = useState([]);
  const lessonListRef = useRef([]); lessonListRef.current = lessonList;
  const [newSticker, setNewSticker] = useState(null);
  const learnerRef = useRef(learner); learnerRef.current = learner;
  const sfxRef = useRef(true); sfxRef.current = sfxOn;
  const busy = useRef(false);
  const sessionDlg = useRef(0);

  const fx = n => { if (sfxRef.current) { try { SFX[n](); } catch (e) { /* noop */ } } };

  useEffect(() => {
    initVoices();
    (async () => {
      const sv = await loadSave();
      if (sv) {
        const fresh = freshLearner();
        const days = Math.max(0, (Date.now() - (sv.t || Date.now())) / 86400000);
        const decay = Math.pow(0.93, days);
        const map = sv.it || {};
        ALL.forEach((item, i) => {
          const v = map[`${item.kind}:${item.en}`];
          if (v > 0) { fresh.ws[i].s = clamp(v * decay, 0, 1); fresh.ws[i].seen = 1; fresh.ws[i].last = -3; }
        });
        setLearner(fresh);
        setTotalStars(sv.stars || 0);
        setStickers(sv.stickers || []);
        setSessions(sv.sessions || 0);
        setSeeds(sv.seeds || 0);
      }
    })();
  }, []);
  async function saveAll(st, tStars, stk, ses, sd) {
    const it = {};
    ALL.forEach((item, i) => { if (st.ws[i].s > 0.02) it[`${item.kind}:${item.en}`] = st.ws[i].s; });
    await persist({ it, stars: tStars, stickers: stk, sessions: ses, seeds: sd, t: Date.now() });
  }

  const mastered = ALL.filter(w => learner.ws[w.id].s >= 0.7);

  function poolOf(islId) {
    const isl = ISLANDS.find(i => i.id === islId);
    return ALL.filter(w => !isl.cats || isl.cats.includes(w.cat)).map(w => w.id);
  }
  function freshSessionState() {
    const st = cloneL(learnerRef.current);
    if (st.q > 0) st.q += 2;                      // 下課休息
    st.wrongStreak = 0; st.tc = 0; st.E = clamp(st.E * 0.3 + 55, 40, 90);
    setLearner(st); learnerRef.current = st;
    return st;
  }
  function startLesson(islId) {
    const ids = poolOf(islId);
    const st = freshSessionState();
    setPoolIds(ids); setIsland(islId);
    setLessonNum(0); setLessonList([]);
    setPhase("lesson");
    nextLessonCard(st, ids, 0);
  }
  function nextLessonCard(st, ids, num) {
    if (busy.current) return;
    busy.current = true;
    setTimeout(() => {
      const dec = decideLesson(st, ids, TEACH_N - num, 500);
      busy.current = false;
      if (!dec) { finishLesson(num > 0); return; }  // 這座島都教完了（第一格就沒東西＝空堂，不發 🌱）
      let pickC = dec.pick, forced = false;
      const noDlgYet = !lessonListRef.current.some(l => ALL[l.id].kind === "dlg");
      if (num === TEACH_N - 1 && noDlgYet) {       // 最後一格：對話保底
        const dc = candidatesTeach(st, ids).find(c => ALL[c.id].kind === "dlg");
        if (dc) { pickC = dc; forced = true; }
      }
      const item = ALL[pickC.id];
      setLessonQ({ item, tag: pickC.tag });
      setNotes({ ...dec, chosen: pickC, forced, kind: "lesson", mode: "teach", E: st.E });
      setLessonNum(num);
      if (item.kind === "dlg") setTimeout(() => speakSeq([item.prompt, item.en]), 350);
      else setTimeout(() => speak(item.en), 350);
    }, 30);
  }
  function finishTeach() {
    const st = cloneL(learnerRef.current);
    const item = lessonQ.item;
    applyAnswer(st, item.id, true, 0.98, "teach");
    setLearner(st); learnerRef.current = st;
    const nl = [...lessonListRef.current, { id: item.id, tag: lessonQ.tag }];
    setLessonList(nl); lessonListRef.current = nl;
    fx("good");
    saveAll(st, totalStars, stickers, sessions, seeds);
    const num = lessonNum + 1;
    if (num >= TEACH_N) finishLesson();
    else { setPhase("lesson"); nextLessonCard(st, poolIds, num); }
  }
  function finishLesson(gotSeed = true) {
    fx(gotSeed ? "fanfare" : "tap");
    const sd = gotSeed ? seeds + 1 : seeds;
    setSeeds(sd);
    saveAll(learnerRef.current, totalStars, stickers, sessions, sd);
    setLessonQ(null);
    setPhase("lessonDone");
  }
  function startQuiz(islId) {
    const ids = poolOf(islId);
    const taught = ids.filter(id => learnerRef.current.ws[id].seen > 0);
    if (taught.length < 3) return;
    const st = freshSessionState();
    setPoolIds(ids); setIsland(islId);
    setQNum(0); setStars(0); setSessionWords([]);
    sessionDlg.current = 0;
    setPhase("play");
    nextQuestion(st, ids, 0);
  }
  function nextQuestion(st, ids, num) {
    if (busy.current) return;
    busy.current = true;
    setTimeout(() => {
      const dec = teacherDecide(st, ids, st.q + QUIZ_N, 700);
      let pickC = dec.pick, forced = false;
      if (num >= 4 && sessionDlg.current === 0) {        // 聊天保底：第 5 題起還沒對話就安排一題
        const cands = candidatesQuiz(st, ids);
        const dc = cands.find(c => ALL[c.id].kind === "dlg");
        if (dc) { pickC = dc; forced = true; }
      }
      const qq = buildQuestion(st, pickC.id, pickC.tag);
      setNotes({ ...dec, chosen: pickC, forced, kind: "quiz", mode: qq.mode, E: st.E });
      setQ(qq);
      setFirstTry(true); setWrongPick(new Set()); setSpellDone("");
      setQNum(num);
      busy.current = false;
      if (qq.mode === "dlgReply") setTimeout(() => speak(qq.word.prompt), 350);
      else if (qq.mode === "teach" && qq.word.kind === "dlg") setTimeout(() => speakSeq([qq.word.prompt, qq.word.en]), 350);
      else if (qq.mode === "listen" || qq.mode === "teach") setTimeout(() => speak(qq.word.en), 350);
    }, 30);
  }
  function finishAnswer(correct) {
    const st = cloneL(learnerRef.current);
    const word = q.word;
    const p = predictP(st.ws[word.id], word, st.q, st.E, q.mode);
    applyAnswer(st, word.id, correct && firstTry, p, q.mode);
    setLearner(st); learnerRef.current = st;
    if (word.kind === "dlg") sessionDlg.current++;
    setSessionWords(sw => [...sw, { id: word.id, ok: correct && firstTry }]);
    let tS = totalStars, stk = stickers.slice(), popped = null;
    if (q.mode === "teach") {
      fx("good");
      setConfetti(false);
    } else if (correct && firstTry) {
      const ns = stars + 1;
      setStars(ns); tS = totalStars + 1; setTotalStars(tS);
      if (tS % 10 === 0) {
        popped = awardSticker(stk);
        stk.push(popped); setStickers(stk);
      }
      fx("good"); setTimeout(() => fx("star"), 200);
      setConfetti(true); setTimeout(() => setConfetti(false), 1300);
    } else fx("reveal");
    if (popped) { setNewSticker({ e: popped, n: stk.filter(x => x === popped).length }); setTimeout(() => { fx("sticker"); }, 600); setTimeout(() => setNewSticker(null), 2600); }
    if (word.kind === "dlg") { if (q.mode !== "teach") speakSeq(correct ? [word.en, word.follow] : [word.en], 0.78); }
    else speak(word.en, 0.75);
    setPhase("reveal");
    saveAll(st, tS, stk, sessions, seeds);
  }
  function pickOption(opt) {
    if (phase !== "play") { if (phase === "reveal" && opt.en) speak(opt.en); return; }
    const correct = q.mode === "letter" ? opt === q.word.en[0] : opt.id === q.word.id;
    if (correct) { fx("tap"); finishAnswer(true); }
    else {
      fx("soft");
      if (firstTry) {
        setFirstTry(false);
        setWrongPick(new Set([q.mode === "letter" ? opt : opt.id]));
      } else finishAnswer(false);
    }
  }
  function pickTile(i, ch) {
    if (phase !== "play") return;
    const want = q.word.en[spellDone.length];
    if (ch === want) {
      fx("tap");
      const nd = spellDone + ch;
      setSpellDone(nd);
      if (nd === q.word.en) finishAnswer(true);
    } else {
      fx("soft");
      if (firstTry) setFirstTry(false);
      else finishAnswer(false);
    }
  }
  function goNext() {
    fx("tap");
    const num = qNum + 1;
    if (num >= QUIZ_N) {
      fx("fanfare");
      const ses = sessions + 1;
      setSessions(ses);
      saveAll(learnerRef.current, totalStars, stickers, ses, seeds);
      setPhase("done");
    } else {
      setPhase("play");
      nextQuestion(learnerRef.current, poolIds, num);
    }
  }

  const promptOf = () => {
    if (!q) return "";
    if (q.mode === "teach" && q.word.kind === "dlg") return "💬 新對話！聽蒙蒙說、跟著唸，再點卡片！";
    if (q.mode === "teach") return "🌱 新單字！聽一聽、跟著唸，再點大卡片！";
    if (q.mode === "dlgReply") return "💬 蒙蒙說話了！你要怎麼回答？";
    if (q.mode === "listen") return "👂 聽聽看，這是哪一個？";
    if (q.mode === "word2pic") return "📖 唸唸看這個字，選出圖片！";
    if (q.mode === "pic2word") return "🔎 這張圖的英文是哪一個？";
    if (q.mode === "letter") return "🔤 它的開頭是哪個字母？";
    return "✏️ 照順序把字母拼出來！";
  };

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(180deg, ${K.sky}, #a8e0c8)`, color: K.ink, fontFamily: FONT }}>
      <style>{`
        @keyframes bounceM { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes popIn { 0%{transform:scale(.3)} 70%{transform:scale(1.2)} 100%{transform:scale(1)} }
        @keyframes fall { 0%{transform:translateY(-20px) rotate(0)} 100%{transform:translateY(120px) rotate(260deg); opacity:0} }
        @keyframes wiggle { 0%,100%{transform:rotate(-4deg)} 50%{transform:rotate(4deg)} }
      `}</style>
      <div style={{ maxWidth: 620, margin: "0 auto", padding: "16px 12px 40px", position: "relative" }}>

        {confetti && (
          <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 50 }}>
            {Array.from({ length: 14 }, (_, i) => (
              <span key={i} style={{
                position: "absolute", left: `${8 + i * 6.5}%`, top: "18%", fontSize: 22,
                animation: `fall ${0.8 + rnd() * 0.5}s ease-in forwards`, animationDelay: `${rnd() * 0.2}s`,
              }}>{pick(["🎉", "⭐", "✨", "🎊"])}</span>
            ))}
          </div>
        )}
        {newSticker && (
          <div style={{
            position: "fixed", top: "30%", left: "50%", transform: "translateX(-50%)", zIndex: 60,
            background: "#fff", border: `4px solid ${K.sun}`, borderRadius: 24, padding: "18px 26px",
            textAlign: "center", animation: "popIn .5s ease", boxShadow: "0 8px 30px #0003",
          }}>
            <div style={{ fontSize: 46, animation: "wiggle 0.6s infinite" }}>{newSticker.e}{newSticker.n > 1 && <span style={{ fontSize: 18, fontWeight: 900, color: K.sunEdge }}> ×{newSticker.n}</span>}</div>
            <div style={{ fontWeight: 900, fontSize: 15 }}>集滿 10 顆星星！</div>
            <div style={{ fontSize: 12.5, color: K.sub }}>{newSticker.n > 1 ? "又收集到一張！同款疊起來更厲害" : "新貼紙進了你的貼紙簿 🎉"}</div>
          </div>
        )}

        {/* ===== 首頁 ===== */}
        {phase === "home" && (
          <div>
            <header style={{ textAlign: "center", margin: "8px 0 14px" }}>
              <div style={{ fontSize: 56, animation: "bounceM 1.6s infinite" }}>🏫🦉</div>
              <h1 style={{ margin: "4px 0 0", fontSize: 27, fontWeight: 900, letterSpacing: 2, color: "#fff", textShadow: `0 3px 0 ${K.skyDeep}` }}>
                ABC 蒙蒙學校
              </h1>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#f2fbff", fontWeight: 700 }}>
                先到教室上課 📚，再去挑戰島闖關 🏆——分開來，學得更清楚！
              </p>
            </header>
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontWeight: 900, fontSize: 14 }}>🌱 上課 <span style={{ fontFamily: MONO }}>{seeds}</span>　⭐ 星星 <span style={{ fontFamily: MONO }}>{totalStars}</span>　🏅 學會 <span style={{ fontFamily: MONO }}>{mastered.length}</span></div>
                <Btn onClick={() => { fx("tap"); setPhase("book"); }} color="#fff" edge={K.edge} style={{ padding: "8px 12px", fontSize: 13 }}>📒 貼紙簿</Btn>
              </div>
            </Card>
            <Card>
              <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 8, textAlign: "center" }}>先選一座島：</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginBottom: 12 }}>
                {ISLANDS.map(isl => (
                  <button key={isl.id} onClick={() => { fx("tap"); setIsland(isl.id); }} style={{
                    fontFamily: FONT, fontWeight: 900, fontSize: 12, cursor: "pointer",
                    padding: "6px 10px", borderRadius: 999,
                    border: `2.5px solid ${island === isl.id ? K.tealEdge : K.edge}`,
                    background: island === isl.id ? K.teal : "#fff",
                    color: island === isl.id ? "#fff" : K.ink,
                  }}>{isl.icon} {isl.name}</button>
                ))}
              </div>
              {(() => {
                const ids = poolOf(island);
                const taught = ids.filter(id => learner.ws[id].seen > 0 || learner.ws[id].s > 0.02).length;
                const fresh = ids.length - taught;
                const canQuiz = taught >= 3;
                return (
                  <div>
                    <div style={{ textAlign: "center", fontSize: 12, color: K.sub, fontWeight: 700, marginBottom: 10 }}>
                      這座島：已教 {taught}・還沒教 {fresh}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <Btn onClick={() => { fx("tap"); startLesson(island); }} color={K.sun} edge={K.sunEdge}
                        style={{ fontSize: 16, padding: "16px 8px" }}>
                        <div style={{ fontSize: 30 }}>📚</div>蒙蒙教室
                        <div style={{ fontSize: 11, color: K.sub, fontWeight: 700 }}>上課：學 {TEACH_N} 個新內容</div>
                      </Btn>
                      <Btn onClick={() => { fx("tap"); startQuiz(island); }} disabled={!canQuiz}
                        color={K.teal} edge={K.tealEdge} fg="#fff" style={{ fontSize: 16, padding: "16px 8px" }}>
                        <div style={{ fontSize: 30 }}>🏆</div>挑戰島
                        <div style={{ fontSize: 11, color: "#e6fff7", fontWeight: 700 }}>
                          {canQuiz ? `考 ${QUIZ_N} 題（只考教過的）` : "先上課才能挑戰！"}
                        </div>
                      </Btn>
                    </div>
                  </div>
                );
              })()}
              {!hasTTS() && <div style={{ fontSize: 11.5, color: K.sub, marginTop: 8 }}>※ 這台裝置沒有語音功能，會改用文字出題</div>}
            </Card>
            <ParentNotes learner={learner} notes={null} sessions={sessions} seeds={seeds} onReset={async () => {
              const fresh = freshLearner();
              setLearner(fresh); learnerRef.current = fresh;
              setTotalStars(0); setStickers([]); setSessions(0); setSeeds(0);
              await persist({ it: {}, stars: 0, stickers: [], sessions: 0, seeds: 0, t: Date.now() });
            }} />
          </div>
        )}

        {/* ===== 蒙蒙教室（上課） ===== */}
        {phase === "lesson" && lessonQ && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 16 }}>
                {Array.from({ length: TEACH_N }, (_, i) => (
                  <span key={i} style={{ opacity: i < lessonNum ? 1 : 0.28 }}>🌱</span>
                ))}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: "#fff", background: K.sunEdge, borderRadius: 10, padding: "3px 9px" }}>
                📚 第 {lessonNum + 1} / {TEACH_N} 張
              </div>
            </div>
            <Card style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: K.sub, marginBottom: 6 }}>
                {lessonQ.tag === "reteach" ? "🔁 再教一次！這個之前有點難" :
                  lessonQ.item.kind === "dlg" ? "💬 新對話！聽蒙蒙說、跟著唸，再點卡片" : "🌱 新單字！聽一聽、跟著唸，再點大卡片"}
              </div>
              {lessonQ.item.kind !== "dlg" && (
                <button onClick={() => { fx("tap"); speak(lessonQ.item.en); setTimeout(finishTeach, 550); }} style={{
                  fontFamily: FONT, cursor: "pointer", background: "#fff", borderRadius: 24,
                  border: `4px solid ${K.sun}`, borderBottomWidth: 8, padding: "18px 30px", animation: "popIn .4s ease",
                }}>
                  <div style={{ fontSize: 68 }}>{lessonQ.item.emoji}</div>
                  <div style={{ fontSize: 34, fontWeight: 900, fontFamily: MONO, letterSpacing: 2 }}>{lessonQ.item.en}</div>
                  <div style={{ fontSize: 15, color: K.sub, fontWeight: 700 }}>{lessonQ.item.zh}　🔊</div>
                </button>
              )}
              {lessonQ.item.kind === "dlg" && (
                <button onClick={() => { fx("tap"); speakSeq([lessonQ.item.prompt, lessonQ.item.en]); setTimeout(finishTeach, 900); }} style={{
                  fontFamily: FONT, cursor: "pointer", background: "#fff", borderRadius: 24, width: "100%",
                  border: `4px solid ${K.sun}`, borderBottomWidth: 8, padding: "14px 14px", animation: "popIn .4s ease", textAlign: "left",
                }}>
                  <div style={{ textAlign: "center", fontSize: 40 }}>{lessonQ.item.emoji}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 6 }}>
                    <span style={{ fontSize: 24 }}>🦉</span>
                    <div style={{ background: "#eef6ff", borderRadius: "4px 16px 16px 16px", padding: "8px 12px" }}>
                      <div style={{ fontFamily: MONO, fontWeight: 900, fontSize: 16 }}>{lessonQ.item.prompt}</div>
                      <div style={{ fontSize: 11.5, color: K.sub }}>{lessonQ.item.promptZh}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, flexDirection: "row-reverse" }}>
                    <span style={{ fontSize: 24 }}>🐥</span>
                    <div style={{ background: "#fff4d6", borderRadius: "16px 4px 16px 16px", padding: "8px 12px" }}>
                      <div style={{ fontFamily: MONO, fontWeight: 900, fontSize: 16 }}>{lessonQ.item.en}</div>
                      <div style={{ fontSize: 11.5, color: K.sub }}>{lessonQ.item.zh}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "center", fontSize: 12.5, color: K.sub, fontWeight: 700, marginTop: 8 }}>🔊 再聽一次＋完成，點這裡</div>
                </button>
              )}
              <div style={{ fontSize: 11.5, color: K.sub, marginTop: 10 }}>教室只上課、不考試——挑戰島才有題目喔！</div>
            </Card>
            <div style={{ marginTop: 12 }}>
              <ParentNotes learner={learner} notes={notes} sessions={sessions} seeds={seeds} compact />
            </div>
          </div>
        )}

        {/* ===== 下課囉 ===== */}
        {phase === "lessonDone" && (
          <Card style={{ textAlign: "center", animation: "popIn .5s ease" }}>
            <div style={{ fontSize: 50 }}>{lessonList.length ? "🔔🦉" : "🎓🦉"}</div>
            <div style={{ fontSize: 22, fontWeight: 900, margin: "4px 0" }}>{lessonList.length ? "下課囉！今天學了這些：" : "這座島全部教完啦！"}</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap", margin: "12px 0" }}>
              {lessonList.map((l, i) => (
                <div key={i} onClick={() => { const it = ALL[l.id]; it.kind === "dlg" ? speakSeq([it.prompt, it.en]) : speak(it.en); }} style={{
                  background: "#fff", border: `3px solid ${l.tag === "reteach" ? K.sun : K.green}`, borderRadius: 14,
                  padding: "6px 10px", cursor: "pointer",
                }}>
                  <div style={{ fontSize: 26 }}>{ALL[l.id].emoji}</div>
                  <div style={{ fontSize: 10.5, fontFamily: MONO, fontWeight: 700, maxWidth: 92, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ALL[l.id].en}</div>
                  {l.tag === "reteach" && <div style={{ fontSize: 9, color: K.sunEdge, fontWeight: 900 }}>回爐</div>}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: K.sub, marginBottom: 10 }}>{lessonList.length ? "（點卡片可以再聽一次）拿到 1 顆 🌱！" : "換一座島上課，或去挑戰島大顯身手！"}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <Btn onClick={() => { fx("tap"); setPhase("home"); }} color="#fff" edge={K.edge}>🏫 回學校</Btn>
              <Btn onClick={() => { fx("tap"); startQuiz(island); }} color={K.teal} edge={K.tealEdge} fg="#fff">🏆 去挑戰島考考看！</Btn>
            </div>
          </Card>
        )}

        {/* ===== 遊戲中 ===== */}
        {(phase === "play" || phase === "reveal") && q && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 15 }}>
                {Array.from({ length: QUIZ_N }, (_, i) => (
                  <span key={i} style={{ opacity: i < stars ? 1 : 0.28, fontSize: 15 }}>⭐</span>
                ))}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: "#fff", background: K.skyDeep, borderRadius: 10, padding: "3px 9px" }}>
                {qNum + 1} / {QUIZ_N}
              </div>
            </div>

            <Card style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: K.sub, marginBottom: 6 }}>{promptOf()}</div>
              {/* 題目主體 */}
              {q.mode === "teach" && phase === "play" && q.word.kind !== "dlg" && (
                <button onClick={() => { fx("tap"); speak(q.word.en); setTimeout(() => finishAnswer(true), 550); }} style={{
                  fontFamily: FONT, cursor: "pointer", background: "#fff", borderRadius: 24,
                  border: `4px solid ${K.sun}`, borderBottomWidth: 8, padding: "18px 30px", animation: "popIn .4s ease",
                }}>
                  <div style={{ fontSize: 68 }}>{q.word.emoji}</div>
                  <div style={{ fontSize: 34, fontWeight: 900, fontFamily: MONO, letterSpacing: 2 }}>{q.word.en}</div>
                  <div style={{ fontSize: 15, color: K.sub, fontWeight: 700 }}>{q.word.zh}　🔊</div>
                </button>
              )}
              {q.mode === "teach" && phase === "play" && q.word.kind === "dlg" && (
                <button onClick={() => { fx("tap"); speakSeq([q.word.prompt, q.word.en]); setTimeout(() => finishAnswer(true), 900); }} style={{
                  fontFamily: FONT, cursor: "pointer", background: "#fff", borderRadius: 24, width: "100%",
                  border: `4px solid ${K.sun}`, borderBottomWidth: 8, padding: "14px 14px", animation: "popIn .4s ease", textAlign: "left",
                }}>
                  <div style={{ textAlign: "center", fontSize: 40 }}>{q.word.emoji}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 6 }}>
                    <span style={{ fontSize: 24 }}>🦉</span>
                    <div style={{ background: "#eef6ff", borderRadius: "4px 16px 16px 16px", padding: "8px 12px" }}>
                      <div style={{ fontFamily: MONO, fontWeight: 900, fontSize: 16 }}>{q.word.prompt}</div>
                      <div style={{ fontSize: 11.5, color: K.sub }}>{q.word.promptZh}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, flexDirection: "row-reverse" }}>
                    <span style={{ fontSize: 24 }}>🐥</span>
                    <div style={{ background: "#fff4d6", borderRadius: "16px 4px 16px 16px", padding: "8px 12px" }}>
                      <div style={{ fontFamily: MONO, fontWeight: 900, fontSize: 16 }}>{q.word.en}</div>
                      <div style={{ fontSize: 11.5, color: K.sub }}>{q.word.zh}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "center", fontSize: 12.5, color: K.sub, fontWeight: 700, marginTop: 8 }}>🔊 再聽一次＋完成，點這裡</div>
                </button>
              )}
              {q.mode === "dlgReply" && (
                <div>
                  <div style={{ fontSize: 44 }}>{q.word.emoji}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", justifyContent: "center", marginTop: 4 }}>
                    <span style={{ fontSize: 26 }}>🦉</span>
                    <button onClick={() => { fx("tap"); speak(q.word.prompt); }} style={{
                      fontFamily: FONT, cursor: "pointer", background: "#eef6ff", border: "none",
                      borderRadius: "4px 16px 16px 16px", padding: "9px 13px", textAlign: "left",
                    }}>
                      <div style={{ fontFamily: MONO, fontWeight: 900, fontSize: 17 }}>{q.word.prompt} <span style={{ fontSize: 13 }}>🔊</span></div>
                      <div style={{ fontSize: 11.5, color: K.sub }}>{q.word.promptZh}</div>
                    </button>
                  </div>
                </div>
              )}
              {q.mode === "listen" && (
                <div>
                  <button onClick={() => { fx("tap"); speak(q.word.en); }} style={{
                    fontSize: 44, background: K.sun, border: `4px solid ${K.sunEdge}`, borderBottomWidth: 7,
                    borderRadius: 999, width: 96, height: 96, cursor: "pointer", animation: "bounceM 1.4s infinite",
                  }}>🔊</button>
                  {!hasTTS() && <div style={{ fontSize: 30, fontWeight: 900, fontFamily: MONO, marginTop: 8 }}>{q.word.en}</div>}
                </div>
              )}
              {q.mode === "word2pic" && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  <div style={{ fontSize: 38, fontWeight: 900, fontFamily: MONO, letterSpacing: 2 }}>{q.word.en}</div>
                  {hasTTS() && <button onClick={() => { fx("tap"); speak(q.word.en); }} style={{ fontSize: 20, background: "#fff", border: `3px solid ${K.edge}`, borderRadius: 999, width: 44, height: 44, cursor: "pointer" }}>🔊</button>}
                </div>
              )}
              {q.mode === "pic2word" && <div style={{ fontSize: 64 }}>{q.word.emoji}</div>}
              {q.mode === "letter" && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
                  <div style={{ fontSize: 54 }}>{q.word.emoji}</div>
                  <div style={{ fontSize: 30, fontWeight: 900, fontFamily: MONO }}>
                    <span style={{ color: K.red }}>_</span>{q.word.en.slice(1)}
                  </div>
                  {hasTTS() && <button onClick={() => { fx("tap"); speak(q.word.en); }} style={{ fontSize: 20, background: "#fff", border: `3px solid ${K.edge}`, borderRadius: 999, width: 44, height: 44, cursor: "pointer" }}>🔊</button>}
                </div>
              )}
              {q.mode === "spell" && (
                <div>
                  <div style={{ fontSize: 54 }}>{q.word.emoji}</div>
                  <div style={{ fontSize: 32, fontWeight: 900, fontFamily: MONO, letterSpacing: 6, minHeight: 42 }}>
                    {q.word.en.split("").map((ch, i) => (
                      <span key={i} style={{ color: i < spellDone.length ? K.green : "#d9c9a8" }}>
                        {i < spellDone.length ? ch : "_"}
                      </span>
                    ))}
                  </div>
                  {hasTTS() && <button onClick={() => { fx("tap"); speak(q.word.en); }} style={{ fontSize: 18, background: "#fff", border: `3px solid ${K.edge}`, borderRadius: 999, width: 40, height: 40, cursor: "pointer" }}>🔊</button>}
                </div>
              )}
              {phase === "reveal" && (
                <div style={{ marginTop: 8, animation: "popIn .4s ease" }}>
                  <div style={{ fontSize: 20, fontWeight: 900 }}>
                    {q.word.emoji} <span style={{ fontFamily: MONO }}>{q.word.en}</span>
                    <span style={{ color: K.sub, fontSize: 15 }}>　{q.word.zh}</span>
                  </div>
                  <div style={{ fontSize: 14, color: firstTry ? K.greenD : K.sub, fontWeight: 900, marginTop: 2 }}>
                    {firstTry ? pick(["Great! 太棒了！", "Yes! 答對了！", "Wow! 好厲害！"]) : "沒關係，學到了！下次一定行 💪"}
                  </div>
                </div>
              )}
            </Card>

            {/* 選項 */}
            {q.mode === "dlgReply" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {q.options.map((opt, i) => {
                  const dimmed = wrongPick.has(opt.id);
                  const isAns = phase === "reveal" && opt.id === q.word.id;
                  return (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexDirection: "row-reverse" }}>
                      <span style={{ fontSize: 24 }}>🐥</span>
                      <button onClick={() => pickOption(opt)} disabled={dimmed && phase === "play"} style={{
                        fontFamily: FONT, cursor: "pointer", flex: 1, textAlign: "left",
                        background: isAns ? "#eaffef" : "#fff4d6", opacity: dimmed && !isAns ? 0.35 : 1,
                        border: `3.5px solid ${isAns ? K.green : K.edge}`, borderBottomWidth: 6,
                        borderRadius: "16px 4px 16px 16px", padding: "10px 12px",
                        animation: isAns ? "popIn .4s ease" : "none",
                      }}>
                        <div style={{ fontFamily: MONO, fontWeight: 900, fontSize: 15.5 }}>{opt.emoji} {opt.en}</div>
                        <div style={{ fontSize: 11, color: K.sub }}>{opt.zh}</div>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); fx("tap"); speak(opt.en); }} style={{
                        fontSize: 15, background: "#fff", border: `2.5px solid ${K.edge}`, borderRadius: 999,
                        width: 34, height: 34, cursor: "pointer", flexShrink: 0,
                      }}>🔊</button>
                    </div>
                  );
                })}
              </div>
            )}
            {q.mode === "dlgReply" && phase === "reveal" && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, animation: "popIn .45s ease" }}>
                <span style={{ fontSize: 24 }}>🦉</span>
                <button onClick={() => { fx("tap"); speak(q.word.follow); }} style={{
                  fontFamily: FONT, cursor: "pointer", background: "#eef6ff", border: "none",
                  borderRadius: "4px 16px 16px 16px", padding: "8px 12px", textAlign: "left",
                }}>
                  <div style={{ fontFamily: MONO, fontWeight: 900, fontSize: 14.5 }}>{q.word.follow} <span style={{ fontSize: 12 }}>🔊</span></div>
                </button>
              </div>
            )}
            {q.mode !== "spell" && q.mode !== "teach" && q.mode !== "dlgReply" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {q.options.map((opt, i) => {
                  const isLetter = q.mode === "letter";
                  const kdKey = isLetter ? opt : opt.id;
                  const dimmed = wrongPick.has(kdKey);
                  const isAns = phase === "reveal" && (isLetter ? opt === q.word.en[0] : opt.id === q.word.id);
                  return (
                    <button key={i} onClick={() => pickOption(opt)} disabled={dimmed && phase === "play"} style={{
                      cursor: "pointer", borderRadius: 18, padding: "14px 6px",
                      border: `4px solid ${isAns ? K.green : K.edge}`, borderBottomWidth: 7,
                      background: isAns ? "#eaffef" : "#fff", opacity: dimmed && !isAns ? 0.35 : 1,
                      fontSize: isLetter ? 34 : q.mode === "pic2word" ? 22 : 44, fontWeight: 900,
                      fontFamily: q.mode === "pic2word" || isLetter ? MONO : FONT,
                      animation: isAns ? "popIn .4s ease" : "none",
                    }}>
                      {isLetter ? opt : q.mode === "pic2word" ? opt.en : opt.emoji}
                      {phase === "reveal" && !isLetter && q.mode !== "pic2word" && (
                        <div style={{ fontSize: 12, fontFamily: MONO, color: K.sub, fontWeight: 700 }}>{opt.en}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {q.mode === "spell" && phase === "play" && (
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                {q.tiles.map((ch, i) => (
                  <button key={i} onClick={() => pickTile(i, ch)} style={{
                    fontFamily: MONO, fontSize: 30, fontWeight: 900, cursor: "pointer",
                    width: 64, height: 64, borderRadius: 16,
                    border: `4px solid ${K.edge}`, borderBottomWidth: 7, background: "#fff",
                  }}>{ch}</button>
                ))}
              </div>
            )}
            {phase === "reveal" && (
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <div style={{ fontSize: 11.5, color: "#3b5a6b", fontWeight: 700, marginBottom: 8 }}>（點任何一張圖可以聽它的英文喔）</div>
                <Btn onClick={goNext} color={K.teal} edge={K.tealEdge} fg="#fff" style={{ fontSize: 17, padding: "13px 34px" }}>
                  {qNum + 1 >= QUIZ_N ? "🎁 看看今天的成果！" : "下一題 ▶"}
                </Btn>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <ParentNotes learner={learner} notes={notes} sessions={sessions} seeds={seeds} compact />
            </div>
          </div>
        )}

        {/* ===== 結算 ===== */}
        {phase === "done" && (
          <div>
            <Card style={{ textAlign: "center", animation: "popIn .5s ease" }}>
              <div style={{ fontSize: 50 }}>🎉🦉🎉</div>
              <div style={{ fontSize: 22, fontWeight: 900, margin: "4px 0" }}>挑戰完成！</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: K.sunEdge }}>拿到 {stars} 顆 ⭐</div>
              <div style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap", margin: "12px 0" }}>
                {[...new Set(sessionWords.map(s => s.id))].map(id => {
                  const ok = sessionWords.filter(s => s.id === id).some(s => s.ok);
                  return (
                    <div key={id} onClick={() => speak(ALL[id].en)} style={{
                      background: "#fff", border: `3px solid ${ok ? K.green : K.edge}`, borderRadius: 14,
                      padding: "6px 10px", cursor: "pointer",
                    }}>
                      <div style={{ fontSize: 26 }}>{ALL[id].emoji}</div>
                      <div style={{ fontSize: 11, fontFamily: MONO, fontWeight: 700, maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ALL[id].en}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: K.sub, marginBottom: 10 }}>（點單字卡可以再聽一次發音）</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <Btn onClick={() => { fx("tap"); setPhase("home"); }} color="#fff" edge={K.edge}>🏫 回學校</Btn>
                <Btn onClick={() => { fx("tap"); setPhase("book"); }} color={K.pink} edge="#c2588a" fg="#fff">📒 貼紙簿</Btn>
                <Btn onClick={() => { fx("tap"); startQuiz(island); }} color={K.teal} edge={K.tealEdge} fg="#fff">🔁 再挑戰一次</Btn>
              </div>
            </Card>
            <ParentNotes learner={learner} notes={notes} sessions={sessions} seeds={seeds} />
          </div>
        )}

        {/* ===== 貼紙簿 ===== */}
        {phase === "book" && (
          <div>
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 900, fontSize: 17 }}>📒 我的貼紙簿</div>
                <Btn onClick={() => { fx("tap"); setPhase("home"); }} color="#fff" edge={K.edge} style={{ padding: "7px 12px", fontSize: 13 }}>↩ 回學校</Btn>
              </div>
              <div style={{ fontWeight: 900, fontSize: 13.5, margin: "4px 0 6px", color: K.sub }}>🎁 集星星換到的（每 10 顆 ⭐ 一張）</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {stickers.length ? Object.entries(stickers.reduce((m, x) => { m[x] = (m[x] || 0) + 1; return m; }, {})).map(([e, n]) => (
                  <div key={e} style={{ position: "relative", fontSize: 34, background: "#fff", border: `3px solid ${K.sun}`, borderRadius: 14, padding: "6px 10px", animation: "popIn .4s ease" }}>
                    {e}
                    {n > 1 && <span style={{ position: "absolute", top: -8, right: -8, background: K.sunEdge, color: "#fff", borderRadius: 10, fontSize: 11, fontWeight: 900, padding: "1px 6px", border: "2px solid #fff" }}>×{n}</span>}
                  </div>
                )) : <div style={{ fontSize: 12.5, color: K.sub }}>還沒有——集滿 10 顆星星就有第一張！</div>}
              </div>
              <div style={{ fontWeight: 900, fontSize: 13.5, margin: "4px 0 6px", color: K.sub }}>💬 學會的對話（點亮的可以再聽）</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {DLGS.map(d => {
                  const m = learner.ws[d.id].s >= 0.7, half = learner.ws[d.id].s >= 0.35;
                  return (
                    <div key={d.id} onClick={() => m && speakSeq([d.prompt, d.en])} style={{
                      background: m ? "#fff" : "#ffffff77", borderRadius: 12, padding: "5px 9px",
                      border: `2.5px solid ${m ? K.green : half ? K.sun : "#ddd0b5"}`, cursor: m ? "pointer" : "default",
                      display: "flex", alignItems: "center", gap: 6,
                    }}>
                      <span style={{ fontSize: 20, filter: m ? "none" : "grayscale(1)", opacity: m ? 1 : 0.45 }}>{d.emoji}</span>
                      <span style={{ fontSize: 10.5, fontFamily: MONO, fontWeight: 700, color: m ? K.ink : "#b0a488" }}>{m || half ? d.prompt : "?"}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontWeight: 900, fontSize: 13.5, margin: "4px 0 6px", color: K.sub }}>🏅 學會的單字（答對很多次就會亮起來）</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 6 }}>
                {WORDS.map(w => {
                  const m = learner.ws[w.id].s >= 0.7, half = learner.ws[w.id].s >= 0.35;
                  return (
                    <div key={w.id} onClick={() => m && speak(w.en)} style={{
                      textAlign: "center", background: m ? "#fff" : "#ffffff77", borderRadius: 12,
                      border: `2.5px solid ${m ? K.green : half ? K.sun : "#ddd0b5"}`, padding: "5px 2px",
                      cursor: m ? "pointer" : "default",
                    }}>
                      <div style={{ fontSize: 24, filter: m ? "none" : "grayscale(1)", opacity: m ? 1 : 0.45 }}>{w.emoji}</div>
                      <div style={{ fontSize: 9.5, fontFamily: MONO, fontWeight: 700, color: m ? K.ink : "#b0a488" }}>{m ? w.en : half ? w.en : "?"}</div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- 家長／老師透視面板 ----------
function ParentNotes({ learner, notes, sessions, seeds, compact, onReset }) {
  const now = learner.q;
  const seen = ALL.filter(w => learner.ws[w.id].seen > 0 || learner.ws[w.id].s > 0);
  const weakest = seen.slice().sort((a, b) => retention(learner.ws[a.id], now) - retention(learner.ws[b.id], now)).slice(0, 6);
  return (
    <section style={{ background: "#ffffffd9", border: `2.5px dashed ${K.edge}`, borderRadius: 16, padding: "10px 12px", marginBottom: 12 }}>
      <details open={false}>
        <summary style={{ cursor: "pointer", fontWeight: 900, fontSize: 13, color: K.sub }}>
          🦉 蒙蒙老師的備課筆記（給爸媽看的 MCTS 透視）
        </summary>
        <div style={{ fontSize: 12.5, lineHeight: 1.8, marginTop: 8, color: K.ink }}>
          {notes && notes.chosen && (
            <div style={{ background: K.cream, borderRadius: 12, padding: "8px 10px", marginBottom: 8 }}>
              <b>{notes.kind === "lesson" ? "這一張為什麼教" : "這一題為什麼出"}「{ALL[notes.chosen.id].en}」？</b>
              <span style={{ background: TAGS[notes.chosen.tag].c, color: "#fff", borderRadius: 8, padding: "1px 8px", marginLeft: 6, fontSize: 11.5, fontWeight: 900 }}>
                {TAGS[notes.chosen.tag].t}
              </span>
              {notes.forced && <span style={{ background: K.purple, color: "#fff", borderRadius: 8, padding: "1px 8px", marginLeft: 4, fontSize: 11, fontWeight: 900 }}>💬 {notes.kind === "lesson" ? "本堂對話保底" : "本場聊天保底"}</span>}
              <div style={{ fontSize: 11.5, color: K.sub, marginTop: 4 }}>
                {notes.kind === "lesson"
                  ? `課程規劃師把「這堂剩下的教學＋之後一整場挑戰賽」模擬了 ${notes.total} 遍（${notes.ms?.toFixed(0)} ms）——教什麼，是看它對之後考試表現與興趣的影響。`
                  : `出題規劃師把「剩下的整場挑戰」模擬了 ${notes.total} 遍（${notes.ms?.toFixed(0)} ms），只從教過的內容裡挑。`}
                目前興趣電量估計 {notes.E?.toFixed(0)}%。
              </div>
              {notes.stats && notes.stats.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {notes.stats.map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <span style={{ fontFamily: MONO, fontSize: 11.5, width: 96, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ALL[s.id].en}</span>
                      <span style={{ fontSize: 10.5, color: TAGS[s.tag].c, width: 84, fontWeight: 900 }}>{TAGS[s.tag].t}</span>
                      <div style={{ flex: 1, height: 7, background: "#f0e6cf", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ width: `${clamp(s.val, 0, 1) * 100}%`, height: "100%", background: i === 0 ? K.purple : "#c9b8f5" }} />
                      </div>
                      <span style={{ fontFamily: MONO, fontSize: 10.5, color: K.sub, width: 62, textAlign: "right" }}>{s.visits} 局</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {!compact && (
            <>
              <div style={{ marginBottom: 6 }}>
                <b>記憶地圖</b>（強度低＝該複習了）：
                {seen.length === 0 ? <span style={{ color: K.sub }}>還沒開始，快出發吧！</span> : (
                  <div style={{ marginTop: 4 }}>
                    {weakest.map(w => (
                      <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 16 }}>{w.emoji}</span>
                        <span style={{ fontFamily: MONO, fontSize: 11.5, width: 80 }}>{w.en}</span>
                        <div style={{ flex: 1, height: 7, background: "#f0e6cf", borderRadius: 99, overflow: "hidden" }}>
                          <div style={{ width: `${learner.ws[w.id].s * 100}%`, height: "100%", background: learner.ws[w.id].s > 0.6 ? K.green : learner.ws[w.id].s > 0.3 ? K.sun : K.red }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: K.sub }}>
                <b>老實說明</b>：這個版本把「教」與「考」拆成兩個空間、兩位 MCTS 規劃師——課程規劃師選「教什麼」時，rollout 會一路模擬到之後的挑戰賽；出題規劃師只考教過的、挑答對率約七成的甜蜜點複習。我們用 30 位「參數刻意不同的合成孩子」重測：<b>拆開這個結構本身就是最大功臣</b>——不論課程用 MCTS、隨機或由易到難安排，真正學會的內容都到 5.7~6.0 個、挫折 0（混合式的冒險島同量互動約 3.3 個）；MCTS 規劃師在此之上再加約 2~5% 綜合分。模擬器仍是遺忘曲線＋測驗效應＋興趣電量的近似模型，每答一題校正一次。已上課 {seeds} 堂、挑戰 {sessions} 場；進度自動儲存</div>
              {onReset && (
                <button onClick={onReset} style={{ marginTop: 8, fontFamily: FONT, fontSize: 11.5, fontWeight: 900, color: K.sub, background: "none", border: `2px solid ${K.edge}`, borderRadius: 10, padding: "4px 10px", cursor: "pointer" }}>
                  ⚠ 清除全部進度（重新認識孩子）
                </button>
              )}
            </>
          )}
        </div>
      </details>
    </section>
  );
}
