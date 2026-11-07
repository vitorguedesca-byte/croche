# Auditoria financeira e de cadastro

Esta etapa registra automaticamente mudanças nas mensalidades, nos valores combinados por competência, nas configurações de cobrança e nos campos do cadastro que identificam a aluna ou afetam sua cobrança. O histórico pode ser consultado em **Financeiro → Histórico de alterações** e na aba **Alterações** da ficha da aluna.

Cada evento contém usuário/origem, horário, entidade, aluna, competência, campos antes/depois e motivo informado. A identidade do painel vem da sessão validada pelo servidor. Portal, webhook Sicredi, WhatsApp e rotinas sem requisição administrativa são diferenciados. `requestId` relaciona os eventos de uma mesma requisição.

## Gravação e retenção

- `src/prismaClient.js` exporta o cliente com a camada de auditoria de `src/dataAudit.js`. Cada escrita auditada e seu evento são persistidos na **mesma transação**, com isolamento Serializable. Se a auditoria falhar, a escrita também falha.
- Transações existentes devem usar callback, recebendo o cliente auditado: `prisma.$transaction(async tx => { ... })`.
- `updateMany` e `deleteMany` registram cada entidade afetada. A exclusão de uma aluna também registra mensalidades e valores removidos por cascata.
- `DataAudit` não tem FK com o cadastro nem com o usuário: o histórico sobrevive à exclusão deles. O aplicativo recusa criação, edição ou exclusão direta dos eventos e não oferece rotas de escrita da auditoria.
- Criação em lote com `createMany` nos quatro modelos auditados é recusada; usar criação individual. Não há uso de `createMany` nesses modelos nos fluxos atuais do servidor.
- Não há recuperação retroativa de autoria. A auditoria começa na ativação; backups antigos continuam sendo apenas evidência de valores anteriores/posteriores.

## Motivos e acesso

O backend exige motivo de 3 a 500 caracteres para alterações diretas de vencimento/valor, baixa ou cancelamento manual de mensalidade, alteração do valor mensal, reajuste, devolução de matrícula, baixa de lead, reativação, exclusão de cadastro e alteração efetiva dos campos financeiros do cadastro/configurações. Nos campos críticos de edição direta, o motivo também é revalidado dentro da transação, com os valores efetivos.

A emissão de cobrança, confirmação bancária e demais efeitos derivados continuam automáticos. Sua origem e rota são registradas; não se exige que uma rotina automática invente um motivo manual. A auditoria cobre os campos listados em `AUDIT_FIELDS`; não copia PIN, CPF, dados de contato, notas do cadastro, tokens nem códigos Pix. O texto do motivo é fornecido pelo usuário: orientar a equipe a não inserir dados sensíveis nesse campo.

Somente Admin e perfis com leitura em **Financeiro** consultam os eventos. A leitura não permite editar cobranças. Os endpoints retornam até 50 eventos por página, em ordem decrescente de id, com cursor `before`, filtro `entity` e busca `search` por nome, usuário ou motivo. O histórico da aluna inclui mudanças gerais nas configurações de cobrança, identificadas como configuração geral.

## Instalação e verificação

O schema e a migration `20261107000000_data_audit` criam somente a tabela nova. O Dockerfile existente já executa `prisma db push --skip-generate`; o bootstrap também garante a tabela via SQL idempotente antes das rotinas iniciais. Regenerar o Prisma Client com `npm run generate` ao atualizar o código. A mudança não reescreve mensalidades nem seus vencimentos existentes.

Testes locais:

```powershell
cd backend
npm run test:audit
node --test scripts/access.test.mjs scripts/portal-security.test.mjs
```

O teste de auditoria usa **SQLite descartável** em `backend/.qa/data-audit-db`, com schema derivado dos mesmos campos do schema de produção. Não usa `DATABASE_URL` para escolher banco e não conecta à produção. Inclui falha real por trigger para verificar rollback de dados e auditoria, cascatas, transações, atualização em lote, motivo obrigatório, identidade, privacidade, permissões, busca e paginação. O schema MySQL é validado separadamente com `npx prisma validate`; esses testes não substituem a conferência do fluxo após uma futura publicação em MySQL.

## Limites operacionais

Escritas feitas diretamente por SQL, pelo banco ou por scripts que instanciem seu próprio `PrismaClient` não passam pela camada do aplicativo. Scripts de manutenção que precisem de auditoria devem importar `prisma` de `src/prismaClient.js` e usar `withAuditContext({ actor, source, reason }, callback)` para identificar a execução. O histórico é protegido no aplicativo; um operador com acesso direto de escrita ao banco ainda pode alterá-lo.

Esta etapa não é uma auditoria completa de alterações de agenda, contatos, PIN, mensagens ou todos os pagamentos avulsos por reserva. A cobertura financeira inicial é de mensalidades, valores por competência e configurações/cadastro que afetam essas cobranças.
