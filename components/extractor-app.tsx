"use client";

import Image from "next/image";
import { useState, useRef, useCallback, DragEvent, ChangeEvent } from "react";
import { extractText, flattenText, ExtractionResult } from "@/lib/api";

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

function fileExt(name: string) { return name.split(".").pop()?.toLowerCase() ?? ""; }
function isImage(type: string) { return type.startsWith("image/"); }
function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

export default function ExtractorApp() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);

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
      const res = await extractText(file);
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

  const ext = file ? fileExt(file.name) : "";
  const isImg = file ? isImage(file.type) : false;
  const isPdf = file?.type === "application/pdf";

  return (
    <div style={{ background: "#0a0a0a", minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <header style={{
        borderBottom: "1px solid #1a1a1a",
        padding: "14px 28px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}>
        <Image src="/logo.png" alt="Autosa" width={32} height={32} style={{ objectFit: "contain" }} />
        <span style={{ color: "#666", fontSize: 13, letterSpacing: "0.05em" }}>TEXT EXTRACTOR</span>
      </header>

      {/* Body */}
      <div style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 1,
        padding: "24px",
        paddingTop: "20px",
        background: "#111",
      }}>

        {/* ── LEFT: Extracted Text ── */}
        <div style={{
          background: "#0a0a0a",
          borderRadius: 10,
          border: "1px solid #1c1c1c",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          marginRight: 8,
        }}>
          {/* Panel header */}
          <div style={{
            padding: "12px 16px",
            borderBottom: "1px solid #1a1a1a",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              <span style={{ fontSize: 12, color: "#555", fontWeight: 500, letterSpacing: "0.04em" }}>EXTRACTED TEXT</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {result && (
                <span style={{ fontSize: 11, color: "#444", alignSelf: "center", marginRight: 4 }}>
                  {result.char_count.toLocaleString()} chars
                  {result.total_pages ? ` · ${result.total_pages}p` : ""}
                  {result.ocr_pages ? ` · ${result.ocr_pages} OCR` : ""}
                </span>
              )}
              <button
                onClick={onCopy}
                disabled={!text}
                style={{
                  background: copied ? "#1a2a1a" : "#161616",
                  border: `1px solid ${copied ? "#2a4a2a" : "#222"}`,
                  borderRadius: 6,
                  color: copied ? "#4ade80" : "#888",
                  cursor: text ? "pointer" : "not-allowed",
                  fontSize: 11,
                  padding: "4px 10px",
                  display: "flex", alignItems: "center", gap: 5,
                  transition: "all 0.15s",
                }}
              >
                {copied ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    Copy
                  </>
                )}
              </button>
              <button
                onClick={() => setText("")}
                disabled={!text}
                style={{
                  background: "#161616",
                  border: "1px solid #222",
                  borderRadius: 6,
                  color: text ? "#888" : "#333",
                  cursor: text ? "pointer" : "not-allowed",
                  fontSize: 11,
                  padding: "4px 10px",
                }}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Text area */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              status === "loading"
                ? "Extracting…"
                : status === "error"
                ? error
                : "Extracted text will appear here.\nUpload a file and click Extract."
            }
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              color: status === "error" ? "#f87171" : "#d4d4d4",
              fontSize: 13,
              lineHeight: 1.7,
              outline: "none",
              padding: "16px",
              resize: "none",
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              minHeight: 0,
            }}
          />
        </div>

        {/* ── RIGHT: File Upload + Preview ── */}
        <div style={{
          background: "#0a0a0a",
          borderRadius: 10,
          border: "1px solid #1c1c1c",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          marginLeft: 8,
        }}>
          {/* Panel header */}
          <div style={{
            padding: "12px 16px",
            borderBottom: "1px solid #1a1a1a",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span style={{ fontSize: 12, color: "#555", fontWeight: 500, letterSpacing: "0.04em" }}>FILE</span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {file && (
                <span style={{ fontSize: 11, color: "#444" }}>
                  {EXT_LABEL[ext] ?? ext.toUpperCase()} · {formatBytes(file.size)}
                </span>
              )}
              {file && (
                <button
                  onClick={onClear}
                  style={{
                    background: "#161616", border: "1px solid #222",
                    borderRadius: 6, color: "#888", cursor: "pointer",
                    fontSize: 11, padding: "4px 10px",
                  }}
                >
                  Remove
                </button>
              )}
              <button
                onClick={onExtract}
                disabled={!file || status === "loading"}
                style={{
                  background: file && status !== "loading" ? "#fff" : "#1a1a1a",
                  border: "1px solid transparent",
                  borderRadius: 6,
                  color: file && status !== "loading" ? "#000" : "#333",
                  cursor: file && status !== "loading" ? "pointer" : "not-allowed",
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "4px 14px",
                  transition: "all 0.15s",
                  letterSpacing: "0.03em",
                }}
              >
                {status === "loading" ? "Extracting…" : "Extract"}
              </button>
            </div>
          </div>

          {/* Drop zone / Preview */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            {!file ? (
              // Drop zone
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                style={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  border: `2px dashed ${dragging ? "#444" : "#1e1e1e"}`,
                  borderRadius: 8,
                  margin: 12,
                  transition: "border-color 0.15s",
                  gap: 12,
                }}
              >
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <div style={{ textAlign: "center" }}>
                  <p style={{ color: "#555", fontSize: 13, marginBottom: 4 }}>
                    Drop file here or <span style={{ color: "#888", textDecoration: "underline" }}>browse</span>
                  </p>
                  <p style={{ color: "#333", fontSize: 11 }}>PDF · PNG · JPG · TIFF · BMP · WEBP · DOCX · XLSX · PPTX</p>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPTED.join(",")}
                  onChange={onInputChange}
                  style={{ display: "none" }}
                />
              </div>
            ) : isImg ? (
              // Image preview
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl!}
                  alt={file.name}
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 6 }}
                />
              </div>
            ) : isPdf ? (
              // PDF preview via browser iframe
              <iframe
                src={`${previewUrl}#toolbar=0&navpanes=0`}
                style={{ width: "100%", height: "100%", border: "none", borderRadius: 0 }}
                title={file.name}
              />
            ) : (
              // Office doc / other — show file card
              <div style={{
                height: "100%", display: "flex", alignItems: "center",
                justifyContent: "center", flexDirection: "column", gap: 14,
              }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 12,
                  background: "#161616", border: "1px solid #222",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <div style={{ textAlign: "center" }}>
                  <p style={{ color: "#ccc", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{file.name}</p>
                  <p style={{ color: "#444", fontSize: 11 }}>{EXT_LABEL[ext] ?? ext.toUpperCase()} · {formatBytes(file.size)}</p>
                </div>
                <p style={{ color: "#333", fontSize: 11 }}>Preview not available — click Extract</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Loading bar */}
      {status === "loading" && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 2, background: "#1a1a1a", zIndex: 50 }}>
          <div style={{
            height: "100%", background: "#fff", width: "40%",
            animation: "slide 1.2s ease-in-out infinite",
          }} />
          <style>{`@keyframes slide { 0%{transform:translateX(-100%)} 100%{transform:translateX(350%)} }`}</style>
        </div>
      )}
    </div>
  );
}
