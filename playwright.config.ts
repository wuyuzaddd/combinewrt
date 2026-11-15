import { defineConfig } from "@playwright/test";

const passwordHash = "scrypt$06975e9cbb1a4c2146a81bea44850b2e$e5bcb99c01e818fe5ddf46186e8bea2064f2737fbc71ad396763b4adc4c529a52dbf29ba1978f082503d4473f4ddc5da28b0d5cb6c5b07ebffe75fe2d6f38619";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx scripts/seed-e2e.ts && npx next start -p 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_PATH: "/tmp/combinewrt-e2e.db",
      BUILD_ADAPTER: "fake",
      SESSION_SECRET: "ticket07-integration-secret-0123456789abcdef",
      ADMIN_PASSWORD_HASH: passwordHash,
      APP_ORIGIN: "http://127.0.0.1:3100",
      NODE_OPTIONS: "--dns-result-order=ipv4first",
    },
  },
});
