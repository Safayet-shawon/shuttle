"""Student Shuttle Survey & Demand Analytics — Backend API.

All business rules (fares, trip schedule, capacity) live here; the UI reads
them from `/api/config` so nothing is hard-coded on the client.
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import os
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import bcrypt
import httpx
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------- Mongo ----------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# ---------- Constants ----------
STUDENT_EMAIL_RE = re.compile(r"^\d{4}-\d-\d{2}-\d{3}@std\.ewubd\.edu$")
CAPACITY = 36
JWT_SECRET = os.environ.get("JWT_SECRET", "change-me")
JWT_ALG = "HS256"

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "Student Shuttle")
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

TRIPS = [
    {"id": "UP1", "direction": "up", "label": "7:00 AM — Chashara → Rampura",
     "note": "Arrive for the 8:30 AM class", "start": "07:00", "end": "08:20"},
    {"id": "UP2", "direction": "up", "label": "10:20 AM — Chashara → Rampura",
     "note": "Arrive for the 11:50 AM class", "start": "10:20", "end": "11:40"},
    {"id": "UP3", "direction": "up", "label": "1:40 PM — Chashara → Rampura",
     "note": "Arrive for the 3:10 PM class", "start": "13:40", "end": "15:00"},
    {"id": "DOWN1", "direction": "down", "label": "12:10 PM — Rampura → Chashara",
     "note": "Return home (1st down)", "start": "12:10", "end": "13:30"},
    {"id": "DOWN2", "direction": "down", "label": "3:20 PM — Rampura → Chashara",
     "note": "Return home (2nd down)", "start": "15:20", "end": "17:00"},
    {"id": "DOWN3", "direction": "down", "label": "6:30 PM — Rampura → Chashara",
     "note": "Return home (3rd down)", "start": "18:30", "end": "20:00"},
]

# Positioning legs — visible on landing page but not selectable for pricing.
POSITIONING_LEGS = [
    {"label": "8:40 AM — Rampura → Chashara", "note": "Positioning leg (not counted)"},
    {"label": "5:00 PM — Chashara → Rampura", "note": "Positioning leg (not counted)"},
]

DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"]

# Python's `date.weekday()` → 0=Mon … 6=Sun. Map back to weekday names we use.
WEEKDAY_INDEX_TO_NAME = {
    0: "Monday", 1: "Tuesday", 2: "Wednesday", 3: "Thursday",
    4: "Friday", 5: "Saturday", 6: "Sunday",
}
DEFAULT_OFF_WEEKDAYS = {4, 5}  # Friday, Saturday — always off unless explicitly enabled
DEFAULT_SEMESTER_START = "2026-09-01"
DEFAULT_SEMESTER_END = "2026-12-31"
DEFAULT_SEMESTER_LABEL = "Fall 2026"

FARES = {
    "monthly":  {"one_way": 115, "round_trip": 230, "weeks": 4,
                 "label": "Pay Monthly", "note": "Renewed every month"},
    "semester": {"one_way": 105, "round_trip": 210, "weeks": 16,
                 "label": "Pay Per Semester", "note": "Best value — 4 months upfront"},
}

ROUTES = [
    {"id": "chashara_rampura",
     "label": "Rampura ↔ Chashara",
     "via": "Staff Quarter • Chittagong Road • Signboard",
     "supported": True, "default": True},
    {"id": "rampura_uttara_kuril",
     "label": "Rampura ↔ Uttara via Kuril",
     "via": "Kuril interchange", "supported": False},
    {"id": "rampura_uttara_elevated",
     "label": "Rampura ↔ Uttara via Elevated Expressway",
     "via": "Elevated expressway", "supported": False},
    {"id": "rampura_mohammadpur",
     "label": "Rampura ↔ Mohammadpur via Farmgate",
     "via": "Farmgate corridor", "supported": False},
]

# ---------- Pydantic models ----------
class SurveySubmit(BaseModel):
    email: str
    name: str
    phone: str
    month: str  # YYYY-MM
    route_id: str
    days: List[str] = Field(default_factory=list)
    trips_per_day: Dict[str, List[str]] = Field(default_factory=dict)
    payment_plan: str = "monthly"
    fare_agreed: bool = True
    proposed_fare: Optional[float] = None


class LeadSubmit(BaseModel):
    name: str
    phone: str
    email: str
    route_id: str
    note: Optional[str] = ""


class AdminLogin(BaseModel):
    email: str
    password: str


class ChangePassword(BaseModel):
    old_password: str
    new_password: str


class ToggleSurvey(BaseModel):
    is_started: bool


class ResetRequest(BaseModel):
    reason: str  # 'testing' | 'month_end'


class BanRequest(BaseModel):
    email: str
    reason: Optional[str] = ""


class LookupRequest(BaseModel):
    email: str


class SemesterConfig(BaseModel):
    label: str
    start_date: str  # YYYY-MM-DD
    end_date: str    # YYYY-MM-DD


class ScheduleToggle(BaseModel):
    date: str        # YYYY-MM-DD
    is_working: bool


# ---------- Utilities ----------
def hash_pw(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_pw(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False


def issue_token(email: str) -> str:
    payload = {
        "sub": email,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def compute_price(
    trips_per_day: Dict[str, List[str]],
    payment_plan: str,
    day_counts: Dict[str, int],
):
    """Price = Σ (per-day rate × number of times that weekday actually runs).

    `day_counts` comes from admin's calendar — only working (green) days count.
    """
    fare = FARES[payment_plan]
    per_day_details: Dict[str, Dict[str, Any]] = {}
    total = 0
    for day, trips in trips_per_day.items():
        if not trips:
            continue
        has_up = any(t.startswith("UP") for t in trips)
        has_down = any(t.startswith("DOWN") for t in trips)
        rate = fare["round_trip"] if (has_up and has_down) else fare["one_way"]
        occurrences = int(day_counts.get(day, 0))
        subtotal = rate * occurrences
        per_day_details[day] = {
            "rate": rate,
            "occurrences": occurrences,
            "subtotal": subtotal,
            "type": "round_trip" if (has_up and has_down) else "one_way",
        }
        total += subtotal
    return total, per_day_details


def daterange(start_d: date, end_d: date):
    """Inclusive iterator over dates from start_d to end_d."""
    d = start_d
    while d <= end_d:
        yield d
        d += timedelta(days=1)


def parse_iso_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


async def get_working_day_counts(start_iso: str, end_iso: str) -> Dict[str, int]:
    """Return count of *working* days per weekday between start & end (inclusive).

    Defaults: Sun–Thu working, Fri/Sat off. Admin overrides in
    `working_day_overrides` collection change any specific date's flag.
    """
    counts = {d: 0 for d in DAYS}
    if not start_iso or not end_iso:
        return counts
    start_d = parse_iso_date(start_iso)
    end_d = parse_iso_date(end_iso)
    if end_d < start_d:
        return counts

    overrides = await db.working_day_overrides.find(
        {"date": {"$gte": start_iso, "$lte": end_iso}}, {"_id": 0}
    ).to_list(None)
    override_map = {o["date"]: bool(o.get("is_working", False)) for o in overrides}

    for d in daterange(start_d, end_d):
        weekday_name = WEEKDAY_INDEX_TO_NAME[d.weekday()]
        default_working = d.weekday() not in DEFAULT_OFF_WEEKDAYS
        is_working = override_map.get(d.isoformat(), default_working)
        if is_working and weekday_name in counts:
            counts[weekday_name] += 1
    return counts


async def get_scope_dates(payment_plan: str, month: Optional[str]) -> tuple:
    """Return (start_iso, end_iso) for pricing scope.

    Monthly plan → the calendar month the student is starting.
    Semester plan → from that starting month up to semester end.
    """
    sem = await db.semester_config.find_one({"_key": "current"}, {"_id": 0}) or {}
    sem_start = sem.get("start_date", DEFAULT_SEMESTER_START)
    sem_end = sem.get("end_date", DEFAULT_SEMESTER_END)

    if payment_plan == "semester":
        if month:
            month_start = f"{month}-01"
            start = max(month_start, sem_start)
        else:
            start = sem_start
        return start, sem_end

    # monthly
    if month:
        year, mo = month.split("-")
        year_i, mo_i = int(year), int(mo)
        first = date(year_i, mo_i, 1)
        if mo_i == 12:
            last = date(year_i + 1, 1, 1) - timedelta(days=1)
        else:
            last = date(year_i, mo_i + 1, 1) - timedelta(days=1)
        return first.isoformat(), last.isoformat()
    return sem_start, sem_end


# ---------- App ----------
app = FastAPI(title="Student Shuttle API")
api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)


async def require_admin(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)):
    if not creds:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
        email = payload.get("sub")
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    admin = await db.admins.find_one({"email": email}, {"_id": 0})
    if not admin:
        raise HTTPException(401, "Admin account not found")
    return admin


@app.on_event("startup")
async def startup():
    if await db.admins.count_documents({}) == 0:
        await db.admins.insert_one({
            "id": str(uuid.uuid4()),
            "email": os.environ.get("ADMIN_EMAIL", "admin@ewushuttle.com").lower(),
            "password": hash_pw(os.environ.get("ADMIN_INITIAL_PASSWORD", "Admin@123")),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    if await db.survey_state.count_documents({}) == 0:
        await db.survey_state.insert_one({
            "_key": "state",
            "is_started": False,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    if await db.semester_config.count_documents({}) == 0:
        await db.semester_config.insert_one({
            "_key": "current",
            "label": DEFAULT_SEMESTER_LABEL,
            "start_date": DEFAULT_SEMESTER_START,
            "end_date": DEFAULT_SEMESTER_END,
        })


# ---------- Public endpoints ----------
@api.get("/")
async def root():
    return {"service": "Student Shuttle API", "status": "ok"}


@api.get("/config")
async def get_config():
    state = await db.survey_state.find_one({"_key": "state"}, {"_id": 0}) or {}
    sem = await db.semester_config.find_one({"_key": "current"}, {"_id": 0}) or {}
    return {
        "trips": TRIPS,
        "positioning_legs": POSITIONING_LEGS,
        "days": DAYS,
        "fares": FARES,
        "routes": ROUTES,
        "capacity": CAPACITY,
        "survey_started": bool(state.get("is_started", False)),
        "semester_label": sem.get("label", DEFAULT_SEMESTER_LABEL),
        "semester_start": sem.get("start_date", DEFAULT_SEMESTER_START),
        "semester_end": sem.get("end_date", DEFAULT_SEMESTER_END),
        "email_regex": r"^\d{4}-\d-\d{2}-\d{3}@std\.ewubd\.edu$",
        "email_example": "2___-_-__-___@std.ewubd.edu",
    }


@api.get("/schedule/counts")
async def public_schedule_counts(scope: str = "monthly", month: Optional[str] = None):
    """Public: gives the front-end the per-weekday working-day counts so it
    can show a live price preview during the survey.
    """
    scope = scope if scope in ("monthly", "semester") else "monthly"
    start, end = await get_scope_dates(scope, month)
    counts = await get_working_day_counts(start, end)
    total = sum(counts.values())
    return {
        "scope": scope,
        "start": start,
        "end": end,
        "counts": counts,
        "total_working_days": total,
    }


@api.post("/survey/lookup")
async def survey_lookup(payload: LookupRequest):
    email = payload.email.strip().lower()
    if not STUDENT_EMAIL_RE.match(email):
        raise HTTPException(400, "Please use a valid EWU student ID email (format: 2___-_-__-___@std.ewubd.edu).")
    if await db.banned.find_one({"email": email}):
        raise HTTPException(403, "This student ID has been banned by the admin. Contact the shuttle office if this is a mistake.")
    existing = await db.surveys.find_one({"email": email}, {"_id": 0})
    return {"exists": bool(existing), "survey": existing}


@api.post("/survey/submit")
async def submit_survey(payload: SurveySubmit):
    email = payload.email.strip().lower()
    if not STUDENT_EMAIL_RE.match(email):
        raise HTTPException(400, "Invalid EWU student email format.")
    if await db.banned.find_one({"email": email}):
        raise HTTPException(403, "Banned")
    if await db.surveys.find_one({"email": email}):
        raise HTTPException(409, "A survey response for this student already exists.")

    route = next((r for r in ROUTES if r["id"] == payload.route_id), None)
    if not route:
        raise HTTPException(400, "Invalid route")

    # Unsupported route => stored as a contact lead only.
    if not route.get("supported"):
        lead = {
            "id": str(uuid.uuid4()),
            "name": payload.name.strip(),
            "phone": payload.phone.strip(),
            "email": email,
            "route_id": payload.route_id,
            "route_label": route["label"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.route_leads.insert_one(lead)
        return {"status": "lead_recorded",
                "message": "Thanks! We'll contact you soon for the requested route."}

    for d in payload.days:
        if d not in DAYS:
            raise HTTPException(400, f"Invalid day {d}")
    if not payload.days:
        raise HTTPException(400, "Choose at least one weekday.")
    if payload.payment_plan not in FARES:
        raise HTTPException(400, "Invalid payment plan.")

    scope_start, scope_end = await get_scope_dates(payload.payment_plan, payload.month)
    day_counts = await get_working_day_counts(scope_start, scope_end)
    total, per_day = compute_price(payload.trips_per_day, payload.payment_plan, day_counts)
    working_days_total = sum(day_counts.values())

    state = await db.survey_state.find_one({"_key": "state"}) or {}
    is_started = bool(state.get("is_started", False))
    now = datetime.now(timezone.utc)

    doc = {
        "id": str(uuid.uuid4()),
        "student_id": email.split("@")[0],
        "email": email,
        "name": payload.name.strip(),
        "phone": payload.phone.strip(),
        "month": payload.month,
        "year": int(payload.month.split("-")[0]) if payload.month else now.year,
        "route_id": payload.route_id,
        "route_label": route["label"],
        "days": payload.days,
        "trips_per_day": payload.trips_per_day,
        "payment_plan": payload.payment_plan,
        "one_way_rate": FARES[payload.payment_plan]["one_way"],
        "round_trip_rate": FARES[payload.payment_plan]["round_trip"],
        "scope_start": scope_start,
        "scope_end": scope_end,
        "day_counts": day_counts,
        "working_days_total": working_days_total,
        "per_day_prices": per_day,
        "total_price": total,
        "fare_agreed": payload.fare_agreed,
        "proposed_fare": payload.proposed_fare,
        "is_test_data": not is_started,
        "created_at": now.isoformat(),
    }
    await db.surveys.insert_one(doc)
    doc.pop("_id", None)

    # Fire-and-forget confirmation email
    asyncio.create_task(send_confirmation_email(doc))
    return {"status": "ok", "survey": doc}


async def send_confirmation_email(doc: Dict[str, Any]):
    if not EMAIL_KEY:
        return
    try:
        html = build_confirmation_html(doc)
        body = {
            "to": [doc["email"]],
            "subject": "Student Shuttle — Survey response received",
            "html": html,
            "from_name": EMAIL_FROM_NAME,
        }
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                             headers={"X-Email-Key": EMAIL_KEY}, json=body)
            r.raise_for_status()
    except Exception as e:
        logging.error(f"email send failed: {e}")


def build_confirmation_html(doc: Dict[str, Any]) -> str:
    rows = "".join(
        f"<tr><td style='padding:10px 14px;border-bottom:1px solid #E2E8E5;color:#7A8A82;font-size:13px;'>{d}</td>"
        f"<td style='padding:10px 14px;border-bottom:1px solid #E2E8E5;color:#1A211D;font-size:13px;'>{', '.join(t)}</td></tr>"
        for d, t in (doc.get("trips_per_day") or {}).items() if t
    )
    return f"""<!doctype html><html><body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#F9F8F6;padding:32px 16px;color:#1A211D;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E2E8E5;">
