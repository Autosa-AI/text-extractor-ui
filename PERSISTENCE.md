# Enabling Persistence (localStorage)

Vendor list and invoice history are currently held in React state only — they reset on page refresh.
To persist them across sessions, uncomment the lines below in:

**`components/extractor-app.tsx`**

---

## 1. Load on page open (lines 265–272)

Uncomment this entire `useEffect` block so vendors and history reload when the user opens the app:

```tsx
// useEffect(() => {
//   try {
//     const v = localStorage.getItem("invoice_vendors");
//     if (v) setVendors(JSON.parse(v));
//     const h = localStorage.getItem("invoice_history");
//     if (h) setInvoiceHistory(JSON.parse(h));
//   } catch {}
// }, []);
```

Becomes:

```tsx
useEffect(() => {
  try {
    const v = localStorage.getItem("invoice_vendors");
    if (v) setVendors(JSON.parse(v));
    const h = localStorage.getItem("invoice_history");
    if (h) setInvoiceHistory(JSON.parse(h));
  } catch {}
}, []);
```

---

## 2. Save vendor list when CSV is uploaded (line 348)

```tsx
// localStorage.setItem("invoice_vendors", JSON.stringify(records));
```

Becomes:

```tsx
localStorage.setItem("invoice_vendors", JSON.stringify(records));
```

---

## 3. Clear vendor list from storage when user clicks "Clear" (line 355)

```tsx
// localStorage.removeItem("invoice_vendors");
```

Becomes:

```tsx
localStorage.removeItem("invoice_vendors");
```

---

## 4. Save invoice to history after each extraction (line 373)

This is what powers duplicate detection across sessions:

```tsx
// localStorage.setItem("invoice_history", JSON.stringify(next));
```

Becomes:

```tsx
localStorage.setItem("invoice_history", JSON.stringify(next));
```

---

## Summary table

| Line | What it does |
|------|-------------|
| 265–272 | Load vendors + history from storage on app open |
| 348 | Save vendor list after CSV upload |
| 355 | Remove vendor list when user clears it |
| 373 | Save invoice to history (enables duplicate detection across sessions) |

All 4 must be uncommented together for full persistence.
Uncommenting only lines 348 + 355 + 373 without line 265–272 will save data but never reload it.
