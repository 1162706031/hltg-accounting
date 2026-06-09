-- ============================================================================
-- 汇隆特钢 · 会计数据库建表脚本
-- 数据库引擎: MySQL 8.0+ / MariaDB 10.5+
-- 字符集: utf8mb4 (支持中文)
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
('admin', '$2b$12$LJ3m4ys3Lk0TSwHCpNqr3OmHOyMQGz3kA4ANh0zI5WOH.X5l7ZJtq', '系统管理员', 'admin');


-- ============================================================================
-- 一、核心字典 (3 张)
-- ============================================================================

-- 1. 往来单位（客户 / 供应商 / 外协厂）
-- 同一单位可同时是客户+供应商+外协厂（如：某外协厂也卖原料给我们）
CREATE TABLE party (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL COMMENT '单位名称',
    short_name  VARCHAR(50)   DEFAULT NULL COMMENT '简称',
    is_customer  BOOLEAN       DEFAULT FALSE COMMENT '是否为客户',
    is_supplier  BOOLEAN       DEFAULT FALSE COMMENT '是否为供应商',
    is_processor BOOLEAN       DEFAULT FALSE COMMENT '是否为外协厂',
    contact     VARCHAR(50)   DEFAULT NULL COMMENT '联系人',
    phone       VARCHAR(30)   DEFAULT NULL COMMENT '电话',
    address     VARCHAR(200)  DEFAULT NULL COMMENT '地址',
    notes       TEXT          DEFAULT NULL COMMENT '备注',
    created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_customer (is_customer),
    INDEX idx_supplier (is_supplier),
    INDEX idx_processor (is_processor),
    INDEX idx_name (name)
) ENGINE=InnoDB COMMENT='往来单位：客户、供应商、外协厂（可多角色）';


-- 2. 统一物品字典（替代原 steel_grade + material）
CREATE TABLE item (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL COMMENT '物品名称 — H13, 钼铁60%, 2Cr14Ni ...',
    item_type   ENUM('steel_grade','raw_material','alloy','finished_product','semi_finished','scrap')
                NOT NULL COMMENT '物品类型',
    spec        VARCHAR(100)  DEFAULT '' COMMENT '规格 — 630, 板子, 60% ...',
    default_unit ENUM('ton','kg') DEFAULT 'ton' COMMENT '默认单位',
    is_active   BOOLEAN       DEFAULT TRUE COMMENT '是否启用',
    notes       TEXT          DEFAULT NULL COMMENT '备注',
    created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_name_type_spec (name, item_type, spec),
    INDEX idx_type (item_type),
    INDEX idx_active (is_active),
    INDEX idx_name (name)
) ENGINE=InnoDB COMMENT='统一物品字典：钢种/原料/合金/成品/半成品/废料';


