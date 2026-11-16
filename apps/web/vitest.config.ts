import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
      environment: "jsdom",
      exclude: ["**/node_modules/**", "**/dist/**"],
      setupFiles: ["./src/test/setup.ts"],
      restoreMocks: true,
      unstubGlobals: true,
    },
  }),
);
