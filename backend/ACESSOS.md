# Usuários e acessos

No painel, a Admin abre **Sistema → Usuários e acessos** para criar usuários,
editar nome/login/perfil, bloquear/reativar, definir uma nova senha e encerrar
sessões. Contas são bloqueadas em vez de apagadas, preservando o histórico.

O perfil **Admin** tem acesso integral, inclusive a todas as rotas atuais e
futuras. **Instrutora** mantém consulta à agenda. Esses dois perfis são fixos.
Perfis personalizados permitem bloquear, consultar ou editar cada módulo.
Na ficha do usuário, os módulos do perfil escolhido aparecem logo abaixo dele.
A opção **Personalizado** deixa marcar os módulos só para aquele usuário, sem
criar perfil (ficam em `AdminUser.permissions`); ao trocar para um perfil, os
módulos próprios são descartados e passam a valer os do perfil.
Painel e relatórios só têm consulta; relatórios incluem dados financeiros.
Somente Admin administra contas, perfis, histórico e o desfazer global.

Permissão de edição em Alunos permite alterar cadastros e operar a inscrição.
Valores, vencimentos, pagamentos e matrículas com cobrança exigem também edição
em Financeiro. Configurações inclui preços gerais e feriados. Agenda e Alunos
compartilham dados de horários necessários à operação; os valores de pagamentos
só são enviados a quem pode consultar Financeiro ou Relatórios.
WhatsApp, Campanhas e Funil recebem os contatos básicos necessários à operação,
sem CPF, PIN, anotações da ficha ou valores individuais.

O servidor consulta o usuário e o perfil a cada requisição. Alterar permissões
afeta sessões abertas imediatamente na API; o painel reflete a mudança na
próxima atualização automática (até 25 segundos, ou ao voltar à aba). Bloqueio,
troca de senha e encerramento de sessões invalidam os tokens. Sessões duram
até 12 horas, ficam na memória do processo e encerram no reinício do backend.
O sistema preserva pelo menos um Admin ativo, inclusive nas transações de edição.

Senhas novas usam bcrypt, com mínimo de 8 caracteres e máximo de 72 bytes.
Senhas antigas continuam válidas até serem redefinidas. Senhas e tokens não
entram nas respostas de listagem ou no histórico. O histórico registra as
últimas 100 alterações na interface e preserva todos os registros no banco.

## Banco e publicação

O schema adiciona `AccessProfile`, `AccessAudit` e quatro campos em `AdminUser`.
Os usuários existentes continuam ativos, mantendo os perfis atuais. As migrations
são `20261019120000_gestao_acessos` e `20261020120000_permissoes_por_usuario`
(coluna `AdminUser.permissions`). O Dockerfile existente usa `prisma db push`
antes de iniciar; não aplicar a migration SQL manualmente depois desse push.
Em ambientes geridos exclusivamente por migrations, usar o fluxo de migrations
do ambiente. O primeiro uso só permite criar o Admin; não libera dados do painel.

Para cada publicação, revisar o diff funcional, especialmente `views.jsx`, conforme
`AGENTS.md`, e aplicar o schema antes de iniciar a nova API.

## Validação isolada

`node --test backend/scripts/access.test.mjs` valida a política e chama os
endpoints Express com banco em memória, sem importar o cliente Prisma real.
Para a prévia, compilar o frontend e executar
`node backend/scripts/access-preview.mjs`; abrir `http://127.0.0.1:5188/admin`.
Criar apenas contas de teste: todos os dados desaparecem ao parar a prévia.
Essa prévia não valida conexão ou persistência no MySQL de produção.
