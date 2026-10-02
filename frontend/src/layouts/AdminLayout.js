import React, { useState } from "react";
import { Outlet, NavLink, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/Logo";
import { LayoutDashboard, Users, Store, MapPin, CreditCard, DollarSign, Receipt, Tag, Gift, Settings, ScrollText, LogOut, Menu, X, Sparkles, ShieldAlert, Car, Bot, BadgeCheck } from "lucide-react";

const items = [
  { to: "/admin", icon: LayoutDashboard, label: "Visão geral", end: true, testid: "a-nav-overview" },
  { to: "/admin/consumers", icon: Users, label: "Consumidores", testid: "a-nav-consumers" },
  { to: "/admin/merchants", icon: Store, label: "Empresários", testid: "a-nav-merchants" },
  { to: "/admin/establishments", icon: MapPin, label: "Estabelecimentos", testid: "a-nav-establishments" },
  { to: "/admin/activations", icon: BadgeCheck, label: "Ativações", testid: "a-nav-activations" },
  { to: "/admin/boosts", icon: Sparkles, label: "Destaques", testid: "a-nav-boosts" },
  { to: "/admin/taxi-emergencies", icon: ShieldAlert, label: "Emergências 360Taxi", testid: "a-nav-taxi-emergencies" },
  { to: "/admin/taxi-drivers", icon: Car, label: "Motoristas 360Taxi", testid: "a-nav-taxi-drivers" },
  { to: "/admin/copilot-feedbacks", icon: Bot, label: "Feedbacks Copiloto", testid: "a-nav-copilot-feedbacks" },
  { to: "/admin/subscriptions", icon: CreditCard, label: "Assinaturas", testid: "a-nav-subscriptions" },
  { to: "/admin/financial", icon: DollarSign, label: "Financeiro", testid: "a-nav-financial" },
  { to: "/admin/transactions", icon: Receipt, label: "Transações", testid: "a-nav-transactions" },
  { to: "/admin/categories", icon: Tag, label: "Categorias", testid: "a-nav-categories" },
  { to: "/admin/raffles", icon: Gift, label: "Sorteios", testid: "a-nav-raffles" },
  { to: "/admin/settings", icon: Settings, label: "Configurações", testid: "a-nav-settings" },
  { to: "/admin/audit", icon: ScrollText, label: "Auditoria", testid: "a-nav-audit" },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const onLogout = async () => { await logout(); navigate("/"); };

  if (user && user.must_change_password) return <Navigate to="/admin/trocar-senha" replace />;

  const Sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-6 py-5"><Logo size={38} showText={false} /><span className="font-display text-lg font-bold text-white">Admin</span></div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 no-scrollbar">
        {items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end} data-testid={it.testid} onClick={() => setOpen(false)}
            className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? "off-gradient text-white" : "text-gray-300 hover:bg-off-blue/20"}`}>
            <it.icon className="h-4.5 w-4.5" /> {it.label}
          </NavLink>
        ))}
      </nav>
      <button onClick={onLogout} data-testid="a-logout" className="m-3 flex items-center gap-2 rounded-xl px-3 py-3 text-sm text-gray-400 hover:bg-off-error/10 hover:text-off-error">
        <LogOut className="h-4 w-4" /> Sair
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-off-bg lg:flex">
      <aside className="hidden w-64 shrink-0 border-r border-off-blue/30 bg-off-surface/60 lg:block">{Sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 bg-off-surface">{Sidebar}</div>
        </div>
      )}

      <div className="flex-1">
        <header className="off-glass sticky top-0 z-30 flex items-center justify-between border-b border-off-blue/30 px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} data-testid="a-menu-btn" className="text-white"><Menu className="h-6 w-6" /></button>
          <div className="flex items-center gap-2"><Logo size={32} showText={false} /><span className="font-display font-bold text-white">Admin</span></div>
          <div className="w-6" />
        </header>
        <main className="px-4 py-5 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-7xl"><Outlet /></div>
        </main>
      </div>
    </div>
  );
}
