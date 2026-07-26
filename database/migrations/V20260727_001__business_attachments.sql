USE hltg_accounting;

CREATE TABLE IF NOT EXISTS business_attachment (
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
