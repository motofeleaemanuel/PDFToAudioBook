import os

# Bind to the PORT env variable set by Render (default 5000 for local dev)
bind = f"0.0.0.0:{os.environ.get('PORT', '5000')}"

# Single worker with threads — allows background threads (PDF processing)
# to share memory with request-handling threads (status polling)
workers = 1
threads = 4

# Timeout (long enough for PDF processing via OpenAI API)
timeout = 600

# Do NOT preload — preloading loads app in master, but threads run in workers
# which causes the jobs dict to be separate between master and worker
preload_app = False

# Logging
loglevel = "info"
accesslog = "-"
errorlog = "-"
