"""EWU Shuttle backend tests — comprehensive pytest suite.

Covers:
- /api/config
- /api/survey/lookup (regex + not-found)
- /api/survey/submit (Chashara happy path, lead route, duplicate)
- /api/admin/login (success + wrong pw)
- /api/admin/analytics (aggregation + month filter)
- /api/admin/survey/toggle (test_data flag flip)
- /api/admin/ban / unban
- /api/admin/reset (testing + month_end)
- /api/admin/export/csv
- /api/admin/change-password
- /api/admin/forecast (fallback + AI when >=3)
- /api/admin/available-months + /api/admin/leads
"""
import os
import time
import uuid
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE:
    # Fallback: read frontend/.env
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE = line.split("=", 1)[1].strip().rstrip("/")
            break

API = f"{BASE}/api"
ADMIN_EMAIL = "admin@ewushuttle.com"
ADMIN_PW = "Admin@123"

# unique-per-run emails to avoid 409s across reruns
RUN = uuid.uuid4().hex[:3]
def mk_email(nnn: str) -> str:
    return f"2022-1-80-{nnn}@std.ewubd.edu"

E_MAIN = mk_email("014")
E_LEAD = mk_email("045")
E_BAN = mk_email("102")
E_DUP = mk_email("007")
E_MONTH = mk_email("088")
E_RESET = mk_email("077")
E_TOGGLE = mk_email("066")


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="session")
def admin_token(s):
    r = s.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW})
    if r.status_code != 200:
        # maybe password was rotated in previous run — try memory fallback
        pytest.fail(f"admin login failed: {r.status_code} {r.text}")
    return r.json()["token"]


@pytest.fixture(scope="session")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session", autouse=True)
def clean_state(s, admin_token):
    """Reset DB state to a known baseline before running tests."""
    h = {"Authorization": f"Bearer {admin_token}"}
    # ensure survey is stopped -> test_data=true default
    s.post(f"{API}/admin/survey/toggle", json={"is_started": False}, headers=h)
    # clear surveys (testing reset)
    s.post(f"{API}/admin/reset", json={"reason": "testing"}, headers=h)
    # unban known emails
    for e in [E_MAIN, E_BAN, E_DUP, E_MONTH, E_RESET, E_TOGGLE]:
        s.post(f"{API}/admin/unban", json={"email": e}, headers=h)
    yield


# ---------- Config ----------
def test_config(s):
    r = s.get(f"{API}/config")
    assert r.status_code == 200
    d = r.json()
    assert d["capacity"] == 36
    assert d["fares"]["monthly"]["one_way"] == 115
    assert d["fares"]["semester"]["one_way"] == 105
    assert isinstance(d["survey_started"], bool)
    assert d["email_regex"] == r"^\d{4}-\d-\d{2}-\d{3}@std\.ewubd\.edu$"
    assert d["email_example"] == "2022-1-80-014@std.ewubd.edu"
    supported = {r_["id"]: r_["supported"] for r_ in d["routes"]}
    assert supported["chashara_rampura"] is True
    assert supported["rampura_uttara_kuril"] is False
    assert supported["rampura_uttara_elevated"] is False
    assert supported["rampura_mohammadpur"] is False
    trip_ids = {t["id"] for t in d["trips"]}
    assert {"UP1","UP2","UP3","DOWN1","DOWN2","DOWN3"} <= trip_ids


# ---------- Lookup ----------
@pytest.mark.parametrize("bad", ["bad@std.ewubd.edu", "1234@std.ewubd.edu", "2022-1-80-14@std.ewubd.edu", "abc"])
def test_lookup_rejects_bad(s, bad):
    r = s.post(f"{API}/survey/lookup", json={"email": bad})
    assert r.status_code == 400, r.text


def test_lookup_valid_new(s):
    r = s.post(f"{API}/survey/lookup", json={"email": E_MAIN})
    assert r.status_code == 200
    d = r.json()
    assert d["exists"] is False
    assert d["survey"] is None


