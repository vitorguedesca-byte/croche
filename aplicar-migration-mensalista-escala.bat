@echo off
chcp 65001 >nul
echo === Migration: mensalista escala + travas de sabado e de horario noturno ===
cd /d "%~dp0backend"

echo.
echo --- Criando as colunas (se ainda nao existirem) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE Client ADD COLUMN IF NOT EXISTS mensalistaTipo VARCHAR(10) NOT NULL DEFAULT 'fixo', ADD COLUMN IF NOT EXISTS podeSabado BOOLEAN NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS podeNoite BOOLEAN NOT NULL DEFAULT false;"

echo.
echo --- Direito herdado: quem JA tem aula de sabado continua podendo ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "UPDATE Client c SET c.podeSabado = 1 WHERE EXISTS (SELECT 1 FROM Booking b WHERE b.clientName = c.name AND b.status <> 'cancelada' AND b.date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 60 DAY), '%%Y-%%m-%%d') AND DAYOFWEEK(b.date) = 7 AND (b.paymentMethod IS NULL OR b.paymentMethod NOT IN ('Reposição','Avulsa')));"

echo.
echo --- Direito herdado: quem JA tem aula as 18h ou depois continua podendo ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "UPDATE Client c SET c.podeNoite = 1 WHERE EXISTS (SELECT 1 FROM Booking b WHERE b.clientName = c.name AND b.status <> 'cancelada' AND b.date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 60 DAY), '%%Y-%%m-%%d') AND b.time >= '18:00' AND (b.paymentMethod IS NULL OR b.paymentMethod NOT IN ('Reposição','Avulsa')));"

echo.
echo --- Conferindo quem ficou com direito herdado ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT name, mensalistaTipo, podeSabado, podeNoite FROM Client WHERE podeSabado = 1 OR podeNoite = 1 ORDER BY name;"

echo.
echo === Regenerando Prisma Client ===
call npx prisma generate

echo.
echo === Concluido! Reinicie o backend. ===
pause
