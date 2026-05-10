"use client";

import Image from "next/image";
import { useState, useRef, useCallback, DragEvent, ChangeEvent } from "react";
import { extractText, flattenText, ExtractionResult, OcrEngine } from "@/lib/api";

type Status = "idle" | "loading" | "done" | "error";

const ACCEPTED = [
  "application/pdf",
  "image/png", "image/jpeg", "image/tiff", "image/bmp", "image/webp", "image/gif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

const EXT_LABEL: Record<string, string> = {
  pdf: "PDF Document", png: "PNG Image", jpg: "JPEG Image", jpeg: "JPEG Image",
  tiff: "TIFF Image", bmp: "BMP Image", webp: "WebP Image", gif: "GIF Image",
  docx: "Word Document", xlsx: "Excel Spreadsheet", pptx: "PowerPoint Presentation",
};

const ENGINE_OPTIONS: { value: OcrEngine; label: string; desc: string; badge: string }[] = [
  { value: "tesseract", label: "Tesseract", desc: "Clean printed docs · Fast · Low memory",            badge: "Default" },
  { value: "paddleocr", label: "PaddleOCR", desc: "Complex layouts · Rotated text · High accuracy",    badge: "Recommended" },
  { value: "doctr",     label: "Doctr",     desc: "Invoices · Forms · Structured reports",             badge: "Document AI" },
];

function fileExt(name: string) { return name.split(".").pop()?.toLowerCase() ?? ""; }
function isImage(type: string) { return type.startsWith("image/"); }
function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

export default function ExtractorApp() {
  const [file, setFile]           = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus]       = useState<Status>("idle");
  const [result, setResult]       = useState<ExtractionResult | null>(null);
  const [text, setText]           = useState("");
  const [error, setError]         = useState("");
  const [copied, setCopied]       = useState(false);
  const [dragging, setDragging]   = useState(false);
  const [engine, setEngine]       = useState<OcrEngine>("tesseract");
  const [engineOpen, setEngineOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setStatus("idle");
    setResult(null);
    setText("");
    setError("");
  }, [previewUrl]);

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const onExtract = async () => {
    if (!file) return;
    setStatus("loading");
    setError("");
    try {
      const res = await extractText(file, engine);
      setResult(res);
      setText(flattenText(res));
      setStatus("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStatus("error");
    }
  };

  const onCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onClear = () => {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setStatus("idle");
    setResult(null);
    setText("");
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const ext  = file ? fileExt(file.name) : "";
  const isImg = file ? isImage(file.type) : false;
  const isPdf = file?.type === "application/pdf";
  const selectedEngine = ENGINE_OPTIONS.find(e => e.value === engine)!;

  return (
    <div style={{ background: "#080808", minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* ── Navbar ── */}
      <header style={{
        borderBottom: "1px solid #161616",
        padding: "0 28px",
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#0c0c0c",
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}>
        {/* Left: Logo + Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Image src="/logo.png" alt="Autosa" width={28} height={28} style={{ objectFit: "contain" }} />
          <div style={{ width: 1, height: 18, background: "#222" }} />
          <div>
            <span style={{ color: "#fff", fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em" }}>
              Text Extractor
            </span>
            <span style={{
              marginLeft: 8,
              fontSize: 10,
              fontWeight: 500,
              color: "#f97316",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              background: "rgba(249,115,22,0.1)",
              border: "1px solid rgba(249,115,22,0.2)",
              borderRadius: 4,
              padding: "1px 6px",
            }}>
              Beta
            </span>
          </div>
        </div>

        {/* Right: Engine dropdown + attribution */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Engine switcher */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setEngineOpen(o => !o)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "#141414",
                border: "1px solid #222",
                borderRadius: 8,
                padding: "6px 12px",
                cursor: "pointer",
                color: "#ccc",
                fontSize: 12,
                fontWeight: 500,
                transition: "border-color 0.15s",
              }}
            >
              {/* OCR icon */}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M7 8h10M7 12h6M7 16h8"/>
              </svg>
              <span style={{ color: "#999", fontSize: 11, marginRight: 2 }}>OCR</span>
              <span style={{ color: "#fff" }}>{selectedEngine.label}</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2.5"
                style={{ transform: engineOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {engineOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setEngineOpen(false)} />
                <div style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  zIndex: 40,
                  background: "#111",
                  border: "1px solid #222",
                  borderRadius: 10,
                  overflow: "hidden",
                  minWidth: 230,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                }}>
                  <div style={{ padding: "6px 10px 4px", borderBottom: "1px solid #1a1a1a" }}>
                    <span style={{ fontSize: 10, color: "#444", letterSpacing: "0.06em", fontWeight: 600 }}>
                      SELECT OCR ENGINE
                    </span>
                  </div>
                  {ENGINE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setEngine(opt.value); setEngineOpen(false); }}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        width: "100%",
                        padding: "9px 12px",
                        background: engine === opt.value ? "rgba(255,255,255,0.04)" : "transparent",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                        gap: 8,
                        transition: "background 0.1s",
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <span style={{ color: engine === opt.value ? "#fff" : "#aaa", fontSize: 12, fontWeight: 500 }}>
                            {opt.label}
                          </span>
                          <span style={{
                            fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
                            color: "#555", background: "#1a1a1a",
                            border: "1px solid #252525", borderRadius: 3,
                            padding: "1px 5px",
                          }}>
                            {opt.badge}
                          </span>
                        </div>
                        <div style={{ color: "#3a3a3a", fontSize: 10 }}>{opt.desc}</div>
                      </div>
                      {engine === opt.value && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5" style={{ marginTop: 2, flexShrink: 0 }}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Attribution */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 6,
            border: "1px solid #181818",
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            <span style={{ fontSize: 10, color: "#444" }}>
              Powered by{" "}
              <span style={{ color: "#666" }}>Solvo</span>
              {" · "}
              <span style={{ color: "#555" }}>Autosa AI</span>
            </span>
          </div>
        </div>
      </header>

      {/* ── Main panels ── */}
      <div style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 20,
        padding: "20px 24px 24px",
      }}>

        {/* ── LEFT: Extracted Text ── */}
        <div style={{
          background: "#0c0c0c",
          borderRadius: 12,
          border: "1px solid #181818",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          <div style={{
            padding: "11px 14px",
            borderBottom: "1px solid #161616",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              <span style={{ fontSize: 11, color: "#444", fontWeight: 600, letterSpacing: "0.05em" }}>EXTRACTED TEXT</span>
              {result && (
                <span style={{
                  fontSize: 10, color: "#2a2a2a", background: "#161616",
                  border: "1px solid #1e1e1e", borderRadius: 4, padding: "1px 6px",
                }}>
                  {result.method}
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {result && (
                <span style={{ fontSize: 11, color: "#333", marginRight: 4 }}>
                  {result.char_count.toLocaleString()} chars
                  {result.total_pages ? ` · ${result.total_pages}p` : ""}
                  {result.ocr_pages ? ` · ${result.ocr_pages} OCR` : ""}
                </span>
              )}
              <button onClick={onCopy} disabled={!text} style={{
                background: copied ? "#0f1f0f" : "#111",
                border: `1px solid ${copied ? "#1e3d1e" : "#1e1e1e"}`,
                borderRadius: 6, color: copied ? "#4ade80" : "#555",
                cursor: text ? "pointer" : "not-allowed",
                fontSize: 11, padding: "4px 10px",
                display: "flex", alignItems: "center", gap: 5,
                transition: "all 0.15s",
              }}>
                {copied ? (
                  <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
                ) : (
                  <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</>
                )}
              </button>
              <button onClick={() => setText("")} disabled={!text} style={{
                background: "#111", border: "1px solid #1e1e1e", borderRadius: 6,
                color: text ? "#555" : "#2a2a2a", cursor: text ? "pointer" : "not-allowed",
                fontSize: 11, padding: "4px 10px",
              }}>
                Clear
              </button>
            </div>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              status === "loading" ? "Extracting…"
              : status === "error"  ? error
              : "Extracted text will appear here.\nUpload a file and click Extract."
            }
            style={{
              flex: 1, background: "transparent", border: "none",
              color: status === "error" ? "#f87171" : "#c8c8c8",
              fontSize: 12.5, lineHeight: 1.75, outline: "none",
              padding: "16px", resize: "none", minHeight: 0,
              fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
            }}
          />
        </div>

        {/* ── RIGHT: File Upload + Preview ── */}
        <div style={{
          background: "#0c0c0c",
          borderRadius: 12,
          border: "1px solid #181818",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          <div style={{
            padding: "11px 14px",
            borderBottom: "1px solid #161616",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span style={{ fontSize: 11, color: "#444", fontWeight: 600, letterSpacing: "0.05em" }}>FILE</span>
              {file && (
                <span style={{ fontSize: 10, color: "#333" }}>
                  {EXT_LABEL[ext] ?? ext.toUpperCase()} · {formatBytes(file.size)}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {file && (
                <button onClick={onClear} style={{
                  background: "#111", border: "1px solid #1e1e1e", borderRadius: 6,
                  color: "#555", cursor: "pointer", fontSize: 11, padding: "4px 10px",
                }}>
                  Remove
                </button>
              )}
              <button
                onClick={onExtract}
                disabled={!file || status === "loading"}
                style={{
                  background: file && status !== "loading" ? "#fff" : "#161616",
                  border: "1px solid transparent",
                  borderRadius: 6,
                  color: file && status !== "loading" ? "#000" : "#2a2a2a",
                  cursor: file && status !== "loading" ? "pointer" : "not-allowed",
                  fontSize: 11, fontWeight: 700, padding: "4px 16px",
                  transition: "all 0.15s", letterSpacing: "0.02em",
                }}
              >
                {status === "loading" ? "Extracting…" : "Extract"}
              </button>
            </div>
          </div>

          {/* Preview area */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            {!file ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                style={{
                  height: "100%", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", cursor: "pointer",
                  border: `1.5px dashed ${dragging ? "#333" : "#191919"}`,
                  borderRadius: 10, margin: 12, transition: "all 0.15s", gap: 14,
                  background: dragging ? "rgba(255,255,255,0.01)" : "transparent",
                }}
              >
                <div style={{
                  width: 52, height: 52, borderRadius: 14,
                  background: "#111", border: "1px solid #1e1e1e",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <div style={{ textAlign: "center" }}>
                  <p style={{ color: "#444", fontSize: 13, marginBottom: 5 }}>
                    Drop file here or{" "}
                    <span style={{ color: "#666", textDecoration: "underline", textUnderlineOffset: 3 }}>browse</span>
                  </p>
                  <p style={{ color: "#2a2a2a", fontSize: 11 }}>
                    PDF · PNG · JPG · TIFF · BMP · WEBP · DOCX · XLSX · PPTX
                  </p>
                </div>
                <input ref={inputRef} type="file" accept={ACCEPTED.join(",")} onChange={onInputChange} style={{ display: "none" }} />
              </div>
            ) : isImg ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl!} alt={file.name}
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }} />
              </div>
            ) : isPdf ? (
              <iframe src={`${previewUrl}#toolbar=0&navpanes=0`}
                style={{ width: "100%", height: "100%", border: "none" }} title={file.name} />
            ) : (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
                <div style={{
                  width: 60, height: 60, borderRadius: 14, background: "#111",
                  border: "1px solid #1e1e1e", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <div style={{ textAlign: "center" }}>
                  <p style={{ color: "#bbb", fontSize: 13, fontWeight: 500, marginBottom: 3 }}>{file.name}</p>
                  <p style={{ color: "#333", fontSize: 11 }}>{EXT_LABEL[ext] ?? ext.toUpperCase()} · {formatBytes(file.size)}</p>
                </div>
                <p style={{ color: "#2a2a2a", fontSize: 11 }}>No preview available — click Extract</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Loading bar */}
      {status === "loading" && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 2, background: "#111", zIndex: 50 }}>
          <div style={{ height: "100%", background: "#fff", width: "40%", animation: "slide 1.2s ease-in-out infinite" }} />
          <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}`}</style>
        </div>
      )}
    </div>
  );
}
