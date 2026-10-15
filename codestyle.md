# CS Demo Master Code Style

## Backend

- Follow PEP 8.
- Use type hints.
- Use 4 spaces for indentation.
- Keep API routes thin and move business logic into `services/`.
- Use Pydantic schemas for request and response validation.
- Never commit `.env` or secrets.

## Frontend

- Follow ESLint and Vue style guide.
- Use 2 spaces for indentation.
- Use small components and reusable UI elements.
- Keep API calls in an `api/` directory.

## Git

- Use feature branches and Pull Requests.
- Do not push directly to `main`.
- Write meaningful commit messages.
