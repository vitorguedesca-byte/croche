@echo off
echo === Corrigindo charset do banco para utf8mb4 ===
cd /d "%~dp0backend"

set MYSQL=mysql -u root -panaevitor fios_que_curam

REM Converter o banco
%MYSQL% -e "ALTER DATABASE fios_que_curam CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

REM Converter cada tabela
for %%T in (Client Slot Booking Waitlist Settings Testimonial) do (
  echo Convertendo tabela %%T...
  %MYSQL% -e "ALTER TABLE `%%T` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
)

echo.
echo === Regenerando Prisma Client ===
call npx prisma generate

echo.
echo === Pronto! Reinicie o backend. ===
pause
