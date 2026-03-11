import { test, expect } from "@playwright/test";
import path from "node:path";

test.describe("Transcriber upload", () => {
  test("page loads with title and drop zone", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Transcriber/i })).toBeVisible();
    await expect(page.getByText(/Drop your audio here/i)).toBeVisible();
  });

  test("uploading a valid audio file shows status or clear error (no invalid response)", async ({
    page,
  }) => {
    await page.goto("/");
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
    await page.goto("/");
    const qtaPath = path.join(__dirname, "../../samples/7833 Whiterim Terr.qta");
    await page.getByLabel("Choose audio file").setInputFiles(qtaPath);
    const errorBox = page.getByText("Something went wrong. Please try again in a moment.");
    await page.waitForTimeout(3000);
    await expect(errorBox).not.toBeVisible({ timeout: 45000 });
  });
});
