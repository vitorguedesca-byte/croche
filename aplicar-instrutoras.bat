@echo off
chcp 65001 >nul
echo === Painel das INSTRUTORAS ===
echo.
echo Cria o perfil "instrutora": acesso somente a Operacao ^> Agenda,
echo e somente para consultar (mes, semana, dia e lista).
echo Elas nao criam, nao editam e nao apagam nada.
cd /d "%~dp0backend"

echo.
echo --- Coluna role (perfil de acesso) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE AdminUser ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'admin';"

echo.
echo --- Coluna nome (nome de exibicao) ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "ALTER TABLE AdminUser ADD COLUMN IF NOT EXISTS nome VARCHAR(120) NULL;"

echo.
echo === Regenerando Prisma Client ===
call npx prisma generate

echo.
echo === Criando os acessos das instrutoras ===
call npx dotenv -e .env -- node scripts/criar-instrutoras.mjs

echo.
echo --- Conferencia ---
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "SELECT id, username, nome, role FROM AdminUser ORDER BY role, username;"

echo.
echo === Concluido! Reinicie o backend. ===
echo Rodar este arquivo de novo redefine as senhas das instrutoras para as do script.
pause
