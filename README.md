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

## Próximos passos sugeridos

- Autenticação (login da Inêz / equipe)
- Integração WhatsApp lendo a capacidade/lista de espera das turmas
- Lembrete automático de aula e relatórios financeiros
- Deploy (a estrutura backend/frontend já está pronta para isso)
