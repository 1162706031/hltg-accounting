-- 炼钢记录统计：测试用化学成分物品
-- 前置条件：已执行 V20260713_001__steelmaking_record.sql。
-- 可重复执行：依赖 item(name, item_type) 唯一键，已存在时更新测试成分和价格。

SET NAMES utf8mb4;

INSERT INTO item (
    name,
    item_type,
    is_active,
    chemical_enabled,
    chemical_composition,
    default_price,
    notes
) VALUES
(
    '测试-钼铁60',
    'alloy',
    1,
    1,
    JSON_OBJECT(
        'C', 0.05, 'Mn', 0.10, 'Si', 0.50, 'Cr', 0,
        'W', 0, 'Mo', 60.00, 'V', 0, 'Co', 0,
        'Nb', 0, 'Ni', 0, 'P', 0.03, 'S', 0.02
    ),
    150000.0000,
    '炼钢记录测试原料：钼铁60'
),
(
    '测试-高碳铬铁65',
    'alloy',
    1,
    1,
    JSON_OBJECT(
        'C', 6.50, 'Mn', 0.50, 'Si', 1.50, 'Cr', 65.00,
        'W', 0, 'Mo', 0, 'V', 0, 'Co', 0,
        'Nb', 0, 'Ni', 0, 'P', 0.04, 'S', 0.03
    ),
    9800.0000,
    '炼钢记录测试原料：高碳铬铁65'
),
(
    '测试-锰铁75',
    'alloy',
    1,
    1,
    JSON_OBJECT(
        'C', 1.50, 'Mn', 75.00, 'Si', 1.00, 'Cr', 0,
        'W', 0, 'Mo', 0, 'V', 0, 'Co', 0,
        'Nb', 0, 'Ni', 0, 'P', 0.20, 'S', 0.03
    ),
    7200.0000,
    '炼钢记录测试原料：锰铁75'
),
(
    '测试-硅铁75',
    'alloy',
    1,
    1,
    JSON_OBJECT(
        'C', 0.10, 'Mn', 0.40, 'Si', 75.00, 'Cr', 0,
        'W', 0, 'Mo', 0, 'V', 0, 'Co', 0,
        'Nb', 0, 'Ni', 0, 'P', 0.03, 'S', 0.02
    ),
    6800.0000,
    '炼钢记录测试原料：硅铁75'
),
(
    '测试-金属镍99',
    'alloy',
    1,
    1,
    JSON_OBJECT(
        'C', 0.01, 'Mn', 0, 'Si', 0.02, 'Cr', 0,
        'W', 0, 'Mo', 0, 'V', 0, 'Co', 0,
        'Nb', 0, 'Ni', 99.00, 'P', 0.01, 'S', 0.01
    ),
    128000.0000,
    '炼钢记录测试原料：金属镍99'
)
ON DUPLICATE KEY UPDATE
    is_active = VALUES(is_active),
    chemical_enabled = VALUES(chemical_enabled),
    chemical_composition = VALUES(chemical_composition),
    default_price = VALUES(default_price),
    notes = VALUES(notes),
    updated_at = CURRENT_TIMESTAMP;

SELECT id, name, item_type, chemical_enabled, chemical_composition, default_price
FROM item
WHERE name LIKE '测试-%'
ORDER BY id;
