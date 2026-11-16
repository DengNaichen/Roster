import { functionRegion } from "./src/integration/region";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  functionRegion(env.VITE_API_REGION, env.VITE_SUPABASE_URL);
  return {
    plugins: [react()],
    build: { outDir: "dist", emptyOutDir: true },
    server: { host: "127.0.0.1" },
  };
});
