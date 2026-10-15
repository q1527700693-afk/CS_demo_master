# CS Demo Master API Documentation v1

Base URL: `/api/v1`

## 1. Common Conventions

### Response Format

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

### Error Format

```json
{
  "code": 40001,
  "message": "Invalid credentials",
  "data": null
}
```

### Authentication

```http
Authorization: Bearer <token>
```

### Pagination

Request:

```text
?page=1&pageSize=20
```

Response:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [],
    "page": 1,
    "pageSize": 20,
    "total": 0
  }
}
```

## 2. Authentication

### POST /api/v1/auth/register

### POST /api/v1/auth/login

### POST /api/v1/auth/logout

### GET /api/v1/users/me

## 3. User Profile

### GET /api/v1/users/me/profile

### PATCH /api/v1/users/me/profile

### GET /api/v1/users/{userId}/profile

### POST /api/v1/users/me/avatar

### DELETE /api/v1/users/me/avatar

## 4. Lobby

### GET /api/v1/lobbies

### POST /api/v1/lobbies

### GET /api/v1/lobbies/{lobbyId}

### POST /api/v1/lobbies/{lobbyId}/join

### DELETE /api/v1/lobbies/{lobbyId}/leave

### POST /api/v1/lobbies/{lobbyId}/ready

### POST /api/v1/lobbies/{lobbyId}/unready

### POST /api/v1/lobbies/{lobbyId}/start

## 5. Mini Games (Draft)

### POST /api/v1/minigames/aim/scores

### GET /api/v1/minigames/aim/leaderboard

## 6. Demo Analysis (Draft)

### POST /api/v1/demos

### POST /api/v1/demos/{demoId}/analyze

### GET /api/v1/demos/{demoId}/status

### GET /api/v1/demos/{demoId}/report

## 7. Error Codes

| Code | HTTP | Description |
|---:|---:|---|
| 0 | 200 | Success |
| 40000 | 400 | Invalid parameter |
| 40001 | 401 | Invalid username or password |
| 40002 | 401 | Invalid or expired token |
| 40300 | 403 | Forbidden |
| 40400 | 404 | Resource not found |
| 40900 | 409 | Resource conflict |
| 41300 | 413 | File too large |
| 50000 | 500 | Internal server error |

## 8. Changelog

| Version | Date | Author | Description |
|---|---|---|---|
| v1.0 | 2026-10-01 | Shiyu Qian | Initial API document |
