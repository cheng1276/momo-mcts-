import { useState, useEffect } from "react";
import A0 from "./apps/momo-talk-v2-mcts.jsx";
import A1 from "./apps/momo-talk-mcts.jsx";
import A2 from "./apps/abc-school-v3-mcts.jsx";
import A3 from "./apps/abc-school-v2-mcts.jsx";
import A4 from "./apps/abc-school-mcts.jsx";
import A5 from "./apps/abc-adventure-mcts.jsx";
import A6 from "./apps/gomoku-mcts.jsx";
import A7 from "./apps/othello-mcts.jsx";
import A8 from "./apps/battleship-mcts.jsx";
import A9 from "./apps/carcassonne-junior-mcts.jsx";
import A10 from "./apps/catan-junior-v2-mcts.jsx";
import A11 from "./apps/catan-junior-mcts.jsx";
import A12 from "./apps/dragomino-mcts.jsx";
import A13 from "./apps/puzzle-forge-mcts.jsx";
import A14 from "./apps/kyoto-stress-test.jsx";
import A15 from "./apps/tw-stock-montecarlo.jsx";
import A16 from "./apps/lupus-go-mcts.jsx";
import A17 from "./apps/mcts-medical-go.jsx";

const APPS = [
  { key: "momo-talk-v2-mcts", icon: "☕", name: "蒙蒙英語會話教室 2.0", desc: "一輪對話・逐字學・造句・🎤 開口・跟蒙蒙聊天", C: A0 },
  { key: "momo-talk-mcts", icon: "💬", name: "蒙蒙英語會話教室", desc: "一輪對話・逐字學・造句・五種測驗", C: A1 },
  { key: "abc-school-v3-mcts", icon: "🏫", name: "ABC 蒙蒙學校 3.0", desc: "146 字＋29 景會話・教與考分開", C: A2 },
  { key: "abc-school-v2-mcts", icon: "🏫", name: "ABC 蒙蒙學校 2.0", desc: "語音說完才換卡", C: A3 },
  { key: "abc-school-mcts", icon: "🏫", name: "ABC 蒙蒙學校 1.0", desc: "教室／挑戰島分開", C: A4 },
  { key: "abc-adventure-mcts", icon: "🦉", name: "ABC 冒險島", desc: "混合式 MCTS 備課老師", C: A5 },
  { key: "gomoku-mcts", icon: "⚫", name: "五子棋 MCTS 棋院", desc: "戰術 rollout・威脅提示", C: A6 },
  { key: "othello-mcts", icon: "⚪", name: "黑白棋 MCTS 棋院", desc: "思考透視・小海龜學徒", C: A7 },
  { key: "battleship-mcts", icon: "🚢", name: "戰艦棋・蒙蒙提督", desc: "資訊集合 MCTS 熱區圖", C: A8 },
  { key: "carcassonne-junior-mcts", icon: "🏰", name: "卡卡頌兒童版", desc: "open-loop MCTS 鋪路小鎮", C: A9 },
  { key: "catan-junior-v2-mcts", icon: "🏝️", name: "新卡坦島兒童版", desc: "雙島＋幽靈島・無回合上限", C: A10 },
  { key: "catan-junior-mcts", icon: "🏴‍☠️", name: "卡坦島兒童版", desc: "鬍鬍船長", C: A11 },
  { key: "dragomino-mcts", icon: "🐉", name: "龍蛋島", desc: "open-loop MCTS", C: A12 },
  { key: "puzzle-forge-mcts", icon: "🧩", name: "關卡鍛造坊", desc: "SP-MCTS 生成推箱子", C: A13 },
  { key: "kyoto-stress-test", icon: "🗼", name: "京都行程壓力測試", desc: "蒙地卡羅模擬四天行程", C: A14 },
  { key: "tw-stock-montecarlo", icon: "📈", name: "台股蒙地卡羅", desc: "GBM／t 分布／拔靴法", C: A15 },
  { key: "lupus-go-mcts", icon: "🩺", name: "對弈紅斑性狼瘡", desc: "模擬器品質的教訓", C: A16 },
  { key: "mcts-medical-go", icon: "💊", name: "對弈疾病", desc: "醫療 MCTS 示範", C: A17 },
];
const FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif";

export default function App() {
  const [key, setKey] = useState(() => new URLSearchParams(window.location.search).get("app") || "");
  useEffect(() => {
    const url = new URL(window.location.href);
    if (key) url.searchParams.set("app", key); else url.searchParams.delete("app");
    window.history.replaceState(null, "", url.toString());
    window.scrollTo(0, 0);
  }, [key]);
  const cur = APPS.find(a => a.key === key);
  if (cur) {
    const C = cur.C;
    return (
      <div>
        <div style={{ position: "sticky", top: 0, zIndex: 100, background: "#4a3524", color: "#fff", fontFamily: FONT, fontSize: 13, fontWeight: 900, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => setKey("")} style={{ fontFamily: FONT, fontWeight: 900, fontSize: 13, background: "#fff", color: "#4a3524", border: "none", borderRadius: 10, padding: "6px 10px", cursor: "pointer" }}>← 回系列選單</button>
          <span>{cur.icon} {cur.name}</span>
        </div>
        <C key={cur.key} />
      </div>
    );
  }
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#7ec8e8,#a8e0c8)", fontFamily: FONT, color: "#4a3524" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "20px 14px 40px" }}>
        <h1 style={{ textAlign: "center", color: "#fff", textShadow: "0 3px 0 #4d9ec4", fontSize: 26, letterSpacing: 2 }}>🦉 蒙蒙 MCTS 系列</h1>
        <p style={{ textAlign: "center", color: "#f2fbff", fontWeight: 700, fontSize: 13, marginTop: -8 }}>從棋盤到教室——用蒙地卡羅樹搜尋做的 {APPS.length} 個小 app</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
          {APPS.map(a => (
            <button key={a.key} onClick={() => setKey(a.key)} style={{ fontFamily: FONT, textAlign: "left", cursor: "pointer", background: "#fff8e9", border: "3px solid #e0bd7a", borderBottomWidth: 6, borderRadius: 18, padding: "12px 14px", display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 30 }}>{a.icon}</span>
              <span><div style={{ fontWeight: 900, fontSize: 16 }}>{a.name}</div><div style={{ fontSize: 12, color: "#8a7154", fontWeight: 700 }}>{a.desc}</div></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
