# OFF360 / 360Taxi — PRD

## Problem statement
Plataforma OFF360 (React PWA + FastAPI + MongoDB) com módulos de delivery, estabelecimentos, sorteios e 360Taxi. Foco atual: validação de motoristas via Google Document AI + selfie ao vivo, e gestão de motoristas no painel admin.

## Personas
- Admin: gerencia empresários, consumidores, motoristas 360Taxi.
- Merchant (empresário), Consumer, Deliverer/Motorista (role="deliverer").

## Implementado (recente)
- 2026-09-12: **360Taxi — categorias de carro (Basic/Select/Premium) + tarifas por categoria + mapa aprimorado** — removida opção Moto; agora 3 categorias de carro com ícone de carro preto. Passageiro: após "Calcular valor", vê as 3 categorias com preços calculados e clica para escolher (`pages/consumer/Taxi.js`). Distribuição: Basic/Select só veem corridas da própria categoria; Premium vê e aceita todas (`driver_offers` em `routes_taxi.py`). Admin: tarifas por categoria com 4 campos (tarifa base, valor até 2km, valor por km adicional, valor por minuto) em `pages/admin/Settings.js` → salvo em `settings.taxi_categories`. Mapa da corrida (motorista e passageiro) ampliado (alturas 300/460) e mais claro (estilo LIGHT), com ícone de carro preto bem definido (`GoogleTrackMap.js`, `RouteMap.js`). Cadastro/perfil do motorista passam a usar `category`. Testado por curl (quote retorna 3 categorias; PUT/GET settings OK) e screenshot.
- 2026-09-12: **PWA + banner de instalação** — manifest.json (standalone, ícones), service-worker.js e meta tags iOS (apple-touch-icon, apple-mobile-web-app-capable) já existiam; adicionado componente `components/PWAInstallPrompt.js` montado no App.js: no Android usa `beforeinstallprompt` → banner inferior com botão "Instalar o OFF360"; no iOS mostra pop-up com instruções ilustradas (Compartilhar → Adicionar à Tela de Início). Aparece a cada visita enquanto não instalado; some automaticamente em modo standalone/após instalar. Testado por screenshot (pop-up iOS OK) — sem testes automáticos.
- 2026-09-12: **Pagamento completo no 360Taxi (Mercado Pago Marketplace/OAuth)** — motorista conecta a própria conta MP (OAuth, obrigatório para ficar online); ao fim da corrida o passageiro escolhe Pix / Cartão / Dinheiro. Pix e cartão são cobrados com o token OAuth do motorista (dinheiro cai direto na conta dele, comissão 0). Cartão salvo no perfil do passageiro (Customer/Cards) + CVV no fim da corrida. Dinheiro confirmado manualmente pelo motorista. Confirmação por webhook (`external_reference` `ride:{id}:pix|card`). Mensagens finais: passageiro "Muito obrigado por andar, [motorista]! Volte sempre. 360taxi.", motorista "Valor recebido com sucesso! Vamos para a próxima!". Arquivos: `backend/mp.py` (OAuth+mp_request), `backend/routes_taxi_pay.py` (novo), `backend/routes_payments.py` (webhook estende para corridas), `backend/routes_taxi.py` (gating online + mp_connected + /complete pending), `frontend/src/lib/mpSdk.js`, `components/taxi/TaxiPayment.js`, `components/taxi/DriverRidePayment.js`, `pages/consumer/Taxi.js`, `components/deliverer/TaxiDriver.js`. .env: MP_CLIENT_ID/MP_CLIENT_SECRET/MP_REDIRECT_URI.
  - STATUS: Backend validado por curl (online bloqueado sem MP=403; mp/connect gera URL de autorização). Fluxo OAuth completo + Pix/cartão em sandbox PENDENTE de teste — requer Client Secret CORRETO (usuário enviou Secret = Client ID por engano) e autorização de um vendedor de teste MP.
- 2026-09-12: **Ajustes 360Taxi no painel do motorista** — (1) status Online/Offline com badge visível + switch; (2) todas as corridas de teste excluídas (`taxi_rides` esvaziada, 60 removidas); (3) ícone de sino rotulado "Vibrar ao receber corrida" com estado Ligado/Desligado; (4) vibração para imediatamente ao arrastar corrida (swipe) e ao esvaziar a lista (outro motorista aceitou), retorna só em nova corrida pendente. Arquivos: `components/deliverer/TaxiDriver.js`, `lib/taxiVibrate.js`. Testado via screenshot + curl.
- 2026-09-12: **Exclusão de motorista no painel admin** — endpoint `DELETE /api/taxi/admin/drivers/{did}` remove usuário + rides + favoritos + notificações + login_attempts, liberando e-mail/CPF para novo cadastro. Frontend com botão lixeira + AlertDialog de confirmação em `pages/admin/TaxiDrivers.js`. Testado via curl (delete → re-registro com mesmo e-mail OK) e screenshot.
- Fundação Google Document AI (`docai.py`), credenciais no .env, endpoint `/api/taxi/documents/analyze` (regras CNH/EAR/validade, antecedentes, veículo, suspeito).
- Mercado Pago assinatura motoristas, Google Maps autocomplete/tracking, Resend lembretes.

## Backlog (P0 pendente)
- **Concluir integração Document AI no fluxo** (aguardando confirmação do plano com usuário):
  - Backend: campo selfie obrigatória no register; `/taxi/admin/drivers` retornar `taxi_docs` + selfie.
  - Frontend TaxiRegister: upload dos 3 docs (CNH, antecedentes, veículo) chamando análise; selfie AO VIVO câmera-only bloqueando galeria (msg exata de fraude).
  - Admin TaxiDrivers: exibir selfie + status por doc (Aprovado/Vencido/Irregular/Suspeito).

## Notas
- Testes automáticos PROIBIDOS pelo usuário — usar apenas curl + screenshot.
- Trabalhar apenas no Preview; produção (off360.com.br) requer redeploy.
