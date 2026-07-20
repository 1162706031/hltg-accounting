-- 基础资料配置：工艺名称、物品类型、规格
-- 执行前必须备份数据库。本脚本保留并导入现有业务值。

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS master_data_option (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category    VARCHAR(32) NOT NULL COMMENT 'process/item_type/specification',
    code        VARCHAR(80) NOT NULL COMMENT '业务存储值；规格与名称相同',
    name        VARCHAR(80) NOT NULL COMMENT '显示名称',
    is_system   BOOLEAN NOT NULL DEFAULT FALSE COMMENT '系统内置项不可删除',
    created_by  BIGINT UNSIGNED DEFAULT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_master_data_category_code (category, code),
    UNIQUE KEY uk_master_data_category_name (category, name),
    INDEX idx_master_data_category (category),
    CONSTRAINT fk_master_data_created_by FOREIGN KEY (created_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='基础资料选项';

INSERT IGNORE INTO master_data_option (category, code, name, is_system) VALUES
('item_type', 'steel_grade', '钢种', TRUE),
('item_type', 'raw_material', '原料', TRUE),
('item_type', 'alloy', '合金', TRUE),
('item_type', 'finished_product', '成品', TRUE),
('item_type', 'semi_finished', '半成品', TRUE),
('item_type', 'scrap', '废料', TRUE),
('process', 'forging', '锻造', TRUE),
('process', 'esr', '电渣', TRUE),
('process', 'turning', '车光', TRUE),
('process', 'annealing', '退火', TRUE);

-- 将历史规格汇总进规格字典，确保升级后已有数据仍可继续选择和引用。
INSERT IGNORE INTO master_data_option (category, code, name, is_system)
SELECT 'specification', spec_name, spec_name, FALSE
FROM (
    SELECT DISTINCT TRIM(spec) AS spec_name FROM inventory
    UNION SELECT DISTINCT TRIM(spec) FROM smelting_inbound
    UNION SELECT DISTINCT TRIM(spec) FROM alloy_addition
    UNION SELECT DISTINCT TRIM(spec) FROM processing_outbound
    UNION SELECT DISTINCT TRIM(spec) FROM processing_inbound
    UNION SELECT DISTINCT TRIM(item_spec) FROM procurement_order
    UNION SELECT DISTINCT TRIM(item_spec) FROM procurement_order_item
    UNION SELECT DISTINCT TRIM(spec) FROM sales_order_item
) historical_specs
WHERE spec_name IS NOT NULL AND spec_name <> '';

-- 解除原 ENUM 限制，允许业务记录引用新增的字典编码。
ALTER TABLE item MODIFY COLUMN item_type VARCHAR(80) NOT NULL COMMENT '物品类型（基础资料编码）';
ALTER TABLE outsource_order MODIFY COLUMN process_type VARCHAR(80) NOT NULL COMMENT '工艺（基础资料编码）';
ALTER TABLE procurement_order MODIFY COLUMN item_spec VARCHAR(80) NULL COMMENT '规格/品位';
ALTER TABLE procurement_order_item MODIFY COLUMN item_spec VARCHAR(80) NULL COMMENT '规格/品位';

SELECT 'V20260720_001 master data options migration completed' AS migration_status;
