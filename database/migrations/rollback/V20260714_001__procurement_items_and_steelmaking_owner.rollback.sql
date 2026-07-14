-- 人工回滚脚本：禁止自动执行。
-- 警告：DROP TABLE 会永久删除所有采购多物品明细；DROP COLUMN 会永久删除炼钢所属数据。
-- 执行前必须完成数据库备份，并确认应用已回退到旧版本。

DROP TABLE IF EXISTS procurement_order_item;

ALTER TABLE steelmaking_record DROP FOREIGN KEY fk_steelmaking_owner;
ALTER TABLE steelmaking_record DROP INDEX idx_steelmaking_owner;
ALTER TABLE steelmaking_record DROP COLUMN owner_id;
