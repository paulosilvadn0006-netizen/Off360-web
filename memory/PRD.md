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

## Backlog (não iniciar sem concluir MVP)
- P1: Integração de pagamento real (Pix/cartão) com ativação automática por webhook.
- P1: Lógica de sorteios (acúmulo + sorteio de ganhador).
- P2: Push notifications; export CSV/PDF; galeria; geolocalização com distância.

## Test Credentials
Ver /app/memory/test_credentials.md
