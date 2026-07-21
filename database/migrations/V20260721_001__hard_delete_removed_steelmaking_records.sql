-- 历史版本使用 deleted=TRUE 软删除炼钢记录，其材料快照仍会占用 item 外键。
-- 按照硬删除新规则，先删除子表快照，再删除已经软删除的主记录。
DELETE c
FROM steelmaking_record_composition AS c
INNER JOIN steelmaking_record AS r ON r.id = c.record_id
WHERE r.deleted = TRUE;

DELETE m
FROM steelmaking_record_material AS m
INNER JOIN steelmaking_record AS r ON r.id = m.record_id
WHERE r.deleted = TRUE;

DELETE FROM steelmaking_record
WHERE deleted = TRUE;
