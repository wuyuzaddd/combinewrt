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
  await page.getByLabel("Root 密码").fill("e2e-root-password");
}

async function addFromSearch(page: Page, name: string) {
  await page.getByPlaceholder("搜索软件包，至少 2 个字符").fill(name);
  await page.getByRole("button", { name: new RegExp(`^${name}(\\s|$)`) }).first().click();
}

test("Simple mode builds a V2 plan and the source offer carries V2 fields", async ({ page }) => {
  await login(page);
  await openBuild(page);
  await page.getByRole("button", { name: "最小系统" }).click();
  await addFromSearch(page, "luci");

  await page.getByRole("button", { name: "生成构建计划" }).click();
  await expect(page.getByText("V2 计划 · 提交后进入队列")).toBeVisible();
  await expect(page.getByText(/target：x86\/64/)).toBeVisible();
  // Simple mode must not expose kernel-line internals.
  await expect(page.getByText(/内核：6.12/)).toHaveCount(0);
  await expect(page.getByText("镜像 feed set")).toBeVisible();

  await page.getByRole("button", { name: "开始构建" }).click();
  await expect(page).toHaveURL(/\/builds\/[0-9a-f-]+$/);
  await expect(page.getByText(/排队中|已派发|运行中/).first()).toBeVisible();
  await expect(page.getByText("已完成").first()).toBeVisible({ timeout: 60_000 });

  await page.getByRole("link", { name: "源码清单" }).click();
  await expect(page.getByText("V2 构建组合")).toBeVisible();
  await expect(page.getByText("获取策略（strategy / fallback）")).toBeVisible();
  await expect(page.getByText("imagebuilder").first()).toBeVisible();
  await expect(page.getByText("镜像 feed set")).toBeVisible();
});

test("Advanced mode conflict is rejected with a readable 409", async ({ page }) => {
  await login(page);
  await openBuild(page);
  await page.getByRole("button", { name: "Advanced 模式" }).click();

  // Docker is only offered on the source engine: select 6.6 first so the mode
  // can be chosen, then switch back to 6.12 to create the conflict the server
  // must reject with a readable reason.
  await page.locator("label").filter({ hasText: "6.6 · 源码构建" }).first().click();
  await page.getByRole("checkbox", { name: /Docker/ }).check();
  await page.locator("label").filter({ hasText: "6.12 · ImageBuilder" }).first().click();

  await page.getByRole("button", { name: "生成构建计划" }).click();
  await expect(page.getByText(/requires the source engine/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "开始构建" })).toBeDisabled();
});

test("an unsupported variant is disabled with a readable reason", async ({ page }) => {
  await login(page);
  await page.goto("/build");

  const emmc = page.getByRole("radio", { name: /eMMC/ }).first();
  await expect(emmc).toBeDisabled();
  await expect(page.getByText(/deferred: eMMC/).first()).toBeVisible();
});

test("a V1 build page and source offer stay readable", async ({ page }) => {
  await login(page);
  await page.goto("/builds/missing-artifact");

  await expect(
    page.getByText("immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz").first(),
  ).toBeVisible();
  await expect(page.getByText(/产物 combined/).first()).toBeVisible();
  await expect(page.getByText(/没有找到可下载的产物/)).toBeVisible();

  await page.getByRole("link", { name: "源码清单" }).click();
  await expect(page.getByText("源码与来源清单")).toBeVisible();
  await expect(page.getByText("V2 构建组合")).toHaveCount(0);
});
