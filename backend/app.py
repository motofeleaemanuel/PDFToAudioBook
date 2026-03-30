"""
Flask API Server — PDF to Romanian Audiobook
Handles PDF upload, conversion to audio, progress tracking, and file download.
Includes access code authentication and rate limiting.
"""

import os
import uuid
import time
import threading
from collections import defaultdict
from functools import wraps
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

from flask import Flask, request, jsonify, send_file, redirect, g
from flask_cors import CORS

from pdf_extractor import PDFExtractor
from text_processor import TextProcessor
from text_refiner import TextRefiner
from tts_engine import TTSEngine
from storage import AudiobookStorage
from job_store import JobStore

# ── App Setup ──────────────────────────────────────────────────
app = Flask(__name__)

# Allow configurable origins for Vercel deployment (removes whitespace and trailing slashes)
# Now even more robust: if someone puts "app.vercel.app", it adds "https://" automatically
def normalize_origin(orig):
    orig = orig.strip().rstrip("/")
    if orig and not orig.startswith(("http://", "https://")):
        orig = f"https://{orig}"
    return orig

raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
ALLOWED_ORIGINS = [normalize_origin(o) for o in raw_origins if o.strip()]
CORS(app, origins=ALLOWED_ORIGINS, supports_credentials=True, allow_headers=["Content-Type", "Authorization", "ngrok-skip-browser-warning", "Accept"])

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
# Ensure directory creation is reliable
for d in [UPLOAD_DIR, OUTPUT_DIR]:
    if not os.path.exists(d):
        os.makedirs(d, exist_ok=True)
        print(f"  📁 Created directory: {d}")

# Access code from environment (default for dev)
ACCESS_CODE = os.getenv("ACCESS_CODE", "audiobook2024")

# Rate limiting: max conversions per hour per IP
RATE_LIMIT_MAX = int(os.getenv("RATE_LIMIT_MAX", "20"))
RATE_LIMIT_WINDOW = 3600  # 1 hour in seconds
rate_limit_store = defaultdict(list)  # IP -> [timestamps]

# Persistent job store (survives Gunicorn worker restarts)
job_store = JobStore()

# ── Caching for Supabase Auth ────────────────────────────────────
_AUTH_CACHE = {}  # token -> (user_id, timestamp)
_AUTH_CACHE_TTL = 300  # 5 minutes


# ── Rate Limiting ──────────────────────────────────────────────
def get_client_ip():
    """Get the real client IP, considering proxies."""
    if request.headers.get("X-Forwarded-For"):
        return request.headers.get("X-Forwarded-For").split(",")[0].strip()
    return request.remote_addr


def check_rate_limit(ip: str) -> bool:
    """Check if IP has exceeded rate limit. Returns True if allowed."""
    now = time.time()
    # Clean old entries
    rate_limit_store[ip] = [t for t in rate_limit_store[ip] if now - t < RATE_LIMIT_WINDOW]
    return len(rate_limit_store[ip]) < RATE_LIMIT_MAX


def record_request(ip: str):
    """Record a conversion request for rate limiting."""
    rate_limit_store[ip].append(time.time())


