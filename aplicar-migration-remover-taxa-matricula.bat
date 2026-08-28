@echo off
chcp 65001 >nul
echo === Migration: fim da taxa de matricula (valor diluido na mensalidade) ===
cd /d "%~dp0backend"

echo.
echo --- Removendo a coluna Settings.taxaMatricula ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE Settings DROP COLUMN IF EXISTS taxaMatricula;"

echo.
echo --- Reservas da experimental ainda marcadas como 'Matricula' ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT id, clientName, date, value, paid FROM Booking WHERE paymentMethod='Matricula' OR paymentMethod='Matrícula' ORDER BY date DESC LIMIT 20;"

echo.
echo === Regenerando Prisma Client ===
call npx prisma generate

echo.
echo === Concluido! Reinicie o backend. ===
echo Lembrete: as reservas antigas continuam marcadas como "Matricula" e o
echo servidor segue reconhecendo essa marca. As novas nascem como "1a mensalidade",
echo ja no valor cheio do plano escolhido (valorPlano1x / valorPlano2x).
pause
