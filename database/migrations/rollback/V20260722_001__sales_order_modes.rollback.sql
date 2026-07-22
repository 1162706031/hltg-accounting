-- 人工回滚脚本：执行前请先备份数据库，并确认所有 item_spec 模式订单已妥善处理。
ALTER TABLE sales_order DROP COLUMN sales_mode;
