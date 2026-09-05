// Cloudflare Worker：「跟蒙蒙聊天」的中繼站（把 API 金鑰藏在伺服器端，前端永遠看不到）
// 部署後把 Worker 網址填進 index.html 的 window.MOMO_CHAT_PROXY
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "*";          // 建議設成你的網站，例如 https://你的帳號.github.io
    const cors = {
      "Access-Control-Allow-Origin": allowed === "*" ? "*" : (origin === allowed ? origin : "null"),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return new Response("POST only", { status: 405, headers: cors });
    if (allowed !== "*" && origin !== allowed) return new Response("forbidden", { status: 403, headers: cors });
    const body = await request.text();
    if (body.length > 20000) return new Response("too large", { status: 413, headers: cors });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body,
    });
    return new Response(await r.text(), { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
  },
};
