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
  if (contexto === "avulsa") {
    if (!v.aulaExperimental && !extraOuPremio)
      return "Este código vale para os planos mensais, não para a aula avulsa. 💚";
  } else if (contexto === "matricula") {
    const planos = planosDe(v);
    if (planos.length && freq && !planos.includes(Number(freq)))
      return `Este código vale só para o plano ${planos.map((p) => `${p}x`).join(", ")} por semana. 💚`;
    if (!v.isentaMatricula && !temDesconto(v) && !extraOuPremio)
      return "Este código é da aula experimental — escolha a opção AVULSO para usar. 💚";
  } else if (contexto === "mensalidade") {
    const planos = planosDe(v);
    if (planos.length && freq && !planos.includes(Number(freq)))
      return `Este código vale só para o plano ${planos.map((p) => `${p}x`).join(", ")} por semana. 💚`;
    if (!temDesconto(v) && !extraOuPremio)
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
  const m = aplicarDesconto(m0, v);
  const t = v?.isentaMatricula ? 0 : t0;
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
  if (!isentaMatricula && !descontoTipo && !aulaExperimental && !premio && !aulasExtras)
    return { erro: "Escolha pelo menos um benefício: isenção da matrícula, desconto, aula experimental, aula de presente ou prêmio." };
  if (publico === "alunas" && !descontoTipo && !premio && !aulasExtras)
    return { erro: "Para alunas que já estudam, o código precisa dar desconto na mensalidade, aula de presente ou prêmio." };

  const planos = (Array.isArray(b.planos) ? b.planos : []).map(Number).filter((n) => [1, 2, 3, 4].includes(n));
  const dataOk = (d) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
  const inicio = b.inicio ? String(b.inicio).slice(0, 10) : null;
  const fim = b.fim ? String(b.fim).slice(0, 10) : null;
  if (!dataOk(inicio) || !dataOk(fim)) return { erro: "Data inválida." };
  if (inicio && fim && fim < inicio) return { erro: "A data de fim é antes da data de início." };
  void hoje;
  const limiteUsos = b.limiteUsos === "" || b.limiteUsos == null ? null : parseInt(b.limiteUsos, 10);
  if (limiteUsos != null && (!Number.isInteger(limiteUsos) || limiteUsos < 1)) return { erro: "O limite de usos precisa ser 1 ou mais (ou vazio para sem limite)." };

  return {
    dados: {
      codigo, nome, publico,
      descricao: String(b.descricao || "").trim().slice(0, 500) || null,
      isentaMatricula, descontoTipo, descontoValor, descontoMeses,
      aulaExperimental, valorExperimental, premio, aulasExtras,
      planos: JSON.stringify([...new Set(planos)].sort()),
      unidade: String(b.unidade || "").trim() || null,
      inicio, fim, limiteUsos,
      ativo: b.ativo === undefined ? true : !!b.ativo,
    },
  };
}
