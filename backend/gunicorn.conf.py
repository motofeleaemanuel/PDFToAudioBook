import os

# ─── Workers ────────────────────────────────────────────────────
# MUST stay at 1 worker because the app uses an in-memory `jobs` dict
# shared between request threads and background threads.
# Multiple workers = separate memory = status polling would break.
workers = 1

# 4 threads is ideal for the 4-core ARM Cortex-A72:
#   - 1 thread handles the current conversion job (mostly I/O-blocked on OpenAI)
#   - remaining threads handle /api/status polling, /api/health, /api/upload, etc.
threads = 4

# ─── Worker Class ───────────────────────────────────────────────
# gthread (threaded) is the correct choice:
#   - Compatible with threading.Thread used by background jobs
#   - In-memory job dict is shared across threads within the single worker
#   - gevent/eventlet would NOT work: they require monkey-patching and
#     can conflict with the existing threading + ThreadPoolExecutor code.
worker_class = "gthread"

# ─── Timeout ────────────────────────────────────────────────────
# The longest blocking request path is /api/upload which returns within
# seconds (the actual processing runs in a background thread).
# Set to 120s to handle slow PDF uploads over Ngrok + allow for Pi
# latency during PDF parsing. 600s was excessive and masked hung workers.
timeout = 120

# ─── Graceful Timeout ───────────────────────────────────────────
# Allow current requests to finish before worker restart.
graceful_timeout = 30

# ─── Keep-Alive ─────────────────────────────────────────────────
# Short keep-alive to free up threads quickly for new polling requests.
keepalive = 5

# ─── Memory Guard ───────────────────────────────────────────────
# Restart the worker after this many requests to prevent slow memory leaks
# (PyMuPDF, OpenAI SDK, etc.). On a 2GB device this is critical.
max_requests = 200
max_requests_jitter = 30

# ─── Preloading ─────────────────────────────────────────────────
# Do NOT preload — preloading loads app in master process, but threads
# run in workers, causing the jobs dict to be in the wrong process.
preload_app = False

# ─── Logging ────────────────────────────────────────────────────
loglevel = "info"
accesslog = "-"
errorlog = "-"

# ─── Bind ───────────────────────────────────────────────────────
bind = os.getenv("BIND", "0.0.0.0:5000")
