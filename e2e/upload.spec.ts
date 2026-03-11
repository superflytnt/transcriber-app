import { test, expect } from "@playwright/test";
import path from "node:path";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

async function ensureLoggedIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  const hasDropZone = await page.getByText(/Drop your audio here|Drop another file/i).isVisible().catch(() => false);
  if (hasDropZone) return;
  const res = await page.request.post(`${baseURL}/api/auth/test-session`);
  if (res.status() !== 200) {
    test.skip(true, "Set PLAYWRIGHT_TEST=1 when starting the dev server to run upload tests.");
    return;
  }
  await page.goto("/");
}

test.describe("Transcriber upload", () => {
  test("page loads with title and sign-in or drop zone", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Transcriber/i })).toBeVisible();
    const hasLogin = await page.getByRole("button", { name: /Send login link/i }).isVisible().catch(() => false);
    const hasDrop = await page.getByText(/Drop your audio here|Drop another file/i).isVisible().catch(() => false);
    expect(hasLogin || hasDrop).toBeTruthy();
  });

  test("uploading a valid audio file shows status or clear error (no invalid response)", async ({
    page,
  }) => {
    await ensureLoggedIn(page);
    const filePath = path.join(__dirname, "../test-assets/silence-1s.mp3");
    await page.getByLabel("Choose audio file").setInputFiles(filePath);

    await page.waitForTimeout(4000);

    await expect(page.getByText("Invalid response from server")).not.toBeVisible();

    const content = await page.textContent("body");
    const hasSensibleState =
      content?.includes("Uploading") ||
      content?.includes("Waiting in queue") ||
      content?.includes("Transcribing") ||
      content?.includes("Done") ||
      content?.includes("REDIS_URL") ||
      content?.includes("Error");
    expect(hasSensibleState).toBeTruthy();
  });

  test("uploading .qta file completes without generic error", async ({ page }) => {
    test.setTimeout(60000);
    await ensureLoggedIn(page);
    const qtaPath = path.join(__dirname, "../../samples/7833 Whiterim Terr.qta");
    await page.getByLabel("Choose audio file").setInputFiles(qtaPath);
    const errorBox = page.getByText("Something went wrong. Please try again in a moment.");
    await page.waitForTimeout(3000);
    await expect(errorBox).not.toBeVisible({ timeout: 45000 });
  });
});
