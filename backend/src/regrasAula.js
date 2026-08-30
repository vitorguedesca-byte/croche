/* ===================== REGRAS DE MARCAÇÃO DO MENSALISTA =====================
   Combinado com a Inêz em 22/08/2026. Existem dois tipos de mensalista:

   • FIXO   — tem dia e hora fixos; quem monta a agenda dela é a Inêz (em lote).
   • ESCALA — ela mesma marca a aula pelo portal, durante a semana.

   Sobraram DUAS regras, valendo tanto para marcar aula normal quanto para
   marcar reposição (remarcação):

   1. O teto do plano: 1x ou 2x aulas por semana, conforme o contratado.
   2. Só na escala: a aluna marca a próxima aula NO DIA da aula dela — ou seja,
      a janela de marcação só abre nos dias em que ela tem aula. Quantas aulas
      ela marca nesse dia é com ela; o que a regra prende é o dia.

   DUAS REGRAS DE DATA/HORA FORAM REMOVIDAS, e pelo mesmo motivo — as duas
   diziam que parte da grade da escola não fazia parte do plano:

   • "horário a partir das 18:00", removida em 26/08/2026: a grade tinha 213
     turmas de 18:00 as 20:00, e das 141 mensalistas ativas exatamente UMA
     recebeu `podeNoite`.
   • "sábado", removida em 30/08/2026: a grade tem 180 turmas de sábado e 17
     alunas fazendo 1.066 aulas aos sábados — e ZERO delas com `podeSabado`.

   A causa é a mesma nas duas, e vale como aviso para a próxima: o direito
   herdado foi deduzido da tabela `Booking`, que tinha 37 linhas no dia do
   backfill. **Deduzir direito adquirido de uma tabela quase vazia devolve a
   resposta errada com cara de certa** — e o efeito prático era a replicação em
   lote pular essas datas em silêncio.

   As colunas `podeSabado` e `podeNoite` continuam no banco (são históricas e
   não custam nada), mas não governam mais nada.

   Alunas avulsas, aula experimental e quem está em `firstClass` não passam por
   aqui — a regra é do plano de mensalista.

   Este módulo é PURO de propósito (não toca no banco): quem chama traz as aulas
   ativas da aluna. Existe um espelho reduzido em frontend/src/helpers.js para o
   painel conseguir avisar antes de mandar a requisição. Ao mexer numa regra
   aqui, mexa lá também. */

// Marca que o backend põe no paymentMethod das aulas DO PLANO. É por ela que o
// teto semanal separa o que conta ("Mensalista") do que é aula à parte
// ("Reposição", "Avulsa", "1ª mensalidade") e por isso não ocupa vaga da semana.
export const PGTO_PLANO = "Mensalista";

/* Horário sempre em 'HH:MM', exatamente 5 caracteres.

   O `time` do horário e da reserva é texto livre no banco, e nem toda rota
   normalizava na gravação — daí aparecerem valores como "9:00", "09:00:00" ou
   até a faixa inteira ("09:00 às 11:00"). Ordenação e comparação de hora
   sobrevivem a isso, mas MakeupCredit.originTime é VARCHAR(5): passar de 5
   caracteres derruba a criação do crédito de reposição com "value too long".

   Devolve "" quando não há hora reconhecível — quem grava decide o que fazer. */
export function hhmm(t) {
  const m = String(t || "").match(/(\d{1,2}):(\d{2})/);
  return m ? `${String(m[1]).padStart(2, "0")}:${m[2]}` : "";
}

// "fixo" | "escala" | null (não é mensalista)
export function tipoMensalista(client) {
  if (!client || client.plan !== "mensalista") return null;
  return client.mensalistaTipo === "escala" ? "escala" : "fixo";
}

export const TIPO_LABEL = { fixo: "Mensalista fixo", escala: "Mensalista escala" };

/* Janela de marcação da escala.
   `aulasAtivas` são as aulas não canceladas da aluna (basta as de hoje em
   diante). Sem nenhuma aula em aberto a janela fica ABERTA — senão a aluna que
   acabou de entrar, ou que liberou a última aula, ficaria travada para sempre
   sem ter como marcar a primeira. */
export function janelaEscala(aulasAtivas, hoje) {
  const futuras = (aulasAtivas || [])
    .filter((b) => b && b.status !== "cancelada" && b.date >= hoje)
    .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  if (futuras.some((b) => b.date === hoje)) return { aberta: true, proxima: null, motivo: "" };
  if (!futuras.length) return { aberta: true, proxima: null, motivo: "" };
  const prox = futuras[0];
  return {
    aberta: false,
    proxima: prox,
    motivo: `Na escala, a próxima aula é marcada no dia da sua aula. Sua próxima é ${diaBR(prox.date)}` +
      (prox.time ? ` às ${prox.time}` : "") + " — marque por lá. 💚",
  };
}

