# Fios que Curam — Guia de Integrações (WhatsApp + Pagamentos)

Este guia explica **como plugar, no futuro**, a automação do WhatsApp e o recebimento de pagamentos ao sistema que já está pronto. Hoje o protótipo funciona 100% no modo manual — exatamente como vocês pediram — e já deixa os "ganchos" preparados para a automação quando você decidir.

---

## 1. O que já está pronto no sistema (modo manual)

- **Agenda** por unidade (Ipatinga / Timóteo), com horários livres e ocupados.
- **Marcações** com o fluxo: `Aguardando pagamento` → `Confirmada` → `Concluída` (ou `Cancelada`).
- **Regra do negócio** já aplicada: a aula só vira *Confirmada* na agenda **depois** que o pagamento é registrado.
- **Recebimentos**: total do mês, a receber e histórico, com botão "Confirmar pago".
- **Clientes (CRM)** com etiquetas (Em atendimento, Em marcação, Aluna ativa, etc.).
- **Página de marcação do cliente** (modo "Ver como cliente"): escolhe unidade → horário → deixa os dados → vira uma reserva *Aguardando pagamento*.
- **Botões de WhatsApp** em todos os lugares: cada cliente/marcação já abre uma conversa pronta no WhatsApp (link `wa.me`) com mensagem preenchida. É o ponto onde a API entra depois.

> Em resumo: o sistema já organiza tudo. A "automação" é só trocar o passo manual (você clicar/responder) por uma API que faz isso sozinha.

---

## 2. Integração com o WhatsApp — as duas opções

Existem dois caminhos. A escolha depende de quanto vocês querem automatizar e de orçamento.

### Opção A — API Oficial da Meta (WhatsApp Business Platform / Cloud API)
É o caminho oficial e robusto. Permite chatbot, respostas automáticas, envio de confirmações e lembretes em escala.

**Prós**
- Oficial, estável, sem risco de bloqueio do número.
- Permite mensagens automáticas e modelos aprovados (lembrete de aula, cobrança da reserva, confirmação).
- Escala bem conforme a escola cresce.

**Contras**
- Exige uma conta no Meta Business + verificação da empresa.
- Mensagens iniciadas pela empresa usam *templates* aprovados pela Meta.
- Tem **custo por conversa** e normalmente se contrata via um parceiro (BSP).
- Implantação mais técnica.

**Para quem é:** quando o volume de mensagens crescer e a resposta manual virar gargalo.

### Opção B — Plataforma pronta (mais rápida de começar)
Ferramentas que conectam no WhatsApp e já trazem automações com pouco ou nenhum código. Exemplos comuns no Brasil:

| Ferramenta | Boa para | Observação |
|---|---|---|
| **Z-API / Evolution API** | Conectar o WhatsApp ao sistema rápido | Usa o número via leitura de QR Code; ótimo para automação inicial |
| **ManyChat / outras de chatbot** | Fluxos de atendimento e respostas automáticas | Foco em funis e respostas prontas |
| **n8n / Make (Integromat)** | "Cola" entre WhatsApp, agenda e pagamento | Você desenha o fluxo arrastando blocos |
| **Take Blip / Zenvia** | Operação maior, multicanal | Mais robusto e corporativo |

**Prós:** começa em dias, não semanas; pouco código; já vêm com painéis prontos.
**Contras:** custo de assinatura mensal; algumas usam conexão não-oficial (menor risco hoje, mas é bom saber).

### Recomendação prática
1. **Agora:** seguir manual (o sistema já cobre isso) — custo zero, controle total.
2. **Próximo passo natural:** uma plataforma tipo **n8n + Z-API** para automatizar o básico (confirmação de marcação, lembrete de aula, aviso de pagamento).
3. **Quando escalar:** migrar para a **API Oficial da Meta** via um parceiro (BSP).

---

## 3. Recebimento de pagamentos — do manual ao automático

Hoje é manual: o cliente paga (Pix), manda o comprovante no WhatsApp, e vocês clicam **"Confirmar pago"**. Isso já funciona. Para automatizar:

### Nível 1 — Pix manual (atual)
Chave Pix fixa + confirmação manual no sistema. **Custo:** zero. Simples e suficiente no começo.

### Nível 2 — Cobrança com gateway (recomendado para automatizar)
Plataformas que geram **link de cobrança / Pix com confirmação automática**:

| Gateway | Destaque | Observação |
|---|---|---|
| **Mercado Pago** | Muito usado, fácil, Pix + cartão | Bom custo-benefício, link de pagamento simples |
| **Asaas** | Pensado para serviços/recorrência | Cobrança automática, lembretes, ótimo para mensalidades |
| **PagBank / InfinitePay** | Maquininha + online | Bom se já usam maquininha |
| **Stripe** | Robusto e internacional | Pix no Brasil mais recente; forte em cartão |

**Como fica o fluxo automatizado:**
1. Cliente escolhe o horário na página de marcação → reserva entra como *Aguardando pagamento*.
2. O sistema gera um **link de pagamento** (Pix/cartão) e envia pelo WhatsApp.
3. Cliente paga → o gateway avisa o sistema (webhook) → a reserva vira **Confirmada** sozinha.
4. Aparece automaticamente nos **Recebimentos**.

### Recomendação prática
- **Agora:** Pix manual (já está pronto).
- **Quando quiser automatizar:** **Mercado Pago** (simples) ou **Asaas** (se quiser cobrança recorrente/mensalidade e lembretes automáticos).

---

## 4. Onde cada API vai "plugar" no sistema

O sistema já está desenhado para receber as integrações nestes pontos:

- **Botões "Cobrar" / "WhatsApp"** → hoje abrem o `wa.me`. Depois, a API envia a mensagem automaticamente (e o template de cobrança com o link de pagamento).
- **Botão "Confirmar pago"** → hoje é um clique. Depois, o **webhook do gateway** dispara essa mesma ação automaticamente.
- **Página de marcação do cliente** → hoje cria a reserva *Aguardando pagamento*. Depois, já dispara o link de pagamento + mensagem no WhatsApp.

Ou seja: a lógica do negócio não muda — só trocamos o "clique humano" por um "gatilho automático".

---

## 5. Sugestão de roteiro (passo a passo)

1. **Fase 1 — Hoje:** usar o sistema no modo manual. Validar o fluxo com alunas reais por 2–4 semanas.
2. **Fase 2 — Pagamento:** ativar **Mercado Pago/Asaas** para gerar links de cobrança e confirmar pagamento automaticamente.
3. **Fase 3 — WhatsApp:** automatizar confirmações e lembretes com **n8n + Z-API** (ou direto na plataforma escolhida).
4. **Fase 4 — Escala:** migrar para a **API Oficial da Meta** quando o volume justificar.
5. **Fase 5 — Hospedagem:** publicar a landing page e o sistema (ex.: Vercel/Netlify para o site; o sistema com um back-end simples + banco de dados quando sair do protótipo local).

---

### Observação técnica importante
O protótipo atual guarda os dados **no navegador** (localStorage), o que é perfeito para testar. Para uso real com várias pessoas acessando ao mesmo tempo, o próximo passo é colocar um **back-end com banco de dados** (assim a agenda fica compartilhada entre a admin e os clientes em qualquer dispositivo). Isso entra junto da Fase 2/3.
