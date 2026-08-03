"""Iteration 2 specific backend tests:
- /api/schedule/counts (public)
- /api/admin/semester-config GET/POST
- /api/admin/schedule GET/POST (with Fri/Sat auto-off enforcement)
- /api/survey/submit new pricing with day_counts
- /api/admin/analytics direction_summary
- Auth guard on admin endpoints
"""
import os
import uuid
import pytest
import requests
from pathlib import Path

BASE = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE = line.split("=", 1)[1].strip()
            break
BASE = BASE.rstrip("/")
API = f"{BASE}/api"
ADMIN_EMAIL = "admin@ewushuttle.com"
ADMIN_PW = "Admin@123"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def token(s):
    r = s.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module", autouse=True)
def reset_semester_and_overrides(s, h):
    """Restore semester defaults and remove any overrides from previous runs."""
    s.post(f"{API}/admin/semester-config", headers=h, json={
        "label": "Fall 2026",
        "start_date": "2026-09-01",
        "end_date": "2026-12-31",
    })
    # Remove Sep 15 override by toggling both ways is not possible; we set is_working=True to reset (weekday)
    # First delete any Sep override by setting Tuesday Sep 15 back to working=True
    # Note: There is no DELETE endpoint; POST with is_working=True on a Tue sets it back.
    for d in ["2026-09-15"]:
        s.post(f"{API}/admin/schedule", headers=h, json={"date": d, "is_working": True})
    yield


# ---------- /api/schedule/counts ----------
def test_schedule_counts_sep_2026_defaults(s):
    r = s.get(f"{API}/schedule/counts", params={"scope": "monthly", "month": "2026-09"})
    assert r.status_code == 200
    d = r.json()
    assert d["counts"] == {"Sunday": 4, "Monday": 4, "Tuesday": 5, "Wednesday": 5, "Thursday": 4}
    assert d["total_working_days"] == 22
    assert d["start"] == "2026-09-01"
    assert d["end"] == "2026-09-30"


def test_schedule_counts_semester_scope(s):
    r = s.get(f"{API}/schedule/counts", params={"scope": "semester", "month": "2026-09"})
    assert r.status_code == 200
    d = r.json()
    # semester spans Sep 1 - Dec 31 2026, much bigger than monthly
    assert d["total_working_days"] > 22
    assert d["end"] == "2026-12-31"


# ---------- Admin schedule toggle ----------
def test_admin_schedule_toggle_sep_15_off_reduces_tuesday(s, h):
    # Mark Sep 15 (Tuesday) as off
    r = s.post(f"{API}/admin/schedule", headers=h,
               json={"date": "2026-09-15", "is_working": False})
    assert r.status_code == 200

    r2 = s.get(f"{API}/schedule/counts", params={"scope": "monthly", "month": "2026-09"})
    d = r2.json()
    assert d["counts"]["Tuesday"] == 4
    assert d["total_working_days"] == 21


def test_admin_schedule_rejects_enable_friday(s, h):
    # 2026-09-04 is a Friday
    r = s.post(f"{API}/admin/schedule", headers=h,
               json={"date": "2026-09-04", "is_working": True})
    assert r.status_code == 400


def test_admin_schedule_rejects_enable_saturday(s, h):
    # 2026-09-05 is a Saturday
    r = s.post(f"{API}/admin/schedule", headers=h,
               json={"date": "2026-09-05", "is_working": True})
    assert r.status_code == 400


def test_admin_schedule_month_view(s, h):
    r = s.get(f"{API}/admin/schedule", headers=h, params={"year": 2026, "month": 9})
    assert r.status_code == 200
    d = r.json()
    assert len(d["dates"]) == 30
    # Verify Fri/Sat auto-off
    fri = next(x for x in d["dates"] if x["date"] == "2026-09-04")
    sat = next(x for x in d["dates"] if x["date"] == "2026-09-05")
    assert fri["is_weekend"] is True and fri["is_working"] is False
    assert sat["is_weekend"] is True and sat["is_working"] is False
    # Sunday Sep 6 default working
    sun = next(x for x in d["dates"] if x["date"] == "2026-09-06")
    assert sun["is_weekend"] is False and sun["is_working"] is True
    # Sep 15 should be overridden off
    tue = next(x for x in d["dates"] if x["date"] == "2026-09-15")
    assert tue["overridden"] is True and tue["is_working"] is False


