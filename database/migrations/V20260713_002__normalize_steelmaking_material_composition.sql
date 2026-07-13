-- 炼钢原料化学成分快照精度规范化
-- 将历史 JSON 快照统一为 6 位小数字符串，与 steelmaking_record_composition 的 DECIMAL(12,6) 一致。
-- 本脚本不修改表结构，不删除记录；执行前仍建议完成数据库备份。

SET NAMES utf8mb4;

UPDATE steelmaking_record_material
SET chemical_composition_snapshot = JSON_OBJECT(
    'C',  CAST(CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(chemical_composition_snapshot, '$.C')),  'null'), '0') AS DECIMAL(12,6)) AS CHAR),
    'Mn', CAST(CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(chemical_composition_snapshot, '$.Mn')), 'null'), '0') AS DECIMAL(12,6)) AS CHAR),
    'Si', CAST(CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(chemical_composition_snapshot, '$.Si')), 'null'), '0') AS DECIMAL(12,6)) AS CHAR),
    'Cr', CAST(CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(chemical_composition_snapshot, '$.Cr')), 'null'), '0') AS DECIMAL(12,6)) AS CHAR),
    'W',  CAST(CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(chemical_composition_snapshot, '$.W')),  'null'), '0') AS DECIMAL(12,6)) AS CHAR),
    'Mo', CAST(CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(chemical_composition_snapshot, '$.Mo')), 'null'), '0') AS DECIMAL(12,6)) AS CHAR),
    'V',  CAST(CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(chemical_composition_snapshot, '$.V')),  'null'), '0') AS DECIMAL(12,6)) AS CHAR),
    'Co', CAST(CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(chemical_composition_snapshot, '$.Co')), 'null'), '0') AS DECIMAL(12,6)) AS CHAR),
    'Nb', CAST(CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(chemical_composition_snapshot, '$.Nb')), 'null'), '0') AS DECIMAL(12,6)) AS CHAR),
    'Ni', CAST(CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(chemical_composition_snapshot, '$.Ni')), 'null'), '0') AS DECIMAL(12,6)) AS CHAR),
    'P',  CAST(CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(chemical_composition_snapshot, '$.P')),  'null'), '0') AS DECIMAL(12,6)) AS CHAR),
    'S',  CAST(CAST(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(chemical_composition_snapshot, '$.S')),  'null'), '0') AS DECIMAL(12,6)) AS CHAR)
);

SELECT ROW_COUNT() AS normalized_material_snapshot_rows;
SELECT 'V20260713_002 composition snapshot normalization completed' AS migration_status;
