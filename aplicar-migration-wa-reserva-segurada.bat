@echo off
chcp 65001 >nul
echo === Migration: fluxo novo do WhatsApp (reserva segurada + avisos) ===
echo.
echo O bot passa a pedir o PLANO e o CPF, gerar o Pix da 1a mensalidade e
echo SEGURAR a vaga por 1 hora. Quem confirma a reserva e o pagamento.
echo A meia hora do fim, o bot pergunta se ficou duvida e oferece o atendente.
echo Conversa parada no meio por 30min tambem leva um lembrete -- uma vez so.
echo Passou da hora sem pagar, a vaga volta para a lista -- mas so depois de
echo o sistema PERGUNTAR ao Sicredi se o Pix caiu (o webhook e um caminho so).
echo Na vespera de cada aula sai um lembrete com botao "nao vou poder ir".
echo Mensagens que o sistema inicia so saem entre 8h e 20h.
cd /d "%~dp0backend"

echo.
echo --- Booking: vaga segurada + lembrete da vespera ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE Booking ADD COLUMN IF NOT EXISTS holdUntil DATETIME(3) NULL, ADD COLUMN IF NOT EXISTS holdNudged BOOLEAN NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS lembreteAulaAt VARCHAR(10) NULL;"
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "CREATE INDEX Booking_holdUntil_idx ON Booking(holdUntil);" 2>nul

echo.
echo --- Invoice: datas dos avisos automaticos ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE Invoice ADD COLUMN IF NOT EXISTS avisoAVencerAt VARCHAR(10) NULL, ADD COLUMN IF NOT EXISTS avisoAtrasoAt VARCHAR(10) NULL;"

echo.
echo --- WaConversation: plano, CPF, reserva e lembrete de conversa parada ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE WaConversation ADD COLUMN IF NOT EXISTS weeklyFreq INT NULL, ADD COLUMN IF NOT EXISTS cpf VARCHAR(14) NULL, ADD COLUMN IF NOT EXISTS bookingId INT NULL, ADD COLUMN IF NOT EXISTS retomadaAt DATETIME(3) NULL;"

echo.
echo --- Conferencia ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT COUNT(*) AS reservas_seguradas FROM Booking WHERE holdUntil IS NOT NULL;"

echo.
echo === Regenerando Prisma Client ===
call npx prisma generate

echo.
echo === Concluido! Reinicie o backend. ===
echo.
echo ATENCAO -- os avisos de mensalidade (2 dias antes e 1 dia depois) sao
echo mensagens que a ESCOLA inicia. Fora da janela de 24h, o WhatsApp so
echo entrega por TEMPLATE APROVADO pela Meta. Antes de contar com eles:
echo   node --env-file=.env scripts/wa-templates.mjs --listar
echo   node --env-file=.env scripts/wa-templates.mjs --enviar
pause
