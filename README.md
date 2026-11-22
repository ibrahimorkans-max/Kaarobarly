# Kaarobarly — Invoice. Track. Grow.

Mobile invoicing, client management, payment tracking and business finance. Kaarobarly started as a fork of the Monetra codebase and is now its own app.

```
apps/api         Node + Express + SQLite API (auth, tenant isolation, invoices, payments, receipts, ledger)
apps/mobile      Expo (React Native) app for Android, iOS and tablets
packages/shared  Decimal-safe money maths and types, used by both the API and the app
```

## Run it

```bash
cd apps/api
npm install
npm run seed     # optional demo data; the demo sign-in is in apps/api/src/seed.ts
npm start        # http://localhost:4000
```

```bash
cd apps/mobile
npm install
npm run web      # browser preview at http://localhost:8081
npx expo start   # scan the QR code with Expo Go on a phone
```

On a phone the app cannot reach `localhost`. Start it with your computer's LAN address:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.10:4000 npx expo start
```

Set `JWT_SECRET` (32+ random characters) before deploying the API. Without it a temporary secret is generated on each start.

## Checks

```bash
cd apps/api && npm test && npm run typecheck
cd apps/mobile && npx tsc --noEmit
```

## How money is handled

- Every amount is an integer number of minor units (paisa); quantities are thousandths, percentages are basis points. No floating point touches a financial value.
- The app shows a live total with the same `computeInvoice` function the server uses, and the server recalculates everything before saving.
- `Remaining balance = invoice total − allocations of payments that are not rejected`.
- A payment is never allocated beyond an invoice's balance. Any excess stays on the payment as client advance and can be applied to a later invoice.
- Invoice numbers are assigned per business when an invoice is finalized. Final invoices cannot be edited, only cancelled.
- Invoices and payments accept a device-generated `clientRequestId`; repeating a request returns the record already saved instead of creating a duplicate.

## Deploying

See [DEPLOY.md](DEPLOY.md). On an Ubuntu VPS: clone this repository, then `bash deploy/setup.sh kaarobarly.zhtrader.com`.

## Built so far

- Invoicing: dashboard (four selectable styles per business), clients with credit limits, business profiles, services, 5-step invoice builder, four invoice templates, preview, drawn signature, PDF/PNG/JPG export, receipts, installments, client ledger and statements.
- Quotations (convert to invoice), recurring invoices, detailed reports with PDF and Excel export.
- Finance: cash, bank and wallet accounts, transfers, refunds, daily cashbook, profit & loss, cash flow, multi-currency with exchange rates, financial-year numbering, multi-invoice payment allocation.
- Offline-first: every screen works without internet from a local SQLite copy; changes sync when back online, with conflict handling.
- Security: roles and permissions, device sessions, audit log, PIN / fingerprint / password app lock.

## Next

AI features with a choice of providers (OpenRouter, OpenAI, Claude and others): scanning, voice invoices, assistant, forecasts and alerts.
- Any business (phase 1): business-type presets with a setup wizard, modules switched on or off, your own words (Customer, Patient, Bill…), custom fields on clients, items, invoices, suppliers and purchases, item types.
- Buying and stock (phase 2): suppliers, purchase requests with approval, purchase orders, goods received (partial or full), bills from receipts, a stock ledger (sales take stock out, cancelling puts it back, counts and adjustments), reorder levels, barcode scanning.
- Advanced finance (phase 3): cheque register (post-dated, cleared, bounced), loans borrowed or lent with repayments and interest, monthly budgets, bills calendar, cash forecast, balance sheet, day close that locks the day.
- Collections and documents (phase 4): collections list with WhatsApp/SMS reminders, a client portal page, QR codes on invoices, credit notes and debit notes, documents in English, Urdu or both, and an Urdu app language.
- People (phase 5): team roles, employees, salary advances, monthly payroll with approval and payslips, expense claims, an approvals inbox.
- AI and automation (phase 6): Ask Kaarobarly (questions about your own figures), bill and receipt scanning, quick entry from a typed or dictated sentence, with Claude, OpenAI or OpenRouter chosen in AI settings; filing rules and alert rules.
- SaaS (phase 7): Free, Starter, Pro and Business plans with limits and usage, a 30-day Pro trial for new accounts, upgrade requests, a Kaarobarly admin screen to manage every account's plan, sign-in rate limiting and security headers.

## Server settings for the SaaS and AI features

In `apps/api/.env` (see `.env.example`): `PLATFORM_ADMINS` (emails of the people who run Kaarobarly), `SALES_CONTACT` (shown for upgrades), and optionally `ANTHROPIC_API_KEY` / `AI_MODEL` as a server-wide AI key for accounts without their own.
