-- 基础资料规范化种子（来源：2026-07-21 本地数据库的 63 条库存、49 个物品）
-- 前置条件：已执行 V20260720_001、V20260721_002、V20260721_003。
--
-- 规则：
-- 1. 只补充基础资料，不直接 UPDATE/DELETE 物品、库存或历史单据。
-- 2. 物品名称只保留牌号和形态；规格只保留尺寸或单件重量。
-- 3. 件数、捆数、返料来源、加工状态应进入数量或备注，不进入规格。
-- 4. 使用幂等写法，可重复执行；同分类同编码/同名称已存在时不会重复插入。
--
-- 已执行的明显名称规范化：
-- MOV[尾空格] -> MOV；Ｘ６３ -> X63；A8呸 -> A8坯；12crmo管 -> 12CrMo管；
-- 2CR13锭 -> 2Cr13锭；3Cr17ni mo锭 -> 3Cr17NiMo锭；CrwmnA -> CrWMnA；
-- “元”按圆钢语义统一为“圆”；电渣5H12元 -> 5H12电渣圆；H13剥皮元55 -> H13剥皮圆。
--
-- 未擅自纳入规格的旧值：14支、15支、5支、改圆4支、改圆11支、切二圆、
-- 富峰返、金灿返H13NB切头、测试22、1捆/2捆等。请迁移业务数据时转入备注或数量字段。
-- D2CQ、906、电渣黑皮圆的牌号含义无法仅凭库存文本确认，名称暂保留并建议人工复核。

SET NAMES utf8mb4;

START TRANSACTION;

-- 一、加工工艺
INSERT INTO master_data_option (category, code, name, is_system, created_by) VALUES
('process', 'forging',   '锻造', TRUE, NULL),
('process', 'esr',       '电渣', TRUE, NULL),
('process', 'turning',   '车光', TRUE, NULL),
('process', 'annealing', '退火', TRUE, NULL)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    updated_at = CURRENT_TIMESTAMP;

-- 二、物品类型：不再使用“原料、成品、半成品”等笼统类型
INSERT INTO master_data_option (category, code, name, is_system, created_by) VALUES
('item_type', 'steel_grade',                  '钢种',   TRUE,  NULL),
('item_type', 'alloy',                        '合金',   TRUE,  NULL),
('item_type', 'scrap',                        '废料',   TRUE,  NULL),
('item_type', 'custom_652018c530444114',      '电炉锭', FALSE, NULL),
('item_type', 'electroslag_ingot',            '电渣锭', FALSE, NULL),
('item_type', 'flat_steel',                   '扁钢',   FALSE, NULL),
('item_type', 'steel_billet',                 '钢坯',   FALSE, NULL),
('item_type', 'pipe_material',                '管料',   FALSE, NULL),
('item_type', 'steel_block',                  '钢块',   FALSE, NULL),
('item_type', 'turning_chip',                 '刨花',   FALSE, NULL),
('item_type', 'slag',                         '炉渣',   FALSE, NULL),
('item_type', 'esr_black_round',              '电渣黑皮圆',     FALSE, NULL),
('item_type', 'black_round_steel',            '黑皮圆钢',       FALSE, NULL),
('item_type', 'peeled_round',                 '剥皮圆',         FALSE, NULL),
('item_type', 'turned_round',                 '车光圆',         FALSE, NULL),
('item_type', 'esr_peeled_round',             '电渣剥皮圆',     FALSE, NULL),
('item_type', 'esr_turned_round',             '电渣车光圆',     FALSE, NULL),
('item_type', 'esr_mother_bar',               '电渣母棒',       FALSE, NULL),
('item_type', 'cut_end',                      '切头',           FALSE, NULL),
('item_type', 'esr_forged_plate',             '电渣锻板',       FALSE, NULL),
('item_type', 'esr_rolled_plate',             '电渣轧板',       FALSE, NULL),
('item_type', 'esr_xiguang_plate',            '电渣洗光板',     FALSE, NULL),
('item_type', 'esr_xiguang_rolled_plate',     '电渣洗光轧板',   FALSE, NULL),
('item_type', 'forged_plate',                 '锻板',           FALSE, NULL),
('item_type', 'rolled_plate',                 '轧板',           FALSE, NULL),
('item_type', 'xiguang_rolled_plate',         '洗光轧板',       FALSE, NULL),
('item_type', 'xiguang_forged_plate',         '洗光锻板',       FALSE, NULL),
('item_type', 'rolled_flat',                  '轧扁',           FALSE, NULL),
('item_type', 'rolled_round',                 '轧圆',           FALSE, NULL),
('item_type', 'esr_rolled_flat',              '电渣轧扁',       FALSE, NULL),
('item_type', 'esr_rolled_round',             '电渣轧圆',       FALSE, NULL),
('item_type', 'esr_turned_rolled_round',      '电渣车光轧圆',   FALSE, NULL),
('item_type', 'esr_xiguang_rolled_flat',      '电渣洗光轧扁',   FALSE, NULL),
('item_type', 'turned_rolled_round',          '车光轧圆',       FALSE, NULL),
('item_type', 'xiguang_rolled_flat',          '洗光轧扁',       FALSE, NULL),
('item_type', 'rolled_billet',                '轧坯',           FALSE, NULL)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    updated_at = CURRENT_TIMESTAMP;

