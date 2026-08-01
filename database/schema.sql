-- ============================================================================
-- 汇隆特钢 · 会计数据库建表脚本 (v2.2 — 重构版)
-- 数据库引擎: MySQL 8.0+ / MariaDB 10.5+
-- 字符集: utf8mb4 (支持中文)
--
-- v2.6 变更 (2026-07-13):
--   - item 增加化学成分启用、成分 JSON 和默认元/吨单价。
--   - 新增 steelmaking_record/material/composition 炼钢记录统计，与库存完全解耦。
--
-- v2.5 变更 (2026-06-15):
--   - processing_inbound（外协回厂）加 owner_id：回厂入库归属可逐行指定（前端钢种/归属
--     均用 QuickCreate 下拉，可现场新建），留空回退本厂。
--
-- v2.4 变更 (2026-06-15):
--   - 明细行支持「每行独立日期」，订单主表日期作为默认值/兜底：
--     · alloy_addition 加 date（补加日期）
--     · outsource_order 加 out_date / in_date（发出/回厂总体日期，明细行默认值/兜底）
--     · sales_order_item 加 ship_date（行级发货日期）
--   审核/完成扣库时优先用行日期，留空回退订单日期。
--
-- v2.3 变更 (2026-06-15):
--   - 「从现存库存扣减」的明细行统一改为直接记录 inventory_id（与 sales_order_item
--     同口径），审核扣减按 inventory_id 精确出库，消除 item_id+owner+spec 反查歧义：
--     · smelting_inbound (side=in 投料行)、alloy_addition、processing_outbound 各加 inventory_id
--     · side=out 出钢 / 回厂 inbound 仍为新产出入库，按 owner_id 归属 find-or-create，不加 inventory_id
--
-- v2.2 变更 (2026-06-14):
--   - 库存与单据统一为「数量(quantity) + 单位(unit)」计量，单位可取 吨/千克/支：--     · inventory: 去除 current_pieces，current_weight → current_quantity
--     · inventory_log: 去除 *_pieces，*_weight → *_quantity，新增 unit 快照列
--     · 明细行 (smelting_inbound/processing_outbound/processing_inbound/
--       sales_order_item/party_reconciliation): 去除 pieces，weight_ton → quantity，新增 unit 列
--     · alloy_addition: weight_kg → quantity (+unit, 默认千克)
--   - 损耗类字段 (casting_loss_kg/saw_head_ton/loss_ton) 保持不变（物理损耗量，非计量数量）
--
-- v2.1 变更 (2026-06-13):
--   - item 去除 spec/default_unit：物品为抽象定义，规格与单位归库存(inventory)
--     与单据，唯一约束改为 (name, item_type)
--   - inventory_log 重构为独立自包含日志：去除 inventory/user 外键，inventory_id
--     可空；新增 item_id/item_name/item_spec/item_type/owner_name/operator_name
--     快照列，写入时固化；change_type 增加 'delete'。库存项删除不影响历史日志
--   - v_party_balance 增加 应开未开发票(net_to_issue)/应收未收发票(net_to_receive) 两列净额 (设计5.2)
--
-- v2.0 变更 (2026-06-12):
--   - party_reconciliation.recon_status 2态→4态 (设计4.9)
--   - smelting_inbound/processing_outbound/processing_inbound 加 unit_price+amount
--   - sales_order 拆为 header(销售主表)+sales_order_item(明细) 支持一单多品
--   - payment 加 party_id + linked_orders(JSON)，ref_type/ref_id 改为可选
--   - invoice 加 direction(实际已开/已收) + party_id
--   - procurement_order/sales_order 加 tax_rate/tax_amount/subtotal/total_amount
--   - procurement_order 加 owner_id，完成时按归属入库
--   - smelting_inbound 出钢行加 owner_id，sales_order_item 加 inventory_id，避免库存归属歧义
--   - smelting_order/outsource_order/procurement_order/sales_order 加 need_invoice
--   - v_party_balance 修复 p.type 不存在的 bug
--   - 本厂纳入 party 主数据 (is_internal=TRUE)，库存归属统一使用 owner_id
--   - party_reconciliation 去除审核状态，收付款/实际开票均使用独立表
-- ============================================================================

CREATE DATABASE IF NOT EXISTS hltg_accounting
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE hltg_accounting;


-- ============================================================================
-- 〇、用户与权限
-- ============================================================================

