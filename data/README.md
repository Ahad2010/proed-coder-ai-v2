# Data Directory

Raw source files for ingestion. Not committed to git (see `.gitignore`).

## Expected Files

| File | Source | Size | Populated by |
|---|---|---|---|
| `icd10cm-order-2026.txt` | CMS/CDC | ~7 MB | `npm run seed:icd10` |
| `hcpcs-2026.csv` | CMS.gov | ~2 MB | Phase 3 |
| `cms-hcc-v28-crosswalk.csv` | CMS.gov | ~1 MB | Phase 3 |

## Auto-Download

Running `npm run seed:icd10` will attempt to download the ICD-10-CM ZIP from
CDC's FTP mirror and extract the order file automatically. If the download fails
(corporate firewall, network issue), the script prints manual download steps.

## Manual Download

If you need to fetch the ICD-10 file yourself:

1. Open <https://www.cms.gov/medicare/coding-billing/icd-10-codes>
2. Download **2026 Code Descriptions in Tabular Order (ZIP)**
3. Extract `icd10cm-order-2026.txt` into this directory
4. Re-run `npm run seed:icd10`
