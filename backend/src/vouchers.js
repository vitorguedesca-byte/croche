/* ===================== CAMPANHAS COM CÓDIGO (VOUCHER) =====================
   Regras PURAS das campanhas — sem banco, sem Express. Vivem aqui pelo mesmo
   motivo de regrasAula.js: o que a tela promete à aluna e o que o servidor
   cobra têm de sair da mesma conta, e esta conta tem teste
   (backend/test-vouchers.mjs).

   O voucher só decide QUANTO se cobra. Quem cobra continua sendo o fluxo de
   sempre (reserva → Pix → registrarMatriculaPaga / mensalidade). */

const centavos = (v) => Math.round((Number(v) || 0) * 100) / 100;

export const PUBLICOS = ["novas", "alunas", "todas"];
export const TIPOS_DESCONTO = ["percentual", "valor", "preco"];
export const VOUCHER_MESES_MAX = 12;
export const VOUCHER_AULAS_MAX = 10; // aulas avulsas de presente por uso
const aulasDe = (v) => Math.max(0, Math.min(VOUCHER_AULAS_MAX, parseInt(v?.aulasExtras, 10) || 0));
// "reservado" e "confirmado" ocupam vaga no limite; os outros devolvem
export const STATUS_QUE_CONTAM = ["reservado", "confirmado"];

/* "bem-vinda 10" → "BEMVINDA10". O código é digitado pela aluna no celular:
   acento, espaço e minúscula não podem fazer um código válido "não existir". */
export const normalizarCodigo = (s) =>
  String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");

export const planosDe = (v) => {
  try {
    const p = JSON.parse(v?.planos || "[]");
    return Array.isArray(p) ? p.map(Number).filter((n) => n >= 1 && n <= 4) : [];
  } catch { return []; }
};

/* ---------- PACOTE (ex.: "dezembro grátis + jan, fev e mar pagos juntos") ----------
   Uma sequência de meses a partir de `pacoteInicio` ('YYYY-MM'):
   • os `pacoteGratis` primeiros não são cobrados;
   • os `pacotePagos` seguintes são pagos JUNTOS, num Pix só, no valor da soma
     das mensalidades do plano dela;
   • passado o último mês, a mensalidade volta a nascer sozinha, no valor normal.
   O Pix do pacote mora na mensalidade do 1º mês (a "cobrança"); os demais meses
   nascem quitados em R$ 0 — mas só depois que o Pix do pacote cair. */
