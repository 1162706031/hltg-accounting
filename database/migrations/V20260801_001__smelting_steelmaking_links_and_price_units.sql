USE hltg_accounting;

ALTER TABLE steelmaking_record_material
    ADD COLUMN custom_price_unit ENUM('yuan_per_kg','yuan_per_ton') NOT NULL DEFAULT 'yuan_per_ton'
        COMMENT '本次单价录入单位' AFTER custom_price;

CREATE TABLE IF NOT EXISTS smelting_inbound_steelmaking_record (
    smelting_inbound_id   BIGINT UNSIGNED NOT NULL,
    steelmaking_record_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (smelting_inbound_id, steelmaking_record_id),
    INDEX idx_sisr_steelmaking_record (steelmaking_record_id),
    CONSTRAINT fk_sisr_smelting_inbound
        FOREIGN KEY (smelting_inbound_id) REFERENCES smelting_inbound(id) ON DELETE CASCADE,
    CONSTRAINT fk_sisr_steelmaking_record
        FOREIGN KEY (steelmaking_record_id) REFERENCES steelmaking_record(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='冶炼出钢明细与炼钢记录多对多关联';

-- 兼容历史数据：把能够按炉号精确匹配的旧出钢明细建立关联。
INSERT IGNORE INTO smelting_inbound_steelmaking_record (smelting_inbound_id, steelmaking_record_id)
SELECT inbound.id, record.id
FROM smelting_inbound AS inbound
JOIN steelmaking_record AS record ON record.furnace_no = inbound.furnace_no AND record.deleted = FALSE
WHERE inbound.side = 'out'
  AND inbound.furnace_no IS NOT NULL
  AND inbound.furnace_no <> ''
  AND (
      SELECT COUNT(*)
      FROM steelmaking_record AS candidate
      WHERE candidate.furnace_no = inbound.furnace_no AND candidate.deleted = FALSE
  ) = 1;
