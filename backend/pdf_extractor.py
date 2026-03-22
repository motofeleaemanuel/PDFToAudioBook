"""
PDF Text Extractor Module
Extracts text from PDF files using PyMuPDF (fitz).
Falls back to OpenAI Vision (GPT-4o) for scanned PDFs / pages with images.
"""

import fitz  # PyMuPDF
import os
import io
import base64
from dataclasses import dataclass, field
from typing import List, Optional, Callable
from openai import OpenAI


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
    def _ocr_page_with_vision(cls, page) -> str:
        """
        Perform OCR on a PDF page using OpenAI Vision (GPT-4o).
        Renders the page to an image, encodes it as base64, and sends to GPT-4o.

        Args:
            page: A PyMuPDF page object

        Returns:
            Extracted text from the image
        """
        try:
            client = cls._get_client()

            # Render page to a PNG image
            mat = fitz.Matrix(RENDER_DPI / 72, RENDER_DPI / 72)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            img_bytes = pix.tobytes("png")

            # Encode to base64
            img_b64 = base64.b64encode(img_bytes).decode("utf-8")

            # Send to GPT-4o Vision
            response = client.chat.completions.create(
                model="gpt-4o",
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

        except Exception as e:
            print(f"  OpenAI Vision OCR eroare: {e}")
            return ""

    @classmethod
    def extract(
        cls,
        pdf_path: str,
        progress_callback: Optional[Callable[[int, int, str], None]] = None,
        force_ocr: bool = False,
        max_pages: Optional[int] = None,
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

        ocr_count = 0

        for page_num in range(pages_to_process):
            page = doc[page_num]
            used_ocr = False

            if progress_callback:
                progress_callback(
                    page_num + 1,
                    pages_to_process,
                    f"Extrag pagina {page_num + 1} din {pages_to_process}..."
                )

            # Step 1: Try normal text extraction
            text = ""
            if not force_ocr:
                text = page.get_text("text").strip()

            # Step 2: If text is too short, use OpenAI Vision OCR
            if len(text) < MIN_TEXT_CHARS:
                if progress_callback:
                    progress_callback(
                        page_num + 1,
                        len(doc),
                        f"Vision OCR pagina {page_num + 1} din {len(doc)}..."
                    )
                ocr_text = cls._ocr_page_with_vision(page)
                if len(ocr_text) > len(text):
                    text = ocr_text
                    used_ocr = True
                    ocr_count += 1

            content.pages.append(PageContent(
                page_number=page_num + 1,
                text=text,
                is_ocr=used_ocr
            ))

        content.ocr_pages_count = ocr_count
        doc.close()
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
