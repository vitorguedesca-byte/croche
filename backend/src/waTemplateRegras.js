/* ============================================================
   REGRAS DA META PARA TEMPLATES — a Inêz escreve, o sistema confere.

   Template é a única mensagem que chega para quem NÃO falou com a escola
   nas últimas 24h. Antes ele só nascia por script (scripts/wa-templates.mjs);
   agora nasce pelo painel, e quem barra o erro antes de a Meta recusar é
   este arquivo. As mesmas regras valem para a tela (rota de conferência,
   que responde enquanto ela digita) e para a submissão — não existe uma
   segunda cópia no frontend para ficar desatualizada.

   O que está aqui veio da documentação da Meta (out/2026):
   - nome: só minúsculas, números e "_";
   - corpo: até 1024 caracteres, obrigatório; cabeçalho e rodapé: até 60;
   - variável não pode abrir nem fechar o texto, não pode ficar colada em
     outra, a numeração é {{1}}, {{2}}... em ordem, e cada uma leva exemplo;
   - variável demais para pouco texto é recusada;
   - texto igual ao de outro template é recusado (duplicado);
   - cabeçalho de texto: 1 variável no máximo, sem emoji, sem formatação;
   - rodapé: sem variável;
   - categoria: UTILIDADE só passa se for sobre algo DELA (aula, conta,
     pagamento) e sem nada promocional. Mensagem mista ou genérica a Meta
     aprova como MARKETING (desde 09/04/2025), que custa mais e tem limite
     por pessoa (erro 131049) — e pode reclassificar depois de aprovado,
     avisando com 1 dia de antecedência.

   A Inêz não escreve {{1}}: escreve {nome}, {unidade}... — os mesmos
   marcadores do disparo. Aqui eles viram {{n}} com um exemplo FIXO por
   marcador ("Maria", "Ipatinga"...), e é pelo exemplo que a tela do disparo
   reconhece depois o que vai em cada variável (ver `palpite` no Disparo.jsx).
   ============================================================ */
import { ENDERECOS_UNIDADES } from "./textosEscola.js";

export const MARCADORES = {
  nome: { exemplo: "Maria", desc: "primeiro nome da aluna" },
  nome_completo: { exemplo: "Maria Silva", desc: "nome completo" },
  unidade: { exemplo: "Ipatinga", desc: "unidade dela" },
  endereco: { exemplo: ENDERECOS_UNIDADES.Ipatinga.endereco, desc: "endereço da unidade dela" },
};

export const LIMITES = { nome: 512, cabecalho: 60, corpo: 1024, rodape: 60 };

/* Palavras que fazem a Meta tratar o texto como promoção. Não é a lista
   dela (ela não publica); é o suficiente para avisar ANTES de submeter que
   "utilidade" provavelmente vai voltar como marketing. */
// (o \b do JS não conhece "ç" e "ú": a borda da palavra é feita com \p{L})
const palavra = (alts) => new RegExp(`(?<!\\p{L})(${alts})(?!\\p{L})`, "iu");
const PROMOCIONAL = palavra("promo[çc][ãa]o|promo[çc][õo]es|promocional|desconto|oferta|cupom|gr[áa]tis|gratuit[ao]|aproveite|imperd[íi]vel|novidades?|lan[çc]amento|black ?friday|liquida[çc][ãa]o|[úu]ltimas vagas|vagas abertas|matr[íi]culas? abertas|inscreva-se|indique|convide|sorteio|brinde|\\d+\\s*%|% ?off");
// Pedir dado sensível é recusa por política (Business Policy).
const SENSIVEL = palavra("senha|n[úu]mero do cart[ãa]o|dados do cart[ãa]o|cvv|c[óo]digo de seguran[çc]a|cpf completo");
const EMOJI = /\p{Extended_Pictographic}/u;
const EMOJI_G = /\p{Extended_Pictographic}/gu;

const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

// "Aviso de feriado!" → "aviso_de_feriado"
export function nomeDoTemplate(titulo) {
  return semAcento(titulo)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, LIMITES.nome);
}

const normaliza = (s) => semAcento(s).toLowerCase().replace(/\s+/g, " ").trim();

