-- !!! 人工回滚脚本：不会被应用自动执行 !!!
-- !!! 下列 DROP TABLE / DROP COLUMN 会永久删除炼钢记录与化学成分配置。执行前必须完整备份并停机。 !!!
-- 推荐仅在迁移后尚未录入任何炼钢数据且确认必须回退时使用。

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS steelmaking_record_composition;
DROP TABLE IF EXISTS steelmaking_record_material;
DROP TABLE IF EXISTS steelmaking_record;
SET FOREIGN_KEY_CHECKS = 1;

ALTER TABLE item DROP INDEX idx_chemical_enabled;
ALTER TABLE item DROP COLUMN default_price;
ALTER TABLE item DROP COLUMN chemical_composition;
ALTER TABLE item DROP COLUMN chemical_enabled;
