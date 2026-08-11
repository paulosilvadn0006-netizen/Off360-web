import React from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/Logo";
import { LayoutDashboard, CheckCircle2, Receipt, QrCode, Image, Store, CreditCard, LogOut } from "lucide-react";

const items = [
  { to: "/merchant", icon: LayoutDashboard, label: "Visão geral", end: true, testid: "m-nav-dashboard" },
  { to: "/merchant/validate", icon: CheckCircle2, label: "Validar vendas", testid: "m-nav-validate" },
  { to: "/merchant/transactions", icon: Receipt, label: "Transações", testid: "m-nav-transactions" },
  { to: "/merchant/qr", icon: QrCode, label: "Meu QR Code", testid: "m-nav-qr" },
  { to: "/merchant/stories", icon: Image, label: "Stories", testid: "m-nav-stories" },
  { to: "/merchant/establishment", icon: Store, label: "Estabelecimento", testid: "m-nav-establishment" },
  { to: "/merchant/subscription", icon: CreditCard, label: "Assinatura", testid: "m-nav-subscription" },
];

export default function MerchantLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const onLogout = async () => { await logout(); navigate("/"); };
  return (
    <div className="min-h-screen bg-off-bg lg:flex">
      <aside className="hidden w-64 shrink-0 border-r border-off-blue/30 bg-off-surface/60 lg:flex lg:flex-col">
        <div className="flex items-center gap-2 px-6 py-5"><Logo size={40} showText={false} /><span className="font-display text-lg font-bold text-white">OFF 360</span></div>
        <nav className="flex-1 space-y-1 px-3">
          {items.map((it) => <SideItem key={it.to} {...it} />)}
        </nav>
        <button onClick={onLogout} data-testid="m-logout" className="m-3 flex items-center gap-2 rounded-xl px-3 py-3 text-sm text-gray-400 hover:bg-off-error/10 hover:text-off-error">
          <LogOut className="h-4 w-4" /> Sair
        </button>
      </aside>

      <div className="flex-1">
        <header className="off-glass sticky top-0 z-30 flex items-center justify-between border-b border-off-blue/30 px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2"><Logo size={34} showText={false} /><span className="font-display font-bold text-white">Empresário</span></div>
          <button onClick={onLogout} className="text-gray-400"><LogOut className="h-5 w-5" /></button>
        </header>
        <main className="px-4 py-5 pb-28 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-6xl"><Outlet /></div>
        </main>
      </div>

      <nav className="off-glass fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-off-blue/40 px-1 py-2 safe-bottom lg:hidden no-scrollbar overflow-x-auto">
        {items.slice(0, 5).map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end} data-testid={it.testid + "-m"}
            className={({ isActive }) => `flex min-w-[62px] flex-col items-center gap-1 py-1 text-[10px] font-medium ${isActive ? "text-off-orange" : "text-gray-400"}`}>
            <it.icon className="h-5 w-5" />{it.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function SideItem({ to, icon: Icon, label, end, testid }) {
  return (
    <NavLink to={to} end={end} data-testid={testid}
      className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? "off-gradient text-white" : "text-gray-300 hover:bg-off-blue/20"}`}>
      <Icon className="h-4.5 w-4.5" /> {label}
    </NavLink>
  );
}
