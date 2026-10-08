"""Fake OpenAI-compatible LLM server（本地测试/演示用）。

实现 OpenAI /chat/completions 协议的最小子集：
  - POST {base}/chat/completions
  - Bearer 鉴权（api_key 校验）
  - response_format: {"type": "json_object"}
  - 返回 choices[0].message.content 为合法 JSON 字符串 + usage 统计

用途：在无外部 API key 的环境里验证「真实 LLM 链路」——后端 httpx 走的是
与真实 OpenAI/DeepSeek 完全相同的协议与代码路径，替换 base_url 即接真模型。

启动：
    python3 backend/tools/fake_llm_server.py   # 默认 127.0.0.1:8100

环境变量：
    FAKE_LLM_PORT=8100  FAKE_LLM_API_KEY=test-key-123  FAKE_LLM_FAIL=0（1=全部返回 500）
"""
from __future__ import annotations

import json
import os
import re
import time

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Fake OpenAI-compatible LLM")

API_KEY = os.environ.get("FAKE_LLM_API_KEY", "test-key-123")
FAIL_ALL = os.environ.get("FAKE_LLM_FAIL", "0") == "1"

# 请求计数（进程内），供测试断言「确实打到了 LLM server」
CALLS: list[dict] = []


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    temperature: float | None = None
    response_format: dict | None = None


def _extract(user: str, pattern: str, default: str = "") -> str:
    m = re.search(pattern, user)
    return m.group(1).strip() if m else default


@app.get("/health")
def health():
    return {"ok": not FAIL_ALL, "calls": len(CALLS)}


@app.post("/v1/chat/completions")
def chat_completions(req: ChatRequest, authorization: str = Header(default="")):
    if not authorization.startswith(f"Bearer {API_KEY}"):
        raise HTTPException(status_code=401, detail="Invalid API key")
    if FAIL_ALL:
        raise HTTPException(status_code=503, detail="fake LLM temporarily down")

    system = req.messages[0].content if req.messages else ""
    user = req.messages[1].content if len(req.messages) > 1 else ""
    CALLS.append({"model": req.model, "system_head": system[:40], "t": time.time()})

    # 按 system prompt 类型生成对应结构（内容与后端内置模板措辞明显不同，
    # 便于验证响应确实来自「LLM」而不是降级模板）
    if "SEO/GEO 专家" in system:
        name = _extract(user, r"产品：(.+?)\s*/")
        content = {
            "title": f"{name or 'Industrial Unit'} — Factory-Direct B2B Guide",
            "slug": f"/{re.sub(r'[^a-z0-9]+', '-', (name or 'product').lower()).strip('-')}-guide/",
            "meta_description": "LLM-written meta description targeting procurement-intent queries.",
            "h1": f"{name or 'Industrial Unit'}: Specification & Sourcing",
            "faq": ["MOQ and lead time?", "Certifications provided?", "OEM branding options?"],
            "image_alt": [f"{name or 'Unit'} workshop view", f"{name or 'Unit'} packaging"],
            "keywords": ["b2b supplier", "factory price"],
            "internal_links": ["/products/"],
            "schema": ["Product", "FAQPage"],
            "summary": "LLM 生成：补齐采购意图关键词与结构化数据。",
        }
    elif "首屏文案专家" in system:
        text = f"LLM rewritten copy · {_extract(user, r'额外要求：(.+)')[:40] or 'B2B focused'}"
        content = {"text": text}
    elif "运营 Agent" in system:
        content = {"intent": "unknown", "summary": "LLM 判定：请使用快捷指令。", "rows": []}
    elif "内容专家" in system:
        name = _extract(user, r"产品名称：(.+)")
        n = name or "Industrial Equipment"
        content = {
            "en": {
                "title": f"{n} Supplier & Exporter | Verified Factory",
                "description": f"Independently engineered {n.lower()} with documented QA process. Verified factory-direct pricing.",
                "benefits": ["ISO-certified production line", "Documented QA reports", "Spare-parts availability"],
                "faq": ["What certifications ship with the unit?", "How is packaging handled?", "Can we audit the factory?"],
                "imageAlt": [f"{n} production line", f"{n} export packing"],
                "keywords": [n.lower(), "verified factory"],
            },
            "zh": {
                "title": f"{n} 出口供应商 | 实力工厂",
                "description": f"面向海外采购商的 {n}，出厂检验资料齐全，支持验厂。",
                "benefits": ["出厂检验报告", "支持验厂", "备件供应"],
                "faq": ["随货提供哪些认证？", "包装方案是怎样的？", "是否可以验厂？"],
                "imageAlt": [f"{n} 生产线", f"{n} 出口包装"],
                "keywords": [n, "出口供应商"],
            },
            "ru": {
                "title": f"{n} — проверенный завод-поставщик",
                "description": f"{n} с полной документацией ОТК. Возможен аудит производства.",
                "benefits": ["Документация ОТК", "Аудит завода", "Запчасти"],
                "faq": ["Какие сертификаты входят?", "Как упаковка?", "Возможен аудит?"],
                "imageAlt": [f"{n} производство", f"{n} экспортная упаковка"],
                "keywords": [n, "завод поставщик"],
            },
            "applications": ["LLM-generated application"],
        }
    else:
        content = {"text": "ok (fake llm)"}

    return {
        "id": f"chatcmpl-fake-{len(CALLS)}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": req.model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": json.dumps(content, ensure_ascii=False)},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 120, "completion_tokens": 180, "total_tokens": 300},
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("FAKE_LLM_PORT", "8100")), log_level="warning")
