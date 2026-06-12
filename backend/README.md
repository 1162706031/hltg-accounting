# HLTG Accounting Backend

FastAPI + SQLAlchemy async backend for the HLTG accounting ERP.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Create the database with:

```bash
mysql -u root -p < ../database/schema.sql
```

Run the API:

```bash
python app/main.py
```

The API host and port are configured in `.env`:

```env
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8000
```

Open API docs:

```text
http://localhost:8000/docs
```

Default admin from `database/schema.sql`:

```text
username: admin
password: admin123
```
