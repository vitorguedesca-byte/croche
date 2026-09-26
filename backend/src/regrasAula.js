/* ===================== REGRAS DE MARCAÇÃO DO MENSALISTA =====================
   Combinado com a Inêz em 22/08/2026. Existem dois tipos de mensalista:

   • FIXO   — tem dia e hora fixos; quem monta a agenda dela é a Inêz (em lote).
   • ESCALA — ela mesma marca a aula pelo portal, durante a semana.

   A frequência de 1x ou 2x por semana define somente quantos padrões entram
   na grade inicial de 12 meses. Ela não cria um teto semanal: feriado fechado,
   cancelamento, remarcação, reposição e aula extra não alteram uma contagem
   obrigatória da semana.

   Para a modalidade ESCALA, continua valendo que a aluna marca a próxima aula
   NO DIA da aula dela — ou seja,
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

   Alunas avulsas, a aula de matrícula e quem está em `firstClass` não passam por
   aqui — a regra é do plano de mensalista.

   Este módulo é PURO de propósito (não toca no banco): quem chama traz as aulas
   ativas da aluna. Existe um espelho reduzido em frontend/src/helpers.js para o
   painel conseguir avisar antes de mandar a requisição. Ao mexer numa regra
   aqui, mexa lá também. */

/* ===================== QUEM AGE EM LOTE, QUEM AGE EM UNIDADE =====================
   Combinado com o Vitor em 02/09/2026.

   O PAINEL (Inêz) age em LOTE por padrão — incluir, alterar e excluir. O que
   ela faz num dia ou numa turma vale para as ocorrências seguintes, porque é
   assim que ela pensa a agenda: "a turma das 09:00 de terça" é a turma, não
   aquela terça. O horizonte padrão é de 12 meses (52 semanas), o mesmo da grade
   inicial da mensalista — se os dois números divergirem, a aluna nova ganha uma
   agenda mais longa que a turma dela e as últimas aulas ficam sem horário.

   O lote é o PADRÃO, não uma obrigação: toda tela do painel mantém a saída
   "só esta" (o seletor de alcance ao editar, o "Só este" da exclusão, os chips
   de dia da semana desmarcados ao incluir). Sem essa saída não haveria como
   consertar uma aula específica sem desfazer a grade inteira.

   O PORTAL (aluna) continua agindo em UNIDADE. Ela marca, desmarca e remarca
   uma aula por vez. A única exceção é a PRIMEIRA marcação — a matrícula, que
   monta a grade de 12 meses de uma vez. Depois disso, nunca mais em lote.

   TRÊS AULAS NUNCA ENTRAM NO LOTE, em nenhum dos caminhos: a reposição
   (PGTO_REPOSICAO), a aula extra (PGTO_EXTRA) e a aula da avulsa/matrícula.
   As três são ocorrências únicas — existem por causa de um crédito, de um
   pagamento à parte ou de uma visita, e não por causa de uma grade. Copiá-las
   inventaria aula que ninguém contratou. Quem replica tem que filtrar por
   PGTO_PLANO em vez de copiar tudo que encontrar na turma.

   Alterar/excluir em lote é diferente de replicar: mover a turma das 09:00 para
   as 09:30 move junto quem estiver dentro dela, reposição inclusive — a aula
   continua sendo a mesma, só mudou de hora. O que o lote não faz é CRIAR cópias
   dessas três. */

// Marca que o backend põe no paymentMethod das aulas regulares do plano. É por
// ela que a replicação diferencia a grade normal das ocorrências unitárias.
export const PGTO_PLANO = "Mensalista";

/* Horizonte padrão de tudo que o painel faz em lote. Espelhado em
   frontend/src/helpers.js (SEMANAS_PADRAO / MESES_PADRAO) — ao mudar aqui,
   mude lá. 52 semanas ≈ 12 meses. */
export const SEMANAS_PADRAO = 52;
export const MESES_PADRAO = 12;