# ---------- Semester config ----------
def test_semester_config_update_and_reject_invalid(s, h):
    # Valid update
    r = s.post(f"{API}/admin/semester-config", headers=h, json={
        "label": "Spring 2027", "start_date": "2027-01-15", "end_date": "2027-05-15"
    })
    assert r.status_code == 200
    g = s.get(f"{API}/admin/semester-config", headers=h).json()
    assert g["label"] == "Spring 2027"
    assert g["start_date"] == "2027-01-15"
    assert g["end_date"] == "2027-05-15"

    # end < start rejected
    r2 = s.post(f"{API}/admin/semester-config", headers=h, json={
        "label": "Bad", "start_date": "2027-05-01", "end_date": "2027-01-01"
    })
    assert r2.status_code == 400

    # Restore Fall 2026 defaults
    s.post(f"{API}/admin/semester-config", headers=h, json={
        "label": "Fall 2026", "start_date": "2026-09-01", "end_date": "2026-12-31"
    })


# ---------- Survey submit with new pricing (Sep 2026 with Sep 15 off) ----------
def test_survey_submit_new_pricing_sep_2026(s, h):
    # Use a unique email; do NOT call reset (it interferes with parallel tests)
    email = "2024-1-70-777@std.ewubd.edu"
    s.post(f"{API}/admin/unban", headers=h, json={"email": email})

    body = {
        "email": email, "name": "New Pricing", "phone": "017",
        "month": "2026-09", "route_id": "chashara_rampura",
        "days": ["Sunday", "Monday", "Tuesday"],
        "trips_per_day": {
            "Sunday": ["UP1", "DOWN1"],
            "Monday": ["UP2", "DOWN2"],
            "Tuesday": ["UP1"],
        },
        "payment_plan": "monthly", "fare_agreed": True,
    }
    r = s.post(f"{API}/survey/submit", json=body)
    if r.status_code == 409:
        # already exists from previous run; look it up via analytics or skip re-submit
        # fall back to fetching via lookup
        lu = s.post(f"{API}/survey/lookup", json={"email": email}).json()
        d = lu["survey"]
    else:
        assert r.status_code == 200, r.text
        d = r.json()["survey"]
    # (230*4)+(230*4)+(115*4) = 2300
    assert d["total_price"] == 2300
    assert d["day_counts"]["Sunday"] == 4
    assert d["day_counts"]["Monday"] == 4
    assert d["day_counts"]["Tuesday"] == 4  # reduced from 5 due to Sep 15 override
    assert d["working_days_total"] == 21
    pdp = d["per_day_prices"]
    assert pdp["Sunday"]["type"] == "round_trip" and pdp["Sunday"]["subtotal"] == 920
    assert pdp["Monday"]["type"] == "round_trip" and pdp["Monday"]["subtotal"] == 920
    assert pdp["Tuesday"]["type"] == "one_way" and pdp["Tuesday"]["subtotal"] == 460
    assert d["scope_start"] == "2026-09-01"
    assert d["scope_end"] == "2026-09-30"


# ---------- Analytics: direction_summary ----------
def test_analytics_direction_summary(s, h):
    r = s.get(f"{API}/admin/analytics", headers=h)
    assert r.status_code == 200
    d = r.json()
    assert d["direction_capacity"] == 108
    ds = d["direction_summary"]
    assert set(ds.keys()) == {"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"}
    for day in ds:
        up = ds[day]["up"]
        down = ds[day]["down"]
        assert set(up["trips"].keys()) == {"UP1", "UP2", "UP3"}
        assert set(down["trips"].keys()) == {"DOWN1", "DOWN2", "DOWN3"}
        assert up["capacity"] == 108
        assert down["capacity"] == 108
        assert "occupancy_pct" in up and "occupancy_pct" in down
    # Should reflect the seeded survey: Sunday UP1 >=1, Monday UP2 >=1
    assert ds["Sunday"]["up"]["trips"]["UP1"] >= 1
    assert ds["Monday"]["up"]["trips"]["UP2"] >= 1
    assert ds["Tuesday"]["up"]["trips"]["UP1"] >= 1


# ---------- Auth guard ----------
def test_admin_schedule_requires_auth(s):
    r = s.get(f"{API}/admin/schedule", params={"year": 2026, "month": 9})
    assert r.status_code == 401
    r2 = s.post(f"{API}/admin/schedule", json={"date": "2026-09-16", "is_working": False})
    assert r2.status_code == 401
    r3 = s.get(f"{API}/admin/semester-config")
    assert r3.status_code == 401
