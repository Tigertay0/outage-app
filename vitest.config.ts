import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // `server-only` throws outside a React Server Components build.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
