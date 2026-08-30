@echo off
chcp 65001 >nul
echo === Migration: fim do valor por aula (o R$ 20 fantasma) ===
echo.
echo A aula nao tem preco proprio: quem se paga e a MENSALIDADE do mes.
echo As unicas reservas com dinheiro proprio sao a experimental (1a mensalidade)
echo e a aula extra (Avulsa) -- essas nao sao tocadas aqui.
cd /d "%~dp0backend"

echo.
echo --- Antes: reservas com valor proprio indevido ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT status, COUNT(*) AS reservas, SUM(value) AS soma FROM Booking WHERE paid=0 AND value>0 AND (paymentMethod IS NULL OR paymentMethod NOT IN ('1ª mensalidade','Matrícula','Matricula','Avulsa')) GROUP BY status;"

echo.
echo --- Zerando o valor dessas reservas ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "UPDATE Booking SET value=0 WHERE paid=0 AND value>0 AND (paymentMethod IS NULL OR paymentMethod NOT IN ('1ª mensalidade','Matrícula','Matricula','Avulsa'));"

echo.
echo --- Soltando quem estava 'aguardando pagamento' de um pagamento que nao existe ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "UPDATE Booking SET status='confirmada' WHERE status='aguardando' AND paid=0 AND value=0 AND (paymentMethod IS NULL OR paymentMethod NOT IN ('1ª mensalidade','Matrícula','Matricula','Avulsa'));"

echo.
echo --- Depois: o que sobrou aguardando (so experimental e aula extra) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT id, clientName, date, time, paymentMethod, value FROM Booking WHERE status='aguardando' ORDER BY date DESC LIMIT 20;"

echo.
echo === Concluido! Reinicie o backend. ===
echo Lembrete: no painel, 'Confirmar pagamento' so aparece na experimental e na
echo aula extra. O dinheiro do mes fica todo no Financeiro, no bloco de Pix das
echo mensalidades.
pause
