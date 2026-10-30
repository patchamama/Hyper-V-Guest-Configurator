# Contelo — Data Model Report

**Domain.** This is an **ELO Digital Office ECM/DMS** repository (Enterprise Content Management / archive) with an attached **SAP invoice-processing solution** (the `sol_*` tables). It stores documents, their metadata, folder hierarchy, full‑text index, workflows, and an accounting layer for vendor-invoice capture and posting.

**Core ELO content store.** `objekte` (~29k rows) is the central object table — every document and folder is an `objekte` row identified by `objid`. It is self-referential: `objparent → objekte.objid` builds the folder tree and `objrefid` links references. Metadata fields hang off it through `objkeys` (~157k rows, `parentid → objekte.objid`), with history mirrors in `objhistory` / `objhistkeys`. `relation` (~47k rows) wires objects to each other via `parentid` and `objectid` (both → `objekte.objid`). `docmasks` / `masklines` / `docmasklinetemplate` define the metadata "masks" (form templates); `aspects` / `aspectlines` / `aspectassoc` provide the newer aspect-based metadata. `report` (~41.7M rows) and `physdel` (~575k) are high-volume audit/journal tables.

**Workflow engine.** `workflowhead`, `workflowactivedoc`, `workflowcompletiondoc`, `workflowhistory`, and `workflowtempl` model running and finished workflows. `workflowactivedoc.wf_eloobjid → objekte.objid` ties a workflow node to its document; `wf_flowid → workflowhead.wfflowid` groups nodes into a flow. The `map_*` / `maph_*` / `maphead_*` families are workflow form-data and map key/value stores.

**SAP accounting layer (`sol_*`).** `sol_company` (pk `code`) is the **multi-tenancy hub** — 15 tables carry `company_code → sol_company.code`. Invoice capture revolves around `sol_invoice_item` and `sol_invoice_po_line`, each referencing `sol_vendor` (`vendor_no`), `sol_accounting_costcenter`, `sol_accounting_costobject`, `sol_accounting_gl_account`, and `sol_units`. Currency is normalized through `sol_common_fx` (`currency_code`) with rate history in `sol_common_fx_history`. Master data: `sol_profit_center`, `sol_business_area`, `sol_internal_order`, `sol_wbs_element`, `sol_tax_code`, `sol_vat_rates`, `sol_vendor_terms_of_payment`.

**Main data flow.** A document enters as an `objekte` row → metadata stored in `objkeys` under a `docmask` → routed through a `workflow` → for invoices, captured into `sol_invoice_item` / `sol_invoice_po_line`, validated against vendor/cost-center/GL master data scoped by `company_code`, and posted to SAP.

**Notable patterns.**
- **No declared foreign keys** — all 40 relationships are inferred from naming.
- **Composite multi-tenant keys**: `company_code` is simultaneously part of the PK and an FK to `sol_company` across the `sol_*` set.
- **Audit/history twins**: `*history`, `objhist*`, `maph_*`, `asphistory_*` shadow their live tables.
- **Sharded tables**: `asp_0..6`, `asphistory_0..6` are hash-partition shards, not distinct entities.
- **Lookup/reference tables**: `elocolor`, `sordtype`, `translations`, `sol_units`, `sol_tax_code`.
