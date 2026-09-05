# 🦉 蒙蒙 MCTS 系列 — 發佈到 GitHub Pages

這個資料夾是一個做好的 Vite + React 專案，內含系列全部 app（`src/apps/`）和一個系列選單（`src/App.jsx`）。
推上 GitHub 後，Actions 會自動打包並發佈到 GitHub Pages（HTTPS），麥克風功能就能正常使用。

## 一、上傳到 GitHub（三選一）
1. **GitHub 網頁**：建立新的公開倉庫（例如 `momo-mcts`）→ 「Add file → Upload files」→ 把本資料夾裡的**全部內容**拖進去（記得包含 `.github` 資料夾，它是自動部署的關鍵；有些系統會隱藏以 `.` 開頭的資料夾）→ Commit。
2. **GitHub Desktop**：File → Add local repository → 選這個資料夾 → Publish repository。
3. **git 指令**：
   ```bash
   git init && git add . && git commit -m "momo mcts series"
   git branch -M main
   git remote add origin https://github.com/你的帳號/momo-mcts.git
   git push -u origin main
   ```

## 二、開啟 GitHub Pages
倉庫 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
之後每次推上 `main`，Actions 會自動 `npm install` + `npm run build` 並發佈。
網址：`https://你的帳號.github.io/momo-mcts/`（Actions 頁面也會顯示）。
想直接開某個 app：在網址後加 `?app=momo-talk-v2-mcts`（key 見 `src/App.jsx`）。

## 三、本機測試（可選，需要 Node.js 20+）
```bash
npm install
npm run dev      # 開發預覽
npm run build    # 打包到 dist/
```

## 四、🎤 麥克風與語音
- GitHub Pages 是 HTTPS，瀏覽器會在第一次按 🎤 時詢問麥克風權限。
- 語音辨識用 Web Speech API：Chrome（桌機／Android）、Safari（iOS 14.5+ / macOS）可用；Firefox 目前不支援（app 會自動改用點選／打字）。
- 發音用瀏覽器內建 TTS（en-US）。

## 五、☕「跟蒙蒙聊天」需要一個小中繼站（選用）
在 Claude 預覽視窗裡可以直接呼叫 Claude；在自己的網站上必須經過中繼站，**金鑰絕對不能寫進前端**。
1. 到 Cloudflare 建一個 Worker（免費方案即可），把 `worker/momo-proxy.js` 的內容貼進去並部署。
2. Worker 的 Settings → Variables 新增：`ANTHROPIC_API_KEY`（勾選 Secret／Encrypt）和 `ALLOWED_ORIGIN`（填你的網站，例如 `https://你的帳號.github.io`）。
3. 把 Worker 網址（例如 `https://momo-proxy.你的帳號.workers.dev`）填進 `index.html` 的 `window.MOMO_CHAT_PROXY = "..."`，重新推上 GitHub。
4. 費用依 Anthropic API 用量計費；孩子的聊天內容不會被 app 儲存。

## 六、其他
- 學習進度存在瀏覽器的 localStorage（同一台裝置、同一個瀏覽器才會保留）。
- 想修改哪個 app 就改 `src/apps/` 裡的檔案；系列選單在 `src/App.jsx`。
