"use client";

import Image from "next/image";
import { useState, useRef, useCallback, useEffect, DragEvent, ChangeEvent } from "react";
import {
  extractText,
  extractInvoice,
  flattenText,
  pushToSap,
  ExtractionResult,
  InvoiceExtractionResult,
  InvoiceMethod,
  OcrEngine,
  SapCredentials,
  SapPushResult,
} from "@/lib/api";

type Status     = "idle" | "loading" | "done" | "error";
type Mode       = "invoice" | "text" | "batch" | "history";
type InvoiceView = "fields" | "json";
type BatchFile  = {
  id: string;
  file: File;
  status: "pending" | "processing" | "done" | "error";
  result?: InvoiceExtractionResult;
  error?: string;
  duplicate?: HistoryRecord | null;
};
type VendorRecord = { CardCode: string; CardName: string };
type PoRecord     = { PONumber: string; Vendor?: string; Amount?: number; Date?: string };
type HistoryRecord = {
  key: string;
  filename: string;
  processedAt: string;
  vendor: string;
  invoiceNo: string;
  total: number | null;
  currency: string;
  result?: InvoiceExtractionResult;
};
type ValidationError = { level: "error" | "warn"; message: string };
type Confidence = "high" | "medium" | "low";

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

const NUMERIC_HEADER_KEYS = new Set([
  "Series", "DocRate", "DocSubTotal", "DiscountPercent", "DiscountSum",
  "FreightSum", "InsuranceSum", "HandlingFee", "VatPercent", "VatSum",
  "WTSum", "RoundingDiffAmount", "DocTotal", "SumApplied", "PriceListNum",
  "PaymentGroupCode", "SalesPersonCode", "BPL_IDAssignedToInvoice", "TransportationCode",
]);

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

function makeInvoiceKey(h: InvoiceExtractionResult["header"]): string {
  const vendor  = (h.CardName ?? "").toLowerCase().trim();
  const invNo   = (h.NumAtCard ?? h.TaxInvoiceNo ?? "").toLowerCase().trim();
  const date    = h.DocDate ?? "";
  const total   = String(h.DocTotal ?? "");
  return `${vendor}|${invNo}|${date}|${total}`;
}

function matchVendor(
  cardName: string | null | undefined,
  vendors: VendorRecord[],
): { vendor: VendorRecord; score: number } | null {
  if (!cardName || !vendors.length) return null;
  const name = cardName.toLowerCase().trim();
  let best: { vendor: VendorRecord; score: number } | null = null;
  for (const v of vendors) {
    const vn = v.CardName.toLowerCase().trim();
    let score = 0;
    if (vn === name) {
      score = 1;
    } else if (vn.includes(name) || name.includes(vn)) {
      score = 0.85;
    } else {
      const nw = name.split(/\s+/).filter(w => w.length > 2);
      const vw = vn.split(/\s+/).filter(w => w.length > 2);
      const hits = nw.filter(w => vw.some(vv => vv.includes(w) || w.includes(vv)));
      if (nw.length && hits.length) score = hits.length / Math.max(nw.length, vw.length);
    }
    if (score > 0.5 && (!best || score > best.score)) best = { vendor: v, score };
  }
  return best;
}

function parseVendorCsv(text: string): VendorRecord[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, "").toLowerCase());
  const ci = headers.findIndex(h => h.includes("cardcode") || h === "code" || h === "vendor code");
  const ni = headers.findIndex(h => h.includes("cardname") || h === "name" || h === "vendor name");
  if (ci === -1 || ni === -1) return [];
  return lines.slice(1)
    .map(line => {
      const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
      return { CardCode: cols[ci] ?? "", CardName: cols[ni] ?? "" };
    })
    .filter(v => v.CardCode && v.CardName);
}

function parsePoCsv(text: string): PoRecord[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, "").toLowerCase());
  const pi = headers.findIndex(h => h.includes("po") || h.includes("purchase") || h === "number");
  const vi = headers.findIndex(h => h.includes("vendor") || h === "supplier");
  const ai = headers.findIndex(h => h.includes("amount") || h.includes("total"));
  const di = headers.findIndex(h => h.includes("date"));
  if (pi === -1) return [];
  return lines.slice(1)
    .map(line => {
      const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
      return {
        PONumber: cols[pi] ?? "",
        Vendor:   vi !== -1 ? cols[vi] : undefined,
        Amount:   ai !== -1 && cols[ai] ? parseFloat(cols[ai]) : undefined,
        Date:     di !== -1 ? cols[di] : undefined,
      };
    })
    .filter(p => p.PONumber);
}

function matchPo(poNumber: string | null | undefined, pos: PoRecord[]): PoRecord | null {
  if (!poNumber || !pos.length) return null;
  const n = poNumber.toLowerCase().trim();
  return pos.find(p => p.PONumber.toLowerCase().trim() === n) ?? null;
}

function computeValidation(result: InvoiceExtractionResult): ValidationError[] {
  const errs: ValidationError[] = [];
  const h = result.header;

  if (!h.CardName)                          errs.push({ level: "warn",  message: "Missing vendor name" });
  if (!h.NumAtCard && !h.TaxInvoiceNo)      errs.push({ level: "warn",  message: "Missing invoice number" });
  if (h.DocTotal == null)                   errs.push({ level: "warn",  message: "Missing total amount" });
  if (!h.DocDate)                           errs.push({ level: "warn",  message: "Missing invoice date" });

  if (h.DocDate && h.DocDueDate && h.DocDueDate < h.DocDate)
    errs.push({ level: "error", message: "Due date is before invoice date" });

  if (h.DocSubTotal != null && h.VatSum != null && h.DocTotal != null) {
    const freight  = h.FreightSum  ?? 0;
    const discount = h.DiscountSum ?? 0;
    const expected = h.DocSubTotal + h.VatSum + freight - discount;
    if (Math.abs(expected - h.DocTotal) > 1)
      errs.push({ level: "error", message: `Math: Subtotal ${h.DocSubTotal.toLocaleString()} + VAT ${h.VatSum.toLocaleString()} ≠ Total ${h.DocTotal.toLocaleString()}` });
  }

  if (result.lines.length > 0 && h.DocSubTotal != null) {
    const linesSum = result.lines.reduce((s, l) => s + (l.LineTotal ?? 0), 0);
    if (Math.abs(linesSum - h.DocSubTotal) > 1)
      errs.push({ level: "warn", message: `Lines sum ${linesSum.toLocaleString()} ≠ Subtotal ${h.DocSubTotal.toLocaleString()}` });
  }

  return errs;
}

