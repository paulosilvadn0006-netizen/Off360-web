# Auth Testing Playbook (Emergent Google Auth — bridged to existing JWT)

Este app usa auth própria (JWT em cookie httpOnly). O botão "Entrar com Google" usa o Emergent OAuth
apenas para obter e-mail/nome verificados e então emite o NOSSO cookie JWT (mesma sessão do login por e-mail).

## Fluxo
1. Frontend: botão Google → `https://auth.emergentagent.com/?redirect=<origin>/auth/callback?role=<perfil>`
2. Retorno em `/auth/callback#session_id=...` → componente AuthCallback lê o hash
3. Frontend POST `/api/auth/google/session` { session_id, role }
4. Backend chama `https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data` (header X-Session-ID),
   acha/cria usuário por e-mail, emite cookies JWT (create_access_token/refresh) e retorna o usuário
5. Frontend redireciona pela role REAL da conta

## Testes
- Backend session-data é chamado só no backend (nunca no frontend).
- Conta existente por e-mail → reusa role real (ignora a escolhida).
- Conta nova via Google → cria com a role escolhida (consumer/merchant/deliverer).
- `/api/auth/me` deve retornar o usuário após o callback (cookie setado).
- Perfil selecionado no login que não bate com a conta → redireciona pela role real + toast discreto.

## Contas de teste
- Dono/admin: paulo.silva.dn.0006@gmail.com
- Empresário (senha): alex@gmail.com / Test123!
- Google OAuth não usa senha do app.