/* Troca {nome}, {unidade}... por {{n}} na ordem em que aparecem. Cada
   ocorrência ganha o seu número (a Meta quer a numeração em sequência);
   marcador repetido só repete o exemplo. Marcador desconhecido e {{n}}
   digitado à mão voltam como erro, com o nome do culpado. */
function converter(texto, inicio = 1) {
  const erros = [];
  const exemplos = [];
  const marcadores = [];
  let n = inicio;
  if (/\{\{[^}]*\}\}/.test(texto)) erros.push("Use os marcadores {nome}, {unidade}… — não escreva {{1}} à mão.");
  const out = String(texto || "").replace(/\{\{[^}]*\}\}|\{([^{}]+)\}/g, (m, chave) => {
    if (!chave) return m;
    const k = semAcento(chave).trim().toLowerCase();
    const def = MARCADORES[k];
    if (!def) { erros.push(`Marcador desconhecido: {${chave}}. Use só ${Object.keys(MARCADORES).map((x) => `{${x}}`).join(", ")}.`); return m; }
    exemplos.push(def.exemplo);
    marcadores.push(k);
    return `{{${n++}}}`;
  });
  return { texto: out, exemplos, marcadores, erros };
}

const comExemplos = (txt, exs) => String(txt || "").replace(/\{\{(\d+)\}\}/g, (m, i) => exs[Number(i) - 1] ?? m);

/* Monta o template a partir do que a Inêz escreveu e confere tudo.
   Devolve `erros` (a Meta recusaria — não submete), `avisos` (passa, mas
   ela precisa saber: custo, categoria, limite), a `previa` com os exemplos
   e o `payload` pronto para a Graph API. `existentes` é a lista crua da Meta. */