function computeConfidence(result: InvoiceExtractionResult): Confidence {
  const errs  = computeValidation(result);
  const h     = result.header;
  const filled = [h.CardName, h.NumAtCard ?? h.TaxInvoiceNo, h.DocDate, h.DocTotal, h.DocCurrency].filter(Boolean).length;
  const hasErrors = errs.some(e => e.level === "error");
  if (!hasErrors && filled >= 4) return "high";
  if (!hasErrors && filled >= 2) return "medium";
  return "low";
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

  // ── Batch state ──
  const [batchFiles, setBatchFiles] = useState<BatchFile[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const batchInputRef = useRef<HTMLInputElement>(null);

  // ── Vendor matching ──
  const [vendors, setVendors]       = useState<VendorRecord[]>([]);
  const [vendorOpen, setVendorOpen] = useState(false);
  const vendorCsvRef = useRef<HTMLInputElement>(null);

  // ── Invoice history (duplicate detection) ──
  const [invoiceHistory, setInvoiceHistory]     = useState<HistoryRecord[]>([]);
  const [invoiceDuplicate, setInvoiceDuplicate] = useState<HistoryRecord | null>(null);

  // ── PO matching ──
  const [pos, setPos]     = useState<PoRecord[]>([]);
  const [poOpen, setPoOpen] = useState(false);
  const poCsvRef = useRef<HTMLInputElement>(null);

  // ── Webhook ──
  const [webhookUrl, setWebhookUrl]       = useState("");
  const [settingsOpen, setSettingsOpen]   = useState(false);
  const [webhookSent, setWebhookSent]     = useState(false);

  // ── SAP push ──
  const [sapOpen, setSapOpen]             = useState(false);
  const [sapCreds, setSapCreds]           = useState<SapCredentials>({ base_url: "", company_db: "", username: "", password: "" });
  const [sapStatus, setSapStatus]         = useState<"idle"|"loading"|"done"|"error">("idle");
  const [sapResult, setSapResult]         = useState<SapPushResult | null>(null);
  const [sapError, setSapError]           = useState("");

  // ── Dashboard ──
  const [dashOpen, setDashOpen]           = useState(false);

  // ── Edit mode (JSON) ──
  const [editJson, setEditJson]           = useState("");
  const [editMode, setEditMode]           = useState(false);

  // ── Inline field editing ──
  const [editingField, setEditingField]   = useState<string | null>(null);
  const [editingValue, setEditingValue]   = useState("");

  // useEffect(() => {
  //   try {
  //     const v = localStorage.getItem("invoice_vendors");
  //     if (v) setVendors(JSON.parse(v));
  //     const h = localStorage.getItem("invoice_history");
  //     if (h) setInvoiceHistory(JSON.parse(h));
  //   } catch {}
  // }, []);

  // Keyboard shortcut: Cmd/Ctrl + Enter → Extract
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        const status = mode === "invoice" ? invoiceStatus : textStatus;
        if (mode !== "batch" && file && status !== "loading") onExtract();
        if (mode === "batch" && !batchRunning && batchFiles.some(f => f.status === "pending")) onProcessBatch();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, file, invoiceStatus, textStatus, batchRunning, batchFiles]);

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
      setInvoiceStatus("loading"); setInvoiceError(""); setInvoiceResult(null); setInvoiceDuplicate(null);
      try {
        const res = await extractInvoice(file, invoiceMethod);
        setInvoiceDuplicate(findDuplicate(res));
        addToHistory(res);
        setInvoiceResult(res);
        setEditJson(JSON.stringify(res, null, 2));
        setInvoiceView("fields");
        setInvoiceStatus("done");
        fireWebhook(res);
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

  // ── Vendor handlers ──
  const onLoadVendorCsv = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const records = parseVendorCsv(ev.target?.result as string);
      setVendors(records);
      // localStorage.setItem("invoice_vendors", JSON.stringify(records));
    };
    reader.readAsText(f);
    e.target.value = "";
  };
  const onClearVendors = () => {
    setVendors([]);
    // localStorage.removeItem("invoice_vendors");
  };

  // ── History helpers ──
  const addToHistory = (result: InvoiceExtractionResult) => {
    const key = makeInvoiceKey(result.header);
    if (!key.replace(/\|/g, "").trim()) return;
    const record: HistoryRecord = {
      key,
      filename: result.filename,
      processedAt: new Date().toISOString(),
      vendor: result.header.CardName ?? "",
      invoiceNo: result.header.NumAtCard ?? result.header.TaxInvoiceNo ?? "",
      total: result.header.DocTotal ?? null,
      currency: result.header.DocCurrency ?? "",
      result,
    };
    setInvoiceHistory(prev => {
      const next = [record, ...prev.filter(h => h.key !== key)].slice(0, 1000);
      // localStorage.setItem("invoice_history", JSON.stringify(next));
      return next;
    });
  };

  // ── PO handlers ──
  const onLoadPoCsv = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => setPos(parsePoCsv(ev.target?.result as string));
    reader.readAsText(f);
    e.target.value = "";
  };
  const onClearPos = () => setPos([]);

  // ── Webhook handler ──
  const fireWebhook = async (result: InvoiceExtractionResult) => {
    if (!webhookUrl.trim()) return;
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      setWebhookSent(true);
      setTimeout(() => setWebhookSent(false), 3000);
    } catch { /* silent — webhook is best-effort */ }
  };

  // ── SAP push handler ──
  const onPushToSap = async () => {
    if (!invoiceResult) return;
    setSapStatus("loading"); setSapError(""); setSapResult(null);
    try {
      const res = await pushToSap(invoiceResult, sapCreds);
      setSapResult(res); setSapStatus("done");
    } catch (e: unknown) {
      setSapError(e instanceof Error ? e.message : "SAP push failed");
      setSapStatus("error");
    }
  };

  // ── Download JSON ──
  const onDownloadJson = () => {
    if (!invoiceResult) return;
    const blob = new Blob([JSON.stringify(invoiceResult, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${invoiceResult.filename.replace(/\.[^.]+$/, "")}_extracted.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  // ── Download corrected JSON from edit mode ──
  const onDownloadEditedJson = () => {
    const blob = new Blob([editJson], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "invoice_corrected.json";
    a.click(); URL.revokeObjectURL(url);
  };
  // ── Inline header field edit ──
  const applyFieldEdit = (key: string, raw: string) => {
    setEditingField(null);
    if (!invoiceResult) return;
    const val = raw.trim() === ""
      ? null
      : NUMERIC_HEADER_KEYS.has(key) && !isNaN(Number(raw.trim()))
        ? Number(raw.trim())
        : raw.trim();
    const newResult = { ...invoiceResult, header: { ...invoiceResult.header, [key]: val } };
    setInvoiceResult(newResult);
    setEditJson(JSON.stringify(newResult, null, 2));
  };

  // ── Inline line item edit ──
  const applyLineEdit = (lineIdx: number, field: string, raw: string) => {
    setEditingField(null);
    if (!invoiceResult) return;
    const numLineFields = new Set(["Quantity", "Price", "GrossPrice", "DiscountPercent", "LineTotal", "TaxSum", "GrossTotal", "VatPercent"]);
    const val = raw.trim() === ""
      ? null
      : numLineFields.has(field) && !isNaN(Number(raw.trim()))
        ? Number(raw.trim())
        : raw.trim();
    const newLines = invoiceResult.lines.map((l, i) =>
      i === lineIdx ? { ...l, [field]: val } : l
    );
    const newResult = { ...invoiceResult, lines: newLines };
    setInvoiceResult(newResult);
    setEditJson(JSON.stringify(newResult, null, 2));
  };

  const findDuplicate = (result: InvoiceExtractionResult): HistoryRecord | null => {
    const key = makeInvoiceKey(result.header);
    if (!key.replace(/\|/g, "").trim()) return null;
    return invoiceHistory.find(h => h.key === key) ?? null;
  };

  // ── Batch handlers ──
  const onAddBatchFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const next: BatchFile[] = Array.from(files).map(f => ({
      id: `${f.name}-${f.size}-${Math.random()}`,
      file: f,
      status: "pending",
    }));
    setBatchFiles(prev => [...prev, ...next]);
  }, []);

  const onRemoveBatchFile = (id: string) =>
    setBatchFiles(prev => prev.filter(bf => bf.id !== id));

  const onClearBatch = () => { setBatchFiles([]); };

  const onProcessBatch = async () => {
    if (batchRunning) return;
    const pending = batchFiles.filter(bf => bf.status === "pending");
    if (pending.length === 0) return;
    setBatchRunning(true);
    for (const bf of pending) {
      setBatchFiles(prev => prev.map(f => f.id === bf.id ? { ...f, status: "processing" } : f));
      try {
        const result = await extractInvoice(bf.file, invoiceMethod);
        const duplicate = findDuplicate(result);
        addToHistory(result);
        setBatchFiles(prev => prev.map(f => f.id === bf.id ? { ...f, status: "done", result, duplicate } : f));
      } catch (e: unknown) {
        const error = e instanceof Error ? e.message : "Unknown error";
        setBatchFiles(prev => prev.map(f => f.id === bf.id ? { ...f, status: "error", error } : f));
      }
    }
    setBatchRunning(false);
  };

  const onExportExcel = async () => {
    const done = batchFiles.filter(bf => bf.status === "done" && bf.result);
    if (done.length === 0) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();

    const headerRows = done.map(({ result: r }) => ({
      "Filename": r!.filename,
      "Invoice No.": r!.header.NumAtCard ?? "",
      "Tax Invoice No.": r!.header.TaxInvoiceNo ?? "",
      "PO Number": r!.header.PurchaseOrderNo ?? "",
      "Vendor": r!.header.CardName ?? "",
      "Vendor Tax ID": r!.header.VendorTaxId ?? "",
      "Vendor Address": r!.header.VendorAddress ?? "",
      "Bill To": r!.header.BillToName ?? "",
      "Bill To Address": r!.header.BillToAddress ?? "",
      "Invoice Date": r!.header.DocDate ?? "",
      "Due Date": r!.header.DocDueDate ?? "",
      "Currency": r!.header.DocCurrency ?? "",
      "Subtotal": r!.header.DocSubTotal ?? "",
      "Discount Amt": r!.header.DiscountSum ?? "",
      "Freight": r!.header.FreightSum ?? "",
      "VAT %": r!.header.VatPercent ?? "",
      "VAT Amount": r!.header.VatSum ?? "",
      "Total": r!.header.DocTotal ?? "",
      "Payment Method": r!.header.PaymentMethod ?? "",
      "Bank": r!.header.BankName ?? "",
      "Account No.": r!.header.BankAccountNo ?? "",
      "IBAN": r!.header.IBAN ?? "",
      "SWIFT": r!.header.SwiftCode ?? "",
      "Comments": r!.header.Comments ?? "",
      "Vendor Code (Matched)": matchVendor(r!.header.CardName, vendors)?.vendor.CardCode ?? "",
      "Duplicate Warning": batchFiles.find(bf => bf.result === r)?.duplicate ? "DUPLICATE" : "",
      "Model Used": r!.model_used,
    }));
    const ws1 = XLSX.utils.json_to_sheet(headerRows);
    XLSX.utils.book_append_sheet(wb, ws1, "Invoice Headers");

    const lineRows = done.flatMap(({ result: r }) =>
      (r!.lines ?? []).map((line, i) => ({
        "Filename": r!.filename,
        "Invoice No.": r!.header.NumAtCard ?? "",
        "Line #": i + 1,
        "Item Code": line.ItemCode ?? "",
        "Description": line.ItemDescription ?? line.FreeText ?? "",
        "Supplier Cat No.": line.SupplierCatNo ?? "",
        "UoM": line.UoMCode ?? "",
        "Quantity": line.Quantity ?? "",
        "Unit Price": line.Price ?? "",
        "Discount %": line.DiscountPercent ?? "",
        "Line Total": line.LineTotal ?? "",
        "VAT %": line.VatPercent ?? "",
        "Account Code": line.AccountCode ?? "",
      }))
    );
    if (lineRows.length > 0) {
      const ws2 = XLSX.utils.json_to_sheet(lineRows);
      XLSX.utils.book_append_sheet(wb, ws2, "Line Items");
    }

    XLSX.writeFile(wb, `invoices_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
    <div style={{ background: "#080808", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── Navbar ── */}
      <header style={{
        borderBottom: "1px solid #161616", padding: "0 28px", height: 56,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#0c0c0c", flexShrink: 0, zIndex: 40,
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

          {/* Invoice Method — dimmed when raw text tab active */}
          <div style={{ position: "relative", opacity: mode !== "text" ? 1 : 0.35, transition: "opacity 0.2s" }}>
            <button onClick={() => mode !== "text" && setInvoiceMethodOpen(o => !o)} style={{
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
            {invoiceMethodOpen && mode !== "text" && (
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

          {/* Vendors */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setVendorOpen(o => !o)} style={{
              display: "flex", alignItems: "center", gap: 7, background: "#141414",
              border: "1px solid #222", borderRadius: 8, padding: "6px 12px",
              cursor: "pointer", color: "#ccc", fontSize: 12, fontWeight: 500,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={vendors.length ? "#22c55e" : "#888"} strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              <span style={{ color: vendors.length ? "#22c55e" : "#999", fontSize: 11 }}>
                Vendors{vendors.length > 0 ? ` (${vendors.length})` : ""}
              </span>
            </button>
            {vendorOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setVendorOpen(false)} />
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 40,
                  background: "#111", border: "1px solid #222", borderRadius: 10,
                  overflow: "hidden", minWidth: 260, boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                }}>
                  <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid #1a1a1a" }}>
                    <span style={{ fontSize: 10, color: "#444", letterSpacing: "0.06em", fontWeight: 600 }}>VENDOR MASTER LIST</span>
                    {vendors.length > 0 && (
                      <span style={{ float: "right", fontSize: 10, color: "#22c55e" }}>{vendors.length} vendors loaded</span>
                    )}
                  </div>
                  <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <p style={{ fontSize: 11, color: "#444", lineHeight: 1.5 }}>
                      Upload a CSV with <span style={{ color: "#666", fontFamily: "monospace" }}>CardCode</span> and <span style={{ color: "#666", fontFamily: "monospace" }}>CardName</span> columns. Extracted vendor names will be auto-matched.
                    </p>
                    <button
                      onClick={() => vendorCsvRef.current?.click()}
                      style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, color: "#aaa", cursor: "pointer", fontSize: 11, padding: "7px 12px", textAlign: "left" }}
                    >
                      {vendors.length > 0 ? "↑ Replace CSV" : "↑ Upload Vendor CSV"}
                    </button>
                    <input ref={vendorCsvRef} type="file" accept=".csv,.txt" onChange={onLoadVendorCsv} style={{ display: "none" }} />
                    {vendors.length > 0 && (
                      <>
                        <div style={{ maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                          {vendors.slice(0, 50).map(v => (
                            <div key={v.CardCode} style={{ display: "flex", gap: 8, fontSize: 10 }}>
                              <span style={{ color: "#f97316", fontFamily: "monospace", minWidth: 70 }}>{v.CardCode}</span>
                              <span style={{ color: "#555" }}>{v.CardName}</span>
                            </div>
                          ))}
                          {vendors.length > 50 && <span style={{ fontSize: 10, color: "#333" }}>…and {vendors.length - 50} more</span>}
                        </div>
                        <button
                          onClick={() => { onClearVendors(); setVendorOpen(false); }}
                          style={{ background: "transparent", border: "1px solid #2a1515", borderRadius: 6, color: "#7f1d1d", cursor: "pointer", fontSize: 11, padding: "5px 12px" }}
                        >
                          Clear vendor list
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <div style={{ width: 1, height: 16, background: "#1e1e1e" }} />

          {/* PO Matching */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setPoOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 7, background: "#141414", border: "1px solid #222", borderRadius: 8, padding: "6px 12px", cursor: "pointer", color: "#ccc", fontSize: 12, fontWeight: 500 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={pos.length ? "#3b82f6" : "#888"} strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
              </svg>
              <span style={{ color: pos.length ? "#3b82f6" : "#999", fontSize: 11 }}>POs{pos.length > 0 ? ` (${pos.length})` : ""}</span>
            </button>
            {poOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setPoOpen(false)} />
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 40, background: "#111", border: "1px solid #222", borderRadius: 10, overflow: "hidden", minWidth: 240, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
                  <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid #1a1a1a" }}>
                    <span style={{ fontSize: 10, color: "#444", letterSpacing: "0.06em", fontWeight: 600 }}>OPEN PURCHASE ORDERS</span>
                    {pos.length > 0 && <span style={{ float: "right", fontSize: 10, color: "#3b82f6" }}>{pos.length} POs</span>}
                  </div>
                  <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <p style={{ fontSize: 11, color: "#444", lineHeight: 1.5 }}>Upload CSV with <span style={{ color: "#666", fontFamily: "monospace" }}>PONumber</span>, <span style={{ color: "#666", fontFamily: "monospace" }}>Vendor</span>, <span style={{ color: "#666", fontFamily: "monospace" }}>Amount</span> columns.</p>
                    <button onClick={() => poCsvRef.current?.click()} style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, color: "#aaa", cursor: "pointer", fontSize: 11, padding: "7px 12px", textAlign: "left" }}>
                      {pos.length > 0 ? "↑ Replace PO CSV" : "↑ Upload PO CSV"}
                    </button>
                    <input ref={poCsvRef} type="file" accept=".csv,.txt" onChange={onLoadPoCsv} style={{ display: "none" }} />
                    {pos.length > 0 && (
                      <>
                        <div style={{ maxHeight: 100, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                          {pos.slice(0, 30).map(p => (
                            <div key={p.PONumber} style={{ display: "flex", gap: 8, fontSize: 10 }}>
                              <span style={{ color: "#3b82f6", fontFamily: "monospace", minWidth: 80 }}>{p.PONumber}</span>
                              <span style={{ color: "#555" }}>{p.Vendor ?? ""}</span>
                            </div>
                          ))}
                          {pos.length > 30 && <span style={{ fontSize: 10, color: "#333" }}>…and {pos.length - 30} more</span>}
                        </div>
                        <button onClick={() => { onClearPos(); setPoOpen(false); }} style={{ background: "transparent", border: "1px solid #2a1515", borderRadius: 6, color: "#7f1d1d", cursor: "pointer", fontSize: 11, padding: "5px 12px" }}>Clear PO list</button>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Settings (webhook) */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setSettingsOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 5, background: "#141414", border: "1px solid #222", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={webhookUrl ? "#f97316" : "#666"} strokeWidth="2">
                <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
              </svg>
            </button>
            {settingsOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setSettingsOpen(false)} />
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 40, background: "#111", border: "1px solid #222", borderRadius: 10, minWidth: 280, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
                  <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid #1a1a1a" }}>
                    <span style={{ fontSize: 10, color: "#444", letterSpacing: "0.06em", fontWeight: 600 }}>WEBHOOK OUTPUT</span>
                  </div>
                  <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <p style={{ fontSize: 11, color: "#444", lineHeight: 1.5 }}>POST extracted JSON to this URL after every extraction.</p>
                    <input
                      value={webhookUrl}
                      onChange={e => setWebhookUrl(e.target.value)}
                      placeholder="https://your-erp.com/webhook"
                      style={{ background: "#0e0e0e", border: "1px solid #2a2a2a", borderRadius: 6, color: "#aaa", fontSize: 11, padding: "7px 10px", outline: "none", width: "100%", boxSizing: "border-box" }}
                    />
                    {webhookSent && <span style={{ fontSize: 10, color: "#22c55e" }}>✓ Webhook fired successfully</span>}
                    {webhookUrl && <button onClick={() => setWebhookUrl("")} style={{ background: "transparent", border: "1px solid #2a1515", borderRadius: 6, color: "#7f1d1d", cursor: "pointer", fontSize: 11, padding: "5px 12px" }}>Clear webhook URL</button>}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Dashboard */}
          <button onClick={() => setDashOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 5, background: "#141414", border: "1px solid #222", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={invoiceHistory.length ? "#a78bfa" : "#666"} strokeWidth="2">
              <rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>
            </svg>
          </button>

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
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, padding: "20px 24px 24px" }}>

        {/* ── LEFT panel ── */}
        <div style={{
          background: "#0c0c0c", borderRadius: 12, border: "1px solid #181818",
          display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0,
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
              <button onClick={() => setMode("batch")} style={tabBtn(mode === "batch")}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                    stroke={mode === "batch" ? "#888" : "#2a2a2a"} strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                  </svg>
                  Batch
                  {batchFiles.length > 0 && (
                    <span style={{ fontSize: 9, background: "#f97316", color: "#000", borderRadius: 3, padding: "0 4px", fontWeight: 700, lineHeight: "14px" }}>
                      {batchFiles.length}
                    </span>
                  )}
                </span>
              </button>
              <button onClick={() => setMode("history")} style={tabBtn(mode === "history")}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                    stroke={mode === "history" ? "#888" : "#2a2a2a"} strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  History
                  {invoiceHistory.length > 0 && (
                    <span style={{ fontSize: 9, background: "#3b82f6", color: "#000", borderRadius: 3, padding: "0 4px", fontWeight: 700, lineHeight: "14px" }}>
                      {invoiceHistory.length}
                    </span>
                  )}
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
                  {invoiceView === "json" && invoiceResult && (
                    <>
                      <button onClick={() => setEditMode(m => !m)} style={iconBtn(true, editMode)}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        {editMode ? "Editing" : "Edit"}
                      </button>
                      {editMode && (
                        <button onClick={onDownloadEditedJson} style={iconBtn(true)}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          Save
                        </button>
                      )}
                    </>
                  )}
                  <button onClick={onCopyJson} disabled={!invoiceResult} style={iconBtn(!!invoiceResult, copiedJson)}>
                    {copiedJson
                      ? <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
                      : <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy JSON</>
                    }
                  </button>
                </>
              ) : mode === "batch" ? (
                <>
                  {batchFiles.length > 0 && (
                    <span style={{ fontSize: 11, color: "#333", marginRight: 2 }}>
                      {batchFiles.filter(f => f.status === "done").length}/{batchFiles.length} done
                    </span>
                  )}
                  <button
                    onClick={onExportExcel}
                    disabled={!batchFiles.some(f => f.status === "done")}
                    style={iconBtn(batchFiles.some(f => f.status === "done"), batchFiles.some(f => f.status === "done"))}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Export Excel
                  </button>
                  <button onClick={onClearBatch} disabled={batchFiles.length === 0} style={iconBtn(batchFiles.length > 0)}>Clear</button>
                </>
              ) : mode === "text" ? (
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
              ) : (
                <>
                  {invoiceHistory.length > 0 && (
                    <span style={{ fontSize: 11, color: "#333", marginRight: 2 }}>
                      {invoiceHistory.length} invoice{invoiceHistory.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  <button onClick={() => setInvoiceHistory([])} disabled={invoiceHistory.length === 0} style={iconBtn(invoiceHistory.length > 0)}>Clear</button>
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
                    {/* model badge + confidence + vendor match */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 9, color: "#3a3a3a", background: "#141414", border: "1px solid #1e1e1e", borderRadius: 3, padding: "2px 7px", fontFamily: "monospace" }}>
                        {invoiceResult.model_used}
                      </span>
                      {(() => {
                        const conf = computeConfidence(invoiceResult);
                        const confColor   = conf === "high" ? "#22c55e" : conf === "medium" ? "#fbbf24" : "#f87171";
                        const confBg      = conf === "high" ? "rgba(34,197,94,0.08)"  : conf === "medium" ? "rgba(251,191,36,0.08)"  : "rgba(248,113,113,0.08)";
                        const confBorder  = conf === "high" ? "rgba(34,197,94,0.2)"   : conf === "medium" ? "rgba(251,191,36,0.2)"   : "rgba(248,113,113,0.2)";
                        return (
                          <span style={{ fontSize: 9, color: confColor, background: confBg, border: `1px solid ${confBorder}`, borderRadius: 3, padding: "2px 7px", fontWeight: 600 }}>
                            {conf.toUpperCase()} CONFIDENCE
                          </span>
                        );
                      })()}
                      {(() => {
                        const match = matchVendor(invoiceResult.header.CardName, vendors);
                        return match ? (
                          <span style={{ fontSize: 9, color: "#f97316", background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.2)", borderRadius: 3, padding: "2px 7px", fontFamily: "monospace" }}>
                            Vendor: {match.vendor.CardCode} ({Math.round(match.score * 100)}% match)
                          </span>
                        ) : null;
                      })()}
                    </div>

                    {/* Duplicate warning */}
                    {invoiceDuplicate && (
                      <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        <div>
                          <span style={{ fontSize: 11, color: "#fbbf24", fontWeight: 600 }}>Possible duplicate</span>
                          <span style={{ fontSize: 11, color: "#92400e" }}> — previously processed on {new Date(invoiceDuplicate.processedAt).toLocaleDateString()} ({invoiceDuplicate.filename})</span>
                        </div>
                      </div>
                    )}

                    {/* Validation errors */}
                    {(() => {
                      const valErrs = computeValidation(invoiceResult);
                      if (valErrs.length === 0) return null;
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {valErrs.map((err, i) => (
                            <div key={i} style={{
                              padding: "6px 10px", borderRadius: 5, display: "flex", alignItems: "center", gap: 7,
                              background: err.level === "error" ? "rgba(248,113,113,0.05)" : "rgba(251,191,36,0.05)",
                              border: `1px solid ${err.level === "error" ? "rgba(248,113,113,0.2)" : "rgba(251,191,36,0.15)"}`,
                            }}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={err.level === "error" ? "#f87171" : "#fbbf24"} strokeWidth="2" style={{ flexShrink: 0 }}>
                                {err.level === "error"
                                  ? <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>
                                  : <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>
                                }
                              </svg>
                              <span style={{ fontSize: 11, color: err.level === "error" ? "#f87171" : "#fbbf24" }}>{err.message}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    {/* PO match */}
                    {(() => {
                      const poMatch = matchPo(invoiceResult.header.PurchaseOrderNo, pos);
                      if (!poMatch) return null;
                      return (
                        <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)", display: "flex", alignItems: "flex-start", gap: 8 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                          </svg>
                          <div>
                            <span style={{ fontSize: 11, color: "#3b82f6", fontWeight: 600 }}>PO matched: {poMatch.PONumber}</span>
                            {poMatch.Vendor && <span style={{ fontSize: 11, color: "#1e40af" }}> — {poMatch.Vendor}</span>}
                            {poMatch.Amount != null && <span style={{ fontSize: 11, color: "#1e40af" }}> · {poMatch.Amount.toLocaleString()}</span>}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Header fields — grouped sections (click any value to edit) */}
                    {HEADER_GROUPS.map(group => {
                      const anyFilled = group.fields.some(f => {
                        const v = invoiceResult.header[f.key];
                        return v !== null && v !== undefined && v !== "";
                      });
                      // skip entire section if nothing was extracted
                      if (!anyFilled) return null;
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
                              const isEditing = editingField === `h_${key}`;
                              return (
                                <div
                                  key={key}
                                  onClick={() => {
                                    if (!isEditing) {
                                      setEditingField(`h_${key}`);
                                      setEditingValue(val == null ? "" : String(val));
                                    }
                                  }}
                                  style={{
                                    display: "flex", flexDirection: "column", gap: 2,
                                    padding: "7px 10px", borderRadius: 6,
                                    background: isEditing ? "#111" : "#0e0e0e",
                                    border: `1px solid ${isEditing ? "#3b82f6" : empty ? "#111" : "#161616"}`,
                                    cursor: isEditing ? "default" : "text",
                                    transition: "border-color 0.1s",
                                  }}
                                >
                                  <span style={{ fontSize: 9, color: isEditing ? "#3b82f6" : "#333", fontWeight: 600, letterSpacing: "0.05em" }}>{label.toUpperCase()}</span>
                                  {isEditing ? (
                                    <input
                                      autoFocus
                                      value={editingValue}
                                      onChange={e => setEditingValue(e.target.value)}
                                      onBlur={() => applyFieldEdit(key, editingValue)}
                                      onKeyDown={e => {
                                        if (e.key === "Enter") { e.preventDefault(); applyFieldEdit(key, editingValue); }
                                        if (e.key === "Escape") setEditingField(null);
                                      }}
                                      style={{
                                        background: "transparent", border: "none", outline: "none",
                                        color: "#c8c8c8", fontSize: 12,
                                        fontFamily: "'SF Mono','Fira Code',monospace",
                                        fontWeight: 500, width: "100%", padding: 0,
                                      }}
                                    />
                                  ) : (
                                    <span style={{
                                      fontSize: 12,
                                      color: empty ? "#252525" : "#c8c8c8",
                                      fontFamily: "'SF Mono','Fira Code',monospace",
                                      fontWeight: 500, wordBreak: "break-word",
                                    }}>
                                      {empty ? "—" : displayValue(key, val)}
                                    </span>
                                  )}
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
                            const mkCell = (fieldKey: string, displayVal: string, color: string, mono = true) => {
                              const editKey = `l_${i}_${fieldKey}`;
                              const isEd = editingField === editKey;
                              return isEd ? (
                                <input
                                  key={editKey}
                                  autoFocus
                                  value={editingValue}
                                  onChange={e => setEditingValue(e.target.value)}
                                  onBlur={() => applyLineEdit(i, fieldKey, editingValue)}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") { e.preventDefault(); applyLineEdit(i, fieldKey, editingValue); }
                                    if (e.key === "Escape") setEditingField(null);
                                  }}
                                  style={{ background: "transparent", border: "none", borderBottom: "1px solid #3b82f6", outline: "none", color: "#c8c8c8", fontSize: 11, fontFamily: mono ? "'SF Mono','Fira Code',monospace" : "inherit", width: "100%", padding: 0 }}
                                />
                              ) : (
                                <span
                                  key={fieldKey}
                                  onClick={() => { setEditingField(editKey); setEditingValue(displayVal === "—" ? "" : displayVal); }}
                                  style={{ fontSize: 11, color, fontFamily: mono ? "'SF Mono','Fira Code',monospace" : "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "text" }}
                                  title={displayVal}
                                >
                                  {displayVal}
                                </span>
                              );
                            };
                            return (
                              <div key={i} style={{ display: "grid", gridTemplateColumns: "18px 80px 1fr 44px 44px 52px 60px 52px", gap: "0 8px", padding: "8px 10px", borderRadius: 6, background: "#0e0e0e", border: "1px solid #161616", alignItems: "center" }}>
                                <span style={{ fontSize: 10, color: "#333" }}>{i + 1}</span>
                                {mkCell("ItemCode",        code ?? "—",     code ? "#c8c8c8" : "#252525")}
                                {mkCell("ItemDescription", desc ?? "—",     desc ? "#888" : "#252525", false)}
                                {mkCell("UoMCode",         line.UoMCode ?? "—", line.UoMCode ? "#c8c8c8" : "#252525")}
                                {mkCell("Quantity",        line.Quantity != null ? String(line.Quantity) : "—", line.Quantity != null ? "#c8c8c8" : "#252525")}
                                {mkCell("Price",           line.Price != null ? String(line.Price) : "—", line.Price != null ? "#c8c8c8" : "#252525")}
                                {mkCell("LineTotal",       line.LineTotal != null ? String(line.LineTotal) : "—", line.LineTotal != null ? "#f97316" : "#252525")}
                                {mkCell("VatPercent",      line.VatPercent != null ? `${line.VatPercent}` : "—", line.VatPercent != null ? "#3b82f6" : "#252525")}
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

                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
                      <button onClick={onDownloadJson} style={{ flex: 1, background: "#111", border: "1px solid #1e1e1e", borderRadius: 6, color: "#666", cursor: "pointer", fontSize: 11, padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "border-color 0.15s" }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Download JSON
                      </button>
                      <button onClick={() => setSapOpen(o => !o)} style={{ flex: 1, background: "#111", border: `1px solid ${sapOpen ? "#3b82f6" : "#1e1e1e"}`, borderRadius: 6, color: sapOpen ? "#3b82f6" : "#666", cursor: "pointer", fontSize: 11, padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "all 0.15s" }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                        </svg>
                        Send to SAP B1
                      </button>
                    </div>

                    {/* SAP push inline panel */}
                    {sapOpen && (
                      <div style={{ padding: "14px", background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 8, display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ fontSize: 10, color: "#333", letterSpacing: "0.06em", fontWeight: 600 }}>SAP BUSINESS ONE — SERVICE LAYER</div>
                        {([
                          { key: "base_url",    label: "Base URL",    placeholder: "https://sap-server:50000", type: "text" },
                          { key: "company_db",  label: "Company DB",  placeholder: "SBODemoUS",               type: "text" },
                          { key: "username",    label: "Username",    placeholder: "manager",                  type: "text" },
                          { key: "password",    label: "Password",    placeholder: "••••••••",                 type: "password" },
                        ] as const).map(({ key, label, placeholder, type }) => (
                          <div key={key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ fontSize: 9, color: "#333", fontWeight: 600 }}>{label.toUpperCase()}</span>
                            <input
                              type={type}
                              value={sapCreds[key] as string}
                              onChange={e => setSapCreds(p => ({ ...p, [key]: e.target.value }))}
                              placeholder={placeholder}
                              style={{ background: "#080808", border: "1px solid #1e1e1e", borderRadius: 5, color: "#aaa", fontSize: 11, padding: "6px 8px", outline: "none" }}
                            />
                          </div>
                        ))}
                        <button
                          onClick={onPushToSap}
                          disabled={sapStatus === "loading" || !sapCreds.base_url || !sapCreds.company_db || !sapCreds.username}
                          style={{
                            background: (sapStatus === "loading" || !sapCreds.base_url || !sapCreds.company_db || !sapCreds.username) ? "#161616" : "#1d4ed8",
                            border: "none", borderRadius: 6, color: "#fff", cursor: "pointer",
                            fontSize: 11, fontWeight: 700, padding: "8px 16px", transition: "background 0.15s",
                          }}
                        >
                          {sapStatus === "loading" ? "Pushing to SAP…" : "Push to SAP B1"}
                        </button>
                        {sapStatus === "done" && sapResult && (
                          <div style={{ padding: "8px 10px", borderRadius: 5, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)" }}>
                            <span style={{ fontSize: 11, color: "#22c55e" }}>✓ {sapResult.message}</span>
                            <span style={{ fontSize: 10, color: "#166534", display: "block", marginTop: 2 }}>DocEntry: {sapResult.DocEntry} · DocNum: {sapResult.DocNum}</span>
                          </div>
                        )}
                        {sapStatus === "error" && (
                          <div style={{ padding: "8px 10px", borderRadius: 5, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)" }}>
                            <span style={{ fontSize: 11, color: "#f87171" }}>{sapError}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* JSON view */}
                {invoiceResult && invoiceView === "json" && (
                  editMode ? (
                    <textarea
                      value={editJson}
                      onChange={e => setEditJson(e.target.value)}
                      spellCheck={false}
                      style={{
                        width: "100%", height: "100%", background: "transparent", border: "none",
                        color: "#6a9955", fontSize: 11.5, lineHeight: 1.7, outline: "none",
                        padding: "16px", resize: "none", boxSizing: "border-box",
                        fontFamily: "'SF Mono','Fira Code','Cascadia Code',monospace",
                      }}
                    />
                  ) : (
                    <pre style={{ margin: 0, padding: 16, fontSize: 11.5, lineHeight: 1.7, color: "#666", fontFamily: "'SF Mono','Fira Code','Cascadia Code',monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {jsonString}
                    </pre>
                  )
                )}
              </>
            )}

            {/* ════ BATCH TAB ════ */}
            {mode === "batch" && (
              <>
                {batchFiles.length === 0 ? (
                  <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: "#111", border: "1px solid #1e1e1e", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2a2a2a" strokeWidth="1.5">
                        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                        <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                      </svg>
                    </div>
                    <p style={{ color: "#2a2a2a", fontSize: 12, textAlign: "center" }}>
                      Add invoices in the queue →<br />then click Process All
                    </p>
                  </div>
                ) : (
                  <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "22px 1fr 70px 90px 90px 90px 70px", gap: "0 8px", padding: "0 8px", marginBottom: 2 }}>
                      {["#", "File", "Code", "Vendor", "Inv No.", "Total", "Status"].map(h => (
                        <span key={h} style={{ fontSize: 9, color: "#2a2a2a", fontWeight: 600, letterSpacing: "0.05em" }}>{h}</span>
                      ))}
                    </div>
                    {batchFiles.map((bf, i) => {
                      const statusColor = bf.status === "done" ? "#22c55e" : bf.status === "error" ? "#f87171" : bf.status === "processing" ? "#f97316" : "#333";
                      const statusLabel = bf.status === "done"
                        ? (bf.duplicate ? "⚠ Dup" : "Done")
                        : bf.status === "error" ? "Error" : bf.status === "processing" ? "Processing…" : "Pending";
                      const statusFinalColor = bf.status === "done" && bf.duplicate ? "#fbbf24" : statusColor;
                      const total    = bf.result?.header.DocTotal;
                      const currency = bf.result?.header.DocCurrency ?? "";
                      const vendorMatch = matchVendor(bf.result?.header.CardName, vendors);
                      return (
                        <div key={bf.id} style={{ display: "grid", gridTemplateColumns: "22px 1fr 70px 90px 90px 90px 70px", gap: "0 8px", padding: "7px 8px", borderRadius: 6, background: "#0e0e0e", border: `1px solid ${bf.duplicate ? "rgba(251,191,36,0.15)" : bf.status === "error" ? "#2a1515" : "#161616"}`, alignItems: "center" }}>
                          <span style={{ fontSize: 10, color: "#333" }}>{i + 1}</span>
                          <span style={{ fontSize: 11, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={bf.file.name}>{bf.file.name}</span>
                          <span style={{ fontSize: 11, color: vendorMatch ? "#f97316" : "#252525", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={vendorMatch ? `${vendorMatch.vendor.CardCode} (${Math.round(vendorMatch.score * 100)}%)` : undefined}>
                            {vendorMatch ? vendorMatch.vendor.CardCode : "—"}
                          </span>
                          <span style={{ fontSize: 11, color: bf.result?.header.CardName ? "#c8c8c8" : "#252525", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bf.result?.header.CardName ?? "—"}</span>
                          <span style={{ fontSize: 11, color: bf.result?.header.NumAtCard ? "#888" : "#252525", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bf.result?.header.NumAtCard ?? "—"}</span>
                          <span style={{ fontSize: 11, color: total != null ? "#f97316" : "#252525", fontFamily: "monospace", fontWeight: total != null ? 600 : 400 }}>
                            {total != null ? `${currency} ${total.toLocaleString()}` : "—"}
                          </span>
                          <span style={{ fontSize: 10, color: statusFinalColor, fontWeight: 600 }}>{statusLabel}</span>
                        </div>
                      );
                    })}
                    {batchFiles.some(f => f.status === "error") && (
                      <div style={{ marginTop: 4, padding: "6px 10px", borderRadius: 6, background: "rgba(248,113,113,0.04)", border: "1px solid rgba(248,113,113,0.1)" }}>
                        {batchFiles.filter(f => f.status === "error").map(bf => (
                          <div key={bf.id} style={{ fontSize: 10, color: "#666", marginBottom: 2 }}>
                            <span style={{ color: "#888" }}>{bf.file.name}</span>: {bf.error}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ════ HISTORY TAB ════ */}
            {mode === "history" && (
              invoiceHistory.length === 0 ? (
                <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "#111", border: "1px solid #1e1e1e", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2a2a2a" strokeWidth="1.5">
                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                  </div>
                  <p style={{ color: "#2a2a2a", fontSize: 12, textAlign: "center" }}>No invoices processed yet.<br />Extracted invoices appear here.</p>
                </div>
              ) : (
                <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "22px 1fr 80px 100px 60px", gap: "0 8px", padding: "0 8px", marginBottom: 2 }}>
                    {["#", "Vendor / File", "Inv No.", "Total", "Date"].map(h => (
                      <span key={h} style={{ fontSize: 9, color: "#2a2a2a", fontWeight: 600, letterSpacing: "0.05em" }}>{h}</span>
                    ))}
                  </div>
                  {invoiceHistory.map((rec, i) => (
                    <div
                      key={rec.key}
                      onClick={() => {
                        if (rec.result) {
                          setInvoiceResult(rec.result);
                          setEditJson(JSON.stringify(rec.result, null, 2));
                          setInvoiceDuplicate(null);
                          setInvoiceStatus("done");
                          setInvoiceView("fields");
                          setMode("invoice");
                        }
                      }}
                      style={{
                        display: "grid", gridTemplateColumns: "22px 1fr 80px 100px 60px", gap: "0 8px",
                        padding: "8px 8px", borderRadius: 6, background: "#0e0e0e",
                        border: "1px solid #161616", alignItems: "center",
                        cursor: rec.result ? "pointer" : "default",
                        transition: "border-color 0.1s",
                      }}
                    >
                      <span style={{ fontSize: 10, color: "#333" }}>{i + 1}</span>
                      <div style={{ overflow: "hidden" }}>
                        <div style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rec.vendor || "—"}</div>
                        <div style={{ fontSize: 9, color: "#2a2a2a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rec.filename}</div>
                      </div>
                      <span style={{ fontSize: 10, color: "#555", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rec.invoiceNo || "—"}</span>
                      <span style={{ fontSize: 11, color: rec.total != null ? "#f97316" : "#252525", fontFamily: "monospace", fontWeight: rec.total != null ? 600 : 400 }}>
                        {rec.total != null ? `${rec.currency} ${rec.total.toLocaleString()}` : "—"}
                      </span>
                      <span style={{ fontSize: 9, color: "#333" }}>{new Date(rec.processedAt).toLocaleDateString()}</span>
                    </div>
                  ))}
                  <p style={{ fontSize: 10, color: "#252525", textAlign: "center", paddingTop: 4 }}>Click a row to reload into Invoice Fields</p>
                </div>
              )
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
        <div style={{ background: "#0c0c0c", borderRadius: 12, border: "1px solid #181818", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <div style={{ padding: "11px 14px", borderBottom: "1px solid #161616", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {mode === "batch" ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                  </svg>
                  <span style={{ fontSize: 11, color: "#444", fontWeight: 600, letterSpacing: "0.05em" }}>QUEUE</span>
                  {batchRunning && (
                    <span style={{ fontSize: 10, color: "#f97316" }}>
                      {batchFiles.filter(f => f.status === "done" || f.status === "error").length} / {batchFiles.length}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button
                    onClick={() => batchInputRef.current?.click()}
                    style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 6, color: "#555", cursor: "pointer", fontSize: 11, padding: "4px 10px" }}
                  >
                    + Add Files
                  </button>
                  <input ref={batchInputRef} type="file" multiple accept={ACCEPTED.join(",")}
                    onChange={e => { onAddBatchFiles(e.target.files); e.target.value = ""; }}
                    style={{ display: "none" }} />
                  <button
                    onClick={onProcessBatch}
                    disabled={batchRunning || !batchFiles.some(f => f.status === "pending")}
                    style={{
                      background: (!batchRunning && batchFiles.some(f => f.status === "pending")) ? "#fff" : "#161616",
                      border: "1px solid transparent", borderRadius: 6,
                      color: (!batchRunning && batchFiles.some(f => f.status === "pending")) ? "#000" : "#2a2a2a",
                      cursor: (!batchRunning && batchFiles.some(f => f.status === "pending")) ? "pointer" : "not-allowed",
                      fontSize: 11, fontWeight: 700, padding: "4px 16px", transition: "all 0.15s",
                    }}
                  >
                    {batchRunning ? "Processing…" : "Process All"}
                  </button>
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>

          {/* Content area — position:relative anchor so children can fill with inset:0 */}
          <div style={{ flex: 1, position: "relative", minHeight: 0 }}>

            {/* ── Batch drop / file list ── */}
            {mode === "batch" && (
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); onAddBatchFiles(e.dataTransfer.files); }}
                style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
              >
                {batchFiles.length === 0 ? (
                  <div
                    onClick={() => batchInputRef.current?.click()}
                    style={{
                      position: "absolute", inset: 12, display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center", cursor: "pointer",
                      border: `1.5px dashed ${dragging ? "#333" : "#191919"}`,
                      borderRadius: 10, transition: "all 0.15s", gap: 14,
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
                      <p style={{ color: "#444", fontSize: 13, marginBottom: 5 }}>Drop multiple invoices or <span style={{ color: "#666", textDecoration: "underline", textUnderlineOffset: 3 }}>browse</span></p>
                      <p style={{ color: "#2a2a2a", fontSize: 11 }}>PDF · PNG · JPG · TIFF · WEBP</p>
                    </div>
                  </div>
                ) : (
                  <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                    {batchFiles.map(bf => {
                      const statusIcon = bf.status === "done"
                        ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        : bf.status === "error"
                        ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        : bf.status === "processing"
                        ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>;
                      return (
                        <div key={bf.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 6, background: "#0e0e0e", border: `1px solid ${bf.status === "error" ? "#2a1515" : "#161616"}`, flexShrink: 0 }}>
                          {statusIcon}
                          <span style={{ flex: 1, fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={bf.file.name}>{bf.file.name}</span>
                          <span style={{ fontSize: 10, color: "#333", flexShrink: 0 }}>{formatBytes(bf.file.size)}</span>
                          {bf.status === "pending" && (
                            <button onClick={() => onRemoveBatchFile(bf.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#2a2a2a", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>×</button>
                          )}
                        </div>
                      );
                    })}
                    <div
                      onClick={() => batchInputRef.current?.click()}
                      style={{ padding: "10px", borderRadius: 6, border: "1px dashed #1a1a1a", textAlign: "center", cursor: "pointer", color: "#2a2a2a", fontSize: 11, marginTop: 4, flexShrink: 0 }}
                    >
                      + Add more files
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Drop zone (no file) ── */}
            {mode !== "batch" && !file && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                style={{
                  position: "absolute", inset: 12, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", cursor: "pointer",
                  border: `1.5px dashed ${dragging ? "#333" : "#191919"}`,
                  borderRadius: 10, transition: "all 0.15s", gap: 14,
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
            )}

            {/* ── Image preview ── */}
            {mode !== "batch" && file && isImg && (
              <div style={{ position: "absolute", inset: 0, padding: 16, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", background: "#0c0c0c" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl!}
                  alt={file.name}
                  style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 8 }}
                />
              </div>
            )}

            {/* ── PDF preview ── */}
            {mode !== "batch" && file && isPdf && (
              <iframe
                src={`${previewUrl}#toolbar=0&navpanes=0`}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
                title={file.name}
              />
            )}

            {/* ── Generic file (no preview) ── */}
            {mode !== "batch" && file && !isImg && !isPdf && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
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


      {/* ── Dashboard modal ── */}
      {dashOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setDashOpen(false)}
        >
          <div
            style={{ background: "#111", border: "1px solid #222", borderRadius: 14, padding: "28px 32px", minWidth: 420, maxWidth: 520, width: "90%", display: "flex", flexDirection: "column", gap: 20 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "#ccc", fontWeight: 700 }}>Session Dashboard</span>
              <button onClick={() => setDashOpen(false)} style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 2px" }}>×</button>
            </div>
            {(() => {
              const total     = invoiceHistory.length;
              const totalVal  = invoiceHistory.reduce((s, r) => s + (r.total ?? 0), 0);
              const currencies = [...new Set(invoiceHistory.map(r => r.currency).filter(Boolean))];
              const batchDone = batchFiles.filter(f => f.status === "done").length;
              const batchDup  = batchFiles.filter(f => f.duplicate).length;
              const stats = [
                { label: "Invoices Processed",  value: String(total) },
                { label: "Batch Processed",      value: String(batchDone) },
                { label: "Total Value",          value: totalVal > 0 ? `${currencies[0] ?? ""} ${totalVal.toLocaleString()}` : "—" },
                { label: "Duplicates Found",     value: String(batchDup) },
              ];
              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {stats.map(({ label, value }) => (
                      <div key={label} style={{ padding: "14px 16px", background: "#0e0e0e", border: "1px solid #1a1a1a", borderRadius: 8 }}>
                        <div style={{ fontSize: 9, color: "#333", fontWeight: 600, letterSpacing: "0.06em", marginBottom: 6 }}>{label.toUpperCase()}</div>
                        <div style={{ fontSize: 22, color: "#ccc", fontWeight: 700, fontFamily: "'SF Mono','Fira Code',monospace" }}>{value}</div>
                      </div>
                    ))}
                  </div>
                  {invoiceHistory.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, color: "#333", fontWeight: 600, letterSpacing: "0.06em", marginBottom: 8 }}>RECENT INVOICES</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                        {invoiceHistory.slice(0, 10).map(rec => (
                          <div key={rec.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", background: "#0e0e0e", border: "1px solid #161616", borderRadius: 6 }}>
                            <div style={{ overflow: "hidden", flex: 1 }}>
                              <span style={{ fontSize: 11, color: "#888", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rec.vendor || "Unknown Vendor"}</span>
                              <span style={{ fontSize: 9, color: "#333" }}>{rec.invoiceNo || rec.filename}</span>
                            </div>
                            <span style={{ fontSize: 11, color: rec.total != null ? "#f97316" : "#333", fontFamily: "monospace", flexShrink: 0, marginLeft: 12 }}>
                              {rec.total != null ? `${rec.currency} ${rec.total.toLocaleString()}` : "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

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
