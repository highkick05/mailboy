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
git clone [https://github.com/highkick05/mailboy.git](https://github.com/highkick05/mailboy.git)
cd mailboy

# Start the system (builds images if missing)
docker compose up -d --build