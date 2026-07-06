@echo off
echo === Aplicando migration: tabela Testimonial ===
cd /d "%~dp0backend"

call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "CREATE TABLE IF NOT EXISTS Testimonial (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, role VARCHAR(255) NOT NULL DEFAULT '', text TEXT NOT NULL, photo VARCHAR(255) NULL, active TINYINT(1) NOT NULL DEFAULT 1, `order` INT NOT NULL DEFAULT 0, createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"

echo.
echo === Inserindo depoimentos existentes ===
call npx dotenv -e .env -- mysql -u root -p%DB_PASS% fios_que_curam -e "INSERT IGNORE INTO Testimonial (name, role, text, photo, active, `order`) VALUES ('Ana Paula Tavares', '@entrelacodapaulinha · Ipatinga/MG', 'Aceitei a aula experimental quase por acidente — e foi a melhor decisão da minha vida. A cada ponto redescobri minha força, minha criatividade e a vontade de recomeçar. O crochê me trouxe calma e confiança, e hoje tenho meu próprio ateliê cheio de amor.', 'ana paula.jpeg', 1, 1), ('Luzinete', 'Aluna · Fios que Curam', 'Ainda bem que encontrei a Inêz e as meninas na minha vida. Eu amo crochêtar, amo fazer parte dos Fios que Curam — está me curando aos poucos. Fazer o que gosta é um caminho para a cura.', 'luzinete.jpeg', 1, 2), ('Claudia', 'Aluna · Fios que Curam', 'Aprender com a Inêz está sendo incrível — cada aula é leve, inspiradora e motivadora. Evoluí muito e fiz peças que nem imaginava ser capaz. Recomendo de coração. E ainda me ajuda significativamente na ansiedade!', 'claudia.jpeg', 1, 3);"

echo.
echo === Regenerando Prisma Client ===
call npx prisma generate

echo.
echo === Concluido! ===
pause
