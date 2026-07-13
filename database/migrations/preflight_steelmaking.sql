-- 生产升级前只读检查。请保存输出，并确认数据库为 MySQL 8.0+ 后再执行迁移。
SELECT VERSION() AS mysql_version,
       DATABASE() AS current_database,
       @@character_set_database AS database_charset,
       @@collation_database AS database_collation,
       @@sql_mode AS sql_mode;

SELECT table_name, engine, table_collation
FROM information_schema.tables
WHERE table_schema = DATABASE()
ORDER BY table_name;

SELECT table_name, column_name, column_type, is_nullable, column_default, extra, character_set_name, collation_name
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name IN ('user', 'item', 'inventory')
ORDER BY table_name, ordinal_position;

SHOW CREATE TABLE item;
SHOW CREATE TABLE user;
SHOW CREATE TABLE inventory;

SELECT COUNT(*) AS existing_item_count FROM item;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'item'
  AND column_name IN ('chemical_enabled', 'chemical_composition', 'default_price');
