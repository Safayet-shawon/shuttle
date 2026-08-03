"""EWU Shuttle Survey & Demand Analytics — Backend API.

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
from datetime import datetime, timedelta, timezone
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
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "EWU Shuttle")
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


def compute_price(trips_per_day: Dict[str, List[str]], payment_plan: str):
    fare = FARES[payment_plan]
    per_day_details: Dict[str, int] = {}
    weekly_total = 0
    for day, trips in trips_per_day.items():
        if not trips:
            continue
        has_up = any(t.startswith("UP") for t in trips)
        has_down = any(t.startswith("DOWN") for t in trips)
        per_day = fare["round_trip"] if (has_up and has_down) else fare["one_way"]
        per_day_details[day] = per_day
        weekly_total += per_day
    total = weekly_total * fare["weeks"]
    return total, per_day_details, fare["weeks"], weekly_total


# ---------- App ----------
app = FastAPI(title="EWU Shuttle API")
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


# ---------- Public endpoints ----------
@api.get("/")
async def root():
    return {"service": "EWU Shuttle API", "status": "ok"}


@api.get("/config")
async def get_config():
    state = await db.survey_state.find_one({"_key": "state"}, {"_id": 0}) or {}
    return {
        "trips": TRIPS,
        "positioning_legs": POSITIONING_LEGS,
        "days": DAYS,
        "fares": FARES,
        "routes": ROUTES,
        "capacity": CAPACITY,
        "survey_started": bool(state.get("is_started", False)),
        "semester": "Fall 2026",
        "email_regex": r"^\d{4}-\d-\d{2}-\d{3}@std\.ewubd\.edu$",
        "email_example": "2022-1-80-014@std.ewubd.edu",
    }


@api.post("/survey/lookup")
async def survey_lookup(payload: LookupRequest):
    email = payload.email.strip().lower()
    if not STUDENT_EMAIL_RE.match(email):
        raise HTTPException(400, "Please use a valid EWU student ID email (e.g., 2022-1-80-014@std.ewubd.edu).")
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

    total, per_day, weeks, weekly_total = compute_price(payload.trips_per_day, payload.payment_plan)

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
        "weeks": weeks,
        "weekly_total": weekly_total,
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
            "subject": "EWU Shuttle — Survey response received",
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
<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:0.85;">EWU Shuttle</div>
<div style="font-size:22px;font-weight:600;margin-top:6px;">Thanks, {doc.get('name','Student')}. Response received.</div></td></tr>
<tr><td style="padding:24px 32px;">
<p style="color:#4A5550;line-height:1.6;margin:0 0 16px;">Here is a summary of your Fall 2026 shuttle preferences. This is provisional data — the shuttle office uses it to plan the pilot.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:10px 14px;border-bottom:1px solid #E2E8E5;color:#7A8A82;font-size:13px;">Route</td><td style="padding:10px 14px;border-bottom:1px solid #E2E8E5;color:#1A211D;font-size:13px;">{doc.get('route_label','')}</td></tr>
<tr><td style="padding:10px 14px;border-bottom:1px solid #E2E8E5;color:#7A8A82;font-size:13px;">Payment plan</td><td style="padding:10px 14px;border-bottom:1px solid #E2E8E5;color:#1A211D;font-size:13px;">{doc.get('payment_plan','').title()}</td></tr>
<tr><td style="padding:10px 14px;border-bottom:1px solid #E2E8E5;color:#7A8A82;font-size:13px;">Estimated total</td><td style="padding:10px 14px;border-bottom:1px solid #E2E8E5;color:#1A211D;font-size:13px;">৳ {int(doc.get('total_price',0))} over {doc.get('weeks',0)} weeks</td></tr>
{rows}</table>
<p style="color:#7A8A82;font-size:12px;margin-top:24px;">If you didn't submit this response, reply to this email so we can remove it. — EWU Shuttle Team</p></td></tr></table></body></html>"""


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

    return {
        "total_respondents": total,
        "revenue": revenue,
        "average_occupancy_pct": avg_occ,
        "capacity": CAPACITY,
        "day_demand": day_demand,
        "trip_demand": trip_demand,
        "trip_occupancy": trip_occupancy,
        "heatmap": heat,
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
logger = logging.getLogger("ewu-shuttle")


@app.on_event("shutdown")
async def shutdown():
    client.close()
