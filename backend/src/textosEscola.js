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

Em feriado a escola não abre, e esses dias não geram crédito de reposição: a mensalidade já é calculada sobre os dias em que temos aula.

Agradecemos pela compreensão e parceria. Essas regras nos ajudam a manter um ambiente organizado, respeitoso e acolhedor para todas. 💕`;

/* Mensagem de agradecimento + confirmação + regras, enviada quando o Pix do 1º
   pagamento cai. `quando` já vem formatado ("sexta, 05/09 às 14:00").

   `taxa` chega formatada ("R$ 20,00") quando houve taxa de matrícula, e vazia
   quando não houve. A promessa de devolução muda com ela: com taxa, volta a
   mensalidade e a taxa fica. Isto é REPETIÇÃO do que ela leu antes de pagar, de
   propósito — a hora de descobrir o que não volta não é a hora de pedir de
   volta. */
export const textoMatriculaConfirmada = ({ nome, unidade, quando, taxa, portalUrl }) => {
  const urlPortal = portalUrl || WA_PORTAL_URL;
  return `Obrigada, ${String(nome || "").split(" ")[0]}! 🙏 Recebemos o seu pagamento.

*Confirmação de agendamento*
📍 ${unidade}
🗓️ ${quando}

Sua vaga está garantida! 💚

📱 *Seu próximo passo: Acesse o Portal da Aluna*
Para gerenciar suas aulas e acompanhar seus pagamentos:
1️⃣ Acesse o portal: ${urlPortal}
2️⃣ Digite o seu CPF
3️⃣ Crie o seu *PIN de 4 dígitos* (sua senha de acesso exclusiva)

Pelo portal você acompanha sua matrícula, agenda novas aulas e reposições e acessa seus pagamentos via Pix.

---
Antes da primeira aula, leia com calma as regras abaixo — é rapidinho e evita mal-entendido depois. 👇

${taxa
  ? `💬 Caso você decida não continuar após a primeira aula, devolvemos a *mensalidade integralmente* — a taxa de matrícula de ${taxa} não é devolvida.`
  : `💬 Caso você decida não continuar após a primeira aula, esse valor será devolvido integralmente.`}
🧵 Se desejar seguir conosco, a matrícula e a mensalidade já estarão pagas.

Em caso de falta sem aviso prévio de no mínimo ${REPO_HORAS_MIN} horas, não devolvemos o valor da matrícula.

${REGRAS_REPOSICAO}`;
};

/* Pix do 1º pagamento, com o prazo da vaga dito na cara — é o que faz a aluna
   pagar agora em vez de deixar para depois.

   Quando há taxa de matrícula, o valor vem QUEBRADO: mensalidade, taxa e total.
   O QR do Pix traz o total, e um número no texto diferente do número no app do
   banco é o que trava a aluna na hora de pagar — ela para para conferir, e
   quem para não paga. Discriminar também deixa claro que a taxa é uma vez só. */
export const textoCobrancaReserva = ({ nome, unidade, quando, valor, mensalidade, taxa, minutos }) =>
`Quase lá, ${String(nome || "").split(" ")[0]}! 💚

📍 ${unidade}
🗓️ ${quando}
${taxa
  ? `💰 1ª mensalidade: ${mensalidade}\n🎟️ Taxa de matrícula (uma vez só): ${taxa}\n*Total a pagar: ${valor}*`
  : `💰 1ª mensalidade: ${valor}`}

Copie o código Pix abaixo e pague pelo app do seu banco. Assim que o pagamento cair, sua vaga é confirmada automaticamente e eu te mando a confirmação por aqui.

⏳ Consigo segurar essa vaga por ${minutos} minutos.`;

/* Último toque, a poucos minutos do fim do prazo. É a única mensagem entre o
   Pix e a vaga sair, então ela é curta: no prazo de 10 minutos não há espaço
   para conversa, só para destravar o que travou. */
export const textoLembreteHold = ({ nome, minutos }) =>
`${String(nome || "").split(" ")[0]}, sua vaga sai da reserva em ${minutos} minuto${minutos === 1 ? "" : "s"}. ⏳

Se o Pix não chegou ou deu algum problema, me fala agora que eu resolvo. 💚`;

/* Prazo estourado: a vaga volta para a fila, sem drama e com a porta aberta.

   A última linha não é gentileza à toa — é a informação que evita o pior caso
   deste fluxo. Com prazo de 10 minutos, é bem possível que ela pague poucos
   segundos depois de a vaga sair, e o sistema aceita esse pagamento (ver
   confirmarPagamentoPorTxid). Quem leu que "o dinheiro não se perde" não entra
   em pânico nem paga duas vezes. */
export const textoHoldExpirado = ({ nome, quando }) =>
`${String(nome || "").split(" ")[0]}, o prazo da sua reserva de ${quando} terminou e a vaga voltou para a lista. 😔

