const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://text-extractor-engine.fly.dev";

export type OcrEngine    = "tesseract" | "doctr";
export type InvoiceMethod = "vlm" | "doctr_llm" | "tesseract_llm";

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

// ── Invoice types ────────────────────────────────────────────────────────────

export type InvoiceHeader = {
  // Document identity
  NumAtCard?: string | null;
  TaxInvoiceNo?: string | null;
  TaxInvoiceDate?: string | null;
  PurchaseOrderNo?: string | null;
  GRNDocNum?: string | null;
  ContractCode?: string | null;
  Series?: number | null;
  DocType?: string | null;

  // Vendor / supplier
  CardCode?: string | null;
  CardName?: string | null;
  VendorAddress?: string | null;
  VendorPhone?: string | null;
  VendorEmail?: string | null;
  VendorWebsite?: string | null;
  VendorTaxId?: string | null;
  ContactPersonCode?: string | null;

  // Bill-to / Ship-to
  BillToName?: string | null;
  BillToAddress?: string | null;
  ShipToCode?: string | null;
  ShipToName?: string | null;
  ShipToAddress?: string | null;

  // Dates
  DocDate?: string | null;
  DocDueDate?: string | null;
  TaxDate?: string | null;
  ShipDate?: string | null;
  RequiredDate?: string | null;

  // Currency
  DocCurrency?: string | null;
  DocRate?: number | null;

  // Financial summary
  DocSubTotal?: number | null;
  DiscountPercent?: number | null;
  DiscountSum?: number | null;
  FreightSum?: number | null;
  InsuranceSum?: number | null;
  HandlingFee?: number | null;
  VatPercent?: number | null;
  VatSum?: number | null;
  WTSum?: number | null;
  RoundingDiffAmount?: number | null;
  DocTotal?: number | null;
  SumApplied?: number | null;
  PriceListNum?: number | null;

  // Payment & banking
  PaymentGroupCode?: number | null;
  PaymentMethod?: string | null;
  BankName?: string | null;
  BankAccountName?: string | null;
  BankAccountNo?: string | null;
  IBAN?: string | null;
  SwiftCode?: string | null;

  // Organizational
  BPL_IDAssignedToInvoice?: number | null;
  SalesPersonCode?: number | null;
  Project?: string | null;
  Comments?: string | null;

  // Logistics
  TransportationCode?: number | null;
  TrackingNumber?: string | null;
  Incoterms?: string | null;
};

export type InvoiceLineItem = {
  LineNum?: number | null;
  // Item identity
  ItemCode?: string | null;
  ItemDescription?: string | null;
  SupplierCatNo?: string | null;
  BarCode?: string | null;
  FreeText?: string | null;
  // Quantity & UoM
  Quantity?: number | null;
  UoMCode?: string | null;
  OpenQty?: number | null;
  // Pricing
  Price?: number | null;
  GrossPrice?: number | null;
  DiscountPercent?: number | null;
  LineTotal?: number | null;
  TaxSum?: number | null;
  GrossTotal?: number | null;
  // Tax
  TaxCode?: string | null;
  VatPercent?: number | null;
  // Warehouse
  WarehouseCode?: string | null;
  ShipDate?: string | null;
  RequiredDate?: string | null;
  // Accounting
  AccountCode?: string | null;
  CostingCode?: string | null;
  CostingCode2?: string | null;
  CostingCode3?: string | null;
  CostingCode4?: string | null;
  ProjectCode?: string | null;
  // Batch / serial
  BatchNum?: string | null;
  SerialNum?: string | null;
  ExpirationDate?: string | null;
  // References
  BaseType?: number | null;
  BaseEntry?: number | null;
  BaseLine?: number | null;
  ContractCode?: string | null;
};

export type InvoiceExtractionResult = {
  filename: string;
  model_used: string;
  header: InvoiceHeader;
  lines: InvoiceLineItem[];
  notes?: string | null;
};

// ── API calls ────────────────────────────────────────────────────────────────

export async function extractText(file: File, engine: OcrEngine): Promise<ExtractionResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("engine", engine);
  const res = await fetch(`${BASE_URL}/api/v1/extract/`, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Extraction failed");
  }
  return res.json();
}

export async function extractInvoice(file: File, method: InvoiceMethod): Promise<InvoiceExtractionResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("method", method);
  const res = await fetch(`${BASE_URL}/api/v1/invoice/extract`, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Invoice extraction failed");
  }
  return res.json();
}

export function flattenText(result: ExtractionResult): string {
  if (result.text) return result.text;
  if (result.pages) return result.pages.map((p) => p.text).join("\n\n");
  return "";
}