/* ===================== FERIADO NÃO GERA CRÉDITO =====================
   Vitor, 02/09/2026. Esta regra foi INVERTIDA nesta data — até então, cancelar
   as aulas de um feriado dava um crédito de reposição para cada mensalista, com
   o argumento de que feriado é decisão da escola e ninguém deveria perder aula.

   Passa a valer o contrário: a aluna que tinha aula num feriado não ganha
   crédito nem direito de reposição. O que ela contrata é a GRADE da escola, e a
   grade não tem aula em feriado — a mensalidade já é calculada sobre os dias em
   que a porta abre. Creditar o feriado pagaria a aluna duas vezes pelo mesmo
   dia: uma no preço, outra na reposição.

   Onde isso é aplicado (os três precisam concordar):
   • concederCredito() no server.js recusa antes de olhar a antecedência. A
     ordem importa: as regras de janela medem o AVISO da aluna, e responder
     "avisou tarde demais" para um dia sem aula dá o motivo errado.
   • POST /api/feriados/:date/cancelar-aulas cancela as aulas e não credita.
   • scripts/revogar-creditos-feriado.mjs limpa os créditos de feriado que já
     tinham sido gerados e ainda não foram gastos (os usados ficam: apagá-los
     deixaria a aula de reposição órfã).

   O que NÃO muda: em feriado continua não existindo horário para marcar, em
   nenhum caminho — a recusa é de exigirRegras(), antes até do `forcar` da Inêz.
   Feriado não é regra de plano; é o dia em que a escola não abre. */

/* Aula de reposição (remarcação). É aula ÚNICA: nasce de um crédito gasto e
   nunca é copiada — nem pela replicação da turma, nem pelo agendamento em lote,
   nem pela marcação replicada por datas. A constante existe para que esses
   caminhos comparem contra a MESMA string, em vez de repetir o literal
   "Reposição" e um deles ficar para trás numa renomeação. */
export const PGTO_REPOSICAO = "Reposição";

// Aula extra comprada à parte (ou cortesia da Inêz). Também não se replica.
export const PGTO_EXTRA = "Avulsa";

/* ===================== O PRIMEIRO PAGAMENTO DA ALUNA NOVA =====================
   A aluna nova paga a MENSALIDADE mais a TAXA DE MATRÍCULA, uma vez só (Vitor,
   01/09/2026). Da segunda cobrança em diante é só a mensalidade.

   As duas contas moram aqui, e não soltas no server.js, porque elas têm que ser
   exatamente inversas uma da outra. Somar a taxa ao cobrar e esquecer de
   descontá-la ao registrar a mensalidade do mês faria a receita da escola
   crescer R$ 20 por aluna nova — para sempre, e sem ninguém perceber, porque
   cada número isolado pareceria certo. Com as duas juntas, o teste de ida e
   volta (test-regras-aula.mjs) prende o par.

   Ambas arredondam para centavos: dinheiro em Float acumula 0.30000000000000004
   quando se soma e subtrai, e esse resto acaba virando um centavo de diferença
   entre o Pix e a fatura. */
const centavos = (v) => Math.round((Number(v) || 0) * 100) / 100;

// O que o Pix cobra da aluna nova.
export const primeiroPagamento = ({ mensalidade, taxa = 0 }) =>
  centavos(Math.max(0, Number(mensalidade) || 0) + Math.max(0, Number(taxa) || 0));

/* Quanto daquele pagamento foi MENSALIDADE — é este valor que vira a fatura do
   mês e é este que volta para a aluna se ela desistir (a taxa não volta).
   `taxa` tem que ser a GRAVADA na reserva, não a da tabela de hoje: mudar o
   preço amanhã não pode reescrever o que alguém pagou ontem. */
export const mensalidadeDoPagamento = ({ pago, taxa = 0 }) =>
  centavos(Math.max(0, (Number(pago) || 0) - Math.max(0, Number(taxa) || 0)));

