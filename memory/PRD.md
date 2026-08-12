# OFF 360 — PRD

## Problem Statement
Plataforma web responsiva e instalável (PWA) de economia e fortalecimento do comércio local. Conecta consumidores (por assinatura) a lojas/serviços próximos, com descontos, stories, validação de compra por QR Code, economia acumulada e bilhetes para sorteios. Perfis totalmente isolados: Consumidor, Empresário, Administrador e Proprietário (super_admin).

## Architecture
- Backend: FastAPI modular (core.py, storage.py, seed.py, routes_auth/common/consumer/merchant/admin.py), MongoDB (uuid string ids). Rotas `/api`-prefixadas. JWT (bcrypt + PyJWT HS256) em httpOnly cookies + Bearer fallback, brute-force lockout, require_role. super_admin satisfaz qualquer rota admin.
- Frontend: React + Tailwind + shadcn, react-query, react-router. Mobile-first PWA. Navy #020817 / orange #FF7A00.
- Object Storage: Emergent Object Storage (uploads reais de logos/fotos).

## Perfis
- Consumidor: encontra parceiros, escaneia QR (só câmera), recebe tela dinâmica de benefício, economiza, acumula bilhetes.
- Empresário: 1 login → até 10 estabelecimentos (dados/QR/desconto/assinatura/transações separados); valida vendas digitando o valor e confirmando; stories; QR.
- Administrador / Proprietário (super_admin): visão geral sem duplicidade, ativação manual, assinaturas, financeiro, categorias, auditoria.

## Fluxo de compra (novo — implementado 2026-06)
1. Consumidor escaneia o QR do estabelecimento (câmera real, sem digitação manual).
2. Backend valida (QR válido, consumidor ativo, estabelecimento aprovado + assinatura ativa + desconto configurado) e cria uma SESSÃO `pending_validation` (código temporário + token 10min).
3. Consumidor vê tela dinâmica "BENEFÍCIO LIBERADO" (nome, foto, %, condições, código, contagem regressiva, animação) — mostrada ao balconista. NÃO é "pagamento confirmado".
4. Empresário abre "Validar vendas", digita o valor bruto (aplica compra mínima e teto), e clica "Confirmar transação" após receber o pagamento externo.
5. Consumidor vê "TRANSAÇÃO CONFIRMADA" com valores, economia e código; registrado no histórico dos dois lados.

## Desconto (sem 10% padrão)
Configurado por estabelecimento: percentual (1–100), compra mínima, teto em R$, dias/horários válidos, datas, participantes/excluídos, acumula (sim/não), observações. Snapshot é gravado na transação (compras antigas não são recalculadas). QR só libera transações com desconto configurado + assinatura ativa.

## Preços
Não definidos por padrão (exibem "A definir" / "valor ainda não definido"). Admin poderá configurar futuramente. Nunca exibir valores inventados.

## Contas (2026-06)
- Proprietário: proprietario@off360.com (super_admin) — senha temporária + troca obrigatória no 1º acesso, idempotente (nunca sobrescrita).
- Admin legado: paulo.silva.dn.0006@gmail.com (admin).
- admin@off360.com: DESATIVADA (suspended), registro mantido para auditoria.
- Credenciais em /app/memory/test_credentials.md.

## Implementado
- Auth JWT 4 papéis + isolamento (403 cross-role). super_admin.
- Consumidor: Home, Explorar, detalhe do estabelecimento, Scanner (câmera + lanterna), tela dinâmica de benefício, Transação confirmada, Minha Economia (dados reais), Sorteios, Notificações, Perfil.
- Empresário: seletor de estabelecimento persistente (sessionStorage) + visão consolidada em CARDS (GERENCIAR / VER QR CODE), Dashboard por unidade, Validar vendas (empresário informa valor), Transações, QR Code (preto/branco 320px, baixar/imprimir/testar, CONFIGURAR DESCONTO), Stories, Estabelecimento (form completo + desconto estruturado + prévia), Assinaturas por unidade, formulário completo de novo estabelecimento (até 10).
- Admin: Overview sem duplicidade, Consumidores/Empresários/Estabelecimentos/Assinaturas/Transações (tabelas + filtros), ativação manual (botões de texto), Categorias, Sorteios, Configurações, Auditoria.

