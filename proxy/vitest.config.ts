import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      OKX_ROUTER_BACKEND: "http://localhost:4002",
    },
  },
});
