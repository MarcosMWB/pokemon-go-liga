# Pokémon GO Liga

Aplicação web para organizar uma liga comunitária de Pokémon GO: perfis, equipes, ginásios, disputas, desafios e trocas. A interface usa Next.js; autenticação e dados usam Firebase Authentication e Cloud Firestore. Cloud Functions executam tarefas agendadas e processamento de eventos.

## Requisitos

- Node.js 20 ou superior (as Firebase Functions declaram runtime Node 20).
- npm.
- Projeto Firebase com Authentication por e-mail/senha e Firestore configurados.

## Configuração local

Crie `.env.local` na raiz e configure as variáveis públicas do Firebase usadas por `src/lib/firebase.ts`:

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_SUPPORT_EMAIL=...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Para rotas que usam Firebase Admin, configure Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`) ou as variáveis de service account esperadas em `src/lib/firebaseAdmin.ts`. Nunca publique credenciais de service account nem as inclua em variáveis `NEXT_PUBLIC_`.

Instale dependências e inicie o Next.js:

```bash
npm install
npm run dev
```

A aplicação fica disponível em `http://localhost:3000`. Configure as regras e índices do Firestore antes de usar os fluxos que dependem do banco.

## Estrutura principal

- `src/app`: páginas e rotas da aplicação.
- `src/components`: componentes reutilizados.
- `src/lib`: inicialização do Firebase e serviços de domínio.
- `functions`: Cloud Functions do projeto Firebase principal.
- `liga-ro`: código de uma segunda codebase de Functions.
- `firestore.rules` e `firestore.indexes.json`: segurança e índices do Firestore.
- `scripts/backfill.ts`: ferramenta de backfill de dados.

## Comandos úteis

- `npm run dev`: servidor local Next.js.
- `npm run build`: build de produção Next.js.
- `npm run backfill`: script de backfill (requer credenciais Firebase Admin apropriadas).
- `npm --prefix functions run build`: compila a codebase principal de Cloud Functions.
- `npm --prefix liga-ro run build`: compila a codebase `liga-ro`.

O `firebase.json` configura o Firebase Hosting para redirecionar tráfego ao site hospedado no Vercel. As Functions e as regras do Firestore continuam sendo implantadas pelo Firebase CLI, conforme a configuração do projeto.
