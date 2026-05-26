FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY cloudnet/ ./cloudnet/
COPY main.py .
COPY migrations/ ./migrations/

RUN mkdir -p /app/uploads /app/static

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
