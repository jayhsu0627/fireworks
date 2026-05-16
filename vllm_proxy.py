from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import httpx

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

VLLM_URL = "http://127.0.0.1:8000/v1/completions"

@app.post("/v1/completions")
async def completions(req: Request):
    body = await req.body()
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(
            VLLM_URL,
            content=body,
            headers={"Content-Type": "application/json"},
        )
    return r.json()