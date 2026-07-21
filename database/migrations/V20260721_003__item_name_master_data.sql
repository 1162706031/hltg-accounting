-- 将物品名称纳入基础资料。名称最长与 item.name 保持一致。
ALTER TABLE master_data_option
    MODIFY COLUMN code VARCHAR(100) NOT NULL COMMENT '业务存储值；物品名称和规格直接使用规范名称',
    MODIFY COLUMN name VARCHAR(100) NOT NULL COMMENT '页面显示名称';

-- 升级时把全部现有物品名称导入基础资料，保证已有物品可以继续编辑。
INSERT IGNORE INTO master_data_option (category, code, name, is_system, created_by)
SELECT DISTINCT 'item_name', item.name, item.name, FALSE, NULL
FROM item
WHERE TRIM(item.name) <> '';
