-- 人工回滚脚本：禁止自动执行。
-- 警告：DROP COLUMN 会永久删除全部炼钢批次号。执行前必须备份数据库。

ALTER TABLE steelmaking_record DROP INDEX idx_steelmaking_batch_no;
ALTER TABLE steelmaking_record DROP COLUMN batch_no;
