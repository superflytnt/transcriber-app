#!/usr/bin/env node
/**
 * Opens the app in a browser and checks the UI. Run with: node scripts/ui-check.mjs
 * Requires: npx playwright install chromium (one-time)
 */
import { chromium } from "playwright";

const baseURL = process.env.BASE_URL || "http://localhost:3000";

async function main() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(baseURL, { waitUntil: "networkidle" });

    // Snapshot visible text for inspection
    const title = await page.title();
    const heading = await page.locator("h1").first().textContent().catch(() => "");
    const dropText = await page.locator("p.text-xl").first().textContent().catch(() => "");
    const subText = await page.locator("p.text-sm.text-zinc-500").first().textContent().catch(() => "");
    const summary = await page.locator("summary").first().textContent().catch(() => "");

    console.log("=== UI check ===");
    console.log("Title:", title);
    console.log("H1:", heading);
    console.log("Drop zone main:", dropText);
    console.log("Drop zone sub:", subText);
    console.log("Optional section:", summary);

    // Take screenshot for visual inspection
    await page.screenshot({ path: "scripts/ui-screenshot.png", fullPage: true });
    console.log("Screenshot saved: scripts/ui-screenshot.png");

    const hasDropZone = (await page.locator('[role="button"]').count()) > 0;
    const hasFileInput = (await page.locator('input[type="file"]').count()) > 0;
    console.log("Drop zone (role=button):", hasDropZone);
    console.log("File input (hidden):", hasFileInput);

    if (title !== "Transcriber") throw new Error("Expected title Transcriber");
    if (!heading?.toLowerCase().includes("transcriber")) throw new Error("Expected Transcriber heading");
    if (!dropText?.toLowerCase().includes("drop")) throw new Error("Expected drop zone text");
    console.log("\nAll checks passed.");
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await browser?.close();
  }
}

main();
