# Reka Fine Arts — Links Reference

## ⭐ Quick access (the 5 you need)

| # | What | URL |
|---|---|---|
| 1 | **Live site** | https://rekagallery.vip |
| 2 | **Local site** | http://localhost:5173 |
| 3 | **Deploy actions** | https://github.com/nanda0210/rekafinearts-site/actions |
| 4 | **Admin (live)** | https://rekagallery.vip/admin |
| 4 | **Admin (local)** | http://localhost:5173/admin |
| 5 | **cPanel login** | https://fiber23-r.iaasdns.com:2083/ |

**cPanel credentials**
- Username: `rekagallery`
- Password: *(stored only in `.env` locally — never commit)*

---

## Live (production)

| What | URL |
|---|---|
| Public site | https://rekagallery.vip |
| Admin page | https://rekagallery.vip/admin |
| Contact form | https://rekagallery.vip/contact |
| Deploy manager (local-only notice on prod) | https://rekagallery.vip/deploy |
| Backend API (Render) | https://rekafinearts-site.onrender.com |

## Local development

| What | URL |
|---|---|
| Frontend (Vite) | http://localhost:5173 |
| Admin (local) | http://localhost:5173/admin |
| Deploy Manager (local) | http://localhost:5173/deploy |
| Backend API | http://localhost:3002 |
| Local Manager | http://localhost:3003 |

## Source / dashboards

| What | URL |
|---|---|
| GitHub repo | https://github.com/nanda0210/rekafinearts-site |
| Recent commits | https://github.com/nanda0210/rekafinearts-site/commits/main |
| Render dashboard | https://dashboard.render.com |
| GitHub installations (Render access) | https://github.com/settings/installations |

## cPanel / hosting

| What | Value |
|---|---|
| FTP host | `fiber23-r.iaasdns.com` |
| FTP user | `rekagallery` |
| Remote directory | `public_html` |
| cPanel login | hosting portal at the same provider as the FTP host |

> FTP password is in `.env` (not committed). Don't paste it into chat or commits.

## Local paths

| What | Path |
|---|---|
| Project root | `/Users/rajamac/Documents/rprojects/rekafinearts-site` |
| `.env` (FTP + email creds) | `/Users/rajamac/Documents/rprojects/rekafinearts-site/.env` |
| Local DB (SQLite) | `/Users/rajamac/Documents/rprojects/rekafinearts-site/rekafinearts.db` |
| Build output | `/Users/rajamac/Documents/rprojects/rekafinearts-site/dist` |
| Image folders | `public/images/{gallery,advanced,intermediate,beginners,kidsart,hero-open}` |

## Quick commands

```bash
# Local dev (two terminals)
cd /Users/rajamac/Documents/rprojects/rekafinearts-site
node server.cjs                 # backend on :3002
npm run dev                     # frontend on :5173

# Deploy frontend to cPanel via FTP
node scripts/deploy-cpanel.mjs

# Initialize / reset DB
node init-db.cjs

# Regenerate image manifest (after adding/renaming images)
python3 generate-image-data.py
```

## Production env var (when comments backend is live)

After the Render service is "Live", create `.env.production` in the project root:

```
VITE_API_BASE_URL=https://<your-render-url>.onrender.com
```

Then rebuild + redeploy the frontend:

```bash
node scripts/deploy-cpanel.mjs
```

The frontend's API base auto-switches: `localhost:3002` in dev, `VITE_API_BASE_URL` on the live site.

## Sister project (cross-reference)

| What | URL |
|---|---|
| Edge Advisor live | https://nanda0210.github.io/edge-advisor/ |
| Edge Advisor backend (Render) | https://edge-advisor-api.onrender.com |
| Edge Advisor repo | https://github.com/nanda0210/edge-advisor |
