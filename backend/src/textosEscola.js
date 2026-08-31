/* Textos que a escola manda para a aluna — escritos pela Inêz, guardados aqui
   para que o bot, o painel e um eventual e-mail digam exatamente a mesma coisa.

   Regra de ouro deste arquivo: o que está escrito aqui é PROMESSA. Se um número
   mudar (as 6 horas de aviso, as 2 reposições por mês), ele muda em
   `regrasAula.js` e o texto tem que acompanhar — texto e código dizendo coisas
   diferentes é o jeito mais rápido de perder a confiança da aluna. */

import { REPO_MAX_MES, REPO_HORAS_MIN } from "./regrasAula.js";

/* WhatsApp da escola para atendimento humano. É o número que a Inêz atende de
   verdade — diferente do número do bot, que só conversa. */
export const WA_ATENDENTE = "+55 31 98496-6403";

/* Portal da aluna — onde ela marca aula, vê a mensalidade e o saldo de
   reposição. É para onde o bot manda quem já é aluna: lá as regras do plano
   (teto da semana, janela da escala) são aplicadas, e na conversa não seriam. */
export const WA_PORTAL_URL = process.env.WA_PORTAL_URL || "https://fiosquecuram.com.br/portal";

/* As regras completas, mandadas UMA vez: logo depois de a matrícula ser
   confirmada. É o momento em que a aluna está lendo com atenção e ainda não
   marcou nada de errado.

   Sobre "até 23:59 do dia anterior": a Inêz escreveu "até 00h do dia anterior",
   que é o mesmo prazo dito de outro jeito. Aqui vai a redação que casa com o
   código (`prazoLiberacao` em server.js), para não haver dúvida na hora de a
   aluna reclamar de um crédito que não veio. */
export const REGRAS_REPOSICAO = `*Como funciona a reposição de aulas?*
A reposição é um benefício que oferecemos às nossas alunas sempre que possível, mas ela não faz parte da carga horária obrigatória do curso.

Por esse motivo, não reservamos vagas para reposições. Elas acontecem somente quando uma aluna comunica sua ausência com antecedência mínima de ${REPO_HORAS_MIN} horas, liberando sua vaga para outra pessoa.

Para as aulas da manhã, a ausência deve ser informada até 23:59 do dia anterior.

Para manter a organização das turmas e garantir oportunidades para todas, cada aluna poderá realizar até ${REPO_MAX_MES} reposições por mês, mesmo que existam mais vagas liberadas pela mesma.

Além disso, essas reposições deverão ser agendadas e realizadas até, no máximo, o mês seguinte. Após esse período, elas não poderão mais ser utilizadas.

Obs: válido somente para alunos(as) que estão em vigência com o curso e mensalidade em dia.

Também não repomos reposição: se marcar reposição e faltar, não remarcamos, mesmo avisando com antecedência.

Agradecemos pela compreensão e parceria. Essas regras nos ajudam a manter um ambiente organizado, respeitoso e acolhedor para todas. 💕`;

/* Mensagem de agradecimento + confirmação + regras, enviada quando o Pix da 1ª
   mensalidade cai. `quando` já vem formatado ("sexta, 05/09 às 14:00"). */
export const textoMatriculaConfirmada = ({ nome, unidade, quando }) =>
`Obrigada, ${String(nome || "").split(" ")[0]}! 🙏 Recebemos o seu pagamento.

*Confirmação de agendamento*
📍 ${unidade}
🗓️ ${quando}

Sua vaga está garantida. Antes da primeira aula, leia com calma as regras abaixo — é rapidinho e evita mal-entendido depois. 👇

💬 Caso você decida não continuar após a primeira aula, esse valor será devolvido integralmente.
🧵 Se desejar seguir conosco, a matrícula e a mensalidade já estarão pagas.

Em caso de falta sem aviso prévio de no mínimo ${REPO_HORAS_MIN} horas, não devolvemos o valor da matrícula.

${REGRAS_REPOSICAO}`;

/* Pix da 1ª mensalidade, com o prazo da vaga dito na cara — é o que faz a aluna
   pagar agora em vez de deixar para depois. */
export const textoCobrancaReserva = ({ nome, unidade, quando, valor, minutos }) =>
`Quase lá, ${String(nome || "").split(" ")[0]}! 💚

📍 ${unidade}
🗓️ ${quando}
💰 1ª mensalidade: ${valor}

Copie o código Pix abaixo e pague pelo app do seu banco. Assim que o pagamento cair, sua vaga é confirmada automaticamente e eu te mando a confirmação por aqui.

⏳ Consigo segurar essa vaga por ${minutos} minutos.`;

/* Cutucada a meia hora do fim do prazo: pergunta se há dúvida e oferece o
   humano. Não é cobrança — é a última chance de resolver o que travou. */
