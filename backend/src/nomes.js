/* ============================================================================
   Padronização de nomes de pessoas (alunas, lista de espera, depoimentos).

   Por que existe: o cadastro veio de lugares diferentes — planilha antiga,
   digitação da Inêz, portal da aluna, WhatsApp — e cada um escreveu de um
   jeito: "MARIA DA SILVA", "maria  da silva", "Maria Da Silva", nome com
   espaço sobrando na ponta, acento gravado errado no banco ("JosÃ©"), emoji
   colado no fim. Como a AULA é ligada à aluna pelo NOME (Booking.clientName),
   nome bagunçado não é só feio: quebra a contagem de aulas, a busca e a
   cobrança.

   Este módulo é a ÚNICA fonte da regra. O backend chama em toda porta de
   entrada de nome, e o script scripts/padronizar-nomes.mjs usa o mesmo código
   para arrumar o que já está gravado.

   O que ele NÃO faz, de propósito: adivinhar acento que falta. "Jose" não
   vira "José" e "Ines" não vira "Inês" — decidir isso por conta própria
   erraria em nomes legítimos (Luis/Luís, Ines/Inês), e nome de gente é a
   pessoa, não um palpite. Acento que falta continua um ajuste manual na ficha.
   ========================================================================== */

/* ---------------------------------------------------------------------------
   1) Conserto de charset (mojibake)
   Texto UTF-8 gravado numa coluna latin1 e lido de volta como UTF-8 vira
   "JosÃ©", "AparecÃ­da", "ConceiÃ§Ã£o". A recuperação é mecânica: cada
   caractere volta a ser o byte que era, e o conjunto é relido como UTF-8.
   Só tenta quando o texto tem a assinatura do problema (Ã/Â seguidos de um
   byte de continuação) e só aceita o resultado se a decodificação for válida.
--------------------------------------------------------------------------- */
const TEM_MOJIBAKE = /[ÃÂ][-¿]/;

function desfazerMojibake(s) {
  let atual = s;
  // até 3 voltas: já vimos texto que passou pelo problema mais de uma vez
  for (let i = 0; i < 3; i++) {
    if (!TEM_MOJIBAKE.test(atual)) break;
    // se algum caractere não couber em um byte, não é mojibake — é texto real
    if ([...atual].some((ch) => ch.codePointAt(0) > 0xff)) break;
    try {
      const bytes = Uint8Array.from([...atual], (ch) => ch.charCodeAt(0));
      const decodificado = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (decodificado === atual) break;
      atual = decodificado;
    } catch {
      break; // não era UTF-8 válido: devolve como estava
    }
  }
  return atual;
}