## Limpeza (2026-06)
Removidos todos os dados fictícios (consumidores, empresários incl. Tamires Mariani, estabelecimentos, assinaturas, transações, stories, bilhetes, notificações). Preservados: contas admin/super_admin, categorias, settings, código, identidade visual e auditoria. Indicadores reais zerados.

## Correção integrada (2026-06 — falhas de teste manual)
- Registro de empresário NÃO auto-cria estabelecimento. Fluxo: registra → "Complete o cadastro do primeiro estabelecimento" (form completo) → salva → conta como 1/10.
- Consumidor pendente NÃO abre câmera (botão vira "Regularizar"; /scan bloqueia sem pedir câmera; backend 403). Câmera só para consumidor ativo. Scanner só-câmera + lanterna.
- Estabelecimento: form completo (logo 1:1 / fachada 16:9 com validação tipo/tamanho/dimensão + prévia); edição via GERENCIAR nos cards.
- Desconto: Percentual em campo próprio (sufixo % + ajuda) + seção "CONDIÇÕES PARA UTILIZAR O DESCONTO" (mínimo, teto, dias, horários, datas, participantes/excluídos, acumula, observações) + prévia. Categoria obrigatória.
- QR: preto/branco 320px, baixar/imprimir/testar/tela cheia; gating por cadastro completo + assinatura ativa; CONFIGURAR DESCONTO / CONTINUAR CADASTRO.
- Admin: /admin/merchants status + ATIVAR CONTA EMPRESARIAL/SUSPENDER/REATIVAR; endpoints merchants/consumers activate/suspend.
- Proprietário paulo@off360.com (super_admin) — senha definida pelo dono no 1º acesso; preservada.
- Limpeza final: base zerada; categorias e auditoria preservadas. Testes: backend 6/6 + UI 100% (iteration_6.json) na URL pública.

## Modos de validação + estabilidade (2026-06 — implementado e testado)
- Dois modos por estabelecimento (campo `validation_mode`: "fast" | "controlled"), selecionável na tela GERENCIAR (Select "Modo rápido" / "Modo controlado"), persistido via PUT /merchant/establishment/{id}.
- Modo rápido: consumidor escaneia → informa o valor (tela fast-amount-screen) → POST /consumer/transactions/{id}/fast-confirm calcula desconto (respeita mínimo/teto), confirma automaticamente (origin="fast_mode") e mostra "BENEFÍCIO LIBERADO" com valor a pagar; idempotente (2ª chamada não duplica tx/bilhetes/economia).
- Modo controlado: fluxo original mantido — empresário digita valor e confirma (POST /merchant/transactions/{id}/confirm); 2ª confirmação retorna 400.
- Estabilidade "Network Error": handler global de 500 (server.py); polling da /transaction 3s com cap de 45 ciclos (~2,5min) + pausa em document.hidden + para ao sair de pending_validation; mensagem amigável de erro de rede em api.js.
- Idempotência do scan: re-escanear com sessão pending_validation não expirada reutiliza o mesmo transaction_id.
- Testes: backend 8/8 + UI 3/3 na URL pública (iteration_8.json). Dados QA_AUTOMATED_ criados e removidos ao final; contas reais preservadas.

## Botões de atendimento + Solicitações internas (2026-06 — Fase A, implementado e testado)
- Estabelecimento: campo `action_buttons` (até 3, ativar/desativar/ordenar), com config por botão (nome, tipo, destino [internal|whatsapp|external], mensagem automática WhatsApp, dias/horários, prazo resposta, observações, desconto válido?, pagamento antecipado?, taxa entrega, bairros, prazo). Validação no backend (validate_buttons, máx 3, URL https p/ externo ativo). Editor em Gerenciar estabelecimento (`ActionButtonsEditor`) com prévia.
- Consumidor vê os botões (só ativos+completos, com disponibilidade/horário) na página do estabelecimento e dentro do Story (`ActionButtons`). Fora do horário → aviso amigável.
- Solicitações (`db.requests`): consumidor cria via Formulário interno (POST /consumer/requests), WhatsApp (registra ANTES + wa.me montado no backend) ou Link externo (aviso + track-click). Tipos: agendamento/reserva/orçamento/entrega/retirada/encomenda/contato. Código único SOL-XXXX, snapshot de desconto garantido, status_history.
- Empresário (aba SOLICITAÇÕES): filtra/pesquisa, aceita/recusa, atualiza status (accepted→…→out_for_delivery), responde, e CONFIRMA atendimento — ação final que usa o desconto à distância UMA vez (find_one_and_update atômico), cria transação (origin=remote_request), atualiza economia/bilhetes/dashboards, impede reuso. Recalculado no backend.
- Notificações internas em cada transição; auditoria em criar/aceitar/recusar/status/confirmar/cancelar. Ownership validado no backend (403/404).
- Testes: backend 9/9 + UI E2E (iteration_9.json). Bug corrigido: rota /my-requests. Dados QA_AUTOMATED_ removidos; contas reais preservadas.

