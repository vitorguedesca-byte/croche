-- Matrícula de aluna nova feita pelo painel (atendimento) ou pelo portal da
-- sala (08/10/2026). Só adição. Sem esta data, a 1ª mensalidade dessas alunas
-- entrava no relatório de Vendas como mensalidade comum e a matrícula não
-- era contada no mês.
ALTER TABLE `Client` ADD COLUMN `matriculaPainelAt` VARCHAR(10) NULL;
