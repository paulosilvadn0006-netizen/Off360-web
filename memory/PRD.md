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

## Backlog (não iniciar sem concluir MVP)
- P1: Integração de pagamento real (Pix/cartão) com ativação automática por webhook.
- P1: Lógica de sorteios (acúmulo + sorteio de ganhador).
- P2: Push notifications; export CSV/PDF; galeria; geolocalização com distância.

## Test Credentials
Ver /app/memory/test_credentials.md
