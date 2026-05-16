"use client";

import Image from "next/image";
import { useState, useRef, useCallback, DragEvent, ChangeEvent } from "react";
import {
  extractText,
  extractInvoice,
  flattenText,
  ExtractionResult,
  InvoiceExtractionResult,
  InvoiceMethod,
  OcrEngine,
} from "@/lib/api";

type Status     = "idle" | "loading" | "done" | "error";
type Mode       = "invoice" | "text";
type InvoiceView = "fields" | "json";

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
  { value: "tesseract", label: "Tesseract", desc: "Clean printed docs · Fast · Low memory", badge: "Default" },
  { value: "doctr",     label: "Doctr",     desc: "Invoices · Forms · Structured reports",  badge: "Document AI" },
];

const INVOICE_METHOD_OPTIONS: { value: InvoiceMethod; label: string; desc: string; badge: string; badgeColor: string }[] = [
  { value: "vlm",           label: "Vision LLM",     desc: "Best accuracy · Qwen2.5-VL 72B · ~$0.001/invoice", badge: "Recommended", badgeColor: "#f97316" },
  { value: "doctr_llm",     label: "DocTR + LLM",    desc: "Structured OCR first · Best open-source · ~$0.0003", badge: "Balanced",   badgeColor: "#3b82f6" },
  { value: "tesseract_llm", label: "Tesseract + LLM", desc: "Fast OCR first · Clean docs only · Lowest cost",    badge: "Economy",    badgeColor: "#22c55e" },
];

type HeaderField = { key: keyof InvoiceExtractionResult["header"]; label: string };
type HeaderGroup = { section: string; fields: HeaderField[] };

const HEADER_GROUPS: HeaderGroup[] = [
  {
    section: "Document",
    fields: [
      { key: "NumAtCard",       label: "Invoice No." },
      { key: "TaxInvoiceNo",    label: "Tax Invoice No." },
      { key: "TaxInvoiceDate",  label: "Tax Invoice Date" },
      { key: "PurchaseOrderNo", label: "PO Number" },
      { key: "GRNDocNum",       label: "GRN / Delivery Note" },
      { key: "ContractCode",    label: "Contract Ref." },
      { key: "DocType",         label: "Doc Type" },
      { key: "Series",          label: "Series" },
    ],
  },
  {
    section: "Vendor",
    fields: [
      { key: "CardCode",           label: "Vendor Code" },
      { key: "CardName",           label: "Vendor Name" },
      { key: "VendorAddress",      label: "Vendor Address" },
      { key: "VendorPhone",        label: "Phone" },
      { key: "VendorEmail",        label: "Email" },
      { key: "VendorWebsite",      label: "Website" },
      { key: "VendorTaxId",        label: "Tax / VAT Reg. No." },
      { key: "ContactPersonCode",  label: "Contact Person" },
    ],
  },
  {
    section: "Bill To / Ship To",
    fields: [
      { key: "BillToName",    label: "Bill-To Name" },
      { key: "BillToAddress", label: "Bill-To Address" },
      { key: "ShipToName",    label: "Ship-To Name" },
      { key: "ShipToAddress", label: "Ship-To Address" },
    ],
  },
  {
    section: "Dates",
    fields: [
      { key: "DocDate",      label: "Invoice Date" },
      { key: "DocDueDate",   label: "Due Date" },
      { key: "TaxDate",      label: "Tax / VAT Date" },
      { key: "ShipDate",     label: "Ship Date" },
      { key: "RequiredDate", label: "Required Date" },
    ],
  },
  {
    section: "Financial",
    fields: [
      { key: "DocCurrency",        label: "Currency" },
      { key: "DocRate",            label: "Exchange Rate" },
      { key: "DocSubTotal",        label: "Subtotal" },
      { key: "DiscountPercent",    label: "Discount %" },
      { key: "DiscountSum",        label: "Discount Amt." },
      { key: "FreightSum",         label: "Freight" },
      { key: "InsuranceSum",       label: "Insurance" },
      { key: "HandlingFee",        label: "Handling Fee" },
      { key: "VatPercent",         label: "VAT %" },
      { key: "VatSum",             label: "VAT Amount" },
      { key: "WTSum",              label: "Withholding Tax" },
      { key: "RoundingDiffAmount", label: "Rounding Diff." },
      { key: "DocTotal",           label: "Total" },
      { key: "SumApplied",         label: "Amount Applied" },
    ],
  },
  {
    section: "Payment & Banking",
    fields: [
      { key: "PaymentMethod",   label: "Payment Method" },
      { key: "BankName",        label: "Bank Name" },
      { key: "BankAccountName", label: "Account Name" },
      { key: "BankAccountNo",   label: "Account No." },
      { key: "IBAN",            label: "IBAN" },
      { key: "SwiftCode",       label: "SWIFT / BIC" },
    ],
  },
  {
    section: "Organization",
    fields: [
      { key: "BPL_IDAssignedToInvoice", label: "Branch ID" },
      { key: "SalesPersonCode",         label: "Sales Person" },
      { key: "Project",                 label: "Project" },
      { key: "Incoterms",               label: "Incoterms" },
      { key: "TrackingNumber",          label: "Tracking No." },
      { key: "Comments",                label: "Remarks" },
    ],
  },
];

