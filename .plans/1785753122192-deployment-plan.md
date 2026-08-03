# MenuLens Production Deployment Plan

> **Goal:** Deploy MenuLens online so anyone can use it — HTTPS domain, persistent data,
> working OCR (including the Python layers), background enrichment, and monitoring.

---

## 0. Architecture constraints (they decide the platform)

MenuLens is **not a serverless app**. Three things force a real long-running server:

| Constraint | Why | Serverless (Vercel) impact |
|---|---|---|
| Local JSON-file DB in `data/` | `src/lib/mongodb.ts` is a JSON-file store (scans, dishes, users, agent_log, csrf-secret) | Ephemeral FS — data lost on every deploy |
| Python OCR subprocess | `src/scripts/menu_ocr.py` (pytesseract+PIL+scipy) + `rapidocr_scan.py` (RapidOCR/ONNX) are the **primary** offline reader | No Python subprocess allowed |
| In-process background worker | `startWorker()` in `src/lib/agent/queue.ts` enriches dishes after scans | No long-lived process |

**Conclusion:** deploy on a **VPS** (recommended) or a **PaaS with persistent disk + Docker** (Railway/Render). Vercel would require a full refactor (real DB, external OCR service) — not this plan.

---

## 1. Platform & cost decision

### Option A — VPS (RECOMMENDED) — ~$6–8/mo
Full control; Python OCR works out of the box; cheapest.

| Item | Cost |
|---|---|
| Hetzner CX22 (2 vCPU / 4 GB RAM) or DigitalOcean basic 4 GB | ~$5–6/mo |
| Domain (Porkbun / Cloudflare Registrar) | ~$10/yr |
| OpenRouter credits (for AI enrichment) | $5 one-time lasts a long time |
| **Total** | **~$7/mo** |

### Option B — PaaS (Railway / Render) — ~$7–15/mo
Easier deploys (git push → deploy) but needs a `Dockerfile` that installs
Node + Python + tesseract + all OCR deps, plus a persistent volume for `data/`.
More expensive, less control. Good if you don't want to manage a server.

**This plan follows Option A.** Option B is sketched in the appendix.

---

## 2. Pre-flight checklist (Phase 0 — accounts & keys)

- [ ] **Domain** bought (e.g. `menulens.example`) — needed for HTTPS.
- [ ] **VPS** created (Ubuntu 24.04, ≥4 GB RAM; add 2 GB swap if 2 GB).
- [ ] **API keys** ready (copy from `.env.local`):
  - `OPENROUTER_API_KEY` — add **$5–10 credits** (free tier caps at 50 req/day, not enough for public use)
  - `GROQ_API_KEY` — free tier is generous; good fallback
  - Optional: `GEMINI_API_KEY`, `UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY`, `USDA_API_KEY`
- [ ] **`NEXTAUTH_SECRET`** generated: `openssl rand -base64 32`
- [ ] GitHub repo is pushed (done — `main` is at `e1ea172`).

---

## 3. Repo prep (Phase 1 — small, safe changes)

1. **Pin Node in `package.json`** (add `engines` block so the server uses a known-good version):
   ```json
   "engines": { "node": ">=20" }
   ```
2. **Explicitly wire `NEXTAUTH_SECRET`** in `src/lib/auth/options.ts` (NextAuth auto-reads
   the env var, but explicit is safer; JWT sessions otherwise break on every restart):
   ```ts
   secret: process.env.NEXTAUTH_SECRET,
   ```
3. **Commit + push**:
   ```bash
   git add package.json src/lib/auth/options.ts
   git commit -m "chore: pin Node engine, wire NEXTAUTH_SECRET"
   git push origin main
   ```
4. *(Optional but recommended)* Add a `Dockerfile` if you want the Railway/Render path later.

**Validation:** `npm run check` passes; dev server still boots.

---

## 4. VPS provisioning (Phase 2)

