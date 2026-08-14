-- Até quando o Pix da mensalidade continua pagável ('YYYY-MM-DD').
-- O Sicredi expira a cobrança no fim do dia informado em calendario.expiracao;
-- sem guardar essa data aqui não há como saber se o QR salvo ainda funciona, e a
-- aluna que atrasa fica com um código que o banco recusa.
-- Nas mensalidades antigas a validade era exatamente o vencimento.
ALTER TABLE `Invoice` ADD COLUMN `pixExpiresOn` VARCHAR(10) NULL;

UPDATE `Invoice` SET `pixExpiresOn` = `dueDate` WHERE `pixCode` IS NOT NULL AND `pixExpiresOn` IS NULL;
