import assert from "assert";

console.log("— Segurança: Bloqueio de liberação não confirmada via Pix —");

function validarTentativaDePagamento({ cur, ehAdmin, sicrediConfigurado, statusSicredi }) {
  if (!ehAdmin) {
    if (cur.paid) {
      return { status: 200, body: { ...cur, pago: true } };
    }

    const txid = cur.txid || `FQCB${String(cur.id).padStart(22, "0")}`;
    if (!sicrediConfigurado || !txid) {
      return {
        status: 400,
        body: {
          error: "A confirmação automática via Pix não está disponível para esta reserva.",
          pago: false,
        },
      };
    }

    const isPaid = String(statusSicredi || "").toUpperCase() === "CONCLUIDA";
    if (!isPaid) {
      return {
        status: 400,
        body: {
          error: "Pagamento Pix ainda não identificado pelo banco. Se você acabou de transferir, aguarde alguns instantes e tente novamente. 💚",
          pago: false,
        },
      };
    }

    return {
      status: 200,
      body: { ...cur, paid: true, status: "confirmada", pago: true },
    };
  }

  return {
    status: 200,
    body: { ...cur, paid: true, status: "confirmada", pago: true, manual: true },
  };
}

// Caso 1: Aluna clica no botão "Já paguei" sem pagar (status Sicredi: ATIVA)
{
  const cur = { id: 101, clientName: "Maria Silva", paid: false, status: "aguardando", txid: "FQCB0000000000000000000101" };
  const res = validarTentativaDePagamento({
    cur,
    ehAdmin: false,
    sicrediConfigurado: true,
    statusSicredi: "ATIVA",
  });

  assert.strictEqual(res.status, 400, "Deve retornar status 400 se o Pix não foi concluído no banco");
  assert.strictEqual(res.body.pago, false, "pago deve ser false");
  assert.ok(res.body.error.includes("não identificado"), "Deve avisar que o pagamento ainda não foi identificado");
  console.log("  ok  Tentativa da aluna com Pix pendente (ATIVA): RECUSADA (400) e aula continua pendente");
}

// Caso 2: Aluna clica no botão com Sicredi fora ou sem credenciais
{
  const cur = { id: 102, clientName: "Joana", paid: false, status: "aguardando", txid: "FQCB0000000000000000000102" };
  const res = validarTentativaDePagamento({
    cur,
    ehAdmin: false,
    sicrediConfigurado: false,
    statusSicredi: null,
  });

  assert.strictEqual(res.status, 400, "Deve recusar com 400 se Sicredi não estiver configurado");
  assert.strictEqual(res.body.pago, false, "pago deve ser false");
  console.log("  ok  Tentativa da aluna sem Sicredi configurado: RECUSADA (400)");
}

// Caso 3: Aluna clica no botão após pagar e Sicredi retorna CONCLUIDA
{
  const cur = { id: 103, clientName: "Ana Clara", paid: false, status: "aguardando", txid: "FQCB0000000000000000000103" };
  const res = validarTentativaDePagamento({
    cur,
    ehAdmin: false,
    sicrediConfigurado: true,
    statusSicredi: "CONCLUIDA",
  });

  assert.strictEqual(res.status, 200, "Deve retornar 200 quando banco confirma CONCLUIDA");
  assert.strictEqual(res.body.paid, true, "Reserva deve ser marcada como paga");
  assert.strictEqual(res.body.status, "confirmada", "Reserva deve ter status confirmada");
  console.log("  ok  Tentativa da aluna com Pix pago (CONCLUIDA): APROVADA e aula confirmada");
}

// Caso 4: Admin logado no painel dando baixa manual (dinheiro/cartão)
{
  const cur = { id: 104, clientName: "Carla", paid: false, status: "aguardando" };
  const res = validarTentativaDePagamento({
    cur,
    ehAdmin: true,
    sicrediConfigurado: true,
    statusSicredi: null,
  });

  assert.strictEqual(res.status, 200, "Admin tem permissão para dar baixa manual");
  assert.strictEqual(res.body.paid, true, "Reserva baixada pelo admin");
  assert.strictEqual(res.body.manual, true, "Baixa manual");
  console.log("  ok  Baixa manual pelo admin logado no painel: PERMITIDA");
}

console.log("\nTodos os testes de segurança passaram com sucesso! 🛡️");