/* ---------------------------------------------------------------------------
   2) Limpeza de caracteres
   Tira o que não é nome e uniformiza os sinais que têm várias versões: aspas
   e apóstrofos tortos do Word viram ', travessões viram hífen, espaço
   inquebrável vira espaço comum.
--------------------------------------------------------------------------- */
const APOSTROFOS = /[‘’ʼ´`']/g;   // ' ' ʼ ´ ` '  →  '
const ASPAS = /[“”"]/g;                     // " " "        →  (fora)
const TRACOS = /[‐-―−]/g;              // ‐ ‒ – — ―  −  →  -
const ESPACOS = /[  -   　\t\r\n]/g;
const INVISIVEIS = /[​-‍⁠﻿­\p{Cc}\p{Cf}]/gu;
// o que sobra vive: letra, marca de acento, número, espaço e ' - . ,
const NAO_E_NOME = /[^\p{L}\p{M}\p{N} '\-.,]/gu;

function limparCaracteres(s) {
  return s
    .normalize("NFC")          // "e" + acento solto → "é" (um caractere só)
    .replace(ESPACOS, " ")
    .replace(INVISIVEIS, "")
    .replace(APOSTROFOS, "'")
    .replace(ASPAS, "")
    .replace(TRACOS, "-")
    .replace(NAO_E_NOME, "")   // emoji, símbolo, seta, o que for
    // Hífen COLADO une o nome composto ("Ana-Maria"); hífen com espaço em
    // volta é só pontuação largada no meio ("Ana — Clara" = "Ana Clara").
    .replace(/\s+-+\s+/g, " ")
    .replace(/\s+/g, " ")      // espaço duplicado
    .replace(/\s*'\s*/g, "'")  // "D ' Ávila" → "D'Ávila"
    .replace(/[.,]+$/, "")     // ponto/vírgula sobrando no fim
    .trim();
}

/* ---------------------------------------------------------------------------
   3) Caixa (maiúsculas / minúsculas)
   Padrão brasileiro: cada nome com inicial maiúscula e os conectivos em
   minúscula — "Maria da Conceição dos Santos", não "Maria Da Conceição Dos
   Santos". Conectivo no começo do nome continua maiúsculo ("Da Silva Júnior"
   como nome único não existe, mas se for a primeira palavra, respeitamos).
--------------------------------------------------------------------------- */
const CONECTIVOS = new Set([
  "da", "das", "de", "del", "des", "di", "do", "dos", "du",
  "e", "y", "la", "le", "van", "von", "der", "den", "ter", "a", "o",
]);
// escritos sempre em caixa alta
const SIGLAS = new Set(["ii", "iii", "iv", "vi", "vii", "viii", "ix", "xi", "xii"]);

const maiuscula = (s) => s.toLocaleUpperCase("pt-BR");
const minuscula = (s) => s.toLocaleLowerCase("pt-BR");

// Aplica a inicial maiúscula respeitando as junções internas: hífen
// (Ana-Maria), apóstrofo (D'Ávila) e ponto de abreviação (J.C. → J.C.).
function capitalizarPedaco(p) {
  if (!p) return p;
  const baixo = minuscula(p);
  if (SIGLAS.has(baixo)) return maiuscula(p);
  // abreviação: "j.c." → "J.C."
  if (/^\p{L}\.(\p{L}\.)*$/u.test(baixo)) return maiuscula(p);
  return baixo
    .split("-").map(capitalizarAtomo).join("-")
    .split("'").map((parte, i, todos) =>
      // d'Ávila: a partícula antes do apóstrofo fica minúscula quando tem 1 letra
      i === 0 && todos.length > 1 && parte.length === 1 ? maiuscula(parte) : capitalizarAtomo(parte)
    ).join("'");
}

function capitalizarAtomo(a) {
  if (!a) return a;
  const chars = [...a];
  return maiuscula(chars[0]) + chars.slice(1).join("");
}

/* ---------------------------------------------------------------------------
   Função principal: recebe qualquer coisa, devolve o nome padronizado.
--------------------------------------------------------------------------- */
export function padronizarNome(entrada) {
  if (entrada == null) return "";
  const bruto = String(entrada);
  const limpo = limparCaracteres(desfazerMojibake(bruto));
  if (!limpo) return "";

  const palavras = limpo.split(" ").filter(Boolean);
  return palavras
    .map((p, i) => {
      const baixo = minuscula(p);
      // conectivo só fica em minúscula no meio do nome, nunca na primeira nem
      // na última posição ("Maria de" ficaria estranho e costuma ser digitação
      // pela metade — deixamos como palavra normal).
      if (i > 0 && i < palavras.length - 1 && CONECTIVOS.has(baixo)) return baixo;
      return capitalizarPedaco(p);
    })
    .join(" ");
}

/* Chave de comparação: serve para achar o mesmo nome escrito de formas
   diferentes ("MARIA SILVA" e "maria  silva" têm a mesma chave) e para
   detectar duplicidade antes de renomear. Sem acento, sem caixa, sem
   pontuação — NÃO é para gravar no banco, só para comparar. */
export function chaveNome(entrada) {
  return padronizarNome(entrada)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

/* O nome mudaria se fosse padronizado? (usado nos relatórios) */
export const precisaPadronizar = (n) => String(n ?? "") !== padronizarNome(n);