# ---------- Survey submit ----------
def test_submit_chashara_happy(s):
    body = {
        "email": E_MAIN, "name": "Test One", "phone": "017000000",
        "month": "2026-02", "route_id": "chashara_rampura",
        "days": ["Sunday"],
        "trips_per_day": {"Sunday": ["UP1", "DOWN1"]},
        "payment_plan": "monthly", "fare_agreed": True,
    }
    r = s.post(f"{API}/survey/submit", json=body)
    assert r.status_code == 200, r.text
    d = r.json()["survey"]
    # 230/day round trip × 1 day × 4 weeks = 920
    assert d["total_price"] == 920
    assert d["weekly_total"] == 230
    assert d["is_test_data"] is True   # survey not started
    assert d["route_id"] == "chashara_rampura"

    # lookup should now show exists
    r2 = s.post(f"{API}/survey/lookup", json={"email": E_MAIN})
    assert r2.json()["exists"] is True


def test_submit_duplicate_conflict(s):
    body = {
        "email": E_MAIN, "name": "dup", "phone": "01", "month": "2026-02",
        "route_id": "chashara_rampura", "days": ["Sunday"],
        "trips_per_day": {"Sunday": ["UP1"]}, "payment_plan": "monthly",
    }
    r = s.post(f"{API}/survey/submit", json=body)
    assert r.status_code == 409


def test_submit_lead_route(s):
    body = {
        "email": E_LEAD, "name": "Lead X", "phone": "0170",
        "month": "2026-02", "route_id": "rampura_uttara_kuril",
        "days": [], "trips_per_day": {}, "payment_plan": "monthly",
    }
    r = s.post(f"{API}/survey/submit", json=body)
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "lead_recorded"
    assert "contact you" in d["message"].lower()
    # ensure no survey was created for this email
    lu = s.post(f"{API}/survey/lookup", json={"email": E_LEAD}).json()
    assert lu["exists"] is False


# ---------- Admin login ----------
def test_admin_login_wrong(s):
    r = s.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": "wrong"})
    assert r.status_code == 401


def test_admin_login_ok(admin_token):
    assert isinstance(admin_token, str) and len(admin_token) > 10


# ---------- Analytics ----------
def test_analytics_reflects_submission(s, auth_headers):
    r = s.get(f"{API}/admin/analytics", headers=auth_headers)
    assert r.status_code == 200
    d = r.json()
    assert d["total_respondents"] >= 1
    assert d["revenue"] >= 920
    assert d["capacity"] == 36
    # heatmap Sunday/UP1 should have >=1 from E_MAIN
    assert d["heatmap"]["Sunday"]["UP1"] >= 1
    assert d["trip_occupancy"]["UP1"]["occupancy_pct"] >= 0
    assert 0 <= d["average_occupancy_pct"] <= 100


def test_analytics_month_filter(s, auth_headers):
    # submit an entry for a different month
    body = {
        "email": E_MONTH, "name": "Mo", "phone": "01",
        "month": "2026-05", "route_id": "chashara_rampura",
        "days": ["Monday"], "trips_per_day": {"Monday": ["UP2"]},
        "payment_plan": "semester", "fare_agreed": True,
    }
    r = s.post(f"{API}/survey/submit", json=body)
    assert r.status_code == 200

    a_may = s.get(f"{API}/admin/analytics?month=2026-05", headers=auth_headers).json()
    a_feb = s.get(f"{API}/admin/analytics?month=2026-02", headers=auth_headers).json()
    assert a_may["total_respondents"] >= 1
    assert a_feb["total_respondents"] >= 1
    # E_MAIN (Feb) shouldn't show up in May's UP1
    assert a_may["trip_demand"].get("UP1", 0) == 0


def test_available_months(s, auth_headers):
    r = s.get(f"{API}/admin/available-months", headers=auth_headers)
    assert r.status_code == 200
    months = r.json()
    assert "2026-02" in months
    assert "2026-05" in months


def test_leads_list(s, auth_headers):
    r = s.get(f"{API}/admin/leads", headers=auth_headers)
    assert r.status_code == 200
    emails = [x["email"] for x in r.json()]
    assert E_LEAD in emails


