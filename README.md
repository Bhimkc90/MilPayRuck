# MilPayRuck

Military Pay Calculator and Financial Planning Platform for Service Members.

## Overview

MilPayRuck helps military personnel understand their income, taxes, expenses, budgeting, savings, and financial goals.

The platform supports both military and civilian users while providing specialized military pay calculations for Active Duty Army personnel.

## Current Features

* User Registration
* User Login
* Password Hashing (bcrypt)
* JWT Authentication
* MongoDB Atlas Integration

## Technology Stack

### Backend

* Node.js
* Express.js
* MongoDB Atlas
* Mongoose

### Security

* JWT Authentication
* bcrypt Password Hashing
* Helmet

## Future Features

* Military Pay Calculator
* Civilian Income Calculator
* Budget Planning
* Expense Tracking
* Savings Analysis
* Financial Dashboard
* Data Visualization

## Status

Currently under active development.


## Military & NY State Active Duty Pay Estimator

`/pay-calculator` (login required) estimates, for one tax year:

* **Pay modes:** federal active duty, drill (inactive duty training), and New York State Active Duty (SAD, N.Y. Military Law §210(1): federal-equivalent pay and allowances or $125/day, whichever is greater).
* **Additional payment:** configurable, default $2,000 every 14 days from a first payment date (26 or 27 payments a year). Treated as a **user-reported assumption** and taxable by default; federal, NY, local, and payroll-tax treatment can each be changed.
* **Taxes:** federal income tax (liability and Pub 15-T withholding), Social Security/Medicare (wage base, Additional Medicare), NYS (including benefit recapture), NYC resident tax and school tax credit, Yonkers resident surcharge and nonresident earnings tax, NY military rules S-119 and S-126.
* **Output:** each payment, calendar months vs. monthly average, annual liability vs. withholding, assumptions, gated (unresolved) rules, and the dataset versions used.

Pay inputs are used only for the calculation and are not stored. Saving the monthly average to the budget is an explicit, optional button.

JSON API: `POST /api/pay/estimate` (same fields as the form) and `GET /api/pay/data-status`.

### Code layout

| Path | Responsibility |
| --- | --- |
| `lib/pay/` | Pay dates and gross pay per mode (no tax logic) |
| `lib/tax/` | Federal, FICA, New York liability/withholding, and per-component tax treatment |
| `lib/data/` | Versioned official-rate snapshots, validation, year gating, source monitor |
| `lib/calculator/` | Input parsing and orchestration |
| `controllers/payController.js`, `views/pay/calculator.ejs` | UI |

### Official data

Snapshots live in `lib/data/snapshots/<dataset>/<version>.json` and record source URL, publication date, effective dates, tax year, retrieval date, hash, and validation status. `lib/data/registry.json` activates one validated version per dataset and year. A year with no validated data is **blocked**; rates are never borrowed from another year.

* `npm run data:validate` validates every active snapshot.
* `npm run data:check-sources` fetches the official sources (HTTPS allowlist, timeouts, size limit, nothing executed) and records unchanged/changed/unreachable status in `data/cache/source-status.json`. Changed sources show a warning in results until a new snapshot is validated.
* `npm run data:build-bah` rebuilds the NY BAH snapshot from the DTMO workbook in `data/`.
* `scripts/extract_ny_withholding.py` (maintainer tool, needs `pypdf`) parses the NYS-50-T PDFs into a candidate snapshot.

DFAS, DoD, SSA and NY Senate sites return HTTP 403 to automated requests, so those snapshots are refreshed manually from a browser and then validated.

### Checks

```
npm test        # node:test suite
npm run lint    # syntax check of all JS and EJS templates
npm run data:validate
```
