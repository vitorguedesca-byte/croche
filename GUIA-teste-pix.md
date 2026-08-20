# Pix no Fios que Curam — o que está pronto e como testar

Roteiro para validar junto com a Inêz. Cobre tudo que existe hoje de Pix no
sistema: onde fica cada coisa, o que esperar em cada passo e o que ainda **não**
está pronto.

Última atualização: 19/08/2026.

---

## 0. Antes de começar (sem isto, nada gera Pix)

O código está pronto, mas depende de configuração. Enquanto faltar qualquer item
desta lista, o sistema continua funcionando normalmente — só registra as
cobranças **sem código Pix**, sem erro visível na tela.

| # | O que fazer | Onde |
|---|---|---|
| 1 | Preencher as variáveis `SICREDI_*` | `backend/.env` |
| 2 | Colocar certificado e chave privada em PEM | `backend/certs/` |
| 3 | Aplicar a migration da validade do Pix | `aplicar-migration-pix-mensalidade.bat` |
| 4 | Cadastrar o webhook no Sicredi (uma vez só) | terminal |
| 5 | Recompilar o frontend | `frontend/` → `npm run build` |
| 6 | Reiniciar o backend | — |

### 1. Variáveis do `.env`

Hoje o `backend/.env` ainda tem as variáveis da **Cora**. Nenhuma `SICREDI_*`.
Precisa das seis:

```
SICREDI_ENV=prod
SICREDI_CLIENT_ID=...
SICREDI_CLIENT_SECRET=...
SICREDI_PIX_KEY=...          # chave da conta dona do certificado
SICREDI_CERT_PATH=./certs/certificate.pem
SICREDI_KEY_PATH=./certs/private-key.key
SICREDI_WEBHOOK_URL=https://fiosquecuram.com.br/api/sicredi/webhook
```

A `SICREDI_PIX_KEY` precisa ser da **mesma conta** que emitiu o certificado. Se
não bater, toda cobrança falha com erro 403.

### 2. Certificado

Se o Sicredi entregou em `.cer` (formato DER), converta:

```
openssl x509 -inform der -in cert.cer -out certificate.pem
```

A chave privada **não pode ter senha**.

### 3. Migration

Rode `aplicar-migration-pix-mensalidade.bat` na raiz do projeto. Ele cria a
coluna `Invoice.pixExpiresOn`, que guarda até quando cada código Pix é pagável.
Sem ela o portal não sabe se o QR salvo ainda funciona.

### 4. Webhook

```
cd backend
node --env-file=.env scripts/registrar-webhook-sicredi.mjs            # consulta
node --env-file=.env scripts/registrar-webhook-sicredi.mjs --gravar   # cadastra
```

Sem webhook, o pagamento **não dá baixa sozinho** — a Inêz teria que marcar tudo
como pago na mão.