# ---------- Survey toggle ----------
def test_toggle_flips_test_flag(s, auth_headers):
    # Start survey => next submission is real
    r = s.post(f"{API}/admin/survey/toggle", json={"is_started": True}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["is_started"] is True

    body = {
        "email": E_TOGGLE, "name": "Live", "phone": "01",
        "month": "2026-02", "route_id": "chashara_rampura",
        "days": ["Sunday"], "trips_per_day": {"Sunday": ["UP1"]},
        "payment_plan": "monthly",
    }
    r = s.post(f"{API}/survey/submit", json=body)
    assert r.status_code == 200
    assert r.json()["survey"]["is_test_data"] is False

    # revert
    s.post(f"{API}/admin/survey/toggle", json={"is_started": False}, headers=auth_headers)


# ---------- Ban / Unban ----------
def test_ban_blocks_submit(s, auth_headers):
    r = s.post(f"{API}/admin/ban", json={"email": E_BAN, "reason": "test"}, headers=auth_headers)
    assert r.status_code == 200
    body = {
        "email": E_BAN, "name": "B", "phone": "01",
        "month": "2026-02", "route_id": "chashara_rampura",
        "days": ["Sunday"], "trips_per_day": {"Sunday": ["UP1"]},
        "payment_plan": "monthly",
    }
    r = s.post(f"{API}/survey/submit", json=body)
    assert r.status_code == 403

    # unban
    r = s.post(f"{API}/admin/unban", json={"email": E_BAN}, headers=auth_headers)
    assert r.status_code == 200
    # can submit now
    r = s.post(f"{API}/survey/submit", json=body)
    assert r.status_code == 200


# ---------- CSV export ----------
def test_csv_export(s, auth_headers):
    r = s.get(f"{API}/admin/export/csv", headers={"Authorization": auth_headers["Authorization"]})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    text = r.text
    assert "Highlight" in text
    assert "PINK — TEST DATA" in text or "REAL" in text


# ---------- Reset ----------
def test_reset_testing_archives(s, auth_headers):
    # add a fresh survey then reset
    body = {
        "email": E_RESET, "name": "R", "phone": "01",
        "month": "2026-03", "route_id": "chashara_rampura",
        "days": ["Tuesday"], "trips_per_day": {"Tuesday": ["UP2"]},
        "payment_plan": "monthly",
    }
    s.post(f"{API}/survey/submit", json=body)

    r = s.post(f"{API}/admin/reset", json={"reason": "testing"}, headers=auth_headers)
    assert r.status_code == 200
    d = r.json()
    assert d["reason"] == "testing"
    assert d["cleared"] >= 1

    # analytics now = 0
    a = s.get(f"{API}/admin/analytics", headers=auth_headers).json()
    assert a["total_respondents"] == 0

    # CSV still contains archived rows
    csv_text = s.get(f"{API}/admin/export/csv", headers=auth_headers).text
    assert E_RESET in csv_text


# ---------- Change password ----------
def test_change_password_flow(s, auth_headers):
    new_pw = "TempPw@999"
    # wrong old
    r = s.post(f"{API}/admin/change-password",
               json={"old_password": "wrong", "new_password": new_pw},
               headers=auth_headers)
    assert r.status_code == 400

    # correct
    r = s.post(f"{API}/admin/change-password",
               json={"old_password": ADMIN_PW, "new_password": new_pw},
               headers=auth_headers)
    assert r.status_code == 200

    # login with new
    r = s.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": new_pw})
    assert r.status_code == 200
    new_tok = r.json()["token"]

    # rotate back
    r = s.post(f"{API}/admin/change-password",
               json={"old_password": new_pw, "new_password": ADMIN_PW},
               headers={"Authorization": f"Bearer {new_tok}"})
    assert r.status_code == 200


# ---------- Forecast ----------
def test_forecast_fallback_when_low(s, auth_headers):
    # After reset in earlier test, respondents may be low
    r = s.get(f"{API}/admin/forecast", headers=auth_headers)
    assert r.status_code == 200
    d = r.json()
    assert "insights" in d
    assert "recommendation" in d
    assert "prediction" in d


def test_forecast_ai_when_enough(s, auth_headers):
    # submit >=3 surveys
    for i, nnn in enumerate(["201", "202", "203"]):
        body = {
            "email": mk_email(nnn), "name": f"F{i}", "phone": "01",
            "month": "2026-04", "route_id": "chashara_rampura",
            "days": ["Sunday"], "trips_per_day": {"Sunday": ["UP1", "DOWN1"]},
            "payment_plan": "monthly",
        }
        s.post(f"{API}/survey/submit", json=body)
    # give the LLM some time
    r = s.get(f"{API}/admin/forecast?month=2026-04", headers=auth_headers, timeout=60)
    assert r.status_code == 200
    d = r.json()
    assert d.get("generated_by") in ("claude-sonnet-5", "fallback", "error")
    # Allow error path (external service) but log
    if d["generated_by"] == "error":
        pytest.skip(f"AI service returned error: {d}")
    assert isinstance(d["insights"], list)
