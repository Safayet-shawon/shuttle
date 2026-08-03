# EWU Shuttle Survey & Demand Analytics — PRD

## Original problem statement
Build a survey + analytics platform for East West University shuttle demand.
Students enter a strict `YYYY-S-DD-NNN@std.ewubd.edu` student-ID email, pick
route → weekdays → trips → payment plan → fare agreement → submit. Admin
sees a fully dynamic dashboard (no hardcoded numbers) with month filter,
KPIs, charts, heatmap, revenue, occupancy against 36-seat capacity, and an
AI-powered demand forecast (Claude Sonnet 5).

## Users
- **Student** (public) — completes survey via `@std.ewubd.edu` student ID
- **Admin** (auth) — monitors demand, controls test-vs-live mode, resets, bans, exports CSV

## Core requirements (static)
- Regex-locked EWU student email (`^\d{4}-\d-\d{2}-\d{3}@std\.ewubd\.edu$`)
- One response per student (server-side dedup)
- Chashara ↔ Rampura route active; other routes stored as contact leads
- 6 counted trips/day + 2 positioning legs
- Fares: monthly 115/230, semester 105/210 (per day, per direction pair)
- Total = weekly cost × 4 (monthly) or × 16 (semester)
- Dynamic aggregation only; no hardcoded numbers anywhere in the dashboard
- Test-vs-live survey mode; test rows flagged pink in CSV

## What's implemented (Feb 2026, iteration 2)
- **Iteration 1** — Full survey wizard, admin dashboard, Resend confirmations, Claude Sonnet 5 AI forecast
- **Iteration 2** — Rebranded `EWU Shuttle` → `Student Shuttle` (university reference stays only in student-email regex)
  - Masked student-ID email example: `2___-_-__-___@std.ewubd.edu` (no real IDs shown on the wizard)
  - Admin login email input is blank by default; default-credential hint removed
  - **Direction split widget** on admin dashboard — per weekday, two sub-cards: Chashara→Rampura (UP1/UP2/UP3, total vs 108 seats) and Rampura→Chashara (DOWN1/DOWN2/DOWN3, total vs 108 seats)
  - **Schedule manager tab** — admin sets semester start/end + toggles per-date working/off on a calendar grid (Fri/Sat auto-off)
  - **Working-day-aware pricing** — total = Σ (per-day rate × count of working occurrences of that weekday in scope); frontend live-fetches `/api/schedule/counts` for preview
  - New backend endpoints: `/api/schedule/counts`, `/api/admin/semester-config`, `/api/admin/schedule`
  - Analytics response now carries `direction_summary` and `direction_capacity`
- **Backend** (`/app/backend/server.py`) — FastAPI + Mongo + JWT admin auth
  - `/api/config`, `/api/survey/lookup`, `/api/survey/submit`
  - `/api/admin/login`, `/change-password`, `/survey/toggle`, `/reset`,
    `/ban`, `/unban`, `/banned`, `/leads`, `/available-months`,
    `/analytics`, `/responses`, `/export/csv`, `/forecast`
  - Resend email confirmation (Emergent-managed)
  - Claude Sonnet 5 demand forecast via `EMERGENT_LLM_KEY`
  - Auto-seed default admin on startup
- **Frontend** — React + Tailwind + shadcn + Recharts + Framer motion
  - Landing (`/`): hero, schedule table, fare table, ticker
  - Survey wizard (`/survey`): 7 steps, live pricing, lead-route branch
  - Admin login (`/admin/login`), Admin dashboard (`/admin`)
  - KPI cards, day/trip/route charts, occupancy heatmap
  - Responses table with pink test-data highlight
  - Tabs for Bans / Leads / Actions
  - Reset dialog + change-password dialog
- **Testing** — 22/22 backend pytest passing; frontend E2E full happy path passed

## Prioritized backlog (P0/P1/P2)
- **P1** WhatsApp confirmation via Twilio (skipped in v1 per user's request)
- **P1** Multi-language support (Banglish/Bangla UI toggle)
- **P2** Route heatmap over Bangladesh map (geoJSON overlay for Kuril/Farmgate demand)
- **P2** Auto-generated shuttle timetable PDF from analytics
- **P2** Public "results" view students can see once survey closes
- **P2** SMS OTP verification layer (backed by Twilio) if email regex isn't strict enough for the office

## Environment
- `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `EMERGENT_EMAIL_KEY`, `EMAIL_FROM_NAME`,
  `EMERGENT_LLM_KEY`, `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD` — all in `backend/.env`
- Admin credentials tracked at `/app/memory/test_credentials.md`