# ── Auth Middleware ────────────────────────────────────────────
def require_auth(f):
    """
    Decorator to authenticate requests.
    Supports two modes:
      1. Supabase JWT (primary) — validates the token directly with Supabase API
      2. Legacy access code (fallback) — simple string match for backwards compatibility
    Sets g.user_id for downstream use.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        from flask import g, make_response
        from storage import AudiobookStorage
        
        if request.method == "OPTIONS":
            response = make_response()
            response.headers.add("Access-Control-Allow-Origin", request.headers.get("Origin", "*"))
            response.headers.add("Access-Control-Allow-Headers", "Content-Type, Authorization, ngrok-skip-browser-warning, Accept")
            response.headers.add("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            response.headers.add("Access-Control-Allow-Credentials", "true")
            return response, 200

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing authentication token."}), 401
            
        token = auth_header.replace("Bearer ", "")

        # 1. Check local cache first to avoid slow network requests on every poll
        now = time.time()
        if token in _AUTH_CACHE:
            user_id, timestamp = _AUTH_CACHE[token]
            if now - timestamp < _AUTH_CACHE_TTL:
                g.user_id = user_id
                return f(*args, **kwargs)

        # 2. Cache miss -> Use Supabase Auth API to verify JWT
        if AudiobookStorage.is_configured():
            try:
                client = AudiobookStorage._get_client()
                user_res = client.auth.get_user(token)
                if user_res and user_res.user:
                    g.user_id = user_res.user.id
                    
                    # Store in cache
                    _AUTH_CACHE[token] = (g.user_id, now)
                    
                    # Simplistic cleanup
                    if len(_AUTH_CACHE) > 1000:
                        keys_to_delete = [k for k, v in _AUTH_CACHE.items() if now - v[1] > _AUTH_CACHE_TTL]
                        for k in keys_to_delete:
                            _AUTH_CACHE.pop(k, None)
                            
                    return f(*args, **kwargs)
            except Exception as e:
                import traceback
                error_msg = str(e)
                print(f"Supabase Auth Error: {error_msg}")
                traceback.print_exc()
                return jsonify({"error": f"Supabase auth failed: {error_msg}"}), 401

        print(f"Auth reject: Invalid or missing valid Supabase JWT.")
        return jsonify({"error": "Invalid authentication token."}), 401
    return decorated


# ── Job Processing ─────────────────────────────────────────────
def process_pdf_job(job_id: str, pdf_path: str, original_filename: str, user_id: str = None):
    """Background task: extract text → process → refine → TTS → MP3."""
    import traceback

    print(f"\n{'='*60}")
    print(f"  🚀 JOB START: {job_id}")
    print(f"  📄 File: {original_filename}")
    print(f"{'='*60}")

    try:
        # Phase 1: Extract text (0-15%)
        print(f"  [Phase 1/5] Extracting text...")
        job_store.update(job_id, status="extracting", message="Extrag textul din PDF...")

        def on_extract_progress(current, total, message=""):
            job_store.update(
                job_id,
                progress=int((current / total) * 15),
                message=message or f"Extrag pagina {current} din {total}...",
            )

        def _check_cancelled():
            j = job_store.get(job_id)
            return j and j.get("status") == "cancelled"

        content = PDFExtractor.extract(
            pdf_path, 
            progress_callback=on_extract_progress, 
            check_cancelled=_check_cancelled
        )

        if _check_cancelled():
            print(f"  ❌ Phase 1 cancelled — aborting")
            return
        job_store.update(
            job_id,
            total_pages=content.total_pages,
            metadata=content.metadata,
            ocr_pages=content.ocr_pages_count,
        )
        print(f"  [Phase 1/5] ✅ Done — {content.total_pages} pages, {content.ocr_pages_count} OCR")

        if not content.full_text.strip():
            job_store.update(job_id, status="error", message="PDF-ul nu conține text extractibil (nici prin OCR).")
            print(f"  ❌ No text found — aborting")
            return

        # Phase 2: Clean text & save to file (15-20%)
        print(f"  [Phase 2/5] Processing text...")
        job_store.update(job_id, status="processing", progress=18, message="Procesez și curăț textul...")
        chunks = TextProcessor.process(content.full_text)

        if not chunks:
            job_store.update(job_id, status="error", message="Nu am putut extrage text util din PDF.")
            print(f"  ❌ No chunks produced — aborting")
            return

        # Save extracted text to file for reference
        base_name = os.path.splitext(original_filename)[0]
        text_file_path = os.path.join(OUTPUT_DIR, f"{job_id}_text.txt")
        with open(text_file_path, "w", encoding="utf-8") as f:
            f.write(f"=== Text extras din: {original_filename} ===\n")
            f.write(f"=== Pagini: {content.total_pages}, OCR: {content.ocr_pages_count} ===\n\n")
            for chunk in chunks:
                f.write(chunk.text + "\n\n")
        job_store.update(job_id, text_file=text_file_path)
        print(f"  [Phase 2/5] ✅ Done — {len(chunks)} chunks")

        # Function to easily check cancellation
        def is_cancelled():
            j = job_store.get(job_id)
            return j and j.get("status") == "cancelled"

        # Phase 3: LLM Refinement (20-45%)
        print(f"  [Phase 3/5] AI refinement ({len(chunks)} chunks)...")
        job_store.update(job_id, status="refining", progress=20, message="Rafinare AI — verific fluența textului...")

        def on_refine_progress(current, total, message):
            job_store.update(
                job_id,
                progress=int(20 + (current / total) * 25),
                message=message,
            )

        chunks = TextRefiner.refine_all(chunks, progress_callback=on_refine_progress, check_cancelled=is_cancelled)
        if is_cancelled():
            print(f"  🛑 JOB CANCELLED during refinement: {job_id}")
            return
            
        job_store.update(
            job_id,
            total_chunks=len(chunks),
            estimated_duration=round(TTSEngine.get_estimated_duration(chunks), 1),
        )
        print(f"  [Phase 3/5] ✅ Done — {len(chunks)} chunks refined")

        # Strict mid-processing token/credit evaluation
        current_job = job_store.get(job_id) or {}
        duration_hours = current_job.get("estimated_duration", 0) / 60.0
        
        if user_id and user_id != "legacy" and duration_hours > 0:
            client = AudiobookStorage._get_client()
            if client:
                res = client.table("profiles").select("credits_hours").eq("id", user_id).execute()
                if res.data and len(res.data) > 0:
                    current_credits = float(res.data[0].get("credits_hours", 0))
                    if duration_hours > current_credits:
                        error_msg = f"Insufficient credits. This audiobook requires ~{duration_hours:.2f} hours, but your balance is {current_credits:.2f} hours."
                        print(f"  🛑 {error_msg}")
                        raise Exception(error_msg)

        # Save refined text too
        refined_text_path = os.path.join(OUTPUT_DIR, f"{job_id}_refined.txt")
        with open(refined_text_path, "w", encoding="utf-8") as f:
            f.write(f"=== Text rafinat pentru audiobook: {original_filename} ===\n\n")
            for chunk in chunks:
                f.write(chunk.text + "\n\n")

        # Phase 4: TTS Conversion (45-95%)
        print(f"  [Phase 4/5] TTS conversion ({len(chunks)} chunks)...")
        job_store.update(job_id, status="converting", progress=45)

        output_filename = f"{base_name}_audiobook.mp3"
        output_path = os.path.join(OUTPUT_DIR, f"{job_id}.mp3")

        def on_tts_progress(current, total, message):
            job_store.update(
                job_id,
                progress=int(45 + (current / total) * 50),
                message=message,
                current_chunk=current,
            )

        TTSEngine.convert_to_audiobook(
            chunks,
            output_path,
            progress_callback=on_tts_progress,
            check_cancelled=is_cancelled
        )
        
        if is_cancelled():
            print(f"  🛑 JOB CANCELLED during TTS conversion: {job_id}")
            return
            
        print(f"  [Phase 4/5] ✅ Done — MP3 saved")

        # Phase 5: Upload to Supabase (95-100%)
        print(f"  [Phase 5/5] Cloud upload...")
        job_store.update(job_id, status="uploading_cloud", progress=96, message="Salvez audiobook-ul în cloud...")

        # Read current job state for Supabase upload metadata
        current_job = job_store.get(job_id) or {}

        if AudiobookStorage.is_configured():
            try:
                file_size_bytes = os.path.getsize(output_path)
                size_mb = file_size_bytes / (1024 * 1024)
                print(f"  ☁️ Uploading to Supabase... ({size_mb:.1f} MB)")
                metadata = AudiobookStorage.upload_audiobook_chunked(
                    local_path=output_path,
                    original_name=original_filename,
                    duration_minutes=current_job.get("estimated_duration", 0),
                    total_pages=current_job.get("total_pages", 0),
                    user_id=user_id,
                )
                cloud_url = metadata.get("public_url", "")
                all_public_urls = metadata.get("all_public_urls", [cloud_url] if cloud_url else [])
                job_store.update(
                    job_id,
                    cloud_url=cloud_url,
                    cloud_urls=all_public_urls,
                    audiobook_id=metadata.get("id", ""),
                )
                parts = metadata.get("parts")
                if parts and parts > 1:
                    print(f"  ✅ Supabase upload OK — {parts} părți uploadate")
                else:
                    print(f"  ✅ Supabase upload OK — cloud_url: {cloud_url}")

                # ── CREDIT DEDUCTION (only on full success: generation + upload) ──
                if user_id and user_id != "legacy":
                    duration_hours = current_job.get("estimated_duration", 0) / 60.0
                    if duration_hours > 0:
                        print(f"  💳 Deducting {duration_hours:.4f} hours from user {user_id}")
                        admin = AudiobookStorage._get_admin_client()
                        # Log transaction
                        admin.table("credit_transactions").insert({
                            "user_id": user_id,
                            "type": "usage",
                            "hours": -duration_hours,
                            "description": f"Generated audiobook: {original_filename}"
                        }).execute()
                        print(f"  💳 Transaction logged OK")
                        # Decrement profile balance
                        res = admin.table("profiles").select("credits_hours").eq("id", user_id).execute()
                        print(f"  💳 Profile query returned {len(res.data or [])} rows")
                        if res.data and len(res.data) > 0:
                            current_credits = float(res.data[0].get("credits_hours", 0))
                            new_credits = max(0.0, current_credits - duration_hours)
                            admin.table("profiles").update({"credits_hours": new_credits}).eq("id", user_id).execute()
                            print(f"  💳 Credits updated: {current_credits:.4f}h → {new_credits:.4f}h")
                        else:
                            print(f"  ⚠️ No profile found for user {user_id} — credits NOT deducted")
                    else:
                        print(f"  💳 Skipping deduction: estimated_duration is 0")

            except Exception as e:
                print(f"  ⚠️ Supabase upload/credit failed: {e}")
                traceback.print_exc()
                # No credits deducted on failure — user is not charged
        else:
            print("  ⚠️ Supabase not configured — keeping file local only")

        # Done!
        job_store.update(
            job_id,
            status="completed",
            progress=100,
            message="Audiobook-ul este gata!",
            output_path=output_path,
            output_filename=output_filename,
        )
        print(f"  [Phase 5/5] ✅ JOB COMPLETED: {job_id}")

    except Exception as e:
        # ── FAILSAFE: Guarantee the DB is updated to error status ──
        error_msg = f"Eroare: {str(e)}"
        print(f"\n  💀 JOB CRASHED: {job_id}")
        print(f"  Error: {error_msg}")
        traceback.print_exc()
        try:
            job_store.update(job_id, status="error", message=error_msg)
        except Exception as db_err:
            print(f"  🚨 CRITICAL: Could not update DB with error status: {db_err}")

    finally:
        # Cleanup temp files (PDF, text) to save disk space
        for path in [
            pdf_path,
            os.path.join(OUTPUT_DIR, f"{job_id}_text.txt"),
            os.path.join(OUTPUT_DIR, f"{job_id}_refined.txt"),
        ]:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except Exception:
                pass
        # NOTE: MP3 is kept locally until downloaded, then cleaned up
        #       by the /api/download endpoint
        # Periodically clean up old finished jobs from the database
        try:
            job_store.cleanup_old()
        except Exception:
            pass
        print(f"  🏁 JOB THREAD EXIT: {job_id}\n")


# ── API Routes ─────────────────────────────────────────────────
@app.route("/")
@app.route("/health")
@app.route("/api/health")
def health():
    """Health check endpoint for Render and uptime monitoring."""
    return jsonify({"status": "ok", "service": "PDF to Audiobook API", "auth_ready": bool(ACCESS_CODE)})


@app.route("/api/verify", methods=["POST", "OPTIONS"])
def verify_access_code():
    """Verify the access code — used by frontend login screen."""
    if request.method == "OPTIONS":
        return jsonify({}), 200
        
    data = request.get_json(silent=True) or {}
    code = data.get("code", "")
    if code == ACCESS_CODE:
        return jsonify({"valid": True})
    return jsonify({"valid": False, "error": "Cod de acces invalid."}), 401


@app.route("/api/upload", methods=["POST", "OPTIONS"])
@require_auth
def upload_pdf():
    """Upload a PDF file and start conversion."""
    # Rate limiting
    client_ip = get_client_ip()
    if not check_rate_limit(client_ip):
        remaining = RATE_LIMIT_WINDOW - (time.time() - min(rate_limit_store[client_ip]))
        return jsonify({
            "error": f"Ai depășit limita de {RATE_LIMIT_MAX} conversii pe oră. Încearcă din nou în {int(remaining // 60)} minute."
        }), 429

    if "file" not in request.files:
        return jsonify({"error": "Nu ai trimis niciun fișier."}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Numele fișierului lipsește."}), 400

    if not file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Doar fișiere PDF sunt acceptate."}), 400

    from flask import g
    user_id = getattr(g, "user_id", None)
    if user_id and user_id != "legacy":
        client = AudiobookStorage._get_client()
        if client:
            res = client.table("profiles").select("credits_hours").eq("id", user_id).execute()
            if res.data and len(res.data) > 0:
                credits_hours = float(res.data[0].get("credits_hours", 0))
                if credits_hours <= 0:
                    return jsonify({"error": "Your credit balance is empty. Please add more hours from the Billing page to generate audiobooks."}), 402

    # Save uploaded file
    job_id = str(uuid.uuid4())
    pdf_path = os.path.join(UPLOAD_DIR, f"{job_id}.pdf")
    file.save(pdf_path)

    # Record for rate limiting
    record_request(client_ip)

    # Create job entry (persisted to SQLite)
    job_store.create(job_id, {
        "id": job_id,
        "status": "queued",
        "progress": 0,
        "message": "Aștept procesarea...",
        "original_filename": file.filename,
        "total_pages": 0,
        "total_chunks": 0,
        "current_chunk": 0,
        "estimated_duration": 0,
        "metadata": {},
        "ocr_pages": 0,
        "output_path": None,
        "output_filename": None,
    })

    # Start background processing
    thread = threading.Thread(
        target=process_pdf_job,
        args=(job_id, pdf_path, file.filename, user_id),
        daemon=True
    )
    thread.start()

    return jsonify({"job_id": job_id, "status": "queued"}), 202


@app.route("/api/jobs/<job_id>", methods=["DELETE", "OPTIONS"])
@require_auth
def cancel_job(job_id: str):
    """Cancel a running job and proportionally charge credits."""
    if request.method == "OPTIONS":
        return jsonify({}), 200

    job = job_store.get(job_id)
    if not job:
        return jsonify({"error": "Job-ul nu a fost găsit."}), 404

    if job.get("status") in ["completed", "error", "cancelled"]:
        return jsonify({"status": job.get("status")}), 200

    from flask import g
    user_id = getattr(g, "user_id", None)
    
    if user_id and user_id != "legacy":
        client = AudiobookStorage._get_client()
        if client:
            est_duration = job.get("estimated_duration", 0) / 60.0
            total_chunks = max(1, job.get("total_chunks", 1))
            current_chunk = job.get("current_chunk", 0)
            
            proportional_hours = est_duration * (current_chunk / total_chunks)
            if proportional_hours > 0:
                client.table("credit_transactions").insert({
                    "user_id": user_id,
                    "type": "usage",
                    "hours": -proportional_hours,
                    "description": f"Anulare audiobook: {job.get('original_filename')} ({current_chunk}/{total_chunks} chunk-uri)"
                }).execute()
                
                res = client.table("profiles").select("credits_hours").eq("id", user_id).execute()
                if res.data:
                    current_credits = float(res.data[0].get("credits_hours", 0))
                    new_credits = max(0.0, current_credits - proportional_hours)
                    client.table("profiles").update({"credits_hours": new_credits}).eq("id", user_id).execute()

    job_store.update(job_id, status="cancelled", message="Conversia a fost oprită manual de utilizator.")
    return jsonify({"status": "cancelled", "job_id": job_id})


@app.route("/api/status/<job_id>", methods=["GET", "OPTIONS"])
@require_auth
def get_status(job_id: str):
    """Get the status and progress of a conversion job."""
    job = job_store.get(job_id)
    if not job:
        return jsonify({"error": "Job-ul nu a fost găsit."}), 404

    return jsonify({
        "id": job["id"],
        "status": job["status"],
        "progress": job["progress"],
        "message": job["message"],
        "total_pages": job["total_pages"],
        "total_chunks": job["total_chunks"],
        "current_chunk": job["current_chunk"],
        "estimated_duration": job["estimated_duration"],
        "metadata": job["metadata"],
        "output_filename": job["output_filename"],
        "cloud_url": job.get("cloud_url"),
        "cloud_urls": job.get("cloud_urls", []),
    })


@app.route("/api/audiobooks", methods=["GET", "OPTIONS"])
@require_auth
def list_audiobooks():
    """List all previously generated audiobooks from Supabase and storage usage."""
    if not AudiobookStorage.is_configured():
        return jsonify({"audiobooks": [], "storage": None})  # No storage configured
    try:
        from flask import g
        user_id = getattr(g, "user_id", None)
        audiobooks = AudiobookStorage.list_audiobooks(user_id=user_id)
        storage_usage = AudiobookStorage.get_storage_usage(user_id=user_id)
        
        return jsonify({
            "audiobooks": audiobooks,
            "storage": storage_usage
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/audiobooks/<audiobook_id>", methods=["DELETE", "OPTIONS"])
@require_auth
def delete_audiobook(audiobook_id: str):
    """Delete an audiobook from Supabase."""
    if not AudiobookStorage.is_configured():
        return jsonify({"error": "Storage not configured"}), 500
    try:
        from flask import g
        user_id = getattr(g, "user_id", None)
        success = AudiobookStorage.delete_audiobook(audiobook_id, user_id=user_id)
        if success:
            return jsonify({"deleted": True})
        return jsonify({"error": "Audiobook-ul nu a fost găsit."}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/download/<job_id>", methods=["GET", "OPTIONS"])
@require_auth
def download_file(job_id: str):
    """Download the generated audiobook MP3."""
    job = job_store.get(job_id)
    if not job:
        return jsonify({"error": "Job-ul nu a fost găsit."}), 404

    if job["status"] != "completed":
        return jsonify({"error": "Conversia nu este finalizată încă."}), 400

    # Prefer local file (complete audiobook) over cloud (may be chunked)
    if job.get("output_path") and os.path.exists(job["output_path"]):
        local_path = job["output_path"]

        # Schedule safe delayed cleanup (60s after download starts)
        def delayed_cleanup():
            import time as _time
            _time.sleep(60)
            try:
                if os.path.exists(local_path):
                    os.remove(local_path)
                    print(f"  🗑️ Local MP3 șters după download: {local_path}")
            except Exception:
                pass

        cleanup_thread = threading.Thread(target=delayed_cleanup, daemon=True)
        cleanup_thread.start()

        return send_file(
            local_path,
            as_attachment=True,
            download_name=job.get("output_filename", "audiobook.mp3"),
            mimetype="audio/mpeg"
        )

    # Fallback: redirect to cloud URL if local file was already cleaned up
    cloud_url = job.get("cloud_url")
    if cloud_url:
        return redirect(cloud_url)

    return jsonify({"error": "Fișierul audio nu a fost găsit."}), 404


# ── Main ───────────────────────────────────────────────────────
@app.route("/", methods=["GET"])
@app.route("/health", methods=["GET"])
def health_check():
    """Simple health check endpoint for Render routing."""
    return jsonify({"status": "ok", "service": "PDF to Audiobook API"}), 200


if __name__ == "__main__":
    print("🎧 PDF to Audiobook API - Starting...")
    print(f"📡 Server: http://localhost:5000")
    print(f"📚 Upload endpoint: POST /api/upload")
    print(f"🔍 OCR disponibil: {PDFExtractor.is_ocr_available()}")
    print(f"🔒 Cod de acces configurat: {'Da' if ACCESS_CODE else 'Nu'}")
    print(f"⏱️ Rate limit: {RATE_LIMIT_MAX} conversii/oră")
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False)
