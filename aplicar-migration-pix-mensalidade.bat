@echo off
echo === Migration: validade do Pix da mensalidade (Invoice.pixExpiresOn) ===
cd /d "%~dp0backend"

echo.
echo --- Criando a coluna (se ainda nao existir) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE Invoice ADD COLUMN IF NOT EXISTS pixExpiresOn VARCHAR(10) NULL;"

echo.
echo --- Mensalidades antigas: a validade era o proprio vencimento ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "UPDATE Invoice SET pixExpiresOn = dueDate WHERE pixCode IS NOT NULL AND pixExpiresOn IS NULL;"

echo.
echo === Regenerando Prisma Client ===
call npx prisma generate

echo.
echo === Concluido! Reinicie o backend. ===
pause