-- [已废弃] 钢种字典 — 数据已迁移至 item 表，新代码请使用 item
-- CREATE TABLE steel_grade ( ... ) -- 以下建表仅用于数据迁移兼容
-- [已废弃] 原材料/合金字典 — 数据已迁移至 item 表，新代码请使用 item
-- CREATE TABLE material ( ... ) -- 以下建表仅用于数据迁移兼容
-- ============================================================================
-- 二、冶炼加工 — 模板 ① 外来冶炼 + ⑨ 本厂冶炼
-- ============================================================================
CREATE TABLE smelting_order (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_no          VARCHAR(30)   NOT NULL COMMENT '批次号 — 223918',
    party_id          BIGINT UNSIGNED NOT NULL COMMENT '客户 (外来冶炼) 或 可空 (本厂冶炼)',
    order_type        ENUM('ext_smelting','inhouse') NOT NULL COMMENT '外来冶炼 / 本厂冶炼',
    feed_date         DATE          DEFAULT NULL COMMENT '投料日期',
    tap_date          DATE          DEFAULT NULL COMMENT '出钢日期',
    casting_loss_kg   DECIMAL(10,1) DEFAULT NULL COMMENT '浇筑溜槽/残留 (kg)',
    casting_loss_pct  DECIMAL(5,2)  DEFAULT NULL COMMENT '残留百分比',
    yield_pct         DECIMAL(5,2)  DEFAULT NULL COMMENT '冶炼成锭率 %',
    unit_price        DECIMAL(10,2) DEFAULT NULL COMMENT '加工单价 (元/吨)',
    processing_amount DECIMAL(12,2) DEFAULT NULL COMMENT '加工金额 (元)',
    status            ENUM('draft','pending_review','approved','in_progress','completed','rejected') NOT NULL DEFAULT 'draft'
                      COMMENT 'draft=草稿 pending_review=待审核 approved=已审核 in_progress=进行中 completed=已完成 rejected=驳回',
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

    CONSTRAINT fk_smelting_party FOREIGN KEY (party_id) REFERENCES party(id),
    CONSTRAINT fk_smelting_created FOREIGN KEY (created_by) REFERENCES user(id),
    CONSTRAINT fk_smelting_audited FOREIGN KEY (audited_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='冶炼加工单 — 外来冶炼 + 本厂冶炼';


-- 6. 冶炼来料 / 出料明细
CREATE TABLE smelting_inbound (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT UNSIGNED NOT NULL,
    side            ENUM('in','out') NOT NULL COMMENT 'in=来料/投料  out=出料/出钢',
    line_no         TINYINT UNSIGNED DEFAULT 1 COMMENT '同批次内行号',
    date            DATE          DEFAULT NULL COMMENT '来料日期 / 出料日期',
    item_id         BIGINT UNSIGNED DEFAULT NULL COMMENT '物品 (钢种)',
    weight_ton      DECIMAL(10,3) DEFAULT 0 COMMENT '重量 (吨)',
    pieces          INT           DEFAULT NULL COMMENT '支数',
    spec            VARCHAR(80)   DEFAULT NULL COMMENT '规格 — 300*12, 630*7 ...',
    furnace_no      VARCHAR(20)   DEFAULT NULL COMMENT '炉号 — 3-60-63',
    notes           TEXT          DEFAULT NULL,

    INDEX idx_order (order_id),
    INDEX idx_item (item_id),

    CONSTRAINT fk_si_order FOREIGN KEY (order_id)  REFERENCES smelting_order(id),
    CONSTRAINT fk_si_item  FOREIGN KEY (item_id)   REFERENCES item(id)
) ENGINE=InnoDB COMMENT='冶炼来料/出料明细';


-- 7. 补加合金
CREATE TABLE alloy_addition (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id      BIGINT UNSIGNED NOT NULL,
    item_id       BIGINT UNSIGNED NOT NULL COMMENT '物品 (合金)',
    weight_kg     DECIMAL(10,1) DEFAULT 0 COMMENT '重量 (kg)',
    unit_price    DECIMAL(10,2) DEFAULT NULL COMMENT '单价 (元/kg)',
    amount        DECIMAL(12,2) DEFAULT NULL COMMENT '金额 (元)',
    notes         VARCHAR(100)  DEFAULT NULL,

    INDEX idx_order (order_id),
    INDEX idx_item (item_id),

    CONSTRAINT fk_aa_order FOREIGN KEY (order_id) REFERENCES smelting_order(id),
    CONSTRAINT fk_aa_item  FOREIGN KEY (item_id)  REFERENCES item(id)
) ENGINE=InnoDB COMMENT='补加合金明细';


-- ============================================================================
-- 三、外协加工 — 模板 ②锻造 ③电渣 ④车光 ⑧退火
-- ============================================================================

-- 8. 外协加工单（批次主表）
CREATE TABLE outsource_order (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_no      VARCHAR(30)   NOT NULL COMMENT '批次号',
    party_id      BIGINT UNSIGNED NOT NULL COMMENT '外协厂',
    process_type  ENUM('forging','esr','turning','annealing') NOT NULL COMMENT '锻造/电渣/车光/退火',

    -- 加工费用
    unit_price    DECIMAL(10,2) DEFAULT NULL COMMENT '加工单价 (元/吨)',
    amount        DECIMAL(12,2) DEFAULT NULL COMMENT '加工金额 (元)',

    -- 成材率
    yield_rate    DECIMAL(5,4)  DEFAULT NULL COMMENT '成材率 — 0.77 = 77%',
    saw_head_ton  DECIMAL(10,3) DEFAULT NULL COMMENT '切锯头 (吨)',
    loss_ton      DECIMAL(10,3) DEFAULT NULL COMMENT '损耗 (吨)',

    status        ENUM('draft','pending_review','approved','rejected') NOT NULL DEFAULT 'draft'
                  COMMENT 'draft=草稿 pending_review=待审核 approved=已审核 rejected=驳回',
    notes         TEXT          DEFAULT NULL,
    created_by    BIGINT UNSIGNED DEFAULT NULL COMMENT '录入人',
    audited_by    BIGINT UNSIGNED DEFAULT NULL COMMENT '审核人',
    audited_at    DATETIME      DEFAULT NULL,
    created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_batch (batch_no),
    INDEX idx_party (party_id),
    INDEX idx_type (process_type),

    CONSTRAINT fk_out_party FOREIGN KEY (party_id) REFERENCES party(id),
    CONSTRAINT fk_out_created FOREIGN KEY (created_by) REFERENCES user(id),
    CONSTRAINT fk_out_audited FOREIGN KEY (audited_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='外协加工单 — 锻造/电渣/车光/退火';


-- 9. 外协发出明细
CREATE TABLE processing_outbound (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT UNSIGNED NOT NULL,
    line_no         TINYINT UNSIGNED DEFAULT 1,
    out_date        DATE          DEFAULT NULL COMMENT '出库日期',
    item_id         BIGINT UNSIGNED DEFAULT NULL COMMENT '物品 (钢种)',
    weight_ton      DECIMAL(10,3) DEFAULT 0,
    pieces          INT           DEFAULT NULL,
    spec            VARCHAR(80)   DEFAULT NULL,
    notes           TEXT          DEFAULT NULL COMMENT '委加工 / 母棒已退火 ...',

    INDEX idx_order (order_id),
    INDEX idx_item (item_id),

    CONSTRAINT fk_po_order FOREIGN KEY (order_id) REFERENCES outsource_order(id),
    CONSTRAINT fk_po_item  FOREIGN KEY (item_id)  REFERENCES item(id)
) ENGINE=InnoDB COMMENT='外协发出明细';


-- 10. 外协回厂 / 入库明细
CREATE TABLE processing_inbound (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT UNSIGNED NOT NULL,
    line_no         TINYINT UNSIGNED DEFAULT 1,
    in_date         DATE          DEFAULT NULL COMMENT '回厂日期',
    item_id         BIGINT UNSIGNED DEFAULT NULL COMMENT '物品 (钢种)',
    weight_ton      DECIMAL(10,3) DEFAULT 0,
    pieces          INT           DEFAULT NULL,
    spec            VARCHAR(80)   DEFAULT NULL,
    notes           TEXT          DEFAULT NULL COMMENT '红送金点 / 退火转荣畅 ...',

    INDEX idx_order (order_id),
    INDEX idx_item (item_id),

    CONSTRAINT fk_pi_order FOREIGN KEY (order_id) REFERENCES outsource_order(id),
    CONSTRAINT fk_pi_item  FOREIGN KEY (item_id)  REFERENCES item(id)
) ENGINE=InnoDB COMMENT='外协回厂/入库明细';


-- ============================================================================
-- 四、采购 — 模板 ⑤⑩（统一为供应商采购）
-- ============================================================================

CREATE TABLE procurement_order (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_no          VARCHAR(30)   NOT NULL,
    party_id          BIGINT UNSIGNED NOT NULL COMMENT '供应商',
    purchase_date     DATE          DEFAULT NULL,
    item_id           BIGINT UNSIGNED DEFAULT NULL COMMENT '物品 (原料/合金)',
    item_spec         VARCHAR(50)   DEFAULT NULL COMMENT '规格/品位 — 59.6%',
    quantity          DECIMAL(10,3) DEFAULT 0,
    unit              VARCHAR(10)   DEFAULT '吨',
    unit_price        DECIMAL(10,2) DEFAULT 0,
    amount            DECIMAL(12,2) DEFAULT 0 COMMENT '金额 (元)',
    status            ENUM('draft','pending_review','approved','in_progress','completed','rejected') NOT NULL DEFAULT 'draft'
                      COMMENT 'draft=草稿 pending_review=待审核 approved=已审核 in_progress=进行中 completed=已完成 rejected=驳回',
    notes             TEXT          DEFAULT NULL,
    created_by        BIGINT UNSIGNED DEFAULT NULL COMMENT '录入人',
    audited_by        BIGINT UNSIGNED DEFAULT NULL COMMENT '审核人',
    audited_at        DATETIME      DEFAULT NULL,
    created_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_batch (batch_no),
    INDEX idx_party (party_id),
    INDEX idx_item (item_id),
    INDEX idx_purchase_date (purchase_date),

    CONSTRAINT fk_proc_party    FOREIGN KEY (party_id)    REFERENCES party(id),
    CONSTRAINT fk_proc_item     FOREIGN KEY (item_id)     REFERENCES item(id),
    CONSTRAINT fk_proc_created  FOREIGN KEY (created_by)  REFERENCES user(id),
    CONSTRAINT fk_proc_audited  FOREIGN KEY (audited_by)  REFERENCES user(id)
) ENGINE=InnoDB COMMENT='采购单 — 固定供应商 + 散户';


-- ============================================================================
-- 五、销售 — 模板 ⑥
-- ============================================================================

CREATE TABLE sales_order (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_no        VARCHAR(30)   NOT NULL,
    party_id        BIGINT UNSIGNED NOT NULL COMMENT '客户',
    ship_date       DATE          DEFAULT NULL COMMENT '发货日期',
    item_id         BIGINT UNSIGNED DEFAULT NULL COMMENT '物品 (钢种)',
    spec            VARCHAR(80)   DEFAULT NULL COMMENT '规格 — 94*1770, 220*1 150*6',
    weight_ton      DECIMAL(10,3) DEFAULT 0,
    pieces          INT           DEFAULT NULL,
    unit_price      DECIMAL(10,2) DEFAULT 0 COMMENT '单价 (元/吨)',
    amount          DECIMAL(12,2) DEFAULT 0 COMMENT '金额 (元)',
    status          ENUM('draft','pending_review','approved','rejected') NOT NULL DEFAULT 'draft'
                    COMMENT 'draft=草稿 pending_review=待审核 approved=已审核 rejected=驳回',
    notes           TEXT          DEFAULT NULL,
    created_by      BIGINT UNSIGNED DEFAULT NULL COMMENT '录入人',
    audited_by      BIGINT UNSIGNED DEFAULT NULL COMMENT '审核人',
    audited_at      DATETIME      DEFAULT NULL,
    created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_batch (batch_no),
    INDEX idx_party (party_id),
    INDEX idx_item (item_id),
    INDEX idx_ship_date (ship_date),

    CONSTRAINT fk_so_party   FOREIGN KEY (party_id)     REFERENCES party(id),
    CONSTRAINT fk_so_item    FOREIGN KEY (item_id)      REFERENCES item(id),
    CONSTRAINT fk_so_created FOREIGN KEY (created_by)   REFERENCES user(id),
    CONSTRAINT fk_so_audited FOREIGN KEY (audited_by)   REFERENCES user(id)
) ENGINE=InnoDB COMMENT='产品销售单';


-- ============================================================================
-- 六、财务 — 统一收付款 + 发票（多态关联）
-- ============================================================================

CREATE TABLE payment (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ref_type    VARCHAR(30)   NOT NULL COMMENT '关联表名: smelting_order / outsource_order / procurement_order / sales_order',
    ref_id      BIGINT UNSIGNED NOT NULL COMMENT '关联记录 ID',
    direction   ENUM('pay','receive') NOT NULL COMMENT '付款 / 收款',
    pay_date    DATE          DEFAULT NULL,
    amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
    method      VARCHAR(20)   DEFAULT NULL COMMENT '付款方式: 电汇 / 电承 / 现金 ...',
    notes       VARCHAR(200)  DEFAULT NULL,
    created_by  BIGINT UNSIGNED DEFAULT NULL,
    created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_ref (ref_type, ref_id),
    INDEX idx_pay_date (pay_date),

    CONSTRAINT fk_pay_created FOREIGN KEY (created_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='收付款记录 — 多态关联所有业务单据';


CREATE TABLE invoice (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ref_type      VARCHAR(30)   NOT NULL COMMENT '关联表名',
    ref_id        BIGINT UNSIGNED NOT NULL COMMENT '关联记录 ID',
    invoice_date  DATE          DEFAULT NULL COMMENT '开票日期',
    amount        DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '开票金额',
    invoice_no    VARCHAR(50)   DEFAULT NULL COMMENT '发票号码',
    notes         VARCHAR(200)  DEFAULT NULL,
    created_by    BIGINT UNSIGNED DEFAULT NULL,
    created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_ref (ref_type, ref_id),

    CONSTRAINT fk_inv_created FOREIGN KEY (created_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='发票记录 — 多态关联所有业务单据';


-- ============================================================================
-- 七、统一库存 — 模板 ⑦ 库房管理
-- ============================================================================

-- 当前库存（成品/半成品/合金 统一管理）
CREATE TABLE inventory (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    item_type       ENUM('product','semi_finished','alloy') NOT NULL
                    COMMENT 'product=成品 semi_finished=半成品 alloy=合金',
    item_id         BIGINT UNSIGNED DEFAULT NULL COMMENT '物品 (钢种/原料/合金)',
    spec            VARCHAR(80)   DEFAULT NULL COMMENT '规格 — 板子 / 圆钢150 / 630',
    unit            VARCHAR(10)   DEFAULT '吨' COMMENT '单位',

    -- 归属
    owner_type      ENUM('internal','external') DEFAULT 'internal'
                    COMMENT 'internal=本厂 external=客户',
    owner_id        BIGINT UNSIGNED DEFAULT NULL COMMENT '客户ID (owner_type=external时)',

    -- 当前数量
    current_pieces  INT           DEFAULT 0 COMMENT '当前支数',
    current_weight  DECIMAL(12,3) DEFAULT 0 COMMENT '当前重量 (吨/kg)',

    -- 单价金额
    unit_price      DECIMAL(10,2) DEFAULT NULL,
    amount          DECIMAL(12,2) DEFAULT NULL COMMENT '金额 = 重量 × 单价',

    notes           TEXT          DEFAULT NULL,
    created_by      BIGINT UNSIGNED DEFAULT NULL,
    created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uk_item (item_type, item_id, spec),
    INDEX idx_type (item_type),
    INDEX idx_owner (owner_type, owner_id),
    INDEX idx_item (item_id),

    CONSTRAINT fk_inv_item    FOREIGN KEY (item_id)    REFERENCES item(id),
    CONSTRAINT fk_inv_owner   FOREIGN KEY (owner_id)   REFERENCES party(id),
    CONSTRAINT fk_inv_created FOREIGN KEY (created_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='统一库存 — 成品/半成品/合金';


-- 库存变动日志（不可修改，每次库存CRUD自动生成）
CREATE TABLE inventory_log (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    inventory_id    BIGINT UNSIGNED NOT NULL,
    change_type     ENUM('in','out','adjust','init') NOT NULL
                    COMMENT 'in=入库 out=出库 adjust=盘点调整 init=初始录入',
    change_date     DATE          NOT NULL,

    -- 变化量 (±)
    delta_pieces    INT           DEFAULT 0,
    delta_weight    DECIMAL(12,3) DEFAULT 0,

    -- 变化前后快照
    before_pieces   INT           DEFAULT 0,
    before_weight   DECIMAL(12,3) DEFAULT 0,
    after_pieces    INT           DEFAULT 0,
    after_weight    DECIMAL(12,3) DEFAULT 0,

    -- 来源追踪
    ref_type        VARCHAR(30)   DEFAULT NULL COMMENT '关联业务表',
    ref_id          BIGINT UNSIGNED DEFAULT NULL COMMENT '关联记录ID',
    notes           VARCHAR(200)  DEFAULT NULL,
    created_by      BIGINT UNSIGNED DEFAULT NULL,
    created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_inventory (inventory_id),
    INDEX idx_date (change_date),
    INDEX idx_type (change_type),
    INDEX idx_ref (ref_type, ref_id),

    CONSTRAINT fk_ilog_inventory FOREIGN KEY (inventory_id) REFERENCES inventory(id),
    CONSTRAINT fk_ilog_created   FOREIGN KEY (created_by)   REFERENCES user(id)
) ENGINE=InnoDB COMMENT='库存变动日志 — 每次库存变化自动记录，不可修改';


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
    steel_grade   VARCHAR(50)   DEFAULT NULL COMMENT '钢种',
    weight_ton    DECIMAL(10,3) DEFAULT 0,
    pieces        INT           DEFAULT NULL,
    unit_price    DECIMAL(10,2) DEFAULT NULL COMMENT '单价',

    -- 金额 (借贷)
    debit         DECIMAL(12,2) DEFAULT 0 COMMENT '借方(应收/应付)',
    credit        DECIMAL(12,2) DEFAULT 0 COMMENT '贷方(已收/已付)',

    -- 付款信息
    payment_date  DATE          DEFAULT NULL COMMENT '付款日期',
    payment_amount DECIMAL(12,2) DEFAULT NULL COMMENT '付款金额',
    payment_method VARCHAR(20)  DEFAULT NULL COMMENT '付款方式: 电汇/电承/现金',

    -- 发票信息
    invoice_status ENUM('uninvoiced','invoiced') DEFAULT 'uninvoiced'
                   COMMENT 'uninvoiced=未开票 invoiced=已开票',
    invoice_date  DATE          DEFAULT NULL COMMENT '开票日期',
    invoice_amount DECIMAL(12,2) DEFAULT NULL COMMENT '开票金额',

    -- 状态
    recon_status  ENUM('unreconciled','reconciled') NOT NULL DEFAULT 'unreconciled'
                  COMMENT 'unreconciled=未对账 reconciled=已对账',

    -- 审核
    status        ENUM('draft','pending_review','approved','rejected') NOT NULL DEFAULT 'draft',

    notes         TEXT          DEFAULT NULL,
    created_by    BIGINT UNSIGNED DEFAULT NULL,
    audited_by    BIGINT UNSIGNED DEFAULT NULL,
    audited_at    DATETIME      DEFAULT NULL,
    created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_party_period (party_id, period),
    INDEX idx_recon_status (recon_status),
    INDEX idx_status (status),
    INDEX idx_ref (ref_type, ref_id),

    CONSTRAINT fk_par_party    FOREIGN KEY (party_id)   REFERENCES party(id),
    CONSTRAINT fk_par_created  FOREIGN KEY (created_by) REFERENCES user(id),
    CONSTRAINT fk_par_audited  FOREIGN KEY (audited_by) REFERENCES user(id)
) ENGINE=InnoDB COMMENT='用户对账单 — 全部往来单位，支持手动增删改';


-- ============================================================================
-- 九、操作日志 — 所有数据变更全量记录 (仅 admin 可见)
-- ============================================================================

CREATE TABLE operation_log (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT UNSIGNED NOT NULL COMMENT '操作人',
    action        ENUM('CREATE','UPDATE','DELETE','SUBMIT','APPROVE','REJECT',
                       'COMPLETE','UNAUDIT','LOGIN','LOGOUT','EXPORT')
                  NOT NULL COMMENT '操作类型',
    target_type   VARCHAR(30)   NOT NULL COMMENT '操作对象: smelting_order/outsource_order/'
                  'procurement_order/sales_order/inventory/inventory_log/item/party/user/payment/reconciliation',
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

-- 9.1 往来余额视图 — 实时计算各单据的应收/应付余额
CREATE OR REPLACE VIEW v_party_balance AS
SELECT
    p.id          AS party_id,
    p.name        AS party_name,
    p.type        AS party_type,
    'smelting_order' AS source_type,
    so.id         AS source_id,
    so.batch_no,
    COALESCE(SUM(COALESCE(aa.amount,0)), 0) +
    COALESCE(SUM(so.casting_loss_kg * 0), 0)  -- 加工费未来扩充
        AS total_amount,
    COALESCE(SUM(pay.amount), 0) AS paid_amount,
    COALESCE(SUM(COALESCE(aa.amount,0)), 0) -
    COALESCE(SUM(pay.amount), 0)  AS balance
FROM party p
JOIN smelting_order so    ON so.party_id = p.id
LEFT JOIN alloy_addition aa ON aa.order_id = so.id
LEFT JOIN payment pay     ON pay.ref_type = 'smelting_order' AND pay.ref_id = so.id AND pay.direction = 'pay'
WHERE so.order_type = 'ext_smelting'
  AND so.status IN ('approved','in_progress','completed')
GROUP BY p.id, p.name, p.type, so.id, so.batch_no

UNION ALL

SELECT
    p.id, p.name, p.type,
    'outsource_order',
    oo.id, oo.batch_no,
    COALESCE(oo.amount, 0) AS total_amount,
    COALESCE(SUM(pay.amount), 0) AS paid_amount,
    COALESCE(oo.amount, 0) - COALESCE(SUM(pay.amount), 0) AS balance
FROM party p
JOIN outsource_order oo  ON oo.party_id = p.id AND oo.status IN ('approved','in_progress','completed')
LEFT JOIN payment pay     ON pay.ref_type = 'outsource_order' AND pay.ref_id = oo.id AND pay.direction = 'pay'
GROUP BY p.id, p.name, p.type, oo.id, oo.batch_no, oo.amount

UNION ALL

SELECT
    p.id, p.name, p.type,
    'procurement_order',
    po.id, po.batch_no,
    COALESCE(po.amount, 0) AS total_amount,
    COALESCE(SUM(pay.amount), 0) AS paid_amount,
    COALESCE(po.amount, 0) - COALESCE(SUM(pay.amount), 0) AS balance
FROM party p
JOIN procurement_order po ON po.party_id = p.id AND po.status IN ('approved','in_progress','completed')
LEFT JOIN payment pay     ON pay.ref_type = 'procurement_order' AND pay.ref_id = po.id AND pay.direction = 'pay'
GROUP BY p.id, p.name, p.type, po.id, po.batch_no, po.amount

UNION ALL

SELECT
    p.id, p.name, p.type,
    'sales_order',
    so2.id, so2.batch_no,
    COALESCE(so2.amount, 0) AS total_amount,
    COALESCE(SUM(pay.amount), 0) AS paid_amount,
    COALESCE(so2.amount, 0) - COALESCE(SUM(pay.amount), 0) AS balance
FROM party p
JOIN sales_order so2    ON so2.party_id = p.id AND so2.status IN ('approved','in_progress','completed')
LEFT JOIN payment pay   ON pay.ref_type = 'sales_order' AND pay.ref_id = so2.id AND pay.direction = 'receive'
GROUP BY p.id, p.name, p.type, so2.id, so2.batch_no, so2.amount;


-- 9.2 加工批次汇总视图
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
    (SELECT SUM(weight_ton) FROM smelting_inbound WHERE order_id = so.id AND side = 'in')  AS total_feed_ton,
    -- 出钢汇总
    (SELECT SUM(weight_ton) FROM smelting_inbound WHERE order_id = so.id AND side = 'out') AS total_tap_ton,
    -- 合金金额
    (SELECT SUM(amount) FROM alloy_addition WHERE order_id = so.id)                          AS total_alloy_amount
FROM smelting_order so
LEFT JOIN party p ON p.id = so.party_id;

CREATE OR REPLACE VIEW v_outsource_summary AS
SELECT
    oo.id,
    oo.batch_no,
    p.name          AS party_name,
    oo.process_type,
    (SELECT SUM(weight_ton) FROM processing_outbound WHERE order_id = oo.id) AS total_out_ton,
    (SELECT SUM(weight_ton) FROM processing_inbound  WHERE order_id = oo.id) AS total_in_ton,
    oo.yield_rate,
    oo.saw_head_ton,
    oo.loss_ton,
    oo.unit_price,
    oo.amount
FROM outsource_order oo
LEFT JOIN party p ON p.id = oo.party_id;


-- ============================================================================
-- 验证
-- ============================================================================
SELECT 'Database hltg_accounting created successfully.' AS status;
SHOW TABLES;
