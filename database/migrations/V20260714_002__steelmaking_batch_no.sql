-- 炼钢记录新增批次号：生产数据库增量升级脚本
-- 执行前必须备份数据库。本脚本不删除、不清空历史数据。

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
    'batch_no',
    'VARCHAR(30) NULL COMMENT ''炼钢批次号 — LG000001'' AFTER `id`'
);
DROP PROCEDURE add_column_if_missing;

-- 历史记录按主键稳定回填，重复执行结果不变。
UPDATE steelmaking_record
SET batch_no = CONCAT(
    'LG',
    CASE
        WHEN CHAR_LENGTH(CAST(id AS CHAR)) >= 6 THEN CAST(id AS CHAR)
        ELSE LPAD(id, 6, '0')
    END
)
WHERE batch_no IS NULL OR TRIM(batch_no) = '';

-- 历史空炉号与批次号保持一致；已有炉号原样保留。
UPDATE steelmaking_record
SET furnace_no = batch_no
WHERE furnace_no IS NULL OR TRIM(furnace_no) = '';

ALTER TABLE steelmaking_record
    MODIFY COLUMN batch_no VARCHAR(30) NOT NULL COMMENT '炼钢批次号 — LG000001';

SET @steel_batch_idx_sql = IF(
    EXISTS (
        SELECT 1 FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'steelmaking_record'
          AND index_name = 'idx_steelmaking_batch_no'
    ),
    'SELECT 1',
    'ALTER TABLE steelmaking_record ADD INDEX idx_steelmaking_batch_no (batch_no)'
);
PREPARE stmt FROM @steel_batch_idx_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'V20260714_002 steelmaking batch number migration completed' AS migration_status;
