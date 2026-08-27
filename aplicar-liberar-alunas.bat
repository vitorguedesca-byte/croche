@echo off
chcp 65001 >nul
echo === Liberar alunas presas em "Aguardando pagamento" ===
echo.
echo Na Fios que Curam ninguem entra na agenda sem ter pago antes.
echo Este script marca as aulas 'aguardando' como CONFIRMADAS e PAGAS.
echo.
cd /d "%~dp0backend"

echo --- Backup antes de mexer (guarde este arquivo) ---
call npx dotenv -e .env -- mysqldump -u root -p%DB_PASS% fios_que_curam Booking > "%~dp0backup-Booking-antes-de-liberar.sql"
echo Backup salvo em: %~dp0backup-Booking-antes-de-liberar.sql

echo.
echo --- Antes: quantas aulas estao aguardando pagamento ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT COUNT(*) AS aguardando, SUM(value) AS total_a_receber FROM Booking WHERE status='aguardando';"

echo.
echo --- Quem sera liberada (10 primeiras) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT id, clientName, date, time, unit, value, paid FROM Booking WHERE status='aguardando' ORDER BY date, time LIMIT 10;"

echo.
echo --- Liberando: confirmada + paga (data do pagamento = dia em que foi marcada) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "UPDATE Booking SET status='confirmada', paid = CASE WHEN value > 0 THEN 1 ELSE paid END, paymentDate = CASE WHEN value > 0 AND paymentDate IS NULL THEN DATE_FORMAT(createdAt, '%%Y-%%m-%%d') ELSE paymentDate END WHERE status='aguardando';"

echo.
echo --- Depois: como ficou a agenda ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT status, COUNT(*) AS total FROM Booking GROUP BY status ORDER BY total DESC;"

echo.
echo --- Depois: como ficou o financeiro ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT SUM(CASE WHEN status='aguardando' THEN value ELSE 0 END) AS a_receber, SUM(CASE WHEN paid=1 THEN value ELSE 0 END) AS recebido_total FROM Booking;"

echo.
echo === Concluido! Recarregue a pagina do painel. ===
echo Obs.: marcacoes NOVAS continuam nascendo "aguardando" ate a chave
echo       de cobranca por aula ser criada no sistema.
pause