## Correções Fase A + Destaque OFF 360 (2026-06 — Fase B, implementado e testado)
- Fix layout /establishment (mobile/tablet): fachada em bloco separado (h-40 sm:h-52), sem margens negativas/sobreposição; logo+nome+categoria abaixo; botão voltar sempre visível (est-back). Contraste elevado (gray-100/200/300).
- Fix datas BR: helper `fmtDesired` → "13/08/2026 às 12:05" em Minhas solicitações e painel do empresário.
- Fix texto de desconto: "Desconto previsto: X%" (+ aviso de aplicação após confirmação) enquanto em andamento; "Desconto aplicado: X%" após conclusão; "Desconto não utilizado" se recusado/cancelado/expirado.
- Fix WhatsApp: mensagem automática por tipo (contato/orçamento/agendamento/reserva/entrega/retirada/encomenda), montada no backend (`_build_whatsapp_url`), editável no wa.me; registra a solicitação antes de abrir.
- Destaque OFF 360 (`db.boosts`, período GRATUITO — sem cobrança; estrutura pronta p/ precificação futura oculta ao empresário): empresário solicita destaque de um Story ativo (/merchant/boosts); admin aprova/recusa/ativa(define prioridade+período)/pausa/reativa/encerra (/admin/boosts, rótulo "PERÍODO GRATUITO — SEM COBRANÇA"). Ordenação no Home: patrocinados ativos primeiro (prioridade desc, ativação asc), comuns depois; comuns nunca somem. Selo "PATROCINADO" + borda animada (respeita reduce-motion). Métricas (views com dedup 10s, unique, story_clicks, whatsapp_clicks, button_clicks, requests_from_story). Expiração encerra automaticamente sem apagar o Story. Isolamento e auditoria validados.
- Testes: backend 24/24 + UI 100% (iteration_10.json). Dados QA_AUTOMATED_ removidos; contas reais preservadas.

## Correção fluxo Solicitações à distância (2026-06 — implementado e testado)
- 404 em "Confirmar atendimento": causa raiz = id obsoleto no frontend + formatApiError expondo mensagem técnica. Fix: `doConfirm` re-busca GET /merchant/requests/{id} (novo endpoint owner-only) antes de confirmar; backend confirm idempotente (find_one_and_update). Nunca cria 2ª transação; economia/bilhetes contados 1×.
- Erros amigáveis: `formatApiError(err, fallback)` nunca exibe "Request failed...", "Network Error" ou detalhes do Axios (log só no console); mensagens pt-BR por status. Valor digitado preservado em falha.
- Respostas: `db.requests.responses[]` (histórico); notificação com prévia "<estab> respondeu: <texto>" e link `/my-requests?req=<id>`. MyRequests destaca o cartão correto (ring 4s) e mostra histórico (mais recente no topo).
- WhatsApp: card do empresário tem "FALAR PELO WHATSAPP" (telefone do consumidor, mensagem pronta editável, POST /wa-click só registra, NÃO muda status). Botão público (contato) referencia o estabelecimento.
- Datas: `fmtDate` em America/Sao_Paulo, formato "DD/MM/AAAA às HH:mm" — mesmo horário para consumidor e empresário (backend salva UTC).
- Testes: backend 8/8 + code review + smoke (iteration_11.json). Dados QA_AUTOMATED_ removidos; contas reais preservadas.

