import React, { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { Home, Compass, ScanLine, Wallet, User } from "lucide-react";
import PassengerCopilot360 from "@/components/taxi/PassengerCopilot360";

const items = [
  { to: "/home", icon: Home, label: "Início", testid: "nav-home" },
  { to: "/explore", icon: Compass, label: "Explorar", testid: "nav-explore" },
  { to: "/economy", icon: Wallet, label: "Economia", testid: "nav-economy" },
  { to: "/profile", icon: User, label: "Perfil", testid: "nav-profile" },
];

export default function ConsumerLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [origin, setOrigin] = useState(null);
  useEffect(() => {
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(
      (p) => setOrigin({ lat: p.coords.latitude, lng: p.coords.longitude, address: "Minha localização" }), () => {}, { timeout: 6000 });
  }, []);
  const applyDraftGlobal = (draft) => { try { sessionStorage.setItem("copilot_ride_draft", JSON.stringify(draft)); } catch (e) { /* noop */ } navigate("/taxi"); };
  return (
    <div className="min-h-screen bg-off-bg">
      <div className="mx-auto max-w-md pb-36">
        <Outlet />
      </div>

      {/* Copiloto 360 global no OFF360 (exceto /taxi, que já tem o seu próprio) */}
      {location.pathname !== "/taxi" && (
        <PassengerCopilot360 origin={origin} ride={null} onApplyDraft={applyDraftGlobal} onConfirmRide={() => navigate("/taxi")} />
      )}

      <nav className="off-glass fixed inset-x-0 bottom-0 z-40 border-t border-off-blue/40 safe-bottom">
        <div className="mx-auto flex max-w-md items-center justify-around px-2 py-2">
          {items.slice(0, 2).map((it) => <NavItem key={it.to} {...it} />)}
          <div className="relative -mt-8 flex w-16 justify-center">
            <button
              data-testid="nav-scan"
              onClick={() => navigate("/scan")}
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-off-bg off-gradient text-white shadow-[0_10px_30px_rgba(255,75,18,0.5)] transition-transform active:scale-95"
              aria-label="Escanear"
            >
              <ScanLine className="h-7 w-7" />
            </button>
          </div>
          {items.slice(2).map((it) => <NavItem key={it.to} {...it} />)}
        </div>
      </nav>
    </div>
  );
}

function NavItem({ to, icon: Icon, label, testid }) {
  return (
    <NavLink to={to} data-testid={testid}
      className={({ isActive }) =>
        `flex w-16 flex-col items-center gap-1 py-1 text-[11px] font-medium transition-colors ${isActive ? "text-off-orange" : "text-gray-400"}`
      }>
      <Icon className="h-5 w-5" />
      {label}
    </NavLink>
  );
}
