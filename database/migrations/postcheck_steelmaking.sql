-- 迁移后只读核验；保存 SHOW CREATE TABLE 输出并与全新 schema.sql 环境对比。
SELECT VERSION() AS mysql_version,
       DATABASE() AS current_database,
       @@character_set_database AS database_charset,
       @@collation_database AS database_collation;

SHOW CREATE TABLE item;
SHOW CREATE TABLE steelmaking_record;
SHOW CREATE TABLE steelmaking_record_material;
SHOW CREATE TABLE steelmaking_record_composition;

SELECT COUNT(*) AS item_count,
       SUM(chemical_enabled = 0) AS chemical_disabled_count,
       SUM(chemical_enabled = 1) AS chemical_enabled_count,
       SUM(chemical_enabled IS NULL) AS invalid_null_flag_count
FROM item;

SELECT table_name, index_name, non_unique,
       GROUP_CONCAT(column_name ORDER BY seq_in_index) AS indexed_columns
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name IN ('item', 'steelmaking_record', 'steelmaking_record_material', 'steelmaking_record_composition')
GROUP BY table_name, index_name, non_unique
ORDER BY table_name, index_name;

SELECT table_name, constraint_name, referenced_table_name, delete_rule
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND table_name IN ('steelmaking_record', 'steelmaking_record_material', 'steelmaking_record_composition')
ORDER BY table_name, constraint_name;