// 'YYYY-MM-DD' → 'sáb, 22/08' (curto, para caber nas mensagens)
function diaBR(date) {
  const m = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date;
  const dow = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][
    new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()
  ];
  return `${dow}, ${m[3]}/${m[2]}`;
}

/* ---------- teto de aulas por semana (o plano 1x ou 2x contratado) ----------
   A semana vai de SEGUNDA a domingo, igual à agenda do painel. Só as aulas do
   plano ocupam vaga: reposição e aula extra são justamente aulas ALÉM do plano
   e não podem consumir o que a aluna já paga. Quem não tem weeklyFreq (plano
   antigo) não tem teto. */

// 'YYYY-MM-DD' → segunda-feira daquela semana, em UTC (sem fuso atrapalhar)
export function segundaDaSemana(date) {
  const m = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // domingo (0) volta 6 dias
  return d.toISOString().slice(0, 10);
}
export const mesmaSemana = (a, b) => segundaDaSemana(a) === segundaDaSemana(b);
// Só conta como aula do plano o que o backend marcou como "Mensalista".
export const contaNoTeto = (b) => b && b.status !== "cancelada" && b.paymentMethod === PGTO_PLANO;

/* Quantas aulas do plano a aluna já tem na semana da data alvo, e qual é o teto.
   `aulasAtivas` são as aulas dela (canceladas podem vir junto, são filtradas). */
/* Quantas aulas por semana o plano dela dá NAQUELA data.

   Normalmente é só `weeklyFreq`. Mas quando o plano foi trocado, a troca vale a
   partir de uma competência ('YYYY-MM' em `weeklyFreqDesde`): antes dela ainda
   vale o plano antigo. É o que impede que subir de 1x para 2x no dia 30 abra
   uma vaga extra na semana que está acabando — semana de um mês que já foi
   cobrado pelo plano velho.

   Compara por competência (o mês da aula), não por data cheia: é o mês que
   define o que foi cobrado. Semana virada entre dois meses segue o mês do dia
   escolhido, que é o dia da aula em questão. */
export function freqNaData(client, date) {
  const atual = Number(client?.weeklyFreq) || 0;
  const antes = Number(client?.weeklyFreqAnterior) || 0;
  const desde = client?.weeklyFreqDesde;
  if (!antes || !desde) return atual;
  const comp = String(date || "").slice(0, 7);
  return comp && comp < desde ? antes : atual;
}

export function tetoSemanal(client, date, aulasAtivas) {
  const limite = freqNaData(client, date);
  const marcadas = (aulasAtivas || []).filter((b) => contaNoTeto(b) && mesmaSemana(b.date, date)).length;
  return { limite, marcadas, restantes: limite ? Math.max(0, limite - marcadas) : null };
}

/* Checagem única usada por todos os caminhos de marcação.

   client       — o registro do Client (precisa de plan, mensalistaTipo, weeklyFreq)
   alvo         — { date, time } do horário escolhido (só `date` é olhado hoje;
                  `time` segue no contrato porque quem chama já tem os dois e
                  uma regra de horário pode voltar)
   ctx.hoje     — 'YYYY-MM-DD' pelo relógio de Brasília
   ctx.aulasAtivas — aulas não canceladas da aluna (a escala e o teto usam)
   ctx.ignorarJanela — true em caminhos onde a janela da escala não faz sentido
   ctx.ignorarTeto — true quando a aula não é do plano (reposição, extra)

   Devolve { ok:true } ou { ok:false, codigo, motivo }.
   `codigo` é 'escala' | 'teto'. */
export function checarRegras(client, alvo, ctx = {}) {
  const tipo = tipoMensalista(client);
  if (!tipo) return { ok: true, codigo: "", motivo: "" }; // avulsa/experimental seguem como antes

  const { date } = alvo || {};

  if (!ctx.ignorarTeto) {
    const { limite, marcadas } = tetoSemanal(client, date, ctx.aulasAtivas);
    if (limite && marcadas >= limite)
      return {
        ok: false,
        codigo: "teto",
        motivo: `Seu plano é de ${limite} aula${limite > 1 ? "s" : ""} por semana e você já ${marcadas > 1 ? "tem" : "tem"} ${marcadas} marcada${marcadas > 1 ? "s" : ""} nesta semana. ` +
          "Escolha um dia da semana que vem, ou fale com a Inêz sobre uma aula extra. 💚",
      };
  }

  if (tipo === "escala" && !ctx.ignorarJanela) {
    const j = janelaEscala(ctx.aulasAtivas, ctx.hoje);
    if (!j.aberta) return { ok: false, codigo: "escala", motivo: j.motivo };
  }

  return { ok: true, codigo: "", motivo: "" };
}

