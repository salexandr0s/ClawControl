-- Allow archived work order state in SQLite guards

UPDATE "work_orders"
SET "state" = 'planned'
WHERE "state" IS NULL
  OR TRIM("state") = ''
  OR "state" NOT IN ('planned', 'active', 'blocked', 'review', 'shipped', 'archived', 'cancelled');

DROP TRIGGER IF EXISTS "work_orders_state_guard_insert";
CREATE TRIGGER "work_orders_state_guard_insert"
BEFORE INSERT ON "work_orders"
FOR EACH ROW
WHEN NEW."state" IS NULL
  OR NEW."state" = ''
  OR NEW."state" NOT IN ('planned', 'active', 'blocked', 'review', 'shipped', 'archived', 'cancelled')
BEGIN
  SELECT RAISE(FAIL, 'INVALID_WORK_ORDER_STATE');
END;

DROP TRIGGER IF EXISTS "work_orders_state_guard_update";
CREATE TRIGGER "work_orders_state_guard_update"
BEFORE UPDATE OF "state" ON "work_orders"
FOR EACH ROW
WHEN NEW."state" IS NULL
  OR NEW."state" = ''
  OR NEW."state" NOT IN ('planned', 'active', 'blocked', 'review', 'shipped', 'archived', 'cancelled')
BEGIN
  SELECT RAISE(FAIL, 'INVALID_WORK_ORDER_STATE');
END;
