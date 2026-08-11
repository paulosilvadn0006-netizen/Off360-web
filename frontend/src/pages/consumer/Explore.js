import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Loading, EmptyState } from "@/components/shared";
import { EstRow } from "@/pages/consumer/Home";
import { Input } from "@/components/ui/input";
import { Search, SlidersHorizontal, Store } from "lucide-react";

export default function Explore() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState(params.get("category") || "");
  const [sort, setSort] = useState(params.get("sort") || "new");

  const { data: cats } = useQuery({ queryKey: ["cats"], queryFn: async () => (await api.get("/categories")).data });
  const { data, isLoading } = useQuery({
    queryKey: ["catalog", q, category, sort],
    queryFn: async () => (await api.get("/consumer/establishments", { params: { q: q || undefined, category: category || undefined, sort } })).data,
  });

  return (
    <div className="px-4 pt-6 animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-white">Explorar</h1>
      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-off-blue/40 bg-off-surface px-4">
        <Search className="h-4 w-4 text-gray-500" />
        <Input data-testid="explore-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar..." className="h-12 border-0 bg-transparent text-white focus-visible:ring-0" />
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-2 no-scrollbar">
        <Chip active={!category} onClick={() => setCategory("")}>Todos</Chip>
        {(cats || []).map((c) => <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)} testid={`chip-${c.id}`}>{c.name}</Chip>)}
      </div>

      <div className="mb-4 mt-1 flex items-center gap-2 text-xs">
        <SlidersHorizontal className="h-3.5 w-3.5 text-gray-500" />
        {[["new", "Novidades"], ["discount", "Maior desconto"]].map(([v, l]) => (
          <button key={v} data-testid={`sort-${v}`} onClick={() => setSort(v)} className={`rounded-full px-3 py-1 font-semibold ${sort === v ? "off-gradient text-white" : "bg-off-surface text-gray-400"}`}>{l}</button>
        ))}
      </div>

      {isLoading ? <Loading /> : (data && data.length ? (
        <div className="space-y-3 pb-6" data-testid="catalog-list">
          {data.map((e) => <EstRow key={e.id} e={e} onClick={() => navigate(`/establishment/${e.id}`)} />)}
        </div>
      ) : <EmptyState icon={Store} title="Nenhum estabelecimento" subtitle="Ajuste os filtros ou tente outra busca." />)}
    </div>
  );
}

function Chip({ active, onClick, children, testid }) {
  return <button data-testid={testid} onClick={onClick} className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold ${active ? "off-gradient text-white" : "border border-off-blue/40 bg-off-surface text-gray-300"}`}>{children}</button>;
}
