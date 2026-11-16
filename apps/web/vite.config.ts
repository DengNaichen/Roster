import { functionRegion } from "./src/integration/region";
import { remoteRefreshInterval } from "./src/integration/refresh";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  functionRegion(env.VITE_API_REGION, env.VITE_SUPABASE_URL);
  remoteRefreshInterval(env.VITE_REMOTE_REFRESH_MS);
  return {
    plugins: [react()],
    build: { outDir: "dist", emptyOutDir: true },
    server: { host: "127.0.0.1" },
  };
});
