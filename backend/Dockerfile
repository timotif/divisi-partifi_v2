FROM python:3.12-slim

WORKDIR /app

# requirements.txt is at project root; compose sets build context to project root
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY backend/ .

RUN mkdir -p /app/tmp

EXPOSE 5000

# Single worker + threads: in-memory session store is NOT multi-process safe
# access log -> stdout (-), error/app log -> stderr (-).
# docker compose logs merges both streams, so each line appears twice — this is expected.
# To isolate: `docker logs <container> 2>/dev/null` (stdout) or `1>/dev/null` (stderr).
CMD ["gunicorn", "--workers", "1", "--threads", "4", "--bind", "0.0.0.0:5000", "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-", "app:app"]
