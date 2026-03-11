# GitHub + Railway: Auto-deploy on push

**Repo created:** <https://github.com/superflytnt/transcriber-app> — code is already pushed.

You only need to **connect this repo in Railway** (one-time). After that, every push to `main` will trigger a rebuild and deploy.

---

## Connect the repo to Railway (do this once)

1. Go to **<https://railway.app>** and open your **transcriber2** project.
2. Click your service (**transcriber2**).
3. Open the **Settings** tab.
4. Under **Source** (or **Deploy**), find **Connect Repo** / **Deploy from GitHub**.
5. Click **Connect GitHub repo** and authorize Railway if asked.
6. Select the repo: **superflytnt/transcriber-app**.
7. Branch: **main**.
8. **Root Directory:** leave blank (the repo root is the app).
9. **Build Command:** `npm run build` (default).
10. **Start Command:** `node scripts/start.mjs` (or `npm run start`).
11. Save. Railway will build and deploy from the repo.

After this, **every push to `main`** will trigger a new build and deploy automatically.

---

## Environment variables on Railway

In Railway → your service → **Variables**, set:

- `REDIS_URL` – Redis connection string
- `OPENAI_API_KEY` – OpenAI API key

Optional: `UPLOAD_DIR`, `CHUNK_TARGET_MB`, `MAX_UPLOAD_MB`, etc. See `RAILWAY_CHECKLIST.md`.

---

## Quick reference

| Done | Item |
| ------ | ------ |
| ✓ | GitHub repo: <https://github.com/superflytnt/transcriber-app> (pushed) |
| You do | Railway → transcriber2 service → Settings → Connect Repo → **superflytnt/transcriber-app**, branch **main** |
| Then | Every `git push origin main` will auto-build and deploy on Railway |
