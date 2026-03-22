import os

# Bind to the PORT env variable set by Render (default 10000)
bind = f"0.0.0.0:{os.environ.get('PORT', '5000')}"

# Workers
workers = 1

# Timeout (long enough for PDF processing)
timeout = 600

# Preload app so import errors surface immediately
preload_app = True

# Logging
loglevel = "info"
accesslog = "-"
errorlog = "-"
