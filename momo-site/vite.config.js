import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// base: "./" → 不用管 GitHub 倉庫名稱，放在任何子路徑都能跑
export default defineConfig({ plugins: [react()], base: "./" });
