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

from flask import Flask, request, jsonify, send_file, redirect
from flask_cors import CORS

from pdf_extractor import PDFExtractor
from text_processor import TextProcessor
from text_refiner import TextRefiner
from tts_engine import TTSEngine
from storage import AudiobookStorage

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
CORS(app, origins=ALLOWED_ORIGINS)

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Access code from environment (default for dev)
ACCESS_CODE = os.getenv("ACCESS_CODE", "audiobook2024")

# Rate limiting: max conversions per hour per IP
RATE_LIMIT_MAX = int(os.getenv("RATE_LIMIT_MAX", "20"))
RATE_LIMIT_WINDOW = 3600  # 1 hour in seconds
rate_limit_store = defaultdict(list)  # IP -> [timestamps]

# In-memory job store
jobs = {}


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
def require_access_code(f):
    """Decorator to require access code in Authorization header."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Cod de acces lipsă."}), 401
        token = auth_header.replace("Bearer ", "")
        if token != ACCESS_CODE:
            return jsonify({"error": "Cod de acces invalid."}), 401
        return f(*args, **kwargs)
    return decorated


# ── Job Processing ─────────────────────────────────────────────
def process_pdf_job(job_id: str, pdf_path: str, original_filename: str):
    """Background task: extract text → process → refine → TTS → MP3."""
    job = jobs[job_id]

    try:
        # Phase 1: Extract text (0-15%)
        job["status"] = "extracting"
        job["message"] = "Extrag textul din PDF..."

        def on_extract_progress(current, total, message=""):
            job["progress"] = int((current / total) * 15)
            job["message"] = message or f"Extrag pagina {current} din {total}..."

        content = PDFExtractor.extract(pdf_path, progress_callback=on_extract_progress)
        job["total_pages"] = content.total_pages
        job["metadata"] = content.metadata
        job["ocr_pages"] = content.ocr_pages_count

        if not content.full_text.strip():
            job["status"] = "error"
            job["message"] = "PDF-ul nu conține text extractibil (nici prin OCR)."
            return

        # Phase 2: Clean text & save to file (15-20%)
        job["status"] = "processing"
        job["progress"] = 18
        job["message"] = "Procesez și curăț textul..."
        chunks = TextProcessor.process(content.full_text)

        if not chunks:
            job["status"] = "error"
            job["message"] = "Nu am putut extrage text util din PDF."
            return

        # Save extracted text to file for reference
        base_name = os.path.splitext(original_filename)[0]
        text_file_path = os.path.join(OUTPUT_DIR, f"{job_id}_text.txt")
        with open(text_file_path, "w", encoding="utf-8") as f:
            f.write(f"=== Text extras din: {original_filename} ===\n")
            f.write(f"=== Pagini: {content.total_pages}, OCR: {content.ocr_pages_count} ===\n\n")
            for chunk in chunks:
                f.write(chunk.text + "\n\n")
        job["text_file"] = text_file_path
        print(f"  Text salvat: {text_file_path}")

        # Phase 3: LLM Refinement (20-45%)
        job["status"] = "refining"
        job["progress"] = 20
        job["message"] = "Rafinare AI — verific fluența textului..."

        def on_refine_progress(current, total, message):
            refine_progress = int(20 + (current / total) * 25)
            job["progress"] = refine_progress
            job["message"] = message

        chunks = TextRefiner.refine_all(chunks, progress_callback=on_refine_progress)
        job["total_chunks"] = len(chunks)
        job["estimated_duration"] = round(TTSEngine.get_estimated_duration(chunks), 1)

        # Save refined text too
        refined_text_path = os.path.join(OUTPUT_DIR, f"{job_id}_refined.txt")
        with open(refined_text_path, "w", encoding="utf-8") as f:
            f.write(f"=== Text rafinat pentru audiobook: {original_filename} ===\n\n")
            for chunk in chunks:
                f.write(chunk.text + "\n\n")
        print(f"  Text rafinat salvat: {refined_text_path}")

        # Phase 4: TTS Conversion (45-95%)
        job["status"] = "converting"
        job["progress"] = 45

        output_filename = f"{base_name}_audiobook.mp3"
        output_path = os.path.join(OUTPUT_DIR, f"{job_id}.mp3")

        def on_tts_progress(current, total, message):
            tts_progress = int(45 + (current / total) * 50)
            job["progress"] = tts_progress
            job["message"] = message
            job["current_chunk"] = current

        TTSEngine.convert_to_audiobook(
            chunks,
            output_path,
            progress_callback=on_tts_progress
        )

        # Phase 5: Upload to Supabase (95-100%)
        job["status"] = "uploading_cloud"
        job["progress"] = 96
        job["message"] = "Salvez audiobook-ul în cloud..."

        if AudiobookStorage.is_configured():
            try:
                file_size_bytes = os.path.getsize(output_path)
                size_mb = file_size_bytes / (1024 * 1024)
                print(f"  ☁️ Uploading to Supabase... ({size_mb:.1f} MB)")
                metadata = AudiobookStorage.upload_audiobook_chunked(
                    local_path=output_path,
                    original_name=original_filename,
                    duration_minutes=job["estimated_duration"],
                    total_pages=job["total_pages"],
                )
                job["cloud_url"] = metadata.get("public_url", "")
                job["audiobook_id"] = metadata.get("id", "")
                parts = metadata.get("parts")
                if parts and parts > 1:
                    print(f"  ✅ Supabase upload OK — {parts} părți uploadate")
                else:
                    print(f"  ✅ Supabase upload OK — cloud_url: {job['cloud_url']}")
            except Exception as e:
                import traceback
                print(f"  ⚠️ Supabase upload failed: {e}")
                traceback.print_exc()
                # Continue anyway — file is still local
        else:
            print("  ⚠️ Supabase not configured — keeping file local only")

        # Done!
        job["status"] = "completed"
        job["progress"] = 100
        job["message"] = "Audiobook-ul este gata!"
        job["output_path"] = output_path
        job["output_filename"] = output_filename

    except Exception as e:
        job["status"] = "error"
        job["message"] = f"Eroare: {str(e)}"
        print(f"Job {job_id} error: {e}")

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
@require_access_code
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

    # Save uploaded file
    job_id = str(uuid.uuid4())
    pdf_path = os.path.join(UPLOAD_DIR, f"{job_id}.pdf")
    file.save(pdf_path)

    # Record for rate limiting
    record_request(client_ip)

    # Create job entry
    jobs[job_id] = {
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
    }

    # Start background processing
    thread = threading.Thread(
        target=process_pdf_job,
        args=(job_id, pdf_path, file.filename),
        daemon=True
    )
    thread.start()

    return jsonify({"job_id": job_id, "status": "queued"}), 202


@app.route("/api/status/<job_id>", methods=["GET", "OPTIONS"])
@require_access_code
def get_status(job_id: str):
    """Get the status and progress of a conversion job."""
    if job_id not in jobs:
        return jsonify({"error": "Job-ul nu a fost găsit."}), 404

    job = jobs[job_id]
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
    })


@app.route("/api/audiobooks", methods=["GET", "OPTIONS"])
@require_access_code
def list_audiobooks():
    """List all previously generated audiobooks from Supabase and storage usage."""
    if not AudiobookStorage.is_configured():
        return jsonify({"audiobooks": [], "storage": None})  # No storage configured
    try:
        audiobooks = AudiobookStorage.list_audiobooks()
        storage_usage = AudiobookStorage.get_storage_usage()
        
        return jsonify({
            "audiobooks": audiobooks,
            "storage": storage_usage
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/audiobooks/<audiobook_id>", methods=["DELETE", "OPTIONS"])
@require_access_code
def delete_audiobook(audiobook_id: str):
    """Delete an audiobook from Supabase."""
    if not AudiobookStorage.is_configured():
        return jsonify({"error": "Storage not configured"}), 500
    try:
        success = AudiobookStorage.delete_audiobook(audiobook_id)
        if success:
            return jsonify({"deleted": True})
        return jsonify({"error": "Audiobook-ul nu a fost găsit."}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/download/<job_id>", methods=["GET", "OPTIONS"])
@require_access_code
def download_file(job_id: str):
    """Download the generated audiobook MP3."""
    if job_id not in jobs:
        return jsonify({"error": "Job-ul nu a fost găsit."}), 404

    job = jobs[job_id]
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
if __name__ == "__main__":
    print("🎧 PDF to Audiobook API - Starting...")
    print(f"📡 Server: http://localhost:5000")
    print(f"📚 Upload endpoint: POST /api/upload")
    print(f"🔍 OCR disponibil: {PDFExtractor.is_ocr_available()}")
    print(f"🔒 Cod de acces configurat: {'Da' if ACCESS_CODE else 'Nu'}")
    print(f"⏱️ Rate limit: {RATE_LIMIT_MAX} conversii/oră")
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False)
