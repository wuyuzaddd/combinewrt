import { expect, test, type Page } from "@playwright/test";

const password = "ticket09-test-pass";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("管理员密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

async function openBuild(page: Page) {
  await page.goto("/build");
  await page.getByRole("button", { name: "最小系统" }).click();
  await page.getByLabel("Root 密码").fill("e2e-root-password");
}

async function addPackage(page: Page, name: string) {
  await page.getByPlaceholder("搜索软件包，至少 2 个字符").fill(name);
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
}

async function addFreeText(page: Page, name: string) {
  await page.getByPlaceholder("自由文本包名（目录中不存在也可添加），回车确认").fill(name);
  await page.getByRole("button", { name: "添加", exact: true }).click();
}

async function openPlan(page: Page, packages: string[] = []) {
  await login(page);
  await openBuild(page);
  for (const name of packages) await addPackage(page, name);
}

async function plan(page: Page) {
  await page.getByRole("button", { name: "生成构建计划" }).click();
  await expect(page.getByText("预计产物")).toBeVisible();
}

test("login, compose a three-source plan, build and download", async ({ page }) => {
  await openPlan(page, ["lucky", "luci-app-lucky", "luci-app-store", "luci"]);

  await plan(page);
  await expect(page.getByText(/lucky \[dllkids\]/)).toBeVisible();
  await expect(page.getByText(/luci-app-store \[自有\]/)).toBeVisible();

  await page.getByRole("button", { name: "开始构建" }).click();
  await expect(page).toHaveURL(/\/builds\/[0-9a-f-]+$/);

  await expect(page.getByRole("link", { name: /下载产物/ })).toBeVisible({ timeout: 45_000 });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /下载产物/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("build-fake-run");
});

test("same package name from two sources is rejected", async ({ page }) => {
  await openPlan(page, ["dual-package"]);
  await addFreeText(page, "dllkids/dual-package");
  await plan(page);
  await expect(page.getByText(/同时来自多个来源|更高优先级/).first()).toBeVisible();
});

test("a non-official kmod is rejected", async ({ page }) => {
  await openPlan(page);
  await addFreeText(page, "dllkids/kmod-demo");
  await plan(page);
  await expect(page.getByText(/kmod 只允许来自官方来源/)).toBeVisible();
});

test("a version that does not match the pinned source is rejected", async ({ page }) => {
  await openPlan(page);
  await addFreeText(page, "lucky@9.9.9");
  await plan(page);
  await expect(page.getByText(/请求版本 9.9.9/)).toBeVisible();
});

test("a dependency conflict is shown before dispatch", async ({ page }) => {
  await openPlan(page, ["dnsmasq", "dnsmasq-full"]);
  await plan(page);
  await expect(page.getByText(/dnsmasq 与 dnsmasq-full 不能同时安装/)).toBeVisible();
});

test("a succeeded build without an artifact warns instead of claiming success", async ({ page }) => {
  await login(page);
  await page.goto("/builds/missing-artifact");
  await expect(page.getByText(/没有找到可下载的产物/)).toBeVisible();
});

test("an unavailable package is reported without a catalog match", async ({ page }) => {
  await openPlan(page);
  await page.getByPlaceholder("搜索软件包，至少 2 个字符").fill("zzzz-not-in-catalog");
  await expect(page.getByRole("button", { name: /zzzz-not-in-catalog/ })).toHaveCount(0);
  await addFreeText(page, "zzzz-not-in-catalog");
  await plan(page);
  await expect(page.getByText(/目录中未找到：.*zzzz-not-in-catalog/)).toBeVisible();
});
