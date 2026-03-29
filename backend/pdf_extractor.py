"""
PDF Text Extractor Module
Extracts text from PDF files using PyMuPDF (fitz).
Falls back to OpenAI Vision (GPT-4o) for scanned PDFs / pages with images.
"""

import fitz  # PyMuPDF
import os
import io
import base64
import concurrent.futures
from dataclasses import dataclass, field
from typing import List, Optional, Callable
from openai import OpenAI
from openai_limiter import with_rate_limit, CancelledError


# Minimum characters threshold: if a page has fewer than this many chars,
# we consider it a scanned/image page and try OCR via OpenAI Vision.
MIN_TEXT_CHARS = 30

# DPI for rendering PDF pages to images for Vision API
RENDER_DPI = 200


VISION_OCR_PROMPT = """Extrage TOT textul din această imagine de document, exact cum apare.

Reguli:
- Păstrează ordinea originală a textului (de sus în jos, de la stânga la dreapta)
- Păstrează structura paragrafelor
- Păstrează diacriticele românești corect: ă, â, î, ș, ț
- NU adăuga explicații, comentarii sau formatare markdown
- NU descrie imaginea — doar extrage textul
- Dacă sunt tabele, extrage datele rând cu rând
- Dacă sunt titluri sau subtitluri, păstrează-le pe linii separate
- Returnează DOAR textul extras, nimic altceva"""


@dataclass
class PageContent:
    """Represents extracted content from a single PDF page."""
    page_number: int
    text: str
    is_ocr: bool = False
    char_count: int = 0

    def __post_init__(self):
        self.char_count = len(self.text)


@dataclass
class PDFContent:
    """Represents the full extracted content from a PDF."""
    filename: str
    total_pages: int
    pages: List[PageContent] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    ocr_pages_count: int = 0

    @property
    def full_text(self) -> str:
        return "\n\n".join(page.text for page in self.pages if page.text.strip())

    @property
    def total_chars(self) -> int:
        return sum(page.char_count for page in self.pages)


