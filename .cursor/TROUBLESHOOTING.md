# Troubleshooting

## Unstyled or broken UI (black screen, plain white input/button, no card styling)

**Cause:** Stale Next.js build cache (`.next`) or CSS/chunk not loading.

**Fix:** From `transcriber-app`:

```bash
rm -rf .next
npm run build
npm run dev
```

Then hard-refresh the browser (Cmd+Shift+R / Ctrl+Shift+R) or open the app in a new tab.

## "Cannot find module './XXX.js'" (e.g. 948.js)

**Cause:** Webpack chunk IDs out of sync after code changes; old cached chunks referenced.

**Fix:** Same as above. Clear `.next`, rebuild, restart dev.

## Agent didn't verify

If the agent shipped a change without running the app or taking a screenshot, the project rules require:

1. Run `npm run build`
2. Run the app (`npm run dev`) and load the changed flow
3. Take a browser snapshot or screenshot and confirm the UI works

Do not accept "done" without verification.
