import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// Claude 預覽視窗提供的 window.storage，在自己的網站上用 localStorage 補上（進度一樣會保存）
if (!window.storage) {
  window.storage = {
    async get(key) { const v = localStorage.getItem(key); if (v == null) throw new Error("not found"); return { key, value: v, shared: false }; },
    async set(key, value) { localStorage.setItem(key, value); return { key, value, shared: false }; },
    async delete(key) { localStorage.removeItem(key); return { key, deleted: true, shared: false }; },
    async list(prefix = "") { return { keys: Object.keys(localStorage).filter(k => k.startsWith(prefix)), prefix, shared: false }; },
  };
}
createRoot(document.getElementById("root")).render(<App />);
