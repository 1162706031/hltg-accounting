USE hltg_accounting;

DROP TABLE IF EXISTS smelting_inbound_steelmaking_record;

ALTER TABLE steelmaking_record_material
    DROP COLUMN custom_price_unit;
