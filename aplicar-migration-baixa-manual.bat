@echo off
chcp 65001 >nul
echo === Migration: baixa manual da mensalidade ===
echo.
echo Dar baixa no painel = recebi por fora (dinheiro, transferencia, combinado).
echo Quem paga por fora nao usa Pix, entao a mensalidade SEGUINTE nasce sem QR:
echo nada vai para o WhatsApp da aluna nem aparece no portal dela.
echo A supressao vale por UM mes, e o botao "Gerar Pix" libera o codigo quando
echo voce precisar dele mesmo assim.
cd /d "%~dp0backend"

echo.
echo --- Coluna baixaManual (fica na mensalidade PAGA) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE Invoice ADD COLUMN IF NOT EXISTS baixaManual BOOLEAN NOT NULL DEFAULT false;"

echo.
echo --- Coluna semPix (fica na mensalidade EM ABERTO que nasceu depois da baixa) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE Invoice ADD COLUMN IF NOT EXISTS semPix BOOLEAN NOT NULL DEFAULT false;"

echo.
echo --- Conferencia: mensalidades em aberto e como elas estao hoje ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT id, clientId, competencia, dueDate, amountCents/100 AS valor, semPix, IF(pixCode IS NULL,'sem QR','com QR') AS pix FROM Invoice WHERE status='pendente' ORDER BY dueDate LIMIT 30;"

echo.
echo === Regenerando Prisma Client ===
call npx prisma generate

echo.
echo === Concluido! Reinicie o backend. ===
echo Lembrete: as mensalidades que ja estavam pagas ficam com baixaManual=false.
echo Isso e proposital -- nao da para saber, olhando para tras, quais foram
echo baixadas na mao. A regra passa a valer das proximas baixas em diante.
pause
