@echo off
chcp 65001 >nul
echo === Cadastro da aluna pela conversa do WhatsApp ===
echo.
echo A conversa passa a COMECAR pelo CPF: antes de marcar, o bot procura a ficha.
echo Quem ja tem cadastro e reconhecida pelo nome; quem nao tem preenche nome,
echo WhatsApp, e-mail e nascimento ali mesmo, e a ficha nasce no painel marcada
echo como "Cadastro via WhatsApp". O Pix sai com esse mesmo CPF.
echo.
echo Tambem entram: o contador de pedidos de atendente humano (o numero so sai
echo na 3a vez) e a hora da ultima mensagem da aluna (a conversa expira em 12h).
cd /d "%~dp0backend"

echo.
echo --- Colunas da conversa (WaConversation) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE WaConversation ADD COLUMN IF NOT EXISTS pendingEmail VARCHAR(255) NULL, ADD COLUMN IF NOT EXISTS pendingBirthday VARCHAR(10) NULL, ADD COLUMN IF NOT EXISTS pendingPhone VARCHAR(20) NULL, ADD COLUMN IF NOT EXISTS clientId INT NULL, ADD COLUMN IF NOT EXISTS humanoPedidos INT NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS lastInboundAt DATETIME(3) NULL;"

echo.
echo --- Coluna de origem da ficha (Client.origem) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE Client ADD COLUMN IF NOT EXISTS origem VARCHAR(20) NULL;"

echo.
echo --- Marcando as fichas que ja tinham vindo do portal ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "UPDATE Client SET origem='portal' WHERE origem IS NULL AND notes LIKE '%%Cadastrou-se pelo portal do aluno%%';"

echo.
echo === Regenerando Prisma Client ===
call npx prisma generate

echo.
echo --- Conferencia: colunas criadas ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='WaConversation' AND COLUMN_NAME IN ('pendingEmail','pendingBirthday','pendingPhone','clientId','humanoPedidos','lastInboundAt')) OR (TABLE_NAME='Client' AND COLUMN_NAME='origem')) ORDER BY TABLE_NAME, COLUMN_NAME;"

echo.
echo --- Reposicoes sem credito (aula unica: nenhuma deveria aparecer) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT b.id, b.clientName, b.date, b.time FROM Booking b LEFT JOIN MakeupCredit m ON m.usedBookingId=b.id WHERE b.paymentMethod='Reposição' AND b.status<>'cancelada' AND b.date>=CURDATE() AND m.id IS NULL ORDER BY b.clientName, b.date;"

echo.
echo === Concluido! Reinicie o backend. ===
echo Se a lista acima veio com linhas, sao reposicoes duplicadas: o backend
echo tambem as lista em GET /api/makeup/duplicadas e limpa em
echo POST /api/makeup/duplicadas/limpar.
pause
