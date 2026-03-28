"""
OpenAI Rate Limit Guard
Provides a global concurrency semaphore and retry-with-backoff decorator
to prevent 429 errors when multiple jobs hit the OpenAI API simultaneously.
"""

import time
import threading
from functools import wraps
from openai import RateLimitError

# ── Global Concurrency Limiter ──────────────────────────────────
# Even with multiple background threads processing PDFs in parallel,
# we limit the maximum number of simultaneous in-flight OpenAI requests.
# This prevents instant TPM/RPM exhaustion on free/low-tier accounts.
_openai_semaphore = threading.Semaphore(2)

# ── Retry Configuration ────────────────────────────────────────
MAX_RETRIES = 5
BASE_DELAY = 2.0   # seconds
MAX_DELAY = 60.0    # seconds


def with_rate_limit(func):
    """
    Decorator that wraps any OpenAI API call with:
    1. Global semaphore (max 2 concurrent requests)
    2. Exponential backoff retry on 429 RateLimitError
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        for attempt in range(1, MAX_RETRIES + 1):
            _openai_semaphore.acquire()
            try:
                return func(*args, **kwargs)
            except RateLimitError as e:
                # Parse retry-after hint from the error if available
                retry_after = _parse_retry_after(e)
                delay = max(retry_after, BASE_DELAY * (2 ** (attempt - 1)))
                delay = min(delay, MAX_DELAY)

                if attempt == MAX_RETRIES:
                    print(f"  ❌ OpenAI rate limit: max retries ({MAX_RETRIES}) exhausted.")
                    raise

                print(f"  ⏳ OpenAI 429 — waiting {delay:.1f}s (attempt {attempt}/{MAX_RETRIES})")
                time.sleep(delay)
            finally:
                _openai_semaphore.release()

        # Should never reach here, but just in case
        raise RuntimeError("Rate limit retries exhausted")

    return wrapper


def _parse_retry_after(error: RateLimitError) -> float:
    """
    Try to extract the suggested wait time from the 429 error message.
    OpenAI errors often contain "Please try again in X.XXs" or
    "Please retry after X seconds".
    """
    try:
        msg = str(error)
        # Look for "in X.XXs" pattern
        if "try again in" in msg.lower():
            parts = msg.lower().split("try again in")
            time_part = parts[-1].strip().split("s")[0].strip()
            return float(time_part)
        if "retry after" in msg.lower():
            parts = msg.lower().split("retry after")
            time_part = parts[-1].strip().split(" ")[0].strip().rstrip("s")
            return float(time_part)
    except (ValueError, IndexError):
        pass
    return 0.0