export function montarTemplate(entrada, existentes = []) {
  const erros = [], avisos = [];
  const titulo = String(entrada?.titulo || "").trim();
  const categoria = String(entrada?.categoria || "").toUpperCase();
  const cabecalho = String(entrada?.cabecalho || "").trim();
  // linha em branco dupla é o máximo que faz sentido; o resto some
  const corpoBruto = String(entrada?.corpo || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const rodape = String(entrada?.rodape || "").trim();

  // ---- nome
  const name = nomeDoTemplate(titulo);
  if (!name) erros.push("Dê um nome ao template (ex.: “Aviso de feriado”).");
  else if (existentes.some((t) => t.name === name)) erros.push(`Já existe um template “${name}” na Meta. Escolha outro nome.`);

  // ---- categoria
  if (!["UTILITY", "MARKETING"].includes(categoria)) erros.push("Escolha a categoria: utilidade ou marketing.");

  // ---- cabeçalho
  let header = null, exHeader = [];
  if (cabecalho) {
    const c = converter(cabecalho, 1);
    erros.push(...c.erros.map((e) => `Cabeçalho: ${e}`));
    if (cabecalho.length > LIMITES.cabecalho) erros.push(`Cabeçalho passa de ${LIMITES.cabecalho} caracteres (${cabecalho.length}).`);
    if (/\n/.test(cabecalho)) erros.push("Cabeçalho não pode ter quebra de linha.");
    if (EMOJI.test(cabecalho)) erros.push("Cabeçalho não aceita emoji — deixe os emojis no corpo da mensagem.");
    if (/[*_~`]/.test(cabecalho)) erros.push("Cabeçalho não aceita formatação (*negrito*, _itálico_…).");
    if (c.exemplos.length > 1) erros.push("Cabeçalho aceita no máximo 1 marcador.");
    header = c.texto; exHeader = c.exemplos;
  }

  // ---- corpo
  const c = converter(corpoBruto, 1);
  erros.push(...c.erros);
  const body = c.texto, exBody = c.exemplos;
  if (!corpoBruto) erros.push("Escreva a mensagem.");
  if (body.length > LIMITES.corpo) erros.push(`A mensagem passa de ${LIMITES.corpo} caracteres (${body.length}).`);
  if (/^\{\{\d+\}\}/.test(body)) erros.push("A mensagem não pode COMEÇAR com um marcador — escreva algo antes (ex.: “Oi, {nome}!”).");
  if (/\{\{\d+\}\}$/.test(body)) erros.push("A mensagem não pode TERMINAR com um marcador — escreva algo depois (nem que seja um “!” ou “💚”).");
  if (/\{\{\d+\}\}[\s\p{P}]*\{\{\d+\}\}/u.test(body)) erros.push("Dois marcadores colados — ponha pelo menos uma palavra entre eles.");
  const palavras = body.replace(/\{\{\d+\}\}/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  /* A Meta recusa "variável demais para o tamanho" sem dizer o número. Regra
     prática: abaixo de 2 palavras por marcador é recusa quase certa (barra);
     abaixo de 3, arriscado (avisa). */
  if (exBody.length && palavras < exBody.length * 2 + 1) {
    erros.push(`Texto curto demais para ${exBody.length} marcador(es): escreva pelo menos ${exBody.length * 2 + 1} palavras.`);
  } else if (exBody.length && palavras < exBody.length * 3 + 1) {
    avisos.push(`Texto curto para ${exBody.length} marcador(es) — a Meta pode recusar. Com ${exBody.length * 3 + 1} palavras ou mais fica seguro.`);
  }
  if (body && existentes.some((t) => normaliza((t.components || []).find((x) => x.type === "BODY")?.text) === normaliza(body))) {
    erros.push("Já existe um template com exatamente esse texto — a Meta recusa duplicado.");
  }
  if (SENSIVEL.test(corpoBruto)) erros.push("Pedir senha, dados de cartão ou CPF completo é proibido pela política da Meta.");
  if ((corpoBruto.match(EMOJI_G) || []).length > 10) avisos.push("Muitos emojis — a Meta limita a quantidade e pode recusar. Use menos de 10.");

  // ---- rodapé
  if (rodape) {
    if (rodape.length > LIMITES.rodape) erros.push(`Rodapé passa de ${LIMITES.rodape} caracteres (${rodape.length}).`);
    if (/\{[^}]*\}/.test(rodape)) erros.push("Rodapé não aceita marcador — só texto fixo.");
    if (/\n/.test(rodape)) erros.push("Rodapé não pode ter quebra de linha.");
  }

  // ---- categoria × conteúdo: o que a Meta vai decidir
  const promo = PROMOCIONAL.test(`${cabecalho} ${corpoBruto} ${rodape}`);
  if (categoria === "UTILITY" && promo) {
    avisos.push("O texto soa promocional: a Meta deve aprovar como MARKETING, não utilidade — custa mais e tem limite de mensagens por pessoa. Para ser utilidade, fale só da aula/pagamento dela, sem oferta.");
  } else if (categoria === "UTILITY" && !exBody.length && !exHeader.length) {
    avisos.push("Utilidade precisa ser sobre algo DELA (aula, pagamento). Texto igual para todo mundo, sem nenhum marcador, a Meta costuma aprovar como marketing.");
  }
  if (categoria === "MARKETING") {
    avisos.push("Marketing custa mais por mensagem e a Meta segura o envio para quem já recebeu muito marketing (erro 131049) — essas não chegam e não adianta reenviar antes de 24h.");
  }

  const components = [];
  if (header) components.push({ type: "HEADER", format: "TEXT", text: header, ...(exHeader.length ? { example: { header_text: exHeader } } : {}) });
  components.push({ type: "BODY", text: body, ...(exBody.length ? { example: { body_text: [exBody] } } : {}) });
  if (rodape) components.push({ type: "FOOTER", text: rodape });

  return {
    erros: [...new Set(erros)],
    avisos,
    previa: { header: header ? comExemplos(header, exHeader) : null, body: comExemplos(body, exBody), footer: rodape || null },
    payload: { name, category: categoria, language: "pt_BR", components },
    marcadores: { header: header ? converter(cabecalho).marcadores : [], body: c.marcadores },
  };
}

/* O caminho de volta: um template recusado vira de novo o texto com
   marcadores, para "corrigir e mandar de novo" sem redigitar. Variável cujo
   exemplo não é de nenhum marcador fica como {{n}} — e o conferidor pede
   para trocar. */
export function textoComMarcadores(texto, exemplos = []) {
  const porExemplo = Object.fromEntries(Object.entries(MARCADORES).map(([k, d]) => [d.exemplo, k]));
  return String(texto || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => {
    const k = porExemplo[exemplos[Number(n) - 1]];
    return k ? `{${k}}` : m;
  });
}
