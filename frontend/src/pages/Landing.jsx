import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Bus, Clock, DollarSign, MapPin, Sparkles, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { LANDING } from "@/constants/testIds";

export default function Landing() {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    api.get("/config").then((r) => setConfig(r.data)).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#F9F8F6] text-[#1A211D]">
      {/* Nav */}
      <header className="sticky top-0 z-40 bg-[#F9F8F6]/85 backdrop-blur-xl border-b border-[#E2E8E5]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-9 h-9 rounded-full bg-[#0F5132] text-white grid place-items-center">
              <Bus className="w-5 h-5" />
            </div>
            <div>
              <div className="font-display text-lg font-semibold leading-none">EWU Shuttle</div>
              <div className="text-[10px] tracking-[0.18em] uppercase text-[#7A8A82]">Fall 2026 pilot</div>
            </div>
          </Link>
          <div className="flex items-center gap-4">
            <a href="#learn" className="hidden sm:block text-sm text-[#4A5550] hover:text-[#0F5132]">How it works</a>
            <a href="#schedule" className="hidden sm:block text-sm text-[#4A5550] hover:text-[#0F5132]">Schedule</a>
            <a href="#fares" className="hidden sm:block text-sm text-[#4A5550] hover:text-[#0F5132]">Fares</a>
            <Link to="/admin/login" data-testid={LANDING.adminLink} className="text-sm text-[#0F5132] font-medium hover:underline">Admin</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section data-testid={LANDING.hero} className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-b from-[#E8F0EA] via-[#F9F8F6] to-[#F9F8F6]" />
          <img
            src="https://images.pexels.com/photos/27363161/pexels-photo-27363161.jpeg"
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-15 mix-blend-multiply"
          />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28 grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7">
            <div className="eyebrow mb-4">East West University • Afzalgunj</div>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-semibold leading-[1.05] tracking-tight text-[#1A211D]">
              A shuttle designed <br className="hidden sm:block" />
              <span className="italic text-[#0F5132]">around your class schedule.</span>
            </h1>
            <p className="mt-6 text-lg text-[#4A5550] leading-relaxed max-w-2xl">
              We're piloting a dedicated 36-seat AC bus between Rampura and Chashara — and letting the numbers decide.
              Two minutes of your time shapes the routes, timings and fares of the shuttle you'll ride next semester.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link to="/survey">
                <Button
                  data-testid={LANDING.ctaSurvey}
                  className="h-12 px-6 rounded-full bg-[#0F5132] hover:bg-[#146C43] text-white text-base group"
                >
                  Take the survey
                  <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                </Button>
              </Link>
              <a href="#learn">
                <Button
                  data-testid={LANDING.ctaLearn}
                  variant="outline"
                  className="h-12 px-6 rounded-full border-2 border-[#0F5132] text-[#0F5132] hover:bg-[#E8F0EA] text-base"
                >
                  Learn about the shuttle
                </Button>
              </a>
            </div>
            <div className="mt-6 flex items-center gap-2 text-sm text-[#4A5550]">
              <span className="w-2 h-2 rounded-full bg-[#0F5132] animate-pulse" />
              Exclusive to verified <span className="mono text-[#0F5132]">@std.ewubd.edu</span> student IDs.
            </div>
          </div>
          <div className="lg:col-span-5 relative">
            <div className="relative rounded-3xl overflow-hidden border border-[#D1E8DD] shadow-lg">
              <img
                src="https://images.pexels.com/photos/70912/pexels-photo-70912.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Shuttle bus"
                className="w-full h-[420px] object-cover"
              />
              <div className="absolute top-4 left-4 bg-white/95 backdrop-blur px-4 py-2 rounded-full border border-[#D1E8DD] text-xs font-semibold text-[#0F5132] flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5" /> 36-seat AC pilot
              </div>
              <div className="absolute bottom-4 right-4 bg-[#0F5132] text-white px-4 py-2 rounded-full text-xs font-semibold">
                Rampura ↔ Chashara
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-white border border-[#E2E8E5] p-3">
                <div className="font-display text-2xl text-[#0F5132]">6</div>
                <div className="text-[11px] uppercase tracking-wider text-[#7A8A82] mt-1">counted trips/day</div>
              </div>
              <div className="rounded-xl bg-white border border-[#E2E8E5] p-3">
                <div className="font-display text-2xl text-[#0F5132]">5</div>
                <div className="text-[11px] uppercase tracking-wider text-[#7A8A82] mt-1">weekdays</div>
              </div>
              <div className="rounded-xl bg-white border border-[#E2E8E5] p-3">
                <div className="font-display text-2xl text-[#0F5132]">৳105</div>
                <div className="text-[11px] uppercase tracking-wider text-[#7A8A82] mt-1">from / trip</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Ticker */}
      <div className="overflow-hidden border-y border-[#E2E8E5] bg-white">
        <div className="ticker flex whitespace-nowrap gap-12 py-4 text-[#4A5550] font-display text-lg">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex gap-12 shrink-0">
              <span>Sunday</span><span className="text-[#0F5132]">•</span>
              <span>Monday</span><span className="text-[#0F5132]">•</span>
              <span>Tuesday</span><span className="text-[#0F5132]">•</span>
              <span>Wednesday</span><span className="text-[#0F5132]">•</span>
              <span>Thursday</span><span className="text-[#0F5132]">•</span>
              <span className="italic">Chashara</span><span className="text-[#0F5132]">↔</span>
              <span className="italic">Rampura</span><span className="text-[#0F5132]">•</span>
            </div>
          ))}
        </div>
      </div>

      {/* Learn */}
      <section id="learn" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-3xl">
          <div className="eyebrow mb-3">What we're proposing</div>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-[#1A211D]">
            The proposed service connects major student clusters with campus.
          </h2>
          <p className="mt-4 text-[#4A5550] text-lg leading-relaxed">
            Nothing is fixed yet — the first routes, fares and timings will be
            defined <span className="italic">by this survey's results</span>.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mt-14">
          <FeatureCard
            testid={LANDING.featureRoutes}
            icon={<Bus className="w-6 h-6" />}
            title="Dedicated student routes"
            body="Planned pickup points across the city, running on a fixed weekly timetable built around class hours."
          />
          <FeatureCard
            testid={LANDING.featureTimings}
            icon={<Clock className="w-6 h-6" />}
            title="Predictable timings"
            body="Morning, midday and evening departures so you can plan lectures, labs and club activities without surprises."
          />
          <FeatureCard
            testid={LANDING.featureFares}
            icon={<DollarSign className="w-6 h-6" />}
            title="Student-friendly fares"
            body="Monthly passes and per-trip options — your answers decide which pricing model we pilot first."
          />
        </div>
      </section>

      {/* Schedule */}
      <section id="schedule" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-4">
            <div className="eyebrow mb-3">Route</div>
            <h3 className="font-display text-2xl sm:text-3xl font-semibold">
              Rampura <span className="text-[#0F5132]">↔</span> Chashara
            </h3>
            <p className="mt-3 text-[#4A5550] leading-relaxed">
              Via Staff Quarter, Chittagong Road and Signboard. Three counted up-trips
              and three counted down-trips per weekday; two positioning legs keep the
              bus in place without carrying passengers.
            </p>
            <div className="mt-4 rounded-xl bg-[#E8F0EA] border border-[#D1E8DD] p-4">
              <div className="text-[11px] uppercase tracking-wider text-[#0F5132] font-semibold mb-1 flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5" /> Live alternate routes
              </div>
              <p className="text-sm text-[#4A5550]">
                Interested in Rampura → Uttara (Kuril / Elevated) or Rampura → Mohammadpur via Farmgate?
                Choose it in the survey and we'll contact you as soon as demand allows.
              </p>
            </div>
          </div>
          <div className="lg:col-span-8">
            <div data-testid={LANDING.scheduleTable} className="rounded-2xl border border-[#E2E8E5] bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#F0EFE9]">
                  <tr className="text-left">
                    <th className="px-5 py-4 text-[11px] uppercase tracking-wider text-[#7A8A82] font-semibold">Trip</th>
                    <th className="px-5 py-4 text-[11px] uppercase tracking-wider text-[#7A8A82] font-semibold">Window</th>
                    <th className="px-5 py-4 text-[11px] uppercase tracking-wider text-[#7A8A82] font-semibold">Direction</th>
                    <th className="px-5 py-4 text-[11px] uppercase tracking-wider text-[#7A8A82] font-semibold">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["UP 1", "7:00 AM — 8:20 AM", "Chashara → Rampura", "Attend 8:30 AM class", true],
                    ["—", "8:40 AM — 10:00 AM", "Rampura → Chashara", "Positioning • not counted", false],
                    ["UP 2", "10:20 AM — 11:40 AM", "Chashara → Rampura", "Attend 11:50 AM class", true],
                    ["DOWN 1", "12:10 PM — 1:30 PM", "Rampura → Chashara", "Return home", true],
                    ["UP 3", "1:40 PM — 3:00 PM", "Chashara → Rampura", "Attend 3:10 PM class", true],
                    ["DOWN 2", "3:20 PM — 5:00 PM", "Rampura → Chashara", "Return home", true],
                    ["—", "5:00 PM — 6:20 PM", "Chashara → Rampura", "Positioning • not counted", false],
                    ["DOWN 3", "6:30 PM — 8:00 PM", "Rampura → Chashara", "Return home", true],
                  ].map((r, i) => (
                    <tr
                      key={i}
                      className={`border-t border-[#E2E8E5] ${
                        r[4] ? "hover:bg-[#F9F8F6]" : "bg-[#F0EFE9]/60 text-[#7A8A82] italic"
                      }`}
                    >
                      <td className="px-5 py-4 font-semibold text-[#0F5132] mono text-xs tracking-wide">{r[0]}</td>
                      <td className="px-5 py-4 mono text-xs text-[#1A211D]">{r[1]}</td>
                      <td className="px-5 py-4 text-[#4A5550]">{r[2]}</td>
                      <td className="px-5 py-4 text-[#4A5550]">{r[3]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Fares */}
      <section id="fares" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        <div className="grid lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-4">
            <div className="eyebrow mb-3">Fares</div>
            <h3 className="font-display text-2xl sm:text-3xl font-semibold">
              Two plans, same seat.
            </h3>
            <p className="mt-3 text-[#4A5550] leading-relaxed">
              Pick monthly if you like flexibility, or semester if you want the best rate.
              The survey will auto-calculate your total based on the days & trips you pick.
            </p>
            <div className="mt-6 flex items-center gap-2 text-xs text-[#7A8A82]">
              <Sparkles className="w-3.5 h-3.5 text-[#0F5132]" />
              Prefer a different fare? Tell us in the survey — we log every proposal.
            </div>
          </div>
          <div className="lg:col-span-8">
            <div data-testid={LANDING.fareTable} className="grid sm:grid-cols-2 gap-4">
              {config?.fares && Object.entries(config.fares).map(([id, f]) => (
                <div key={id} className={`rounded-2xl border p-6 ${id === "semester" ? "bg-[#0F5132] text-white border-[#0F5132]" : "bg-white border-[#E2E8E5]"}`}>
                  <div className="flex items-center justify-between">
                    <div className={`text-[11px] uppercase tracking-wider font-semibold ${id === "semester" ? "text-[#D1E8DD]" : "text-[#7A8A82]"}`}>
                      {f.label}
                    </div>
                    {id === "semester" && <Badge className="bg-white text-[#0F5132] hover:bg-white">Best value</Badge>}
                  </div>
                  <div className="mt-4 flex items-baseline gap-2">
                    <div className="font-display text-4xl font-semibold">৳{f.one_way}</div>
                    <div className={`text-sm ${id === "semester" ? "text-[#D1E8DD]" : "text-[#7A8A82]"}`}>/ one-way day</div>
                  </div>
                  <div className="mt-1 text-sm">
                    <span className={`${id === "semester" ? "text-[#D1E8DD]" : "text-[#7A8A82]"}`}>Round-trip day: </span>
                    <span className="font-semibold">৳{f.round_trip}</span>
                  </div>
                  <div className={`mt-4 text-xs ${id === "semester" ? "text-[#D1E8DD]" : "text-[#7A8A82]"}`}>{f.note}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[#E2E8E5] bg-[#F0EFE9]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <h3 className="font-display text-2xl sm:text-3xl font-semibold">Ready to shape the pilot?</h3>
            <p className="mt-2 text-[#4A5550]">Your response takes ~2 minutes. Real data means a better bus for everyone.</p>
          </div>
          <Link to="/survey">
            <Button className="h-12 px-8 rounded-full bg-[#0F5132] hover:bg-[#146C43] text-white text-base">
              Start the survey <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-[#E2E8E5] bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-[#7A8A82]">
          <div>© {new Date().getFullYear()} EWU Shuttle Pilot. Not affiliated commercially.</div>
          <div className="flex items-center gap-4">
            <span>Fall 2026</span>
            <span className="mono">@std.ewubd.edu</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, body, testid }) {
  return (
    <div
      data-testid={testid}
      className="rounded-2xl border border-[#E2E8E5] bg-white p-8 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300"
    >
      <div className="w-12 h-12 rounded-full bg-[#E8F0EA] text-[#0F5132] grid place-items-center">
        {icon}
      </div>
      <h4 className="mt-5 font-display text-xl font-semibold text-[#1A211D]">{title}</h4>
      <p className="mt-2 text-[#4A5550] leading-relaxed text-sm">{body}</p>
    </div>
  );
}
