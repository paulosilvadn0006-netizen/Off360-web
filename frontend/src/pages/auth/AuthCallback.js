import React, { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { BrandMark } from "@/components/Logo";

export default function AuthCallback() {
  const location = useLocation();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    const m = (location.hash || "").match(/session_id=([^&]+)/);
    const params = new URLSearchParams(location.search);
    const role = params.get("role") || "consumer";
    const taxi = params.get("taxi") === "1";
    if (!m) { navigate("/login", { replace: true }); return; }
    processed.current = true;
    (async () => {
      try {
        const sid = decodeURIComponent(m[1]);
        const { data: u } = await api.post("/auth/google/session", { session_id: sid, role });
        if (u.role === "deliverer") {
          try { if (taxi) localStorage.setItem("off360_taxi_intent", "1"); } catch (_) {}
        }
        await refresh?.();
        toast.success("Bem-vindo(a) à OFF 360!");
        navigate(u.role === "merchant" ? "/merchant" : u.role === "deliverer" ? "/deliverer" : u.role === "admin" ? "/admin" : "/home", { replace: true });
      } catch (e) {
        toast.error("Não foi possível entrar com o Google. Tente novamente.");
        navigate("/login", { replace: true });
      }
    })();
  }, []); // eslint-disable-line

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-off-bg text-gray-400">
      <BrandMark size={64} />
      <p data-testid="auth-callback-status" className="text-sm">Entrando com o Google...</p>
    </div>
  );
}
