-- Fios que Curam — normaliza horários salvos como intervalo/texto sujo
-- Ex.: "09:00 as 11:00" -> "09:00". Rode UMA vez no banco de produção.
-- Requer MySQL 8+ (REGEXP_SUBSTR). Faça um backup antes: mysqldump ...

-- 1) confira o que será alterado (opcional):
SELECT id, time FROM Slot    WHERE CHAR_LENGTH(time) > 5;
SELECT id, time FROM Booking WHERE CHAR_LENGTH(time) > 5;

-- 2) aplique a correção:
UPDATE Slot
   SET time = REGEXP_SUBSTR(time, '[0-9]{1,2}:[0-9]{2}')
 WHERE time REGEXP '[0-9]{1,2}:[0-9]{2}'
   AND time <> REGEXP_SUBSTR(time, '[0-9]{1,2}:[0-9]{2}');

UPDATE Booking
   SET time = REGEXP_SUBSTR(time, '[0-9]{1,2}:[0-9]{2}')
 WHERE time REGEXP '[0-9]{1,2}:[0-9]{2}'
   AND time <> REGEXP_SUBSTR(time, '[0-9]{1,2}:[0-9]{2}');

-- 3) (opcional) padroniza "9:00" -> "09:00":
UPDATE Slot    SET time = LPAD(time, 5, '0') WHERE CHAR_LENGTH(time) = 4;
UPDATE Booking SET time = LPAD(time, 5, '0') WHERE CHAR_LENGTH(time) = 4;
