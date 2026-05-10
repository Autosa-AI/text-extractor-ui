const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://text-extractor-engine.fly.dev";

export type OcrEngine = "tesseract" | "paddleocr" | "doctr";

export type PageResult = {
  page: number;
  text: string;
  method: "native" | "ocr";
  char_count: number;
};

export type ExtractionResult = {
  filename: string;
  file_type: string;
  total_pages?: number;
  pages?: PageResult[];
  text?: string;
  char_count: number;
  ocr_pages: number;
  method: "native" | "ocr" | "hybrid";
};

export async function extractText(file: File, engine: OcrEngine): Promise<ExtractionResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("engine", engine);

  const res = await fetch(`${BASE_URL}/api/v1/extract/`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Extraction failed");
  }

  return res.json();
}

export function flattenText(result: ExtractionResult): string {
  if (result.text) return result.text;
  if (result.pages) return result.pages.map((p) => p.text).join("\n\n");
  return "";
}