## Story patrocinado — tempo + design 9:16 (2026-06 — implementado e testado)
- StoryViewer reescrito: imagem estática dura 12s (IMG_DURATION) com barra de progresso; vídeo até 30s (VIDEO_CAP, avança no fim). Pausa ao segurar o dedo (holding), quando a aba fica oculta (visibilitychange) e ao abrir formulário/link de botão (ActionButtons.onInteract). Toque curto: direita avança, esquerda volta; X fecha; fecha só após o último Story.
- Design vertical 9:16: mídia object-contain (sem distorção) + fundo desfocado da própria imagem (cobre horizontais/quadradas); cabeçalho com logo, nome, categoria·bairro e selo PATROCINADO; borda laranja animada + brilho (respeita reduce-motion); título/descrição reais; bloco de desconto (%, mínimo, máximo, condições) quando houver; validade; botões (principal do empresário + "Ver estabelecimento" + WhatsApp) na área segura inferior.
- Home enriquece o establishment do grupo (category_name, neighborhood, discount_min/max, rules). Métricas: view só após ≥2s (dedup 10s no backend); novo POST /api/consumer/stories/{sid}/click (story|establishment) → story_clicks/establishment_clicks.
- Testes: backend 6/6 + UI E2E (iteration_12.json) — 12s confirmado (não 3s), pausa/retoma, navegação, design, sem ReferenceError. Dados QA_AUTOMATED_ removidos; contas reais preservadas.

## Fase 1 — Nova experiência do consumidor (2026-06 — implementado e testado)
- Favoritos ❤️: POST/GET /api/consumer/favorites; coração no card (EstRow, `fav-<id>`, stopPropagation).
- Sinais de interesse: coleção `interest_events` + `log_interest()` (story_view, visit_establishment, favorite, use_discount, filter_*) — base para o feed "Para Você" (Fase 2).
- Carteira de Economia: tela Economia evoluída (`economy-wallet`) — total, mês, `benefits_used`, histórico com valor original/%/economizado; sem duplicar área.
- Filtros de descoberta na Home (`home-filters`): 🔥 Bombando, 📍 Perto de você, ⚡ Hoje, 💰 Ofertas, 🆕 Novidades, 💼 Vagas → GET /api/consumer/discover sobre conteúdo existente; ao ativar filtro, seções padrão são ocultadas (`discover-results`).
- "Perto de você": geolocalização real (lat/lng + haversine, distance_km) com autorização; fallback bairro/cidade se negada. Estabelecimentos ganham lat/lng (create/update; antigos sem coords funcionam e vão por último).
- Prioridade patrocinado x orgânico: patrocinados mantêm a prioridade comercial (Stories); a personalização/filtros organizam os orgânicos.
- Testes: backend 12/12 + UI E2E (iteration_13.json). Bug corrigido: import `Heart` no Home.js; duplicata lat/lng no EstUpdate removida; contraste dos chips da carteira melhorado. Dados QA_AUTOMATED_ removidos; contas reais preservadas. Fase 2 (Para Você/Acontecendo Agora/Notificações inteligentes) NÃO implementada.

## Fase 1 — Ajustes: ranking coletivo + curtidas totais + avaliações (2026-06 — testado)
- BOMBANDO = ranking coletivo: discover?filter=bombando ordena por engajamento de TODOS (fav_count×3 + views + soma de weights em interest_events), lista completa (até 60, rolagem), sem numeração; coração continua individual.
- Curtidas coletivas: `establishments.fav_count` (mantido no toggle, backfill dos favoritos existentes). Exposto em `_est_public`; retornado no toggle.
- Avaliações ⭐ 1–5 (coleção `ratings`, upsert por user+estabelecimento): POST /consumer/establishments/{id}/rate; média real (`rating_sum/rating_count`) e contagem; alterar nota não duplica; nota inválida → 400; `my_rating` no detalhe.
- Prova social nos cards (EstRow: ❤️ fav_count ⭐ média(contagem)/"Sem avaliações") e no perfil (est-social-proof + est-fav-btn + est-rating-widget), sincronizados via invalidateQueries.
- "Perto de você" mostra distância amigável (fmtDistance m/km; "Aqui" p/ <20m) via Haversine; sem geo, ordena por bairro sem distância.
- Testes: backend 7/7 + UI E2E 100% (iteration_14.json). Fix cosmético: distância duplicada no Home removida. Dados QA_AUTOMATED_ removidos; contas reais preservadas. Fase 2 NÃO iniciada.