<tr><td style="background:#0F5132;padding:28px 32px;color:#FFFFFF;">
<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:0.85;">Student Shuttle</div>
<div style="font-size:22px;font-weight:600;margin-top:6px;">Thanks, {doc.get('name','Student')}. Response received.</div></td></tr>
<tr><td style="padding:24px 32px;">
<p style="color:#4A5550;line-height:1.6;margin:0 0 16px;">Here is a summary of your Fall 2026 shuttle preferences. This is provisional data — the shuttle office uses it to plan the pilot.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:10px 14px;border-bottom:1px solid #E2E8E5;color:#7A8A82;font-size:13px;">Route</td><td style="padding:10px 14px;border-bottom:1px solid #E2E8E5;color:#1A211D;font-size:13px;">{doc.get('route_label','')}</td></tr>
<tr><td style="padding:10px 14px;border-bottom:1px solid #E2E8E5;color:#7A8A82;font-size:13px;">Payment plan</td><td style="padding:10px 14px;border-bottom:1px solid #E2E8E5;color:#1A211D;font-size:13px;">{doc.get('payment_plan','').title()}</td></tr>
<tr><td style="padding:10px 14px;border-bottom:1px solid #E2E8E5;color:#7A8A82;font-size:13px;">Estimated total</td><td style="padding:10px 14px;border-bottom:1px solid #E2E8E5;color:#1A211D;font-size:13px;">৳ {int(doc.get('total_price',0))} over {doc.get('weeks',0)} weeks</td></tr>
{rows}</table>
<p style="color:#7A8A82;font-size:12px;margin-top:24px;">If you didn't submit this response, reply to this email so we can remove it. — Student Shuttle Team</p></td></tr></table></body></html>"""


