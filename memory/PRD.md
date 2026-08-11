# OFF 360 — PRD

## Problem Statement
Plataforma web responsiva e instalável (PWA) de economia e fortalecimento do comércio local. Conecta consumidores (por assinatura) a lojas/comércios/prestadores próximos, com descontos, ofertas (stories), validação de compra por QR Code, economia acumulada e bilhetes para sorteios. Três perfis totalmente isolados: Consumidor, Empresário e Administrador OFF 360.

## Architecture
- Backend: FastAPI (modular: core.py, storage.py, routes_auth/common/consumer/merchant/admin.py, seed.py), MongoDB (uuid string ids, `_id`/`password_hash` stripped on read). All routes `/api`-prefixed.
- Auth: JWT (email/WhatsApp + senha), bcrypt, httpOnly cookies + Bearer fallback, brute-force lockout, role-based route guards (require_role). Admin em rota separada `/admin-access`.
- Frontend: React + Tailwind + shadcn, react-query, react-router. Mobile-first PWA (manifest + service worker). Navy #020817 / orange #FF7A00, fonts Outfit/Manrope.
- Integrations: Emergent Object Storage (uploads de fotos/logos/stories). Camera QR via html5-qrcode (+ fallback manual). Google Maps via links. Pagamento: estrutura preparada, preços configuráveis pelo admin (não integrado — por design).

## User Personas
- Consumidor: encontra parceiros, escaneia QR, economiza, acumula bilhetes.
- Empresário/Prestador: valida vendas, publica stories, gerencia estabelecimento e QR Code.
- Administrador OFF 360: visão geral, aprovações, financeiro, assinaturas, sorteios, auditoria.

## Implemented (2026-06)
- Identidade visual OFF 360 (logo oficial: circular no splash/login, símbolo isolado em nav/PWA/favicon, wordmark em painéis). Slogan e frase de apoio.
- Auth JWT 3 perfis + isolamento no backend (403 cross-role). Recuperação de senha.
- Consumidor: Home (saudação, stories 24h, card assinatura, escanear, categorias, ofertas, novos parceiros, resumos), Explorar (busca/filtros/ordenação), Página pública do estabelecimento, Scanner QR (câmera + manual), Fluxo de transação (aguardando → PAGAMENTO CONFIRMADO com animação/relógio), Minha Economia, Sorteios/bilhetes, Notificações, Perfil (upload foto).
- Empresário: Dashboard (métricas próprias + gráfico 7d), Validar vendas (confirmar/recusar em tempo real), Transações (apenas próprias, só 1º nome do consumidor), Meu QR Code (tela cheia + download), Stories (criar/expirar 24h), Meu estabelecimento (edição; desconto exige aprovação admin), Assinatura.
- Admin: Visão geral (indicadores reais), Consumidores (gestão/assinatura), Empresários, Estabelecimentos (aprovação + regen QR), Assinaturas, Financeiro, Transações (cancelar), Categorias, Sorteios (config), Configurações (preços + regra de bilhetes), Auditoria.
- Fraude: código único por transação, token com validade 10min, sem reuso, sem duplicadas, registro de dispositivo/horário; admin pode cancelar.
- Seed de demonstração: 10 categorias, 6 estabelecimentos, stories, transações, consumidor/empresário/admin de teste.
- Testado: backend 23/23 pytest; E2E consumidor/empresário/admin.

## Estabilização (2026-06 — validação e2e dos 3 perfis)
- Scanner: `/api/consumer/scan` bloqueia no momento da leitura quando estabelecimento não está ativo ou sem desconto configurado (400 "Configure o percentual de desconto para liberar as transações."). Verificado.
- Auditoria completa: todos os botões/seletores/formulários dos 3 perfis conectados a endpoints reais. Nenhum elemento apenas-visual encontrado (exceto placeholders de pagamento por design).
- Admin demo `admin@off360.com` restaurado (senha temporária `OffAdmin@Temp1` + troca obrigatória).
- Dados preservados: 17 usuários, 11 estabelecimentos; conta "VETERINÁRIA - DR THAMIRES MARIANE" (Tamires) intacta.
- Testes: backend 15/15 pytest (`test_off360_e2e_stabilization.py`) + UI Playwright 100% dos fluxos (iteration_4.json). Sem bugs funcionais.
- SOMENTE DEMONSTRAÇÃO (por design): gateway de pagamento (ativação manual via admin substitui webhooks); cobrança Pix/cartão "em breve".

## Backlog (próximos)
- P1: Integração de pagamento recorrente (Pix/cartão) quando provedor definido; ativar/vencer assinatura automaticamente.
- P1: Push notifications (estrutura PWA pronta).
- P2: Sorteador de ganhador + resultado; relatórios export CSV/PDF; galeria de fotos do estabelecimento; favoritos na UI; geolocalização com distância real.
- P2: Calendar picker (shadcn) no diálogo de sorteios.

## Test Credentials
Ver /app/memory/test_credentials.md
