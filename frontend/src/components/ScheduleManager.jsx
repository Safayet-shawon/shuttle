import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Save, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN } from "@/constants/testIds";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const daysInMonth = (year, month) => new Date(year, month, 0).getDate(); // month 1-based
const firstWeekday = (year, month) => new Date(year, month - 1, 1).getDay(); // 0=Sun

export default function ScheduleManager() {
  const [sem, setSem] = useState({ label: "", start_date: "", end_date: "" });
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(9);
  const [schedule, setSchedule] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSem = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/semester-config");
      setSem(data);
    } catch { /* noop */ }
  }, []);

  const loadSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/schedule?year=${year}&month=${month}`);
      const map = {};
      (data.dates || []).forEach((d) => { map[d.date] = d; });
      setSchedule(map);
    } catch {
      toast.error("Could not load month schedule");
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { loadSem(); }, [loadSem]);
  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  const saveSem = async () => {
    setSaving(true);
    try {
      await api.post("/admin/semester-config", sem);
      toast.success("Semester saved");
      loadSem();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (d) => {
    if (d.is_weekend) return;
    try {
      await api.post("/admin/schedule", { date: d.date, is_working: !d.is_working });
      loadSchedule();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Toggle failed");
    }
  };

  const step = (delta) => {
    let y = year, m = month + delta;
    if (m > 12) { y += 1; m = 1; }
    if (m < 1)  { y -= 1; m = 12; }
    setYear(y); setMonth(m);
  };

  const nDays = daysInMonth(year, month);
  const start = firstWeekday(year, month);
  const cells = useMemo(() => {
    const arr = [];
    for (let i = 0; i < start; i++) arr.push(null);
    for (let d = 1; d <= nDays; d++) {
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      arr.push({ day: d, iso });
    }
    return arr;
  }, [year, month, nDays, start]);

  // Monthly summary
  const summary = useMemo(() => {
    const c = { working: 0, off: 0, weekend: 0 };
    Object.values(schedule).forEach((d) => {
      if (d.is_weekend) c.weekend += 1;
      else if (d.is_working) c.working += 1;
      else c.off += 1;
    });
    return c;
  }, [schedule]);

  return (
    <div className="space-y-6" data-testid={ADMIN.scheduleTab}>
      {/* Semester dates */}
      <div className="rounded-2xl border border-[#E2E8E5] bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="eyebrow">Semester</div>
            <h3 className="font-display text-xl font-semibold text-[#1A211D] mt-1">Set semester start & end dates</h3>
            <p className="text-sm text-[#7A8A82] mt-1">
              These dates bound the "Pay per Semester" plan and the default pricing scope for every survey response.
            </p>
          </div>
          <CalendarDays className="w-5 h-5 text-[#0F5132]" />
        </div>
        <div className="mt-5 grid sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#7A8A82] font-semibold">Label</Label>
            <Input
              data-testid={ADMIN.semesterLabel}
              value={sem.label || ""}
              onChange={(e) => setSem({ ...sem, label: e.target.value })}
              placeholder="Fall 2026"
              className="mt-2 h-11 rounded-xl border-[#E2E8E5]"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#7A8A82] font-semibold">Start date</Label>
            <Input
              data-testid={ADMIN.semesterStart}
              type="date"
              value={sem.start_date || ""}
              onChange={(e) => setSem({ ...sem, start_date: e.target.value })}
              className="mt-2 h-11 rounded-xl border-[#E2E8E5] mono"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#7A8A82] font-semibold">End date</Label>
            <Input
              data-testid={ADMIN.semesterEnd}
              type="date"
              value={sem.end_date || ""}
              onChange={(e) => setSem({ ...sem, end_date: e.target.value })}
              className="mt-2 h-11 rounded-xl border-[#E2E8E5] mono"
            />
          </div>
        </div>
        <Button
          data-testid={ADMIN.semesterSave}
          onClick={saveSem}
          disabled={saving}
          className="mt-4 rounded-full bg-[#0F5132] hover:bg-[#146C43] text-white"
        >
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save semester dates
        </Button>
      </div>

      {/* Calendar */}
      <div className="rounded-2xl border border-[#E2E8E5] bg-white p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="eyebrow">Working days</div>
            <h3 className="font-display text-xl font-semibold text-[#1A211D] mt-1">
              Choose which days the bus runs
            </h3>
            <p className="text-sm text-[#7A8A82] mt-1 max-w-xl">
              Sunday–Thursday are working days by default; Friday & Saturday are always off. Click any weekday to
              mark it green (running) or red (holiday). Student prices auto-recalculate from these settings.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              data-testid={ADMIN.scheduleMonthPrev}
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={() => step(-1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="font-display text-lg font-semibold min-w-[180px] text-center">
              {MONTH_NAMES[month - 1]} {year}
            </div>
            <Button
              data-testid={ADMIN.scheduleMonthNext}
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={() => step(1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Legend + summary */}
        <div className="mt-4 flex items-center gap-4 text-xs text-[#7A8A82] flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-[#0F5132]" /> Working ({summary.working})
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-[#FDF2F8] border border-[#FBCFE8]" /> Off / holiday ({summary.off})
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-[#F0EFE9] border border-[#E2E8E5]" /> Fri / Sat auto-off ({summary.weekend})
          </div>
        </div>

        {loading ? (
          <div className="h-64 grid place-items-center text-[#7A8A82]">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-7 gap-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="text-[10px] uppercase tracking-wider text-[#7A8A82] font-semibold text-center pb-1">
                {d}
              </div>
            ))}
            {cells.map((c, i) => {
              if (!c) return <div key={`e-${i}`} />;
              const info = schedule[c.iso];
              if (!info) return <div key={c.iso} className="aspect-square rounded-lg bg-[#F9F8F6]" />;
              const isWeekend = info.is_weekend;
              const working = info.is_working;
              return (
                <button
                  key={c.iso}
                  data-testid={ADMIN.scheduleDate(c.iso)}
                  disabled={isWeekend}
                  onClick={() => toggle(info)}
                  className={`aspect-square rounded-lg text-sm font-semibold border transition-all flex flex-col items-center justify-center ${
                    isWeekend
                      ? "bg-[#F0EFE9] text-[#7A8A82] border-[#E2E8E5] cursor-not-allowed"
                      : working
                        ? "bg-[#0F5132] text-white border-[#0F5132] hover:bg-[#146C43]"
                        : "bg-[#FDF2F8] text-[#BE185D] border-[#FBCFE8] hover:bg-[#FBCFE8]"
                  }`}
                  title={`${info.date} · ${info.weekday}`}
                >
                  <div>{c.day}</div>
                  <div className={`text-[9px] font-normal opacity-80`}>
                    {isWeekend ? info.weekday.slice(0, 3) : working ? "on" : "off"}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