-- 三、物品名称：由全部现有 item 名称去重、纠错并合并同义写法
INSERT INTO master_data_option (category, code, name, is_system, created_by) VALUES
('item_name', '1.2367切头',          '1.2367切头',          FALSE, NULL),
('item_name', '1.2367母棒',          '1.2367母棒',          FALSE, NULL),
('item_name', '1.2367电渣锭',        '1.2367电渣锭',        FALSE, NULL),
('item_name', '12CrMo管',            '12CrMo管',            FALSE, NULL),
('item_name', '2Cr13锭',             '2Cr13锭',             FALSE, NULL),
('item_name', '3Cr17NiMo锭',         '3Cr17NiMo锭',         FALSE, NULL),
('item_name', '5H12圆钢',            '5H12圆钢',            FALSE, NULL),
('item_name', '5H12母棒',            '5H12母棒',            FALSE, NULL),
('item_name', '5H12电渣圆',          '5H12电渣圆',          FALSE, NULL),
('item_name', '5H12电渣棒',          '5H12电渣棒',          FALSE, NULL),
('item_name', '5H12电渣锭',          '5H12电渣锭',          FALSE, NULL),
('item_name', '5H12黑皮圆',          '5H12黑皮圆',          FALSE, NULL),
('item_name', '906坯',               '906坯',               FALSE, NULL),
('item_name', 'A8B母棒',             'A8B母棒',             FALSE, NULL),
('item_name', 'A8坯',                'A8坯',                FALSE, NULL),
('item_name', 'A8扁钢',              'A8扁钢',              FALSE, NULL),
('item_name', 'A8电渣锭',            'A8电渣锭',            FALSE, NULL),
('item_name', 'A8钢锭',              'A8钢锭',              FALSE, NULL),
('item_name', 'CrWMnA',              'CrWMnA',              FALSE, NULL),
('item_name', 'D2Co',                'D2Co',                FALSE, NULL),
('item_name', 'D2Co母棒',            'D2Co母棒',            FALSE, NULL),
('item_name', 'D2Co电渣圆',          'D2Co电渣圆',          FALSE, NULL),
('item_name', 'D2CQ母棒',            'D2CQ母棒',            FALSE, NULL),
('item_name', 'D2块',                'D2块',                FALSE, NULL),
('item_name', 'D2电渣锭',            'D2电渣锭',            FALSE, NULL),
('item_name', 'D2锭',                'D2锭',                FALSE, NULL),
('item_name', 'DC53A黑皮圆',         'DC53A黑皮圆',         FALSE, NULL),
('item_name', 'DC53B电渣圆',         'DC53B电渣圆',         FALSE, NULL),
('item_name', 'DC53电渣锭',          'DC53电渣锭',          FALSE, NULL),
('item_name', 'H13',                 'H13',                 FALSE, NULL),
('item_name', 'H13刨花',             'H13刨花',             FALSE, NULL),
('item_name', 'H13剥皮圆',           'H13剥皮圆',           FALSE, NULL),
('item_name', 'H13块',               'H13块',               FALSE, NULL),
('item_name', 'HM1锭',               'HM1锭',               FALSE, NULL),
('item_name', 'MOV',                 'MOV',                 FALSE, NULL),
('item_name', 'MOV切头',             'MOV切头',             FALSE, NULL),
('item_name', 'MOV锭',               'MOV锭',               FALSE, NULL),
('item_name', '钒铁',           '钒铁',           FALSE, NULL),
('item_name', 'X63',                 'X63',                 FALSE, NULL),
('item_name', 'X63扁钢',             'X63扁钢',             FALSE, NULL),
('item_name', 'X63电渣圆',           'X63电渣圆',           FALSE, NULL),
('item_name', '渣块',                '渣块',                FALSE, NULL),
('item_name', '电渣黑皮圆',          '电渣黑皮圆',          FALSE, NULL)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    updated_at = CURRENT_TIMESTAMP;