class PDFExtractor:
    """Extracts text from PDF files, with OpenAI Vision OCR fallback."""

    _client = None

    @classmethod
    def _get_client(cls) -> OpenAI:
        """Get or create OpenAI client."""
        if cls._client is None:
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise ValueError("OPENAI_API_KEY nu este setat.")
            cls._client = OpenAI(api_key=api_key)
        return cls._client

    @classmethod
    def _ocr_image_base64_with_vision(cls, img_b64: str, check_cancelled=None) -> str:
        """
        Perform OCR on a base64 encoded PNG image using OpenAI Vision (GPT-4o).

        Args:
            img_b64: Base64 encoded PNG image string
            check_cancelled: Optional callable that returns True if job was cancelled

        Returns:
            Extracted text from the image
        """
        try:
            return cls._call_vision_api(img_b64, check_cancelled=check_cancelled)
        except CancelledError:
            print(f"  🛑 Vision OCR cancelled.")
            return ""
        except Exception as e:
            print(f"  OpenAI Vision OCR eroare: {e}")
            return ""

    @classmethod
    @with_rate_limit
    def _call_vision_api(cls, img_b64: str) -> str:
        """Rate-limited Vision API call."""
        client = cls._get_client()
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": VISION_OCR_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{img_b64}",
                                "detail": "high"
                            }
                        }
                    ]
                }
            ],
            max_tokens=4096,
            temperature=0.1,
        )
        return response.choices[0].message.content.strip()

    @classmethod
    def extract(
        cls,
        pdf_path: str,
        progress_callback: Optional[Callable[[int, int, str], None]] = None,
        force_ocr: bool = False,
        max_pages: Optional[int] = None,
        check_cancelled: Optional[Callable[[], bool]] = None,
    ) -> PDFContent:
        """
        Extract text from a PDF file.
        Automatically uses OpenAI Vision for pages with little or no extractable text.

        Args:
            pdf_path: Path to the PDF file
            progress_callback: Optional callback(current_page, total_pages, message)
            force_ocr: If True, always use Vision OCR regardless of text content
            max_pages: If set, only extract the first N pages (for testing)

        Returns:
            PDFContent with extracted text
        """
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"Fișierul nu a fost găsit: {pdf_path}")

        try:
            doc = fitz.open(pdf_path)
        except Exception as e:
            raise ValueError(f"Nu am putut deschide fișierul PDF: {e}")

        total_doc_pages = len(doc)
        pages_to_process = min(total_doc_pages, max_pages) if max_pages else total_doc_pages

        content = PDFContent(
            filename=pdf_path,
            total_pages=pages_to_process,
            metadata={
                "title": doc.metadata.get("title", ""),
                "author": doc.metadata.get("author", ""),
                "subject": doc.metadata.get("subject", ""),
            }
        )

        pages_data = []

        # Phase 1: Sequential extraction and PNG rendering
        for page_num in range(pages_to_process):
            if check_cancelled and check_cancelled():
                doc.close()
                return content # Empty content; app.py will abort anyway

            page = doc[page_num]

            if progress_callback:
                progress_callback(
                    page_num + 1,
                    pages_to_process,
                    f"Analizez și extrag secțiunile - Pagina {page_num + 1}/{pages_to_process}..."
                )

            # Try normal text extraction
            text = ""
            if not force_ocr:
                text = page.get_text("text").strip()

            # If text is too short, mark for OpenAI Vision OCR and render to base64
            if len(text) < MIN_TEXT_CHARS:
                mat = fitz.Matrix(RENDER_DPI / 72, RENDER_DPI / 72)
                pix = page.get_pixmap(matrix=mat, alpha=False)
                img_bytes = pix.tobytes("png")
                img_b64 = base64.b64encode(img_bytes).decode("utf-8")
                
                pages_data.append({
                    "page_num": page_num + 1,
                    "text": text,
                    "needs_ocr": True,
                    "img_b64": img_b64,
                    "is_ocr": False
                })
            else:
                pages_data.append({
                    "page_num": page_num + 1,
                    "text": text,
                    "needs_ocr": False,
                    "img_b64": None,
                    "is_ocr": False
                })

        doc.close()

        # Phase 2: Parallel Vision OCR processing
        ocr_tasks = [p for p in pages_data if p["needs_ocr"]]
        ocr_count = len(ocr_tasks)

        if ocr_count > 0:
            completed_ocr = 0

            def process_ocr(page_data):
                if check_cancelled and check_cancelled():
                    return page_data["page_num"], ""
                ocr_text = cls._ocr_image_base64_with_vision(
                    page_data["img_b64"], check_cancelled=check_cancelled
                )
                return page_data["page_num"], ocr_text

            # Execute concurrent requests with strict worker limit for Free Tier
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                future_to_page = {executor.submit(process_ocr, p): p for p in ocr_tasks}
                
                for future in concurrent.futures.as_completed(future_to_page):
                    p_num, ocr_text = future.result()
                    
                    # Update the corresponding page data
                    for p in pages_data:
                        if p["page_num"] == p_num:
                            if len(ocr_text) > len(p["text"]):
                                p["text"] = ocr_text
                                p["is_ocr"] = True
                            # Free base64 string immediately to save RAM
                            if "img_b64" in p:
                                del p["img_b64"]
                            break

                    if check_cancelled and check_cancelled():
                        # Let remaining futures exhaust without making API calls
                        pass

                    completed_ocr += 1
                    if progress_callback:
                        progress_callback(
                            completed_ocr,
                            ocr_count,
                            f"Vision OCR (GPT-4o) în paralel - Pagina {completed_ocr} din {ocr_count}..."
                        )

        # Re-assemble final PDFContent
        for p in pages_data:
            content.pages.append(PageContent(
                page_number=p["page_num"],
                text=p["text"],
                is_ocr=p["is_ocr"]
            ))

        content.ocr_pages_count = sum(1 for p in pages_data if p["is_ocr"])
        return content

    @staticmethod
    def is_ocr_available() -> bool:
        """Check if OCR via OpenAI Vision is available."""
        return bool(os.getenv("OPENAI_API_KEY"))


if __name__ == "__main__":
    import sys
    from dotenv import load_dotenv
    load_dotenv()

    print(f"OCR (OpenAI Vision) disponibil: {PDFExtractor.is_ocr_available()}")

    if len(sys.argv) < 2:
        print("\nUtilizare: python pdf_extractor.py <fisier.pdf>")
        sys.exit(1)

    def on_progress(current, total, message):
        print(f"  {message}")

    result = PDFExtractor.extract(sys.argv[1], progress_callback=on_progress)
    print(f"\nFișier: {result.filename}")
    print(f"Pagini: {result.total_pages}")
    print(f"Pagini OCR: {result.ocr_pages_count}")
    print(f"Caractere totale: {result.total_chars}")
    print(f"\nPrimele 500 caractere:\n{result.full_text[:500]}")
