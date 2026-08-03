import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Bus, Check, Loader2, MailCheck, PartyPopper, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { SURVEY } from "@/constants/testIds";

const STEPS = ["Email", "You", "Route", "Days", "Trips", "Payment", "Review"];

const MONTH_OPTIONS = (() => {
  const now = new Date();
  const out = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
    });
  }
  return out;
})();

export default function Survey() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);
  const [scheduleCounts, setScheduleCounts] = useState(null);
  const [isEditing, setIsEditing] = useState(false);

  const [form, setForm] = useState({
    email: "",
    name: "",
    phone: "",
    month: MONTH_OPTIONS[0].value,
    route_id: "chashara_rampura",
    days: [],
    trips_per_day: {},
    payment_plan: "monthly",
    fare_agreed: true,
    proposed_fare: "",
  });

  useEffect(() => {
    api.get("/config").then((r) => setConfig(r.data)).catch(() => {});
  }, []);

  // Live working-day counts (from admin calendar) drive the price preview
  useEffect(() => {
    if (!form.month || !form.payment_plan) return;
    api
      .get(`/schedule/counts?scope=${form.payment_plan}&month=${form.month}`)
      .then((r) => setScheduleCounts(r.data))
      .catch(() => setScheduleCounts(null));
  }, [form.month, form.payment_plan]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // ---------- Pricing calculation ----------
  const pricing = useMemo(() => {
    if (!config || !scheduleCounts) return { total: 0, breakdown: {}, workingDays: 0 };
    const plan = config.fares[form.payment_plan];
    const counts = scheduleCounts.counts || {};
    const breakdown = {};
    let total = 0;
    for (const d of form.days) {
      const trips = form.trips_per_day[d] || [];
      if (trips.length === 0) continue;
      const hasUp = trips.some((t) => t.startsWith("UP"));
      const hasDown = trips.some((t) => t.startsWith("DOWN"));
      const rate = hasUp && hasDown ? plan.round_trip : plan.one_way;
      const occ = counts[d] || 0;
      const subtotal = rate * occ;
      breakdown[d] = { trips, rate, occ, subtotal, type: hasUp && hasDown ? "round" : "one" };
      total += subtotal;
    }
    return {
      total,
      breakdown,
      workingDays: scheduleCounts.total_working_days || 0,
      scopeStart: scheduleCounts.start,
      scopeEnd: scheduleCounts.end,
    };
  }, [form.days, form.trips_per_day, form.payment_plan, config, scheduleCounts]);

  // ---------- Step navigation ----------
  const canNext = useMemo(() => {
    if (!config) return false;
    if (step === 0) return /^\d{4}-\d-\d{2}-\d{3}@std\.ewubd\.edu$/.test(form.email.trim().toLowerCase()) && !previous;
    if (step === 1) return form.name.trim().length >= 2 && form.phone.trim().length >= 6 && form.month;
    if (step === 2) return !!form.route_id;
    if (step === 3) return form.days.length > 0;
    if (step === 4) return form.days.every((d) => (form.trips_per_day[d] || []).length > 0);
    if (step === 5) {
      if (!form.payment_plan) return false;
      if (!form.fare_agreed) {
        const v = parseFloat(form.proposed_fare);
        return !isNaN(v) && v > 0;
      }
      return true;
    }
    return true;
  }, [step, form, previous, config]);

  // ---------- Actions ----------
  const lookup = async () => {
    const email = form.email.trim().toLowerCase();
    try {
      const { data } = await api.post("/survey/lookup", { email });
      if (data.exists) {
        setPrevious(data.survey);
      } else {
        setPrevious(null);
        setStep(1);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Invalid student email.");
    }
  };

  const startEdit = () => {
    if (!previous) return;
    setForm({
      email: previous.email || form.email,
      name: previous.name || "",
      phone: previous.phone || "",
      month: previous.month || MONTH_OPTIONS[0].value,
      route_id: previous.route_id || "chashara_rampura",
      days: previous.days || [],
      trips_per_day: previous.trips_per_day || {},
      payment_plan: previous.payment_plan || "monthly",
      fare_agreed: previous.fare_agreed !== false,
      proposed_fare: previous.proposed_fare != null ? String(previous.proposed_fare) : "",
    });
    setIsEditing(true);
    setPrevious(null);
    setStep(1);
    toast.info("Loaded your previous response — edit any field and re-submit.");
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        email: form.email.trim().toLowerCase(),
        proposed_fare: form.fare_agreed ? null : parseFloat(form.proposed_fare),
      };
      const url = isEditing ? "/survey/update" : "/survey/submit";
      const { data } = await api.post(url, payload);
      setDone({ ...data, edited: isEditing });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitLead = async () => {
    const email = form.email.trim().toLowerCase();
    try {
      const { data } = await api.post("/survey/submit", {
        email,
        name: form.name,
        phone: form.phone,
        month: form.month,
        route_id: form.route_id,
        days: [],
        trips_per_day: {},
        payment_plan: "monthly",
        fare_agreed: true,
      });
      setDone({ ...data, lead: true });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save contact info.");
    }
  };

  // ---------- Done screens ----------
  if (done?.lead || done?.status === "lead_recorded") {
    return <ThankYouLead />;
  }
  if (done?.status === "ok" || done?.status === "updated") {
    return <ThankYou survey={done.survey} edited={done.status === "updated" || done.edited} />;
  }

  const selectedRoute = config?.routes.find((r) => r.id === form.route_id);
  const isSupportedRoute = selectedRoute?.supported;

  return (
    <div className="min-h-screen bg-[#F9F8F6]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        {/* Nav */}
        <div className="flex items-center justify-between mb-8">
          <Link to="/" className="flex items-center gap-2 text-[#0F5132] hover:underline text-sm">
            <ArrowLeft className="w-4 h-4" /> Back to landing
          </Link>
          <div className="flex items-center gap-2 text-[#7A8A82] text-sm">
            <Bus className="w-4 h-4" /> Student Shuttle Survey
          </div>
        </div>

        {/* Stepper */}
        <div data-testid={SURVEY.stepIndicator} className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="eyebrow">Step {step + 1} of {STEPS.length}</div>
            <div className="text-sm text-[#4A5550]">{STEPS[step]}</div>
          </div>
          <div className="h-1.5 rounded-full bg-[#E2E8E5] overflow-hidden">
            <div
              className="h-full bg-[#0F5132] transition-all duration-500"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        {isEditing && step > 0 && (
          <div
            data-testid={SURVEY.editingBanner}
            className="mb-6 rounded-xl border border-[#D1E8DD] bg-[#E8F0EA] px-4 py-3 flex items-center justify-between text-sm"
          >
            <div className="flex items-center gap-2 text-[#0F5132]">
              <Check className="w-4 h-4" />
              <span className="font-semibold">Editing your existing response</span>
              <span className="text-[#4A5550]">— changes will overwrite your previous submission.</span>
            </div>
          </div>
        )}

        {/* Body */}
        <div data-testid={SURVEY.root} className="rounded-2xl border border-[#E2E8E5] bg-white p-6 sm:p-10 fade-in" key={step}>
          {step === 0 && (
            <StepEmail
              email={form.email}
              setEmail={(v) => setField("email", v)}
              previous={previous}
              lookup={lookup}
              startEdit={startEdit}
              example={config?.email_example}
            />
          )}
          {step === 1 && (
            <StepYou
              form={form}
              setField={setField}
            />
          )}
          {step === 2 && (
            <StepRoute
              routes={config?.routes || []}
              value={form.route_id}
              setValue={(v) => setField("route_id", v)}
              onLead={submitLead}
              contactName={form.name}
              contactPhone={form.phone}
              setField={setField}
            />
          )}
          {step === 3 && (
            <StepDays
              days={config?.days || []}
              selected={form.days}
              setSelected={(v) => setField("days", v)}
            />
          )}
          {step === 4 && (
            <StepTrips
              days={form.days}
              trips={config?.trips || []}
              value={form.trips_per_day}
              setValue={(v) => setField("trips_per_day", v)}
            />
          )}
          {step === 5 && (
            <StepPayment
              config={config}
              form={form}
              setField={setField}
              pricing={pricing}
            />
          )}
          {step === 6 && (
            <StepReview
              form={form}
              pricing={pricing}
              config={config}
            />
          )}
        </div>

        {/* Footer nav */}
        {!(step === 0 && !previous) && !(step === 2 && !isSupportedRoute) && (
          <div className="mt-8 flex items-center justify-between">
            <Button
              variant="outline"
              className="rounded-full border-2 border-[#E2E8E5] text-[#4A5550] hover:bg-[#F0EFE9]"
              disabled={step === 0 || submitting}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              data-testid={SURVEY.reviewBack}
            >
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canNext}
                data-testid={
                  step === 1 ? SURVEY.infoContinue :
                  step === 2 ? SURVEY.routeContinue :
                  step === 3 ? SURVEY.daysContinue :
                  step === 4 ? SURVEY.tripsContinue :
                  step === 5 ? SURVEY.paymentContinue : "next-btn"
                }
                className="rounded-full bg-[#0F5132] hover:bg-[#146C43] text-white px-6"
              >
                Continue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={submit}
                disabled={submitting}
                data-testid={SURVEY.reviewSubmit}
                className="rounded-full bg-[#0F5132] hover:bg-[#146C43] text-white px-8"
              >
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                {isEditing ? "Save changes" : "Submit response"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============= Steps =============
function StepEmail({ email, setEmail, previous, lookup, startEdit, example }) {
  return (
    <div>
      <div className="eyebrow mb-2">Step 1 · Verify</div>
      <h2 className="font-display text-3xl font-semibold text-[#1A211D]">Enter your EWU student ID email</h2>
      <p className="text-[#4A5550] mt-2">
        We use your student ID to make sure every response is unique.
        Format: <span className="mono text-[#0F5132]">{example || "2___-_-__-___@std.ewubd.edu"}</span>
      </p>
      <div className="mt-6 space-y-3">
        <Label htmlFor="email" className="text-xs uppercase tracking-wider text-[#7A8A82] font-semibold">Student email</Label>
        <div className="flex gap-3">
          <Input
            id="email"
            data-testid={SURVEY.emailInput}
            placeholder="2___-_-__-___@std.ewubd.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mono h-12 rounded-xl border-[#E2E8E5] focus:border-[#0F5132] focus:ring-1 focus:ring-[#0F5132]"
          />
          <Button
            onClick={lookup}
            data-testid={SURVEY.emailContinue}
            className="h-12 rounded-full bg-[#0F5132] hover:bg-[#146C43] text-white px-6"
          >
            Continue <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
        <p className="text-xs text-[#7A8A82] flex items-center gap-2 mt-2">
          <MailCheck className="w-3.5 h-3.5" /> Only IDs matching the EWU pattern are accepted. No fakes.
        </p>
      </div>
      {previous && (
        <div data-testid={SURVEY.emailPreviousBanner} className="mt-6 rounded-xl border border-[#D1E8DD] bg-[#E8F0EA] p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-[#0F5132] text-white grid place-items-center shrink-0">
              <Check className="w-4 h-4" />
            </div>
            <div className="flex-1 text-sm">
              <div className="font-semibold text-[#0F5132]">You've already submitted a response.</div>
              <div className="text-[#4A5550] mt-1">
                Submitted for <span className="font-semibold">{previous.month}</span> · Route: {previous.route_label} · Total ৳{Math.round(previous.total_price)}
              </div>
              <div className="text-[#7A8A82] text-xs mt-2">
                You can edit any field below and re-submit — your existing response will be updated in place.
              </div>
              <Button
                data-testid={SURVEY.emailEditExisting}
                onClick={startEdit}
                className="mt-3 rounded-full bg-[#0F5132] hover:bg-[#146C43] text-white"
              >
                Edit my response
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepYou({ form, setField }) {
  return (
    <div>
      <div className="eyebrow mb-2">Step 2 · About you</div>
      <h2 className="font-display text-3xl font-semibold text-[#1A211D]">Tell us how to reach you</h2>
      <div className="mt-6 grid gap-5">
        <Field label="Full name">
          <Input
            data-testid={SURVEY.nameInput}
            placeholder="Rahim Ahmed"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            className="h-12 rounded-xl border-[#E2E8E5] focus:border-[#0F5132] focus:ring-1 focus:ring-[#0F5132]"
          />
        </Field>
        <Field label="Phone number">
          <Input
            data-testid={SURVEY.phoneInput}
            placeholder="01XXX XXXXXX"
            value={form.phone}
            onChange={(e) => setField("phone", e.target.value)}
            className="h-12 rounded-xl border-[#E2E8E5] focus:border-[#0F5132] focus:ring-1 focus:ring-[#0F5132] mono"
          />
        </Field>
        <Field label="Which month will you start using the shuttle?">
          <Select value={form.month} onValueChange={(v) => setField("month", v)}>
            <SelectTrigger
              data-testid={SURVEY.monthSelect}
              className="h-12 rounded-xl border-[#E2E8E5] focus:border-[#0F5132] focus:ring-1 focus:ring-[#0F5132]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </div>
  );
}

function StepRoute({ routes, value, setValue, onLead, contactName, contactPhone, setField }) {
  const selected = routes.find((r) => r.id === value);
  const isSupported = selected?.supported;
  return (
    <div>
      <div className="eyebrow mb-2">Step 3 · Route</div>
      <h2 className="font-display text-3xl font-semibold text-[#1A211D]">Which route are you interested in?</h2>
      <p className="text-[#4A5550] mt-2">Only the Rampura ↔ Chashara route is in the current pilot. Other routes are logged as future demand.</p>
      <div className="mt-6 grid gap-3">
        {routes.map((r) => (
          <button
            key={r.id}
            data-testid={SURVEY.routeCard(r.id)}
            onClick={() => setValue(r.id)}
            className={`text-left rounded-xl border-2 p-4 transition-all ${
              value === r.id
                ? "border-[#0F5132] bg-[#E8F0EA]"
                : "border-[#E2E8E5] bg-white hover:bg-[#F9F8F6]"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-[#1A211D] flex items-center gap-2">
                  {r.label}
                  {r.supported && (
                    <span className="text-[10px] uppercase tracking-wider bg-[#0F5132] text-white px-2 py-0.5 rounded-full">Active pilot</span>
                  )}
                </div>
                {r.via && <div className="text-sm text-[#7A8A82] mt-0.5">Via {r.via}</div>}
              </div>
              <div className={`w-5 h-5 rounded-full border-2 ${value === r.id ? "border-[#0F5132] bg-[#0F5132]" : "border-[#E2E8E5]"}`}>
                {value === r.id && <Check className="w-4 h-4 text-white" />}
              </div>
            </div>
          </button>
        ))}
      </div>

      {!isSupported && selected && (
        <div className="mt-6 rounded-xl border border-[#FBCFE8] bg-[#FDF2F8] p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-[#BE185D]/10 text-[#BE185D] grid place-items-center shrink-0">
              <MapPin className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-[#BE185D]">This route isn't in the current pilot.</div>
              <p className="text-sm text-[#4A5550] mt-1">
                We'll log your interest and contact you once we plan a route for
                <span className="font-semibold"> {selected.label}</span>.
                Confirm your contact details below.
              </p>
              <div className="mt-4 grid sm:grid-cols-2 gap-3">
                <Input
                  data-testid={SURVEY.contactLeadName}
                  placeholder="Full name"
                  value={contactName}
                  onChange={(e) => setField("name", e.target.value)}
                  className="h-11 rounded-xl border-[#FBCFE8] bg-white focus:border-[#BE185D]"
                />
                <Input
                  data-testid={SURVEY.contactLeadPhone}
                  placeholder="Phone"
                  value={contactPhone}
                  onChange={(e) => setField("phone", e.target.value)}
                  className="h-11 rounded-xl border-[#FBCFE8] bg-white focus:border-[#BE185D] mono"
                />
              </div>
              <Button
                data-testid={SURVEY.contactLeadSubmit}
                onClick={onLead}
                className="mt-4 rounded-full bg-[#BE185D] hover:bg-[#9D174D] text-white"
                disabled={!contactName.trim() || !contactPhone.trim()}
              >
                Save my interest
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepDays({ days, selected, setSelected }) {
  const toggle = (d) => {
    if (selected.includes(d)) setSelected(selected.filter((x) => x !== d));
    else setSelected([...selected, d]);
  };
  return (
    <div>
      <div className="eyebrow mb-2">Step 4 · Weekdays</div>
      <h2 className="font-display text-3xl font-semibold text-[#1A211D]">Choose your ride for Fall 2026</h2>
      <p className="text-[#4A5550] mt-2">Pick every weekday you'll need the shuttle to match your class schedule. Fri/Sat & any admin-marked holidays are off automatically.</p>
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-5 gap-3">
        {days.map((d) => {
          const on = selected.includes(d);
          return (
            <button
              key={d}
              data-testid={SURVEY.dayCard(d)}
              onClick={() => toggle(d)}
              className={`rounded-xl border-2 p-4 text-left transition-all ${
                on ? "border-[#0F5132] bg-[#E8F0EA]" : "border-[#E2E8E5] bg-white hover:bg-[#F9F8F6]"
              }`}
            >
              <div className="text-xs uppercase tracking-wider text-[#7A8A82]">{d.slice(0, 3)}</div>
              <div className="font-display text-lg font-semibold mt-1">{d}</div>
              <div className={`mt-2 text-xs ${on ? "text-[#0F5132]" : "text-[#7A8A82]"}`}>
                {on ? "Selected" : "Tap to select"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepTrips({ days, trips, value, setValue }) {
  const toggle = (day, tripId) => {
    const cur = value[day] || [];
    const next = cur.includes(tripId) ? cur.filter((t) => t !== tripId) : [...cur, tripId];
    setValue({ ...value, [day]: next });
  };
  return (
    <div>
      <div className="eyebrow mb-2">Step 5 · Trips</div>
      <h2 className="font-display text-3xl font-semibold text-[#1A211D]">Pick trips for each day</h2>
      <p className="text-[#4A5550] mt-2">
        Choose your times according to your class schedule. Up trips take you toward Rampura; down trips return you to Chashara. Combine both for a round trip.
      </p>
      <div className="mt-6 space-y-6">
        {days.map((d) => (
          <div key={d} className="rounded-xl border border-[#E2E8E5] bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="font-display text-lg font-semibold text-[#1A211D]">{d}</div>
              <div className="text-xs text-[#7A8A82]">{(value[d] || []).length} trip(s) selected</div>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {trips.map((t) => {
                const on = (value[d] || []).includes(t.id);
                return (
                  <label
                    key={t.id}
                    className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
                      on ? "border-[#0F5132] bg-[#E8F0EA]" : "border-[#E2E8E5] hover:bg-[#F9F8F6]"
                    }`}
                  >
                    <Checkbox
                      data-testid={SURVEY.tripCheckbox(d, t.id)}
                      checked={on}
                      onCheckedChange={() => toggle(d, t.id)}
                      className="mt-0.5 border-[#0F5132] data-[state=checked]:bg-[#0F5132]"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-wider bg-[#F0EFE9] px-2 py-0.5 rounded-full text-[#4A5550]">
                          {t.direction === "up" ? "UP" : "DOWN"}
                        </span>
                        <span className="text-sm font-semibold text-[#1A211D] truncate">{t.label}</span>
                      </div>
                      <div className="text-xs text-[#7A8A82] mt-1">{t.note}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepPayment({ config, form, setField, pricing }) {
  if (!config) return null;
  return (
    <div>
      <div className="eyebrow mb-2">Step 6 · Payment</div>
      <h2 className="font-display text-3xl font-semibold text-[#1A211D]">Choose your payment plan</h2>
      <div className="mt-6 grid sm:grid-cols-2 gap-4">
        {Object.entries(config.fares).map(([id, f]) => (
          <button
            key={id}
            data-testid={SURVEY.planCard(id)}
            onClick={() => setField("payment_plan", id)}
            className={`text-left rounded-xl border-2 p-5 transition-all ${
              form.payment_plan === id ? "border-[#0F5132] bg-[#E8F0EA]" : "border-[#E2E8E5] bg-white hover:bg-[#F9F8F6]"
            }`}
          >
            <div className="text-xs uppercase tracking-wider text-[#7A8A82]">{f.label}</div>
            <div className="mt-2 flex items-baseline gap-2">
              <div className="font-display text-3xl font-semibold text-[#0F5132]">৳{f.one_way}</div>
              <div className="text-sm text-[#7A8A82]">/ one-way day</div>
            </div>
            <div className="text-sm text-[#4A5550]">Round-trip: <span className="font-semibold">৳{f.round_trip}</span></div>
            <div className="mt-2 text-xs text-[#7A8A82]">{f.note} • {f.weeks} weeks</div>
          </button>
        ))}
      </div>

      {/* Live total */}
      <div className="mt-6 rounded-xl border border-[#0F5132] bg-[#0F5132] text-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#D1E8DD]">Your estimated total</div>
            <div className="font-display text-3xl font-semibold mt-1">৳ {Math.round(pricing.total)}</div>
            <div className="text-xs text-[#D1E8DD] mt-1">
              Across {pricing.workingDays} working days — Fri/Sat & holidays excluded.
            </div>
            <div className="text-[11px] text-[#D1E8DD] mt-1 mono">
              {pricing.scopeStart} → {pricing.scopeEnd}
            </div>
          </div>
          <div className="text-right text-xs text-[#D1E8DD] space-y-0.5">
            {Object.entries(pricing.breakdown).map(([d, b]) => (
              <div key={d} className="mono">
                {d}: ৳{b.rate} × {b.occ} = ৳{b.subtotal}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[#D1E8DD] bg-[#E8F0EA] p-3 text-xs text-[#0F5132]">
        The bus only runs on working days. Weekends and holidays marked by the shuttle office are excluded automatically — pick your trips to match your class schedule.
      </div>

      {/* Fare agreement */}
      <div className="mt-6">
        <div className="eyebrow mb-3">Are you happy with this fare?</div>
        <RadioGroup
          value={form.fare_agreed ? "yes" : "no"}
          onValueChange={(v) => setField("fare_agreed", v === "yes")}
          className="grid sm:grid-cols-2 gap-3"
        >
          <label className={`rounded-xl border-2 p-4 cursor-pointer flex items-center gap-3 ${form.fare_agreed ? "border-[#0F5132] bg-[#E8F0EA]" : "border-[#E2E8E5] bg-white"}`}>
            <RadioGroupItem value="yes" data-testid={SURVEY.fareAgree} className="border-[#0F5132] text-[#0F5132]" />
            <div>
              <div className="font-semibold text-[#1A211D]">I'm okay with this fare</div>
              <div className="text-xs text-[#7A8A82]">Let's move forward.</div>
            </div>
          </label>
          <label className={`rounded-xl border-2 p-4 cursor-pointer flex items-center gap-3 ${!form.fare_agreed ? "border-[#BE185D] bg-[#FDF2F8]" : "border-[#E2E8E5] bg-white"}`}>
            <RadioGroupItem value="no" data-testid={SURVEY.fareDisagree} className="border-[#BE185D] text-[#BE185D]" />
            <div>
              <div className="font-semibold text-[#1A211D]">I want it cheaper</div>
              <div className="text-xs text-[#7A8A82]">Suggest your own per-day one-way fare.</div>
            </div>
          </label>
        </RadioGroup>
        {!form.fare_agreed && (
          <div className="mt-4">
            <Label className="text-xs uppercase tracking-wider text-[#7A8A82] font-semibold">
              Your suggested one-way fare (BDT / day)
            </Label>
            <Input
              data-testid={SURVEY.fareProposedInput}
              type="number"
              min="1"
              value={form.proposed_fare}
              onChange={(e) => setField("proposed_fare", e.target.value)}
              placeholder="e.g. 80"
              className="mt-2 h-11 rounded-xl border-[#FBCFE8] focus:border-[#BE185D] focus:ring-1 focus:ring-[#BE185D] mono"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function StepReview({ form, pricing, config }) {
  const route = config?.routes.find((r) => r.id === form.route_id);
  return (
    <div>
      <div className="eyebrow mb-2">Step 7 · Review</div>
      <h2 className="font-display text-3xl font-semibold text-[#1A211D]">Everything correct?</h2>
      <div className="mt-6 space-y-3">
        <ReviewRow label="Student" value={<span className="mono">{form.email}</span>} />
        <ReviewRow label="Name" value={form.name} />
        <ReviewRow label="Phone" value={<span className="mono">{form.phone}</span>} />
        <ReviewRow label="Starting month" value={MONTH_OPTIONS.find((m) => m.value === form.month)?.label} />
        <ReviewRow label="Route" value={route?.label} />
        <ReviewRow label="Days" value={form.days.join(", ")} />
        <ReviewRow label="Trips" value={
          <div className="space-y-1">
            {Object.entries(form.trips_per_day).filter(([, v]) => v.length).map(([d, v]) => (
              <div key={d}><span className="text-[#7A8A82] mr-2">{d}:</span> <span className="mono text-xs">{v.join(", ")}</span></div>
            ))}
          </div>
        } />
        <ReviewRow label="Plan" value={config?.fares[form.payment_plan]?.label} />
        <ReviewRow label="Working days in scope" value={`${pricing.workingDays} days`} />
        <ReviewRow
          label="Total"
          value={<span className="font-display text-xl text-[#0F5132]">৳ {Math.round(pricing.total)} <span className="text-xs text-[#7A8A82]">/ {pricing.workingDays} working days</span></span>}
        />
        <ReviewRow
          label="Fare"
          value={form.fare_agreed ? "Agreed" : <span className="text-[#BE185D]">Proposed ৳{form.proposed_fare} / one-way</span>}
        />
      </div>
    </div>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div className="grid grid-cols-3 gap-3 items-start py-2 border-b border-[#E2E8E5] last:border-b-0">
      <div className="text-xs uppercase tracking-wider text-[#7A8A82] font-semibold pt-1">{label}</div>
      <div className="col-span-2 text-[#1A211D] text-sm">{value}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-[#7A8A82] font-semibold">{label}</Label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ThankYou({ survey }) {
  return (
    <div className="min-h-screen bg-[#F9F8F6] grid place-items-center px-4">
      <div data-testid={SURVEY.successCard} className="max-w-lg w-full rounded-2xl border border-[#D1E8DD] bg-white p-8 sm:p-10 text-center fade-in">
        <div className="w-16 h-16 rounded-full bg-[#0F5132] text-white grid place-items-center mx-auto">
          <PartyPopper className="w-7 h-7" />
        </div>
        <h2 className="mt-5 font-display text-3xl font-semibold text-[#1A211D]">Response saved!</h2>
        <p className="mt-2 text-[#4A5550]">
          Thanks, {survey?.name || "student"}. A confirmation email is on its way to
          <span className="mono text-[#0F5132]"> {survey?.email}</span>.
        </p>
        <div className="mt-6 rounded-xl bg-[#F0EFE9] p-4 text-left text-sm">
          <div className="flex justify-between"><span className="text-[#7A8A82]">Route</span><span>{survey?.route_label}</span></div>
          <div className="flex justify-between mt-1"><span className="text-[#7A8A82]">Plan</span><span>{survey?.payment_plan}</span></div>
          <div className="flex justify-between mt-1"><span className="text-[#7A8A82]">Estimated total</span><span className="font-semibold">৳{Math.round(survey?.total_price || 0)}</span></div>
        </div>
        <Link to="/" className="mt-6 inline-block">
          <Button variant="outline" className="rounded-full border-2 border-[#0F5132] text-[#0F5132] hover:bg-[#E8F0EA]">
            Back to landing
          </Button>
        </Link>
      </div>
    </div>
  );
}

function ThankYouLead() {
  return (
    <div className="min-h-screen bg-[#F9F8F6] grid place-items-center px-4">
      <div className="max-w-lg w-full rounded-2xl border border-[#FBCFE8] bg-white p-8 sm:p-10 text-center fade-in">
        <div className="w-16 h-16 rounded-full bg-[#BE185D] text-white grid place-items-center mx-auto">
          <MapPin className="w-7 h-7" />
        </div>
        <h2 className="mt-5 font-display text-3xl font-semibold text-[#1A211D]">We'll contact you soon</h2>
        <p className="mt-2 text-[#4A5550]">
          Your interest in this alternate route is logged. The shuttle office will reach out once demand justifies a new route.
        </p>
        <Link to="/" className="mt-6 inline-block">
          <Button variant="outline" className="rounded-full border-2 border-[#0F5132] text-[#0F5132] hover:bg-[#E8F0EA]">
            Back to landing
          </Button>
        </Link>
      </div>
    </div>
  );
}