/* ---------- ciclo de cobrança da mensalidade ----------
   Combinado com a Inêz: o dia em que a aluna se matricula vira o dia de
   vencimento dela, todo mês — e a 1ª mensalidade cai no MÊS SEGUINTE. Quem se
   matricula em 19/08 paga a mensalidade de agosto naquele dia (é ela que
   matricula — não existe mais taxa de matrícula à parte) e a seguinte vence em
   19/09; daí em diante, todo dia 19.
   A Inêz pode trocar o dia no cadastro da aluna (billingDay). */

// 'YYYY-MM' somado de n meses
export function somarComp(comp, n) {
  const [y, m] = String(comp).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* Dia do mês de uma data, limitado a 28. O teto existe porque o vencimento se
   repete todo mês: 29, 30 e 31 não existem em fevereiro, e a aluna que se
   matricula em 31/01 não pode ficar sem vencimento no mês seguinte. */
export const diaDoMes = (iso) => Math.min(28, Math.max(1, Number(String(iso).slice(8, 10)) || 1));

/* ---------- multa e juros da mensalidade em atraso ----------

   ┌─────────────────────────────────────────────────────────────────────┐
   │  OS DOIS NÚMEROS DO ATRASO — para mudar, é só trocar aqui.          │
   └─────────────────────────────────────────────────────────────────────┘

   São FIXOS no código de propósito: não aparecem nas Configurações, para não
   virarem algo que se mexe sem querer. Valem SÓ para a mensalidade — a reserva
   de aula e a aula extra são pagas na hora ou não acontecem.

   A multa é um degrau: entra inteira no 1º dia de atraso e não cresce. Os juros
   são simples (não compostos) sobre o valor ORIGINAL, contados por dia corrido.

   Ordem de grandeza, para não haver surpresa: com 0,001% ao dia, uma mensalidade
   de R$ 200 atrasada 30 dias rende R$ 0,06 de juros — quem pesa é a multa.

   SE a multa e os juros são aplicados é outra história: depende da chave
   `Settings.cobrarEncargos`, que nasce DESLIGADA e a Inêz liga em Configurações.
   Quem faz esse desvio é `encargosDe()` no server — as funções aqui são puras e
   sempre calculam. Sem essa chave, subir os encargos jogaria a multa de uma vez
   sobre todas as mensalidades já vencidas. */
export const MULTA_ATRASO_REAIS = 5;      // R$, uma vez, a partir do 1º dia de atraso
export const JUROS_DIA_PERCENTUAL = 0.001; // % ao dia, juros simples sobre o valor original

// Dias corridos entre duas datas 'YYYY-MM-DD' (negativo = a segunda vem antes)
export function diasEntreISO(de, ate) {
  const p = (s) => {
    const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  };
  const a = p(de), b = p(ate);
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.round((b - a) / 86400000);
}

/* Quanto uma mensalidade custa numa data.
   `inv` precisa de { amountCents, dueDate }. `data` é o dia da conta (padrão: o
   dia do pagamento). Em dia — ou adiantada — não há acréscimo nenhum.

   Devolve tudo em centavos, para nunca somar float de dinheiro. */
export function encargosDaMensalidade(inv, data) {
  const original = Math.max(0, Number(inv?.amountCents) || 0);
  const dias = Math.max(0, diasEntreISO(inv?.dueDate, data));
  if (dias <= 0) return { dias: 0, multaCents: 0, jurosCents: 0, totalCents: original, atrasada: false };
  const multaCents = Math.round(MULTA_ATRASO_REAIS * 100);
  const jurosCents = Math.round(original * (JUROS_DIA_PERCENTUAL / 100) * dias);
  return { dias, multaCents, jurosCents, totalCents: original + multaCents + jurosCents, atrasada: true };
}

/* Havia aqui um `horarioPermitido(client, { date })`, que respondia se a data
   cabia no plano da aluna e filtrava a lista de horários do portal e do lote.
   Ele existia só para as regras de sábado e das 18h; sem as duas, respondia
   `true` para todo mundo — e um filtro que nunca filtra é pior do que nenhum,
   porque parece que alguém está conferindo. Saiu junto com a regra em
   30/08/2026. O que sobrou de regra por data é o teto semanal, que já vive em
   `checarRegras` porque precisa das aulas da semana para decidir. */
