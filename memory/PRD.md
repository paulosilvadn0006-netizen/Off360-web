# OFF 360 — PRD

## Problem Statement
Plataforma web responsiva e instalável (PWA) de economia e fortalecimento do comércio local. Conecta consumidores (por assinatura) a lojas/serviços próximos, com descontos, stories, validação de compra por QR Code, economia acumulada e bilhetes para sorteios. Perfis totalmente isolados: Consumidor, Empresário, Administrador e Proprietário (super_admin).

## Architecture
- Backend: FastAPI modular (core.py, storage.py, seed.py, routes_auth/common/consumer/merchant/admin.py), MongoDB (uuid string ids). Rotas `/api`-prefixadas. JWT (bcrypt + PyJWT HS256) em httpOnly cookies + Bearer fallback, brute-force lockout, require_role. super_admin satisfaz qualquer rota admin.
- Frontend: React + Tailwind + shadcn, react-query, react-router. Mobile-first PWA. Navy #020817 / orange #FF7A00.
- Object Storage: Emergent Object Storage (uploads reais de logos/fotos).


## OFF360 — Lote de ajustes (2026-06, Preview) — parcial
Feitos e compilando:
- #1 Contador de consumidores no painel do empresário (GET /merchant/consumers-count) com auto-refresh a cada 15s (card "Consumidores OFF360").
- #2 Leitura de QR do consumidor liberada após cadastro (removida exigência de assinatura ativa em /consumer/scan).
- #6 Seção "MENSAGEM AUTOMÁTICA DO WHATSAPP" com título + explicação e destaque de "Olá! Venho pelo OFF360," no Establishment.
- #7 Fachada 16:9 aceita sem erro (min reduzido para 640×360; texto ajustado).
- #9 Removido item "Validar vendas" do painel do empresário (validação segue no QR Code).
- #10 360taxi: removidos pontos fixos (Centro/Shopping...); AddressField com z-index alto (mapa não cobre mais as sugestões) e botão "Usar o endereço digitado" para entrada manual + cálculo.
Pendentes (não iniciados neste lote): #3 carregamento de imagens (otimização global), #4 estado de botões global em painéis não-taxi, #8 redesign intuitivo do cadastro do empresário. #5 (feedback pós-cadastro) já ocorre via toast + navegação no Register.


## 360Taxi — Navegação Waze + Google Maps (2026-06, Preview)
- Cada bloco de navegação do motorista (ir ao passageiro / ir ao destino, nas etapas accepted e in_progress) agora oferece dois botões: **Google Maps** (`maps/dir?...&travelmode=driving`) e **Waze** (`waze.com/ul?ll=lat,lng&navigate=yes`). Helper openWaze adicionado. Frontend compila limpo.


## 360Taxi — Botões de navegação (motorista) (2026-06, Preview)
- Na corrida aceita: botões "🧭 Como chegar ao passageiro" (abre Google Maps para as coordenadas da origem) e "🏁 Ir ao destino final" (coordenadas do destino). Durante a viagem (in_progress) há também o botão de destino. Abre via `https://www.google.com/maps/dir/?api=1&destination=lat,lng&travelmode=driving` no app de mapas do celular.
- Frontend compila limpo. Sem testes automáticos (a pedido).


## 360Taxi — Ajustes (lote 2026-06, Preview)
- **Precisão do mapa/origem**: Taxi.js capta a localização do dispositivo no carregamento (geoBias) e usa como viés na busca de origem (e destino via origem→geoBias), evitando resultados em outra cidade.
- **Descartar corridas (motorista)**: cards de corrida disponíveis podem ser arrastados para o lado (framer-motion drag) para descartar; reaparecem se o passageiro mudar a oferta (current_price muda) ou chamar de novo. Dica visual adicionada.
- **Objetos perdidos**: mantidos título/texto; lista mostra só 3 recentes por padrão; ao digitar um período (data) aparece o restante filtrado.
- Autocomplete de endereços já exibe opções ao digitar rua/estabelecimento (Nominatim, min. 3 letras).
- Frontend compila limpo. Sem testes automáticos (a pedido).


## 360Taxi — Recibo em imagem (2026-06, Preview)
- Recibo agora gerado como IMAGEM PNG (canvas, marca OFF360 + cabeçalho laranja) com trajeto, data, motorista, valor e código. Botões: "Compartilhar recibo" (navigator.share com arquivo de imagem; fallback texto/clipboard) e "Baixar imagem" (PNG; fallback .txt). Texto simples mantido como fallback.
- Frontend compila limpo. Sem testes automáticos (a pedido).


## 360Taxi — 3 melhorias (lote 2026-06, Preview)
- **Distância e ganho no Aceite**: botão "ACEITAR CORRIDA" do motorista agora mostra "{km} até você · você recebe {valor}".
- **Atalhos do passageiro (Casa/Trabalho)**: chips de endereços salvos no topo (toque preenche o destino) + botões "🏠 Salvar como Casa / 💼 Trabalho" sob origem e destino (POST /taxi/addresses com label).
- **Recibo da corrida**: na tela de conclusão do consumidor, botões "Compartilhar recibo" (navigator.share/clipboard) e "Baixar" (.txt) com valor, trajeto, data, motorista e código.
- Frontend compila limpo. Sem testes automáticos (a pedido).


## 360Taxi — 4 melhorias (lote 2026-06, Preview)
- **Aviso de nova corrida (motorista)**: banner visual pulsante ("Nova corrida chegou!") + toast (sem áudio) quando uma corrida entra na lista; vibração mantida.
- **Filtro por data em Objetos Perdidos**: input de data no painel LostFound (motorista e consumidor) filtra corridas pelo dia; botão limpar.
- **Confirmação de número no destino**: AddressField agora recebe `pointLabel` ("local de origem"/"destino") e a confirmação de número se aplica a ambos os campos.
- **Reverse geocode do GPS**: novo endpoint GET /taxi/reverse (Nominatim /reverse); ao usar GPS, o endereço textual real é exibido no lugar de "Minha localização". Validado via curl.
- Frontend compila; backend testado via curl. Sem testes automáticos (a pedido).


## 360Taxi — Ajustes cirúrgicos (lote 2026-06, Preview)
- **Cor do carro** exibida na tela do passageiro (card "Motorista encontrado" agora mostra veículo · cor · placa).
- **Botão "Aceitar corrida"** (verde) mantido abaixo de "Enviar oferta" no card do motorista; ao aceitar direto → consumidor vai automaticamente para "a caminho" + código.
- **Fim de corrida**: corrida concluída sai da lista de disponíveis (já filtrada por status=searching); refletida no painel de Ganhos.
- **Sem histórico detalhado**: removidas as listas detalhadas (DriverHistory e as linhas de TaxiHistory). Concluídas aparecem só no painel de Ganhos 360Taxi; consumidor mantém apenas um contador de viagens.
- **Objetos perdidos**: painel separado (motorista e consumidor) — GET /taxi/lost-and-found/{consumer|driver} — mostra nome do contraparte, horário da corrida e botão WhatsApp (wa.me/55+phone).
- **Origem GPS**: getCurrentPosition com enableHighAccuracy + maximumAge 0 (pin mais preciso).
- **Destino por proximidade**: geocode aceita lat/lng (viewbox bias); campo de destino usa a origem como bias → prioriza resultados locais (corrige resultados do RJ).
- **"Calcular valor"**: seleção de endereço agora preenche o valor imediatamente (o prompt de número virou refinamento opcional), corrigindo o erro de "informe os campos".
- **Confirmação de número** opcional quando o endereço não tem número.
- **Ofertas do motorista (multi-card)**: estado `busy` global trocado por `busyId` por corrida + `type="button"` — corrige o efeito de "selecionar todos os botões ao mesmo tempo"; a contraproposta agora chega corretamente ao passageiro (valor por card).
- Backend validado via curl (geocode com/sem bias, lost-and-found). Frontend compila. **Sem testes automáticos** (a pedido do usuário).


## 360Taxi — 3 correções cirúrgicas (2026-06 — Preview)
- **Aceitar corrida (motorista)**: card de oferta agora tem, além de "ENVIAR OFERTA" (marketplace, inalterado) + contraproposta, um botão "ACEITAR CORRIDA" (taxi-offer-claim-<id>, verde) que assume a corrida direto pelo valor pedido. Novo endpoint POST /taxi/rides/{rid}/driver-claim (status→accepted, gera boarding_code, notifica consumidor via ws_hub).
- **Fluxo pós-aceite (consumidor)**: ao aceitar direto, o consumidor sai automaticamente da tela "Procurando" e vê a tela de corrida (motorista a caminho + código) — sem interação.
- **Campo de endereço**: AddressField reescrito para MANTER o texto digitado ao clicar fora (state `text` persistente, sync com valor externo) e permitir digitar o número da rua (hint incluído). Antes, clicar fora limpava tudo.
- Testado: backend via curl (driver-claim) + testing_agent frontend 100% (iteration_44).


