import React from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/Logo";
import { LogOut, Bike } from "lucide-react";

export default function DelivererLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const onLogout = async () => { await logout(); navigate("/"); };
  return (
    <div className="min-h-screen bg-off-bg">
      <header className="off-glass sticky top-0 z-30 flex items-center justify-between border-b border-off-blue/30 px-4 py-3">
        <div className="flex items-center gap-2"><Logo size={34} showText={false} /><span className="font-display font-bold text-white flex items-center gap-1"><Bike className="h-4 w-4 text-off-orange" /> Entregador</span></div>
        <button onClick={onLogout} data-testid="deliverer-logout" className="text-gray-400"><LogOut className="h-5 w-5" /></button>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-5 pb-24"><Outlet /></main>
    </div>
  );
}