Se você acabou de pagar, fica tranquila: o seu dinheiro não se perde. Me chama aqui que eu confirmo e a gente acerta o seu horário. 💚`;

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
  cpf: "no seu CPF, que é como eu encontro (ou crio) o seu cadastro",
  name: "no seu nome completo",
  nameok: "na confirmação do seu nome",
  wpp: "no WhatsApp de contato",
  email: "no seu e-mail",
  nasc: "na sua data de nascimento",
  plano: "na escolha do plano",
};

/* Boas-vindas. É a primeira frase que a escola diz para alguém que talvez nunca
   tenha falado com a gente — então ela precisa fazer três coisas em quatro
   linhas: dizer quem está falando, dizer o que dá para resolver aqui e deixar
   claro que tem gente atrás disso. Nada de "digite 1 para...".

   Sai uma vez por conversa: no primeiro contato e depois que a conversa expira
   (12h de silêncio). Voltar ao menu no meio do papo não repete o texto. */
export const textoBoasVindas = ({ nome }) =>
`Oi${nome ? ", " + nome.split(" ")[0] : ""}! Que bom te ver por aqui. 💚

Eu sou a assistente virtual da *Fios que Curam*, a escola de crochê da Inêz Pimentel. Estou aqui para te ajudar de verdade — sem espera e sem formulário.

Comigo você pode *agendar sua aula*, *tirar dúvidas sobre os planos*, *receber o Pix* e *conhecer o método*. Se em algum momento você preferir falar com uma pessoa da equipe, é só me dizer que eu te levo até lá. 🧶`;

/* Atendimento humano, em três tempos.

   A Inêz pediu para insistir no automático, e o motivo é concreto: ela é uma
   pessoa só, e quase toda pergunta que chega o bot responde na hora. Mas
   insistir sem fim vira parede — quem quer falar com gente tem que conseguir.

   Então: as duas primeiras vezes mostram o que dá para resolver aqui (a segunda
   já reconhecendo que ela pediu de novo, porque fingir que não ouviu é o que
   irrita de verdade); na TERCEIRA o número sai, sem discussão. */
export const textoAtendenteHumano = (vez = 1) => {
  if (vez <= 1)
    return `Claro, eu te ajudo! 💚 Antes de chamar alguém da equipe: aqui mesmo eu resolvo na hora *agendar sua aula*, *remarcar*, *enviar o Pix da mensalidade*, *dizer os valores dos planos* e *explicar as regras de reposição*.

Me conta o que você precisa que eu já cuido disso. 🧶`;

  if (vez === 2)
    return `Entendi que você prefere falar com uma pessoa — e tudo bem. 💚

Só que o atendimento humano é em horário comercial e às vezes demora, enquanto por aqui é na hora. Se for *agendamento*, *valores*, *Pix* ou *reposição*, eu resolvo agora mesmo: é só me dizer em uma frase.

Se ainda assim preferir a equipe, me diz de novo que eu te passo o contato.`;

  return `Sem problema! Aqui está o contato da nossa equipe: 💚

📞 ${WA_ATENDENTE}

O atendimento é em horário comercial. Enquanto isso, se mudar de ideia, eu continuo por aqui — é só me chamar. 🧶`;
};

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

/* ===================== TODO PAGAMENTO É CONFIRMADO =====================
   Vitor, 02/09/2026. Até esta data, só a MATRÍCULA avisava a aluna quando o Pix
   caía; mensalidade e aula extra eram baixadas em silêncio. Quem pagava ficava
   sem saber se deu certo — e a dúvida sempre volta como mensagem para a Inêz
   ("caiu?"), ou pior, como um segundo pagamento.

   As duas mensagens abaixo fecham isso. Elas são curtas de propósito: pagamento
   confirmado não é assunto, é alívio. Cada uma diz O QUE foi pago e o que isso
   destravou — sem pedir nada de volta, porque a aluna acabou de fazer a parte
   dela.

   `avisarPagamento` no server.js é quem manda; ele sai em silêncio quando o
   WhatsApp não está configurado ou a aluna não tem telefone. */

// Mensalidade do mês. Diz a competência para não confundir com o mês seguinte.
export const textoMensalidadePaga = ({ nome, mes, valor }) =>
`Recebemos, ${String(nome || "").split(" ")[0]}! ✅

🧾 Mensalidade de ${mes}
💰 ${valor}

Está tudo certo por aqui, nada mais a pagar neste mês. Boas aulas! 🧶💚`;

/* Aula extra: o passe pago é o que libera a marcação, então a mensagem diz o
   próximo passo. Sem isso a aluna paga e fica esperando algo acontecer. */
export const textoAulaExtraPaga = ({ nome, valor }) =>
`Recebemos, ${String(nome || "").split(" ")[0]}! ✅

🎟️ Aula extra${valor ? ` · ${valor}` : ""}

Seu passe está liberado. É só entrar na área do aluno e escolher o dia e o horário da sua aula extra. 💚`;

/* Felicitações de aniversário automáticas enviadas no dia do aniversário da aluna */
export const textoAniversario = ({ nome }) =>
`Feliz aniversário, ${String(nome || "").split(" ")[0]}! 🎉🎂💚

Toda a equipe da Fios que Curam deseja um dia maravilhoso e muito abençoado pra você! Que este novo ciclo venha repleto de saúde, paz, muitas alegrias e lindos projetos de crochê. É um prazer enorme ter você com a gente! ✨🧶`;