CREATE TABLE user (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username    VARCHAR(50)   NOT NULL UNIQUE COMMENT '登录名',
    password    VARCHAR(255)  NOT NULL COMMENT '密码 (bcrypt)',
    real_name   VARCHAR(50)   DEFAULT NULL COMMENT '真实姓名',
    role        ENUM('admin','accountant','reviewer','viewer') NOT NULL DEFAULT 'accountant'
                COMMENT 'admin=管理员 accountant=会计(录入) reviewer=审核员 viewer=只读',
    is_active   BOOLEAN       DEFAULT TRUE,
    created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB COMMENT='系统用户';

-- 插入默认管理员 (密码: admin123 → bcrypt)
INSERT INTO user (username, password, real_name, role) VALUES
('admin', '$2b$12$lra2MpLSikeCk.14typQrO3HQVs/fW8XKDJhDUk.wzpispuLVl4qS', '系统管理员', 'admin');


-- ============================================================================
-- 一、核心字典 (2 张)
-- ============================================================================

-- 1. 往来单位（本厂 / 客户 / 供应商 / 外协厂）
-- 同一单位可同时是客户+供应商+外协厂；本厂作为特殊 party 参与库存归属和业务单据
CREATE TABLE party (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL COMMENT '单位名称',
    short_name  VARCHAR(50)   DEFAULT NULL COMMENT '简称',
    is_customer  BOOLEAN       DEFAULT FALSE COMMENT '是否为客户',
    is_supplier  BOOLEAN       DEFAULT FALSE COMMENT '是否为供应商',
    is_processor BOOLEAN       DEFAULT FALSE COMMENT '是否为外协厂',
    is_internal  BOOLEAN       DEFAULT FALSE COMMENT '是否为本厂',
    contact     VARCHAR(50)   DEFAULT NULL COMMENT '联系人',
    phone       VARCHAR(30)   DEFAULT NULL COMMENT '电话',
    address     VARCHAR(200)  DEFAULT NULL COMMENT '地址',
    notes       TEXT          DEFAULT NULL COMMENT '备注',
    created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_customer (is_customer),
    INDEX idx_supplier (is_supplier),
    INDEX idx_processor (is_processor),
    INDEX idx_internal (is_internal),
    INDEX idx_name (name)
) ENGINE=InnoDB COMMENT='往来单位：本厂、客户、供应商、外协厂（可多角色）';

-- 默认本厂单位；本厂冶炼、内部库存、采购入库等均归属该 party
INSERT INTO party (name, short_name, is_internal, notes) VALUES
('本厂', '本厂', TRUE, '系统默认内部单位');


-- 2. 基础资料配置 + 统一物品字典（替代原 steel_grade + material）
-- 物品为抽象定义，仅含名称/类型/状态；规格(spec)与单位属于库存与单据，不在此表
CREATE TABLE master_data_option (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    category    VARCHAR(32) NOT NULL COMMENT 'process/item_type/item_name/specification',
    code        VARCHAR(100) NOT NULL COMMENT '业务存储值；物品名称和规格直接使用规范名称',
    name        VARCHAR(100) NOT NULL COMMENT '显示名称',
    is_system   BOOLEAN NOT NULL DEFAULT FALSE COMMENT '系统内置项不可删除',
    created_by  BIGINT UNSIGNED DEFAULT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_master_data_category_code (category, code),
    UNIQUE KEY uk_master_data_category_name (category, name),
    INDEX idx_master_data_category (category),
    CONSTRAINT fk_master_data_created_by FOREIGN KEY (created_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='基础资料选项：工艺名称、物品类型、物品名称、规格';

INSERT INTO master_data_option (category, code, name, is_system) VALUES
('item_type', 'alloy', '合金', TRUE),
('item_type', 'scrap', '废料', TRUE),
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
('item_type', 'rolled_billet',                '轧坯',           FALSE, NULL),
('process', 'forging', '锻造', TRUE),
('process', 'esr', '电渣', TRUE),
('process', 'turning', '车光', TRUE),
('process', 'annealing', '退火', TRUE);

CREATE TABLE item (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL COMMENT '物品名称 — H13, 钼铁60%, 2Cr14Ni ...',
    item_type   VARCHAR(80) NOT NULL COMMENT '物品类型（基础资料编码）',
    is_active   BOOLEAN       DEFAULT TRUE COMMENT '是否启用',
    chemical_enabled     TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否启用化学成分',
    chemical_composition JSON DEFAULT NULL COMMENT 'C/Mn/Si/Cr/W/Mo/V/Co/Nb/Ni/P/S 质量百分比',
    default_price        DECIMAL(18,4) DEFAULT NULL COMMENT '基础默认单价（元/吨）',
    notes       TEXT          DEFAULT NULL COMMENT '备注',
    created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_name_type_spec (name, item_type),
    INDEX idx_type (item_type),
    INDEX idx_active (is_active),
    INDEX idx_chemical_enabled (chemical_enabled),
    INDEX idx_name (name)
) ENGINE=InnoDB COMMENT='统一物品字典：钢种/原料/合金/成品/半成品/废料（规格/单位归库存，不在此表）';


-- ============================================================================
-- 1.1 炼钢记录统计（与库存完全解耦）
-- ============================================================================

CREATE TABLE steelmaking_record (
    id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_no              VARCHAR(30) NOT NULL COMMENT '炼钢批次号 — LG000001',
    record_date           DATE NOT NULL COMMENT '炼钢日期',
    furnace_no            VARCHAR(50) NOT NULL COMMENT '炉号；非全局唯一',
    steel_grade           VARCHAR(100) NOT NULL COMMENT '钢种快照/录入值',
    owner_id              BIGINT UNSIGNED NOT NULL COMMENT '所属单位',
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
    INDEX idx_steelmaking_batch_no (batch_no),
    INDEX idx_steelmaking_furnace_no (furnace_no),
    INDEX idx_steelmaking_furnace_date (furnace_no, record_date),
    INDEX idx_steelmaking_steel_grade (steel_grade),
    INDEX idx_steelmaking_owner (owner_id),
    INDEX idx_steelmaking_status (status),
    INDEX idx_steelmaking_deleted (deleted),
    CONSTRAINT fk_steelmaking_owner FOREIGN KEY (owner_id) REFERENCES party(id),
    CONSTRAINT fk_steelmaking_created_by FOREIGN KEY (created_by) REFERENCES user(id),
    CONSTRAINT fk_steelmaking_updated_by FOREIGN KEY (updated_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='炼钢记录统计主表；与库存完全解耦';

CREATE TABLE steelmaking_record_material (
    id                              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    record_id                       BIGINT UNSIGNED NOT NULL,
    item_id                         BIGINT UNSIGNED NOT NULL,
    item_name_snapshot              VARCHAR(100) NOT NULL,
    item_code_snapshot              VARCHAR(50) DEFAULT NULL COMMENT '当前系统以物品 ID 作为编号快照',
    chemical_composition_snapshot   JSON NOT NULL,
    default_price_snapshot          DECIMAL(18,4) DEFAULT NULL,
    custom_price                    DECIMAL(18,4) DEFAULT NULL COMMENT '用户录入的本次实际单价',
    custom_price_unit               ENUM('yuan_per_kg','yuan_per_ton') NOT NULL DEFAULT 'yuan_per_ton' COMMENT '本次单价录入单位',
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

CREATE TABLE steelmaking_record_composition (
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


-- ============================================================================
-- 二、冶炼加工 — 模板 ① 外来冶炼 + ⑨ 本厂冶炼
-- ============================================================================

CREATE TABLE smelting_order (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_no          VARCHAR(30)   NOT NULL COMMENT '批次号 — 3000001',
    party_id          BIGINT UNSIGNED NOT NULL COMMENT '业务单位；外来冶炼=客户，本厂冶炼=本厂 party',
    order_type        ENUM('ext_smelting','inhouse') NOT NULL COMMENT '外来冶炼 / 本厂冶炼',
    feed_date         DATE          DEFAULT NULL COMMENT '投料日期',
    tap_date          DATE          DEFAULT NULL COMMENT '出钢日期',
    casting_loss_kg   DECIMAL(10,1) DEFAULT NULL COMMENT '浇筑溜槽/残留 (kg)',
    casting_loss_pct  DECIMAL(5,2)  DEFAULT NULL COMMENT '残留百分比',
    yield_pct         DECIMAL(5,2)  DEFAULT NULL COMMENT '冶炼成锭率 %',
    unit_price        DECIMAL(10,2) DEFAULT NULL COMMENT '加工单价 (元/吨)',
    processing_amount DECIMAL(12,2) DEFAULT NULL COMMENT '加工金额 (元)',
    tax_rate          DECIMAL(5,2)  DEFAULT 13.00 COMMENT '税率(%)',
    tax_amount        DECIMAL(12,2) DEFAULT NULL COMMENT '税额',
    subtotal          DECIMAL(12,2) DEFAULT NULL COMMENT '小计(税前)',
    total_amount      DECIMAL(12,2) DEFAULT NULL COMMENT '合计(含税)',
    need_invoice      BOOLEAN       DEFAULT FALSE COMMENT '是否需要开票 — 从订单导入对账时判断',
    status            ENUM('draft','pending_review','approved','in_progress','completed','rejected') NOT NULL DEFAULT 'draft'
                      COMMENT 'draft=草稿 in_progress=进行中/已扣库 pending_review=待审核 approved=已审核 completed=已完成 rejected=驳回',
    notes             TEXT          DEFAULT NULL,
    created_by        BIGINT UNSIGNED DEFAULT NULL COMMENT '录入人',
    audited_by        BIGINT UNSIGNED DEFAULT NULL COMMENT '审核人',
    audited_at        DATETIME      DEFAULT NULL COMMENT '审核时间',
    created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_batch (batch_no),
    INDEX idx_party (party_id),
    INDEX idx_type (order_type),
    INDEX idx_feed_date (feed_date),
    INDEX idx_status (status),

    CONSTRAINT fk_smelting_party FOREIGN KEY (party_id) REFERENCES party(id),
    CONSTRAINT fk_smelting_created FOREIGN KEY (created_by) REFERENCES user(id),
    CONSTRAINT fk_smelting_audited FOREIGN KEY (audited_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='冶炼加工单 — 外来冶炼 + 本厂冶炼';


-- 冶炼来料 / 出料明细 (side=in 来料, side=out 出钢)
CREATE TABLE smelting_inbound (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT UNSIGNED NOT NULL,
    side            ENUM('in','out') NOT NULL COMMENT 'in=来料/投料  out=出料/出钢',
    line_no         TINYINT UNSIGNED DEFAULT 1 COMMENT '同批次内行号',
    date            DATE          DEFAULT NULL COMMENT '来料日期 / 出料日期',
    item_id         BIGINT UNSIGNED DEFAULT NULL COMMENT '物品 (钢种)',
    inventory_id    BIGINT UNSIGNED DEFAULT NULL COMMENT 'side=in 投料：所选库存项，审核按此 id 出库；side=out 出钢留空',
    quantity        DECIMAL(10,3) DEFAULT 0 COMMENT '数量 (单位见 unit)',
    unit            VARCHAR(10)   DEFAULT '吨' COMMENT '单位 (吨/千克/支)',
    spec            VARCHAR(80)   DEFAULT NULL COMMENT '规格 — 300*12, 630*7 ...',
    furnace_no      VARCHAR(20)   DEFAULT NULL COMMENT '炉号 — 3-60-63',
    owner_id        BIGINT UNSIGNED DEFAULT NULL COMMENT '出钢入库归属；side=out 时必填，side=in 可空按订单 party',
    unit_price      DECIMAL(10,2) DEFAULT NULL COMMENT '单价 (元/单位) — 可选填,留空不计入费用',
    amount          DECIMAL(12,2) DEFAULT NULL COMMENT '金额 = quantity × unit_price',
    notes           TEXT          DEFAULT NULL,

    INDEX idx_order (order_id),
    INDEX idx_item (item_id),
    INDEX idx_owner (owner_id),
    INDEX idx_inventory (inventory_id),

    CONSTRAINT fk_si_order FOREIGN KEY (order_id)  REFERENCES smelting_order(id) ON DELETE CASCADE,
    CONSTRAINT fk_si_item  FOREIGN KEY (item_id)   REFERENCES item(id),
    CONSTRAINT fk_si_owner FOREIGN KEY (owner_id)  REFERENCES party(id)
) ENGINE=InnoDB COMMENT='冶炼来料/出料明细';

-- 一条出钢明细可关联多条炼钢记录（炉号）
CREATE TABLE smelting_inbound_steelmaking_record (
    smelting_inbound_id   BIGINT UNSIGNED NOT NULL,
    steelmaking_record_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (smelting_inbound_id, steelmaking_record_id),
    INDEX idx_sisr_steelmaking_record (steelmaking_record_id),
    CONSTRAINT fk_sisr_smelting_inbound FOREIGN KEY (smelting_inbound_id) REFERENCES smelting_inbound(id) ON DELETE CASCADE,
    CONSTRAINT fk_sisr_steelmaking_record FOREIGN KEY (steelmaking_record_id) REFERENCES steelmaking_record(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='冶炼出钢明细与炼钢记录多对多关联';


-- 补加合金
CREATE TABLE alloy_addition (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id      BIGINT UNSIGNED NOT NULL,
    item_id       BIGINT UNSIGNED NOT NULL COMMENT '物品 (合金)',
    inventory_id  BIGINT UNSIGNED DEFAULT NULL COMMENT '所选库存项；审核时按此 id 出库',
    date          DATE          DEFAULT NULL COMMENT '补加日期；留空回退订单投料日期',
    quantity      DECIMAL(10,1) DEFAULT 0 COMMENT '数量 (单位见 unit)',
    unit          VARCHAR(10)   DEFAULT '千克' COMMENT '单位 (吨/千克/支)',
    spec          VARCHAR(80)   DEFAULT NULL COMMENT '规格快照 — 按所选库存项带出',
    unit_price    DECIMAL(10,2) DEFAULT NULL COMMENT '单价 (元/单位)',
    amount        DECIMAL(12,2) DEFAULT NULL COMMENT '金额 (元)',
    notes         VARCHAR(100)  DEFAULT NULL,

    INDEX idx_order (order_id),
    INDEX idx_item (item_id),
    INDEX idx_inventory (inventory_id),

    CONSTRAINT fk_aa_order FOREIGN KEY (order_id) REFERENCES smelting_order(id) ON DELETE CASCADE,
    CONSTRAINT fk_aa_item  FOREIGN KEY (item_id)  REFERENCES item(id)
) ENGINE=InnoDB COMMENT='补加合金明细';


-- ============================================================================
-- 三、外协加工 — 模板 ②锻造 ③电渣 ④车光 ⑧退火
-- ============================================================================

CREATE TABLE outsource_order (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_no      VARCHAR(30)   NOT NULL COMMENT '批次号',
    party_id      BIGINT UNSIGNED NOT NULL COMMENT '外协厂',
    process_type  VARCHAR(80) NOT NULL COMMENT '工艺（基础资料编码）',
    out_date      DATE          DEFAULT NULL COMMENT '发出日期（总体，明细行默认值/兜底）',
    in_date       DATE          DEFAULT NULL COMMENT '回厂日期（总体，明细行默认值/兜底）',

    -- 加工费用
    unit_price    DECIMAL(10,2) DEFAULT NULL COMMENT '加工单价 (元/吨)',
    amount        DECIMAL(12,2) DEFAULT NULL COMMENT '加工金额 (元)',
    tax_rate      DECIMAL(5,2)  DEFAULT 13.00 COMMENT '税率(%)',
    tax_amount    DECIMAL(12,2) DEFAULT NULL COMMENT '税额',
    subtotal      DECIMAL(12,2) DEFAULT NULL COMMENT '小计(税前)',
    total_amount  DECIMAL(12,2) DEFAULT NULL COMMENT '合计(含税)',

    -- 成材率
    yield_rate    DECIMAL(5,4)  DEFAULT NULL COMMENT '成材率 — 0.77 = 77%',
    saw_head_ton  DECIMAL(10,3) DEFAULT NULL COMMENT '切锯头 (吨)',
    loss_ton      DECIMAL(10,3) DEFAULT NULL COMMENT '损耗 (吨)',

    need_invoice  BOOLEAN       DEFAULT FALSE COMMENT '是否需要开票 — 从订单导入对账时判断',
    status        ENUM('draft','pending_review','approved','in_progress','completed','rejected') NOT NULL DEFAULT 'draft'
                  COMMENT 'draft=草稿 in_progress=进行中/已扣库 pending_review=待审核 approved=已审核 completed=已完成 rejected=驳回',
    notes         TEXT          DEFAULT NULL,
    created_by    BIGINT UNSIGNED DEFAULT NULL COMMENT '录入人',
    audited_by    BIGINT UNSIGNED DEFAULT NULL COMMENT '审核人',
    audited_at    DATETIME      DEFAULT NULL,
    created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_batch (batch_no),
    INDEX idx_party (party_id),
    INDEX idx_type (process_type),
    INDEX idx_status (status),

    CONSTRAINT fk_out_party FOREIGN KEY (party_id) REFERENCES party(id),
    CONSTRAINT fk_out_created FOREIGN KEY (created_by) REFERENCES user(id),
    CONSTRAINT fk_out_audited FOREIGN KEY (audited_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='外协加工单 — 锻造/电渣/车光/退火';


-- 外协发出明细
CREATE TABLE processing_outbound (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT UNSIGNED NOT NULL,
    line_no         TINYINT UNSIGNED DEFAULT 1,
    out_date        DATE          DEFAULT NULL COMMENT '出库日期',
    item_id         BIGINT UNSIGNED DEFAULT NULL COMMENT '物品 (钢种)',
    inventory_id    BIGINT UNSIGNED DEFAULT NULL COMMENT '所选本厂库存项；审核时按此 id 出库',
    quantity        DECIMAL(10,3) DEFAULT 0 COMMENT '数量 (单位见 unit)',
    unit            VARCHAR(10)   DEFAULT '吨' COMMENT '单位 (吨/千克/支)',
    spec            VARCHAR(80)   DEFAULT NULL,
    unit_price      DECIMAL(10,2) DEFAULT NULL COMMENT '单价 (元/单位) — 可选填,留空不计入费用',
    amount          DECIMAL(12,2) DEFAULT NULL COMMENT '金额 = quantity × unit_price',
    notes           TEXT          DEFAULT NULL COMMENT '委加工 / 母棒已退火 ...',

    INDEX idx_order (order_id),
    INDEX idx_item (item_id),
    INDEX idx_inventory (inventory_id),

    CONSTRAINT fk_po_order FOREIGN KEY (order_id) REFERENCES outsource_order(id) ON DELETE CASCADE,
    CONSTRAINT fk_po_item  FOREIGN KEY (item_id)  REFERENCES item(id)
) ENGINE=InnoDB COMMENT='外协发出明细';


-- 外协回厂 / 入库明细
CREATE TABLE processing_inbound (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT UNSIGNED NOT NULL,
    line_no         TINYINT UNSIGNED DEFAULT 1,
    in_date         DATE          DEFAULT NULL COMMENT '回厂日期',
    item_id         BIGINT UNSIGNED DEFAULT NULL COMMENT '物品 (钢种)',
    owner_id        BIGINT UNSIGNED DEFAULT NULL COMMENT '入库归属单位；留空回退本厂',
    quantity        DECIMAL(10,3) DEFAULT 0 COMMENT '数量 (单位见 unit)',
    unit            VARCHAR(10)   DEFAULT '吨' COMMENT '单位 (吨/千克/支)',
    spec            VARCHAR(80)   DEFAULT NULL,
    unit_price      DECIMAL(10,2) DEFAULT NULL COMMENT '单价 (元/单位) — 可选填,留空不计入费用',
    amount          DECIMAL(12,2) DEFAULT NULL COMMENT '金额 = quantity × unit_price',
    notes           TEXT          DEFAULT NULL COMMENT '红送金点 / 退火转荣畅 ...',

    INDEX idx_order (order_id),
    INDEX idx_item (item_id),
    INDEX idx_owner (owner_id),

    CONSTRAINT fk_pi_order FOREIGN KEY (order_id) REFERENCES outsource_order(id) ON DELETE CASCADE,
    CONSTRAINT fk_pi_item  FOREIGN KEY (item_id)  REFERENCES item(id),
    CONSTRAINT fk_pi_owner FOREIGN KEY (owner_id) REFERENCES party(id)
) ENGINE=InnoDB COMMENT='外协回厂/入库明细';


-- ============================================================================
-- 四、采购 — 模板 ⑤⑩（统一为供应商采购）
-- ============================================================================

CREATE TABLE procurement_order (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_no          VARCHAR(30)   NOT NULL,
    party_id          BIGINT UNSIGNED NOT NULL COMMENT '供应商',
    owner_id          BIGINT UNSIGNED NOT NULL COMMENT '入库归属单位，默认本厂 party，由应用层写入',
    purchase_date     DATE          DEFAULT NULL,
    item_id           BIGINT UNSIGNED DEFAULT NULL COMMENT '物品 (原料/合金)',
    item_spec         VARCHAR(80)   DEFAULT NULL COMMENT '规格/品位 — 59.6%',
    quantity          DECIMAL(10,3) DEFAULT 0,
    unit              VARCHAR(10)   DEFAULT '吨',
    unit_price        DECIMAL(10,2) DEFAULT 0,
    amount            DECIMAL(12,2) DEFAULT 0 COMMENT '金额 = 数量 × 单价',

    -- 费用汇总 (design §4.6)
    tax_rate          DECIMAL(5,2)  DEFAULT 13.00 COMMENT '税率(%) — 默认13,可调',
    tax_amount        DECIMAL(12,2) DEFAULT NULL COMMENT '税额 = amount × tax_rate%',
    subtotal          DECIMAL(12,2) DEFAULT NULL COMMENT '小计(税前) = amount',
    total_amount      DECIMAL(12,2) DEFAULT NULL COMMENT '合计(含税) = subtotal + tax_amount',

    need_invoice      BOOLEAN       DEFAULT FALSE COMMENT '是否需要开票 — 从订单导入对账时判断',
    status            ENUM('draft','pending_review','approved','in_progress','completed','rejected') NOT NULL DEFAULT 'draft'
                      COMMENT 'draft=草稿 in_progress=进行中 pending_review=待审核 approved=已审核 completed=已完成 rejected=驳回',
    notes             TEXT          DEFAULT NULL,
    created_by        BIGINT UNSIGNED DEFAULT NULL COMMENT '录入人',
    audited_by        BIGINT UNSIGNED DEFAULT NULL COMMENT '审核人',
    audited_at        DATETIME      DEFAULT NULL,
    created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_batch (batch_no),
    INDEX idx_party (party_id),
    INDEX idx_owner (owner_id),
    INDEX idx_item (item_id),
    INDEX idx_purchase_date (purchase_date),
    INDEX idx_status (status),

    CONSTRAINT fk_proc_party    FOREIGN KEY (party_id)    REFERENCES party(id),
    CONSTRAINT fk_proc_owner    FOREIGN KEY (owner_id)    REFERENCES party(id),
    CONSTRAINT fk_proc_item     FOREIGN KEY (item_id)     REFERENCES item(id),
    CONSTRAINT fk_proc_created  FOREIGN KEY (created_by)  REFERENCES user(id),
    CONSTRAINT fk_proc_audited  FOREIGN KEY (audited_by)  REFERENCES user(id)
) ENGINE=InnoDB COMMENT='采购单 — 固定供应商 + 散户';

-- 采购入库明细（一单多品，订单 purchase_date 自动取全部明细最晚日期）
CREATE TABLE procurement_order_item (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT UNSIGNED NOT NULL,
    line_no         INT UNSIGNED NOT NULL DEFAULT 1,
    in_date         DATE NOT NULL COMMENT '本行入库日期',
    item_id         BIGINT UNSIGNED NOT NULL,
    item_spec       VARCHAR(80) DEFAULT NULL COMMENT '规格/品位',
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


-- ============================================================================
-- 五、销售 — 模板 ⑥
-- ============================================================================

-- 销售主表 (一单可多品 → 明细在 sales_order_item)
CREATE TABLE sales_order (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_no        VARCHAR(30)   NOT NULL COMMENT '批次号 — S0001',
    party_id        BIGINT UNSIGNED NOT NULL COMMENT '客户',
    sales_mode      ENUM('inventory','item_spec') NOT NULL DEFAULT 'inventory'
                    COMMENT 'inventory=指定库存销售 item_spec=按物品规格下单、完成时自动扣库',
    ship_date       DATE          DEFAULT NULL COMMENT '发货日期',

    -- 费用汇总 (design §4.7)
    tax_rate        DECIMAL(5,2)  DEFAULT 13.00 COMMENT '税率(%) — 默认13,可调',
    tax_amount      DECIMAL(12,2) DEFAULT NULL COMMENT '税额',
    subtotal        DECIMAL(12,2) DEFAULT NULL COMMENT '小计(税前) = Σ 明细金额',
    total_amount    DECIMAL(12,2) DEFAULT NULL COMMENT '合计(含税) = subtotal + tax_amount',

    need_invoice    BOOLEAN       DEFAULT FALSE COMMENT '是否需要开票 — 从订单导入对账时判断',
    status          ENUM('draft','pending_review','approved','in_progress','completed','rejected') NOT NULL DEFAULT 'draft'
                    COMMENT 'draft=草稿 in_progress=进行中 pending_review=待审核 approved=已审核 completed=已完成 rejected=驳回',
    notes           TEXT          DEFAULT NULL,
    created_by      BIGINT UNSIGNED DEFAULT NULL COMMENT '录入人',
    audited_by      BIGINT UNSIGNED DEFAULT NULL COMMENT '审核人',
    audited_at      DATETIME      DEFAULT NULL,
    created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_batch (batch_no),
    INDEX idx_party (party_id),
    INDEX idx_ship_date (ship_date),
    INDEX idx_status (status),

    CONSTRAINT fk_so_party   FOREIGN KEY (party_id)     REFERENCES party(id),
    CONSTRAINT fk_so_created FOREIGN KEY (created_by)   REFERENCES user(id),
    CONSTRAINT fk_so_audited FOREIGN KEY (audited_by)   REFERENCES user(id)
) ENGINE=InnoDB COMMENT='产品销售单 — 主表';

-- 销售明细 (design §4.7 支持一单多品)
CREATE TABLE sales_order_item (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT UNSIGNED NOT NULL,
    line_no         TINYINT UNSIGNED DEFAULT 1,
    ship_date       DATE          DEFAULT NULL COMMENT '发货日期（行级，留空回退订单发货日期）',
    inventory_id    BIGINT UNSIGNED DEFAULT NULL COMMENT '指定库存模式所选库存；自动模式完成时写入实际扣减库存',
    item_id         BIGINT UNSIGNED DEFAULT NULL COMMENT '物品；自动模式下与 spec、unit 一起用于匹配本厂库存',
    spec            VARCHAR(80)   DEFAULT NULL COMMENT '规格 — 630, 150圆钢 ...',
    quantity        DECIMAL(10,3) DEFAULT 0 COMMENT '发货数量 (单位见 unit)',
    unit            VARCHAR(10)   DEFAULT '吨' COMMENT '单位 (吨/千克/支)',
    unit_price      DECIMAL(10,2) DEFAULT 0 COMMENT '单价 (元/单位)',
    amount          DECIMAL(12,2) DEFAULT 0 COMMENT '金额 = quantity × unit_price',
    notes           TEXT          DEFAULT NULL,

    INDEX idx_order (order_id),
    INDEX idx_inventory (inventory_id),
    INDEX idx_item (item_id),

    CONSTRAINT fk_soi_order FOREIGN KEY (order_id) REFERENCES sales_order(id) ON DELETE CASCADE,
    CONSTRAINT fk_soi_item  FOREIGN KEY (item_id)  REFERENCES item(id)
) ENGINE=InnoDB COMMENT='销售明细 — 一单可多品';


-- ============================================================================
-- 六、财务 — 统一收付款 + 发票
-- ============================================================================

-- 收付款记录 (独立记录, 按往来单位筛选; 关联订单可选多选, 仅做参考)
CREATE TABLE payment (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    party_id    BIGINT UNSIGNED NOT NULL COMMENT '往来单位 — 收付款对象',
    direction   ENUM('pay','receive') NOT NULL COMMENT '按往来单位视角：pay=该单位付款(我方收款) receive=该单位收款(我方付款)',
    pay_date    DATE          DEFAULT NULL COMMENT '收付款日期',
    amount      DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '金额',
    method      VARCHAR(20)   DEFAULT NULL COMMENT '收付方式: 电汇 / 电承 / 现金 ...',

    -- 关联订单 (可选, 可多选, 仅做参考标注 — design §4.9b)
    ref_type    VARCHAR(30)   DEFAULT NULL COMMENT '主关联订单类型 (可选)',
    ref_id      BIGINT UNSIGNED DEFAULT NULL COMMENT '主关联订单 ID (可选)',
    linked_orders JSON        DEFAULT NULL COMMENT '额外关联订单 [{ref_type, ref_id, batch_no}], 仅参考',

    notes       VARCHAR(200)  DEFAULT NULL,
    created_by  BIGINT UNSIGNED DEFAULT NULL,
    created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_party (party_id),
    INDEX idx_ref (ref_type, ref_id),
    INDEX idx_pay_date (pay_date),
    INDEX idx_direction (direction),

    CONSTRAINT fk_pay_party   FOREIGN KEY (party_id)   REFERENCES party(id),
    CONSTRAINT fk_pay_created FOREIGN KEY (created_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='收付款记录 — 按往来单位筛选, 关联订单仅做参考';


-- 发票记录 (独立记录; 只记录真实已发生的开票/收票)
CREATE TABLE invoice (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    party_id      BIGINT UNSIGNED NOT NULL COMMENT '往来单位',
    direction     ENUM('issue','receive') NOT NULL COMMENT 'issue=我方已开给对方 receive=对方已开给我方',

    invoice_date  DATE          DEFAULT NULL COMMENT '实际开票/收票日期',
    amount        DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '开票金额',
    invoice_no    VARCHAR(50)   DEFAULT NULL COMMENT '发票号码 (收到时可填对方发票号)',

    -- 关联订单 (可选, 仅做参考)
    ref_type      VARCHAR(30)   DEFAULT NULL COMMENT '关联订单类型 (可选)',
    ref_id        BIGINT UNSIGNED DEFAULT NULL COMMENT '关联订单 ID (可选)',
    linked_orders JSON          DEFAULT NULL COMMENT '额外关联订单 [{ref_type, ref_id, batch_no}], 仅参考',

    notes         VARCHAR(200)  DEFAULT NULL,
    created_by    BIGINT UNSIGNED DEFAULT NULL,
    created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_party (party_id),
    INDEX idx_direction (direction),
    INDEX idx_ref (ref_type, ref_id),
    INDEX idx_invoice_date (invoice_date),

    CONSTRAINT fk_invoice_party   FOREIGN KEY (party_id)   REFERENCES party(id),
    CONSTRAINT fk_invoice_created FOREIGN KEY (created_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='发票记录 — 实际已开/已收，按往来单位+方向筛选';


-- ============================================================================
-- 七、统一库存 — 模板 ⑦ 库房管理
-- ============================================================================

-- 当前库存（成品/半成品/合金 统一管理）
CREATE TABLE inventory (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    item_id         BIGINT UNSIGNED DEFAULT NULL COMMENT '物品 (钢种/原料/合金) — 物品类型通过 JOIN item.item_type 读取，不在此表冗余',
    spec            VARCHAR(80)   NOT NULL DEFAULT '' COMMENT '规格 — 板子 / 圆钢150 / 630；空规格用空字符串，确保唯一索引生效',
    unit            VARCHAR(10)   DEFAULT '吨' COMMENT '单位 (吨/千克/支)',

    -- 归属：本厂也作为 party 记录，因此库存归属统一引用 party
    owner_id        BIGINT UNSIGNED NOT NULL COMMENT '归属单位ID：本厂/客户',

    -- 当前数量 (按 unit 计量；支=按支计数, 吨/千克=按重量)
    current_quantity DECIMAL(12,3) DEFAULT 0 COMMENT '当前数量 (单位见 unit)',

    notes           TEXT          DEFAULT NULL,
    created_by      BIGINT UNSIGNED DEFAULT NULL,
    created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_item_owner (item_id, spec, owner_id),
    INDEX idx_owner (owner_id),
    INDEX idx_item (item_id),

    CONSTRAINT fk_inv_item    FOREIGN KEY (item_id)    REFERENCES item(id),
    CONSTRAINT fk_inv_owner   FOREIGN KEY (owner_id)   REFERENCES party(id),
    CONSTRAINT fk_inv_created FOREIGN KEY (created_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='统一库存 — 物品类型通过 JOIN item.item_type 读取，不冗余存储';

-- 以下子表先于 inventory 创建，库存外键在 inventory 建好后统一补充
-- ON DELETE SET NULL：库存项删除时仅置空明细行指针，单据自带 item/spec/数量快照不受影响，
-- 撤销/反审核按 inventory_log 追溯回滚，不依赖此指针
ALTER TABLE sales_order_item
    ADD CONSTRAINT fk_soi_inventory FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE SET NULL;
ALTER TABLE smelting_inbound
    ADD CONSTRAINT fk_si_inv FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE SET NULL;
ALTER TABLE alloy_addition
    ADD CONSTRAINT fk_aa_inv FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE SET NULL;
ALTER TABLE processing_outbound
    ADD CONSTRAINT fk_po_inv FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE SET NULL;


-- 库存变动日志（独立自包含，不与其他表外键联动，不可修改）
-- 每次库存操作(入库/出库/盘点调整/删除)完成时追加一行，写入时即把物品/规格/
-- 归属/操作人快照进本行。查询直接读本表，无需 JOIN；库存项删除不影响历史日志。
CREATE TABLE inventory_log (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    -- 仅记录来源 id 供追溯，非外键（库存删除后此值保留）
    inventory_id    BIGINT UNSIGNED DEFAULT NULL COMMENT '来源库存ID（非外键，仅追溯）',
    item_id         BIGINT UNSIGNED DEFAULT NULL COMMENT '快照:物品ID（供按物品追溯）',

    -- 写入时固化的快照字段（库存/物品/归属被改名或删除后仍可读）
    item_name       VARCHAR(100)  DEFAULT NULL COMMENT '快照:物品名称',
    item_spec       VARCHAR(80)   DEFAULT NULL COMMENT '快照:规格',
    item_type       VARCHAR(30)   DEFAULT NULL COMMENT '快照:物品类型',
    owner_name      VARCHAR(100)  DEFAULT NULL COMMENT '快照:归属单位名称',
    operator_name   VARCHAR(50)   DEFAULT NULL COMMENT '快照:操作人姓名',

    change_type     ENUM('in','out','adjust','init','delete') NOT NULL
                    COMMENT 'in=入库 out=出库 adjust=盘点调整 init=初始录入 delete=库存项删除',
    change_date     DATE          NOT NULL,
    unit            VARCHAR(10)   DEFAULT '吨' COMMENT '快照:单位 (吨/千克/支)',

    -- 变化量 (±)
    delta_quantity  DECIMAL(12,3) DEFAULT 0,

    -- 变化前后快照
    before_quantity DECIMAL(12,3) DEFAULT 0,
    after_quantity  DECIMAL(12,3) DEFAULT 0,

    -- 来源追踪
    ref_type        VARCHAR(30)   DEFAULT NULL COMMENT '关联业务表',
    ref_id          BIGINT UNSIGNED DEFAULT NULL COMMENT '关联记录ID',
    notes           VARCHAR(200)  DEFAULT NULL,
    created_by      BIGINT UNSIGNED DEFAULT NULL COMMENT '操作人ID（非外键，仅追溯）',
    created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_inventory (inventory_id),
    INDEX idx_date (change_date),
    INDEX idx_type (change_type),
    INDEX idx_ref (ref_type, ref_id)
) ENGINE=InnoDB COMMENT='库存变动日志 — 独立自包含，写入时快照，只增不改不删';


-- ============================================================================
-- 八、用户对账单 — 模板 ⑪（面向所有往来单位）
-- ============================================================================

CREATE TABLE party_reconciliation (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    party_id      BIGINT UNSIGNED NOT NULL COMMENT '往来单位',

    -- 账期
    period        VARCHAR(20)   NOT NULL COMMENT '账期 — 2026年5月 / 2026-Q2',
    period_start  DATE          DEFAULT NULL COMMENT '账期起始',
    period_end    DATE          DEFAULT NULL COMMENT '账期截止',

    -- 单据来源 (多态 — 可关联到具体订单或手动录入)
    ref_type      VARCHAR(30)   DEFAULT NULL COMMENT '关联订单类型: smelting_order/outsource_order/... 或 NULL=手动录入',
    ref_id        BIGINT UNSIGNED DEFAULT NULL COMMENT '关联订单 ID',

    -- 对账明细
    line_no       INT           DEFAULT 1 COMMENT '行号',
    biz_date      DATE          DEFAULT NULL COMMENT '业务日期',
    biz_desc      VARCHAR(200)  DEFAULT NULL COMMENT '业务摘要',
    steel_grade   VARCHAR(50)   DEFAULT NULL COMMENT '钢种 (文字快照, 非FK)',
    quantity      DECIMAL(10,3) DEFAULT 0 COMMENT '数量 (单位见 unit)',
    unit          VARCHAR(10)   DEFAULT '吨' COMMENT '单位 (吨/千克/支)',
    unit_price    DECIMAL(10,2) DEFAULT NULL COMMENT '单价',

    -- 金额 (借贷)
    debit         DECIMAL(12,2) DEFAULT 0 COMMENT '借方(应收/应付)',
    credit        DECIMAL(12,2) DEFAULT 0 COMMENT '贷方(已收/已付)',

    -- 应开/应收发票信息（应计口径，不代表实际已开/已收；实际记录见 invoice 表）
    invoice_amount DECIMAL(12,2) DEFAULT NULL COMMENT '应开/应收发票金额',
    invoice_direction ENUM('issue','receive') DEFAULT NULL
                      COMMENT 'issue=我方应开给对方 receive=对方应开给我方',

    -- 对账状态 (design §4.9 四态)
    recon_status  ENUM('unreconciled','verified','completed','disabled') NOT NULL DEFAULT 'unreconciled'
                  COMMENT 'unreconciled=未对账(橙) verified=已核对(蓝) completed=已完成/已支付(绿,不计入余额) disabled=不启用(灰,不计入任何统计)',

    notes         TEXT          DEFAULT NULL,
    created_by    BIGINT UNSIGNED DEFAULT NULL,
    created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- 防重复导入: 同一订单只能生成一条对账行
    UNIQUE KEY uk_ref (ref_type, ref_id),
    INDEX idx_party_period (party_id, period),
    INDEX idx_recon_status (recon_status),

    CONSTRAINT fk_par_party    FOREIGN KEY (party_id)   REFERENCES party(id),
    CONSTRAINT fk_par_created  FOREIGN KEY (created_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='用户对账单 — 全部往来单位，支持手动增删改，无审核流程。四态流转: 未对账→已核对→已完成/已支付 + 不启用';


-- ============================================================================
-- 九、操作日志 — 所有数据变更全量记录 (仅 admin 可见)
-- ============================================================================

CREATE TABLE operation_log (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT UNSIGNED NOT NULL COMMENT '操作人',
    action        ENUM('CREATE','UPDATE','DELETE','SUBMIT','APPROVE','REJECT',
                       'COMPLETE','UNAUDIT','LOGIN','LOGOUT','EXPORT')
                  NOT NULL COMMENT '操作类型',
    target_type   VARCHAR(30)   NOT NULL COMMENT '操作对象: steelmaking_record/smelting_order/outsource_order/procurement_order/sales_order/inventory/inventory_log/item/party/user/payment/reconciliation',
    target_id     BIGINT UNSIGNED DEFAULT NULL COMMENT '操作对象 ID',
    summary       VARCHAR(500)  NOT NULL COMMENT '可读摘要 — "创建冶炼批次 #3000001"',
    detail        JSON          DEFAULT NULL COMMENT '变更详情 (old/new 对比)',
    ip_address    VARCHAR(45)   DEFAULT NULL COMMENT '操作 IP',
    created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_user (user_id),
    INDEX idx_target (target_type, target_id),
    INDEX idx_action (action),
    INDEX idx_created (created_at),

    CONSTRAINT fk_olog_user FOREIGN KEY (user_id) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='操作日志 — 所有数据变更全量记录，仅 admin 可见';


-- ============================================================================
-- 十、常用视图
-- ============================================================================

-- 10.1 往来余额视图 — 实时计算各往来单位的应收/应付余额 + 发票应开/应收净额
-- 余额来源: 对账明细 (party_reconciliation) 中未完成行的 debit/credit 汇总 + 独立收付款记录
-- 发票净额: 对账明细中应计发票 (invoice_amount+invoice_direction) 汇总 - 实际开/收发票 (invoice 表)
-- 注意: 对账行、收付款、实际发票必须先各自按 party_id 独立聚合，再 JOIN 到 party，避免笛卡尔积导致金额重复放大。
CREATE OR REPLACE VIEW v_party_balance AS
SELECT
    p.id          AS party_id,
    p.name        AS party_name,
    CONCAT_WS(',',
        IF(p.is_internal,  'internal',  NULL),
        IF(p.is_customer,  'customer',  NULL),
        IF(p.is_supplier,  'supplier',  NULL),
        IF(p.is_processor, 'processor', NULL)
    ) AS party_type,

    COALESCE(recon.total_receivable, 0) AS total_receivable,
    COALESCE(recon.total_payable, 0)    AS total_payable,
    COALESCE(pay.total_received, 0)     AS total_received,
    COALESCE(pay.total_paid, 0)         AS total_paid,
    COALESCE(recon.total_receivable, 0) - COALESCE(pay.total_received, 0) AS net_receivable,
    COALESCE(recon.total_payable, 0) - COALESCE(pay.total_paid, 0)        AS net_payable,

    -- 应开未开发票净额: 应计应开发票 (对账 issue) - 实际已开发票 (invoice issue)
    COALESCE(recon.accrued_issue, 0)   - COALESCE(inv.actual_issued, 0)   AS net_to_issue,
    -- 应收未收发票净额: 应计应收发票 (对账 receive) - 实际已收发票 (invoice receive)
    COALESCE(recon.accrued_receive, 0) - COALESCE(inv.actual_received, 0) AS net_to_receive

FROM party p
LEFT JOIN (
    SELECT
        party_id,
        SUM(debit)  AS total_receivable,
        SUM(credit) AS total_payable,
        SUM(CASE WHEN invoice_direction = 'issue'   THEN COALESCE(invoice_amount, 0) ELSE 0 END) AS accrued_issue,
        SUM(CASE WHEN invoice_direction = 'receive' THEN COALESCE(invoice_amount, 0) ELSE 0 END) AS accrued_receive
    FROM party_reconciliation
    WHERE recon_status IN ('unreconciled', 'verified')
    GROUP BY party_id
) recon ON recon.party_id = p.id
LEFT JOIN (
    SELECT
        party_id,
        -- payment.direction 按往来单位视角：
        -- pay=该单位付款(我方收款)，receive=该单位收款(我方付款)
        SUM(CASE WHEN direction = 'pay'     THEN amount ELSE 0 END) AS total_received,
        SUM(CASE WHEN direction = 'receive' THEN amount ELSE 0 END) AS total_paid
    FROM payment
    GROUP BY party_id
) pay ON pay.party_id = p.id
LEFT JOIN (
    SELECT
        party_id,
        SUM(CASE WHEN direction = 'issue'   THEN amount ELSE 0 END) AS actual_issued,
        SUM(CASE WHEN direction = 'receive' THEN amount ELSE 0 END) AS actual_received
    FROM invoice
    GROUP BY party_id
) inv ON inv.party_id = p.id;


-- 10.2 加工批次汇总视图 — 冶炼
CREATE OR REPLACE VIEW v_smelting_summary AS
SELECT
    so.id,
    so.batch_no,
    p.name        AS party_name,
    so.order_type,
    so.feed_date,
    so.tap_date,
    so.yield_pct,
    -- 投料汇总
    (SELECT SUM(quantity) FROM smelting_inbound WHERE order_id = so.id AND side = 'in')  AS total_feed_ton,
    -- 出钢汇总
    (SELECT SUM(quantity) FROM smelting_inbound WHERE order_id = so.id AND side = 'out') AS total_tap_ton,
    -- 合金金额
    (SELECT SUM(amount) FROM alloy_addition WHERE order_id = so.id)                          AS total_alloy_amount
FROM smelting_order so
LEFT JOIN party p ON p.id = so.party_id;


-- 10.3 加工批次汇总视图 — 外协
CREATE OR REPLACE VIEW v_outsource_summary AS
SELECT
    oo.id,
    oo.batch_no,
    p.name          AS party_name,
    oo.process_type,
    (SELECT SUM(quantity) FROM processing_outbound WHERE order_id = oo.id) AS total_out_ton,
    (SELECT SUM(quantity) FROM processing_inbound  WHERE order_id = oo.id) AS total_in_ton,
    oo.yield_rate,
    oo.saw_head_ton,
    oo.loss_ton,
    oo.unit_price,
    oo.amount
FROM outsource_order oo
LEFT JOIN party p ON p.id = oo.party_id;


-- ============================================================================
-- 十一、生产销售单据图片凭证
-- ============================================================================
CREATE TABLE business_attachment (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    entity_type   VARCHAR(40)  NOT NULL COMMENT 'steelmaking_record/smelting_order/outsource_order/procurement_order/sales_order',
    entity_id     BIGINT UNSIGNED NOT NULL COMMENT '关联业务单据 ID',
    original_name VARCHAR(255) NOT NULL COMMENT '用户上传时的文件名',
    storage_name  VARCHAR(255) NOT NULL COMMENT 'uploads/vouchers 下的相对路径',
    content_type  VARCHAR(100) NOT NULL,
    file_size     BIGINT UNSIGNED NOT NULL,
    uploaded_by   BIGINT UNSIGNED DEFAULT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_business_attachment_storage (storage_name),
    KEY idx_business_attachment_entity (entity_type, entity_id),
    KEY idx_business_attachment_uploaded_by (uploaded_by),
    CONSTRAINT fk_business_attachment_user
        FOREIGN KEY (uploaded_by) REFERENCES user(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生产销售单据图片凭证';

-- ============================================================================
-- 验证
-- ============================================================================
SELECT 'Database hltg_accounting v2.6 created successfully.' AS status;
SHOW TABLES;