## Fase 2 — Feed "Para Você" + "Acontecendo Agora" + Notificações inteligentes (2026-06 — testado)
- Feed "Para Você": home agrega `interest_events` do usuário (por estabelecimento/categoria) e ordena os orgânicos (`featured`) por relevância; retorna `for_you`; título "Para você" (senão "Ofertas próximas"). Patrocinados mantêm prioridade comercial e o selo "PATROCINADO".
- "Acontecendo Agora": boost ganhou `happening_title/date/start/end`; `happening_status()` → 'now'/'soon' (≤90min antes)/None, trata evento que cruza a meia-noite; exposto por story group no home; selos ⚡ ACONTECENDO AGORA / ⏰ COMEÇA EM BREVE (StoryViewer + bolinha da Home). Prioriza 'now' > 'soon'. Expira automaticamente.
- Notificações inteligentes: `notify_favorites()` avisa quem favoritou quando o estabelecimento publica Story offer/event; anti-spam (dedup 6h por tipo+estabelecimento via `create_notification(establishment_id=...)`); preferência `POST /consumer/notify-preference` (`users.notify_favorites`).
- Endpoints: `POST /consumer/notify-preference` (novo); `GET /consumer/home` (for_you + stories[].happening); `POST /merchant/boosts` (campos happening). Coleção `interest_events` reutilizada. core.create_notification aceita establishment_id.
- Testes: backend 12/12 + UI E2E 100% (iteration_15.json). Dados QA_AUTOMATED_ removidos; contas reais preservadas. Sem gamificação (Surpresa/Conquistas fora de escopo).

## Fase 1 e 2 — Ajustes finais: moderação + happening + layout (2026-06 — testado, iteration_16)
- Pré-moderação automática de TEXTO em Destaques (`moderation.py::moderate_content`): estados approved/review/rejected. Termo proibido → boost já nasce `status='rejected'` + `reject_reason` + notifica empresário (não vai ao admin). Termo incerto (saúde/dinheiro/política/promessas) → `status='awaiting'` + `moderation.decision='review'` (flag ao admin). Limpo → awaiting + approved. Aprovação manual do admin preservada. Moderação de IMAGEM/vídeo NÃO integrada (exigiria serviço externo) — `image_checked=False` como ponto de extensão.
- `reject_boost` aceita `RejectInput.reason` opcional; motivo persistido em `reject_reason` e exibido ao empresário (`boost-reject-reason-{id}`) e admin.
- `/consumer/home` passou a enviar `happening_info` {title,date,start,end,region} do boost ativo (prioriza 'now' > 'soon'); StoryViewer exibe banner `story-happening-banner` com o texto configurado (ex: "APROVEITE A PROMOÇÃO") + selo ⚡ ACONTECENDO AGORA / ⏰ COMEÇA EM BREVE.
- StoryViewer: conteúdo elevado (pb maior, header top-3) aproveitando melhor a tela 9:16; funcionalidades preservadas.
- Círculo do story patrocinado com `animate-story-pulse` (keyframe box-shadow, respeita reduce-motion); orgânicos sem animação.
- Badge "Aprovado" em VERDE sólido (bg-off-success) no empresário e admin; "Ativo" verde com borda diferenciada.
- Testes: backend 8/8 (1 skip esperado) + UI E2E 100% (iteration_16.json). Dados QA_AUTOMATED_ removidos; contas reais preservadas.

