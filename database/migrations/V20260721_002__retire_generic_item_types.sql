-- 原料、成品、半成品过于笼统，不再作为可新建物品的类型选项。
-- item.item_type 和 inventory_log.item_type 是历史快照字符串，无外键依赖；
-- 删除配置项不会篡改既有业务记录，旧数据仍可按原中文名称展示并改选为具体类型。
DELETE FROM master_data_option
WHERE category = 'item_type'
  AND code IN ('raw_material', 'finished_product', 'semi_finished');