## 360Taxi — Foto do passageiro, Ganhos, Cancelar c/ motivo, Favoritos do motorista (2026-06 — Preview)
- **Foto do passageiro** (motorista): avatar do passageiro (com fallback) na oferta (taxi-offer-passenger-*) e na corrida ativa (taxi-driver-passenger). `_rider_public` já expõe photo_url.
- **Ganhos 360Taxi** (motorista): GET /taxi/driver/earnings (today/month/all: count + earnings de corridas concluídas) e card EarningsCard (taxi-driver-earnings) com 3 colunas Hoje/Este mês/Total.
- **Cancelar com motivo** (consumidor na tela "Procurando"): CancelReasonDialog agora aceita prop `reasons`; motivos: Demorou demais / Mudei de ideia / Valor alto / Outro (campo livre). Cancela enviando o motivo.
- **Favoritos do motorista**: coleção taxi_driver_favorites; GET/POST/DELETE /taxi/driver/favorites; FavoritesCard (taxi-driver-favorites) — salvar ponto atual (GPS), tocar chip para definir localização (POST /driver/location) e remover.
- Testado: backend via curl (earnings, favorites add/list/apply/delete) + testing_agent frontend 100% (iteration_43).


## 360Taxi — Identidade Entregador × 360Taxi + verificações/correções (2026-06 — Preview)
- Login/Cadastro agora refletem o módulo escolhido: entrar via 🚗 360Taxi mostra "🚗 360Taxi · Motorista" (não mais "Entregador"); entrar via Entregador mostra "🛵 Área do Entregador". Cadastro via taxi: título "Criar conta — 360Taxi", chip de identidade, sem seletor de papéis e sem campos de entrega. `off360_taxi_intent` (localStorage) abre o painel do entregador já no módulo correto. Landing (4 acessos) inalterada. Cruzamento entre módulos via alternador `deliverer-mode` (🛵 Entregas ↔ 🚗 360Taxi); sem perfil 360Taxi → abre TaxiRegister automaticamente. (testing_agent iteration_42, 100%).
- Item 1 (cards de ofertas): confirmado já implementado (foto, nome, nota, nº corridas, modelo, cor, placa, valor).
- Item 2 (avaliação bilateral): motorista avalia passageiro (POST /taxi/rides/{id}/rate-passenger) e passageiro avalia motorista; nota 5–10 com legenda "5=péssimo · 6-7 regular · 8-9 bom · 10 ótimo"; médias/contagens exibidas. Corrigido: /taxi/rides/active passou a retornar a corrida 'completed' não avaliada para o consumidor ver a tela de conclusão; botão "Pular avaliação" (POST /taxi/rides/{id}/dismiss).
- Item 3 (contadores): motorista `taxi_rides_count` e passageiro `rider_rides_count` incrementam ao concluir; /taxi/me/stats expõe stats do passageiro (taxi-rider-stats) e header do motorista mostra "· N corridas".
- Item 4 (corrida não chegava ao motorista): raio de busca padrão ampliado (`taxi_search_radius_km` 12→50 km); realtime já via create_notification→ws_hub.send + polling.
- Item 5 (tela "Procurando"): nova animação com MAPA visível ao fundo (RouteMap) e lupa varrendo horizontalmente (esquerda↔direita) — componente SearchingMap.
- Item 6 (pós-aceite): ao escolher a oferta, consumidor sai de "Procurando" e vai à tela de corrida existente (motorista a caminho + código); fluxo E2E validado com 2 papéis (testing_agent iteration_40/41).
- Item 7: áudio "bi bi bi cheguei" REMOVIDO (announceArrival vazio); vibração mantida sem alteração.


## 360Taxi — Origem/Destino editáveis + endereços salvos (2026-06 — Preview)
- Consumidor em `/taxi`: campos de Origem e Destino agora são inputs de texto EDITÁVEIS com autocomplete de endereços reais e endereços salvos (substituíram os `Select` de locais fixos).
- Componente `frontend/src/components/taxi/AddressField.js`: input + painel (GPS, endereços salvos, locais de teste quando Modo de teste ON, e resultados do autocomplete). Debounce ~450ms. testids: `taxi-origin-input`/`taxi-dest-input` (+ `-panel`, `-gps`, `-save`, `-saved-<id>`, `-remove-<id>`, `-sugg-N`).
- Backend `routes_taxi.py`: `GET /api/taxi/geocode?q=` (autocomplete), `GET/POST /api/taxi/addresses`, `DELETE /api/taxi/addresses/{aid}`. Coleção `taxi_saved_addresses` (por consumidor, dedupe por lat/lng arredondado).
- `geo.py`: função `geocode()` via Nominatim/OSM (desacoplada; `NOMINATIM_BASE_URL` configurável). Roteamento OSRM inalterado.
- Testado: backend via curl (geocode/save/list/delete OK) + testing_agent frontend 100% (iteration_39.json), incluindo fluxo de cotação Centro→Shopping.

## Home — card 360Taxi movido para o topo (2026-06 — Preview)
- `pages/consumer/Home.js`: card "360Taxi" movido para acima do "Olá, {nome}!", logo abaixo do cabeçalho OFF360. Frase atualizada para "Precisa ir em algum lugar? / 360taxi te leva". Mantido o carrinho 🚗 e o gradiente laranja (`off-gradient`).

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

## 360Taxi — Etapa 5 AJUSTES FINAIS (2026-06)
- Cadastro/aprovação: `POST /api/taxi/driver/register` (foto 3x4, CNH nº+validade, EAR obrigatório, veículo modelo/cor/placa/ano, tipo carro/moto, mín 4 portas carro, máx 12 anos — regra comercial OFF360 Campinas, `MAX_VEHICLE_AGE`/`MIN_DOORS` configuráveis). Status em_analise→aprovado/pendente. `/driver/online` exige aprovado. Admin: `GET /api/taxi/admin/drivers`, `POST /admin/drivers/{id}/approve|reject`; página `/admin/taxi-drivers` (menu a-nav-taxi-drivers). Selo ✅ Verificado (aprovado) e 🏆 Ouro (1000+ corridas).
- Marketplace de ofertas: `driver-accept`/`driver-offer` agora ANEXAM em `ride.driver_offers` sem travar (ride segue searching); consumidor vê cards (foto/nome/⭐/corridas/modelo/cor/placa/tipo/valor) e `POST /rides/{id}/choose {driver_id}` (trava atômica, bloqueia se motorista ocupado). FILA: `/driver/offers` mostra solicitações mesmo com corrida ativa (+already_offered).
- Componentes: `PhotoCapture3x4.js` (câmera getUserMedia selfie + fallback arquivo, validação 3:4), `TaxiRegister.js`, `pages/admin/TaxiDrivers.js`, `lib/taxiVibrate.js` (3s on/2s off + Notification), `MuteVib`.
- UX: Home consumidor com card compacto topo `home-taxi-card` (FAB removido); Landing tile `enter-taxi-btn` (atalho login entregador → modo taxi via localStorage off360_taxi_intent); tela "Procurando" com lupa animada; ícones 🏍️/🚗 no mapa (nearby/corrida/tracking). Vibração no consumidor (nova oferta) e motorista (nova solicitação, não durante corrida ativa), com silenciar.
- Polling mantido (sem WebSocket). Testado (iteration_37): backend 100% (7/7 stage5), frontend 100%; regressões Entregas/catálogo/pedidos OK. NÃO implementado (fora de escopo): upload de documentos, cobrança/mensalidade, sons/cronômetro.


## 360Taxi — Etapa 4 FINAL (2026-06)
- Diálogo de motivo de cancelamento (`CancelReasonDialog.js`): opções rápidas (Passageiro não apareceu / Endereço errado / Outro motivo) + campo livre; usado no motorista (taxi-driver-cancel) e consumidor (taxi-interrupt). Substitui o window.prompt.
- Chat da corrida (`RideChat.js` + backend GET/POST `/api/taxi/rides/{id}/messages`, get_current_user + participante): mensagens curtas por polling (3s) durante corrida ativa; rejeita vazio (400) e não-participante (403).
- Painel admin Emergências (`pages/admin/TaxiEmergencies.js`, rota `/admin/taxi-emergencies`, menu a-nav-taxi-emergencies): GET `/api/taxi/admin/emergencies` (admin_only) lista corrida/consumidor/motorista/horário/status/localização.
- Motoristas favoritos: `/drivers/nearby` retorna favorite=true para motoristas que o consumidor concluiu e avaliou >=8; ⭐ no marcador do mapa.
- Ícones por tipo de veículo (CRÍTICO): motorista define taxi_vehicle_type (carro|moto) no painel; nearby filtra por vehicle_type e retorna o tipo; driver_vehicle_type gravado no ride no accept; RouteMap usa 🏍️ para moto e 🚗 para carro no nearby, corrida e tracking público.
- Testado (iteration_36): backend 100% (7/7 stage4 + 8/8 stage3 pós-fix), frontend 100% multi-sessão; regressões Entregas/catálogo/pedidos OK. 360Taxi considerado FINAL/estável.


