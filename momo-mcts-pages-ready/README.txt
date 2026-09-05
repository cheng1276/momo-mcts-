🦉 蒙蒙 MCTS 系列 — 成品版（不需要 .github、不需要 Node）

1. 到 GitHub 建一個「公開」倉庫，例如 momo-mcts
2. Add file → Upload files → 把這個資料夾裡的東西全部拖進去：
   index.html、README.txt、assets 資料夾（裡面是 index-xxxx.js）
   → Commit changes
3. 倉庫 Settings → Pages → Build and deployment：
   Source 選「Deploy from a branch」，Branch 選 main、資料夾選 /(root) → Save
4. 等 1～2 分鐘，網址：https://你的帳號.github.io/momo-mcts/
   直接開某個 app：在網址後加 ?app=momo-talk-v2-mcts

補充：
・「跟蒙蒙聊天」在自己的網站上需要中繼站（見原始碼包的 worker 資料夾與 README）。
  設定好後，用 GitHub 網頁編輯 index.html，把 window.MOMO_CHAT_PROXY = "" 填入 Worker 網址即可。
・要修改 app 內容才需要原始碼包（momo-mcts-site.zip）。
