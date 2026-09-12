# OFF360 / 360Taxi — PRD

## Problem statement
Plataforma OFF360 (React PWA + FastAPI + MongoDB) com módulos de delivery, estabelecimentos, sorteios e 360Taxi. Foco atual: validação de motoristas via Google Document AI + selfie ao vivo, e gestão de motoristas no painel admin.

## Personas
- Admin: gerencia empresários, consumidores, motoristas 360Taxi.
- Merchant (empresário), Consumer, Deliverer/Motorista (role="deliverer").

## Implementado (recente)
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