## 360Taxi — Etapa 3 (2026-06)
- Cancelamento pelo motorista: `POST /api/taxi/rides/{id}/driver-cancel` (motivo obrigatório). Se in_progress → status "interrupted" (final_price = taxi_min_fare, cancel_reason, cancelled_by="driver"); antes do embarque → devolve a corrida ao pool (status "searching", limpa driver_id/boarding_code, registra em driver_cancellations). UI: botão data-testid="taxi-driver-cancel" (TaxiDriver.js).
- Tela pública de tracking: `public_track` agora retorna active/final_price/cancel_reason. TaxiTrack.js para o polling quando active=false e mostra data-testid="track-ended" (🏁 encerrada / ⚠️ interrompida) com valor final.
- Motoristas disponíveis no mapa: `GET /api/taxi/drivers/nearby?lat&lng` (consumer) retorna posições aproximadas (arredondadas ~100m, sem id/nome) de motoristas online e sem corrida ativa, dentro do raio. UI: mapa data-testid="taxi-nearby-map" na tela de solicitação (poll 8s). RouteMap ganhou prop `drivers`.
- ETA vivo: `driver_location` recalcula pickup_distance/eta (accepted) e remaining_distance_km/remaining_eta_min (in_progress); consumidor atualiza via polling (2.5s) sem recarregar. OSRM com fallback Haversine.
- Testado (iteration_35): backend 100% (8/8 pytest novos), frontend 100%; regressões Entregas/catálogo/pedidos OK.


## 360Taxi — Etapa 2 (2026-06)
- Central de Corridas (motorista): ofertas "Corridas disponíveis" ordenadas por proximidade (pickup_distance_km); trava de **1 corrida ativa por vez** (offers=[] com corrida ativa); dupla aceitação bloqueada atomicamente no backend (409). Após finalizar, volta às ofertas.
- Tracking público: rota `/taxi/track/:token` (sem login) + `GET /api/taxi/track/{share_token}` (não expõe consumer_id/nome/foto/código). Mapa Leaflet + carrinho + ETA.
- Painel admin 360Taxi (`/admin/settings`): edita taxi_base_fare, taxi_min_fare, taxi_per_km, taxi_per_min, taxi_max_negotiations (comissão fixa R$0). Botão "Salvar configurações" (data-testid settings-save).
- Histórico: consumidor `GET /taxi/rides/history` (completed/cancelled/interrupted) e motorista `GET /taxi/driver/rides/history` (completed/interrupted), com UI em Taxi.js (taxi-history) e TaxiDriver.js (taxi-driver-history).
- Cancelamento após embarque = **"Corrida interrompida"**: se status in_progress, cancel vira status="interrupted", final_price=taxi_min_fare (não zera), guarda cancel_reason/interrupted_at/distance_traveled_km. Registros não são apagados.
- Testado (iteration_34): backend 100% (9/9 pytest), frontend 100% após corrigir botão settings-save. Regressão Entregas OK.


## Módulo 360Taxi (implementado 2026-06)
Módulo de corridas SEPARADO das entregas. Não há 4º login — dentro da conta Entregador há alternância "🛵 Entregas" / "🚗 360Taxi" (mode toggle em Deliverer.js). Consumidor acessa por botão flutuante na Home ("🚗 360Taxi te leva") → rota `/taxi`.
- Backend: `routes_taxi.py` (/api/taxi) + `geo.py` (roteamento desacoplado: OSRM público router.project-osrm.org com fallback Haversine; trocar via env OSRM_BASE_URL). Coleção `taxi_rides`.
- Fluxo: quote → rides (solicitar, aceitar sugerido ou ofertar) → searching → negociação (offer/driver-offer/accept-price/driver-accept, limite taxi_max_negotiations) → accepted (código 4 dígitos, ETA pickup) → arrived (aviso visual + voz speechSynthesis "bi bi bi cheguei") → board (código validado no backend) → in_progress (rota + carrinho, driver/location) → complete (final_price=agreed) → rate (5–10, atualiza média + rides_count do motorista). Emergência + compartilhar trajeto (GET /taxi/track/{share_token} público).
- Preço 100% ao motorista (comissão OFF360 = R$0). Tarifas editáveis no admin: taxi_base_fare, taxi_min_fare, taxi_per_km, taxi_per_min, taxi_include_pickup, taxi_max_negotiations, taxi_search_radius_km, taxi_commission (seed: 5/8/2.5/0.5/true/3/12/0).
- Modo de teste (localização mock + "simular deslocamento") para validar no Preview sem GPS real. Mapa via react-leaflet + OSM.
- Testado (iteration_33): backend 100% (4/4 pytest), UI E2E 10/11; regressão Entregas OK. NÃO implementado: cobrança real/mensalidade (etapa futura), página pública de tracking (link é gerado/copiado; endpoint backend existe).


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

## Story Patrocinado = PADRÃO AUTOMÁTICO (2026-06 — validado no Destaque REAL da Teccel)
- O branch `if (sponsored)` do StoryViewer é o layout ÚNICO e automático de todo Destaque aprovado/ativo (atuais e futuros). 100% dinâmico: estabelecimento, mídia, título, oferta, desconto, descrição, região, data, hora inicial/final vêm de `group.happening_info` + `est` + `s`. Nenhum dado hardcoded, nenhum Story de teste como solução.
- Validação visual REAL (consumer mobile 390x844) no Destaque real da Teccel (13/08 10:30–18:30, "APROVEITE A PROMOÇÃO", CAMPINAS, 10% OFF): Home com círculo patrocinado pulsando; Story com PATROCINADO + ⏰ COMEÇA EM BREVE (pulsando, pois 13/08 é futuro) acima da imagem; imagem sem vão; conteúdo logo abaixo; WhatsApp e Ver estabelecimento visíveis; `outerH=844`. Transição automática para ⚡ ACONTECENDO AGORA às 10:30 e sumiço após 18:30 (recomputo 60s, fuso America/Sao_Paulo).
- QA removido (0 residuais); contas/dados reais preservados.

## Fix: acesso a Stories na navegação do Empresário (2026-06)
- Causa: a barra inferior MOBILE renderizava só `items.slice(0,5)`; após a inclusão de "Solicitações", o item "Stories" (índice 5) saiu dos 5 primeiros e sumiu no mobile (no desktop a sidebar já mostrava tudo).
- Fix (somente `MerchantLayout.js`): barra inferior mobile agora mostra Visão geral · Validar vendas · **Stories** · Meu QR Code · **Mais**; o botão "Mais" abre um menu com os demais (Solicitações, Transações, Destaque OFF 360, Estabelecimentos, Assinaturas). Nada removido; desktop inalterado.
- StoryViewer.js NÃO tocado (git diff vazio). Teste visual: aba Stories visível e menu "Mais" funcional. QA removido; Destaque real da Teccel preservado.

## Ajustes pontuais: Destaque 2 formas + QR fast/controlled + badge + categoria (2026-06 — testado iter19)
- **Destaque OFF360 — 2 formas**: "Usar Story ativo" (comportamento atual) ou "Nova postagem" (mídia exclusiva do Destaque). Nova postagem cria um Story `sponsored_only=true` que NUNCA aparece como orgânico (excluído de `_active_stories`) e só entra na Home como patrocinado quando o boost está ativo (injetado via `sponsored_story_ids`). Ambos usam o mesmo padrão automático de exibição patrocinada.
- **QR Modo Rápido**: `/scan` não notifica o empresário; `/merchant/pending` e novo `/merchant/pending-count` excluem `validation_mode=='fast'` → modo rápido NÃO gera pendência em Validar vendas. Modo Controlado cria pendência normalmente. Textos explicativos atualizados na tela Meu QR Code.
- **Badge "Validar vendas"**: badge vermelho (`validate-pending-badge`) na sidebar e barra inferior do empresário, refletindo `/merchant/pending-count` real (poll 8s), com animação única `animate-badge-pop` ao incrementar (não fica piscando), some no 0. Nenhum badge no modo rápido.
- **Categoria "Bares e Baladas"** (ícone Martini) adicionada de forma idempotente no seed; demais categorias (inclui Lazer) preservadas; selecionável no cadastro e presente na experiência do consumidor.
- StoryViewer.js NÃO tocado. Testes: backend 7/7 + frontend 100% (iter19). QA removido; contas reais e Destaque real da Teccel preservados.

