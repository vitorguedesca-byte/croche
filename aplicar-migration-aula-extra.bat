@echo off
chcp 65001 >nul
echo === Migration: aula extra paga (ExtraPass) + travas de cobranca ===
cd /d "%~dp0backend"

echo.
echo --- Tabela ExtraPass (aula extra comprada no portal) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "CREATE TABLE IF NOT EXISTS ExtraPass (id INTEGER NOT NULL AUTO_INCREMENT, clientId INTEGER NOT NULL, amountCents INTEGER NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pendente', txid VARCHAR(40) NULL, pixCode TEXT NULL, paidAt VARCHAR(10) NULL, usedBookingId INTEGER NULL, usedAt VARCHAR(10) NULL, createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX ExtraPass_clientId_idx (clientId), INDEX ExtraPass_txid_idx (txid), PRIMARY KEY (id), CONSTRAINT ExtraPass_clientId_fkey FOREIGN KEY (clientId) REFERENCES Client(id) ON DELETE CASCADE ON UPDATE CASCADE) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo.
echo --- Travas de cobranca (nascem DESLIGADAS) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE Settings ADD COLUMN IF NOT EXISTS travaAtraso BOOLEAN NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS pixExpira BOOLEAN NOT NULL DEFAULT false;"

echo.
echo --- Conferindo ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT travaAtraso, pixExpira, valorAvulsa FROM Settings WHERE id = 1;"

echo.
echo === Regenerando Prisma Client ===
call npx prisma generate

echo.
echo === Concluido! Reinicie o backend. ===
pause
