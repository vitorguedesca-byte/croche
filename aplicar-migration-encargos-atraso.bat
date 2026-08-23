@echo off
chcp 65001 >nul
echo === Migration: multa e juros da mensalidade em atraso ===
cd /d "%~dp0backend"

echo.
echo --- Coluna encargosAte (data do calculo embutido no Pix atual) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE Invoice ADD COLUMN IF NOT EXISTS encargosAte VARCHAR(10) NULL;"

echo.
echo --- Mensalidades em aberto e ja vencidas hoje ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT id, clientId, competencia, dueDate, amountCents/100 AS valor, DATEDIFF(CURDATE(), dueDate) AS dias_atraso FROM Invoice WHERE status='pendente' AND dueDate < CURDATE() ORDER BY dueDate;"

echo.
echo === Regenerando Prisma Client ===
call npx prisma generate

echo.
echo === Concluido! Reinicie o backend. ===
echo Lembrete: multa e juros sao FIXOS em backend/src/regrasAula.js
echo   MULTA_ATRASO_REAIS = 5      (R$, uma vez)
echo   JUROS_DIA_PERCENTUAL = 0.001 (%% ao dia)
pause