## Fix -1 dia na data do Destaque (2026-06 — testado iter20)
- Causa raiz: `fmtDate` (frontend/components/shared.js) fazia `new Date('2026-08-12')` (meia-noite UTC) e formatava em America/Sao_Paulo (UTC-3), caindo em 11/08. Fix cirúrgico: strings de data pura (`^\d{4}-\d{2}-\d{2}$`) são formatadas direto como DD/MM/YYYY, sem conversão de fuso; datetimes ISO completos continuam usando o fuso SP. Backend sempre armazenou a data correta.
- Validado: Destaque do iPhone (period 2026-08-12) exibe 12/08 no empresário e admin; Teccel (13/08 datetime) inalterado; StoryViewer não tocado. Backend 4/4 + frontend 100%.

## Acesso administrativo removido da tela pública (2026-06)
- Removido o link/botão "Acesso administrativo" da Landing pública (`pages/Landing.js`). Único arquivo alterado.
- `/admin` continua abrindo o login administrativo existente: usuário não autenticado é levado ao login (`/admin-access` → AdminLogin) via `RoleRoute` (inalterado). Consumidor/empresário que acessarem `/admin` são redirecionados ao próprio painel. Credenciais, auth, permissões, rotas e painel admin inalterados.
- Validado por screenshot: Landing sem link admin; `/admin` mostra o login administrativo.

## Fase A (parcial) — Home do consumidor: cabeçalho + economia (2026-06)
- Logo OFF360 no topo (`home-logo`); removido o card grande "Escanear QR" (botão central preservado) e o card de assinatura da Home.
- Contador "A comunidade OFF360 já economizou" (`community-savings`): soma REAL de `saved_amount` de transações `confirmed` (aggregate no `/consumer/home`); R$ 0,00 quando não há economia — sem valores fictícios.
- "Minha economia" (`my-savings`) = `total_saved` individual do consumidor. Bilhetes mantido.
- PENDENTE Fase A: seções de feed (Bombando perto/Ofertas de hoje/Mais bem avaliados/Novidades) + selos automáticos (EM ALTA/MAIS VISTO/PERTO). Fases B/C/D não iniciadas.

## Fase A completa — feed de descoberta + selos automáticos (2026-06)
- Backend `/consumer/home` retorna `sections` {bombando, hoje, top_rated, novidades} com estabelecimentos REAIS (bombando=engajamento fav+interesse; hoje=com story ativo hoje/desconto; top_rated=rating_count>0; novidades=mais recentes) e `badges` {trending_id, most_viewed_today_id (interest_events do dia), user_neighborhood}. Sem métricas inventadas; selo só quando há dado.
- Home renderiza as 4 seções com `EstRow` + selos automáticos (🔥 EM ALTA, 👁 MAIS VISTO HOJE, 📍 PERTO DE VOCÊ) via `estBadges`. Validado por screenshot.

## Redesign Fases A e B — fiel à referência visual do usuário (2026-06 — iter21, aguardando validação manual)
- **Fase A (Home):** cabeçalho moderno (logo OFF360 + sino), saudação "Olá, {nome}! 👋" + localização, busca com ícone de filtros, chips de filtro, Stories com "+ Ver todos". Seções agora em CARROSSÉIS horizontais (`EstCard` — imagem, selo, coração de favoritar, nome, categoria·distância, "X% OFF"): 🔥 Bombando, ⚡ Ofertas de hoje, ⭐ Mais bem avaliados, 🎁 Novidades, + Explore por categoria. Dedupe entre seções: cada estabelecimento aparece só na 1ª seção elegível; seção sem itens novos é ocultada (evita repetição excessiva). Card verde "A comunidade OFF360 já economizou R$X" com ilustração (`/community.jpg`, `mix-blend-multiply`) + "Minha economia" e "Bilhetes". Dados 100% reais (community_saved=R$81,75 no ambiente). `EstRow` preservado (usado por Explore.js).
- **Fase B (StoryViewer patrocinado):** layout IMERSIVO full-bleed (mídia ocupa a tela toda, object-cover, fundo desfocado), barras de progresso no topo, header com nome + selo "Patrocinado", overlay inferior com selo de estado, desconto grande ("10% OFF"), validade curta, CTA grande "APROVEITAR OFERTA" (abre WhatsApp real via wa.me quando configurado; senão vai ao estabelecimento) e "Ver estabelecimento". Story orgânico preservado (overlay antigo).
- **"Acontecendo Agora" desacoplado do patrocinado:** selo só aparece dentro da janela real (happening_info date/start/end, fuso America/Sao_Paulo, recomputo 60s). SOMENTE "⚡ Acontecendo agora" (laranja) pulsa (`animate-story-pulse`); "⏰ Começa em breve" (roxo) NÃO pulsa; fora da janela, sem selo.
- Testes: iter21 frontend 100% dos requisitos testáveis (sem bugs de produto). Story orgânico não testável no ambiente (sem stories orgânicos ativos — só o boost real da Teccel). Consumidor QA temporário: qa_ana_home@off360.com / QaAna!2026 (remover após validação). **PAUSADO para validação manual do usuário antes da Fase C.**

## Fase C — Destaque em blocos de 24h + wizard (2026-06 — iter22, validado E2E)
- **Regra comercial:** novo Destaque é vendido em blocos EXATOS de 24h. O empresário escolhe só o INÍCIO (data+hora) e a qtde de blocos consecutivos; `period_end = início + 24h × blocos` (fixo). Pode comprar múltiplos períodos em datas separadas (1 pedido → N boosts com `campaign_id`).
- **Backend (`routes_boosts.py`):** `NewBoost.slots=[{start,blocks}]`; `_resolve_slots` converte SP(UTC-3)→UTC e calcula 24h×blocos; `create_boost` cria 1 boost por slot (`block_rule=True`, `block_count`, `happening_date`=data do slot), pula o dup-check (permite vários períodos do mesmo Story); `activate_boost` IGNORA override de período do admin quando `block_rule` (período travado); `active_boost_for_story` escolhe o boost com janela vigente entre vários ativos. Boosts LEGADOS (`block_rule` ausente) mantêm período livre por datas — Teccel/iPhone intactos.
- **Frontend empresário (`merchant/Boosts.js`):** wizard de 4 passos (Conteúdo → Períodos 24h → Detalhes/Acontecendo Agora → Revisão), slots dinâmicos com faixa "início→fim (Xh)", prévia PATROCINADO. Cards com selo 📦 de blocos.
- **Frontend admin (`admin/Boosts.js`):** card mostra 📦 "N bloco(s) de 24h · início→fim"; diálogo de ativação exibe período FIXO (sem inputs de data) para block_rule.
- **Pagamento:** MOCADO (período gratuito, sem transação). Preparado para cobrança futura.
- Testes: script backend (períodos exatos + trava admin) + iter22 frontend 100% (wizard, admin, regressões Teccel e consumidor). Fixtures QA: `qa_merch_fasec@off360.com`/`QaMerch!2026` (est. "QA Bloco 24h" + Story ativo).

## Fase D — "Acontecendo Agora" desacoplado (parcialmente coberto)
- Selo ⚡ é independente do "patrocinado": só aparece dentro da janela real (`happening_date/start/end`), calculado ao vivo (fuso SP, recomputo 60s); SOMENTE "Acontecendo agora" (laranja) pulsa; "Começa em breve" (roxo) não pulsa; fora da janela, sem selo. A definição da janela pelo empresário já está no wizard (passo 3).
- **VALIDADO E2E (Fase D)** com promoção de teste real: ANTES (≤90min) → "COMEÇA EM BREVE" roxo não pulsa; DURANTE → "⚡ ACONTECENDO AGORA" laranja, só ele pulsa; DEPOIS → selo some e Story segue patrocinado. `computeHappening` refinado: "soon" só dentro de 90min; robusto a cruzar meia-noite.

