# Settlement Studio

Browser-only Amazon settlement report to Xero and QuickBooks journal converter.

Live app: https://amazon-settlement-converter.onrender.com

Buyer information: [synthetic worked example](https://amazon-settlement-converter.onrender.com/#example), [named support, 30-day refunds and privacy](https://amazon-settlement-converter.onrender.com/#support). The published CSV examples are generated from the US synthetic fixture and regression-checked against the engine; they are not evidence of a real Xero/QBO import.

Best fit: US sellers doing occasional manual close or historical cleanup. This is a manual draft CSV converter, not a full A2X/Link My Books replacement: no direct posting, inventory/COGS, deferred-order accruals, tax-return automation, team workspace or cross-session import deduplication. Non-US file support is conditional on accountant-reviewed VAT/GST/HST treatment; taxes are carried through, not calculated.

Private, browser-only Amazon Flat File V2 settlement-to-journal converter. React + TypeScript + Vite, with no application backend, analytics, database or report-upload endpoint.

## Run

Use Node 24 and npm. `npm ci`, then `npm run dev`. `npm test` exercises the accounting engine with Node's built-in test runner; `npm run build` checks TypeScript and produces `dist/`.

## Features

- Strict tab-delimited Flat File V2 parsing (20 MB / 100,000 rows per batch).
- Exact-cent deposit reconciliation; discrepancies block export, with no balancing plug.
- Sales, shipping, refunds, referral/FBA/storage fees, ads, promotions, reserve movements, taxes, withholding and reimbursements. Unrecognized descriptions require review.
- Month-end split using Amazon's posted calendar date. Undated adjustments use settlement-end date and are disclosed.
- Separate settlements and currencies; explicit home-currency conversion with user-supplied rates. No automatic FX or tax calculation.
- Xero signed-amount CSV, with Narration/Date only on each journal's first row; QBO six-column debit/credit CSV and row-level source audit.
- Device-local mapping profiles and JSON backups. No reports or keys are persisted.
- Gumroad public license verification from the browser, including refund/dispute and membership-end checks, repeated at every paid export.
- Synthetic US/UK/EU samples and free sample downloads. Previewing real reports is free; exporting them requires a license.

## Deploy on Render (free static hosting)

1. Push this repository to GitHub. At https://dashboard.render.com/select-repo?type=static choose **New Static Site** and connect it (or choose **New → Blueprint** to use `render.yaml`).
2. Branch: `main`; build command: `npm ci && npm run build`; publish directory: `dist`. Static hosting is free; **do not create a paid web service**.
3. Deploy and visit the assigned `https://…onrender.com` URL. `render.yaml` includes security headers; manual static-site creation should add the same headers from that file. The current public-repository Render connection requires **Manual Deploy → Deploy latest commit** after merging changes.
4. Run the US/UK/EU samples, download the CSVs, then verify a real Gumroad test purchase before enabling checkout publicly.

## Enable Gumroad sales

The production plans are listed below. For a separate deployment, create equivalent licensed products at https://gumroad.com/products:

| Product | USD | License terms |
| --- | --- | --- |
| [Settlement Studio — Seller](https://rishabhgusain.gumroad.com/l/escgs) | $49/year | One seller, all marketplaces |
| [Settlement Studio — Seller lifetime](https://rishabhgusain.gumroad.com/l/sytokg) | $79 once | One seller, all marketplaces |
| [Settlement Studio — Bookkeeper](https://rishabhgusain.gumroad.com/l/ofyvps) | $149/year | Unlimited client businesses |

Use annual memberships for recurring plans; enable license keys in each product's Content editor (Insert → License key). This block shows the **product ID** (not permalink). Add the app's live URL and import limitations to the product content. Configure each product's public purchase URL and product ID in `public/licensing.json`, then deploy. These values are public identifiers, never access tokens. Empty configuration disables checkout; the app must not pretend licenses are sold until this is ready.

Annual non-subscription purchases are valid for a calendar year from purchase; annual memberships use Gumroad's active/end fields because original sale timestamps do not change on renewal. Lifetime keys do not expire. Browser-only enforcement is intentionally not tamper-proof DRM and cannot enforce seller/client counts. See https://gumroad.com/help/article/76-license-keys for the documented browser-compatible API.

## Accounting boundaries

These are draft journal CSVs, not direct ledger posting. Xero manual journals use base currency only; QBO's native journal import has no currency field, so home-currency amounts are exported. QBO import availability varies by region/plan. Exported dates: DD/MM/YYYY for Xero, MM/DD/YYYY for QBO. Xero's 300-line import limit is enforced.

Map clearing to a **non-bank asset** account; match bank payouts separately. Do not map to bank/AP/AR control accounts. Source tax amounts are carried through without VAT/GST/sales-tax computation; Xero needs the exact out-of-scope/No Tax label from the user's organisation. VAT return automation, COGS, inventory costing, tax advice, automatic exchange rates and direct platform integration are out of scope. FX rounds category balances; clearing is the sum of those rounded lines, not a plug to force an unrelated deposit amount.

All supplied samples are **synthetic**, based on documented report fields and representative transaction names. They are not anonymized customer files or evidence of live Xero/QBO imports. Live imports require accounts on those platforms.

Sources: [Amazon settlement schema](https://developer-docs.amazon.com/sp-api/docs/report-type-values-settlement), [Xero manual journal import](https://central.xero.com/s/article/Add-import-and-post-manual-journals), [QuickBooks journal import](https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tJQR0Cv_US_en_US).
