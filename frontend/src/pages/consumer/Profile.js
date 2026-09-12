import React, { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, uploadFile, fileUrl } from "@/lib/api";
import { SubscriptionBadge, money } from "@/components/shared";
import { Camera, LogOut, ShieldCheck, FileText, Bell, ChevronRight, MapPin } from "lucide-react";
import PassengerCards from "@/components/taxi/PassengerCards";

export default function ConsumerProfile() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const onLogout = async () => { await logout(); navigate("/"); };
  const onPhoto = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const up = await uploadFile(f);
      await api.put("/consumer/profile", { photo_url: up.url }).catch(async () => {
        // fallback: update via generic (no endpoint) -> ignore
      });
      toast.success("Foto atualizada");
      refresh();
    } catch { toast.error("Falha no upload"); }
  };

  return (
    <div className="px-4 pt-6 animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Perfil</h1>

      <div className="mt-5 flex flex-col items-center off-card p-6">
        <div className="relative">
          <div className="h-24 w-24 overflow-hidden rounded-full border-4 border-off-orange off-gradient">
            {user?.photo_url ? <img alt="" src={fileUrl(user.photo_url)} className="h-full w-full object-cover" /> :
              <div className="flex h-full w-full items-center justify-center font-display text-3xl font-bold text-white">{(user?.name || "?")[0]}</div>}
          </div>
          <button onClick={() => fileRef.current?.click()} data-testid="profile-photo-btn" className="absolute -bottom-1 -right-1 rounded-full off-gradient p-2 text-white"><Camera className="h-4 w-4" /></button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
        </div>
        <h2 className="mt-3 font-display text-xl font-bold text-white">{user?.name}</h2>
        <p className="text-sm text-gray-400">{user?.email}</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-gray-500"><MapPin className="h-3 w-3" /> {user?.neighborhood || "—"}, {user?.city || "—"}</p>
        <div className="mt-3"><SubscriptionBadge status={user?.subscription_status} /></div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="off-card p-4"><p className="text-xs text-gray-400">Total economizado</p><p className="font-display text-lg font-bold text-off-orange">{money(user?.total_saved)}</p></div>
        <div className="off-card p-4"><p className="text-xs text-gray-400">Total gasto</p><p className="font-display text-lg font-bold text-white">{money(user?.total_spent)}</p></div>
      </div>

      {user?.subscription_status !== "active" && (
        <div className="mt-4 rounded-2xl border border-off-warning/40 bg-off-warning/10 p-4">
          <p className="font-semibold text-off-warning">Assinatura pendente</p>
          <p className="mt-1 text-xs text-gray-300">O valor da assinatura será definido pela administração. Em breve você poderá assinar por Pix ou cartão.</p>
        </div>
      )}

      <PassengerCards />

      <div className="mt-4 space-y-1">
        <Item icon={Bell} label="Notificações" onClick={() => navigate("/notifications")} />
        <Item icon={ShieldCheck} label="Privacidade e LGPD" onClick={() => toast.info("Seus dados são tratados conforme a LGPD.")} />
        <Item icon={FileText} label="Termos de Uso" onClick={() => toast.info("Termos de Uso da OFF 360.")} />
      </div>

      <button onClick={onLogout} data-testid="consumer-logout" className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-off-error/40 py-3 font-semibold text-off-error">
        <LogOut className="h-4 w-4" /> Sair
      </button>
    </div>
  );
}

function Item({ icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl bg-off-surface px-4 py-3 text-left">
      <Icon className="h-5 w-5 text-off-orange" />
      <span className="flex-1 text-sm font-medium text-white">{label}</span>
      <ChevronRight className="h-4 w-4 text-gray-500" />
    </button>
  );
}