```bash
# SSH in as root
ssh root@<SERVER_IP>

# 1. Update + base packages
apt update && apt upgrade -y
apt install -y curl git build-essential python3 python3-pip python3-venv \
               tesseract-ocr unzip ufw

# 2. Create deploy user (no password SSH)
adduser deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh

# 3. Firewall
ufw allow OpenSSH
ufw allow 80,443/tcp
ufw --force enable

# 4. Swap (protects `next build` from OOM on small VPSes)
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## 5. Runtime install (Phase 3 — Node, Python OCR deps)

```bash
# Node 22 LTS (Next.js 15 requirement)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v   # v22.x

# Python OCR deps — in a venv (AGENTS.md: menu_ocr.py needs pytesseract/PIL/scipy;
# rapidocr_scan.py needs the `rapidocr` package which bundles onnxruntime + PP-OCR models)
sudo -u deploy bash -c '
  cd /home/deploy && python3 -m venv menulens-venv
  /home/deploy/menulens-venv/bin/pip install pytesseract pillow scipy numpy rapidocr
'
tesseract --version   # verify the binary
```

> **Note:** `food_classifier.py` needs torch/torchvision (~2 GB) — **skip it** unless you
> use that feature. The main OCR path doesn't need it.

---

## 6. App deploy (Phase 4)

```bash
sudo -u deploy bash -c '
  cd /home/deploy
  git clone https://github.com/Saad-Ahmad-code/project.git menulens
  cd menulens
  npm ci
  cp /home/deploy/.env.local .env.local   # your keys — NEVER committed
'
```

Create `/home/deploy/menulens/.env.local` (production values):

```bash
# ── AI providers ──────────────────────────────
OPENROUTER_API_KEY=sk-or-...
GROQ_API_KEY=gsk_...
# GEMINI_API_KEY=...           # optional fallback
# UNSPLASH_ACCESS_KEY=...      # optional image search
# PEXELS_API_KEY=...
# USDA_API_KEY=...

# ── Auth ──────────────────────────────────────
NEXTAUTH_URL=https://menulens.example
NEXTAUTH_SECRET=<openssl rand -base64 32>

# ── Python OCR (AGENTS.md: point at the venv) ─
PYTHON_CMD=/home/deploy/menulens-venv/bin/python

# ── Ollama: off until you install it on the server ─
OLLAMA_REFINE=0
OLLAMA_VISION=0
OLLAMA_CLEAN=0

# ── Misc ──────────────────────────────────────
LOG_LEVEL=info
```

Build + start (⚠ AGENTS.md rule 2: no dev server running — this is a fresh clone, fine):

```bash
cd /home/deploy/menulens
npm run build

# Process manager: auto-restart, survives reboot
npm install -g pm2
pm2 start npm --name menulens -- start
pm2 save
pm2 startup   # follow its instructions to enable boot persistence
```

**Verify:** `curl -s http://127.0.0.1:3000/api/diagnostics?mode=quick`

---

## 7. HTTPS + reverse proxy (Phase 5 — Caddy, zero-config TLS)

```bash
apt install -y caddy

cat > /etc/caddy/Caddyfile <<'EOF'
menulens.example {
    reverse_proxy 127.0.0.1:3000
    encode gzip
    header {
        -Server
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
    }
}
EOF

systemctl enable --now caddy
```

Caddy fetches the Let's Encrypt cert automatically. **Point your domain's DNS `A` record
at the VPS IP first.** (Free bonus: put Cloudflare in front of DNS for CDN + DDoS protection.)

---

## 8. Data persistence & backups (Phase 6)

`data/` is the entire database (scans, dishes, users, agent_log, csrf-secret). Back it up:

```bash
# Daily tar backup + prune >7 days
cat > /etc/cron.daily/menulens-backup <<'EOF'
#!/bin/sh
mkdir -p /home/deploy/backups
tar czf /home/deploy/backups/menulens-$(date +\%F).tar.gz \
  -C /home/deploy/menulens data .env.local
find /home/deploy/backups -name 'menulens-*' -mtime +7 -delete
EOF
chmod +x /etc/cron.daily/menulens-backup
```

