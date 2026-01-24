# 📬 Mailboy 2026

**Ultra-Fast Hybrid Webmail Client** built for speed, privacy, and massive inbox syncing.
Mailboy uses a "Worker Swarm" architecture to sync thousands of emails via IMAP while providing a modern, reactive UI.

![Status](https://img.shields.io/badge/Status-Stable-success)
![Version](https://img.shields.io/badge/Version-v12.75-blue)

---

## ⚡ Features

* **Hybrid Sync Engine:**
    * **L1 Memory Cache:** Instant UI navigation.
    * **L2 Persistent Store:** MongoDB for offline access and history.
    * **Worker Swarm:** 10 concurrent background workers for parallel IMAP fetching.
* **Smart UI:**
    * **Compact Mode:** Outlook-style full-width rows for high information density.
    * **Split View:** Reading pane that perfectly aligns with the header layout.
    * **Logo Engine:** Auto-fetches brand logos (Google, Brandfetch, Logo.dev) or generates vector monograms based on the root domain.
* **DevOps Ready:** Fully containerized with Docker & Docker Compose.

---

## 🛠️ Tech Stack

* **Frontend:** React 18, TypeScript, Tailwind CSS, Vite.
* **Backend:** Node.js (v20), Express, `tsx` (TypeScript Execution).
* **Database:** MongoDB (Metadata & Body text).
* **Caching & Queues:** Redis (Job queues, Image caching, Session locks).
* **Email Protocol:** IMAP (via `imapflow`).

---

## 🚀 Quick Start (Docker)

This is the recommended way to run Mailboy. It spins up the App, Redis, and MongoDB in orchestrated containers.

### 1. Prerequisites
* Docker & Docker Compose installed.
* Git installed.

### 2. Clone & Run
```bash
git clone [https://github.com/YOUR_USERNAME/mailboy.git](https://github.com/YOUR_USERNAME/mailboy.git)
cd mailboy

# Start the system (builds images if missing)
docker compose up -d --build

The app will be available at: http://localhost:3001

3. Stopping the App
Bash

# Stop containers
docker compose down

# Stop and wipe all data (Factory Reset)
docker compose down -v
🔧 Maintenance & Troubleshooting
Use these commands if you modify backend files or need to fix a stuck state.

1. Nuclear Rebuild (Fixes "File Not Found" or Stale Code)
If you add new files (e.g., db.ts) and Docker ignores them, run this chain to force a clean build:

Bash

docker compose down --volumes --remove-orphans && \
docker compose build --no-cache && \
docker compose up -d
2. View Live Logs
See what the Worker Swarm is doing in real-time:

Bash

docker logs -f mailboy_app
3. API Reset (Soft Wipe)
If the sync gets stuck or you want to clear all data without restarting Docker:

Bash

# Wipes Database, Redis, and kills all active Workers
curl -X DELETE http://localhost:3001/api/v1/debug/reset
📦 Version Control (Git Workflow)
Standard commands to save your progress and tag stable releases.

Saving Changes
Bash

git add .
git commit -m "feat: description of changes"
git push
Tagging a Stable Release
When the system is stable (like v12.75), tag it so you can revert easily:

Bash

git tag v12.75-stable
git push --tags
💻 Manual Development Setup
If you want to run the code locally without Docker (for debugging):

1. Install Dependencies
Bash

npm install
2. Start Infrastructure (You still need DBs)
You need Redis (port 6380) and MongoDB (port 27017) running.

Bash

# Spin up just the databases
docker compose up -d mailboy_redis mailboy_mongo
3. Build Frontend & Run Server
Bash

# Build the React frontend to /dist
npm run build

# Start the Backend (which serves the frontend)
npx tsx server.ts
📂 Project Structure (Modular Backend)
server.ts: The entry point. Handles API routes (/api/v1/...) and Express config.

workers.ts: The heavy lifter. Manages the IMAP connection pool, sync queues, and background jobs.

db.ts: Database connection logic (Mongoose & Redis) and Schema definitions.

logo-engine.ts: Logic for resolving brand logos and generating SVGs.

components/: React UI components (EmailList.tsx, EmailDetail.tsx).

📜 License
Private / Proprietary.