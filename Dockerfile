# CrossPilot 后端镜像（FastAPI + SQLAlchemy，PostgreSQL）
# 构建上下文 = 仓库根目录：docker build -t crosspilot-api .
#
# 国内构建默认走 DaoCloud 镜像 + 清华 PyPI；海外环境可在 .env 覆盖：
#   PYTHON_IMAGE=python:3.11-slim
#   PIP_INDEX_URL=https://pypi.org/simple
ARG PYTHON_IMAGE=docker.m.daocloud.io/library/python:3.11-slim
FROM ${PYTHON_IMAGE}

ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL}

WORKDIR /app

# 先装依赖，利用层缓存（源码改动不触发重装）
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY backend /app/backend

WORKDIR /app/backend

# 非 root 运行
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
