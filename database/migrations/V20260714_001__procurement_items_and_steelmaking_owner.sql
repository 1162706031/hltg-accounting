-- 采购单多物品入库 + 炼钢记录所属：生产数据库增量升级脚本
-- 执行前必须备份数据库。本脚本不删除现有业务表或历史数据。

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS add_column_if_missing;
DELIMITER $$
CREATE PROCEDURE add_column_if_missing(
    IN p_table VARCHAR(64),
    IN p_column VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = p_table AND column_name = p_column
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

CALL add_column_if_missing(
    'steelmaking_record',
    'owner_id',
    'BIGINT UNSIGNED NULL COMMENT ''所属单位'' AFTER `steel_grade`'
);
DROP PROCEDURE add_column_if_missing;

-- 历史炼钢记录统一回填为系统中的本厂单位；没有本厂主数据时主动终止，避免错误归属。
UPDATE steelmaking_record
SET owner_id = (
    SELECT internal_party.id
    FROM (SELECT id FROM party WHERE is_internal = 1 ORDER BY id LIMIT 1) AS internal_party
)
WHERE owner_id IS NULL;

DROP PROCEDURE IF EXISTS assert_steelmaking_owner_backfilled;
DELIMITER $$
CREATE PROCEDURE assert_steelmaking_owner_backfilled()
BEGIN
    IF EXISTS (SELECT 1 FROM steelmaking_record WHERE owner_id IS NULL) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = '炼钢记录所属回填失败：请先在 party 中配置 is_internal=1 的本厂单位';
    END IF;
END$$
DELIMITER ;
CALL assert_steelmaking_owner_backfilled();
DROP PROCEDURE assert_steelmaking_owner_backfilled;

ALTER TABLE steelmaking_record MODIFY COLUMN owner_id BIGINT UNSIGNED NOT NULL COMMENT '所属单位';

SET @steel_owner_idx_sql = IF(
    EXISTS (
        SELECT 1 FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'steelmaking_record' AND index_name = 'idx_steelmaking_owner'
    ),
    'SELECT 1',
    'ALTER TABLE steelmaking_record ADD INDEX idx_steelmaking_owner (owner_id)'
);
PREPARE stmt FROM @steel_owner_idx_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @steel_owner_fk_sql = IF(
    EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = DATABASE() AND table_name = 'steelmaking_record'
          AND constraint_name = 'fk_steelmaking_owner' AND constraint_type = 'FOREIGN KEY'
    ),
    'SELECT 1',
    'ALTER TABLE steelmaking_record ADD CONSTRAINT fk_steelmaking_owner FOREIGN KEY (owner_id) REFERENCES party(id) ON DELETE RESTRICT'
);
PREPARE stmt FROM @steel_owner_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS procurement_order_item (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT UNSIGNED NOT NULL,
    line_no         INT UNSIGNED NOT NULL DEFAULT 1,
    in_date         DATE NOT NULL COMMENT '本行入库日期',
    item_id         BIGINT UNSIGNED NOT NULL,
    item_spec       VARCHAR(50) DEFAULT NULL COMMENT '规格/品位',
    quantity        DECIMAL(18,6) NOT NULL DEFAULT 0,
    unit            VARCHAR(10) NOT NULL DEFAULT '吨',
    unit_price      DECIMAL(18,4) NOT NULL DEFAULT 0,
    amount          DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '金额 = 数量 × 单价',
    owner_id        BIGINT UNSIGNED NOT NULL COMMENT '入库归属单位',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_procurement_item_order (order_id),
    INDEX idx_procurement_item_date (in_date),
    INDEX idx_procurement_item_item (item_id),
    INDEX idx_procurement_item_owner (owner_id),
    CONSTRAINT fk_procurement_item_order FOREIGN KEY (order_id) REFERENCES procurement_order(id) ON DELETE RESTRICT,
    CONSTRAINT fk_procurement_item_item FOREIGN KEY (item_id) REFERENCES item(id) ON DELETE RESTRICT,
    CONSTRAINT fk_procurement_item_owner FOREIGN KEY (owner_id) REFERENCES party(id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='采购入库明细 — 一单可多品';

-- 每张旧采购单回填一条明细；重复执行不会重复插入。
INSERT INTO procurement_order_item (
    order_id, line_no, in_date, item_id, item_spec, quantity, unit,
    unit_price, amount, owner_id, created_at, updated_at
)
SELECT
    po.id,
    1,
    COALESCE(po.purchase_date, DATE(po.created_at), CURRENT_DATE),
    po.item_id,
    po.item_spec,
    po.quantity,
    po.unit,
    po.unit_price,
    po.amount,
    po.owner_id,
    po.created_at,
    po.updated_at
FROM procurement_order AS po
WHERE po.item_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM procurement_order_item AS poi WHERE poi.order_id = po.id
  );

SELECT 'V20260714_001 procurement items and steelmaking owner migration completed' AS migration_status;
