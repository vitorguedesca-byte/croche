# Fios que Curam — Sistema de Gestão

Aplicação full-stack para gestão das aulas de crochê (agenda por turma, reservas, pagamentos, clientes/CRM, presença e lista de espera).

- **backend/** — API REST em Node + Express + **Prisma** (MySQL)
- **frontend/** — interface em **React + Vite**
- `sistema.html` — protótipo antigo (localStorage), mantido só como referência

---

## Pré-requisitos

- **Node.js 18+** (recomendado 20+)
- **MySQL** rodando em localhost. Três caminhos:
  - **XAMPP / MySQL Workbench / WAMP** já instalado, ou
  - **Docker** (mais fácil): na raiz do projeto rode `docker compose up -d` — ele sobe um MySQL pronto com senha `fios123` e o banco `fios_que_curam` já criado.

Se NÃO usar Docker, crie o banco manualmente uma vez:

```sql
CREATE DATABASE fios_que_curam CHARACTER SET utf8mb4;
```

---

## 1) Backend (API)

```bash
cd backend
cp .env.example .env          # no Windows: copy .env.example .env
```

Abra o `.env` e ajuste a `DATABASE_URL` com os dados do SEU MySQL. Formato:

```
DATABASE_URL="mysql://USUARIO:SENHA@localhost:3306/fios_que_curam"
```

Exemplos:
- XAMPP padrão (root sem senha): `mysql://root:@localhost:3306/fios_que_curam`
- Docker desta pasta: `mysql://root:fios123@localhost:3306/fios_que_curam`

Depois:

```bash
npm install
npx prisma migrate dev --name init   # cria as tabelas e gera o Prisma Client
npm run seed                         # sobe os dados de exemplo
npm run dev                          # inicia a API em http://localhost:4000
```

> A API fica em **http://localhost:4000**. Teste com http://localhost:4000/api/health

## 2) Frontend (interface)

Em **outro terminal**:

```bash
cd frontend
npm install
npm run dev      # abre em http://localhost:5173
```

Pronto! Abra **http://localhost:5173**. O Vite já redireciona as chamadas `/api` para o backend (porta 4000).

- O **painel administrativo** abre direto.
- O botão **"👁 Ver como cliente"** (rodapé do menu) abre a página pública de marcação.

---

## Comandos úteis (backend)

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe a API com auto-reload |
| `npm run seed` | Recria os dados de exemplo (apaga e popula de novo) |
| `npm run studio` | Abre o Prisma Studio (visualizador do banco) |
| `npx prisma migrate dev` | Aplica mudanças no schema ao banco |
| `node --env-file=.env scripts/padronizar-nomes.mjs` | Mostra quais nomes de alunas seriam padronizados (não grava) |
| `node --env-file=.env scripts/padronizar-nomes.mjs --aplicar` | Grava a padronização, em cascata para aulas e lista de espera |

> **Nomes de alunas.** A regra de escrita vive em `backend/src/nomes.js` e é a
> única fonte: o backend aplica em toda entrada de nome (painel, portal,
> WhatsApp, lista de espera) e o script acima arruma o que já está no banco.
> Na raiz, `padronizar-nomes.bat` roda a simulação, mostra a lista e pergunta
> antes de gravar. O script **não adivinha acento que falta** (`Jose` não vira
> `José`) — isso é correção manual na ficha.

## Estrutura

```
croche/
├─ backend/
│  ├─ prisma/schema.prisma   # modelos: Client, Slot, Booking, Waitlist
│  ├─ prisma/seed.js         # dados de exemplo
│  └─ src/server.js          # rotas da API
├─ frontend/
│  └─ src/                   # React (App, views, modais, página do cliente)
├─ docker-compose.yml        # MySQL local opcional
└─ README.md
```

## Segurança do WhatsApp e portal

- Configure `WA_APP_SECRET` com o segredo do aplicativo Meta antes de publicar esta versão. O POST do webhook valida a assinatura sobre o corpo original; sem o segredo, responde 503 e não processa notificações. `WA_VERIFY_TOKEN` continua servindo apenas para a confirmação do GET.
- Alunas com PIN existente continuam usando CPF + PIN. O portal exige sessão própria, com validade de 12 horas, e não usa a sessão administrativa. Sair ou redefinir o PIN revoga o acesso correspondente.
- Para primeiro acesso ou recuperação, a equipe com permissão de editar Alunos usa **Gerar acesso / Redefinir PIN**, confere a identidade da aluna e entrega o código mostrado no painel. Ele vale por 24 horas e um único uso. CPF sozinho não permite criar PIN.
- Sessões e códigos são mantidos na memória do backend, como as sessões administrativas. Reiniciar o processo encerra ambos; após reiniciar, gere outro código se necessário. Esta implementação pressupõe uma única instância do backend.
- As aulas legadas não têm `clientId`: o portal limita consultas e alterações por nome e telefone correspondente. Aulas sem telefone não são atribuídas por nome; cadastros com o mesmo nome e telefone precisam de conferência pela escola.
- Testes locais, sem banco ou integrações reais: `cd backend` e `node --test scripts/portal-security.test.mjs scripts/access.test.mjs`.

## Próximos passos sugeridos

- Autenticação (login da Inêz / equipe)
- Integração WhatsApp lendo a capacidade/lista de espera das turmas
- Lembrete automático de aula e relatórios financeiros
- Deploy (a estrutura backend/frontend já está pronta para isso)
