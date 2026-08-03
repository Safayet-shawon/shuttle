import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Bus, LogIn, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN } from "@/constants/testIds";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/admin/login", { email, password });
      localStorage.setItem("ewu_admin_token", data.token);
      localStorage.setItem("ewu_admin_email", data.email);
      toast.success("Signed in.");
      navigate("/admin");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9F8F6] grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-[#0F5132] text-white relative overflow-hidden grain">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-white text-[#0F5132] grid place-items-center">
              <Bus className="w-5 h-5" />
            </div>
            <div>
              <div className="font-display text-lg font-semibold">Student Shuttle</div>
              <div className="text-[10px] tracking-[0.18em] uppercase text-[#D1E8DD]">Admin panel</div>
            </div>
          </div>
          <div className="mt-16 max-w-md">
            <h1 className="font-display text-5xl font-semibold leading-tight tracking-tight">
              Turn survey answers into<br /><span className="italic">real shuttle decisions.</span>
            </h1>
            <p className="mt-6 text-[#D1E8DD] leading-relaxed">
              Filter responses by month, see live occupancy against the 36-seat capacity,
              and export weekly numbers to CSV. AI-powered demand insights included.
            </p>
          </div>
        </div>
        <Link to="/" className="text-sm text-[#D1E8DD] hover:text-white flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Back to landing
        </Link>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-[#E2E8E5] bg-white p-8 sm:p-10">
          <div className="eyebrow mb-2">Admin sign-in</div>
          <h2 className="font-display text-3xl font-semibold text-[#1A211D]">Welcome back.</h2>
          <p className="text-[#4A5550] mt-2 text-sm">Sign in to access the demand dashboard.</p>

          <div className="mt-6 space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#7A8A82] font-semibold">Email</Label>
              <Input
                data-testid={ADMIN.loginEmail}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder=""
                className="mt-2 h-12 rounded-xl border-[#E2E8E5] focus:border-[#0F5132] focus:ring-1 focus:ring-[#0F5132] mono"
              />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#7A8A82] font-semibold">Password</Label>
              <Input
                data-testid={ADMIN.loginPassword}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 h-12 rounded-xl border-[#E2E8E5] focus:border-[#0F5132] focus:ring-1 focus:ring-[#0F5132]"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              data-testid={ADMIN.loginSubmit}
              className="w-full h-12 rounded-full bg-[#0F5132] hover:bg-[#146C43] text-white"
            >
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LogIn className="w-4 h-4 mr-2" />}
              Sign in
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
