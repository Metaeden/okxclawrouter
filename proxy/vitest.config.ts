import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    env: {
      OKCLAWROUTER_BACKEND: "http://localhost:4002",
    },
  },
});
