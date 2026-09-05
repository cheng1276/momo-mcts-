import { useState, useRef, useEffect } from "react";

/* ============================================================
   蒙蒙英語會話教室 — 一輪對話・逐字學・照樣造句・挑戰賽（6 歲）
   ・36 組一輪對話（蒙蒙一句 → 你一句），八大主題
   ・📚 會話教室：每堂 2 組對話 ＝ 聽對話 → 逐字學單字 → 照樣造句
   ・🏆 會話挑戰：只考教過的，五種題型——聽答／找單字／開口說／
     造句填空／排排站；出題規劃師用 MCTS 做間隔提取
   ・語音 Promise 化：說完才換卡、下一題會等蒙蒙講完
   ============================================================ */

const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const K = {
  sky: "#8fd3c7", skyDeep: "#3f9d8d", cream: "#fff8e9", edge: "#e0bd7a",
  ink: "#4a3524", sub: "#8a7154",
  red: "#e5484d", green: "#3cb96a", greenD: "#2a8a4d", sun: "#ffb84d", sunEdge: "#d98a1f",
  purple: "#8e6cf0", purpleD: "#6a4bd0", teal: "#2bbfa3", tealEdge: "#1d8f7a", pink: "#f47fb2",
  owl: "#eef6ff", chick: "#fff4d6",
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = Math.random;
const ri = n => Math.floor(rnd() * n);
const pick = a => a[ri(a.length)];
const shuffled = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = ri(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// ---------- 會話庫：36 組一輪對話 ----------
const THEMES = { greet: "打招呼", polite: "有禮貌", school: "學校", world: "認識世界", food: "吃吃喝喝", play: "一起玩", home: "家", feel: "心情" };
// 照樣造句樣板：tpl 的 {} 是可替換的位置；subs = 替換詞 [en, zh, emoji?]
const P = (tpl, zhTpl, subs) => ({ tpl, zhTpl, subs: subs.map(([en, zh, emoji]) => ({ en, zh, emoji: emoji || "" })) });
// [theme, icon, diff, prompt, promptZh, reply, replyZh, pattern|null]
const DLG_RAW = [
  ["greet", "🙋", 1, "Hello!", "哈囉！", "Hi!", "嗨！", null],
  ["greet", "🌞", 1, "Good morning!", "早安！", "Good morning!", "早安！", P("Good {}!", "{}！", [["afternoon", "午安", "🌤️"], ["evening", "晚上好", "🌆"], ["night", "晚安", "🌙"]])],
  ["greet", "😊", 2, "How are you?", "你好嗎？", "I'm fine, thank you!", "我很好，謝謝！", P("I'm {}, thank you!", "我{}，謝謝！", [["good", "很好", "👍"], ["great", "超棒", "🌟"], ["OK", "還可以", "🙂"]])],
  ["greet", "🐥", 2, "What's your name?", "你叫什麼名字？", "My name is Kiki.", "我叫奇奇。", P("My name is {}.", "我叫{}。", [["Momo", "蒙蒙", "🦉"], ["Amy", "艾咪", "👧"], ["Ben", "小班", "👦"]])],
  ["greet", "👋", 1, "Bye-bye!", "掰掰！", "See you!", "再見！", P("See you {}!", "{}見！", [["tomorrow", "明天", "📅"], ["later", "待會", "⏳"], ["soon", "回頭", "🔜"]])],
  ["greet", "🌈", 2, "Have a nice day!", "祝你有美好的一天！", "You too!", "你也是！", null],
  ["greet", "🎂", 2, "How old are you?", "你幾歲？", "I'm six years old!", "我六歲！", P("I'm {} years old!", "我{}歲！", [["five", "五", "5️⃣"], ["seven", "七", "7️⃣"], ["eight", "八", "8️⃣"]])],
  ["greet", "🌤️", 2, "Good afternoon!", "午安！", "Good afternoon, Mr. Momo!", "午安，蒙蒙老師！", P("Good afternoon, {}!", "{}午安！", [["Mom", "媽媽", "👩"], ["Dad", "爸爸", "👨"], ["Ms. Amy", "艾咪老師", "👩‍🏫"]])],
  ["polite", "🎁", 2, "Thank you!", "謝謝你！", "You're welcome!", "不客氣！", null],
  ["polite", "🤝", 2, "I'm sorry.", "對不起。", "It's OK!", "沒關係！", null],
  ["polite", "🛎️", 2, "May I come in?", "我可以進來嗎？", "Sure! Come on in!", "當然，快進來！", null],
  ["polite", "🙇", 2, "Excuse me!", "不好意思！", "Yes? Can I help you?", "嗯？需要幫忙嗎？", null],
  ["school", "🛟", 2, "Can you help me?", "你可以幫我嗎？", "Sure! No problem!", "當然，沒問題！", null],
  ["school", "🔎", 3, "Where is my pencil?", "我的鉛筆在哪裡？", "It's in your bag!", "在你的書包裡！", P("It's in your {}!", "在你的{}裡！", [["box", "盒子", "📦"], ["desk", "桌子", "🪑"], ["hand", "手", "✋"]])],
  ["school", "🔔", 2, "Class is over. Line up!", "下課了，排隊！", "OK, Mr. Momo!", "好的，蒙蒙老師！", null],
  ["school", "🚻", 2, "Yes, Kiki?", "奇奇，怎麼了？", "May I go to the bathroom, please?", "我可以去上廁所嗎？", P("May I {}, please?", "我可以{}嗎？", [["drink water", "喝水", "💧"], ["go out", "出去", "🚪"], ["sit here", "坐這裡", "🪑"]])],
  ["school", "🧍", 1, "Stand up, please.", "請站起來。", "OK!", "好！", null],
  ["school", "🪑", 1, "Sit down, please.", "請坐下。", "Yes, Mr. Momo!", "好的，蒙蒙老師！", null],
  ["school", "🆘", 3, "What's the matter?", "怎麼了嗎？", "I can't open it. Help me, please!", "我打不開，請幫幫我！", P("I can't {}. Help me, please!", "我{}，請幫幫我！", [["find it", "找不到它", "🔍"], ["reach it", "搆不到它", "🙆"], ["do it", "做不到", "😣"]])],
  ["world", "❓", 2, "What's this?", "這是什麼？", "It's an apple!", "是蘋果！", P("It's {}!", "是{}！", [["a banana", "香蕉", "🍌"], ["a cat", "貓", "🐱"], ["a book", "書", "📖"]])],
  ["world", "🖌️", 2, "What color is it?", "這是什麼顏色？", "It's red!", "是紅色！", P("It's {}!", "是{}！", [["blue", "藍色", "🔵"], ["green", "綠色", "🟢"], ["yellow", "黃色", "🟡"]])],
  ["world", "🔢", 3, "How many apples do you see?", "你看到幾顆蘋果？", "I see three apples!", "我看到三顆蘋果！", P("I see {} apples!", "我看到{}蘋果！", [["two", "兩顆", "2️⃣"], ["four", "四顆", "4️⃣"], ["five", "五顆", "5️⃣"]])],
  ["world", "⛅", 2, "How's the weather today?", "今天天氣怎麼樣？", "It's sunny!", "是晴天！", P("It's {}!", "{}！", [["rainy", "在下雨", "🌧️"], ["cloudy", "多雲", "☁️"], ["windy", "颳風", "🌬️"]])],
  ["world", "🏷️", 2, "Is this your bag?", "這是你的書包嗎？", "Yes, it is!", "對，是我的！", null],
  ["food", "🧁", 2, "Are you hungry?", "你餓了嗎？", "Yes! I want cake!", "餓了！我想吃蛋糕！", P("Yes! I want {}!", "要！我想吃{}！", [["pizza", "披薩", "🍕"], ["cookies", "餅乾", "🍪"], ["ice cream", "冰淇淋", "🍨"]])],
  ["food", "🍰", 2, "Here's your cake.", "你的蛋糕來囉。", "Thank you! It's yummy!", "謝謝！好好吃！", null],
  ["food", "🍏", 2, "Do you like apples?", "你喜歡蘋果嗎？", "Yes, I do!", "喜歡！", null],
  ["food", "🧋", 2, "What do you want to drink?", "你想喝什麼？", "Milk, please!", "牛奶，麻煩你！", P("{}, please!", "請給我{}！", [["Juice", "果汁", "🧃"], ["Water", "水", "💧"], ["Tea", "茶", "🍵"]])],
  ["play", "🛝", 1, "Let's play!", "一起玩吧！", "OK! Let's go!", "好，走吧！", null],
  ["play", "🎮", 2, "Can I play with you?", "我可以跟你一起玩嗎？", "Sure! Let's play together!", "當然！一起玩吧！", null],
  ["play", "🎲", 2, "It's your turn now.", "換你囉。", "OK! Watch me!", "好！看我的！", null],
  ["home", "⏰", 2, "Wake up, Kiki!", "奇奇，起床囉！", "Good morning, Mom!", "媽媽早安！", P("Good morning, {}!", "{}早安！", [["Dad", "爸爸", "👨"], ["Grandma", "奶奶", "👵"], ["Grandpa", "爺爺", "👴"]])],
  ["home", "🎒", 2, "Time for school!", "該上學囉！", "OK, Mom! Let's go!", "好的媽媽，出發！", null],
  ["home", "🌛", 2, "Time for bed.", "該睡覺囉。", "Good night! Sweet dreams!", "晚安，好夢！", null],
  ["feel", "🤗", 2, "What's wrong?", "怎麼了？", "I'm sad.", "我難過。", P("I'm {}.", "我{}。", [["happy", "很開心", "😄"], ["tired", "好累", "🥱"], ["scared", "害怕", "😨"]])],
  ["feel", "💞", 2, "Don't be sad. I'm here!", "別難過，有我在！", "Thank you, Momo!", "謝謝你，蒙蒙！", null],
];
// 逐字詞義（給 6 歲看的簡短中文）
const GLOSS = {
  hello: "哈囉", hi: "嗨", what: "什麼", good: "好的", morning: "早上", how: "怎麼樣", are: "是", you: "你", "i'm": "我是",
  fine: "很好", thank: "感謝", "what's": "什麼是", your: "你的", name: "名字", my: "我的", is: "是", kiki: "奇奇",
  "bye-bye": "掰掰", see: "見到", have: "擁有", a: "一個", nice: "美好的", day: "一天", too: "也", old: "歲",
  six: "六", years: "年", afternoon: "下午", mr: "先生", momo: "蒙蒙", "you're": "你是", welcome: "歡迎",
  sorry: "抱歉", "it's": "它是", ok: "好", may: "可以嗎", i: "我", come: "來", in: "進來", sure: "當然",
  on: "上", excuse: "原諒", me: "我", yes: "是的", can: "可以", help: "幫忙", no: "沒有", problem: "問題",
  where: "哪裡", pencil: "鉛筆", bag: "書包", class: "課", over: "結束", line: "排隊", up: "起來", go: "去",
  to: "到", the: "這個", bathroom: "廁所", please: "請", stand: "站", sit: "坐", down: "下", matter: "事情",
  "can't": "不能", open: "打開", it: "它", this: "這個", an: "一個", apple: "蘋果", color: "顏色", red: "紅色",
  many: "多少", apples: "蘋果", do: "做", three: "三", "how's": "怎麼樣", weather: "天氣", today: "今天",
  sunny: "晴朗的", hungry: "肚子餓", want: "想要", cake: "蛋糕", "here's": "這是", yummy: "好吃", like: "喜歡",
  drink: "喝", milk: "牛奶", "let's": "我們來", play: "玩", with: "和", together: "一起", turn: "輪到",
  now: "現在", watch: "看", wake: "醒來", mom: "媽媽", time: "時間", for: "為了", school: "學校", bed: "床",
  night: "晚上", sweet: "甜的", dreams: "夢", wrong: "不對勁", sad: "難過", "don't": "不要", be: "變得", here: "這裡",
};
const tok = str => str.split(/\s+/).map(w => w.replace(/[!?.,]/g, "")).filter(Boolean)
  .map(w => ({ t: w, k: w.toLowerCase(), g: GLOSS[w.toLowerCase()] || "" }));
const DLGS = DLG_RAW.map(([theme, icon, diff, prompt, promptZh, en, zh, pattern], id) => ({
  id, kind: "dlg", theme, icon, emoji: icon, diff, prompt, promptZh, en, zh, pattern, cat: theme,
  ptoks: tok(prompt), rtoks: tok(en),
}));
const ALL = DLGS;
const ISLANDS = [{ id: "all", name: "全部主題", icon: "🧭", cats: null }, ...Object.entries(THEMES).map(([k, v]) => ({ id: k, name: v, icon: DLGS.find(d => d.theme === k).icon, cats: [k] }))];
const FUN_STICKERS = ["🦄", "🚀", "🍭", "🏆", "🎠", "⛲", "🛷", "🛸", "🦖", "👑", "🎪", "🐬", "🦋", "🐢", "🐙", "🦕", "🍩", "🦩", "🥨", "🍿", "🎡", "🎯", "🎳", "🛼", "🛴", "🚁", "⛵", "🪐", "🌠", "🔮", "🎻", "🥁", "🎺", "🏯", "🧿", "🪅", "🛖", "🗿", "🏓", "🪄"];
function awardSticker(stk) {
  const remain = FUN_STICKERS.filter(x => !stk.includes(x));
  return remain.length ? pick(remain) : pick(FUN_STICKERS);
}
const TEACH_N = 2;
const QUIZ_N = 10;
const MODE_LABEL = { dlgReply: "聽答", wordFind: "找單字", dlgSay: "開口說", build: "造句填空", order: "排排站", teach: "教學" };

// ---------- 記憶模型（遺忘曲線＋測驗效應＋間隔＋興趣電量：誠實的近似）----------
function freshLearner() {
  return { ws: ALL.map(() => ({ s: 0, last: -9, seen: 0 })), E: 70, q: 0, wrongStreak: 0, tc: 0 };
}
const MODE_EASE = { teach: 1, dlgReply: 0.95, wordFind: 0.9, dlgSay: 0.78, build: 0.8, order: 0.72 };
const canOrder = item => item.rtoks.length >= 2 && item.rtoks.length <= 5;
function stageMode(w, item) {          // 挑戰專用：只會拿到教過的內容
  if (w.s < 0.38) return "dlgReply";
  if (w.s < 0.55) return "wordFind";
  if (w.s < 0.7) return "dlgSay";
  if (w.s < 0.85) return item.pattern ? "build" : canOrder(item) ? "order" : "dlgSay";
  return canOrder(item) ? "order" : item.pattern ? "build" : "dlgSay";
}
function retention(w, now) {
  if (w.seen === 0) return 0.12;
  const gap = Math.max(0, now - w.last);
  const base = w.s * Math.pow(0.945, gap * (1 - 0.55 * w.s));
  const shortTerm = gap <= 2 ? (0.8 - 0.32 * gap) * (1 - base) : 0;
  return Math.min(0.97, base + shortTerm);
}
function predictP(w, item, now, E, mode) {
  if (mode === "teach") return 0.98;
  const R = retention(w, now);
  const eF = 0.75 + 0.25 * (E / 100);
  const dF = 1 - 0.08 * (item.diff - 1);
  return clamp(0.25 + 0.75 * R * MODE_EASE[mode] * eF * dF, 0.08, 0.97);
}
function applyAnswer(st, wi, correct, pWas, mode = "quiz") {
  const w = st.ws[wi];
  const gap = Math.max(1, st.q - w.last);
  if (mode === "teach") {
    w.s = clamp(w.s + (1 - w.s) * 0.2, 0, 1);   // 完整三步教學：熟悉度多一點
    st.tc = (st.tc || 0) + 1;
    st.E = clamp(st.E + (st.tc <= 3 ? 5 : st.tc <= 6 ? 1 : -3), 0, 100);
    st.wrongStreak = 0;
  } else if (correct) {
    const spacing = 1 + Math.min(1.3, gap / 6);
    w.s = clamp(w.s + (1 - w.s) * 0.36 * spacing, 0, 1);
    st.E = clamp(st.E + (w.seen === 1 ? 5 : pWas > 0.85 ? 1 : 3) + 1, 0, 100);
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
function applyTeach(st, id) { applyAnswer(st, id, true, 0.98, "teach"); }
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
function candidatesQuiz(st, poolIds) {
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
  const dedup = [], has = new Set();
  for (const c of out) if (!has.has(c.id)) { has.add(c.id); dedup.push(c); }
  return dedup.length ? dedup : seen.slice(0, 1).map(id => ({ id, tag: "review" }));
}
function candidatesTeach(st, poolIds) {
  const unseen = poolIds.filter(id => st.ws[id].seen === 0).sort((a, b) => (ALL[a].diff - ALL[b].diff) || (a - b));
  const out = unseen.slice(0, 5).map(id => ({ id, tag: "new" }));
  const struggling = poolIds.filter(id => st.ws[id].seen >= 2 && st.ws[id].s < 0.3).sort((a, b) => st.ws[a].s - st.ws[b].s).slice(0, 2);
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
    const c = rnd() < 0.6 ? cands[0] : pick(cands);
    const item = ALL[c.id], mode = stageMode(st.ws[c.id], item);
    const p = predictP(st.ws[c.id], item, st.q, st.E, mode);
    applyAnswer(st, c.id, rnd() < p, p, mode);
  }
  return sessionValue(st, poolIds);
}
function mctsTree(st0, poolIds, iters, candsFn, stepFn, maxDepth, leafFn) {
  const rootCands = candsFn(st0);
  if (!rootCands.length) return null;
  if (rootCands.length === 1) return { pick: rootCands[0], stats: [], total: 0, ms: 0 };
  const t0 = performance.now();
  const root = { kids: new Map(), visits: 0, val: 0 };
  for (let it = 0; it < iters; it++) {
    let st = cloneL(st0);
    let node = root;
    const path = [root];
    let depth = 0;
    while (depth < maxDepth(st)) {
      const cands = candsFn(st);
      if (!cands.length) break;
      const keys = cands.map(c => `${c.id}`);
      const un = [];
      for (let i = 0; i < keys.length; i++) if (!node.kids.has(keys[i])) un.push(i);
      if (un.length) {
        const ci = un[ri(un.length)];
        const child = { kids: new Map(), visits: 0, val: 0 };
        node.kids.set(keys[ci], child);
        stepFn(st, cands[ci]);
        path.push(child); depth++;
        break;
      }
      let bi = 0, bn = null, bv = -Infinity;
      const lnN = Math.log(node.visits + 1);
      for (let i = 0; i < keys.length; i++) {
        const kd = node.kids.get(keys[i]);
        const u = kd.val / kd.visits + 0.8 * Math.sqrt(lnN / kd.visits);
        if (u > bv) { bv = u; bi = i; bn = kd; }
      }
      stepFn(st, cands[bi]);
      path.push(bn); node = bn; depth++;
    }
    const v = leafFn(st, depth);
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
// 出題規劃師（挑戰）：截斷視野 4 層 + 短 rollout
function teacherDecide(st0, poolIds, total, iters) {
  return mctsTree(st0, poolIds, iters, st => (st.q < total ? candidatesQuiz(st, poolIds) : []),
    (st, c) => { const item = ALL[c.id], mode = stageMode(st.ws[c.id], item); const p = predictP(st.ws[c.id], item, st.q, st.E, mode); applyAnswer(st, c.id, rnd() < p, p, mode); },
    () => 4, st => rolloutQuiz(st, poolIds, total)) || { pick: null, stats: [], total: 0, ms: 0 };
}
// 課程規劃師（教室）：樹深＝剩餘教學格，葉節點補完教學＋整場挑戰賽
function decideLesson(st0, poolIds, slotsLeft, iters) {
  return mctsTree(st0, poolIds, iters, st => candidatesTeach(st, poolIds),
    (st, c) => applyTeach(st, c.id), () => slotsLeft,
    (st, depth) => {
      for (let k = depth; k < slotsLeft; k++) { const cands = candidatesTeach(st, poolIds); if (!cands.length) break; applyTeach(st, (rnd() < 0.6 ? cands[0] : pick(cands)).id); }
      st.q += 2;
      return rolloutQuiz(st, poolIds, st.q + QUIZ_N);
    });
}

// ---------- 出題器 ----------
function buildQuestion(st, id) {
  const item = ALL[id];
  const mode = stageMode(st.ws[id], item);
  if (mode === "dlgReply" || mode === "dlgSay") {
    const same = DLGS.filter(x => x.id !== id && x.theme === item.theme);
    const others = shuffled(DLGS.filter(x => x.id !== id));
    const pool = same.length >= 2 && rnd() < 0.5 ? shuffled(same).slice(0, 2) : others.slice(0, 2);
    return { item, mode, options: shuffled([item, ...pool]) };
  }
  if (mode === "wordFind") {
    const cands = item.rtoks.filter(t => t.g && t.k.length > 1);
    const target = pick(cands.length ? cands : item.rtoks);
    return { item, mode, target, chips: item.rtoks };
  }
  if (mode === "build") {
    const pat = item.pattern;
    const sub = pick(pat.subs);
    const distract = shuffled(pat.subs.filter(x => x.en !== sub.en)).slice(0, 2);
    return { item, mode, sub, sentence: pat.tpl.replace("{}", sub.en), sentenceZh: pat.zhTpl.replace("{}", sub.zh), options: shuffled([sub, ...distract]) };
  }
  return { item, mode, tiles: shuffled(item.rtoks.map((t, i) => ({ ...t, i }))) };   // order
}

// ---------- TTS：Promise 化，說完才 resolve ----------
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
const hasTTS = () => { try { return !!window.speechSynthesis; } catch (e) { return false; } };
let ttsToken = 0, speakingCb = null, curCancel = null;
function setSpeakingCb(fn) { speakingCb = fn; }
function notifySpeak(on) { try { if (speakingCb) speakingCb(on); } catch (e) { /* noop */ } }
const estMs = t => 420 + t.length * 95;
function speakSeqAsync(parts, rate = 0.8) {
  const my = ++ttsToken;
  if (curCancel) { const c = curCancel; curCancel = null; c(); }
  return new Promise(resolve => {
    let settled = false;
    const settle = own => {
      if (settled) return;
      settled = true;
      if (own && my === ttsToken) notifySpeak(false);
      if (curCancel === cancelMe) curCancel = null;
      resolve();
    };
    const cancelMe = () => settle(false);
    curCancel = cancelMe;
    const finish = () => settle(true);
    try {
      if (!hasTTS()) { notifySpeak(true); setTimeout(finish, Math.min(1500, 300 + parts.join(" ").length * 40)); return; }
      window.speechSynthesis.cancel();
      notifySpeak(true);
      let i = 0, guard = null;
      const next = () => {
        if (my !== ttsToken) { settle(false); return; }
        if (i >= parts.length) { finish(); return; }
        const text = parts[i++];
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US"; u.rate = rate; u.pitch = 1.05;
        if (voiceEn) u.voice = voiceEn;
        let done = false;
        const step = () => { if (done) return; done = true; clearTimeout(guard); setTimeout(next, 330); };
        u.onend = step; u.onerror = step;
        guard = setTimeout(step, estMs(text) + 1800);
        window.speechSynthesis.speak(u);
      };
      next();
    } catch (e) { finish(); }
  });
}
const speakAsync = (t, rate = 0.8) => speakSeqAsync([t], rate);
function speak(text, rate = 0.8) { speakAsync(text, rate); }
function speakSeq(parts, rate = 0.8) { speakSeqAsync(parts, rate); }

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

// ---------- 儲存 ----------
const SAVE_KEY = "momo-talk-v1";
async function loadSave() {
  try { const r = await window.storage.get(SAVE_KEY); if (r && r.value) return JSON.parse(r.value); } catch (e) { /* 沒存過 */ }
  return null;
}
async function persist(data) { try { await window.storage.set(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* noop */ } }

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
    <section style={{ background: K.cream, border: `3px solid ${K.edge}`, borderRadius: 20, padding: "14px 14px 16px", marginBottom: 12, ...style }}>{children}</section>
  );
}
function Bubble({ who, en, zh, onClick, tail, small }) {
  const owl = who === "owl";
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexDirection: owl ? "row" : "row-reverse", marginTop: 6 }}>
      <span style={{ fontSize: small ? 20 : 24 }}>{owl ? "🦉" : "🐥"}</span>
      <button onClick={onClick} style={{
        fontFamily: FONT, cursor: onClick ? "pointer" : "default", background: owl ? K.owl : K.chick, border: "none", textAlign: "left",
        borderRadius: owl ? "4px 16px 16px 16px" : "16px 4px 16px 16px", padding: small ? "6px 10px" : "8px 12px",
      }}>
        <div style={{ fontFamily: MONO, fontWeight: 900, fontSize: small ? 14 : 16 }}>{en} {tail && <span style={{ fontSize: 12 }}>{tail}</span>}</div>
        {zh && <div style={{ fontSize: 11.5, color: K.sub }}>{zh}</div>}
      </button>
    </div>
  );
}
const TAGS = { review: { t: "複習快忘記的", c: K.teal }, new: { t: "教新對話", c: K.sun }, confidence: { t: "補一題信心", c: K.pink }, reteach: { t: "回爐再教", c: K.purple } };

// ---------- 主元件 ----------
export default function App() {
  const [phase, setPhase] = useState("home");   // home | lesson | lessonDone | play | reveal | done | book
  const [island, setIsland] = useState("all");
  const [learner, setLearner] = useState(freshLearner);
  const [poolIds, setPoolIds] = useState(ALL.map(w => w.id));
  const [q, setQ] = useState(null);
  const [qNum, setQNum] = useState(0);
  const [firstTry, setFirstTry] = useState(true);
  const [wrongPick, setWrongPick] = useState(new Set());
  const [orderDone, setOrderDone] = useState([]);       // 排排站：已排好的 token 索引
  const [buildPick, setBuildPick] = useState(null);      // 造句：已選的替換詞
  const [stars, setStars] = useState(0);
  const [quizLen, setQuizLen] = useState(QUIZ_N);
  const [totalStars, setTotalStars] = useState(0);
  const [seeds, setSeeds] = useState(0);
  const [stickers, setStickers] = useState([]);
  const [sessionWords, setSessionWords] = useState([]);
  const [notes, setNotes] = useState(null);
  const [confetti, setConfetti] = useState(false);
  const [sfxOn, setSfxOn] = useState(true);
  const [sessions, setSessions] = useState(0);
  const [newSticker, setNewSticker] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  // 教室狀態
  const [lessonItem, setLessonItem] = useState(null);   // {item, tag}
  const [lessonIdx, setLessonIdx] = useState(0);
  const [stage, setStage] = useState("dlg");            // dlg | words | pattern
  const [wordIdx, setWordIdx] = useState(0);
  const [wordList, setWordList] = useState([]);
  const [patDone, setPatDone] = useState([]);           // 已造過的替換詞 en
  const [patFilled, setPatFilled] = useState(null);
  const [lessonList, setLessonList] = useState([]);
  const learnerRef = useRef(learner); learnerRef.current = learner;
  const sfxRef = useRef(true); sfxRef.current = sfxOn;
  const busy = useRef(false);
  const busyTeach = useRef(false);

  const fx = n => { if (sfxRef.current) { try { SFX[n](); } catch (e) { /* noop */ } } };

  useEffect(() => { setSpeakingCb(setIsSpeaking); return () => setSpeakingCb(null); }, []);
  useEffect(() => {
    initVoices();
    (async () => {
      const sv = await loadSave();
      if (sv) {
        const fresh = freshLearner();
        const days = Math.max(0, (Date.now() - (sv.t || Date.now())) / 86400000);
        const decay = Math.pow(0.93, days);
        const map = sv.it || {};
        ALL.forEach((item, i) => { const v = map[`d:${item.en}`]; if (v > 0) { fresh.ws[i].s = clamp(v * decay, 0, 1); fresh.ws[i].seen = 1; fresh.ws[i].last = -3; } });
        setLearner(fresh);
        setTotalStars(sv.stars || 0); setStickers(sv.stickers || []); setSessions(sv.sessions || 0); setSeeds(sv.seeds || 0);
      }
    })();
  }, []);
  async function saveAll(st, tStars, stk, ses, sd) {
    const it = {};
    ALL.forEach((item, i) => { if (st.ws[i].s > 0.02) it[`d:${item.en}`] = st.ws[i].s; });
    await persist({ it, stars: tStars, stickers: stk, sessions: ses, seeds: sd, t: Date.now() });
  }
  const mastered = ALL.filter(w => learner.ws[w.id].s >= 0.7);
  const poolOf = islId => { const isl = ISLANDS.find(i => i.id === islId); return ALL.filter(w => !isl.cats || isl.cats.includes(w.theme)).map(w => w.id); };
  function freshSessionState() {
    const st = cloneL(learnerRef.current);
    if (st.q > 0) st.q += 2;
    st.wrongStreak = 0; st.tc = 0; st.E = clamp(st.E * 0.3 + 55, 40, 90);
    setLearner(st); learnerRef.current = st;
    return st;
  }

  // ===== 教室 =====
  function startLesson(islId) {
    const ids = poolOf(islId);
    const st = freshSessionState();
    setPoolIds(ids); setIsland(islId);
    setLessonIdx(0); setLessonList([]);
    setPhase("lesson");
    nextLessonItem(st, ids, 0, []);
  }
  function nextLessonItem(st, ids, idx, list) {
    if (busy.current) return;
    busy.current = true;
    setTimeout(() => {
      const dec = decideLesson(st, ids, TEACH_N - idx, 400);
      busy.current = false;
      if (!dec) { finishLesson(list.length > 0, list); return; }
      const item = ALL[dec.pick.id];
      setLessonItem({ item, tag: dec.pick.tag });
      setNotes({ ...dec, chosen: dec.pick, kind: "lesson", mode: "teach", E: st.E });
      setLessonIdx(idx);
      setStage("dlg");
      const seenK = new Set();
      const wl = [...item.ptoks, ...item.rtoks].filter(t => { if (seenK.has(t.k)) return false; seenK.add(t.k); return true; });
      setWordList(wl); setWordIdx(0); setPatDone([]); setPatFilled(null);
      setTimeout(() => speakSeq([item.prompt, item.en]), 350);
    }, 30);
  }
  async function tapDialogCard() {
    if (busyTeach.current || !lessonItem) return;
    busyTeach.current = true; fx("tap");
    await speakSeqAsync([lessonItem.item.prompt, lessonItem.item.en]);
    await sleep(350);
    busyTeach.current = false;
    setStage("words");
    setTimeout(() => speak(wordList[0]?.t || lessonItem.item.en), 250);
  }
  async function tapWordCard() {
    if (busyTeach.current) return;
    busyTeach.current = true; fx("tap");
    const w = wordList[wordIdx];
    await speakAsync(w.t, 0.75);
    await sleep(250);
    busyTeach.current = false;
    if (wordIdx + 1 < wordList.length) {
      setWordIdx(wordIdx + 1);
      setTimeout(() => speak(wordList[wordIdx + 1].t, 0.75), 250);
    } else if (lessonItem.item.pattern) {
      setStage("pattern");
      setTimeout(() => speak(lessonItem.item.en), 300);
    } else finishTeachItem();
  }
  async function tapPatternSub(sub) {
    if (busyTeach.current || patDone.includes(sub.en)) return;
    busyTeach.current = true; fx("tap");
    const sentence = lessonItem.item.pattern.tpl.replace("{}", sub.en);
    setPatFilled({ sub, sentence });
    await speakAsync(sentence);
    busyTeach.current = false;
    setPatDone(d => [...d, sub.en]);
  }
  function finishTeachItem() {
    const st = cloneL(learnerRef.current);
    const item = lessonItem.item;
    applyTeach(st, item.id);
    setLearner(st); learnerRef.current = st;
    const nl = [...lessonList, { id: item.id, tag: lessonItem.tag }];
    setLessonList(nl);
    fx("good");
    saveAll(st, totalStars, stickers, sessions, seeds);
    const idx = lessonIdx + 1;
    if (idx >= TEACH_N) finishLesson(true, nl);
    else nextLessonItem(st, poolIds, idx, nl);
  }
  function finishLesson(gotSeed, list) {
    fx(gotSeed ? "fanfare" : "tap");
    const sd = gotSeed ? seeds + 1 : seeds;
    setSeeds(sd);
    setLessonList(list);
    saveAll(learnerRef.current, totalStars, stickers, sessions, sd);
    setLessonItem(null);
    setPhase("lessonDone");
  }

  // ===== 挑戰 =====
  const quizLenFor = taught => (taught < 3 ? 6 : taught < 5 ? 8 : QUIZ_N);   // 題數隨教過的數量調整
  function startQuiz(islId) {
    const ids = poolOf(islId);
    const taught = ids.filter(id => learnerRef.current.ws[id].seen > 0 || learnerRef.current.ws[id].s > 0.02).length;
    if (taught < 1) { setPhase("home"); return; }     // 沒教過任何對話：回門口（門口的挑戰門會顯示鎖住原因）
    const len = quizLenFor(taught);
    setQuizLen(len);
    const st = freshSessionState();
    setPoolIds(ids); setIsland(islId);
    setQNum(0); setStars(0); setSessionWords([]);
    setPhase("play");
    nextQuestion(st, ids, 0, len);
  }
  function nextQuestion(st, ids, num, len = quizLen) {
    if (busy.current) return;
    busy.current = true;
    setTimeout(() => {
      const dec = teacherDecide(st, ids, st.q + (len - num), 700);
      busy.current = false;
      if (!dec.pick) { setPhase("home"); return; }
      const qq = buildQuestion(st, dec.pick.id);
      setNotes({ ...dec, chosen: dec.pick, kind: "quiz", mode: qq.mode, E: st.E });
      setQ(qq); setFirstTry(true); setWrongPick(new Set()); setOrderDone([]); setBuildPick(null);
      setQNum(num);
      if (qq.mode === "dlgReply") setTimeout(() => speak(qq.item.prompt), 350);
      else if (qq.mode === "wordFind") setTimeout(() => speak(qq.target.t, 0.75), 350);
      else if (qq.mode === "order") setTimeout(() => speak(qq.item.en), 350);
    }, 30);
  }
  function finishAnswer(correct) {
    const st = cloneL(learnerRef.current);
    const item = q.item;
    const p = predictP(st.ws[item.id], item, st.q, st.E, q.mode);
    applyAnswer(st, item.id, correct && firstTry, p, q.mode);
    setLearner(st); learnerRef.current = st;
    setSessionWords(sw => [...sw, { id: item.id, ok: correct && firstTry }]);
    let tS = totalStars, stk = stickers.slice(), popped = null;
    if (correct && firstTry) {
      setStars(s => s + 1); tS = totalStars + 1; setTotalStars(tS);
      if (tS % 10 === 0) { popped = awardSticker(stk); stk.push(popped); setStickers(stk); }
      fx("good"); setTimeout(() => fx("star"), 200);
      setConfetti(true); setTimeout(() => setConfetti(false), 1300);
    } else fx("reveal");
    if (popped) { setNewSticker({ e: popped, n: stk.filter(x => x === popped).length }); setTimeout(() => fx("sticker"), 600); setTimeout(() => setNewSticker(null), 2600); }
    if (q.mode === "build") speakSeq([q.sentence], 0.78);
    else if (q.mode === "wordFind") speakSeq([q.target.t, item.en], 0.78);
    else if (q.mode === "dlgSay") speakSeq([item.prompt, item.en], 0.78);
    else speakSeq([item.en], 0.78);
    setPhase("reveal");
    saveAll(st, tS, stk, sessions, seeds);
  }
  function miss(key) {          // 答錯：第一次可再試，第二次揭曉
    fx("soft");
    if (firstTry) { setFirstTry(false); setWrongPick(new Set([key])); }
    else finishAnswer(false);
  }
  function pickReply(opt) {
    if (phase !== "play") { if (phase === "reveal") speak(opt.en); return; }
    if (opt.id === q.item.id) { fx("tap"); finishAnswer(true); } else miss(opt.id);
  }
  function pickChip(t, i) {
    if (phase !== "play") { if (phase === "reveal") speak(t.t); return; }
    if (t.k === q.target.k) { fx("tap"); finishAnswer(true); } else miss(i);
  }
  function pickSub(sub) {
    if (phase !== "play") { if (phase === "reveal") speak(sub.en); return; }
    if (sub.en === q.sub.en) { fx("tap"); setBuildPick(sub); finishAnswer(true); } else miss(sub.en);
  }
  function pickTile(tile) {
    if (phase !== "play" || orderDone.includes(tile.i)) return;
    const wantIdx = orderDone.length;
    if (tile.i === wantIdx) {
      fx("tap");
      const nd = [...orderDone, tile.i];
      setOrderDone(nd);
      if (nd.length === q.item.rtoks.length) finishAnswer(true);
    } else miss(tile.i);
  }
  function goNext() {
    fx("tap");
    const num = qNum + 1;
    if (num >= quizLen) {
      fx("fanfare");
      const ses = sessions + 1; setSessions(ses);
      saveAll(learnerRef.current, totalStars, stickers, ses, seeds);
      setPhase("done");
    } else { setPhase("play"); nextQuestion(learnerRef.current, poolIds, num); }
  }
  const promptOf = () => {
    if (!q) return "";
    if (q.mode === "dlgReply") return "💬 蒙蒙說話了！你要怎麼回答？";
    if (q.mode === "dlgSay") return "🗣 換你開口！蒙蒙在等你用英文說～";
    if (q.mode === "wordFind") return `🔎 哪一個字是「${q.target.g}」？`;
    if (q.mode === "build") return "✏️ 照樣造句：把空格填對！";
    return "🧩 排排站：把句子排好！";
  };

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(180deg, ${K.sky}, #d7f0e2)`, color: K.ink, fontFamily: FONT }}>
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
              <span key={i} style={{ position: "absolute", left: `${8 + i * 6.5}%`, top: "18%", fontSize: 22, animation: `fall ${0.8 + rnd() * 0.5}s ease-in forwards`, animationDelay: `${rnd() * 0.2}s` }}>{pick(["🎉", "⭐", "✨", "🎊"])}</span>
            ))}
          </div>
        )}
        {newSticker && (
          <div style={{ position: "fixed", top: "30%", left: "50%", transform: "translateX(-50%)", zIndex: 60, background: "#fff", border: `4px solid ${K.sun}`, borderRadius: 24, padding: "18px 26px", textAlign: "center", animation: "popIn .5s ease", boxShadow: "0 8px 30px #0003" }}>
            <div style={{ fontSize: 46, animation: "wiggle 0.6s infinite" }}>{newSticker.e}{newSticker.n > 1 && <span style={{ fontSize: 18, fontWeight: 900, color: K.sunEdge }}> ×{newSticker.n}</span>}</div>
            <div style={{ fontWeight: 900, fontSize: 15 }}>集滿 10 顆星星！</div>
            <div style={{ fontSize: 12.5, color: K.sub }}>{newSticker.n > 1 ? "又收集到一張！同款疊起來更厲害" : "新貼紙進了你的貼紙簿 🎉"}</div>
          </div>
        )}

        {/* ===== 首頁 ===== */}
        {phase === "home" && (
          <div>
            <header style={{ textAlign: "center", margin: "8px 0 14px" }}>
              <div style={{ fontSize: 56, animation: "bounceM 1.6s infinite" }}>🦉💬</div>
              <h1 style={{ margin: "4px 0 0", fontSize: 26, fontWeight: 900, letterSpacing: 2, color: "#fff", textShadow: `0 3px 0 ${K.skyDeep}` }}>蒙蒙英語會話教室</h1>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#f2fff9", fontWeight: 700 }}>一輪對話・逐字學・照樣造句，再去挑戰賽 🏆</p>
            </header>
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontWeight: 900, fontSize: 14 }}>🌱 上課 <span style={{ fontFamily: MONO }}>{seeds}</span>　⭐ 星星 <span style={{ fontFamily: MONO }}>{totalStars}</span>　🏅 學會 <span style={{ fontFamily: MONO }}>{mastered.length}</span>/{ALL.length}</div>
                <Btn onClick={() => { fx("tap"); setPhase("book"); }} color="#fff" edge={K.edge} style={{ padding: "8px 12px", fontSize: 13 }}>📒 貼紙簿</Btn>
              </div>
            </Card>
            <Card>
              <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 8, textAlign: "center" }}>先選一個主題：</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginBottom: 12 }}>
                {ISLANDS.map(isl => (
                  <button key={isl.id} onClick={() => { fx("tap"); setIsland(isl.id); }} style={{ fontFamily: FONT, fontWeight: 900, fontSize: 12, cursor: "pointer", padding: "6px 10px", borderRadius: 999, border: `2.5px solid ${island === isl.id ? K.tealEdge : K.edge}`, background: island === isl.id ? K.teal : "#fff", color: island === isl.id ? "#fff" : K.ink }}>{isl.icon} {isl.name}</button>
                ))}
              </div>
              {(() => {
                const ids = poolOf(island);
                const taught = ids.filter(id => learner.ws[id].seen > 0 || learner.ws[id].s > 0.02).length;
                const canQuiz = taught >= 1;
                return (
                  <div>
                    <div style={{ textAlign: "center", fontSize: 12, color: K.sub, fontWeight: 700, marginBottom: 10 }}>這個主題：已教 {taught}・還沒教 {ids.length - taught}（共 {ids.length} 組對話）</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <Btn onClick={() => { fx("tap"); startLesson(island); }} color={K.sun} edge={K.sunEdge} style={{ fontSize: 16, padding: "16px 8px" }}>
                        <div style={{ fontSize: 30 }}>📚</div>會話教室
                        <div style={{ fontSize: 11, color: K.sub, fontWeight: 700 }}>上課：{TEACH_N} 組對話・逐字學・造句</div>
                      </Btn>
                      <Btn onClick={() => { fx("tap"); startQuiz(island); }} disabled={!canQuiz} color={K.teal} edge={K.tealEdge} fg="#fff" style={{ fontSize: 16, padding: "16px 8px" }}>
                        <div style={{ fontSize: 30 }}>🏆</div>會話挑戰
                        <div style={{ fontSize: 11, color: "#e6fff7", fontWeight: 700 }}>{canQuiz ? `考 ${quizLenFor(taught)} 題・五種題型` : "先上課才能挑戰！"}</div>
                      </Btn>
                    </div>
                  </div>
                );
              })()}
              {!hasTTS() && <div style={{ fontSize: 11.5, color: K.sub, marginTop: 8 }}>※ 這台裝置沒有語音功能，會改用文字進行</div>}
            </Card>
            <ParentNotes learner={learner} notes={null} sessions={sessions} seeds={seeds} onReset={async () => {
              const fresh = freshLearner(); setLearner(fresh); learnerRef.current = fresh;
              setTotalStars(0); setStickers([]); setSessions(0); setSeeds(0);
              await persist({ it: {}, stars: 0, stickers: [], sessions: 0, seeds: 0, t: Date.now() });
            }} />
          </div>
        )}

        {/* ===== 會話教室 ===== */}
        {phase === "lesson" && lessonItem && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 16 }}>{Array.from({ length: TEACH_N }, (_, i) => <span key={i} style={{ opacity: i < lessonIdx ? 1 : 0.28 }}>🌱</span>)}</div>
              <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: "#fff", background: K.sunEdge, borderRadius: 10, padding: "3px 9px" }}>
                📚 第 {lessonIdx + 1} / {TEACH_N} 組・{stage === "dlg" ? "① 聽對話" : stage === "words" ? `② 學單字 ${wordIdx + 1}/${wordList.length}` : "③ 照樣造句"}
              </div>
            </div>
            <Card style={{ textAlign: "center" }}>
              {stage === "dlg" && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: K.sub, marginBottom: 6 }}>{lessonItem.tag === "reteach" ? "🔁 再教一次！這組之前有點難" : "💬 新對話！聽蒙蒙說、跟著唸，再點卡片"}</div>
                  <button onClick={tapDialogCard} style={{ fontFamily: FONT, cursor: "pointer", background: "#fff", borderRadius: 24, width: "100%", border: `4px solid ${K.sun}`, borderBottomWidth: 8, padding: "14px 14px", animation: "popIn .4s ease", textAlign: "left" }}>
                    <div style={{ textAlign: "center", fontSize: 40 }}>{lessonItem.item.icon}</div>
                    <Bubble who="owl" en={lessonItem.item.prompt} zh={lessonItem.item.promptZh} />
                    <Bubble who="chick" en={lessonItem.item.en} zh={lessonItem.item.zh} />
                    <div style={{ textAlign: "center", fontSize: 12.5, color: K.sub, fontWeight: 700, marginTop: 8 }}>{isSpeaking ? "🎶 蒙蒙說話中…說完點卡片進下一步" : "🔊 再聽一次＋進入學單字，點這裡"}</div>
                  </button>
                </div>
              )}
              {stage === "words" && wordList[wordIdx] && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: K.sub, marginBottom: 6 }}>🔤 這句話裡的每個字：聽一聽、跟著唸，再點卡片</div>
                  <div style={{ fontSize: 12, fontFamily: MONO, color: K.sub, marginBottom: 6, lineHeight: 1.8 }}>
                    {[...lessonItem.item.ptoks, ...lessonItem.item.rtoks].map((t, i) => (
                      <span key={i} style={{ padding: "1px 4px", borderRadius: 6, background: t.k === wordList[wordIdx].k ? K.sun : "transparent", fontWeight: t.k === wordList[wordIdx].k ? 900 : 700 }}>{t.t}</span>
                    ))}
                  </div>
                  <button onClick={tapWordCard} style={{ fontFamily: FONT, cursor: "pointer", background: "#fff", borderRadius: 24, border: `4px solid ${K.teal}`, borderBottomWidth: 8, padding: "18px 30px", animation: "popIn .35s ease", minWidth: 220 }}>
                    <div style={{ fontSize: 36, fontWeight: 900, fontFamily: MONO, letterSpacing: 1 }}>{wordList[wordIdx].t}</div>
                    <div style={{ fontSize: 16, color: K.sub, fontWeight: 900, marginTop: 2 }}>{wordList[wordIdx].g || "—"}　{isSpeaking ? "🎶" : "🔊"}</div>
                  </button>
                  <div style={{ fontSize: 11.5, color: K.sub, marginTop: 10 }}>{wordIdx + 1 === wordList.length ? "最後一個字！點了就進下一步" : "點卡片 → 下一個字"}</div>
                </div>
              )}
              {stage === "pattern" && lessonItem.item.pattern && (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: K.sub, marginBottom: 6 }}>✏️ 照樣造句：換一個字，就是一句新的話！</div>
                  <div style={{ fontFamily: MONO, fontWeight: 900, fontSize: 21, background: "#fff", borderRadius: 16, padding: "12px 10px", border: `3px solid ${K.edge}` }}>
                    {(() => {
                      const pat = lessonItem.item.pattern;
                      const [a, b] = pat.tpl.split("{}");
                      return <span>{a}<span style={{ color: patFilled ? K.purpleD : K.sub, background: patFilled ? "#f1ecff" : "#fff1d6", borderRadius: 8, padding: "0 6px" }}>{patFilled ? patFilled.sub.en : "____"}</span>{b}</span>;
                    })()}
                  </div>
                  <div style={{ fontSize: 12, color: K.sub, marginTop: 4 }}>{patFilled ? lessonItem.item.pattern.zhTpl.replace("{}", patFilled.sub.zh) : `原句：${lessonItem.item.en}（${lessonItem.item.zh}）`}</div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 12 }}>
                    {lessonItem.item.pattern.subs.map(sub => {
                      const done = patDone.includes(sub.en);
                      return (
                        <button key={sub.en} onClick={() => tapPatternSub(sub)} style={{ fontFamily: FONT, cursor: done ? "default" : "pointer", background: done ? "#eaffef" : "#fff", border: `3px solid ${done ? K.green : K.edge}`, borderBottomWidth: 6, borderRadius: 16, padding: "10px 12px", minWidth: 92 }}>
                          <div style={{ fontSize: 24 }}>{sub.emoji || "✨"}</div>
                          <div style={{ fontFamily: MONO, fontWeight: 900, fontSize: 15 }}>{sub.en}</div>
                          <div style={{ fontSize: 11, color: K.sub }}>{sub.zh}{done ? " ✓" : ""}</div>
                        </button>
                      );
                    })}
                  </div>
                  {patDone.length >= lessonItem.item.pattern.subs.length ? (
                    <div style={{ marginTop: 12 }}><Btn onClick={() => { fx("tap"); finishTeachItem(); }} color={K.teal} edge={K.tealEdge} fg="#fff" disabled={isSpeaking}>{isSpeaking ? "🔊 蒙蒙說話中…" : "✅ 三句都造好了！下一步"}</Btn></div>
                  ) : <div style={{ fontSize: 11.5, color: K.sub, marginTop: 10 }}>點一個替換詞，聽新句子（{patDone.length}/{lessonItem.item.pattern.subs.length}）</div>}
                </div>
              )}
              <div style={{ fontSize: 11, color: K.sub, marginTop: 10 }}>教室只上課、不考試——挑戰賽才有題目喔！語音說完才會換卡 🐢</div>
            </Card>
            <ParentNotes learner={learner} notes={notes} sessions={sessions} seeds={seeds} compact />
          </div>
        )}

        {/* ===== 下課囉 ===== */}
        {phase === "lessonDone" && (
          <Card style={{ textAlign: "center", animation: "popIn .5s ease" }}>
            <div style={{ fontSize: 50 }}>{lessonList.length ? "🔔🦉" : "🎓🦉"}</div>
            <div style={{ fontSize: 22, fontWeight: 900, margin: "4px 0" }}>{lessonList.length ? "下課囉！今天學了這些：" : "這個主題全部教完啦！"}</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap", margin: "12px 0" }}>
              {lessonList.map((l, i) => (
                <div key={i} onClick={() => speakSeq([ALL[l.id].prompt, ALL[l.id].en])} style={{ background: "#fff", border: `3px solid ${l.tag === "reteach" ? K.sun : K.green}`, borderRadius: 14, padding: "6px 10px", cursor: "pointer", maxWidth: 200 }}>
                  <div style={{ fontSize: 26 }}>{ALL[l.id].icon}</div>
                  <div style={{ fontSize: 10.5, fontFamily: MONO, fontWeight: 700 }}>{ALL[l.id].en}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: K.sub, marginBottom: 10 }}>{lessonList.length ? "（點卡片可以再聽一次）拿到 1 顆 🌱！" : "換一個主題上課，或去挑戰賽大顯身手！"}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <Btn onClick={() => { fx("tap"); setPhase("home"); }} color="#fff" edge={K.edge}>🏫 回教室門口</Btn>
              <Btn onClick={() => { fx("tap"); startQuiz(island); }} color={K.teal} edge={K.tealEdge} fg="#fff">
                🏆 去挑戰賽考考看！（{quizLenFor(poolOf(island).filter(id => learner.ws[id].seen > 0 || learner.ws[id].s > 0.02).length)} 題）
              </Btn>
            </div>
          </Card>
        )}

        {/* ===== 挑戰中 ===== */}
        {(phase === "play" || phase === "reveal") && q && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 15 }}>{Array.from({ length: quizLen }, (_, i) => <span key={i} style={{ opacity: i < stars ? 1 : 0.28 }}>⭐</span>)}</div>
              <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: "#fff", background: K.skyDeep, borderRadius: 10, padding: "3px 9px" }}>{qNum + 1} / {quizLen}・{MODE_LABEL[q.mode]}</div>
            </div>
            <Card style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: K.sub, marginBottom: 6 }}>{promptOf()}</div>
              <div style={{ fontSize: 40 }}>{q.item.icon}</div>
              {(q.mode === "dlgReply" || q.mode === "dlgSay") && (
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <Bubble who="owl" en={q.item.prompt} zh={q.item.promptZh} tail={q.mode === "dlgSay" ? "🤫" : "🔊"} onClick={() => { fx("tap"); speak(q.item.prompt); }} />
                </div>
              )}
              {q.mode === "dlgSay" && phase === "play" && <div style={{ fontSize: 10.5, color: K.purpleD, fontWeight: 900, marginTop: 4 }}>這次不放答案語音——想想你會怎麼說！</div>}
              {q.mode === "wordFind" && (
                <div>
                  <button onClick={() => { fx("tap"); speak(q.target.t, 0.75); }} style={{ fontSize: 26, background: K.sun, border: `3px solid ${K.sunEdge}`, borderBottomWidth: 6, borderRadius: 999, width: 64, height: 64, cursor: "pointer" }}>🔊</button>
                  <div style={{ fontSize: 12, color: K.sub, marginTop: 6 }}>這句話：{q.item.zh}</div>
                </div>
              )}
              {q.mode === "build" && (
                <div>
                  <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 6 }}>請說：「{q.sentenceZh}」</div>
                  <div style={{ fontFamily: MONO, fontWeight: 900, fontSize: 21, background: "#fff", borderRadius: 16, padding: "12px 10px", border: `3px solid ${K.edge}` }}>
                    {(() => { const [a, b] = q.item.pattern.tpl.split("{}"); const filled = phase === "reveal" ? q.sub.en : buildPick ? buildPick.en : "____"; return <span>{a}<span style={{ color: K.purpleD, background: "#f1ecff", borderRadius: 8, padding: "0 6px" }}>{filled}</span>{b}</span>; })()}
                  </div>
                </div>
              )}
              {q.mode === "order" && (
                <div>
                  <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 6 }}>「{q.item.zh}」 <button onClick={() => { fx("tap"); speak(q.item.en); }} style={{ fontSize: 16, background: "#fff", border: `2.5px solid ${K.edge}`, borderRadius: 999, width: 36, height: 36, cursor: "pointer" }}>🔊</button></div>
                  <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", minHeight: 44 }}>
                    {q.item.rtoks.map((t, i) => (
                      <span key={i} style={{ fontFamily: MONO, fontWeight: 900, fontSize: 18, padding: "6px 10px", borderRadius: 12, background: orderDone.includes(i) || phase === "reveal" ? "#eaffef" : "#fff1d6", border: `2.5px solid ${orderDone.includes(i) || phase === "reveal" ? K.green : "#e8d9b0"}`, color: orderDone.includes(i) || phase === "reveal" ? K.ink : "#c9b98f", minWidth: 40 }}>
                        {orderDone.includes(i) || phase === "reveal" ? t.t : "?"}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {phase === "reveal" && (
                <div style={{ marginTop: 8, animation: "popIn .4s ease" }}>
                  <div style={{ fontSize: 17, fontWeight: 900, fontFamily: MONO }}>{q.mode === "build" ? q.sentence : q.mode === "wordFind" ? `${q.target.t} ＝ ${q.target.g}` : q.item.en}</div>
                  <div style={{ fontSize: 13, color: K.sub }}>{q.mode === "build" ? q.sentenceZh : q.mode === "wordFind" ? q.item.en : q.item.zh}</div>
                  <div style={{ fontSize: 14, color: firstTry ? K.greenD : K.sub, fontWeight: 900, marginTop: 2 }}>{firstTry ? pick(["Great! 太棒了！", "Yes! 答對了！", "Wow! 好厲害！"]) : "沒關係，學到了！下次一定行 💪"}</div>
                </div>
              )}
            </Card>

            {/* 選項區 */}
            {(q.mode === "dlgReply" || q.mode === "dlgSay") && (
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {q.options.map((opt, i) => {
                  const dimmed = wrongPick.has(opt.id), isAns = phase === "reveal" && opt.id === q.item.id;
                  return (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexDirection: "row-reverse" }}>
                      <span style={{ fontSize: 24 }}>🐥</span>
                      <button onClick={() => pickReply(opt)} disabled={dimmed && phase === "play"} style={{ fontFamily: FONT, cursor: "pointer", flex: 1, textAlign: "left", background: isAns ? "#eaffef" : K.chick, opacity: dimmed && !isAns ? 0.35 : 1, border: `3.5px solid ${isAns ? K.green : K.edge}`, borderBottomWidth: 6, borderRadius: "16px 4px 16px 16px", padding: "10px 12px", animation: isAns ? "popIn .4s ease" : "none" }}>
                        <div style={{ fontFamily: MONO, fontWeight: 900, fontSize: 15.5 }}>{opt.icon} {opt.en}</div>
                        <div style={{ fontSize: 11, color: K.sub }}>{opt.zh}</div>
                      </button>
                      {!(q.mode === "dlgSay" && phase === "play") && <button onClick={(e) => { e.stopPropagation(); fx("tap"); speak(opt.en); }} style={{ fontSize: 15, background: "#fff", border: `2.5px solid ${K.edge}`, borderRadius: 999, width: 34, height: 34, cursor: "pointer", flexShrink: 0 }}>🔊</button>}
                    </div>
                  );
                })}
              </div>
            )}
            {q.mode === "wordFind" && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                {q.chips.map((t, i) => {
                  const dimmed = wrongPick.has(i), isAns = phase === "reveal" && t.k === q.target.k;
                  return (
                    <button key={i} onClick={() => pickChip(t, i)} disabled={dimmed && phase === "play"} style={{ fontFamily: MONO, fontWeight: 900, fontSize: 20, cursor: "pointer", padding: "12px 14px", borderRadius: 14, background: isAns ? "#eaffef" : "#fff", opacity: dimmed && !isAns ? 0.35 : 1, border: `3.5px solid ${isAns ? K.green : K.edge}`, borderBottomWidth: 6, animation: isAns ? "popIn .4s ease" : "none" }}>
                      {t.t}{phase === "reveal" && <div style={{ fontSize: 10.5, color: K.sub, fontFamily: FONT }}>{t.g}</div>}
                    </button>
                  );
                })}
              </div>
            )}
            {q.mode === "build" && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                {q.options.map((sub, i) => {
                  const dimmed = wrongPick.has(sub.en), isAns = phase === "reveal" && sub.en === q.sub.en;
                  return (
                    <button key={i} onClick={() => pickSub(sub)} disabled={dimmed && phase === "play"} style={{ fontFamily: FONT, cursor: "pointer", background: isAns ? "#eaffef" : "#fff", opacity: dimmed && !isAns ? 0.35 : 1, border: `3.5px solid ${isAns ? K.green : K.edge}`, borderBottomWidth: 6, borderRadius: 16, padding: "10px 12px", minWidth: 96, animation: isAns ? "popIn .4s ease" : "none" }}>
                      <div style={{ fontSize: 26 }}>{sub.emoji || "✨"}</div>
                      <div style={{ fontFamily: MONO, fontWeight: 900, fontSize: 15 }}>{sub.en}</div>
                      <div style={{ fontSize: 11, color: K.sub }}>{sub.zh}</div>
                    </button>
                  );
                })}
              </div>
            )}
            {q.mode === "order" && phase === "play" && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                {q.tiles.map(tile => {
                  const used = orderDone.includes(tile.i);
                  return (
                    <button key={tile.i} onClick={() => pickTile(tile)} disabled={used} style={{ fontFamily: MONO, fontWeight: 900, fontSize: 20, cursor: used ? "default" : "pointer", padding: "12px 14px", borderRadius: 14, background: used ? "#f3ede0" : "#fff", opacity: used ? 0.35 : 1, border: `3.5px solid ${K.edge}`, borderBottomWidth: 6 }}>{tile.t}</button>
                  );
                })}
              </div>
            )}
            {phase === "reveal" && (
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <div style={{ fontSize: 11.5, color: "#2f5f55", fontWeight: 700, marginBottom: 8 }}>（點任何一個選項可以再聽一次）</div>
                <Btn onClick={goNext} disabled={isSpeaking} color={K.teal} edge={K.tealEdge} fg="#fff" style={{ fontSize: 17, padding: "13px 34px" }}>
                  {isSpeaking ? "🔊 蒙蒙說話中…" : qNum + 1 >= quizLen ? "🎁 看看今天的成果！" : "下一題 ▶"}
                </Btn>
              </div>
            )}
            <div style={{ marginTop: 12 }}><ParentNotes learner={learner} notes={notes} sessions={sessions} seeds={seeds} compact /></div>
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
                    <div key={id} onClick={() => speakSeq([ALL[id].prompt, ALL[id].en])} style={{ background: "#fff", border: `3px solid ${ok ? K.green : K.edge}`, borderRadius: 14, padding: "6px 10px", cursor: "pointer", maxWidth: 200 }}>
                      <div style={{ fontSize: 26 }}>{ALL[id].icon}</div>
                      <div style={{ fontSize: 10.5, fontFamily: MONO, fontWeight: 700 }}>{ALL[id].en}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: K.sub, marginBottom: 10 }}>（點卡片可以再聽一次整組對話）</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <Btn onClick={() => { fx("tap"); setPhase("home"); }} color="#fff" edge={K.edge}>🏫 回教室門口</Btn>
                <Btn onClick={() => { fx("tap"); setPhase("book"); }} color={K.pink} edge="#c2588a" fg="#fff">📒 貼紙簿</Btn>
                <Btn onClick={() => { fx("tap"); startQuiz(island); }} color={K.teal} edge={K.tealEdge} fg="#fff">🔁 再挑戰一次</Btn>
              </div>
            </Card>
            <ParentNotes learner={learner} notes={notes} sessions={sessions} seeds={seeds} />
          </div>
        )}

        {/* ===== 貼紙簿 ===== */}
        {phase === "book" && (
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 17 }}>📒 我的貼紙簿</div>
              <Btn onClick={() => { fx("tap"); setPhase("home"); }} color="#fff" edge={K.edge} style={{ padding: "7px 12px", fontSize: 13 }}>↩ 回教室門口</Btn>
            </div>
            <div style={{ fontWeight: 900, fontSize: 13.5, margin: "4px 0 6px", color: K.sub }}>🎁 集星星換到的（每 10 顆 ⭐ 一張）</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {stickers.length ? Object.entries(stickers.reduce((m, x) => { m[x] = (m[x] || 0) + 1; return m; }, {})).map(([e, n]) => (
                <div key={e} style={{ position: "relative", fontSize: 34, background: "#fff", border: `3px solid ${K.sun}`, borderRadius: 14, padding: "6px 10px", animation: "popIn .4s ease" }}>
                  {e}{n > 1 && <span style={{ position: "absolute", top: -8, right: -8, background: K.sunEdge, color: "#fff", borderRadius: 10, fontSize: 11, fontWeight: 900, padding: "1px 6px", border: "2px solid #fff" }}>×{n}</span>}
                </div>
              )) : <div style={{ fontSize: 12.5, color: K.sub }}>還沒有——集滿 10 顆星星就有第一張！</div>}
            </div>
            <div style={{ fontWeight: 900, fontSize: 13.5, margin: "4px 0 6px", color: K.sub }}>💬 學會的對話（點亮的可以再聽）</div>
            {Object.entries(THEMES).map(([tk, tname]) => (
              <div key={tk} style={{ marginBottom: 7 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: K.sub, margin: "0 0 4px" }}>{tname}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {DLGS.filter(d => d.theme === tk).map(d => {
                    const m = learner.ws[d.id].s >= 0.7, half = learner.ws[d.id].s >= 0.35;
                    return (
                      <div key={d.id} onClick={() => m && speakSeq([d.prompt, d.en])} style={{ background: m ? "#fff" : "#ffffff77", borderRadius: 12, padding: "5px 9px", border: `2.5px solid ${m ? K.green : half ? K.sun : "#ddd0b5"}`, cursor: m ? "pointer" : "default", display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 20, filter: m ? "none" : "grayscale(1)", opacity: m ? 1 : 0.45 }}>{d.icon}</span>
                        <span style={{ fontSize: 10.5, fontFamily: MONO, fontWeight: 700, color: m ? K.ink : "#b0a488" }}>{m || half ? d.prompt : "?"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </Card>
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
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 900, fontSize: 13, color: K.sub }}>🦉 蒙蒙老師的備課筆記（給爸媽看的 MCTS 透視）</summary>
        <div style={{ fontSize: 12.5, lineHeight: 1.8, marginTop: 8, color: K.ink }}>
          {notes && notes.chosen && (
            <div style={{ background: K.cream, borderRadius: 12, padding: "8px 10px", marginBottom: 8 }}>
              <b>{notes.kind === "lesson" ? "這一組為什麼教" : "這一題為什麼出"}「{ALL[notes.chosen.id].en}」？</b>
              <span style={{ background: TAGS[notes.chosen.tag].c, color: "#fff", borderRadius: 8, padding: "1px 8px", marginLeft: 6, fontSize: 11.5, fontWeight: 900 }}>{TAGS[notes.chosen.tag].t}</span>
              {notes.kind === "quiz" && <span style={{ background: K.skyDeep, color: "#fff", borderRadius: 8, padding: "1px 8px", marginLeft: 4, fontSize: 11, fontWeight: 900 }}>題型：{MODE_LABEL[notes.mode]}</span>}
              <div style={{ fontSize: 11.5, color: K.sub, marginTop: 4 }}>
                {notes.kind === "lesson"
                  ? `課程規劃師把「這堂剩下的教學＋之後一整場挑戰賽」模擬了 ${notes.total} 遍（${notes.ms?.toFixed(0)} ms）——教什麼，是看它對之後表現與興趣的影響。`
                  : `出題規劃師把「剩下的整場挑戰」模擬了 ${notes.total} 遍（${notes.ms?.toFixed(0)} ms），只從教過的對話裡挑；題型由該組對話的熟練度決定（聽答→找單字→開口說→造句／排排站）。`}
                目前興趣電量估計 {notes.E?.toFixed(0)}%。
              </div>
              {notes.stats && notes.stats.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {notes.stats.map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <span style={{ fontFamily: MONO, fontSize: 11.5, width: 110, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ALL[s.id].en}</span>
                      <span style={{ fontSize: 10.5, color: TAGS[s.tag].c, width: 78, fontWeight: 900 }}>{TAGS[s.tag].t}</span>
                      <div style={{ flex: 1, height: 7, background: "#f0e6cf", borderRadius: 99, overflow: "hidden" }}><div style={{ width: `${clamp(s.val, 0, 1) * 100}%`, height: "100%", background: i === 0 ? K.purple : "#c9b8f5" }} /></div>
                      <span style={{ fontFamily: MONO, fontSize: 10.5, color: K.sub, width: 52, textAlign: "right" }}>{s.visits} 局</span>
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
                {seen.length === 0 ? <span style={{ color: K.sub }}>還沒開始，快去上課吧！</span> : (
                  <div style={{ marginTop: 4 }}>
                    {weakest.map(w => (
                      <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 16 }}>{w.icon}</span>
                        <span style={{ fontFamily: MONO, fontSize: 11.5, width: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.en}</span>
                        <div style={{ flex: 1, height: 7, background: "#f0e6cf", borderRadius: 99, overflow: "hidden" }}><div style={{ width: `${learner.ws[w.id].s * 100}%`, height: "100%", background: learner.ws[w.id].s > 0.6 ? K.green : learner.ws[w.id].s > 0.3 ? K.sun : K.red }} /></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: K.sub }}>
                <b>老實說明</b>：36 組一輪對話（八大主題、一年級核心溝通功能、標準美式用法）。教室每組三步——聽對話、逐字學（每個字有簡短中文）、照樣造句（換一個字＝一句新話，17 組有樣板）；挑戰只考教過的，五種題型隨熟練度升級。記憶模型是遺忘曲線＋測驗效應＋間隔＋興趣電量的<b>近似</b>，每答一題校正一次；口說採「聽＋跟唸」，語音辨識不在本版範圍。換卡與「下一題」都會等語音真的說完。已上課 {seeds} 堂、挑戰 {sessions} 場；進度自動儲存。
              </div>
              {onReset && <button onClick={onReset} style={{ marginTop: 8, fontFamily: FONT, fontSize: 11.5, fontWeight: 900, color: K.sub, background: "none", border: `2px solid ${K.edge}`, borderRadius: 10, padding: "4px 10px", cursor: "pointer" }}>⚠ 清除全部進度（重新認識孩子）</button>}
            </>
          )}
        </div>
      </details>
    </section>
  );
}
