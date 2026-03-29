"""
OpenAI Rate Limit Guard
Provides a global concurrency semaphore and retry-with-backoff decorator
to prevent 429 errors when multiple jobs hit the OpenAI API simultaneously.
"""

import time
import threading
from functools import wraps

# ── Global Concurrency Limiter ──────────────────────────────────
# Limits the maximum simultaneous in-flight OpenAI requests across ALL threads.
# This prevents instant TPM/RPM exhaustion on free/low-tier accounts.
_openai_semaphore = threading.Semaphore(2)

# ── Retry Configuration ────────────────────────────────────────
MAX_RETRIES = 6
BASE_DELAY = 4.0   # seconds (first retry waits 4s, then 8s, 16s, 32s, 64s)
MAX_DELAY = 90.0   # seconds


def _is_rate_limit_error(exc):
    """Check if an exception is an OpenAI 429 RateLimitError (without hard import dependency)."""
    return type(exc).__name__ == "RateLimitError" or (
        hasattr(exc, "status_code") and getattr(exc, "status_code", None) == 429
    )


def _parse_retry_after(error) -> float:
    """
    Try to extract the suggested wait time from the 429 error message.
    OpenAI errors often contain "Please try again in X.XXs".
    """
    try:
        msg = str(error)
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


class CancelledError(Exception):
    """Raised when a rate-limited call detects job cancellation."""
    pass


def with_rate_limit(func):
    """
    Decorator that wraps any OpenAI API call with:
    1. Global semaphore (max 2 concurrent requests) via context manager
    2. Exponential backoff retry on 429 RateLimitError (max 6 retries)
    3. Cancellation awareness — pass check_cancelled=callable as kwarg
    4. Trace logging for debugging hangs
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        func_name = func.__qualname__

        # Extract check_cancelled from kwargs (don't pass it to the actual function)
        check_cancelled = kwargs.pop("check_cancelled", None)

        for attempt in range(1, MAX_RETRIES + 1):
            # ── Check cancellation before each attempt ──
            if check_cancelled and check_cancelled():
                print(f"    🛑 [{func_name}] Cancelled before attempt {attempt} — aborting.")
                raise CancelledError(f"{func_name} cancelled")

            print(f"    🔒 [{func_name}] Attempt {attempt}/{MAX_RETRIES} — waiting for semaphore...")

            with _openai_semaphore:
                # Check again after potentially waiting for semaphore
                if check_cancelled and check_cancelled():
                    print(f"    🛑 [{func_name}] Cancelled after semaphore wait — aborting.")
                    raise CancelledError(f"{func_name} cancelled")

                print(f"    🟢 [{func_name}] Semaphore acquired — calling OpenAI...")
                try:
                    result = func(*args, **kwargs)
                    print(f"    ✅ [{func_name}] OpenAI responded OK.")
                    return result
                except Exception as e:
                    if _is_rate_limit_error(e):
                        retry_after = _parse_retry_after(e)
                        delay = max(retry_after, BASE_DELAY * (2 ** (attempt - 1)))
                        delay = min(delay, MAX_DELAY)

                        if attempt == MAX_RETRIES:
                            print(f"    ❌ [{func_name}] Rate limit: max retries ({MAX_RETRIES}) exhausted. Raising.")
                            raise

                        print(f"    ⏳ [{func_name}] 429 rate limit — sleeping {delay:.1f}s before retry...")
                        # Semaphore is RELEASED here (exiting `with` block) before sleeping
                    else:
                        # Non-rate-limit error — don't retry, just raise immediately
                        print(f"    ❌ [{func_name}] Non-retryable error: {type(e).__name__}: {e}")
                        raise

            # Sleep OUTSIDE the semaphore in small increments so we can check cancellation
            sleep_remaining = delay
            while sleep_remaining > 0:
                if check_cancelled and check_cancelled():
                    print(f"    🛑 [{func_name}] Cancelled during backoff sleep — aborting.")
                    raise CancelledError(f"{func_name} cancelled")
                chunk = min(0.5, sleep_remaining)
                time.sleep(chunk)
                sleep_remaining -= chunk

        # Should never reach here, but safety net
        raise RuntimeError(f"[{func_name}] Retry loop exited without return or raise")

    return wrapper