/* Números da reposição. Vivem aqui, e não no server.js, porque o texto que a
   escola manda para a aluna (textosEscola.js) promete exatamente estes valores:
   mudar num lugar e esquecer o outro é o jeito mais rápido de a regra escrita
   deixar de ser a regra aplicada. */
export const REPO_MAX_MES = 2;      // reposições por competência
export const REPO_HORAS_MIN = 6;    // antecedência mínima do aviso
export const REPO_MANHA_ATE = "10:00"; // aula antes disso usa o prazo da meia-noite

/* Até quando dá para liberar a aula e ainda ganhar o crédito.
   Devolve o instante limite, 'YYYY-MM-DDTHH:MM:SS'.

   Duas faixas, como a escola promete por escrito:
   • aula ANTES das 10:00 → até 23:59 do dia anterior (ninguém acorda às 3h
     para avisar, e a vaga precisa ser oferecida a tempo);
   • demais horários      → REPO_HORAS_MIN horas antes da aula.

   Mora aqui, e não no server, pelo motivo escrito no topo deste arquivo: é
   regra que a escola PROMETE no texto do WhatsApp e no portal, e regra
   prometida precisa de teste (ver backend/test-regras-aula.mjs). */
export function prazoLiberacao(date, time, horasMin = REPO_HORAS_MIN) {
  const t = hhmm(time) || "00:00";
  if (t < REPO_MANHA_ATE) return `${somarDias(date, -1)}T23:59:59`;
  const [h, m] = t.split(":").map(Number);
  let min = h * 60 + m - horasMin * 60;
  let d = date;
  while (min < 0) { min += 1440; d = somarDias(d, -1); }
  return `${d}T${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;
}

// Comparação de texto ISO: 'agora' é o relógio de Brasília, não o UTC do servidor.
export const liberouATempo = (date, time, agora) => agora <= prazoLiberacao(date, time);

/* Por que uma aula liberada NÃO vira crédito — a parte da decisão que não
   precisa do banco. `concederCredito` no server.js consulta esta função antes
   de olhar teto do mês e elegibilidade (essas dependem de contar linhas).

   Devolve "" quando o crédito pode sair, ou o motivo escrito para a aluna.

   A ORDEM É A REGRA, e é por isso que ela mora aqui com teste: o feriado
   responde ANTES da antecedência. As duas recusas são verdadeiras ao mesmo
   tempo numa véspera de feriado, e a que a aluna lê muda o sentido — "você
   avisou tarde" acusa a aluna de algo que não aconteceu, quando o motivo real é
   que aquele dia não tinha aula nenhuma. Ver o bloco FERIADO NÃO GERA CRÉDITO
   no topo deste arquivo. */
export function motivoSemCredito({ nomeFeriado = "", date, time, agora, diaBR = (d) => d }) {
  if (nomeFeriado)
    return `${diaBR(date)} é ${nomeFeriado} e a escola não abre — não há aula para repor, então não gera crédito.`;
  if (!liberouATempo(date, time, agora))
    return hhmm(time) < REPO_MANHA_ATE
      ? "Aula da manhã precisa ser liberada até 23:59 do dia anterior para gerar crédito."
      : `Aviso com menos de ${REPO_HORAS_MIN}h de antecedência não gera crédito de reposição.`;
  return "";
}

// 'YYYY-MM-DD' ± n dias, em UTC (o mesmo addDays do server, sem depender dele)
function somarDias(iso, n) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + n * 86400000).toISOString().slice(0, 10);
}

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

// Só a mensalista fixa participa de grade recorrente. A aluna de escala escolhe
// cada ocorrência separadamente, mesmo quando a ADMIN replica uma turma inteira.
export const podeReplicarMensalista = (client) => tipoMensalista(client) === "fixo";

export const TIPO_LABEL = { fixo: "Mensalista fixo", escala: "Mensalista escala" };

// 'YYYY-MM-DD' → 'sáb, 22/08' (curto, para caber nas mensagens)
function diaBR(date) {
  const m = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date;
  const dow = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][
    new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()
  ];
  return `${dow}, ${m[3]}/${m[2]}`;
}

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

/* Janela de marcação da escala.
   • 1x por semana: a próxima aula é marcada no dia da sua aula (ou se não houver aula futura).
   • 2x por semana (Vitor, 04/09/2026): a aluna de escala 2x pode marcar as DUAS aulas da semana
     a partir da última aula realizada da semana anterior. Não trava após marcar a 1ª aula. */
export function janelaEscala(aulasAtivas, hoje, opts = {}) {
  const { weeklyFreq = 1, alvoDate, todasAulas = [] } = opts;
  const futuras = (aulasAtivas || [])
    .filter((b) => b && b.status !== "cancelada" && b.date >= hoje)
    .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));

  if (Number(weeklyFreq) === 2) {
    const segHoje = segundaDaSemana(hoje);
    const listaCompleta = todasAulas.length ? todasAulas : (aulasAtivas || []);

    // Aulas da semana atual
    const aulasSemanaAtual = listaCompleta
      .filter((b) => contaNoTeto(b) && mesmaSemana(b.date, hoje))
      .sort((a, b) => a.date.localeCompare(b.date));
    const ultimaAulaSemanaAtual = aulasSemanaAtual[aulasSemanaAtual.length - 1];
    const ultimaAulaJaPassou = !ultimaAulaSemanaAtual || ultimaAulaSemanaAtual.date <= hoje;

    // Se NÃO passou alvoDate: consulta geral (para saber se o portal/aluna pode marcar algo agora)
    if (!alvoDate) {
      if (aulasSemanaAtual.length < 2) {
        return { aberta: true, proxima: null, motivo: "" };
      }
      if (!ultimaAulaJaPassou) {
        return {
          aberta: false,
          proxima: ultimaAulaSemanaAtual,
          motivo: `Na escala 2x, as aulas da próxima semana são liberadas a partir da sua última aula desta semana (${diaBR(ultimaAulaSemanaAtual.date)}). 💚`,
        };
      }
      const segProx = somarDias(segHoje, 7);
      const marcadasNaProx = listaCompleta.filter((b) => contaNoTeto(b) && mesmaSemana(b.date, segProx));
      if (marcadasNaProx.length < 2) {
        return { aberta: true, proxima: null, motivo: "" };
      }
      return {
        aberta: false,
        proxima: marcadasNaProx[0],
        motivo: `Você já tem as 2 aulas agendadas para a próxima semana. 💚`,
      };
    }

    const alvo = alvoDate;
    if (alvo < hoje) {
      return { aberta: false, proxima: null, motivo: "Não é possível agendar aulas em datas passadas." };
    }
    const segAlvo = segundaDaSemana(alvo);
    const marcadasNaSemanaAlvo = listaCompleta.filter(
      (b) => contaNoTeto(b) && mesmaSemana(b.date, alvo)
    );

    // Se estiver tentando marcar para uma semana futura:
    if (segAlvo > segHoje) {
      if (!ultimaAulaJaPassou) {
        return {
          aberta: false,
          proxima: ultimaAulaSemanaAtual,
          motivo: `Na escala 2x, as aulas da próxima semana são liberadas a partir da sua última aula desta semana (${diaBR(ultimaAulaSemanaAtual.date)}). 💚`,
        };
      }
      const segProx = somarDias(segHoje, 7);
      if (segAlvo > segProx) {
        return {
          aberta: false,
          proxima: null,
          motivo: "Na escala 2x, você pode marcar aulas para esta semana ou para a próxima semana. 💚",
        };
      }
    }

    // Na semana do alvo, pode marcar se tiver menos de 2 aulas:
    if (marcadasNaSemanaAlvo.length < 2) {
      return { aberta: true, proxima: null, motivo: "" };
    }

    return {
      aberta: false,
      proxima: marcadasNaSemanaAlvo[0],
      motivo: segAlvo === segHoje
        ? `Você já tem as 2 aulas agendadas para esta semana. 💚`
        : `Você já tem as 2 aulas agendadas para essa semana. 💚`,
    };
  }

  // Regra padrão 1x por semana:
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

/* ---------- teto de aulas por mês para aluna de ESCALA ----------
   Vitor, 03/09/2026:
   • Aluna de escala no plano 1x (R$ 120,00): tem direito a 4 aulas no mês.
   • Aluna de escala no plano 2x (R$ 200,00): tem direito a 8 aulas no mês.
   Aulas canceladas, reposições (PGTO_REPOSICAO) e aulas extras (PGTO_EXTRA)
   NÃO consomem essas aulas do plano mensal. */

export function compPorExtenso(comp) {
  const m = String(comp || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return comp;
  const meses = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  return `${meses[+m[2] - 1]} de ${m[1]}`;
}

export function limiteMensalEscala(client, date) {
  const freq = freqNaData(client, date);
  if (freq === 2) return 8;
  if (client?.monthlyValue && Number(client.monthlyValue) >= 200) return 8;
  return 4; // padrão 1x (R$ 120,00) = 4 aulas por mês
}

export function tetoMensalEscala(client, date, todasAulasDaAluna) {
  const comp = String(date || "").slice(0, 7);
  const limite = limiteMensalEscala(client, date);
  const marcadas = (todasAulasDaAluna || []).filter(
    (b) => contaNoTeto(b) && String(b.date || "").startsWith(comp)
  ).length;
  return {
    competencia: comp,
    limite,
    marcadas,
    restantes: Math.max(0, limite - marcadas),
    atingido: marcadas >= limite,
  };
}

/* Checagem única usada por todos os caminhos de marcação.

   client       — o registro do Client (precisa de plan, mensalistaTipo, weeklyFreq)
   alvo         — { date, time } do horário escolhido
   ctx.hoje     — 'YYYY-MM-DD' pelo relógio de Brasília
   ctx.aulasAtivas — aulas não canceladas da aluna (a escala usa)
   ctx.todasAulas  — histórico de aulas da aluna para cômputo do mês
   ctx.ignorarJanela — true em caminhos onde a janela da escala não faz sentido
   ctx.ignorarTeto   — true para reposição e aula extra

   Devolve { ok:true } ou { ok:false, codigo, motivo }.
   `codigo` é 'escala' | 'teto_mes'. */
export function checarRegras(client, alvo, ctx = {}) {
  const tipo = tipoMensalista(client);
  if (!tipo) return { ok: true, codigo: "", motivo: "" }; // avulsa/matrícula seguem como antes

  if (tipo === "escala") {
    if (!ctx.ignorarJanela) {
      const freq = freqNaData(client, alvo?.date || ctx.hoje);
      const j = janelaEscala(ctx.aulasAtivas, ctx.hoje, {
        weeklyFreq: freq,
        alvoDate: alvo?.date,
        todasAulas: ctx.todasAulas || ctx.aulasAtivas,
      });
      if (!j.aberta) return { ok: false, codigo: "escala", motivo: j.motivo };
    }
    if (!ctx.ignorarTeto && alvo?.date) {
      const tm = tetoMensalEscala(client, alvo.date, ctx.todasAulas || ctx.aulasAtivas);
      if (tm.atingido) {
        return {
          ok: false,
          codigo: "teto_mes",
          motivo: `Você já atingiu o limite de ${tm.limite} aulas do seu plano no mês de ${compPorExtenso(tm.competencia)}. Para agendar mais aulas, você pode adquirir uma Aula Extra no portal! 💚`,
        };
      }
    }
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
   `true` para todo mundo e foi removido junto com essas regras. */