O servidor precisa responder em HTTPS na porta 443 com certificado de autoridade
pública (Let's Encrypt serve).

### ✅ Como saber se a configuração está correta

Não precisa esperar uma cobrança real. No painel, abra qualquer marcação não paga
e clique em **💠 Gerar cobrança Pix**:

- **Deu certo** → aparece o código copia-e-cola na hora.
- **Deu errado** → a mensagem de erro diz exatamente qual variável está faltando.
  Exemplo: `Sicredi não configurado no servidor — falta: SICREDI_CLIENT_ID, SICREDI_PIX_KEY.`

Essa mensagem é a forma mais rápida de diagnosticar. Use antes de qualquer outro teste.

---

## 1. Mapa: onde está cada coisa

### No painel da Inêz

| Onde | O que tem |
|---|---|
| **📅 Mensalistas** | A tela principal de cobrança. Tabela de todos os mensalistas do mês, com valor, vencimento e status. Botões: **Gerar boletos do mês**, **Gerar boleto** (individual), **💠 Pix** (copia o código), **✓ Marcar pago**. Cards no topo: Recebido, A receber, Sem boleto, Previsto no mês. Dá para navegar entre meses com as setas. |
| **👩 Alunos → perfil → aba 🧾 Mensalidades** | Histórico mês a mês daquela aluna, desde a matrícula. Mostra pago / em aberto / não gerado. Total pago e total em aberto no topo. |
| **📝 Marcações** ou **📅 Agenda** → clicar numa aula | Modal "Gerir marcação". Se a aula não está paga, aparece **💠 Gerar cobrança Pix** — é o Pix da aula avulsa. Depois de gerado, tem **📋 Copiar Pix** e **Enviar no WhatsApp** (manda o código direto para a aluna). |
| **⚙️ Configurações** | Campos **Chave Pix** e **Nome do recebedor**. Atenção: isso **não** é o que gera as cobranças automáticas — é só o texto de recado que a aluna vê quando o Pix automático não está disponível. |
| **👩 Alunos → editar aluna → Dia de vencimento** | Define o `billingDay` individual. Se deixar em "Dia X — padrão do sistema", usa o padrão. |

### No portal da aluna

| Onde | O que tem |
|---|---|
| **Cartão "💠 Minha mensalidade"** | Novo. Aparece logo abaixo do cartão de continuar/reposição. Traz competência, valor, vencimento, selo de status, QR Code grande, copia-e-cola, botão de comprovante no WhatsApp e o histórico das mensalidades pagas. |
| **Aula avulsa → "Pagar reserva"** | Tela de pagamento da aula, com QR e copia-e-cola. Já existia. |
| **Fluxo "Quero continuar"** | Escolha do plano → 1ª aula oficial → QR da primeira mensalidade. Já existia. |

### No site público

| Onde | O que tem |
|---|---|
| **Agendar aula experimental** | Ao final do agendamento, gera o Pix da taxa de matrícula. |

---

## 2. Roteiro de teste

Sugestão: fazer nesta ordem. Cada cenário depende do anterior estar funcionando.

### Cenário A — Pix de aula avulsa (o mais simples)

1. Painel → **Marcações** → clicar numa aula com pagamento pendente.
2. Clicar em **💠 Gerar cobrança Pix**.
3. **Esperado:** o código copia-e-cola aparece na tela.
4. Clicar em **Enviar no WhatsApp** e conferir se a mensagem sai com o código.
5. Pagar de verdade um valor pequeno (dá para editar o valor da marcação antes).
6. **Esperado:** em até alguns segundos, a marcação vira **Confirmada** sozinha.
   Se não virar, o webhook não está cadastrado ou o servidor não está acessível.

> Clicar em "Gerar cobrança Pix" duas vezes **não** cria duas cobranças — o
> sistema reaproveita a mesma. Pode testar à vontade.

### Cenário B — Mensalidade gerada na mão

1. Painel → **Mensalistas**.
2. Escolher uma aluna com status **não gerado** e clicar em **🧾 Gerar boleto**.
3. **Esperado:** a linha vira **⏳ pendente · vence DD/MM** e aparece o botão **💠 Pix**.
4. Clicar em **💠 Pix** → o código vai para a área de transferência.
5. Pagar.
6. **Esperado:** a linha vira **✓ pago em DD/MM** sozinha, e os cards do topo se
   atualizam (Recebido sobe, A receber desce).

> **Aluna sem CPF dá erro de propósito.** A mensagem é clara: "Cadastre o CPF do
> aluno antes de gerar a cobrança." O Sicredi exige CPF do pagador. Na tabela de
> Mensalistas, quem está sem CPF aparece com **⚠ sem CPF** embaixo do nome —
> vale conferir isso antes de gerar em lote.

### Cenário C — Mensalidade no portal da aluna (o principal)

1. Com a mensalidade do Cenário B em aberto, abrir o portal da aluna
   (CPF + PIN) — pode ser no celular mesmo.
2. **Esperado:** o cartão **💠 Minha mensalidade** aparece com o QR Code grande,
   o valor e o selo "Em aberto — faltam N dias para o vencimento".
3. Apontar a câmera do celular no QR e pagar.
4. **Esperado:** sem tocar em nada, em até ~20 segundos o cartão muda para
   "Você está em dia" e a mensalidade some da lista de abertas.

Esse é o teste mais importante do conjunto — é o que a aluna vai fazer todo mês.

### Cenário D — Geração automática com 5 dias de antecedência

Não dá para testar em tempo real sem esperar o mês virar. Duas formas:

- **Rápida:** mudar o dia de vencimento de uma aluna (Alunos → editar → Dia de
  vencimento) para um dia que esteja dentro dos próximos 5 dias, e reiniciar o
  backend. A rodada roda 15 segundos depois de subir.
- **Real:** deixar rodando e conferir no dia. A rodada acontece de hora em hora,
  uma vez por dia.

**Esperado:** a mensalidade aparece sozinha em Mensalistas e no portal, sem
ninguém clicar em nada. No log do backend sai:
`[mensalidade] N boleto(s) do mês gerados automaticamente.`

> Só gera para mensalista com status **ativo**. Aluna cancelada não recebe
> cobrança nova.

### Cenário E — QR vencido e reemissão

1. No banco, colocar o `dueDate` e o `pixExpiresOn` de uma mensalidade pendente
   numa data passada. (Ou esperar uma vencer de verdade.)
2. Abrir o portal da aluna.
3. **Esperado:** em vez do QR, aparece o aviso "O código Pix desta mensalidade
   expirou no vencimento" e o botão **💠 Gerar código Pix**, mais o selo
   vermelho "⚠️ Em atraso há N dias".
4. Clicar no botão.
5. **Esperado:** um QR novo aparece, válido por 3 dias.
6. Clicar várias vezes seguidas.
7. **Esperado:** o mesmo código é reaproveitado — não gera cobrança nova a cada
   clique.

> Detalhe importante para explicar à Inêz: reemitir o Pix **não** tira a
> mensalidade do atraso. A data de vencimento continua a mesma, então a aluna
> segue sem direito a reposição até pagar. Só o prazo do código é renovado.

### Cenário F — Matrícula completa (ponta a ponta)

1. No site, agendar uma aula experimental com um CPF novo.
2. **Esperado:** Pix da taxa de matrícula no fim do agendamento.
3. Pagar.
4. Entrar no portal com aquele CPF → **Quero continuar** → escolher plano →
   escolher a 1ª aula oficial → confirmar.
5. **Esperado:** QR da primeira mensalidade na tela, e a aluna vira mensalista.
6. Pagar.
7. **Esperado:** aparece no painel em Mensalistas como paga.

---

## 3. O que ainda NÃO está pronto

Importante alinhar isso com a Inêz antes do teste, para não virar frustração.

| Item | Situação |
|---|---|
| **Multa e juros por atraso** | Não existe. Quem paga atrasado paga o valor cheio. Implementar exige migrar da cobrança imediata (`cob`) para a cobrança com vencimento (`cobv`) no Sicredi. |
| **Pix Automático (débito recorrente)** | Não existe. A aluna paga o QR todo mês; não há nada para ela "autorizar" no banco. O Sicredi oferece, mas exige contratar a modalidade na adesão e um desenvolvimento bem maior. |
| **Pagamento no cartão** | Não existe no sistema. O portal manda a aluna falar com a Inêz no WhatsApp, que envia um link por fora. |
| **Boleto (código de barras)** | Não existe. É Pix puro — a API não gera PDF nem linha digitável. O campo `boletoUrl` no banco é resquício da Cora antiga. |
| **Cobrança retroativa** | O sistema não gera boleto de meses passados automaticamente. Em Mensalistas, meses anteriores sem boleto ficam como "não gerado" e o botão de gerar fica desabilitado fora do mês atual. |
| **Dia de vencimento global** | Não é editável pela tela de Configurações (o cartão foi removido). O que dá para mudar é o dia **por aluna**, no cadastro dela. Mudar o padrão do sistema exige mexer no banco. |
| **Aviso de mensalidade por WhatsApp** | Não é automático. A mensalidade aparece no portal, mas ninguém é avisado. Se quiser, dá para acoplar ao WhatsApp oficial. |

---

## 4. Regras que valem explicar à Inêz

- **Cobrança nunca duplica.** O identificador de cada cobrança é derivado da
  aluna e do mês. Clicar em "gerar" de novo devolve sempre a mesma cobrança.
- **A baixa é automática, mas o "Marcar pago" continua existindo** — serve para
  quem pagou por fora (dinheiro, transferência, cartão).
- **O código Pix expira no vencimento.** É por isso que existe o botão de gerar
  um novo no portal.
- **A mensalidade em atraso bloqueia a reposição.** Já era assim; o Pix não mudou
  essa regra.
- **Se o Sicredi estiver fora do ar** na hora de gerar, a mensalidade é criada
  mesmo assim, só que sem código Pix. O botão no portal resolve depois.

---

## 5. Referência técnica

### Endpoints

| Método | Rota | Para quê |
|---|---|---|
| POST | `/api/bookings/:id/invoice` | Pix da aula avulsa |
| POST | `/api/clients/:id/invoice` | Mensalidade de uma aluna |
| POST | `/api/invoices/gerar-mes` | Mensalidades de todos os mensalistas ativos |
| POST | `/api/invoices/:id/pay` | Marcar pago na mão |
| POST | `/api/invoices/:id/cancel` | Cancelar mensalidade |
| POST | `/api/portal/:key/invoice/:id/pix` | Pix pagável no portal (reemite se venceu) |
| POST | `/api/sicredi/webhook` e `/webhook/pix` | Aviso de Pix recebido |
| GET | `/api/sicredi/verificar/:txid` | Consulta manual de pagamento |

### Arquivos

- `backend/src/sicredi.js` — comunicação com o banco
- `backend/src/server.js` — mensalidades, webhook, portal
- `frontend/src/ClientPortal.jsx` — cartão da mensalidade (`MensalidadeCard`)
- `frontend/src/views.jsx` — tela Mensalistas
- `frontend/src/modals.jsx` — Pix da aula avulsa e aba Mensalidades
- `frontend/src/PixQR.jsx` — desenho do QR

### Como a confirmação funciona

O webhook do Sicredi é só um **gatilho**. O sistema ignora o valor que vem no
aviso e consulta a cobrança na API para confirmar. É isso que impede alguém de
forjar um pagamento chamando a URL do webhook.
