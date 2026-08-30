@echo off
chcp 65001 >nul
echo === Correcao: horarios fora do formato HH:MM ===
echo.
echo O campo `time` do horario e da reserva e texto livre, e a rota de criacao
echo nao normalizava. Valores como "9:00", "09:00:00" ou a faixa inteira
echo ("09:00 as 11:00") entraram no banco e voltam para morder:
echo   - MakeupCredit.originTime e VARCHAR(5), entao LIBERAR VAGA quebrava com
echo     "The provided value for the column is too long".
echo   - comparacoes de hora (corte das 18h, regra da manha) leem errado.
echo.
echo O servidor ja normaliza na entrada. Este script arruma o que ja esta gravado.
cd /d "%~dp0backend"

echo.
echo --- Antes: horarios fora do padrao ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT 'Slot' AS tabela, id, time FROM Slot WHERE time NOT REGEXP '^[0-9]{2}:[0-9]{2}$' UNION ALL SELECT 'Booking', id, time FROM Booking WHERE time NOT REGEXP '^[0-9]{2}:[0-9]{2}$' LIMIT 40;"

echo.
echo --- Corrigindo Slot.time ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "UPDATE Slot SET time = IF(time REGEXP '^[0-9]:[0-9]{2}', CONCAT('0', LEFT(time,4)), LEFT(time,5)) WHERE time NOT REGEXP '^[0-9]{2}:[0-9]{2}$';"

echo.
echo --- Corrigindo Booking.time ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "UPDATE Booking SET time = IF(time REGEXP '^[0-9]:[0-9]{2}', CONCAT('0', LEFT(time,4)), LEFT(time,5)) WHERE time NOT REGEXP '^[0-9]{2}:[0-9]{2}$';"

echo.
echo --- Depois: o que sobrou fora do padrao (deve vir vazio) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT 'Slot' AS tabela, id, time FROM Slot WHERE time NOT REGEXP '^[0-9]{2}:[0-9]{2}$' UNION ALL SELECT 'Booking', id, time FROM Booking WHERE time NOT REGEXP '^[0-9]{2}:[0-9]{2}$' LIMIT 20;"

echo.
echo === Concluido! Reinicie o backend. ===
echo Lembrete: o horario guardado e so o INICIO da aula. A faixa ("09:00 as 11:00")
echo e calculada na tela a partir da duracao em Configuracoes -- nao se grava.
pause
