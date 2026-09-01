@echo off
chcp 65001 >nul
echo === Taxa de matricula (R$ 20) volta ao 1o pagamento ===
echo.
echo Toda aluna NOVA passa a pagar a mensalidade MAIS a taxa de matricula,
echo uma vez so - no site e na conversa do WhatsApp. Do segundo pagamento em
echo diante e so a mensalidade.
echo.
echo Duas colunas:
echo   Settings.taxaMatricula - quanto a escola cobra hoje (editavel em
echo                            Configuracoes ^> Tabela de precos; 0 desliga).
echo   Booking.taxaMatricula  - quanto foi cobrado DAQUELA aluna, para a
echo                            mensalidade do mes entrar no financeiro sem a
echo                            taxa e a devolucao sair certa.
cd /d "%~dp0backend"

echo.
echo --- Coluna Settings.taxaMatricula ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE Settings ADD COLUMN IF NOT EXISTS taxaMatricula DOUBLE NOT NULL DEFAULT 20;"

echo.
echo --- Coluna Booking.taxaMatricula ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE Booking ADD COLUMN IF NOT EXISTS taxaMatricula DOUBLE NULL;"

echo.
echo === Regenerando Prisma Client ===
call npx prisma generate

echo.
echo --- Conferencia: tabela de precos ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT valorPlano1x, valorPlano2x, valorAvulsa, taxaMatricula FROM Settings WHERE id=1;"

echo.
echo === Concluido! Reinicie o backend. ===
echo A partir de agora: 1x = plano1x + taxa, 2x = plano2x + taxa, no 1o pagamento.
echo Para mudar (ou zerar) a taxa: painel ^> Configuracoes ^> Tabela de precos.
pause
