# Correções de segurança — 22/10/2026

Resultado: **fixed**, para os caminhos confirmados abaixo, com implementação e validação locais. A varredura profunda original falhou por limite de uso e permaneceu incompleta; estas correções não equivalem a uma auditoria concluída do repositório.

## Falhas e correções

1. O POST público do webhook WhatsApp aceitava remetentes e status forjados, permitindo chegar ao CRM, aos avisos de entrega e ao fluxo de cancelamento de aulas. Agora a assinatura HMAC-SHA256 é conferida em tempo constante sobre os bytes originais, antes do parser geral, ACK e efeitos colaterais. Assinaturas ausentes, malformadas ou divergentes são recusadas. O GET de confirmação continua separado. Referência do contrato: [documentação do SDK da Meta](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/).
2. CPF e PIN escolhidos bastavam para assumir um primeiro acesso ou uma conta cujo PIN fora apagado. Agora a equipe autorizada gera um código aleatório de oito dígitos, de uso único e com validade de 24 horas. A criação exige esse código; tentativas são limitadas por conta e IP. Operações simultâneas não podem sobrescrever o PIN. A redefinição revoga códigos e sessões anteriores.
3. As rotas do portal aceitavam CPF, telefone ou ID sem sessão. Agora todas passam por uma barreira compartilhada que exige sessão específica da aluna, verifica titularidade e situação do cadastro. A sessão administrativa permanece separada. Logout e expiração invalidam a sessão; respostas atrasadas de uma conta não restauram sua identidade nem desconectam a conta seguinte.
4. Aulas identificadas apenas pelo nome permitiam acesso cruzado entre homônimas. As consultas e alterações do portal, incluindo cancelamentos, créditos e reservas de matrícula, agora aplicam nome e telefone correspondente. O mesmo filtro acompanha os auxiliares compartilhados chamados pelo portal; chamadores administrativos preservam seu comportamento.

## Arquivos alterados

- Backend: `backend/src/server.js`, `backend/src/portalAuth.js`, `backend/src/portalBookingScope.js`, `backend/src/waWebhookAuth.js`, `backend/.env.example`.
- Frontend: `frontend/src/api.js`, `frontend/src/ClientPortal.jsx`, `frontend/src/ClienteApp.jsx`, `frontend/src/views.jsx`, `frontend/src/modals.jsx`.
- Regressões: `backend/scripts/portal-security.test.mjs`.
- Documentação: `README.md` e este arquivo.

Os trechos de `views.jsx` alterados são exclusivamente a geração e apresentação do código de acesso; `index.css` não foi alterado. Nenhuma publicação foi feita.

## Verificação executada

Na pasta `backend`:

- Sintaxe: `node --check src/server.js` — passou.
- Gatilhos de segurança, alternativas maliciosas e controles legítimos: `node --test scripts/portal-security.test.mjs scripts/access.test.mjs` — 13 testes passaram. Os testes cobrem corpo assinado exato versus JSON equivalente adulterado, falta de segredo, CPF sem código, código expirado/reutilizado, autorização da equipe, aliases de conta, isolamento de homônimas, logout, redefinição, expiração, concorrência e troca de contas com respostas atrasadas.
- Compatibilidade: `node test-wa-fluxo.mjs`, `node test-funil.mjs`, `node test-regras-aula.mjs`, `node test-volta.mjs`, `node test-turma-fechada.mjs` — todos passaram.

Na pasta `frontend`: `npm run build` — passou, com o aviso existente de bundle acima de 500 kB.

Na raiz: `git diff --check` — passou.

Os testes HTTP precisaram de execução fora do sandbox porque o loopback retornava `EACCES` dentro dele. As primeiras execuções também identificaram uma fixture que tentava emitir código depois de expirar a sessão administrativa; a ordem da fixture foi corrigida, sem alterar o limite da aplicação.

QA no navegador, em prévia descartável sem MySQL, WhatsApp, banco Pix ou contas reais: emissão administrativa do código, criação do PIN, carregamento do portal e logout passaram. A fixture inicial do portal não trazia o resumo completo de reposições e foi completada antes de concluir a checagem. Evidências visuais locais ficam em `backend/.qa/portal-primeiro-acesso.png` e `backend/.qa/portal-acesso-validado.png`.

## Operação e limites

- Configurar **WA_APP_SECRET** com o segredo do aplicativo Meta antes do deploy. Sem ele o recebimento responde 503; `WA_VERIFY_TOKEN` não substitui esse segredo. Não houve configuração ou homologação em produção.
- Alunas com PIN existente continuam usando CPF + PIN. Para primeiro acesso e recuperação, a equipe confere a identidade e entrega o código mostrado no painel. Não houve envio de mensagens a pessoas reais.
- Sessões de 12 horas e códigos de 24 horas ficam na memória do processo, seguindo o precedente das sessões administrativas. Reiniciar o backend encerra ambos. A implementação pressupõe uma única instância do backend.
- Aulas legadas não têm vínculo por `clientId`. Registros sem telefone não são atribuídos por nome no portal; cadastros com nome e telefone ambíguos exigem conferência pela escola. A associação persistente por ID é uma melhoria futura e não foi inferida nem migrada automaticamente.
- Não foram usados serviços externos para reproduzir ataques nem alterados dados reais. A conclusão cobre os gatilhos e limites testados; a cobertura restante da varredura original continua pendente.
