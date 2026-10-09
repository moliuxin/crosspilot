"""Fake OpenAI 兼容协议 LLM 服务器（验证真实链路 / 本地调试用）。

用途：
- pytest（tests/test_llm_provider.py）进程内起真实 HTTP 服务，验证 openai provider 全链路；
- 手动联调：python -m uvicorn tools.fake_llm_server:app --port 8100，
  后端 .env 配 SITEPILOT_LLM_BASE_URL=http://127.0.0.1:8100/v1 即可。

行为：任何 /v1/chat/completions 请求都返回固定 JSON（{"text": ...}），
并在 CALLS 中记录每次调用（model / messages）供断言。
"""
from __future__ import annotations

import json

from fastapi import FastAPI, Request

app = FastAPI(
    title="Fake LLM Server",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

# 每次 /v1/chat/completions 调用的记录（含 model 与 messages），测试用
CALLS: list[dict] = []

# 固定改写文案：测试断言改写结果包含 "LLM rewritten"
FIXED_TEXT = "LLM rewritten: 24h quotation, factory-direct supply"


@app.get("/health")
def health():
    """就绪探针（测试夹具用它等待端口可用）。"""
    return {"status": "ok"}


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    """OpenAI Chat Completions 协议的最小兼容实现。"""
    body = await request.json()
    CALLS.append(
        {
            "model": body.get("model", ""),
            "messages": body.get("messages", []),
        }
    )
    content = json.dumps({"text": FIXED_TEXT}, ensure_ascii=False)
    return {
        "id": "chatcmpl-fake-000",
        "object": "chat.completion",
        "created": 0,
        "model": body.get("model", "fake-gpt"),
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": content},
            }
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }
