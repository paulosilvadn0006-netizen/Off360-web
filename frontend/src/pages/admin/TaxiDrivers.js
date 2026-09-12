import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Car, Bike, CheckCircle2, XCircle, Clock, Trash2, AlertTriangle } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const BADGE = {
  aprovado: { t: "✅ Aprovado", c: "text-off-success" },
  em_analise: { t: "⏳ Em análise", c: "text-off-orange" },
  pendente: { t: "❌ Pendente", c: "text-off-error" },
};

const DOC_STATUS = {
  aprovado: { t: "Aprovado", c: "bg-off-success/15 text-off-success" },
  vencido: { t: "Vencido", c: "bg-off-error/15 text-off-error" },
  irregular: { t: "Irregular", c: "bg-off-error/15 text-off-error" },
  suspeito: { t: "Suspeito (revisão)", c: "bg-off-orange/15 text-off-orange" },
};
const DOC_LIST = [
  ["cnh_frente", "CNH (frente)"],
  ["cnh_verso", "CNH (verso)"],
  ["antecedentes", "Antecedentes"],
  ["veiculo", "Doc. do veículo"],
  ["selfie", "Selfie com CNH"],
];
const imgUrl = (u) => (u ? (u.startsWith("http") ? u : `${process.env.REACT_APP_BACKEND_URL}${u}`) : null);

function DocsSection({ d }) {
  const docs = d.taxi_docs || {};
  const cnh = docs.cnh_frente || docs.cnh || {};
  const cnhVencida = cnh.status === "vencido";
  const semEar = cnh.ear === false || (!d.ear && cnh.ear !== true);
  return (
    <div className="mt-3 rounded-xl border border-off-blue/30 bg-off-bg/30 p-3" data-testid={`docs-${d.id}`}>
      <p className="mb-2 text-xs font-bold text-white">Documentos (Document AI)</p>
      {(cnhVencida || semEar) && (
        <div className="mb-2 flex items-center gap-1 rounded-lg bg-off-error/10 px-2 py-1.5 text-[11px] font-semibold text-off-error" data-testid={`docs-alert-${d.id}`}>
          <AlertTriangle className="h-3.5 w-3.5" /> {cnhVencida ? "CNH vencida" : ""}{cnhVencida && semEar ? " · " : ""}{semEar ? "Sem categoria EAR" : ""}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {DOC_LIST.map(([key, label]) => {
          const a = docs[key];
          const s = a?.status ? (DOC_STATUS[a.status] || {}) : null;
          const isPdf = a?.file_url && a.file_url.toLowerCase().endsWith(".pdf");
          return (
            <div key={key} className="rounded-lg border border-off-blue/30 p-1.5 text-center" data-testid={`doc-cell-${d.id}-${key}`}>
              <p className="mb-1 truncate text-[10px] text-gray-400">{label}</p>
              {a?.file_url ? (
                isPdf
                  ? <a href={imgUrl(a.file_url)} target="_blank" rel="noreferrer" className="block rounded bg-off-surface py-3 text-[10px] text-off-orange">📄 PDF</a>
                  : <a href={imgUrl(a.file_url)} target="_blank" rel="noreferrer"><img src={imgUrl(a.file_url)} alt={label} className="h-14 w-full rounded object-cover" /></a>
              ) : <div className="flex h-14 items-center justify-center rounded bg-off-surface text-[10px] text-gray-500">—</div>}
              {s ? <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold ${s.c}`}>{s.t}</span> : <span className="mt-1 inline-block text-[9px] text-gray-500">não enviado</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TaxiDrivers() {
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["admin-taxi-drivers"],
    queryFn: async () => (await api.get("/taxi/admin/drivers")).data,
    refetchInterval: 10000,
  });
  const rows = data || [];

  const act = async (id, action) => {
    try { await api.post(`/taxi/admin/drivers/${id}/${action}`); toast.success(action === "approve" ? "Motorista aprovado" : "Motorista marcado como pendente"); refetch(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/taxi/admin/drivers/${toDelete.id}`);
      toast.success("Cadastro do motorista excluído. E-mail liberado para novo cadastro.");
      setToDelete(null);
      refetch();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setDeleting(false); }
  };

  return (
    <div data-testid="admin-taxi-drivers">
      <h1 className="mb-6 font-display text-2xl font-bold text-white">Motoristas 360Taxi</h1>
      {isLoading ? <p className="text-gray-400">Carregando...</p> : rows.length === 0 ? (
        <div className="off-card p-10 text-center text-gray-400" data-testid="drivers-empty">Nenhum cadastro de motorista.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((d) => {
            const b = BADGE[d.taxi_status] || BADGE.em_analise;
            return (
              <div key={d.id} className="off-card p-4" data-testid={`taxi-driver-${d.id}`}>
                <div className="flex items-start gap-3">
                  {d.photo_3x4_url ? <img src={d.photo_3x4_url.startsWith("http") ? d.photo_3x4_url : `${process.env.REACT_APP_BACKEND_URL}${d.photo_3x4_url}`} alt="" className="h-20 w-[60px] rounded-lg object-cover" /> : <div className="flex h-20 w-[60px] items-center justify-center rounded-lg bg-off-surface text-gray-500">3x4</div>}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><p className="font-semibold text-white">{d.name}</p><span className={`text-xs font-bold ${b.c}`}>{b.t}</span>{d.is_gold && <span className="text-xs">🏆</span>}</div>
                    <p className="text-xs text-gray-400">{d.vehicle_type === "moto" ? "🏍️" : "🚗"} {d.modelo} · {d.cor} · {d.placa} · {d.ano} · {d.portas}p</p>
                    <p className="text-xs text-gray-400">CNH {d.cnh_number} (val. {d.cnh_validade}) · EAR: {d.ear ? "Sim" : "Não"}</p>
                    <p className="text-xs text-gray-400">{d.rides_count} corridas{d.rating != null ? ` · ⭐ ${d.rating}` : ""}</p>
                  </div>
                </div>
                <DocsSection d={d} />
                <div className="mt-3 flex gap-2">
                  <Button data-testid={`approve-${d.id}`} onClick={() => act(d.id, "approve")} disabled={d.taxi_status === "aprovado"} className="flex-1 rounded-xl off-gradient font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"><CheckCircle2 className="mr-1 h-4 w-4" /> {d.taxi_status === "aprovado" ? "Aprovado" : "Aprovar"}</Button>
                  <Button data-testid={`reject-${d.id}`} onClick={() => act(d.id, "reject")} variant="outline" className="flex-1 rounded-xl border-off-error/50 text-off-error"><XCircle className="mr-1 h-4 w-4" /> Pendente</Button>
                  <Button data-testid={`delete-${d.id}`} onClick={() => setToDelete(d)} variant="outline" className="rounded-xl border-off-error/50 text-off-error hover:bg-off-error/10"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent data-testid="delete-driver-dialog" className="border-off-blue/40 bg-off-surface text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Excluir cadastro do motorista?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              Todos os dados de <span className="font-semibold text-white">{toDelete?.name}</span> serão removidos permanentemente do sistema, liberando o e-mail e CPF para um novo cadastro. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="delete-driver-cancel" className="border-off-blue/40 bg-transparent text-gray-200 hover:bg-off-bg/40">Cancelar</AlertDialogCancel>
            <AlertDialogAction data-testid="delete-driver-confirm" onClick={confirmDelete} disabled={deleting} className="bg-off-error text-white hover:bg-off-error/90">{deleting ? "Excluindo..." : "Excluir"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
