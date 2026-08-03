import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";
import {
  Bus, LogOut, Download, RefreshCcw, Play, Pause, KeyRound, Ban,
  Sparkles, Users, TrendingUp, Percent, Zap, AlertTriangle, Trash2, FileText, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { api, currentMonth, humanMonth } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { ADMIN } from "@/constants/testIds";

const CHART = ["#0F5132", "#2E7D54", "#5DA77F", "#9ECFBA", "#D1E8DD"];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState(null);
  const [responses, setResponses] = useState([]);
  const [months, setMonths] = useState([]);
  const [month, setMonth] = useState("");
  const [surveyStarted, setSurveyStarted] = useState(false);
  const [forecast, setForecast] = useState(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [banned, setBanned] = useState([]);
  const [leads, setLeads] = useState([]);
  const [me, setMe] = useState(null);
  const [resetReason, setResetReason] = useState("testing");
  const [resetOpen, setResetOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [meRes, aRes, rRes, mRes, sRes, bRes, lRes] = await Promise.all([
        api.get("/admin/me"),
        api.get(`/admin/analytics${month ? `?month=${month}` : ""}`),
        api.get(`/admin/responses${month ? `?month=${month}` : ""}`),
        api.get("/admin/available-months"),
        api.get("/admin/survey/state"),
        api.get("/admin/banned"),
        api.get("/admin/leads"),
      ]);
      setMe(meRes.data);
      setAnalytics(aRes.data);
      setResponses(rRes.data);
      setMonths(mRes.data);
      setSurveyStarted(!!sRes.data.is_started);
      setBanned(bRes.data);
      setLeads(lRes.data);
    } catch (e) {
      if (e?.response?.status !== 401) toast.error("Failed to load dashboard.");
    }
  }, [month]);

  useEffect(() => {
    if (!localStorage.getItem("ewu_admin_token")) {
      navigate("/admin/login");
      return;
    }
    loadAll();
  }, [loadAll, navigate]);

  const loadForecast = async () => {
    setForecastLoading(true);
    try {
      const { data } = await api.get(`/admin/forecast${month ? `?month=${month}` : ""}`);
      setForecast(data);
    } catch (e) {
      toast.error("Forecast unavailable.");
    } finally {
      setForecastLoading(false);
    }
  };

  const toggleSurvey = async (val) => {
    try {
      await api.post("/admin/survey/toggle", { is_started: val });
      setSurveyStarted(val);
      toast.success(val ? "Survey is now LIVE — real data will be collected." : "Survey paused — new responses are test data.");
    } catch {
      toast.error("Failed to toggle survey");
    }
  };

  const exportCsv = () => {
    const token = localStorage.getItem("ewu_admin_token");
    const url = `${process.env.REACT_APP_BACKEND_URL}/api/admin/export/csv${month ? `?month=${month}` : ""}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `ewu-shuttle-${month || "all"}.csv`;
        link.click();
      });
  };

  const doReset = async () => {
    try {
      await api.post("/admin/reset", { reason: resetReason });
      toast.success("Dashboard reset. CSV archive preserved.");
      setResetOpen(false);
      await loadAll();
    } catch {
      toast.error("Reset failed");
    }
  };

  const banEmail = async (email) => {
    try {
      await api.post("/admin/ban", { email });
      toast.success(`Banned ${email}`);
      await loadAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Ban failed");
    }
  };

  const unbanEmail = async (email) => {
    try {
      await api.post("/admin/unban", { email });
      toast.success(`Unbanned ${email}`);
      await loadAll();
    } catch {
      toast.error("Unban failed");
    }
  };

  const logout = () => {
    localStorage.removeItem("ewu_admin_token");
    localStorage.removeItem("ewu_admin_email");
    navigate("/admin/login");
  };

  if (!analytics) {
    return (
      <div className="min-h-screen grid place-items-center text-[#7A8A82]">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const dayData = analytics.days_meta.map((d) => ({ day: d.slice(0, 3), Riders: analytics.day_demand[d] || 0 }));
  const tripData = analytics.trips_meta.map((t) => ({
    trip: t.id,
    Riders: analytics.trip_demand[t.id] || 0,
    Occupancy: analytics.trip_occupancy[t.id]?.occupancy_pct || 0,
  }));
  const routeData = Object.entries(analytics.route_demand).map(([name, value]) => ({ name, value }));

  return (
    <div className="min-h-screen bg-[#F9F8F6]">
      <header className="sticky top-0 z-30 bg-[#F9F8F6]/90 backdrop-blur-xl border-b border-[#E2E8E5]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-[#0F5132] text-white grid place-items-center">
              <Bus className="w-5 h-5" />
            </div>
            <div>
              <div className="font-display text-lg font-semibold leading-none">EWU Shuttle</div>
              <div className="text-[10px] tracking-[0.18em] uppercase text-[#7A8A82]">Admin dashboard</div>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#E2E8E5] bg-white">
              <span className="text-xs uppercase tracking-wider text-[#7A8A82]">Survey</span>
              <Switch
                data-testid={ADMIN.toggleSurvey}
                checked={surveyStarted}
                onCheckedChange={toggleSurvey}
                className="data-[state=checked]:bg-[#0F5132]"
              />
              <span className={`text-xs font-semibold ${surveyStarted ? "text-[#0F5132]" : "text-[#BE185D]"}`}>
                {surveyStarted ? "LIVE" : "TEST MODE"}
              </span>
            </div>

            <Select value={month || "all"} onValueChange={(v) => setMonth(v === "all" ? "" : v)}>
              <SelectTrigger data-testid={ADMIN.monthFilter} className="h-10 rounded-full border-[#E2E8E5] bg-white min-w-[180px]">
                <SelectValue placeholder="All time" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                {[currentMonth(), ...months.filter((m) => m !== currentMonth())].map((m) => (
                  <SelectItem key={m} value={m}>{humanMonth(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              onClick={exportCsv}
              data-testid={ADMIN.exportCsv}
              variant="outline"
              className="rounded-full border-[#E2E8E5] hidden sm:flex text-[#4A5550]"
            >
              <Download className="w-4 h-4 mr-2" /> CSV
            </Button>

            <Button onClick={logout} data-testid={ADMIN.logout} variant="ghost" className="rounded-full text-[#4A5550]">
              <LogOut className="w-4 h-4 mr-2" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Test mode banner */}
        {!surveyStarted && (
          <div className="rounded-xl border border-[#FBCFE8] bg-[#FDF2F8] p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#BE185D] shrink-0 mt-0.5" />
            <div className="text-sm flex-1">
              <div className="font-semibold text-[#BE185D]">Survey is not started.</div>
              <div className="text-[#4A5550]">All incoming responses are flagged as <span className="font-semibold">test data (pink)</span> in the exported CSV. Toggle the switch when you're ready for real collection.</div>
            </div>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi
            testid={ADMIN.kpiRespondents}
            icon={<Users className="w-4 h-4" />}
            label="Total respondents"
            value={analytics.total_respondents}
            hint={`${humanMonth(month)} scope`}
          />
          <Kpi
            testid={ADMIN.kpiRevenue}
            icon={<TrendingUp className="w-4 h-4" />}
            label="Est. revenue (BDT)"
            value={`৳ ${Math.round(analytics.revenue).toLocaleString()}`}
            hint="Across all responses"
          />
          <Kpi
            testid={ADMIN.kpiOccupancy}
            icon={<Percent className="w-4 h-4" />}
            label="Avg occupancy"
            value={`${analytics.average_occupancy_pct}%`}
            hint={`of ${analytics.capacity}-seat capacity`}
          />
          <Kpi
            testid={ADMIN.kpiPeak}
            icon={<Zap className="w-4 h-4" />}
            label="Peak trip"
            value={analytics.peak?.count ? `${analytics.peak.trip} · ${analytics.peak.count}` : "—"}
            hint={analytics.peak?.day || "No data"}
          />
        </div>

        {/* AI Forecast */}
        <div data-testid={ADMIN.aiForecastCard} className="rounded-2xl border border-[#D1E8DD] bg-gradient-to-br from-white to-[#E8F0EA] p-6 relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div>
              <div className="eyebrow flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" /> Claude Sonnet 5 · Demand forecast</div>
              <h3 className="mt-1 font-display text-2xl font-semibold text-[#1A211D]">AI-powered insights</h3>
            </div>
            <Button
              onClick={loadForecast}
              disabled={forecastLoading}
              data-testid={ADMIN.aiForecastRefresh}
              variant="outline"
              className="rounded-full border-[#0F5132] text-[#0F5132] hover:bg-white"
            >
              {forecastLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {forecast ? "Refresh" : "Generate"}
            </Button>
          </div>
          {forecast ? (
            <div className="mt-5 grid md:grid-cols-3 gap-4">
              <div className="rounded-xl bg-white/70 backdrop-blur border border-[#D1E8DD] p-4">
                <div className="text-xs uppercase tracking-wider text-[#7A8A82] font-semibold mb-2">Insights</div>
                <ul className="space-y-2 text-sm text-[#1A211D]">
                  {(forecast.insights || []).map((i, idx) => (
                    <li key={idx} className="flex gap-2"><span className="text-[#0F5132]">•</span>{i}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl bg-white/70 backdrop-blur border border-[#D1E8DD] p-4">
                <div className="text-xs uppercase tracking-wider text-[#7A8A82] font-semibold mb-2">Recommendation</div>
                <div className="text-sm text-[#1A211D]">{forecast.recommendation || "—"}</div>
              </div>
              <div className="rounded-xl bg-[#0F5132] text-white p-4">
                <div className="text-xs uppercase tracking-wider text-[#D1E8DD] font-semibold mb-2">Next-semester prediction</div>
                <div className="text-sm">{forecast.prediction || "—"}</div>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-[#4A5550] text-sm">Click "Generate" to see AI-generated demand patterns and a semester prediction based on current responses.</p>
          )}
        </div>

        {/* Charts row */}
        <div className="grid lg:grid-cols-3 gap-4">
          <ChartCard testid={ADMIN.dayChart} title="Day-wise demand" subtitle="Respondents needing shuttle on each weekday">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={dayData}>
                <CartesianGrid stroke="#E2E8E5" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: "#7A8A82", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#7A8A82", fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E2E8E5" }} />
                <Bar dataKey="Riders" radius={[8, 8, 0, 0]} fill="#0F5132" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard testid={ADMIN.tripChart} title="Trip-wise demand & occupancy" subtitle="Seats vs 36-seat capacity">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={tripData}>
                <CartesianGrid stroke="#E2E8E5" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="trip" tick={{ fill: "#7A8A82", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#7A8A82", fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E2E8E5" }} />
                <Legend />
                <Line type="monotone" dataKey="Riders" stroke="#0F5132" strokeWidth={2} dot={{ r: 4, fill: "#0F5132" }} />
                <Line type="monotone" dataKey="Occupancy" stroke="#BE185D" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard testid={ADMIN.routeChart} title="Route demand" subtitle="Distribution across active + lead routes">
            {routeData.length === 0 ? (
              <div className="h-[240px] grid place-items-center text-sm text-[#7A8A82]">No route data yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={routeData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                    {routeData.map((_, i) => <Cell key={i} fill={CHART[i % CHART.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E2E8E5" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* Heatmap */}
        <div className="rounded-2xl border border-[#E2E8E5] bg-white p-6" data-testid={ADMIN.heatmap}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="eyebrow">Demand heatmap</div>
              <h3 className="mt-1 font-display text-xl font-semibold text-[#1A211D]">Day × Trip occupancy</h3>
              <p className="text-sm text-[#7A8A82] mt-1">Darker = more riders. Each cell shows seats/36.</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#7A8A82]">
              <span>Low</span>
              <div className="w-24 h-2 rounded-full bg-gradient-to-r from-[#F0EFE9] to-[#0F5132]" />
              <span>High</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[720px] grid" style={{ gridTemplateColumns: `140px repeat(${analytics.trips_meta.length}, minmax(0,1fr))` }}>
              <div />
              {analytics.trips_meta.map((t) => (
                <div key={t.id} className="text-[10px] uppercase tracking-wider text-[#7A8A82] font-semibold px-2 pb-2 text-center">
                  {t.id}
                  <div className="mono text-[10px] font-normal normal-case tracking-normal">{t.start}</div>
                </div>
              ))}
              {analytics.days_meta.map((d) => (
                <div key={d} className="contents">
                  <div className="text-xs font-semibold text-[#4A5550] flex items-center pr-3">{d}</div>
                  {analytics.trips_meta.map((t) => {
                    const c = analytics.heatmap[d][t.id] || 0;
                    const occ = Math.min(100, (c / analytics.capacity) * 100);
                    return (
                      <div
                        key={t.id}
                        className="aspect-square min-h-[44px] rounded-lg m-1 flex flex-col items-center justify-center text-xs font-semibold border border-[#E2E8E5]"
                        style={{
                          background: c === 0 ? "#F9F8F6" : `rgba(15, 81, 50, ${Math.max(0.12, occ / 100)})`,
                          color: occ > 40 ? "#FFFFFF" : "#1A211D",
                        }}
                        title={`${d} ${t.id}: ${c}/${analytics.capacity} seats · ${occ.toFixed(0)}%`}
                      >
                        <div>{c}</div>
                        <div className={`text-[9px] font-normal ${occ > 40 ? "text-[#D1E8DD]" : "text-[#7A8A82]"}`}>{occ.toFixed(0)}%</div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tabs: Responses / Bans / Leads / Actions */}
        <Tabs defaultValue="responses" className="w-full">
          <TabsList className="bg-white border border-[#E2E8E5] rounded-full p-1">
            <TabsTrigger value="responses" className="rounded-full data-[state=active]:bg-[#0F5132] data-[state=active]:text-white">
              Responses ({responses.length})
            </TabsTrigger>
            <TabsTrigger value="bans" className="rounded-full data-[state=active]:bg-[#0F5132] data-[state=active]:text-white">Banned</TabsTrigger>
            <TabsTrigger value="leads" className="rounded-full data-[state=active]:bg-[#0F5132] data-[state=active]:text-white">Leads ({leads.length})</TabsTrigger>
            <TabsTrigger value="actions" className="rounded-full data-[state=active]:bg-[#0F5132] data-[state=active]:text-white">Actions</TabsTrigger>
          </TabsList>

          <TabsContent value="responses" className="mt-4">
            <div data-testid={ADMIN.responsesTable} className="rounded-2xl border border-[#E2E8E5] bg-white overflow-hidden">
              <div className="overflow-x-auto max-h-[500px]">
                <table className="w-full text-sm">
                  <thead className="bg-[#F0EFE9] sticky top-0">
                    <tr>
                      {["", "Student ID", "Name", "Days", "Trips", "Plan", "Total (৳)", "Fare", "Submitted"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-[#7A8A82] font-semibold">{h}</th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {responses.length === 0 && (
                      <tr><td colSpan={10} className="px-4 py-12 text-center text-[#7A8A82]">No responses yet.</td></tr>
                    )}
                    {responses.map((r) => (
                      <tr key={r.id} className={`border-t border-[#E2E8E5] ${r.is_test_data ? "bg-[#FDF2F8]" : "hover:bg-[#F9F8F6]"}`}>
                        <td className="px-4 py-3">
                          {r.is_test_data ? (
                            <Badge className="bg-[#FBCFE8] text-[#BE185D] hover:bg-[#FBCFE8]">Test</Badge>
                          ) : (
                            <Badge className="bg-[#E8F0EA] text-[#0F5132] hover:bg-[#E8F0EA]">Real</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 mono text-xs">{r.student_id}</td>
                        <td className="px-4 py-3 text-[#1A211D]">{r.name}</td>
                        <td className="px-4 py-3 text-[#4A5550]">{r.days?.join(", ")}</td>
                        <td className="px-4 py-3 text-[#4A5550] text-xs mono">
                          {Object.entries(r.trips_per_day || {}).filter(([, v]) => v?.length).map(([d, v]) => (
                            <div key={d}>{d.slice(0,3)}: {v.join(",")}</div>
                          ))}
                        </td>
                        <td className="px-4 py-3 text-[#4A5550]">{r.payment_plan}</td>
                        <td className="px-4 py-3 font-semibold text-[#0F5132]">৳{Math.round(r.total_price || 0)}</td>
                        <td className="px-4 py-3">
                          {r.fare_agreed ? <span className="text-[#0F5132] text-xs">Agreed</span> : <span className="text-[#BE185D] text-xs mono">৳{r.proposed_fare}</span>}
                        </td>
                        <td className="px-4 py-3 text-[#7A8A82] text-xs">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <Button size="sm" variant="ghost" className="text-[#BE185D] hover:bg-[#FDF2F8]" onClick={() => banEmail(r.email)}>
                            <Ban className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="bans" className="mt-4">
            <div className="rounded-2xl border border-[#E2E8E5] bg-white p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
                <div className="flex-1">
                  <Label className="text-xs uppercase tracking-wider text-[#7A8A82] font-semibold">Ban a student email</Label>
                  <BanForm onSubmit={banEmail} />
                </div>
              </div>
              <div data-testid={ADMIN.bannedList} className="mt-6">
                {banned.length === 0 ? (
                  <div className="text-sm text-[#7A8A82]">No banned users.</div>
                ) : (
                  <div className="space-y-2">
                    {banned.map((b) => (
                      <div key={b.email} className="flex items-center justify-between rounded-lg border border-[#E2E8E5] p-3">
                        <div className="mono text-sm">{b.email}</div>
                        <Button size="sm" variant="ghost" onClick={() => unbanEmail(b.email)} className="text-[#0F5132]">Unban</Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="leads" className="mt-4">
            <div data-testid={ADMIN.leadsList} className="rounded-2xl border border-[#E2E8E5] bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#F0EFE9]">
                    <tr>
                      {["Name", "Phone", "Email", "Requested route", "Submitted"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-[#7A8A82] font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leads.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-12 text-center text-[#7A8A82]">No route leads yet.</td></tr>
                    )}
                    {leads.map((l) => (
                      <tr key={l.id} className="border-t border-[#E2E8E5] hover:bg-[#F9F8F6]">
                        <td className="px-4 py-3">{l.name}</td>
                        <td className="px-4 py-3 mono text-xs">{l.phone}</td>
                        <td className="px-4 py-3 mono text-xs">{l.email}</td>
                        <td className="px-4 py-3 text-[#4A5550]">{l.route_label}</td>
                        <td className="px-4 py-3 text-[#7A8A82] text-xs">{new Date(l.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="actions" className="mt-4">
            <div className="grid md:grid-cols-2 gap-4">
              <ActionCard
                icon={<KeyRound className="w-5 h-5" />}
                title="Change password"
                body="Rotate the admin password. Sign-out is not required afterwards."
                action={
                  <Dialog open={pwOpen} onOpenChange={setPwOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="rounded-full border-[#0F5132] text-[#0F5132]">Change password</Button>
                    </DialogTrigger>
                    <ChangePasswordDialog onDone={() => setPwOpen(false)} />
                  </Dialog>
                }
              />
              <ActionCard
                icon={<Trash2 className="w-5 h-5" />}
                title="Reset dashboard"
                body="Move all responses to the archive. CSV keeps everything with the pink test-data highlight."
                action={
                  <Dialog open={resetOpen} onOpenChange={setResetOpen}>
                    <DialogTrigger asChild>
                      <Button data-testid={ADMIN.resetBtn} variant="outline" className="rounded-full border-[#BE185D] text-[#BE185D]">Reset dashboard</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Reset the dashboard?</DialogTitle>
                        <DialogDescription>Choose the reason. All active responses will be archived (CSV keeps them).</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3 mt-4">
                        <label className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer ${resetReason === "testing" ? "border-[#BE185D] bg-[#FDF2F8]" : "border-[#E2E8E5]"}`}>
                          <input type="radio" checked={resetReason === "testing"} onChange={() => setResetReason("testing")} />
                          <div>
                            <div className="font-semibold">Testing data</div>
                            <div className="text-xs text-[#7A8A82]">Rows will be flagged pink in the CSV.</div>
                          </div>
                        </label>
                        <label className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer ${resetReason === "month_end" ? "border-[#0F5132] bg-[#E8F0EA]" : "border-[#E2E8E5]"}`}>
                          <input type="radio" checked={resetReason === "month_end"} onChange={() => setResetReason("month_end")} />
                          <div>
                            <div className="font-semibold">Month end</div>
                            <div className="text-xs text-[#7A8A82]">Regular monthly close-out.</div>
                          </div>
                        </label>
                      </div>
                      <DialogFooter className="mt-4">
                        <Button variant="ghost" onClick={() => setResetOpen(false)}>Cancel</Button>
                        <Button data-testid={ADMIN.resetConfirm} onClick={doReset} className="bg-[#BE185D] hover:bg-[#9D174D] text-white rounded-full">
                          Confirm reset
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                }
              />
              <ActionCard
                icon={surveyStarted ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                title={surveyStarted ? "Pause survey" : "Start survey"}
                body={surveyStarted ? "New responses will be flagged as test data until re-started." : "Live collection: responses saved as real data."}
                action={
                  <Button
                    onClick={() => toggleSurvey(!surveyStarted)}
                    className="rounded-full bg-[#0F5132] hover:bg-[#146C43] text-white"
                  >
                    {surveyStarted ? "Pause" : "Start"}
                  </Button>
                }
              />
              <ActionCard
                icon={<FileText className="w-5 h-5" />}
                title="Export CSV"
                body="Download responses & archive. Test data appears with a PINK highlight column."
                action={<Button onClick={exportCsv} className="rounded-full bg-[#0F5132] hover:bg-[#146C43] text-white"><Download className="w-4 h-4 mr-2" /> CSV</Button>}
              />
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function Kpi({ icon, label, value, hint, testid }) {
  return (
    <div data-testid={testid} className="rounded-2xl border border-[#E2E8E5] bg-white p-5">
      <div className="flex items-center justify-between">
        <div className="w-9 h-9 rounded-full bg-[#E8F0EA] text-[#0F5132] grid place-items-center">{icon}</div>
        <div className="text-[10px] uppercase tracking-wider text-[#7A8A82] font-semibold">{hint}</div>
      </div>
      <div className="mt-4">
        <div className="text-xs uppercase tracking-wider text-[#7A8A82] font-semibold">{label}</div>
        <div className="font-display text-3xl font-semibold text-[#1A211D] mt-1">{value}</div>
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, children, testid }) {
  return (
    <div data-testid={testid} className="rounded-2xl border border-[#E2E8E5] bg-white p-5">
      <div className="mb-3">
        <div className="font-display text-lg font-semibold text-[#1A211D]">{title}</div>
        <div className="text-xs text-[#7A8A82] mt-0.5">{subtitle}</div>
      </div>
      {children}
    </div>
  );
}

function ActionCard({ icon, title, body, action }) {
  return (
    <div className="rounded-2xl border border-[#E2E8E5] bg-white p-6 flex items-start gap-4">
      <div className="w-10 h-10 rounded-full bg-[#E8F0EA] text-[#0F5132] grid place-items-center shrink-0">{icon}</div>
      <div className="flex-1">
        <div className="font-display text-lg font-semibold text-[#1A211D]">{title}</div>
        <div className="text-sm text-[#4A5550] mt-1">{body}</div>
        <div className="mt-4">{action}</div>
      </div>
    </div>
  );
}

function BanForm({ onSubmit }) {
  const [v, setV] = useState("");
  return (
    <div className="flex gap-2 mt-2">
      <Input
        data-testid={ADMIN.banEmail}
        placeholder="2022-1-80-014@std.ewubd.edu"
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="mono h-11 rounded-xl border-[#E2E8E5]"
      />
      <Button
        data-testid={ADMIN.banSubmit}
        onClick={() => { onSubmit(v.trim().toLowerCase()); setV(""); }}
        className="rounded-full bg-[#BE185D] hover:bg-[#9D174D] text-white"
        disabled={!v.trim()}
      >
        Ban
      </Button>
    </div>
  );
}

function ChangePasswordDialog({ onDone }) {
  const [oldP, setOldP] = useState("");
  const [newP, setNewP] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true);
    try {
      await api.post("/admin/change-password", { old_password: oldP, new_password: newP });
      toast.success("Password changed");
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Change failed");
    } finally {
      setLoading(false);
    }
  };
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Change admin password</DialogTitle>
        <DialogDescription>Choose a strong password (min 6 characters).</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 mt-2">
        <div>
          <Label className="text-xs uppercase tracking-wider text-[#7A8A82] font-semibold">Current password</Label>
          <Input data-testid={ADMIN.changePwOld} type="password" value={oldP} onChange={(e) => setOldP(e.target.value)} className="mt-2 h-11 rounded-xl" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-[#7A8A82] font-semibold">New password</Label>
          <Input data-testid={ADMIN.changePwNew} type="password" value={newP} onChange={(e) => setNewP(e.target.value)} className="mt-2 h-11 rounded-xl" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button data-testid={ADMIN.changePwSubmit} onClick={submit} disabled={loading} className="rounded-full bg-[#0F5132] hover:bg-[#146C43] text-white">
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Update
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