# ---------- Admin auth ----------
@api.post("/admin/login")
async def admin_login(p: AdminLogin):
    email = p.email.strip().lower()
    admin = await db.admins.find_one({"email": email})
    if not admin or not verify_pw(p.password, admin["password"]):
        raise HTTPException(401, "Invalid email or password")
    return {"token": issue_token(email), "email": email}


@api.get("/admin/me")
async def admin_me(admin=Depends(require_admin)):
    return {"email": admin["email"]}


@api.post("/admin/change-password")
async def change_password(p: ChangePassword, admin=Depends(require_admin)):
    doc = await db.admins.find_one({"email": admin["email"]})
    if not verify_pw(p.old_password, doc["password"]):
        raise HTTPException(400, "Current password is incorrect")
    if len(p.new_password) < 6:
        raise HTTPException(400, "New password must be at least 6 characters")
    await db.admins.update_one({"email": admin["email"]},
                               {"$set": {"password": hash_pw(p.new_password)}})
    return {"status": "ok"}


# ---------- Admin: survey state + reset ----------
@api.get("/admin/survey/state")
async def get_state(admin=Depends(require_admin)):
    st = await db.survey_state.find_one({"_key": "state"}, {"_id": 0}) or {"is_started": False}
    return st


@api.post("/admin/survey/toggle")
async def toggle_survey(p: ToggleSurvey, admin=Depends(require_admin)):
    await db.survey_state.update_one(
        {"_key": "state"},
        {"$set": {"is_started": p.is_started,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"is_started": p.is_started}


@api.post("/admin/reset")
async def reset_dashboard(p: ResetRequest, admin=Depends(require_admin)):
    reason = p.reason if p.reason in ("testing", "month_end") else "testing"
    docs = await db.surveys.find({}, {"_id": 0}).to_list(None)
    now = datetime.now(timezone.utc).isoformat()
    if docs:
        for d in docs:
            d["archived_at"] = now
            d["archive_reason"] = reason
            # If reset reason is "testing", flag those rows for pink highlight in CSV.
            if reason == "testing":
                d["is_test_data"] = True
        await db.surveys_archive.insert_many(docs)
    r = await db.surveys.delete_many({})
    return {"cleared": r.deleted_count, "reason": reason}


# ---------- Admin: bans + leads ----------
@api.post("/admin/ban")
async def ban_user(p: BanRequest, admin=Depends(require_admin)):
    email = p.email.strip().lower()
    if not STUDENT_EMAIL_RE.match(email):
        raise HTTPException(400, "Not a valid EWU student email.")
    await db.banned.update_one(
        {"email": email},
        {"$set": {"email": email, "reason": p.reason or "",
                  "banned_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"status": "banned", "email": email}


@api.post("/admin/unban")
async def unban_user(p: BanRequest, admin=Depends(require_admin)):
    await db.banned.delete_one({"email": p.email.strip().lower()})
    return {"status": "unbanned"}


@api.get("/admin/banned")
async def banned_list(admin=Depends(require_admin)):
    return await db.banned.find({}, {"_id": 0}).to_list(None)


@api.get("/admin/leads")
async def leads_list(admin=Depends(require_admin)):
    return await db.route_leads.find({}, {"_id": 0}).sort("created_at", -1).to_list(None)


# ---------- Admin: analytics ----------
async def gather_surveys(month: Optional[str] = None, year: Optional[int] = None,
                        include_archive: bool = False) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {}
    if month:
        q["month"] = month
    elif year:
        q["year"] = year
    surveys = await db.surveys.find(q, {"_id": 0}).to_list(None)
    if include_archive:
        arch = await db.surveys_archive.find(q, {"_id": 0}).to_list(None)
        surveys.extend(arch)
    return surveys


@api.get("/admin/available-months")
async def available_months(admin=Depends(require_admin)):
    pipeline = [{"$group": {"_id": "$month"}}, {"$sort": {"_id": -1}}]
    res = await db.surveys.aggregate(pipeline).to_list(None)
    return [x["_id"] for x in res if x.get("_id")]


@api.get("/admin/analytics")
async def analytics(month: Optional[str] = None, admin=Depends(require_admin)):
    surveys = await gather_surveys(month=month)
    total = len(surveys)

    day_demand = {d: 0 for d in DAYS}
    trip_demand = {t["id"]: 0 for t in TRIPS}
    heat: Dict[str, Dict[str, int]] = {d: {t["id"]: 0 for t in TRIPS} for d in DAYS}
    route_demand: Dict[str, int] = {}
    revenue = 0
    plan_split = {"monthly": 0, "semester": 0}
    fare_agreed_count = 0
    proposed_fares: List[float] = []

    for s in surveys:
        revenue += float(s.get("total_price", 0) or 0)
        plan = s.get("payment_plan", "monthly")
        plan_split[plan] = plan_split.get(plan, 0) + 1
        rl = s.get("route_label", "?")
        route_demand[rl] = route_demand.get(rl, 0) + 1
        if s.get("fare_agreed"):
            fare_agreed_count += 1
        if s.get("proposed_fare") is not None:
            try:
                proposed_fares.append(float(s["proposed_fare"]))
            except Exception:
                pass
        for d in s.get("days", []):
            day_demand[d] = day_demand.get(d, 0) + 1
        for d, trips in (s.get("trips_per_day") or {}).items():
            for t in trips:
                trip_demand[t] = trip_demand.get(t, 0) + 1
                if d in heat and t in heat[d]:
                    heat[d][t] += 1

    trip_occupancy = {
        t: {
            "seats_demanded": trip_demand[t],
            "capacity": CAPACITY,
            "occupancy_pct": round(min(100.0, trip_demand[t] * 100 / CAPACITY), 1),
        }
        for t in trip_demand
    }

    # Average occupancy across each day × trip cell.
    cells, occ_sum, peak_cell, low_cell = 0, 0.0, {"day": None, "trip": None, "count": 0}, None
    for d in DAYS:
        for t in [x["id"] for x in TRIPS]:
            c = heat[d][t]
            cells += 1
            occ_sum += min(100.0, c * 100 / CAPACITY)
            if c > peak_cell["count"]:
                peak_cell = {"day": d, "trip": t, "count": c}
            if low_cell is None or c < low_cell["count"]:
                low_cell = {"day": d, "trip": t, "count": c}

    avg_occ = round(occ_sum / max(1, cells), 1) if total > 0 else 0.0

    # Direction split — per day, aggregate UP (Chashara→Rampura) and DOWN
    # (Rampura→Chashara) with capacity = 3 trips × 36 seats = 108 per direction.
    up_ids = [t["id"] for t in TRIPS if t["direction"] == "up"]
    down_ids = [t["id"] for t in TRIPS if t["direction"] == "down"]
    dir_capacity = CAPACITY * 3
    direction_summary = {}
    for d in DAYS:
        up_trips = {tid: heat[d][tid] for tid in up_ids}
        down_trips = {tid: heat[d][tid] for tid in down_ids}
        up_total = sum(up_trips.values())
        down_total = sum(down_trips.values())
        direction_summary[d] = {
            "up": {
                "label": "Chashara → Rampura",
                "trips": up_trips,
                "total": up_total,
                "capacity": dir_capacity,
                "occupancy_pct": round(min(100.0, up_total * 100 / dir_capacity), 1),
            },
            "down": {
                "label": "Rampura → Chashara",
                "trips": down_trips,
                "total": down_total,
                "capacity": dir_capacity,
                "occupancy_pct": round(min(100.0, down_total * 100 / dir_capacity), 1),
            },
        }

    return {
        "total_respondents": total,
        "revenue": revenue,
        "average_occupancy_pct": avg_occ,
        "capacity": CAPACITY,
        "direction_capacity": dir_capacity,
        "day_demand": day_demand,
        "trip_demand": trip_demand,
        "trip_occupancy": trip_occupancy,
        "heatmap": heat,
        "direction_summary": direction_summary,
        "route_demand": route_demand,
        "plan_split": plan_split,
        "fare_agreed_count": fare_agreed_count,
        "proposed_fare_avg": round(sum(proposed_fares) / len(proposed_fares), 2) if proposed_fares else None,
        "proposed_fare_count": len(proposed_fares),
        "peak": peak_cell,
        "low": low_cell or {"day": None, "trip": None, "count": 0},
        "trips_meta": TRIPS,
        "days_meta": DAYS,
        "month": month,
    }


@api.get("/admin/responses")
async def responses(month: Optional[str] = None, admin=Depends(require_admin)):
    surveys = await gather_surveys(month=month)
    surveys.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    return surveys


@api.get("/admin/export/csv")
async def export_csv(
    month: Optional[str] = None,
    year: Optional[int] = None,
    include_archive: bool = True,
    admin=Depends(require_admin),
):
    surveys = await gather_surveys(month=month, year=year, include_archive=include_archive)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Highlight", "Student ID", "Email", "Name", "Phone", "Month", "Year",
        "Route", "Days", "Trips", "Payment Plan", "Weeks",
        "One-way Rate", "Round-trip Rate", "Weekly Total", "Total Price (BDT)",
        "Fare Agreed", "Proposed Fare", "Created At",
    ])
    for s in surveys:
        trips_str = " | ".join(
            f"{d}: {','.join(t)}" for d, t in (s.get("trips_per_day") or {}).items() if t
        )
        writer.writerow([
            "PINK — TEST DATA" if s.get("is_test_data") else "REAL",
            s.get("student_id", ""), s.get("email", ""), s.get("name", ""),
            s.get("phone", ""), s.get("month", ""), s.get("year", ""),
            s.get("route_label", ""), ",".join(s.get("days", [])), trips_str,
            s.get("payment_plan", ""), s.get("weeks", ""),
            s.get("one_way_rate", ""), s.get("round_trip_rate", ""),
            s.get("weekly_total", ""), s.get("total_price", ""),
            "Yes" if s.get("fare_agreed") else "No",
            s.get("proposed_fare", "") if s.get("proposed_fare") is not None else "",
            s.get("created_at", ""),
        ])
    output.seek(0)
    fname = f"ewu-shuttle-{month or year or 'all'}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


# ---------- Admin: AI forecast ----------
@api.get("/admin/forecast")
async def ai_forecast(month: Optional[str] = None, admin=Depends(require_admin)):
    data = await analytics(month=month, admin=admin)
    if data["total_respondents"] < 3 or not EMERGENT_LLM_KEY:
        return {
            "insights": [
                "Not enough survey responses yet to produce meaningful insights.",
                "Ask more students to complete the survey — at least 10 responses are recommended.",
            ],
            "recommendation": "Promote the survey via department groups & campus notice boards.",
            "prediction": "Prediction unavailable — collect more data first.",
            "generated_by": "fallback",
        }

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception:
        return {"insights": ["LLM library unavailable."], "recommendation": "", "prediction": "", "generated_by": "error"}

    prompt = (
        "You are a shuttle operations analyst for an East West University shuttle "
        "(36-seat AC bus running Rampura ↔ Chashara). Based on the survey summary "
        "below, produce compact JSON only (no markdown, no prose outside JSON) "
        'with keys: {"insights":[two short strings], "recommendation":"one string", '
        '"prediction":"one sentence forecasting next-semester demand"}.\n\n'
        f"Summary:\n"
        f"- Total respondents: {data['total_respondents']}\n"
        f"- Estimated revenue: BDT {int(data['revenue'])}\n"
        f"- Average occupancy: {data['average_occupancy_pct']}% of {data['capacity']} seats\n"
        f"- Day-wise demand: {data['day_demand']}\n"
        f"- Trip-wise demand: {data['trip_demand']}\n"
        f"- Peak cell: {data['peak']}\n"
        f"- Lowest cell: {data['low']}\n"
        f"- Payment plan split: {data['plan_split']}\n"
        f"- Route demand: {data['route_demand']}\n"
        f"- Fare-agreed count: {data['fare_agreed_count']} / {data['total_respondents']}\n"
    )

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"forecast-{month or 'all'}-{uuid.uuid4().hex[:6]}",
        system_message="You are a concise transit analytics assistant. Reply with valid JSON only.",
    ).with_model("anthropic", "claude-sonnet-5")

    try:
        text = await chat.send_message(UserMessage(text=prompt))
        text = text if isinstance(text, str) else str(text)
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1:
            raise ValueError("no JSON returned")
        parsed = json.loads(text[start:end + 1])
        parsed["generated_by"] = "claude-sonnet-5"
        return parsed
    except Exception as e:
        logging.error(f"AI forecast error: {e}")
        return {
            "insights": [f"AI service returned an error: {str(e)[:120]}"],
            "recommendation": "Try again in a moment — this is usually transient.",
            "prediction": "—",
            "generated_by": "error",
        }


# ---------- Admin: semester + schedule ----------
@api.get("/admin/semester-config")
async def get_semester_config(admin=Depends(require_admin)):
    doc = await db.semester_config.find_one({"_key": "current"}, {"_id": 0}) or {}
    return {
        "label": doc.get("label", DEFAULT_SEMESTER_LABEL),
        "start_date": doc.get("start_date", DEFAULT_SEMESTER_START),
        "end_date": doc.get("end_date", DEFAULT_SEMESTER_END),
    }


@api.post("/admin/semester-config")
async def save_semester_config(p: SemesterConfig, admin=Depends(require_admin)):
    try:
        s = parse_iso_date(p.start_date)
        e = parse_iso_date(p.end_date)
    except Exception:
        raise HTTPException(400, "Dates must be YYYY-MM-DD")
    if e < s:
        raise HTTPException(400, "End date must be after start date")
    await db.semester_config.update_one(
        {"_key": "current"},
        {"$set": {"_key": "current", "label": p.label,
                  "start_date": p.start_date, "end_date": p.end_date,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"status": "ok"}


@api.get("/admin/schedule")
async def get_schedule(year: int, month: int, admin=Depends(require_admin)):
    if month < 1 or month > 12:
        raise HTTPException(400, "month must be 1-12")
    first = date(year, month, 1)
    last = (date(year + 1, 1, 1) - timedelta(days=1)) if month == 12 else (date(year, month + 1, 1) - timedelta(days=1))
    overrides = await db.working_day_overrides.find(
        {"date": {"$gte": first.isoformat(), "$lte": last.isoformat()}}, {"_id": 0}
    ).to_list(None)
    override_map = {o["date"]: o for o in overrides}
    dates = []
    for d in daterange(first, last):
        iso = d.isoformat()
        weekday_idx = d.weekday()
        default_working = weekday_idx not in DEFAULT_OFF_WEEKDAYS
        info = override_map.get(iso)
        is_working = bool(info["is_working"]) if info else default_working
        dates.append({
            "date": iso,
            "weekday": WEEKDAY_INDEX_TO_NAME[weekday_idx],
            "is_weekend": weekday_idx in DEFAULT_OFF_WEEKDAYS,
            "is_working": is_working,
            "overridden": info is not None,
        })
    return {"year": year, "month": month, "dates": dates}


@api.post("/admin/schedule")
async def toggle_schedule(p: ScheduleToggle, admin=Depends(require_admin)):
    try:
        d = parse_iso_date(p.date)
    except Exception:
        raise HTTPException(400, "Invalid date")
    if d.weekday() in DEFAULT_OFF_WEEKDAYS and p.is_working:
        raise HTTPException(400, "Friday and Saturday are always off.")
    await db.working_day_overrides.update_one(
        {"date": p.date},
        {"$set": {"date": p.date, "is_working": bool(p.is_working),
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"status": "ok", "date": p.date, "is_working": p.is_working}


# ---------- Register ----------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("student-shuttle")


@app.on_event("shutdown")
async def shutdown():
    client.close()
