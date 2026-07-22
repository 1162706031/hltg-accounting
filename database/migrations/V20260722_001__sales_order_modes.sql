-- 销售订单增加两种销售模式：指定库存销售、按物品规格下单后完成时自动扣库。
-- 历史订单统一保留为指定库存模式，不改变既有扣库行为。

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS add_sales_mode_if_missing;
DELIMITER $$
CREATE PROCEDURE add_sales_mode_if_missing()
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'sales_order'
          AND column_name = 'sales_mode'
    ) THEN
        ALTER TABLE sales_order
            ADD COLUMN sales_mode ENUM('inventory','item_spec') NOT NULL DEFAULT 'inventory'
            COMMENT 'inventory=指定库存销售 item_spec=按物品规格下单、完成时自动扣库'
            AFTER party_id;
    END IF;
END$$
DELIMITER ;

CALL add_sales_mode_if_missing();
DROP PROCEDURE add_sales_mode_if_missing;

UPDATE sales_order SET sales_mode = 'inventory' WHERE sales_mode IS NULL;

SELECT 'V20260722_001 sales order modes migration completed' AS migration_status;
