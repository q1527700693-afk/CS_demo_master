from fastapi import FastAPI

app = FastAPI(
    title="CS Demo Master API",
    version="1.0.0",
)


@app.get("/api/v1/health")
def health():
    return {
        "code": 0,
        "message": "success",
        "data": {"status": "ok"},
    }
