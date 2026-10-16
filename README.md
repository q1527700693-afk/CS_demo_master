# CS Demo Master

CS Demo Master is a CS2 demo analysis and team-building platform.

## Modules

```text
frontend/   Web frontend: lobby, profile, mini games, analysis report
backend/    FastAPI backend API
parser/     Demo parsing and log generation
ai/         AI analysis prompts and service layer
docs/       API documentation and design documents
deploy/     Deployment configuration
```

## Tech Stack

- Frontend: Vue 3 + Vite
- Backend: Node.js + Express
- Database: SQLite (MVP) / PostgreSQL
- Demo Parser: Python + awpy
- AI: LLM API for demo log analysis

## Quick Start

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### API Documentation

See `docs/api-v1.md`.

## Team

- Backend Lead: Shiyu Qian
- Frontend:
- Parser:
- AI:
- Docs / QA:

## Backend Tasks

See [backend/TASKS.md](backend/TASKS.md).
