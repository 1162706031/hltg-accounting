-- 炼钢记录统计模块：生产数据库增量升级脚本
-- 适用：MySQL 8.0+；执行前必须完成全库备份，并先运行 preflight_steelmaking.sql。
-- 本脚本不删除、不清空任何现有表或历史数据。

SET NAMES utf8mb4;

-- 使用 INFORMATION_SCHEMA 使物品表扩展可安全重复检查；旧物品 chemical_enabled 自动为 0。
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

CALL add_column_if_missing('item', 'chemical_enabled',
    'TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''是否启用化学成分'' AFTER `is_active`');
CALL add_column_if_missing('item', 'chemical_composition',
    'JSON NULL COMMENT ''C/Mn/Si/Cr/W/Mo/V/Co/Nb/Ni/P/S 质量百分比'' AFTER `chemical_enabled`');
CALL add_column_if_missing('item', 'default_price',
    'DECIMAL(18,4) NULL COMMENT ''基础默认单价（元/吨）'' AFTER `chemical_composition`');

DROP PROCEDURE add_column_if_missing;

SET @idx_chemical_sql = IF(
    EXISTS (
        SELECT 1 FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'item' AND index_name = 'idx_chemical_enabled'
    ),
    'SELECT 1',
    'ALTER TABLE item ADD INDEX idx_chemical_enabled (chemical_enabled)'
);
PREPARE stmt FROM @idx_chemical_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS steelmaking_record (
    id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    record_date           DATE NOT NULL COMMENT '炼钢日期',
    furnace_no            VARCHAR(50) NOT NULL COMMENT '炉号；非全局唯一',
    steel_grade           VARCHAR(100) NOT NULL COMMENT '钢种快照/录入值',
    ingot_type            VARCHAR(100) DEFAULT NULL COMMENT '锭型',
    furnace_weight        DECIMAL(18,6) NOT NULL COMMENT '用户原始炉重',
    furnace_weight_unit   ENUM('kg','ton') NOT NULL COMMENT '用户原始炉重单位',
    furnace_weight_kg     DECIMAL(18,6) NOT NULL COMMENT '标准炉重 kg',
    power_on_time         TIME DEFAULT NULL COMMENT '送电时间',
    tap_time              TIME DEFAULT NULL COMMENT '出钢时间',
    tap_temperature       DECIMAL(10,2) DEFAULT NULL COMMENT '出钢温度 ℃',
    pouring_time          TIME DEFAULT NULL COMMENT '浇注时间',
    total_cost            DECIMAL(18,4) DEFAULT NULL COMMENT '可计算原料总成本',
    cost_per_ton          DECIMAL(18,4) DEFAULT NULL COMMENT '单吨成本',
    cost_complete         TINYINT(1) NOT NULL DEFAULT 1 COMMENT '全部原料成本是否可计算',
    status                ENUM('draft','confirmed') NOT NULL DEFAULT 'draft',
    remark                TEXT DEFAULT NULL,
    created_by            BIGINT UNSIGNED DEFAULT NULL,
    updated_by            BIGINT UNSIGNED DEFAULT NULL,
    created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted               TINYINT(1) NOT NULL DEFAULT 0 COMMENT '软删除',

    INDEX idx_steelmaking_record_date (record_date),
    INDEX idx_steelmaking_furnace_no (furnace_no),
    INDEX idx_steelmaking_furnace_date (furnace_no, record_date),
    INDEX idx_steelmaking_steel_grade (steel_grade),
    INDEX idx_steelmaking_status (status),
    INDEX idx_steelmaking_deleted (deleted),
    CONSTRAINT fk_steelmaking_created_by FOREIGN KEY (created_by) REFERENCES user(id),
    CONSTRAINT fk_steelmaking_updated_by FOREIGN KEY (updated_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='炼钢记录统计主表；与库存完全解耦';

CREATE TABLE IF NOT EXISTS steelmaking_record_material (
    id                              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    record_id                       BIGINT UNSIGNED NOT NULL,
    item_id                         BIGINT UNSIGNED NOT NULL,
    item_name_snapshot              VARCHAR(100) NOT NULL,
    item_code_snapshot              VARCHAR(50) DEFAULT NULL COMMENT '当前系统以物品 ID 作为编号快照',
    chemical_composition_snapshot   JSON NOT NULL,
    default_price_snapshot          DECIMAL(18,4) DEFAULT NULL,
    custom_price                    DECIMAL(18,4) DEFAULT NULL COMMENT '本次实际单价（元/吨）',
    final_unit_price                DECIMAL(18,4) DEFAULT NULL COMMENT '最终采用单价（元/吨）',
    input_weight                    DECIMAL(18,6) NOT NULL COMMENT '用户原始重量',
    input_weight_unit               ENUM('kg','ton') NOT NULL,
    weight_kg                       DECIMAL(18,6) NOT NULL COMMENT '标准重量 kg',
    material_cost                   DECIMAL(18,4) DEFAULT NULL,
    sort_order                      INT UNSIGNED NOT NULL DEFAULT 1,
    created_at                      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at                      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_steelmaking_material_record (record_id),
    INDEX idx_steelmaking_material_item (item_id),
    CONSTRAINT fk_steelmaking_material_record FOREIGN KEY (record_id) REFERENCES steelmaking_record(id) ON DELETE RESTRICT,
    CONSTRAINT fk_steelmaking_material_item FOREIGN KEY (item_id) REFERENCES item(id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='炼钢原料明细及历史快照';

CREATE TABLE IF NOT EXISTS steelmaking_record_composition (
    id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    record_id                BIGINT UNSIGNED NOT NULL,
    element_code             VARCHAR(10) NOT NULL,
    element_name             VARCHAR(30) NOT NULL,
    element_weight_kg        DECIMAL(18,6) NOT NULL DEFAULT 0,
    theoretical_percentage   DECIMAL(12,6) NOT NULL DEFAULT 0,
    actual_percentage        DECIMAL(12,6) DEFAULT NULL,
    deviation_percentage     DECIMAL(12,6) DEFAULT NULL,
    created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_steelmaking_record_element (record_id, element_code),
    INDEX idx_steelmaking_composition_record (record_id),
    INDEX idx_steelmaking_element_code (element_code),
    CONSTRAINT fk_steelmaking_composition_record FOREIGN KEY (record_id) REFERENCES steelmaking_record(id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='炼钢理论/实际成分逐元素分析';

-- 明确回填旧物品；ADD COLUMN 默认值已保证此语句不会改变其他业务字段。
UPDATE item SET chemical_enabled = 0 WHERE chemical_enabled IS NULL;

SELECT 'V20260713_001 steelmaking migration completed' AS migration_status;
