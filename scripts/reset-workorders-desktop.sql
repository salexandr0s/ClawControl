PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE TRANSACTION;

-- Remove work order execution graph data for non-reserved work orders.
DELETE FROM operation_stories
WHERE work_order_id NOT IN ('system', 'console');

DELETE FROM approvals
WHERE work_order_id NOT IN ('system', 'console');

DELETE FROM artifacts
WHERE work_order_id NOT IN ('system', 'console');

DELETE FROM messages
WHERE work_order_id NOT IN ('system', 'console');

DELETE FROM operation_completion_tokens
WHERE work_order_id IS NULL
   OR work_order_id NOT IN ('system', 'console');

DELETE FROM operations
WHERE work_order_id NOT IN ('system', 'console');

DELETE FROM receipts
WHERE work_order_id NOT IN ('system', 'console');

-- Remove stale workflow/work-order operational activity noise while preserving
-- general system telemetry.
DELETE FROM activities
WHERE (entity_type = 'work_order' AND entity_id NOT IN ('system', 'console'))
   OR entity_type IN ('operation', 'operation_story', 'approval')
   OR type LIKE 'workflow.%'
   OR type LIKE 'work_order.%'
   OR type LIKE 'operation.%'
   OR type LIKE 'escalation.%';

DELETE FROM work_orders
WHERE id NOT IN ('system', 'console');

-- Reset work order sequence allocation.
INSERT INTO work_order_sequences (id, next_value, updated_at)
SELECT 1, 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM work_order_sequences WHERE id = 1
);

UPDATE work_order_sequences
SET next_value = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

COMMIT;