export const textoLembreteHold = ({ nome, minutos }) =>
`${String(nome || "").split(" ")[0]}, sua vaga ainda está reservada, mas o prazo termina em ${minutos} minutos. ⏳

Ficou alguma dúvida sobre o pagamento ou sobre o curso? É só me perguntar por aqui que eu te ajudo agora. 💚`;

// Prazo estourado: a vaga volta para a fila, sem drama e com a porta aberta.
export const textoHoldExpirado = ({ nome, quando }) =>
`${String(nome || "").split(" ")[0]}, o prazo da sua reserva de ${quando} terminou e a vaga voltou para a lista. 😔

Sem problema nenhum: quando quiser, é só me chamar aqui que a gente marca de novo. 💚`;

/* Lembrete da aula, na véspera.

   É a mensagem de maior retorno prático da escola: falta sem aviso é justamente
   o que a regra das ${REPO_HORAS_MIN} horas tenta evitar, e ninguém falta de
   propósito — esquece. Um toque na véspera transforma falta em vaga liberada:
   crédito de reposição justo para ela, vaga para outra aluna, turma cheia.

   Por isso o texto diz o prazo em vez de só pedir presença: quem lê "avise até
   tal hora" ainda tem tempo de avisar. */
export const textoLembreteAula = ({ nome, unidade, quando }) =>
`Oi, ${String(nome || "").split(" ")[0]}! 🧶 Passando para lembrar da sua aula:

📍 ${unidade}
🗓️ ${quando}

Se não puder vir, me avise por aqui com pelo menos ${REPO_HORAS_MIN} horas de antecedência: a vaga fica livre para outra aluna e você ganha o crédito de reposição. 💚`;

/* Conversa parada no meio. A aluna começou a marcar e sumiu — quase sempre
   porque a vida atravessou, não porque desistiu. O texto retoma de onde parou e
   diz o que falta, para ela não ter que rolar a conversa para lembrar.

   Sai UMA vez por abandono. Insistir com quem não respondeu é o caminho curto
   para o bloqueio, e um número bloqueado não agenda mais ninguém. */
export const textoConversaParada = ({ nome, pendencia }) =>
`${nome ? nome.split(" ")[0] + ", v" : "V"}ocê ainda está por aí? 💚

Sua conversa parou ${pendencia}. Posso continuar de onde paramos — é rapidinho.

Se preferir recomeçar, é só digitar *menu*.`;

/* O que falta, por passo da conversa. Frases curtas porque entram no meio da
   mensagem acima ("Sua conversa parou ___"). */
export const PENDENCIA_POR_PASSO = {
  unit: "na escolha da unidade",
  slot: "na escolha do horário",
  confirm: "na confirmação do horário",
  name: "no seu nome completo",
  nameok: "na confirmação do seu nome",
  plano: "na escolha do plano",
  cpf: "no seu CPF, que o banco pede para emitir o Pix",
};

/* Atendimento humano. O bot resolve quase tudo, então o texto tenta uma última
   vez antes de entregar o número — não por burocracia, mas porque a Inêz é uma
   pessoa só e a maior parte das dúvidas o bot responde na hora. */
export const textoAtendenteHumano = () =>
`Claro! Antes de eu te passar para uma pessoa: aqui mesmo eu consigo *agendar sua aula*, *remarcar*, *enviar o Pix da mensalidade* e *explicar as regras de reposição* — na hora, sem espera. 💚

Se ainda assim precisar falar com alguém da equipe, é neste número:
📞 ${WA_ATENDENTE}

O atendimento é em horário comercial. Se preferir tentar por aqui, é só me dizer o que você precisa. 🧶`;

/* Mensalidade a vencer. Lembrete, não cobrança: o tom é de quem avisa para a
   pessoa não pagar multa à toa. */
export const textoMensalidadeAVencer = ({ nome, mes, valor, vencimento }) =>
`Oi, ${String(nome || "").split(" ")[0]}! 💚 Passando só para lembrar, sem pressa:

🧾 Mensalidade de ${mes}
💰 ${valor}
📅 Vence em ${vencimento}

Pagando até o vencimento você não paga multa nem juros. O Pix está logo abaixo — qualquer dúvida, é só responder por aqui. 🧶`;

// Um dia depois do vencimento. Direto, mas sem constrangimento.
export const textoMensalidadeEmAtraso = ({ nome, mes, valor, dias }) =>
`Oi, ${String(nome || "").split(" ")[0]}! Sua mensalidade de ${mes} venceu ${dias === 1 ? "ontem" : `há ${dias} dias`} e ainda consta em aberto.

💰 Total com multa e juros: ${valor}

Segue o Pix atualizado logo abaixo. Se já tiver pago, me avisa por aqui que eu confiro. 💚`;
