# 炼钢记录统计模块：部署与验证说明

## 项目与数据库审计结论

- 后端 ORM：SQLAlchemy 2.0 声明式模型，异步驱动 `aiomysql`。
- 项目没有 Alembic、Flyway、Liquibase 或其他自动迁移工具；历史部署方式是手工执行版本化 SQL。
- `database/schema.sql` 是完整新环境初始化脚本，不含 `DROP TABLE IF EXISTS`，不能用于生产升级。
- 初始化脚本声明 MySQL 8.0+ / MariaDB 10.5+，数据库默认 `utf8mb4_unicode_ci`，表为 InnoDB。
- 现有主键使用 `BIGINT UNSIGNED`；现有业务没有 `tenant_id/company_id`，也没有统一软删除或 `updated_by` 规范。
- 炼钢主表按本需求单独使用 `deleted` 软删除；炉号采用普通索引及 `(furnace_no, record_date)` 联合索引，不建立全局唯一约束。
- 本次审计时 `127.0.0.1:3306` 没有可连接的 MySQL 服务，Docker API 中也没有发现可读的运行容器。因此真实线上版本、字符集和 `SHOW CREATE TABLE` 必须在部署前由运维运行预检查脚本确认，不能以本地客户端版本替代。

## 数据库文件及用途

- `database/migrations/preflight_steelmaking.sql`：生产升级前只读检查。
- `database/migrations/V20260713_001__steelmaking_record.sql`：现有数据库安全增量升级，不删除历史数据。
- `database/migrations/postcheck_steelmaking.sql`：迁移后字段、索引、外键和旧物品默认值检查。
- `database/schema.sql`：最新完整结构，只用于空数据库初始化。
- `database/migrations/rollback/V20260713_001__steelmaking_record.rollback.sql`：人工破坏性回滚，绝不自动执行。

## 推荐上线顺序

1. 停止写入并完成数据库全量备份。
2. 对目标库运行只读预检查，并确认 `VERSION()` 为受支持的 MySQL 版本：

   ```bash
   mysql -h HOST -P 3306 -u USER -p DB_NAME < database/migrations/preflight_steelmaking.sql
   ```

3. 先升级数据库，再部署包含新模型的后端：

   ```bash
   mysql -h HOST -P 3306 -u USER -p DB_NAME < database/migrations/V20260713_001__steelmaking_record.sql
   ```

4. 运行迁移后检查：

   ```bash
   mysql -h HOST -P 3306 -u USER -p DB_NAME < database/migrations/postcheck_steelmaking.sql
   ```

5. 部署后端和前端，验证 `/api/v1/steelmaking-records`。

## 增量迁移与全新初始化结构对比

分别准备一个“旧结构执行增量迁移后的数据库”和一个“空库执行最新 `schema.sql` 的数据库”，然后导出四张相关表：

```bash
mysqldump --no-data --skip-comments DB_UPGRADED item steelmaking_record steelmaking_record_material steelmaking_record_composition > /tmp/upgraded.sql
mysqldump --no-data --skip-comments DB_FRESH item steelmaking_record steelmaking_record_material steelmaking_record_composition > /tmp/fresh.sql
diff -u /tmp/upgraded.sql /tmp/fresh.sql
```

还应保存两套环境的 `postcheck_steelmaking.sql` 输出。若线上数据库原有字符集/排序规则不是 `utf8mb4_unicode_ci`，迁移中新表会继承线上数据库默认值；需先决定是保持线上规范还是单独安排字符集治理，不能在本业务迁移中悄悄转换历史表。

## 自动测试

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m compileall -q app

cd ../frontend
npm run build
```

测试覆盖：

- 旧物品化学成分默认关闭的数据库定义。
- 未填写元素补 0、单元素范围及总和校验。
- kg/吨换算。
- 自定义价格优先、默认价格回退、两者都为空时成本不可计算。
- 理论成分、实际成分为空、正负偏差、总成本及单吨成本。
- 无效炉重拒绝计算。
- 增量迁移与完整 schema 的关键字段/索引/外键契约。
- 炼钢服务与路由不导入库存服务，不调用入库、出库或库存流水。

## 人工验收清单

1. 迁移前后 `item` 行数一致，所有旧物品 `chemical_enabled=0`。
2. 普通物品关闭开关时仍可新增和编辑，成分及价格区域隐藏。
3. 启用成分的物品保存 12 种元素和 DECIMAL 默认元/吨价格。
4. 炼钢原料搜索仅返回 `chemical_enabled=1 AND is_active=1` 的物品，并显示编号、主要成分及默认价格。
5. 保存记录后修改物品名称、成分或默认价格，历史详情中的快照不变化。
6. 未填实际成分时实际值和偏差为空；偏差显示正负号和四位小数。
7. 保存、编辑、确认、软删除炼钢记录前后，对比 `inventory` 与 `inventory_log` 的行数和数量，必须完全不变。
8. 已确认记录不可编辑；删除只设置主表 `deleted=1`，明细和分析数据仍保留。

## 回滚警告

人工回滚脚本包含 `DROP TABLE` 和 `DROP COLUMN`，会永久删除全部炼钢记录、成分快照和物品化学配置。只有在完成备份、停止应用并确认无需保留数据后才能由 DBA 手工执行。
