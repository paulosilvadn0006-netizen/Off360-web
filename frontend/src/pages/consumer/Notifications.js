import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Loading, fmtDate, EmptyState } from "@/components/shared";
import { Bell, ChevronLeft, Check } from "lucide-react";

export default function Notifications() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["notifications"], queryFn: async () => (await api.get("/notifications")).data });

  const markAll = async () => { await api.post("/notifications/read-all"); qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["notif-count"] }); };
  const open = async (n) => {
    await api.post(`/notifications/${n.id}/read`).catch(() => {});
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["notif-count"] });
    if (n.link) navigate(n.link);
  };

  if (isLoading) return <div className="px-4 pt-8"><Loading /></div>;

  return (
    <div className="px-4 pt-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate("/home")} className="rounded-full bg-off-surface p-2 text-white"><ChevronLeft className="h-5 w-5" /></button>
          <h1 className="font-display text-xl font-bold text-white">Notificações</h1>
        </div>
        <button onClick={markAll} className="flex items-center gap-1 text-xs font-semibold text-off-orange"><Check className="h-3 w-3" /> Marcar todas</button>
      </div>

      {data?.items?.length ? (
        <div className="mt-5 space-y-2" data-testid="notifications-list">
          {data.items.map((n) => (
            <button key={n.id} onClick={() => open(n)} className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left ${n.read ? "border-off-blue/20 bg-off-surface/50" : "border-off-orange/30 bg-off-surface"}`}>
              <div className={`mt-0.5 rounded-full p-2 ${n.read ? "bg-off-blue/20" : "off-gradient"}`}><Bell className="h-4 w-4 text-white" /></div>
              <div className="flex-1">
                <p className="font-semibold text-white">{n.title}</p>
                <p className="text-sm text-gray-400">{n.message}</p>
                <p className="mt-1 text-xs text-gray-600">{fmtDate(n.created_at)}</p>
              </div>
            </button>
          ))}
        </div>
      ) : <div className="mt-8"><EmptyState icon={Bell} title="Nenhuma notificação" subtitle="Você está em dia!" /></div>}
    </div>
  );
}
