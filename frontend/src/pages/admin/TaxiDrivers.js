import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Car, Bike, CheckCircle2, XCircle, Clock, Trash2, AlertTriangle, ShieldCheck, FileText } from "lucide-react";
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

const INS_STATUS = {
  aguardando: { t: "Aguardando análise", c: "bg-off-orange/15 text-off-orange" },
  aprovada: { t: "Aprovada", c: "bg-off-success/15 text-off-success" },
  correcao: { t: "Necessita correção", c: "bg-off-orange/15 text-off-orange" },
  reprovada: { t: "Reprovada", c: "bg-off-error/15 text-off-error" },
  vencida: { t: "Vencida", c: "bg-off-error/15 text-off-error" },
};

function InsuranceSection({ d, onReview }) {
  const ins = d.insurance || {};
  const s = ins.status ? (INS_STATUS[ins.status] || {}) : null;
  const isPdf = ins.policy_url && ins.policy_url.toLowerCase().endsWith(".pdf");
  return (
    <div className="mt-3 rounded-xl border border-off-orange/40 bg-off-orange/5 p-3" data-testid={`insurance-${d.id}`}>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-white"><ShieldCheck className="h-4 w-4 text-off-orange" /> Seguro APP MBM</p>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-300">
        <span>Aceite: {ins.accepted ? <span className="font-semibold text-off-success">Sim</span> : <span className="font-semibold text-off-error">Não</span>}{ins.accepted_at ? ` (${new Date(ins.accepted_at).toLocaleDateString("pt-BR")})` : ""}</span>
        {ins.policy_url ? (
          isPdf
            ? <a href={imgUrl(ins.policy_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded bg-off-surface px-2 py-1 text-off-orange" data-testid={`insurance-file-${d.id}`}><FileText className="h-3.5 w-3.5" /> Abrir apólice (PDF)</a>
            : <a href={imgUrl(ins.policy_url)} target="_blank" rel="noreferrer" data-testid={`insurance-file-${d.id}`}><img src={imgUrl(ins.policy_url)} alt="apólice" className="h-14 w-14 rounded object-cover" /></a>
        ) : <span className="text-gray-500">Apólice não enviada</span>}
        {s && <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${s.c}`} data-testid={`insurance-status-${d.id}`}>{s.t}</span>}
      </div>
      {ins.reviewed_at && <p className="mt-1 text-[10px] text-gray-500">Analisado em {new Date(ins.reviewed_at).toLocaleString("pt-BR")}{ins.reviewed_by ? ` por ${ins.reviewed_by}` : ""}{ins.review_note ? ` — ${ins.review_note}` : ""}</p>}
      {ins.status === "aprovada" && ins.policy_expires_at && <p className="mt-1 text-[10px] text-gray-400" data-testid={`insurance-expiry-${d.id}`}>Válida até {new Date(ins.policy_expires_at).toLocaleDateString("pt-BR")} (renovação anual)</p>}
      {ins.policy_url && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button data-testid={`insurance-approve-${d.id}`} size="sm" onClick={() => onReview(d.id, "approve")} disabled={ins.status === "aprovada"} className="rounded-lg off-gradient text-xs font-semibold text-white disabled:opacity-40"><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Aprovar apólice</Button>
          <Button data-testid={`insurance-correction-${d.id}`} size="sm" variant="outline" onClick={() => onReview(d.id, "correction")} className="rounded-lg border-off-orange/50 text-xs text-off-orange"><AlertTriangle className="mr-1 h-3.5 w-3.5" /> Solicitar correção</Button>
          <Button data-testid={`insurance-reject-${d.id}`} size="sm" variant="outline" onClick={() => onReview(d.id, "reject")} className="rounded-lg border-off-error/50 text-xs text-off-error"><XCircle className="mr-1 h-3.5 w-3.5" /> Reprovar</Button>
        </div>
      )}
    </div>
  );
}

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
  const [filter, setFilter] = useState("todos");
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["admin-taxi-drivers"],
    queryFn: async () => (await api.get("/taxi/admin/drivers")).data,
    refetchInterval: 10000,
  });
  const allRows = data || [];
  const isPending = (d) => (d.insurance || {}).policy_url && (d.insurance || {}).status === "aguardando";
  const pendingCount = allRows.filter(isPending).length;
  const rows = filter === "apolice_pendente" ? allRows.filter(isPending) : allRows;

  const act = async (id, action) => {
    try { await api.post(`/taxi/admin/drivers/${id}/${action}`); toast.success(action === "approve" ? "Motorista aprovado" : "Motorista marcado como pendente"); refetch(); }
    catch (err) { toast.error(formatApiError(err)); }
  };

  const reviewInsurance = async (id, action) => {
    let note = "";
    let expires_at = "";
    if (action === "approve") {
      const today = new Date(); today.setFullYear(today.getFullYear() + 1);
      const def = today.toISOString().slice(0, 10);
      expires_at = window.prompt(`Validade da apólice (AAAA-MM-DD). A apólice é anual — deixe como está para +1 ano:`, def) || "";
    } else {
      note = window.prompt(action === "correction" ? "Observação para correção da apólice (opcional):" : "Motivo da reprovação da apólice (opcional):") || "";
    }
    try {
      await api.post(`/taxi/admin/drivers/${id}/insurance/${action}`, { note, expires_at });
      toast.success(action === "approve" ? "Apólice aprovada" : action === "correction" ? "Correção solicitada" : "Apólice reprovada");
      refetch();
    } catch (err) { toast.error(formatApiError(err)); }
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
      <h1 className="mb-4 font-display text-2xl font-bold text-white">Motoristas 360Taxi</h1>
      <div className="mb-5 flex flex-wrap gap-2">
        <button data-testid="filter-todos" onClick={() => setFilter("todos")} className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${filter === "todos" ? "off-gradient text-white" : "border border-off-blue/40 text-gray-300 hover:border-off-blue"}`}>Todos ({allRows.length})</button>
        <button data-testid="filter-apolice-pendente" onClick={() => setFilter("apolice_pendente")} className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition ${filter === "apolice_pendente" ? "off-gradient text-white" : "border border-off-orange/50 text-off-orange hover:border-off-orange"}`}>
          <ShieldCheck className="h-4 w-4" /> Apólice pendente
          {pendingCount > 0 && <span className="ml-1 rounded-full bg-off-error px-1.5 text-[10px] font-bold text-white" data-testid="pending-count">{pendingCount}</span>}
        </button>
      </div>
      {isLoading ? <p className="text-gray-400">Carregando...</p> : rows.length === 0 ? (
        <div className="off-card p-10 text-center text-gray-400" data-testid="drivers-empty">{filter === "apolice_pendente" ? "Nenhuma apólice aguardando análise." : "Nenhum cadastro de motorista."}</div>
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
                <InsuranceSection d={d} onReview={reviewInsurance} />
                {d.taxi_status === "aprovado" && (d.insurance || {}).status === "aprovada" && (
                  <p className="mt-2 flex items-center gap-1 text-[11px] font-bold text-off-success" data-testid={`fully-complete-${d.id}`}><CheckCircle2 className="h-3.5 w-3.5" /> Cadastro 100% concluído</p>
                )}
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