-- 四、规格：仅保留标准截面尺寸、直径或单件钢锭重量
INSERT INTO master_data_option (category, code, name, is_system, created_by) VALUES
('specification', '无规格',  '无规格',  FALSE, NULL),
('specification', 'Φ55',     'Φ55',     FALSE, NULL),
('specification', 'Φ120',    'Φ120',    FALSE, NULL),
('specification', 'Φ125',    'Φ125',    FALSE, NULL),
('specification', 'Φ170',    'Φ170',    FALSE, NULL),
('specification', 'Φ190',    'Φ190',    FALSE, NULL),
('specification', 'Φ200',    'Φ200',    FALSE, NULL),
('specification', 'Φ205',    'Φ205',    FALSE, NULL),
('specification', 'Φ250',    'Φ250',    FALSE, NULL),
('specification', 'Φ255',    'Φ255',    FALSE, NULL),
('specification', 'Φ400',    'Φ400',    FALSE, NULL),
('specification', '18×58',   '18×58',   FALSE, NULL),
('specification', '18×62',   '18×62',   FALSE, NULL),
('specification', '18×72',   '18×72',   FALSE, NULL),
('specification', '18×73',   '18×73',   FALSE, NULL),
('specification', '25×75',   '25×75',   FALSE, NULL),
('specification', '99×99',   '99×99',   FALSE, NULL),
('specification', '150kg',   '150kg',   FALSE, NULL),
('specification', '200kg',   '200kg',   FALSE, NULL),
('specification', '250kg',   '250kg',   FALSE, NULL),
('specification', '300kg',   '300kg',   FALSE, NULL),
('specification', '420kg',   '420kg',   FALSE, NULL),
('specification', '500kg',   '500kg',   FALSE, NULL),
('specification', '600kg',   '600kg',   FALSE, NULL),
('specification', '630kg',   '630kg',   FALSE, NULL),
('specification', '830kg',   '830kg',   FALSE, NULL),
('specification', '1T',      '1T',      FALSE, NULL),
('specification', '1.2T',    '1.2T',    FALSE, NULL),
('specification', '1.5T',    '1.5T',    FALSE, NULL),
('specification', '4T',      '4T',      FALSE, NULL)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    updated_at = CURRENT_TIMESTAMP;

COMMIT;

-- 执行后核对：确认上述规范项已出现。本脚本不会自动删除旧的不规范配置，
-- 因此在现有数据库直接执行时，旧项仍会保留，需结合业务引用另行迁移和清理。
SELECT category, code, name, is_system
FROM master_data_option
WHERE category IN ('process', 'item_type', 'item_name', 'specification')
ORDER BY category, name;
