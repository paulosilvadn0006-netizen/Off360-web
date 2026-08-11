import React, { useState, useEffect } from "react";
import { X, MessageCircle } from "lucide-react";
import { api, fileUrl } from "@/lib/api";
import ActionButtons from "@/components/ActionButtons";

export default function StoryViewer({ group, onClose }) {
  const stories = group?.stories || [];
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!stories.length) return;
    const s = stories[idx];
    if (s) api.post(`/consumer/stories/${s.id}/view`).catch(() => {});
    const t = setTimeout(() => {
      if (idx < stories.length - 1) setIdx(idx + 1);
      else onClose();
    }, 5000);
    return () => clearTimeout(t);
  }, [idx, stories, onClose]);

  if (!stories.length) return null;
  const s = stories[idx];
  const catLabel = { offer: "Oferta", job: "Vaga", event: "Evento", service: "Serviço", notice: "Aviso" };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black" data-testid="story-viewer">
      <div className="relative flex h-full w-full max-w-md flex-col">
        <div className="absolute inset-x-0 top-0 z-10 flex gap-1 p-3">
          {stories.map((_, i) => (
            <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
              <div className="h-full bg-white" style={{ width: i < idx ? "100%" : i === idx ? "100%" : "0%", transition: i === idx ? "width 5s linear" : "none" }} />
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 top-6 z-10 flex items-center justify-between px-4 pt-2">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 overflow-hidden rounded-full bg-off-surface">
              {group.establishment.logo_url ? <img alt="" src={fileUrl(group.establishment.logo_url)} className="h-full w-full object-cover" /> : null}
            </div>
            <span className="text-sm font-semibold text-white">{group.establishment.fantasy_name}</span>
          </div>
          <button onClick={onClose} data-testid="story-close"><X className="h-6 w-6 text-white" /></button>
        </div>

        <button className="absolute left-0 top-0 z-[5] h-full w-1/3" onClick={() => idx > 0 && setIdx(idx - 1)} />
        <button className="absolute right-0 top-0 z-[5] h-full w-1/3" onClick={() => (idx < stories.length - 1 ? setIdx(idx + 1) : onClose())} />

        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          {s.media_url ? (
            <img alt="" src={fileUrl(s.media_url)} className="max-h-[60vh] w-full rounded-2xl object-cover" />
          ) : (
            <div className="flex h-64 w-full items-center justify-center rounded-2xl off-gradient p-6">
              <span className="off-gradient" />
            </div>
          )}
          <span className="mt-5 rounded-full bg-off-orange/20 px-3 py-1 text-xs font-semibold text-off-orange">{catLabel[s.category] || s.category}</span>
          <h3 className="mt-3 font-display text-2xl font-bold text-white">{s.title}</h3>
          {s.text && <p className="mt-2 text-sm text-gray-300">{s.text}</p>}
          {group.establishment.action_buttons?.length ? (
            <div className="mt-5 w-full" onClick={(ev) => ev.stopPropagation()}>
              <ActionButtons establishment={group.establishment} storyId={s.id} />
            </div>
          ) : s.whatsapp_link && (
            <a href={s.whatsapp_link} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 rounded-full bg-off-success px-5 py-2.5 text-sm font-semibold text-white">
              <MessageCircle className="h-4 w-4" /> Falar no WhatsApp
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
