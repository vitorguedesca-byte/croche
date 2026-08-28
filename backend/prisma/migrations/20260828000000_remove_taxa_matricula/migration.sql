-- A taxa de matrícula deixou de existir em 28/08/2026.
--
-- Até aqui, agendar a aula experimental custava uma taxa de R$20 à parte: a
-- aula era gratuita, a taxa é que segurava a vaga, e pagá-la matriculava a
-- aluna no plano escolhido. A 1ª mensalidade só caía no mês seguinte.
--
-- Agora o valor da matrícula está DILUÍDO na mensalidade. Na tela da
-- experimental a aluna escolhe o plano e o Pix já sai no valor cheio da
-- mensalidade (valorPlano1x ou valorPlano2x): pagou, está matriculada, o mês
-- corrente sai quitado e a próxima cobrança cai no mês seguinte, no mesmo dia.
--
-- Com isso não existe mais um preço de entrada separado para configurar, e a
-- coluna abaixo não é lida nem escrita por lugar nenhum do servidor.
--
-- O histórico não se perde: as reservas antigas seguem com paymentMethod
-- "Matrícula" e o servidor continua reconhecendo essa marca (MARCAS_MATRICULA
-- em src/server.js). As novas nascem como "1ª mensalidade".

ALTER TABLE `Settings`
  DROP COLUMN `taxaMatricula`;