## Stories/Destaque + Meu QR Code — ajustes finais (2026-06 — testado, iteration_17)
- StoryViewer: mídia alinhada ao topo (`object-top`) reduzindo o vão superior; conteúdo inferior elevado; proporção 9:16 preservada.
- Removida a pulsação do CONTÊINER do story patrocinado (a mídia não pisca mais). Identidade visual do patrocinado mantida com anel laranja estático.
- Aviso "⚡ ACONTECENDO AGORA / ⏰ COMEÇA EM BREVE" movido para o TOPO (acima da mídia, `absolute top-[64px]`), agora com `animate-story-pulse` (só o aviso pulsa) exibindo título configurado + data + horário + 📍 região. Troca de estado automática por horário (soon→now→encerrado) via `happening_status()`.
- Círculo do story patrocinado na Home mantém `animate-story-pulse`; orgânicos sem animação.
- Badge "Aprovado" verde (empresário + admin) e pré-moderação de texto preservados.
- Meu QR Code: novo seletor **Modo Rápido / Modo Controlado** (`qr-mode-card`) sincronizado com o mesmo campo `validation_mode` do estabelecimento (fonte única, sem duplicação); `GET /merchant/qr` passou a retornar `validation_mode`; persiste após refresh/logout/login. Funções existentes (Tela cheia, Baixar, Imprimir, Testar) preservadas.
- Testes: backend 11/11 + UI E2E 3/3 (iteration_17.json), sem 404/500/Network Error. Dados QA_AUTOMATED_ removidos; contas reais preservadas.

## Layout Story Patrocinado empilhado + estado ao vivo (2026-06 — testado, iteration_18)
- StoryViewer reorganizado para o Story PATROCINADO em layout EMPILHADO (referência do usuário, sem copiar a arte): progresso → cabeçalho (selo Patrocinado) → aviso dinâmico → título + linha de período (desconto · data · horário · 📍 região) → IMAGEM grande alinhada ao topo (`object-cover object-top`, sem vão) → conteúdo (categoria, título, descrição, desconto, validade, WhatsApp/ações, Ver estabelecimento) imediatamente abaixo. Sem vãos grandes.
- Só o aviso pulsa (`animate-story-pulse`); a mídia permanece estável (contêiner e story-touch sem animação).
- Estado "Acontecendo Agora / Começa em Breve / Encerrado" calculado AO VIVO no cliente a partir de `happening_info` (date/start/end) no fuso **America/Sao_Paulo** (Intl.formatToParts, hourCycle h23), recomputando a cada 60s enquanto o story está aberto — corrige transição automática e diferenças de UTC do dispositivo. Backend passou a enviar `happening_info` para qualquer boost ativo com config de acontecimento.
- Story ORGÂNICO preservado (layout overlay em tela cheia + blur).
- Testes: backend 13/13 + UI E2E 100% (iteration_18.json). Dados QA_AUTOMATED_ removidos; contas reais preservadas.

## Correção cirúrgica Story Patrocinado (2026-06 — teste visual real, sem regressão)
- **Root cause do "vão preto" / layout quebrado**: um ancestral da Home (`animate-fade-up`) mantém um `transform` (matrix identidade), que prende o `position: fixed` do StoryViewer ao container alto da página (1394px) em vez do viewport (844px), empurrando o conteúdo para trás da barra inferior. **Fix**: StoryViewer renderizado via `createPortal(..., document.body)` (escapa o ancestral transformado) + inner `absolute inset-0` (altura definida) + mídia `min-h-0 flex-1` absoluta (não estica o layout). Frame agora = 844px, imagem grande sem vão, conteúdo logo abaixo, WhatsApp/Ver estabelecimento visíveis acima da nav.
- **Banner sumia em datas futuras**: `computeHappening` passou a comparar datetime completo (`YYYY-MM-DDTHH:MM`), então antes do início (inclusive dias antes) → ⏰ COMEÇA EM BREVE; dentro da janela → ⚡ ACONTECENDO AGORA; após término → sem aviso. Fuso America/Sao_Paulo (Intl), recomputo a cada 60s.
- **PATROCINADO restaurado** como pill laranja visível no cabeçalho. Só o aviso pulsa; imagem estável.
- Teste visual real (consumer, mobile 390x844): 3 estados confirmados por screenshot (now/soon/encerrado); dados QA removidos (0 residuais); contas reais preservadas.

## Backlog (não iniciar sem concluir MVP)
- P1: Integração de pagamento real (Pix/cartão) com ativação automática por webhook.
- P1: Moderação automática de IMAGEM/vídeo via serviço externo (arquitetura já preparada; image_checked=False).
- P1: Lógica de sorteios (acúmulo + sorteio de ganhador).
- P2: Push notifications; export CSV/PDF; galeria; geolocalização com distância.

## Test Credentials
Ver /app/memory/test_credentials.md
