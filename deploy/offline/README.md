# 汇隆特钢会计系统离线 Docker 部署

## 文件清单

离线机器需要拿到这些文件：

- `docker-compose.yml`
- `.env.docker.example`
- `database/schema.sql`（用于手动初始化服务器 MySQL）
- `deploy/offline/load-images.sh`
- `docker-images/hltg-accounting-backend-amd64.tar`
- `docker-images/hltg-accounting-frontend-amd64.tar`

## 首次部署

```bash
cp .env.docker.example .env
vim .env
./deploy/offline/load-images.sh
docker compose up -d
```

启动前请先在服务器已安装的 MySQL 中创建数据库并导入表结构：

```bash
mysql -u root -p < database/schema.sql
```

启动后访问：

- 前端：`http://服务器IP:8080`
- 后端：`http://服务器IP:8000/health`

默认账号：

- 用户名：`admin`
- 密码：`admin123`

## 修改端口或密码

编辑根目录 `.env`：

```bash
BACKEND_PORT=8000
BACKEND_HOST=0.0.0.0
FRONTEND_PORT=8080
DB_HOST=host.docker.internal
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=hltg_accounting
JWT_SECRET_KEY=change-me-in-production
```

生产环境建议修改 `JWT_SECRET_KEY`，并使用专门的数据库账号。

如果服务器的 Docker 不支持 `host.docker.internal`，请把 `DB_HOST` 改成服务器内网 IP，或改成 MySQL 所在机器的实际 IP。

## 停止服务

```bash
docker compose down
```