Optional off-site: `rclone` to Backblaze B2 (~$0.005/GB/mo).

---

## 9. Launch & verify (Phase 7)

| Check | Command / URL | Expected |
|---|---|---|
| App up | `https://menulens.example` | 200, landing page |
| Diagnostics | `/api/diagnostics?mode=quick` | `"status":"ok"`, scans/dishes counts |
| Full health | `/api/diagnostics` | `ollama` row shows `unreachable` (fine — disabled) |
| Admin gate | `/api/admin/ai-health` (logged out) | 401 |
| **End-to-end scan** | Upload a menu photo via `/scan` | SSE stream → done → dishes + enrichment |
| Register | `/auth/register` | user saved to `data/users.json` |
| Make yourself admin | `nano data/users.json` → set `"isAdmin": true` on your user | admin pages work |

**Enrichment check:** watch `pm2 logs menulens` — dishes should enrich via Groq/OpenRouter
(remember: OpenRouter free tier = 50 req/day; with credits it unlocks 1000/day).

---

## 10. Monitor & maintain (Phase 8)

```bash
pm2 logs menulens           # tail app logs
pm2 monit                   # CPU/mem per process
journalctl -u caddy -f      # proxy + TLS logs
```

- **UptimeRobot** (free): HTTP heartbeat on `https://menulens.example/api/diagnostics?mode=quick` — alerts on downtime.
- **Log rotation:** PM2 handles stdout; `data/logs/errors.jsonl` grows slowly — covered by the daily backup prune.
- **Deploys:** `git pull && npm ci && npm run build && pm2 restart menulens` (or wire a webhook).

---

## 11. Post-launch (Phase 9 — optional)

- [ ] **Install Ollama on the VPS** (`curl -fsSL https://ollama.com/install.sh | sh`) + pull
      `gemma4:e2b` and `qwen2.5vl:3b`, then set `OLLAMA_REFINE=1` for free local refinement.
- [ ] **Real rate limits / abuse control** — app already has per-IP sliding window
      (`src/lib/config.ts` `RATE_LIMIT_MAX`); tune after launch.
- [ ] **MongoDB migration** (only if data grows past ~100k docs): swap `src/lib/mongodb.ts`
      for real MongoDB — the storage wrapper was already typed for this (`db-types.ts`).
- [ ] **CI/CD**: GitHub Actions build + test on push (run `npm run check` + `npm test`).

---

## Risks & open questions

| Risk | Mitigation |
|---|---|
| OpenRouter 429s under public load | Credits ($5–10) unlock 1000 free req/day; Groq fallback; per-model circuit breaker already wired |
| `next build` OOM on small VPS | 4 GB RAM or 2 GB swap (Phase 2) |
| Data loss (JSON DB) | Daily cron backups + optional off-site |
| SQL-injection style abuse | App has CSRF + rate limiting; add Cloudflare WAF if needed |
| OneDrive-synced dev machine ≠ server | Server is a clean clone; never rsync the working tree, only `data/` for restore |

**Open questions for you:**
1. Do you own a domain already, or should the plan assume buying one?
2. VPS provider preference (Hetzner / DigitalOcean / other)?
3. Do you want the Docker/PaaS path (Railway) instead of a raw VPS?

---

## Appendix — Option B: Railway/Render (Docker) sketch

1. Add `Dockerfile` (multi-stage): `node:22-slim` base → install `tesseract-ocr`,
   `python3`, `pip` → `pip install pytesseract pillow scipy numpy rapidocr` →
   `npm ci && npm run build` → `CMD ["npm","start"]`.
2. Mount a **persistent volume at `/app/data`** (Railway Volumes / Render Disk).
3. Set the same `.env.local` vars in the dashboard; deploy from GitHub.
4. Railway gives you `*.up.railway.app` HTTPS automatically; bring your domain later.

---

*Plan created 2026-08-03. Repo at commit `e1ea172` (pushed).*
