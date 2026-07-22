import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      TELEGRAM_BOT_TOKEN: "000000000:test-token",
      DATABASE_URL: "postgresql://threadwise:threadwise@localhost:5432/threadwise_test"
    }
  }
});