export const PACOTE_GRATIS_MAX = 6;
export const PACOTE_PAGOS_MAX = 12;
const COMP_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const temPacote = (v) =>
  !!v && COMP_RE.test(String(v.pacoteInicio || "")) && (Number(v.pacotePagos) || 0) >= 1;

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const somaMes = (comp, n) => {
  const [y, m] = comp.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
export const nomeMes = (comp) => `${MESES[Number(comp.slice(5, 7)) - 1]}/${comp.slice(0, 4)}`;
// "janeiro, fevereiro e março/2027" — junta o ano quando todos são do mesmo
export function listaMeses(comps) {
  if (!comps.length) return "";
  const anos = new Set(comps.map((c) => c.slice(0, 4)));
  const nomes = anos.size === 1 ? comps.map((c) => MESES[Number(c.slice(5, 7)) - 1]) : comps.map(nomeMes);
  const txt = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return anos.size === 1 ? `${txt}/${[...anos][0]}` : txt;
}

/* Os meses do pacote. `cobranca` = o mês cuja mensalidade carrega o Pix do
   pacote; `cobertos` = os outros, que nascem quitados em R$ 0; `volta` = o 1º
   mês depois do pacote (cobrança normal). */
export function mesesDoPacote(v) {
  if (!temPacote(v)) return null;
  const g = Math.max(0, Math.min(PACOTE_GRATIS_MAX, parseInt(v.pacoteGratis, 10) || 0));
  const n = Math.max(1, Math.min(PACOTE_PAGOS_MAX, parseInt(v.pacotePagos, 10) || 1));
  const gratis = Array.from({ length: g }, (_, i) => somaMes(v.pacoteInicio, i));
  const pagos = Array.from({ length: n }, (_, i) => somaMes(v.pacoteInicio, g + i));
  const todos = [...gratis, ...pagos];
  return { gratis, pagos, todos, cobranca: todos[0], cobertos: todos.slice(1), volta: somaMes(v.pacoteInicio, g + n) };
}

/* Último dia em que o Pix do pacote pode ser pago: o fim da campanha. Passou
   dele sem pagamento, o pacote cai (Inêz, 25/11/2026) — não há atraso com
   multa depois disso, porque a promoção já acabou. */
export const limiteDoPacote = (v) => (v?.fim ? String(v.fim).slice(0, 10) : null);

/* Vencimento do Pix do pacote para quem já estuda: no dia em que usa o código
   (sem data na campanha) ou até a data marcada — nunca antes de hoje e nunca
   depois do fim da campanha. */
export const vencimentoDoPacote = (v, hoje) => {
  const venc = v?.pacoteVenceEm && v.pacoteVenceEm > hoje ? v.pacoteVenceEm : hoje;
  const limite = limiteDoPacote(v);
  return limite && venc > limite && limite >= hoje ? limite : venc;
};

/* Valor do pacote: a soma das mensalidades dos meses PAGOS. `valorDoMes(comp)`
   vem de fora (é o valor que aquele mês teria sem o pacote). */
export function valorDoPacote(v, valorDoMes) {
  const m = mesesDoPacote(v);
  if (!m) return 0;
  return centavos(m.pagos.reduce((s, c) => s + Math.max(0, Number(valorDoMes(c)) || 0), 0));
}

/* ALUNA NOVA (matrícula com o código): o Pix da matrícula JÁ É o pacote — ela
   não paga a mensalidade do mês em que entra (o "dezembro" dela). Esse mês de
   entrada é a cobrança; dali até o último mês pago do pacote, tudo nasce
   quitado; a próxima mensalidade é a do mês seguinte ao pacote, no mesmo dia
   do mês em que ela entrou (o vencimento dela é o dia do pagamento). */
export function mesesDoPacoteNaMatricula(v, compMatricula) {
  const m = mesesDoPacote(v);
  if (!m) return null;
  const cobertos = [];
  for (let c = somaMes(compMatricula, 1); c < m.volta; c = somaMes(c, 1)) cobertos.push(c);
  return { cobranca: compMatricula, cobertos, volta: m.volta, pagos: m.pagos, gratis: m.gratis };
}

// Texto que acompanha a mensalidade do pacote (fatura e ficha)
export function descricaoDoPacote(v) {
  const m = mesesDoPacote(v);
  if (!m) return null;
  const partes = [];
  if (m.gratis.length) partes.push(`${listaMeses(m.gratis)} grátis`);
  partes.push(`${listaMeses(m.pagos)} ${m.pagos.length === 1 ? "pago" : "pagos juntos"}`);
  return `Pacote ${v.codigo}: ${partes.join(" + ")}`.slice(0, 200);
}

// "preco" aceita 0 (mês grátis); os outros precisam tirar alguma coisa
export const temDesconto = (v) => {
  if (!v || !TIPOS_DESCONTO.includes(v.descontoTipo) || v.descontoValor == null) return false;
  const x = Number(v.descontoValor);
  return v.descontoTipo === "preco" ? x >= 0 : x > 0;
};

/* Aplica o desconto da campanha a um valor de mensalidade (R$). Nunca negativo,
   nunca MAIOR que o original — "preço promocional" acima do preço normal não é
   promoção, e a aluna não pode pagar mais por ter usado um código. */
export function aplicarDesconto(base, v) {
  const b = Math.max(0, Number(base) || 0);
  if (!temDesconto(v)) return centavos(b);
  const x = Number(v.descontoValor) || 0;
  let r = b;
  if (v.descontoTipo === "percentual") r = b * (1 - Math.min(100, x) / 100);
  else if (v.descontoTipo === "valor") r = b - x;
  else if (v.descontoTipo === "preco") r = Math.min(b, x);
  return centavos(Math.max(0, r));
}

const moeda = (v) => "R$ " + Number(v || 0).toFixed(2).replace(".", ",");
const fmtBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

/* O que a campanha dá, em frases curtas. Serve à tela da Inêz, à tela da aluna
   e ao resumo gravado no uso — o mesmo texto nos três lugares. */
export function descreverBeneficios(v) {
  const out = [];
  if (!v) return out;
  if (v.isentaMatricula) out.push("Isenção da taxa de matrícula");
  const pac = mesesDoPacote(v);
  if (pac) {
    if (pac.gratis.length) out.push(`Mensalidade de ${listaMeses(pac.gratis)} grátis`);
    out.push(pac.pagos.length === 1
      ? `Mensalidade de ${nomeMes(pac.pagos[0])} paga já no pacote`
      : `Mensalidades de ${listaMeses(pac.pagos)} pagas juntas, num Pix só (a soma das ${pac.pagos.length} mensalidades do seu plano)`);
    const limite = limiteDoPacote(v);
    const venceEm = v.pacoteVenceEm && limite && v.pacoteVenceEm > limite ? limite : v.pacoteVenceEm;
    out.push(venceEm
      ? `O pacote é pago até ${fmtBR(venceEm)}`
      : "O pacote é pago no dia em que você usar o código");
    if (limite) out.push(`Depois de ${fmtBR(limite)}, quando a promoção acaba, o pacote não pode mais ser pago`);
    out.push("Para quem está entrando: sem taxa de matrícula");
    out.push(`Em ${nomeMes(pac.volta)} a mensalidade volta a ser cobrada normalmente`);
    out.push("Se cancelar durante o pacote, o valor pago não é devolvido");
  }
  if (temDesconto(v)) {
    const x = Number(v.descontoValor) || 0;
    const meses = Math.max(1, Number(v.descontoMeses) || 1);
    const alcance = meses === 1 ? "na 1ª mensalidade" : `nas ${meses} primeiras mensalidades`;
    if (v.descontoTipo === "percentual") out.push(`${x}% de desconto ${alcance}`);
    else if (v.descontoTipo === "valor") out.push(`${moeda(x)} de desconto ${alcance}`);
    else out.push(`Mensalidade por ${moeda(x)} ${alcance}`);
  }
  if (v.aulaExperimental) {
    out.push(Number(v.valorExperimental) > 0
      ? `Aula experimental por ${moeda(v.valorExperimental)}`
      : "Aula experimental grátis");
  }
  if (aulasDe(v)) out.push(aulasDe(v) === 1 ? "1 aula avulsa de presente" : `${aulasDe(v)} aulas avulsas de presente`);
  if (v.premio) out.push(`Prêmio: ${v.premio}`);
  return out;
}

/* Situação da campanha HOJE. `usados` = usos que ocupam vaga no limite. */
export function situacaoCampanha(v, { hoje, usados = 0 }) {
  if (!v.ativo) return { codigo: "pausada", texto: "Pausada" };
  if (v.inicio && hoje < v.inicio) return { codigo: "agendada", texto: `Começa em ${fmtBR(v.inicio)}` };
  if (v.fim && hoje > v.fim) return { codigo: "encerrada", texto: `Encerrada em ${fmtBR(v.fim)}` };
  if (v.limiteUsos != null && usados >= v.limiteUsos) return { codigo: "esgotada", texto: "Esgotada" };
  return { codigo: "ativa", texto: "Ativa" };
}

/* Pode usar este código AQUI? Devolve a mensagem de recusa (para a aluna) ou
   null. `contexto`: "matricula" | "avulsa" | "mensalidade". */
export function motivoRecusa(v, { hoje, usados = 0, contexto, freq = null, unidade = null }) {
  if (!v) return "Código não encontrado. Confira se digitou certinho. 💚";
  const sit = situacaoCampanha(v, { hoje, usados });
  if (sit.codigo === "pausada" || sit.codigo === "encerrada") return "Esta promoção já foi encerrada. 💚";
  if (sit.codigo === "agendada") return `Esta promoção começa em ${fmtBR(v.inicio)}. 💚`;
  if (sit.codigo === "esgotada") return "Que pena! As vagas desta promoção já acabaram. 💚";

  const paraNovas = v.publico === "novas" || v.publico === "todas";
  const paraAlunas = v.publico === "alunas" || v.publico === "todas";
  if (contexto === "mensalidade" && !paraNovas && !paraAlunas) return "Este código não vale aqui. 💚";
  if (contexto === "mensalidade" && !paraAlunas)
    return "Este código é para quem está fazendo a matrícula pelo site. 💚";
  if (contexto !== "mensalidade" && !paraNovas)
    return "Este código é para quem já é aluna — use no portal, na sua mensalidade. 💚";

  if (v.unidade && unidade && v.unidade !== unidade) return `Este código vale só para a unidade ${v.unidade}. 💚`;

  // aula de presente e prêmio valem em qualquer lugar onde o código é aceito
  const extraOuPremio = !!v.premio || aulasDe(v) > 0;
  const pacote = temPacote(v);
  /* O pacote só se vende ANTES de começar: no 1º mês dele a mensalidade (ou a
     matrícula) já está correndo pelo valor de sempre, e o "mês grátis" viraria
     mês pago de novo. */
  if (pacote && contexto !== "avulsa" && String(hoje || "").slice(0, 7) >= v.pacoteInicio)
    return "O pacote desta promoção já começou — fale com a gente no WhatsApp. 💚";
  if (contexto === "avulsa") {
    if (!v.aulaExperimental && !extraOuPremio)
      return "Este código vale para os planos mensais, não para a aula avulsa. 💚";
  } else if (contexto === "matricula") {
    const planos = planosDe(v);
    if (planos.length && freq && !planos.includes(Number(freq)))
      return `Este código vale só para o plano ${planos.map((p) => `${p}x`).join(", ")} por semana. 💚`;
    if (!v.isentaMatricula && !temDesconto(v) && !pacote && !extraOuPremio)
      return "Este código é da aula experimental — escolha a opção AVULSO para usar. 💚";
  } else if (contexto === "mensalidade") {
    const planos = planosDe(v);
    if (planos.length && freq && !planos.includes(Number(freq)))
      return `Este código vale só para o plano ${planos.map((p) => `${p}x`).join(", ")} por semana. 💚`;
    if (!temDesconto(v) && !pacote && !extraOuPremio)
      return "Este código é para alunas novas, na matrícula pelo site. 💚";
  }
  return null;
}

/* O 1º PAGAMENTO com o código aplicado (matrícula ou aula avulsa).
   Devolve as partes separadas, como o resto do sistema exige: a MENSALIDADE
   vira a fatura do mês, a TAXA não — ver valorPrimeiroPagamento no server. */
export function primeiroPagamentoComVoucher(v, { avulsa, mensalidade = 0, taxa = 0, valorAvulsa = 0 }) {
  if (avulsa) {
    const sem = centavos(valorAvulsa);
    const com = v?.aulaExperimental ? centavos(Math.min(sem, Math.max(0, Number(v.valorExperimental) || 0))) : sem;
    return {
      mensalidade: 0, taxa: 0, valorAvulsa: com, total: com, totalSem: sem,
      descontoCents: Math.round((sem - com) * 100),
    };
  }
  const m0 = centavos(mensalidade), t0 = centavos(taxa);
  /* Pacote: no lugar da 1ª mensalidade entra o pacote (a soma das mensalidades
     dos meses pagos), e a aluna nova NÃO paga taxa de matrícula (Inêz,
     24/11/2026). Paga-se mais hoje do que sem o código, então o "desconto no
     ato" é só a taxa. */
  const pac = mesesDoPacote(v);
  const t = v?.isentaMatricula || pac ? 0 : t0;
  if (pac) {
    const m = centavos(m0 * pac.pagos.length);
    const total = centavos(m + t), totalSem = centavos(m0 + t0);
    return {
      mensalidade: m, taxa: t, valorAvulsa: 0, total, totalSem,
      descontoCents: Math.max(0, Math.round((t0 - t) * 100)),
      pacote: { meses: pac.pagos.length, pagos: listaMeses(pac.pagos), volta: nomeMes(pac.volta), mensalidade: m0 },
    };
  }
  const m = aplicarDesconto(m0, v);
  const total = centavos(m + t), totalSem = centavos(m0 + t0);
  return { mensalidade: m, taxa: t, valorAvulsa: 0, total, totalSem, descontoCents: Math.round((totalSem - total) * 100) };
}

/* Os meses SEGUINTES ao 1º que ainda levam o desconto. Na matrícula o 1º mês já
   saiu no Pix da reserva, então são `descontoMeses - 1` meses a partir do mês
   seguinte. `somarComp` vem de fora para não duplicar a conta de calendário. */
export function mesesSeguintes(v, compInicial, somarComp) {
  const n = Math.max(1, Math.min(VOUCHER_MESES_MAX, Number(v?.descontoMeses) || 1));
  if (!temDesconto(v)) return [];
  return Array.from({ length: n - 1 }, (_, i) => somarComp(compInicial, i + 1));
}

/* Confere e limpa o que veio do formulário da Inêz. Devolve { erro } ou { dados }. */
export function limparCampanha(body, { hoje } = {}) {
  const b = body || {};
  const codigo = normalizarCodigo(b.codigo);
  if (codigo.length < 3 || codigo.length > 20) return { erro: "O código precisa ter de 3 a 20 letras ou números (sem espaço)." };
  const nome = String(b.nome || "").trim().slice(0, 120);
  if (!nome) return { erro: "Dê um nome para a campanha." };
  const publico = PUBLICOS.includes(b.publico) ? b.publico : "novas";

  const descontoTipo = TIPOS_DESCONTO.includes(b.descontoTipo) ? b.descontoTipo : null;
  const descontoValor = descontoTipo ? Number(b.descontoValor) : null;
  if (descontoTipo) {
    if (!Number.isFinite(descontoValor) || descontoValor < 0) return { erro: "Informe o valor do desconto." };
    if (descontoTipo === "percentual" && (descontoValor <= 0 || descontoValor > 100)) return { erro: "O desconto em % precisa ficar entre 1 e 100." };
    if (descontoTipo === "valor" && descontoValor <= 0) return { erro: "O desconto em R$ precisa ser maior que zero." };
  }
  const descontoMeses = Math.max(1, Math.min(VOUCHER_MESES_MAX, parseInt(b.descontoMeses, 10) || 1));

  const aulaExperimental = !!b.aulaExperimental;
  const valorExperimental = Math.max(0, Number(b.valorExperimental) || 0);
  const isentaMatricula = !!b.isentaMatricula;
  const premio = String(b.premio || "").trim().slice(0, 200) || null;
  const aulasExtras = aulasDe(b);

  const pacoteInicio = b.pacoteInicio ? String(b.pacoteInicio).slice(0, 7) : null;
  if (pacoteInicio && !COMP_RE.test(pacoteInicio)) return { erro: "Escolha o mês em que o pacote começa." };
  const pacoteGratis = pacoteInicio ? parseInt(b.pacoteGratis, 10) || 0 : 0;
  const pacotePagos = pacoteInicio ? parseInt(b.pacotePagos, 10) || 0 : 0;
  if (pacoteInicio) {
    if (pacoteGratis < 0 || pacoteGratis > PACOTE_GRATIS_MAX) return { erro: `Meses grátis do pacote: de 0 a ${PACOTE_GRATIS_MAX}.` };
    if (pacotePagos < 1 || pacotePagos > PACOTE_PAGOS_MAX) return { erro: `Meses pagos juntos no pacote: de 1 a ${PACOTE_PAGOS_MAX}.` };
    // Os dois mexem nos mesmos meses — juntos, ninguém saberia qual vale.
    if (descontoTipo) return { erro: "O pacote e o desconto na mensalidade não podem ser usados juntos. Desligue um dos dois." };
  }
  const temPac = !!pacoteInicio;
  const pacoteVenceEm = temPac && b.pacoteVenceEm ? String(b.pacoteVenceEm).slice(0, 10) : null;
  if (pacoteVenceEm && !/^\d{4}-\d{2}-\d{2}$/.test(pacoteVenceEm)) return { erro: "Data de pagamento do pacote inválida." };

  if (!isentaMatricula && !descontoTipo && !temPac && !aulaExperimental && !premio && !aulasExtras)
    return { erro: "Escolha pelo menos um benefício: isenção da matrícula, desconto, pacote, aula experimental, aula de presente ou prêmio." };
  if (publico === "alunas" && !descontoTipo && !temPac && !premio && !aulasExtras)
    return { erro: "Para alunas que já estudam, o código precisa dar desconto na mensalidade, pacote, aula de presente ou prêmio." };

  const planos = (Array.isArray(b.planos) ? b.planos : []).map(Number).filter((n) => [1, 2, 3, 4].includes(n));
  const dataOk = (d) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
  const inicio = b.inicio ? String(b.inicio).slice(0, 10) : null;
  const fim = b.fim ? String(b.fim).slice(0, 10) : null;
  if (!dataOk(inicio) || !dataOk(fim)) return { erro: "Data inválida." };
  if (inicio && fim && fim < inicio) return { erro: "A data de fim é antes da data de início." };
  /* O pacote precisa começar DEPOIS do último dia de uso do código: quem usa o
     código no mês em que o pacote já começou teria esse mês cobrado normalmente
     (a matrícula paga o mês corrente) e ganharia os meses cobertos sem pagar. */
  if (temPac && !fim) return { erro: "Com pacote, a campanha precisa de uma data final (o pacote começa no mês seguinte a ela, ou depois)." };
  if (temPac && fim.slice(0, 7) >= pacoteInicio)
    return { erro: "O pacote precisa começar num mês DEPOIS do fim da campanha." };
  // O Pix do pacote morre no fim da campanha: um prazo depois dele não existe.
  if (pacoteVenceEm && pacoteVenceEm > fim)
    return { erro: `O pacote precisa ser pago até o fim da campanha (${fmtBR(fim)}).` };
  void hoje;
  const limiteUsos = b.limiteUsos === "" || b.limiteUsos == null ? null : parseInt(b.limiteUsos, 10);
  if (limiteUsos != null && (!Number.isInteger(limiteUsos) || limiteUsos < 1)) return { erro: "O limite de usos precisa ser 1 ou mais (ou vazio para sem limite)." };

  return {
    dados: {
      codigo, nome, publico,
      descricao: String(b.descricao || "").trim().slice(0, 500) || null,
      isentaMatricula, descontoTipo, descontoValor, descontoMeses,
      aulaExperimental, valorExperimental, premio, aulasExtras,
      pacoteInicio, pacoteGratis, pacotePagos, pacoteVenceEm,
      planos: JSON.stringify([...new Set(planos)].sort()),
      unidade: String(b.unidade || "").trim() || null,
      inicio, fim, limiteUsos,
      ativo: b.ativo === undefined ? true : !!b.ativo,
    },
  };
}