function fileExt(name: string) { return name.split(".").pop()?.toLowerCase() ?? ""; }
function isImage(type: string)  { return type.startsWith("image/"); }
function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
function formatDocType(v: string | null | undefined) {
  if (v === "I") return "Item";
  if (v === "S") return "Service";
  return v;
}
function displayValue(key: string, val: unknown): string {
  if (val === null || val === undefined || val === "") return "—";
  if (key === "DocType") return formatDocType(val as string) ?? "—";
  if (typeof val === "number") return val.toLocaleString();
  return String(val);
}

export default function ExtractorApp() {
  // ── File state ──
  const [file, setFile]             = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging]     = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Mode: invoice | text ──
  const [mode, setMode] = useState<Mode>("invoice");

  // ── Invoice state ──
  const [invoiceStatus, setInvoiceStatus]   = useState<Status>("idle");
  const [invoiceResult, setInvoiceResult]   = useState<InvoiceExtractionResult | null>(null);
  const [invoiceError, setInvoiceError]     = useState("");
  const [invoiceView, setInvoiceView]       = useState<InvoiceView>("fields");
  const [copiedJson, setCopiedJson]         = useState(false);

  // ── Text (OCR) state ──
  const [textStatus, setTextStatus] = useState<Status>("idle");
  const [textResult, setTextResult] = useState<ExtractionResult | null>(null);
  const [text, setText]             = useState("");
  const [textError, setTextError]   = useState("");
  const [copiedText, setCopiedText] = useState(false);

  // ── Header dropdowns ──
  const [engine, setEngine]               = useState<OcrEngine>("tesseract");
  const [engineOpen, setEngineOpen]       = useState(false);
  const [invoiceMethod, setInvoiceMethod]         = useState<InvoiceMethod>("vlm");
  const [invoiceMethodOpen, setInvoiceMethodOpen] = useState(false);

  // ── File handlers ──
  const handleFile = useCallback((f: File) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setInvoiceStatus("idle"); setInvoiceResult(null); setInvoiceError("");
    setTextStatus("idle");   setTextResult(null);    setText(""); setTextError("");
  }, [previewUrl]);

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) handleFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files?.[0]; if (f) handleFile(f);
  };
  const onClear = () => {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setInvoiceStatus("idle"); setInvoiceResult(null); setInvoiceError("");
    setTextStatus("idle");   setTextResult(null);    setText(""); setTextError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  // ── Extract (calls different API per mode) ──
  const onExtract = async () => {
    if (!file) return;
    if (mode === "invoice") {
      setInvoiceStatus("loading"); setInvoiceError(""); setInvoiceResult(null);
      try {
        const res = await extractInvoice(file, invoiceMethod);
        setInvoiceResult(res);
        setInvoiceView("fields");
        setInvoiceStatus("done");
      } catch (e: unknown) {
        setInvoiceError(e instanceof Error ? e.message : "Unknown error");
        setInvoiceStatus("error");
      }
    } else {
      setTextStatus("loading"); setTextError(""); setTextResult(null); setText("");
      try {
        const res = await extractText(file, engine);
        setTextResult(res);
        setText(flattenText(res));
        setTextStatus("done");
      } catch (e: unknown) {
        setTextError(e instanceof Error ? e.message : "Unknown error");
        setTextStatus("error");
      }
    }
  };

  // ── Copy handlers ──
  const onCopyJson = async () => {
    if (!invoiceResult) return;
    await navigator.clipboard.writeText(JSON.stringify(invoiceResult, null, 2));
    setCopiedJson(true); setTimeout(() => setCopiedJson(false), 2000);
  };
  const onCopyText = async () => {
    await navigator.clipboard.writeText(text);
    setCopiedText(true); setTimeout(() => setCopiedText(false), 2000);
  };

  // ── Derived ──
  const ext    = file ? fileExt(file.name) : "";
  const isImg  = file ? isImage(file.type) : false;
  const isPdf  = file?.type === "application/pdf";
  const selectedEngine        = ENGINE_OPTIONS.find(e => e.value === engine)!;
  const selectedInvoiceMethod = INVOICE_METHOD_OPTIONS.find(m => m.value === invoiceMethod)!;
  const activeStatus = mode === "invoice" ? invoiceStatus : textStatus;
  const jsonString   = invoiceResult ? JSON.stringify(invoiceResult, null, 2) : "";

  // ── Shared button style helpers ──
  const tabBtn = (active: boolean) => ({
    padding: "5px 12px", fontSize: 11, fontWeight: 600 as const,
    border: "none", cursor: "pointer" as const, transition: "all 0.12s",
    borderRadius: 6,
    background: active ? "#1a1a1a" : "transparent",
    color: active ? "#ddd" : "#3a3a3a",
  });

  const iconBtn = (enabled: boolean, green?: boolean) => ({
    background: green ? "#0f1f0f" : "#111",
    border: `1px solid ${green ? "#1e3d1e" : "#1e1e1e"}`,
    borderRadius: 6,
    color: green ? "#4ade80" : enabled ? "#555" : "#2a2a2a",
    cursor: enabled ? "pointer" as const : "not-allowed" as const,
    fontSize: 11, padding: "4px 10px",
    display: "flex", alignItems: "center" as const, gap: 5, transition: "all 0.15s",
  });

  return (
    <div style={{ background: "#080808", minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* ── Navbar ── */}
      <header style={{
        borderBottom: "1px solid #161616", padding: "0 28px", height: 56,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#0c0c0c", position: "sticky", top: 0, zIndex: 40,
      }}>
        {/* Left */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Image src="/logo.png" alt="Autosa" width={28} height={28} style={{ objectFit: "contain" }} />
          <div style={{ width: 1, height: 18, background: "#222" }} />
          <span style={{ color: "#fff", fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em" }}>Text Extractor</span>
          <span style={{
            fontSize: 10, fontWeight: 500, color: "#f97316", letterSpacing: "0.06em",
            textTransform: "uppercase", background: "rgba(249,115,22,0.1)",
            border: "1px solid rgba(249,115,22,0.2)", borderRadius: 4, padding: "1px 6px",
          }}>Beta</span>
        </div>

        {/* Right */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>

          {/* OCR Engine — dimmed when invoice tab active */}
          <div style={{ position: "relative", opacity: mode === "text" ? 1 : 0.35, transition: "opacity 0.2s" }}>
            <button onClick={() => mode === "text" && setEngineOpen(o => !o)} style={{
              display: "flex", alignItems: "center", gap: 8, background: "#141414",
              border: "1px solid #222", borderRadius: 8, padding: "6px 12px",
              cursor: mode === "text" ? "pointer" : "default",
              color: "#ccc", fontSize: 12, fontWeight: 500,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h6M7 16h8"/>
              </svg>
              <span style={{ color: "#999", fontSize: 11, marginRight: 2 }}>OCR</span>
              <span style={{ color: "#fff" }}>{selectedEngine.label}</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2.5"
                style={{ transform: engineOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {engineOpen && mode === "text" && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setEngineOpen(false)} />
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 40,
                  background: "#111", border: "1px solid #222", borderRadius: 10,
                  overflow: "hidden", minWidth: 230, boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                }}>
                  <div style={{ padding: "6px 10px 4px", borderBottom: "1px solid #1a1a1a" }}>
                    <span style={{ fontSize: 10, color: "#444", letterSpacing: "0.06em", fontWeight: 600 }}>SELECT OCR ENGINE</span>
                  </div>
                  {ENGINE_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => { setEngine(opt.value); setEngineOpen(false); }} style={{
                      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                      width: "100%", padding: "9px 12px",
                      background: engine === opt.value ? "rgba(255,255,255,0.04)" : "transparent",
                      border: "none", cursor: "pointer", textAlign: "left", gap: 8,
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <span style={{ color: engine === opt.value ? "#fff" : "#aaa", fontSize: 12, fontWeight: 500 }}>{opt.label}</span>
                          <span style={{ fontSize: 9, fontWeight: 600, color: "#555", background: "#1a1a1a", border: "1px solid #252525", borderRadius: 3, padding: "1px 5px" }}>{opt.badge}</span>
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

          <div style={{ width: 1, height: 16, background: "#1e1e1e" }} />

          {/* Invoice Method — dimmed when text tab active */}
          <div style={{ position: "relative", opacity: mode === "invoice" ? 1 : 0.35, transition: "opacity 0.2s" }}>
            <button onClick={() => mode === "invoice" && setInvoiceMethodOpen(o => !o)} style={{
              display: "flex", alignItems: "center", gap: 8, background: "#141414",
              border: "1px solid #222", borderRadius: 8, padding: "6px 12px",
              cursor: mode === "invoice" ? "pointer" : "default",
              color: "#ccc", fontSize: 12, fontWeight: 500,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              <span style={{ color: "#999", fontSize: 11, marginRight: 2 }}>Invoice</span>
              <span style={{ color: "#fff" }}>{selectedInvoiceMethod.label}</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2.5"
                style={{ transform: invoiceMethodOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {invoiceMethodOpen && mode === "invoice" && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setInvoiceMethodOpen(false)} />
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 40,
                  background: "#111", border: "1px solid #222", borderRadius: 10,
                  overflow: "hidden", minWidth: 260, boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                }}>
                  <div style={{ padding: "6px 10px 4px", borderBottom: "1px solid #1a1a1a" }}>
                    <span style={{ fontSize: 10, color: "#444", letterSpacing: "0.06em", fontWeight: 600 }}>INVOICE EXTRACTION METHOD</span>
                  </div>
                  {INVOICE_METHOD_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => { setInvoiceMethod(opt.value); setInvoiceMethodOpen(false); }} style={{
                      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                      width: "100%", padding: "9px 12px",
                      background: invoiceMethod === opt.value ? "rgba(255,255,255,0.04)" : "transparent",
                      border: "none", cursor: "pointer", textAlign: "left", gap: 8,
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <span style={{ color: invoiceMethod === opt.value ? "#fff" : "#aaa", fontSize: 12, fontWeight: 500 }}>{opt.label}</span>
                          <span style={{
                            fontSize: 9, fontWeight: 600, color: opt.badgeColor,
                            background: `${opt.badgeColor}15`, border: `1px solid ${opt.badgeColor}30`,
                            borderRadius: 3, padding: "1px 5px",
                          }}>{opt.badge}</span>
                        </div>
                        <div style={{ color: "#3a3a3a", fontSize: 10 }}>{opt.desc}</div>
                      </div>
                      {invoiceMethod === opt.value && (
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

          <div style={{ width: 1, height: 16, background: "#1e1e1e" }} />

          {/* Attribution */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 6, border: "1px solid #181818" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            <span style={{ fontSize: 10, color: "#444" }}>
              Powered by <span style={{ color: "#666" }}>Solvo</span>{" · "}<span style={{ color: "#555" }}>Autosa AI</span>
            </span>
          </div>
        </div>
      </header>

      {/* ── Main panels ── */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, padding: "20px 24px 24px" }}>

        {/* ── LEFT panel ── */}
        <div style={{
          background: "#0c0c0c", borderRadius: 12, border: "1px solid #181818",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          {/* ── Tab bar ── */}
          <div style={{
            padding: "0 14px", borderBottom: "1px solid #161616",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexShrink: 0, height: 42,
          }}>
            {/* Tabs */}
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <button onClick={() => setMode("invoice")} style={tabBtn(mode === "invoice")}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                    stroke={mode === "invoice" ? "#888" : "#2a2a2a"} strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                  Invoice Fields
                </span>
              </button>
              <button onClick={() => setMode("text")} style={tabBtn(mode === "text")}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                    stroke={mode === "text" ? "#888" : "#2a2a2a"} strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M7 8h10M7 12h6M7 16h8"/>
                  </svg>
                  Raw Text
                </span>
              </button>
            </div>

            {/* Right-side controls — change per tab */}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              {mode === "invoice" ? (
                <>
                  {/* Fields / JSON toggle */}
                  <div style={{ display: "flex", background: "#111", border: "1px solid #1e1e1e", borderRadius: 6, overflow: "hidden" }}>
                    {(["fields", "json"] as InvoiceView[]).map(v => (
                      <button key={v} onClick={() => setInvoiceView(v)} style={{
                        padding: "4px 10px", fontSize: 11, fontWeight: 500, border: "none",
                        cursor: "pointer", transition: "all 0.1s",
                        background: invoiceView === v ? "#1e1e1e" : "transparent",
                        color: invoiceView === v ? "#ccc" : "#444",
                        textTransform: "capitalize",
                      }}>
                        {v === "fields" ? "Fields" : "JSON"}
                      </button>
                    ))}
                  </div>
                  <button onClick={onCopyJson} disabled={!invoiceResult} style={iconBtn(!!invoiceResult, copiedJson)}>
                    {copiedJson
                      ? <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
                      : <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy JSON</>
                    }
                  </button>
                </>
              ) : (
                <>
                  {textResult && (
                    <span style={{ fontSize: 11, color: "#333", marginRight: 2 }}>
                      {textResult.char_count.toLocaleString()} chars
                      {textResult.total_pages ? ` · ${textResult.total_pages}p` : ""}
                      {textResult.ocr_pages ? ` · ${textResult.ocr_pages} OCR` : ""}
                    </span>
                  )}
                  <button onClick={onCopyText} disabled={!text} style={iconBtn(!!text, copiedText)}>
                    {copiedText
                      ? <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
                      : <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</>
                    }
                  </button>
                  <button onClick={() => setText("")} disabled={!text} style={iconBtn(!!text)}>Clear</button>
                </>
              )}
            </div>
          </div>

          {/* ── Tab content ── */}
          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>

            {/* ════ INVOICE TAB ════ */}
            {mode === "invoice" && (
              <>
                {/* Empty / error */}
                {!invoiceResult && invoiceStatus !== "loading" && (
                  <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: "#111", border: "1px solid #1e1e1e", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2a2a2a" strokeWidth="1.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                      </svg>
                    </div>
                    <p style={{ color: invoiceStatus === "error" ? "#f87171" : "#2a2a2a", fontSize: 12, textAlign: "center", maxWidth: 220 }}>
                      {invoiceStatus === "error" ? invoiceError : "Invoice fields will appear here.\nUpload a file and click Extract."}
                    </p>
                  </div>
                )}

                {/* Loading skeleton */}
                {invoiceStatus === "loading" && (
                  <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                    {[100, 80, 90, 70, 85, 60, 75, 88].map((w, i) => (
                      <div key={i} style={{
                        height: 10, borderRadius: 4, background: "#141414", width: `${w}%`,
                        animation: "pulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.1}s`,
                      }} />
                    ))}
                    <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:.7}}`}</style>
                  </div>
                )}

                {/* Fields view */}
                {invoiceResult && invoiceView === "fields" && (
                  <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 20 }}>
                    {/* model badge */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 9, color: "#3a3a3a", background: "#141414", border: "1px solid #1e1e1e", borderRadius: 3, padding: "2px 7px", fontFamily: "monospace" }}>
                        {invoiceResult.model_used}
                      </span>
                    </div>

                    {/* Header fields — grouped sections */}
                    {HEADER_GROUPS.map(group => {
                      const filled = group.fields.filter(f => {
                        const v = invoiceResult.header[f.key];
                        return v !== null && v !== undefined && v !== "";
                      });
                      // skip entire section if nothing was extracted
                      if (filled.length === 0) return null;
                      return (
                        <div key={group.section}>
                          <div style={{ fontSize: 10, color: "#333", fontWeight: 600, letterSpacing: "0.07em", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                            {group.section.toUpperCase()}
                            <div style={{ flex: 1, height: 1, background: "#161616" }} />
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 10px" }}>
                            {group.fields.map(({ key, label }) => {
                              const val = invoiceResult.header[key];
                              const empty = val === null || val === undefined || val === "";
                              if (empty) return null;
                              return (
                                <div key={key} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "7px 10px", borderRadius: 6, background: "#0e0e0e", border: "1px solid #161616" }}>
                                  <span style={{ fontSize: 9, color: "#333", fontWeight: 600, letterSpacing: "0.05em" }}>{label.toUpperCase()}</span>
                                  <span style={{ fontSize: 12, color: "#c8c8c8", fontFamily: "'SF Mono','Fira Code',monospace", fontWeight: 500, wordBreak: "break-word" }}>
                                    {displayValue(key, val)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {/* Line items */}
                    <div>
                      <div style={{ fontSize: 10, color: "#333", fontWeight: 600, letterSpacing: "0.07em", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                        LINE ITEMS
                        <span style={{ fontSize: 9, color: "#444", background: "#141414", border: "1px solid #1e1e1e", borderRadius: 3, padding: "1px 5px" }}>
                          {invoiceResult.lines.length}
                        </span>
                        <div style={{ flex: 1, height: 1, background: "#161616" }} />
                      </div>

                      {invoiceResult.lines.length === 0 ? (
                        <p style={{ color: "#252525", fontSize: 11, textAlign: "center", padding: "16px 0" }}>No line items extracted</p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "18px 80px 1fr 44px 44px 52px 60px 52px", gap: "0 8px", padding: "0 10px" }}>
                            {["#", "Code", "Description", "UoM", "Qty", "Price", "Total", "VAT%"].map(h => (
                              <span key={h} style={{ fontSize: 9, color: "#2a2a2a", fontWeight: 600, letterSpacing: "0.05em" }}>{h}</span>
                            ))}
                          </div>
                          {invoiceResult.lines.map((line, i) => {
                            const code = line.ItemCode ?? line.AccountCode;
                            const desc = line.ItemDescription ?? line.FreeText;
                            return (
                              <div key={i} style={{ display: "grid", gridTemplateColumns: "18px 80px 1fr 44px 44px 52px 60px 52px", gap: "0 8px", padding: "8px 10px", borderRadius: 6, background: "#0e0e0e", border: "1px solid #161616", alignItems: "center" }}>
                                <span style={{ fontSize: 10, color: "#333" }}>{i + 1}</span>
                                <span style={{ fontSize: 11, color: code ? "#c8c8c8" : "#252525", fontFamily: "'SF Mono','Fira Code',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{code ?? "—"}</span>
                                <span style={{ fontSize: 11, color: desc ? "#888" : "#252525", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{desc ?? "—"}</span>
                                <span style={{ fontSize: 11, color: line.UoMCode ? "#c8c8c8" : "#252525", fontFamily: "monospace" }}>{line.UoMCode ?? "—"}</span>
                                <span style={{ fontSize: 11, color: line.Quantity != null ? "#c8c8c8" : "#252525", fontFamily: "monospace" }}>{line.Quantity != null ? line.Quantity.toLocaleString() : "—"}</span>
                                <span style={{ fontSize: 11, color: line.Price != null ? "#c8c8c8" : "#252525", fontFamily: "monospace" }}>{line.Price != null ? line.Price.toLocaleString() : "—"}</span>
                                <span style={{ fontSize: 11, color: line.LineTotal != null ? "#f97316" : "#252525", fontFamily: "monospace", fontWeight: 600 }}>{line.LineTotal != null ? line.LineTotal.toLocaleString() : "—"}</span>
                                <span style={{ fontSize: 11, color: line.VatPercent != null ? "#3b82f6" : "#252525", fontFamily: "monospace" }}>{line.VatPercent != null ? `${line.VatPercent}%` : "—"}</span>
                              </div>
                            );
                          })}
                          {invoiceResult.header.DocTotal != null && (
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 6, background: "rgba(249,115,22,0.04)", border: "1px solid rgba(249,115,22,0.1)", marginTop: 2 }}>
                              <span style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>TOTAL</span>
                              <span style={{ fontSize: 13, color: "#f97316", fontFamily: "monospace", fontWeight: 700 }}>
                                {invoiceResult.header.DocCurrency ?? ""} {invoiceResult.header.DocTotal.toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {invoiceResult.notes && (
                      <div style={{ padding: "8px 10px", borderRadius: 6, background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.1)" }}>
                        <span style={{ fontSize: 9, color: "#92400e", fontWeight: 600, letterSpacing: "0.05em", display: "block", marginBottom: 3 }}>NOTES</span>
                        <span style={{ fontSize: 11, color: "#78716c" }}>{invoiceResult.notes}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* JSON view */}
                {invoiceResult && invoiceView === "json" && (
                  <pre style={{ margin: 0, padding: 16, fontSize: 11.5, lineHeight: 1.7, color: "#666", fontFamily: "'SF Mono','Fira Code','Cascadia Code',monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {jsonString}
                  </pre>
                )}
              </>
            )}

            {/* ════ RAW TEXT TAB ════ */}
            {mode === "text" && (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  textStatus === "loading" ? "Extracting…"
                  : textStatus === "error"  ? textError
                  : "Raw OCR text will appear here.\nUpload a file and click Extract."
                }
                style={{
                  width: "100%", height: "100%", background: "transparent", border: "none",
                  color: textStatus === "error" ? "#f87171" : "#c8c8c8",
                  fontSize: 12.5, lineHeight: 1.75, outline: "none",
                  padding: "16px", resize: "none", boxSizing: "border-box",
                  fontFamily: "'SF Mono','Fira Code','Cascadia Code',monospace",
                }}
              />
            )}
          </div>
        </div>

        {/* ── RIGHT: File Upload + Preview ── */}
        <div style={{ background: "#0c0c0c", borderRadius: 12, border: "1px solid #181818", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "11px 14px", borderBottom: "1px solid #161616", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span style={{ fontSize: 11, color: "#444", fontWeight: 600, letterSpacing: "0.05em" }}>FILE</span>
              {file && <span style={{ fontSize: 10, color: "#333" }}>{EXT_LABEL[ext] ?? ext.toUpperCase()} · {formatBytes(file.size)}</span>}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {file && (
                <button onClick={onClear} style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 6, color: "#555", cursor: "pointer", fontSize: 11, padding: "4px 10px" }}>
                  Remove
                </button>
              )}
              <button
                onClick={onExtract}
                disabled={!file || activeStatus === "loading"}
                style={{
                  background: file && activeStatus !== "loading" ? "#fff" : "#161616",
                  border: "1px solid transparent", borderRadius: 6,
                  color: file && activeStatus !== "loading" ? "#000" : "#2a2a2a",
                  cursor: file && activeStatus !== "loading" ? "pointer" : "not-allowed",
                  fontSize: 11, fontWeight: 700, padding: "4px 16px",
                  transition: "all 0.15s", letterSpacing: "0.02em",
                }}
              >
                {activeStatus === "loading" ? "Extracting…" : "Extract"}
              </button>
            </div>
          </div>

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
                <div style={{ width: 52, height: 52, borderRadius: 14, background: "#111", border: "1px solid #1e1e1e", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <div style={{ textAlign: "center" }}>
                  <p style={{ color: "#444", fontSize: 13, marginBottom: 5 }}>
                    Drop file here or <span style={{ color: "#666", textDecoration: "underline", textUnderlineOffset: 3 }}>browse</span>
                  </p>
                  <p style={{ color: "#2a2a2a", fontSize: 11 }}>PDF · PNG · JPG · TIFF · BMP · WEBP · DOCX · XLSX · PPTX</p>
                </div>
                <input ref={inputRef} type="file" accept={ACCEPTED.join(",")} onChange={onInputChange} style={{ display: "none" }} />
              </div>
            ) : isImg ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl!} alt={file.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }} />
              </div>
            ) : isPdf ? (
              <iframe src={`${previewUrl}#toolbar=0&navpanes=0`} style={{ width: "100%", height: "100%", border: "none" }} title={file.name} />
            ) : (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
                <div style={{ width: 60, height: 60, borderRadius: 14, background: "#111", border: "1px solid #1e1e1e", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
      {activeStatus === "loading" && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 2, background: "#111", zIndex: 50 }}>
          <div style={{ height: "100%", background: "#fff", width: "40%", animation: "slide 1.2s ease-in-out infinite" }} />
          <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}`}</style>
        </div>
      )}
    </div>
  );
}