## Revisão geral A→D — 6 correções + regressão (2026-06 — iter23, 100%)
- (1) Home card comunidade legível (ilustração clareada + menor, texto max-w-[60%]). (2) Chips de filtro com fade de scroll. (3) Wizard: início em DATA + HORA separados pt-BR (slots `{date,time,blocks}` + `combineStart`). (4) Admin: acontecimento reflete estado real (`hapNowAdmin`; só pulsa quando na janela E ativo). (5) Story fora da janela mostra FIM DO BLOCO 24h (`group.boost_end`) em vez de validade de 60 dias. (6) Detalhe do estabelecimento trata 404 (`est-not-found` + Voltar, `retry:false`).
- Higiene: `reset()` do wizard corrigido; `advance()` do StoryViewer não chama `onClose()` no updater (removeu warning setState-in-render).
- Regressão iter23 100% (3 perfis); legado Teccel/iPhone preservado. **Todos os fixtures/contas QA removidos.** Não publicado em produção.

## Correção visual cirúrgica (2026-06 — iter24, 100%) — aproximar da referência aprovada
- **Story patrocinado:** CTA "APROVEITAR OFERTA" e selo "Patrocinado" voltaram ao LARANJA OFF360 (`bg-off-orange` #ff7a00), não mais vermelho; layout imersivo mantido; só "⚡ Acontecendo agora" pulsa.
- **Home:** cards compactos (`EstCard` w-36/h-24), espaçamentos refinados (SectionHeader mb-2.5/mt-5, cards de economia p-3.5), folga inferior `pb-36` no ConsumerLayout (último conteúdo acima da nav fixa).
- **Card "comunidade economizou":** ilustração substituída por asset com FUNDO VERDE SÓLIDO (#0d5d38) + máscara de fusão à esquerda — eliminado o checkerboard/quadriculado/branco. Valor real preservado.
- Regressão iter24 100% (nenhuma lógica A→D alterada). Fixtures QA removidos. Não publicado em produção.

## Correção de cache do Preview (2026-06 — visual não aparecia no dispositivo do usuário)
- Causa: `/community.jpg` (mesmo nome, cache HTTP) + service worker antigo (`off360-v1`) mantendo app-shell desatualizado no cliente.
- Fix: imagem versionada `/community-v2.jpg` (Home.js atualizado) + service worker `off360-v2` (activate agora limpa TODOS os caches + skipWaiting/clients.claim). Screenshots tirados do preview real confirmam o visual aprovado.
- Para o usuário: basta 1 recarregamento (o SW novo assume e limpa cache). Fixtures QA mantidos temporariamente para validação; remover após aprovação final.

## Tarefa 1 — Restrição de mídia + enquadramento 9:16 (2026-06 — frontend, aguardando validação)
- Novo componente `components/Media916Editor.js`: modal de enquadramento vertical 9:16 (saída 1080×1920). Imagem: recorte real via canvas (arrastar + zoom); Vídeo: valida duração (≤60s) e mostra prévia 9:16 (sem recorte no cliente).
- Story normal (`merchant/Stories.js`): agora aceita **somente imagens** (`accept="image/*"`, bloqueio de vídeo com toast). Ao escolher imagem abre o editor 9:16; prévia vertical após enquadrar.
- Destaque OFF360 PRO (`merchant/Boosts.js`, "Nova postagem"): imagem **ou** vídeo de até **60s**; abre o editor 9:16; prévia vertical.
- Nenhuma outra funcionalidade alterada (regras 24h, wizard, moderação de texto, admin intactos). Compilação limpa. Não testado E2E (sem fixture de empresário). **PAUSADO para validação manual.**
- Tarefas 2 (ffmpeg + moderação OpenAI omni-moderation) e 3 (cron auto-aprovação 2min) bloqueadas até o usuário confirmar `OPENAI_API_KEY` configurada nos Secrets.

## Tarefa 2 — Moderação automática de mídia via OpenAI (2026-06 — implementado, aguardando validação)
- ffmpeg instalado (system_deps.txt) + `openai==1.99.9` (requirements.txt). Novo serviço `backend/moderation_ai.py::moderate_boost_full(texts, media_url, media_type)`.
- Vídeo: extrai frames com ffmpeg (`fps=1/3` → 1 a cada 3s, teto 20, sempre incluindo 1º e último frame via `-sseof`); imagem: bytes diretos. Cada imagem ≤20MB.
- Envia texto + imagens/frames (data URLs base64) ao `omni-moderation-latest`. Decisão combina moderação determinística de TEXTO (moderation.py) + moderação de MÍDIA da IA.
- FAIL-SAFE (obrigatório): sinalizado/erro/timeout/chave ausente/ffmpeg falho/resposta inválida ⇒ `decision="review"` (fica "Em análise" com flag ao admin), `auto_approvable=False`. NUNCA aprova automaticamente. Texto proibido ⇒ `rejected` (sem gastar chamada de IA). Só texto+mídia limpos ⇒ `decision="approved"`, `auto_approvable=True` (elegível à auto-aprovação da Tarefa 3).
- Integrado em `routes_boosts.py::create_boost` (moderação única reaproveitada por todos os slots de blocos). Nenhuma outra funcionalidade alterada.
- Chave `OPENAI_API_KEY` no `.env` do Preview (preenchida pelo dono via editor de arquivos; nunca exibida/registrada).
- **Testes:** extração de frames OK (13 frames p/ vídeo 35s, 1º+último, ≤20); fail-safe OK (URL inválida→review); rejeição de texto OK; `models.list` OK (chave válida). Chamada real ao `omni-moderation-latest` retorna **429 invalid_request_error** = organização OpenAI ainda não provisionada com créditos pré-pagos (não é bug de código). Assim que a org for provisionada, a moderação passa a retornar resultados reais. **PAUSADO para validação.** Tarefa 3 (cron auto-aprovação) NÃO iniciada.

## Tarefa 3 — Cron de auto-aprovação após 2 min (2026-06 — implementado e testado)
- `.emergent/crons.yml` (novo): cron `autoapprove-boosts` a cada 1 min → `POST /api/cron/auto-approve-boosts`. (Obs.: em produção o scheduler descarta cadências <15min; hoje só usado no Preview, sem deploy.)
- Endpoint (`routes_boosts.py`): valida `Authorization: Bearer WEBHOOK_CRON_SECRET` (compare_digest, 401 se ausente/errado), idempotência por `X-Webhook-Id`/`run_id` (coleção `cron_runs`), responde 2xx na hora e faz o trabalho em BackgroundTask. Secret novo em `backend/.env` (`WEBHOOK_CRON_SECRET`), fora do crons.yml/código/logs.
- Worker `auto_approve_safe_boosts()`: aprova (→ `active`, `auto_approved=True`) SOMENTE boosts `status=='awaiting'` com `moderation.decision=='approved'` E `moderation.auto_approvable==True` E `created_at` > 2 min. review/rejected/falha da IA NUNCA entram. NÃO altera `period_start`/`period_end`. Idempotente via `find_one_and_update` atômico (filtro no status). Notificação + auditoria (`auto_approve_boost`) 1× por aprovação; nenhum segredo registrado.
- **Testes (todos OK):** seguro→active; seguro recente (<2min)→não; rejeitado→intocado; review→não; falha IA (review)→não; sinalizado (review)→não; 2ª execução→0 (idempotente, histórico 'active' único, 1 notif/1 auditoria); período intacto. Endpoint: 401 sem/errado, 200 accepted com secret, duplicate no mesmo run_id. E2E endpoint→background→active confirmado. Arquivos QA removidos. Não publicado em produção.

## Auto-aprovação em produção via cron-job.org (2026-06 — preparado, aguardando deploy)
- Decisão do dono: opção (a) — `.emergent/crons.yml` (cron `*/1`) fica SÓ para Preview/testes (prod descarta <15min); em PRODUÇÃO quem dispara é o **cron-job.org** batendo no endpoint seguro já validado `POST /api/cron/auto-approve-boosts` (Bearer `WEBHOOK_CRON_SECRET`), a cada 1 min → aprovação em ~2min (teto ~3min) independente de tráfego.
- Domínio de produção: https://off360.com.br → URL do cron: `https://off360.com.br/api/cron/auto-approve-boosts`.
- Endpoint confirmado deploy-ready: idempotente, fail-safe, aceita corpo vazio (cron-job.org), não altera period_start/period_end. Verificado no Preview (401 sem auth, 200 com secret + body vazio).
- PENDENTE (manual, antes de publicar): (1) cadastrar `WEBHOOK_CRON_SECRET` (MESMO valor do Preview) nos Secrets/Env do app deployado; (2) publicar o código (deploy) — endpoint só existe em prod após deploy; (3) criar o cronjob no cron-job.org (POST, header Authorization: Bearer <secret>, every 1 min) e rodar Test run esperando 200.

## StoryViewer — timers, navegação e bloqueio de gestos nativos (2026-06 — testado iter25, aguardando validação)
- **Story normal (orgânico):** imagem dura exatamente 10s (`IMG_DURATION=10000`) e avança sozinha; barra reflete os 10s; toque direito avança, esquerdo volta; segurar PAUSA (congelamento exato — `pausedRef.current=true` no onDown, sem vazamento) e soltar continua de onde parou.
- **Destaque patrocinado:** SEM timer de avanço (timer de imagem só roda quando `!isVideo && !sponsored`); imagem fica fixa até o usuário agir; vídeo em `loop`, sem `onEnded/onTimeUpdate` de avanço; barra do item atual estática 100% (sem contagem regressiva); com 1 só destaque não sai/troca sozinho; navegação manual (direito/esquerdo/segurar) preservada; fechar funciona.
- **Bloqueio de gestos nativos (crítico):** `mediaGuard` (draggable=false, onDragStart/onContextMenu preventDefault, WebkitTouchCallout/UserSelect/UserDrag none, pointer-events none) em todas as imagens/vídeos; overlay de toque e roots com `onContextMenu preventDefault` + `select-none` + `touch-action none`. Pressionar/segurar NÃO abre Salvar/Compartilhar/menu/seleção/arrastar.
- Único arquivo alterado: `frontend/src/components/StoryViewer.js`. Testes iter25 mobile 390x844 + tablet 820x1180: 11/11 critérios PASS (auto-avanço 10s, tap nav, hold-pause, patrocinado sem timer + barra estática, contextmenu prevenido em root e imagens, fechar). Não publicado em produção.
- Fixtures QA temporárias no banco (remover após validação): consumidor `qa_story_qa@off360.com`/`QaStory!2026`; est `QA_EST_ORG` ("QA Loja Normal") com stories `QA_ORG_STORY`/`QA_ORG_STORY2`.

## Ativação automática de estabelecimentos no cadastro (2026-06 — implementado e testado)
- `routes_merchant.py::create_establishment`: novo estabelecimento válido (fantasy_name obrigatório) agora entra **approved + active** com `subscription_start=now` e `next_due=now+30d` (período gratuito) — SEM clique manual em "Ativar" no admin.
- Notificações ajustadas: admin recebe "ativado automaticamente" (informativo) e o empresário recebe "Estabelecimento ativado"; auditoria `auto_activate_establishment`.
- Controle manual do admin preservado (approve/reject/suspend intactos). Cadastros incompletos (sem fantasy_name) são rejeitados pelo model (422) e não ativam. StoryViewer, cron/auto-aprovação e regras de suspensão/vencimento NÃO alterados.
- **Teste E2E (PASS):** merchant cria estabelecimento via endpoint real → volta approved+active (sub_start/next_due setados); story orgânico via endpoint real; consumidor vê o grupo (nome correto, sponsored=false); boost elegível → worker auto-aprova (active) → home mostra sponsored=true; admin `POST /admin/establishments/{id}/suspend` → suspended. Fixtures QA removidas.

## Modalidade Entrega/Retirada OFF360 + Perfil Entregador (2026-06 — implementado e testado, Preview)
- **Reuso:** auth/roles (novo role `deliverer`), establishments, snapshot de desconto, sistema de validação (código single-use + token + expiry + idempotência) e a coleção `transactions` (métricas de consumidor/empresário contam automaticamente). Sem cardápio/carrinho/pagamento online.
- **Nova coleção `orders`** (mode delivery|pickup; status new→preparing→ready→on_the_way→arrived→delivered / cancelled). Validação single-use por QR (consumidor confirma no próprio app) OU código (entregador/empresário digita). Conclusão atômica/idempotente cria 1 transaction confirmada e incrementa consumidor (total_saved/total_spent) uma única vez; ganho do entregador só no pedido; WhatsApp = evento (não venda); cancelado não conta.
- **Backend novo:** `routes_delivery.py` (endpoints consumer/merchant/deliverer). Ajustes: `routes_auth.py` (role deliverer + campos vehicle/works_fixed/fixed_establishment_id/photo_url), `routes_merchant.py` (EstUpdate: offers_delivery/offers_pickup/delivery_areas/delivery_fee_text/delivery_eta/pay_pix/pay_card/pay_cash), `routes_consumer.py` (_est_public expõe campos de entrega), `server.py` (router).
- **Frontend novo:** `layouts/DelivererLayout.js`, `pages/deliverer/Deliverer.js` (Nova entrega/Em andamento/Histórico/Meus ganhos + iniciar entrega c/ valor+ganho + CHEGUEI + validar código), `pages/consumer/OrderTracking.js` (/order/:id, bolinha `.off-blink` real liga/desliga, Entregue fixa escura, código, confirmar QR), `pages/merchant/Orders.js` (/merchant/orders). Ajustes: `App.js` (rotas + homeFor deliverer), `Register.js` (3º perfil Entregador), `Establishment.js` (card config entrega + save), `EstablishmentDetail.js` (DeliveryPanel: Pedir pelo WhatsApp + criar pedido), `MerchantLayout.js` (nav Pedidos), `index.css` (`@keyframes off-blink`).
- **Segurança:** consumidor confirma só o próprio pedido; entregador não valida próprio pedido; código expira (6h) e é uso único; conclusão atômica/idempotente.
- **Testes:** Backend E2E (script, PASS): WhatsApp não-venda, entrega completa com bolinhas, validação QR/código single-use, dupla validação idempotente, retirada sem entregador, cancelamento, métricas dos 3 lados corretas (1x). Frontend E2E (iteration_26, 20/20 PASS, mobile 390x844): cadastro entregador, painel de pedido, entrega completa, retirada, cancelamento, ganhos, bolinha piscando. Fixtures/scripts QA removidos. NÃO publicado em produção.

## Config Entrega/Retirada no estabelecimento + "+ Nova entrega OFF360" (2026-06 — implementado e testado, Preview)
- `Establishment.js`: seção renomeada para **"COMO SEUS CLIENTES PODEM RECEBER/COMPRAR?"** com opções **Retirada no local** e **Entrega** (uma ou ambas). Campos região/taxa/tempo aparecem só se **Entrega** marcada; formas de pagamento (PIX/Cartão/Dinheiro) quando entrega ou retirada. Se Entrega desmarcada, nada de entrega aparece p/ empresário nem consumidor.
- **Novo endpoint** `POST /api/merchant/orders` (routes_delivery.py): empresário cria pedido após fechar no WhatsApp; pede só consumidor (e-mail/WhatsApp), valor final e tipo. Resolve o consumidor; **Entrega → status `ready`** (aparece em "Nova entrega" dos entregadores); **Retirada → `preparing`** (fluxo próprio, sem fila). NÃO pede ganho do entregador (ele informa ao assumir). Reaproveita validação/código/QR/idempotência/métricas.
- `Orders.js`: botão **"+ Nova entrega OFF360"** + diálogo (consumidor, valor, tipo).
- **Testes (PASS):** entrega criada vai p/ fila do entregador; retirada não vai; consumidor inexistente → 404; config aparece/oculta conforme marcação. Dados/scripts QA removidos. NÃO publicado em produção.

## Ajustes Entrega/Retirada — Fase 1 contida (2026-06 — Preview, sem tocar no fluxo aprovado)
- **Item 3 (WhatsApp):** mensagem do consumidor agora com prefixo fixo OFF360 — "Olá! Encontrei vocês pelo OFF360." (ou "...e quero aproveitar a oferta disponível." quando há desconto). (`routes_delivery.py::whatsapp_order`).
- **Item 4 (código):** `validation_code` agora é **4 dígitos** (ex: 8351), uso único/expiração/trava de status/idempotência preservados. (`_pin()` em `routes_delivery.py`, aplicado nos 2 endpoints de criação.)
- **Item 5 (só código):** removida menção a QR na etapa do entregador; botão do consumidor renomeado para "Confirmar recebimento". (`Deliverer.js`, `OrderTracking.js`.)
- **Item 6 (número curto):** novo campo `number` (4 dígitos) exibido como "Pedido nº XXXX" para empresário, entregador e consumidor; distinto do código; `code` técnico ODR preservado internamente.
- **Testado:** WhatsApp fixo ✅; code/number 4 dígitos e diferentes ✅; validação só após arrived/ready ✅ (mesmo código já validado); idempotência ✅; número igual nos dois lados ✅. Dados QA removidos.

### DEFERIDO (fase grande, exige iteração dedicada — não implementado ainda)
- Item 1/2: "Formas de Atendimento" (botões "Pedir com entrega"/"Pedir para retirar", orientação quando ambos, dedup de campos, complemento editável da mensagem pelo empresário).
- Item 7: banner/badge/som de "Novo pedido OFF360" no painel do empresário.
- Itens (parcial) 8–16: prioridade própria×external — **oferta simultânea com reserva atômica** e **vínculo de entregadores** IMPLEMENTADOS (ver abaixo); PENDENTE: **alerta sonoro em loop** (3 toques ~2s + pausa 5s) com parar/aceitar/recusar e limitação de autoplay do navegador.

## Vínculo de Entregadores + Oferta Atômica (2026-06 — implementado e testado, Preview)
- **Backend (`routes_delivery.py`):** vínculo entregador↔estabelecimento (Solicitação→Aprovação). Endpoints: `GET /merchant/deliverers` (retorna link_code gerado idempotente + pending + active), `POST /deliverer/link` (solicita com código), `GET /deliverer/links` (meus vínculos), `POST /merchant/deliverer-links/{id}/approve|reject`. Coleção `deliverer_links` (status pending/active/rejected).
- **Escopo de ofertas:** pedido tem `offer_scope` (own|external). `GET /deliverer/orders/available` monta `$or`: vinculados ativos veem `own` do(s) estabelecimento(s) vinculado(s); independentes (`is_independent` default True) veem `external`. Exclui `rejected_by`.
- **Aceite ATÔMICO:** `POST /deliverer/orders/{id}/accept` usa `find_one_and_update` (filtro deliverer_id=None) → só o 1º leva; concorrentes recebem **409** "Esta entrega já foi aceita por outro entregador.". `POST .../reject` só adiciona ao `rejected_by` (não cancela o pedido).
- **Frontend Entregador (`pages/deliverer/Deliverer.js`):** nova aba **Vínculos** (digitar código + solicitar + lista de status Pendente/Ativo/Recusado); aba **Nova entrega** com botões **ACEITAR ENTREGA** / **Recusar** + selo "Loja vinculada" (own); pós-aceite vai para **Em andamento** (Iniciar entrega → valor+ganho → CHEGUEI → validar código 4 díg).
- **Frontend Empresário (`pages/merchant/Orders.js`):** seção **"Meus entregadores"** DENTRO da tela de Pedidos (código de vínculo + copiar; solicitações pendentes Aprovar/Recusar; lista de vinculados ativos). Diálogo "+ Nova entrega OFF360" ganhou seletor de escopo (Meus vinculados / Independentes) só para modo Entrega.
- **Testes:** Backend E2E script (ALL PASS): vínculo pendente→aprovado, own só p/ vinculado, external p/ independente, recusa individual, aceite atômico 409 no 2º. Frontend E2E iteration_27 (19/19 PASS, mobile 390x844). Dados QA (QAFE_/QA_LINK_) removidos; 0 residuais; contas reais preservadas. NÃO publicado em produção.
- **PENDENTE (P1, aguardando validação do usuário):** painel admin de moderação "Em revisão".

## Endereço estruturado no cadastro dos 3 perfis (2026-06 — Preview)
- **Register (consumidor/empresário/entregador):** substituídos os campos Cidade/Bairro simples por endereço estruturado — **Rua/Logradouro + Nº (ao lado, independente)**, Bairro, Cidade e Complemento (opcional). Mesmo padrão OFF360 (`reg-street`, `reg-number`, `reg-neighborhood`, `reg-city`, `reg-complement`).
- **Backend:** `RegisterInput` recebe `address_street/number/neighborhood/city/complement`; salvos separados no usuário (e `city`/`neighborhood` legados sincronizados p/ retrocompat). Máscara de telefone e normalização preservadas.
- **Testes:** cadastro dos 3 perfis com endereço estruturado — 6/6 PASS (campos salvos separados); layout confirmado por screenshot. Frontend compila. Dados QA removidos. NÃO publicado em produção.

## Pendências finais — telefone, endereço salvo, solicitar entregador (2026-06 — Preview)
- **Telefone (item 1):** máscara `(DD) 99999-9999` no cadastro (Register — cobre consumidor/empresário/entregador; remove +55 automaticamente ao digitar). Backend `core.normalize_phone` salva só 10-11 dígitos (sem +55) no register e no update de perfil do consumidor; **rejeita telefone incompleto** (erro 400). Busca/vínculo por telefone continua retrocompatível. Cadastros antigos preservados.
- **Endereço salvo (item 2):** `establishment_detail` retorna `my_address` (endereço da conta). No consumidor, se há endereço salvo mostra "Entregar neste endereço" (saved-address-box) + "Alterar endereço" (addr-change); ao alterar usa o novo só naquele pedido e (com save) atualiza a conta. Cada pedido guarda seu snapshot.
- **Solicitar entregador (item 3):** `request-deliverer` NÃO muda mais o status do pedido (removido o set "ready" + history). A oferta é enviada com `ride_requested=True` e o pedido pode seguir em "novo/em preparo". `available_orders` agora oferta pedidos com `ride_requested=True` e status em new/preparing/ready; `accept` aceita nesses status; a aba "Em andamento" do entregador inclui pedidos aceitos ainda em preparo; `start` continua exigindo status "pronto" (empresário segue o fluxo normal de preparo). Processos independentes.
- **Testes:** backend script 13/13 PASS; máscara validada por screenshot (`5519996662873` → `(19) 99666-2873`). Frontend compila OK. Dados QA removidos. NÃO publicado em produção.

## Pacote de ajustes finais — Catálogo, 1ª compra, endereço, Solicitar entregador (2026-06 — Preview)
- **Catálogo (itens 1-2):** coleção `catalog_items` + CRUD merchant (`/merchant/catalog` GET/POST/PUT/DELETE, limite 20, foto via object storage). Config no estabelecimento: `delivery_fee`, `avg_prep_minutes`. Vitrine no consumidor (cards horizontais) com preço/desconto/preço final e steppers de quantidade; resumo com subtotal, taxa, total e tempo de preparo.
- **1ª compra (item 3):** `first_purchase_enabled`/`first_purchase_percent` no estabelecimento. Regra **MAIOR desconto (nunca soma)**: aplica max(desconto do produto, % 1ª compra). Válida 1x por consumidor/estabelecimento; marcada `first_purchase_used=True` no `_finalize_order`. `establishment_detail` expõe `first_purchase_available`.
- **Endereço do consumidor (item 4):** coletado na entrega (Rua/Nº/Bairro/Cidade/Complemento), snapshot no pedido (`customer_address` + `customer_address_struct`); `save_address` grava na conta (`address_*`). Enviado automaticamente ao empresário e entregador. PENDENTE (próxima): prefill "Entregar neste endereço / Alterar" a partir da conta.
- **Solicitar entregador (itens 5-6):** pedido OFF360 do consumidor nasce com `ride_requested=False` (não ofertado). Botão `🛵 SOLICITAR ENTREGADOR` (m-request-deliverer) → `POST /merchant/orders/{oid}/request-deliverer {offer_scope, delivery_fee}` define o valor da corrida e oferta. O entregador vê o valor (`deliverer_earning`) ANTES de aceitar (d-ride-fee); ao iniciar não digita mais o ganho (usa o valor do empresário). WhatsApp form ganhou `m-new-ride-fee`.
- **Código independente (item 8):** validado — funciona igual para vinculados e independentes (mesmo endpoint validate-code; errado/certo/já-usado).
- **Bolinha do entregador (item 9):** `d-status-dot` piscante nas cores existentes (ready laranja, on_the_way verde, arrived azul). **Como chegar ao cliente (item 10):** `d-customer-maps` (Google Maps do endereço do pedido).
- **Item 7 (telefone):** busca/vínculo por telefone normalizado (remove +55, DDD extra, espaços, traços, parênteses) — DONE e testado. PENDENTE (próxima): máscara `(DD) 99999-9999` nas telas de cadastro/edição + normalizar para 11 dígitos ao salvar + rejeitar incompleto.
- **Testes:** backend script 22/22 PASS; frontend E2E iteration_32 **100% (8/8)** (correção de 1 import faltante de Input). Dados QA (QAFULL_/QAPK_) removidos (0 residuais). NÃO publicado em produção.

## Venda pelo WhatsApp → Encontrar entregador (2026-06 — implementado e testado, Preview)
- **Reutiliza integralmente o sistema de entrega** (nada duplicado). Botão prominente em `/merchant/orders`: "Fechou uma venda pelo WhatsApp? Encontre um entregador aqui" (`m-whatsapp-delivery-btn`) → diálogo "Encontrar entregador".
- **Formulário mínimo:** valor, tipo (Entrega/Retirada), endereço de entrega do cliente (obrigatório p/ entrega), nome do cliente (opcional), escopo (Meus vinculados / Independentes) e Cliente OFF360 (opcional).
- **Cliente guest (sem conta OFF360):** `merchant_create_order` agora aceita `consumer_identifier` opcional + `customer_name`/`customer_phone`/`customer_address`; pedido criado com `consumer_id=None`. Notificações ao consumidor têm guard `if consumer_id` (start/arrived/finalize). O código de 4 dígitos é exibido ao empresário (`m-relay-code-<id>`) para repassar via WhatsApp. Se informar um Cliente OFF360 válido → vincula e o cliente vê o código no app (bloco de repasse não aparece).
- **Reserva atômica, oferta own/external, alerta sonoro, Pedido nº 4 díg e código 4 díg**: reaproveitados sem alteração. Bolinhas/cores/animações de status **intactas**.
- **Aviso adicional ao empresário:** ao um entregador aceitar, o card do pedido mostra "🚚 Entregador a caminho do estabelecimento — Um entregador aceitou sua solicitação e está indo buscar o Pedido nº XXXX." (`m-deliverer-accepted-<id>`).
- **Entregador:** vê "Onde buscar o pedido" (endereço do estabelecimento, `d-address`) + "Entregar para o cliente" (`d-customer-address` + "Como chegar ao cliente" via Google Maps). `customer_address` no pedido; endereço do estabelecimento via `_with_est_address`.
- **Fluxo pós-aceite preservado:** A caminho → CHEGUEI COM OFF360 → código 4 díg → Entregue.
- **Testes:** backend script 14/14 PASS; frontend iteration_31 100% (7/7) após guard defensivo em `createNew` (initial state/`.trim()`). Dados QA (QAWAP_/QAWA_) removidos (0 residuais). NÃO publicado em produção.
- **Vínculo por WhatsApp/e-mail (2026-06):** `merchant_create_order` normaliza o telefone informado (`_norm_phone_core`: remove +55, DDD extra, espaços, traços, parênteses) e casa por sufixo ignorando separadores (`\D*`), além de e-mail exato. Se achar conta OFF360 → salva `consumer_id` e o pedido aparece no app do cliente com acompanhamento/bolinhas e o MESMO código de 4 dígitos que o entregador valida. Se não achar → mantém guest (código exibido ao empresário). Campo relabelado: "WhatsApp ou e-mail do cliente OFF360 (opcional)". Teste E2E: 7/7 PASS (e-mail, telefone puro, +55 (19) 98888-7777, "19 98888-7777", guest, código idêntico, pedido no app do consumidor).

## Correção: endereço estruturado do estabelecimento + investigação do código (2026-06 — Preview)
- **Endereço estruturado (retrocompatível):** `establishments` agora tem `street`, `number`, `complement` (além de `neighborhood`, `city` e do legado `address`). `NewEstablishment`/`EstUpdate` aceitam os novos campos; `_is_complete` aceita `street` ou `address`. Frontend `Establishment.js`: campos separados Rua/Logradouro + Nº (lado a lado), Bairro, Cidade, Complemento (est-street/est-number/est-neighborhood/est-city/est-complement); `save()` mantém o `address` legado sincronizado. Estabelecimentos antigos (só `address`) continuam funcionando (o campo Rua exibe o valor legado).
- **Endereço para o entregador:** `routes_delivery._with_est_address()` anexa `establishment_address` (street/number/neighborhood/city/complement/legacy) às respostas de `/deliverer/orders/available` e `/deliverer/orders?scope=`. `Deliverer.js` `AddressBlock` (d-address) exibe "Onde buscar o pedido" + botão "Como chegar" (d-maps-link → google.com/maps, sem dependências). Visível na oferta e em "Em andamento".
- **Bug do código de 4 dígitos:** investigado a fundo. Consumidor e entregador usam o MESMO campo `validation_code` do MESMO pedido; comparação por string com `.strip().upper()` (zeros à esquerda preservados). Reproduzido via script em ambos os fluxos (consumidor cria / empresário cria) → conclui "delivered"; e via UI (iteration_30) → código errado rejeitado, código correto conclui para "Entregue". **NÃO reproduzível no Preview.** Provável origem: ambiente de PRODUÇÃO com código antigo (as correções recentes vivem só no Preview até um novo deploy).
- **Testes:** backend script ALL PASS; frontend iteration_30 100% (10/10). Dados QA (QAADR_/QAADDR_) removidos (0 residuais). NÃO publicado em produção.

## Aviso de "Novo pedido OFF360" — Empresário (2026-06 — implementado e testado, Preview)
- **Frontend only, global no `layouts/MerchantLayout.js`.** Detecta pedidos do CONSUMIDOR (status `new`) via `GET /merchant/orders?establishment_id=all` (poll 8s). "Novo/não visto" = status `new` e id fora do conjunto `seen` (localStorage `off360_merchant_seen_orders`).
- Banner `m-neworder-banner` (🔔 Novo pedido OFF360 + estabelecimento + consumidor + tipo + Pedido nº + botão `m-neworder-ver` "VER PEDIDO"). Badge numérico `m-orders-new-badge` no item de nav "Pedidos" e `m-more-new-badge` no botão "Mais" (mobile) — visível sem entrar em Pedidos.
- **Som curto one-shot** (`lib/merchantAlert.js`, Web Audio API, 2 toques ~0.6s, NÃO em loop): toca só quando o contador de novos aumenta após o 1º carregamento e o áudio está habilitado. Botão `m-enable-sound` (política de autoplay) → `m-sound-active`; preferência em localStorage `off360_merchant_sound`.
- Ao abrir `/merchant/orders`, os novos viram "vistos" (badge zera, som para, não reaparecem). "VER PEDIDO" seleciona o estabelecimento do pedido e navega. Pedido criado pelo próprio empresário (status `ready`/`preparing`) NÃO dispara o aviso.
- **Testes:** iteration_29 — 24/25 PASS (mobile 390x844). Único ponto: após *hard reload*, o navegador exige novo gesto para retomar o áudio (botão "Ativar" reaparece, 1 toque re-ativa) — limitação real de autoplay, não é bug; banner/badge seguem funcionando. Dados QA removidos (0 residuais). Sem push com app fechado. NÃO publicado em produção.

## Alerta Sonoro de Nova Entrega — Entregador (2026-06 — implementado e testado, Preview)
- **Frontend only.** `lib/deliveryAlert.js`: controlador ÚNICO via Web Audio API (sem arquivos de áudio, sem libs). Padrão: 3 toques (~2s cada, gap 250ms) → pausa 5s → repete enquanto houver oferta pendente não silenciada. `unlock()/start()/stop()/isPlaying()/isRunning()`. Respeita autoplay (só toca após gesto).
- **`pages/deliverer/Deliverer.js`:** query `available` agora sempre ativa (detecta ofertas em qualquer aba). Banner `d-new-offer-banner` (🛵 NOVA ENTREGA OFF360 + contagem + botão Ver + Parar som). Botão `d-enable-sound` (🔔 Ativar alertas) → `d-sound-active`; preferência salva em localStorage `off360_deliverer_sound`. Badge numérico na aba Nova entrega (`d-new-badge`). Cards com tipo (`d-scope-<id>`: Loja vinculada / Entrega externa). `d-stop-sound` só aparece enquanto tocando; silencia sem aceitar/recusar (mutedIdsRef). Aceitar/Recusar param o som imediatamente; 409 não reinicia som; oferta some quando deixa de estar disponível → som para.
- **Testes:** iteration_28 — 29/30 comportamentos observáveis PASS (áudio inicializou no Chromium headless, `d-stop-sound` observável, sem erros de console). A "1 falha" é sobre elegibilidade (entregador vinculado ativo também vê ofertas `external`) — comportamento PRÉ-EXISTENTE da regra own/external, mantido intencionalmente por instrução do usuário; NÃO é bug do alerta sonoro. Dados/scripts QA removidos (0 residuais). NÃO publicado em produção.
- **Limitação real (documentada):** navegadores exigem gesto do usuário para liberar áudio (política de autoplay) — por isso o botão "Ativar alertas sonoros"; se bloqueado, banner/badge/botões continuam funcionando sem quebrar. NÃO há push/som com app fechado ou aba em segundo plano nesta etapa (só funciona com a plataforma aberta/ativa e navegador permitindo).

## Backlog (não iniciar sem concluir MVP)
- P1: Integração de pagamento real (Pix/cartão) com ativação automática por webhook.
- P1: Moderação automática de IMAGEM/vídeo via serviço externo (arquitetura já preparada; image_checked=False).
- P1: Lógica de sorteios (acúmulo + sorteio de ganhador).
- P2: Push notifications; export CSV/PDF; galeria; geolocalização com distância.

## Test Credentials
Ver /app/memory/test_credentials.md
