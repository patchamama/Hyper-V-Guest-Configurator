// Validate candidate FK relationships against the live Contelo DB.
// For each candidate: non_null = child rows with a usable FK value (integer 0 treated
// as "none", per ELO convention), orphans = usable FK values with no matching parent.
const { Client } = require('pg');
const fs = require('fs');

const C = [
  // ---- Core archive (objekte) ----
  { child: 'objkeys', fk: 'parentid', parent: 'objekte', pk: 'objid', int: true },
  { child: 'objekte', fk: 'objparent', parent: 'objekte', pk: 'objid', int: true, zeroIsRoot: true },
  { child: 'objekte', fk: 'objmask', parent: 'docmasks', pk: 'maskno', int: true, zeroValid: true },
  { child: 'objekte', fk: 'objtype', parent: 'sordtype', pk: 'id', int: true, zeroValid: true },
  { child: 'objekte', fk: 'objdoc', parent: 'elodmdocs', pk: 'docid', int: true },
  { child: 'dochistory', fk: 'objectid', parent: 'objekte', pk: 'objid', int: true },
  { child: 'dochistory', fk: 'documentid', parent: 'elodmdocs', pk: 'docid', int: true },
  { child: 'elodmdocs', fk: 'pathid', parent: 'elodmpath', pk: 'pathid', int: true, zeroValid: true },
  { child: 'elodmdocpath', fk: 'docid', parent: 'elodmdocs', pk: 'docid', int: true },
  { child: 'relation', fk: 'parentid', parent: 'objekte', pk: 'objid', int: true },
  { child: 'relation', fk: 'objectid', parent: 'objekte', pk: 'objid', int: true },
  { child: 'haftnotiz', fk: 'parentid', parent: 'objekte', pk: 'objid', int: true },
  { child: 'wiedervorlage', fk: 'parentid', parent: 'objekte', pk: 'objid', int: true },
  { child: 'objhistory', fk: 'objguid', parent: 'objekte', pk: 'objguid' },
  { child: 'objhistkeys', fk: 'objhistguid', parent: 'objhistory', pk: 'objhistguid' },
  { child: 'objlinks', fk: 'objguidparent', parent: 'objekte', pk: 'objguid' },
  { child: 'objlinks', fk: 'objguidtarget', parent: 'objekte', pk: 'objguid' },
  { child: 'objreplsets', fk: 'objid', parent: 'objekte', pk: 'objid', int: true },
  // ---- Feed / collaboration ----
  { child: 'documentfeed', fk: 'objguid', parent: 'objekte', pk: 'objguid' },
  { child: 'feedaction', fk: 'feedguid', parent: 'documentfeed', pk: 'feedguid' },
  { child: 'feedaction', fk: 'parentguid', parent: 'feedaction', pk: 'actionguid' },
  { child: 'hashtagrelations', fk: 'actionguid', parent: 'feedaction', pk: 'actionguid' },
  { child: 'hashtagrelations', fk: 'hashtagguid', parent: 'hashtags', pk: 'hstgguid' },
  { child: 'subscription', fk: 'watchguid', parent: 'objekte', pk: 'objguid' },
  { child: 'notification', fk: 'watchguid', parent: 'objekte', pk: 'objguid' },
  // ---- Masks / aspects / keyword lists ----
  { child: 'masklines', fk: 'maskno', parent: 'docmasks', pk: 'maskno', int: true, zeroValid: true },
  { child: 'docmaskinherit', fk: 'parentmaskid', parent: 'docmasks', pk: 'maskno', int: true, zeroValid: true },
  { child: 'docmaskinherit', fk: 'childmaskid', parent: 'docmasks', pk: 'maskno', int: true, zeroValid: true },
  { child: 'aspectassoc', fk: 'maskid', parent: 'docmasks', pk: 'maskno', int: true, zeroValid: true },
  { child: 'aspectassoc', fk: 'aspectid', parent: 'aspects', pk: 'id', int: true },
  { child: 'aspectlines', fk: 'aspectid', parent: 'aspects', pk: 'id', int: true },
  { child: 'aspectlines', fk: 'swlgroupid', parent: 'swlgrp', pk: 'swlgroupid' },
  { child: 'swl', fk: 'groupid', parent: 'swlgrp', pk: 'swlgroupid' },
  { child: 'asp_3', fk: 'objid', parent: 'objekte', pk: 'objid', int: true },
  { child: 'asp_4', fk: 'objid', parent: 'objekte', pk: 'objid', int: true },
  { child: 'asp_3', fk: 'maskid', parent: 'docmasks', pk: 'maskno', int: true, zeroValid: true },
  { child: 'asphistory_3', fk: 'objhistguid', parent: 'objhistory', pk: 'objhistguid' },
  // ---- Workflows ----
  { child: 'workflowactivedoc', fk: 'wf_flowid', parent: 'workflowhead', pk: 'wfflowid', int: true },
  { child: 'workflowcompletiondoc', fk: 'wf_flowid', parent: 'workflowhead', pk: 'wfflowid', int: true },
  { child: 'workflowtempl', fk: 'wf_flowid', parent: 'workflowhead', pk: 'wfflowid', int: true },
  { child: 'workflowhistory', fk: 'wfguid', parent: 'workflowhead', pk: 'wfguid' },
  { child: 'workflowactivedoc', fk: 'wf_eloobjid', parent: 'objekte', pk: 'objid', int: true },
  { child: 'workflowcompletiondoc', fk: 'wf_eloobjid', parent: 'objekte', pk: 'objid', int: true },
  { child: 'workflowhead', fk: 'wfparent', parent: 'workflowhead', pk: 'wfflowid', int: true },
  // ---- Audit ----
  { child: 'report', fk: 'docid', parent: 'objekte', pk: 'objid', int: true, sample: 200000 },
  // ---- ELO Solutions (invoice/accounting) ----
  { child: 'sol_company', fk: 'standard_currency_code', parent: 'sol_common_fx', pk: 'currency_code' },
  { child: 'sol_common_fx_history', fk: 'currency_code', parent: 'sol_common_fx', pk: 'currency_code', sample: 200000 },
  { child: 'sol_common_fx_history', fk: 'base_currency_code', parent: 'sol_common_fx', pk: 'currency_code', sample: 200000 },
  { child: 'sol_vendor', fk: 'company_code', parent: 'sol_company', pk: 'code' },
  { child: 'sol_invoice_item', fk: 'company_code', parent: 'sol_company', pk: 'code' },
  { child: 'sol_invoice_po_line', fk: 'company_code', parent: 'sol_company', pk: 'code' },
  { child: 'sol_invoice_po_line', fk: 'vendor_no', parent: 'sol_vendor', pk: 'no', composite: 'company_code' },
  { child: 'sol_invoice_po_line', fk: 'gl_account_no', parent: 'sol_accounting_gl_account', pk: 'no', composite: 'company_code' },
  { child: 'sol_invoice_po_line', fk: 'cost_center_no', parent: 'sol_accounting_costcenter', pk: 'no', composite: 'company_code' },
  { child: 'sol_invoice_po_line', fk: 'cost_object_no', parent: 'sol_accounting_costobject', pk: 'no', composite: 'company_code' },
  { child: 'sol_invoice_po_line', fk: 'currency_code', parent: 'sol_common_fx', pk: 'currency_code' },
  { child: 'sol_invoice_po_line', fk: 'item_no', parent: 'sol_invoice_item', pk: 'no', composite: 'company_code' },
  { child: 'sol_invoice_item', fk: 'vendor_no', parent: 'sol_vendor', pk: 'no', composite: 'company_code' },
  { child: 'sol_invoice_item', fk: 'gl_account_no', parent: 'sol_accounting_gl_account', pk: 'no', composite: 'company_code' },
  { child: 'sol_invoice_item', fk: 'cost_center_no', parent: 'sol_accounting_costcenter', pk: 'no', composite: 'company_code' },
  { child: 'sol_invoice_item', fk: 'cost_object_no', parent: 'sol_accounting_costobject', pk: 'no', composite: 'company_code' },
  { child: 'sol_accounting_costcenter', fk: 'company_code', parent: 'sol_company', pk: 'code' },
  { child: 'sol_accounting_costobject', fk: 'company_code', parent: 'sol_company', pk: 'code' },
  { child: 'sol_accounting_gl_account', fk: 'company_code', parent: 'sol_company', pk: 'code' },
  { child: 'sol_business_area', fk: 'company_code', parent: 'sol_company', pk: 'code' },
  { child: 'sol_profit_center', fk: 'company_code', parent: 'sol_company', pk: 'code' },
  { child: 'sol_project', fk: 'company_code', parent: 'sol_company', pk: 'code' },
  { child: 'sol_internal_order', fk: 'company_code', parent: 'sol_company', pk: 'code' },
  { child: 'sol_wbs_element', fk: 'company_code', parent: 'sol_company', pk: 'code' },
  { child: 'sol_special_gl_indicator', fk: 'company_code', parent: 'sol_company', pk: 'code' },
  { child: 'sol_tax_code', fk: 'company_code', parent: 'sol_company', pk: 'code' },
  { child: 'sol_vendor_terms_of_payment', fk: 'company_code', parent: 'sol_company', pk: 'code' },
  { child: 'sol_vendor_terms_of_payment', fk: 'vendor_no', parent: 'sol_vendor', pk: 'no', composite: 'company_code' },
  { child: 'sol_vendor', fk: 'country_code', parent: 'sol_vat_rates', pk: 'country' },
  { child: 'sol_inbox_register', fk: 'doctype_id', parent: 'docmasks', pk: 'maskno', castInt: true },
];

const q = (s) => `"${s}"`;

(async () => {
  const c = new Client({ host: '172.25.83.98', port: 5432, database: 'Contelo', user: 'elodb', password: 'elodb' });
  await c.connect();
  const out = [];
  for (const r of C) {
    const fkExpr = r.castInt ? `NULLIF(ch.${q(r.fk)}, '')::int` : `ch.${q(r.fk)}`;
    // usable = NOT NULL, and for ELO integer FKs also <> 0 unless 0 is a valid key
    let usable = `${fkExpr} IS NOT NULL`;
    if (r.int && !r.zeroValid) usable += ` AND ch.${q(r.fk)} <> 0`;
    if (!r.int && !r.castInt) usable += ` AND ${fkExpr} <> ''`;
    const src = r.sample
      ? `(SELECT * FROM ${q(r.child)} LIMIT ${r.sample}) ch`
      : `${q(r.child)} ch`;
    const compJoin = r.composite ? ` AND p.${q(r.composite)} = ch.${q(r.composite)}` : '';
    const sql = `
      SELECT COUNT(*) FILTER (WHERE ${usable}) AS non_null,
             COUNT(*) FILTER (WHERE ${usable} AND p.${q(r.pk)} IS NULL) AS orphans,
             COUNT(*) AS total
      FROM ${src}
      LEFT JOIN ${q(r.parent)} p ON p.${q(r.pk)} = ${fkExpr}${compJoin}`;
    try {
      const res = await c.query(sql);
      const { non_null, orphans, total } = res.rows[0];
      const status = Number(non_null) === 0 ? 'DISCARD (all null/0)'
        : Number(orphans) === 0 ? 'CONFIRMED'
        : (Number(orphans) / Number(non_null) < 0.02 ? 'CONFIRMED* (few orphans)' : 'DISCARD (orphans)');
      out.push({ ...r, non_null: +non_null, orphans: +orphans, total: +total, status });
      console.log(`${r.child}.${r.fk} -> ${r.parent}.${r.pk}${r.composite ? ' (+' + r.composite + ')' : ''} | non_null=${non_null} orphans=${orphans} total=${total} => ${status}`);
    } catch (e) {
      out.push({ ...r, error: e.message, status: 'ERROR' });
      console.log(`${r.child}.${r.fk} -> ${r.parent}.${r.pk} | ERROR: ${e.message}`);
    }
  }
  fs.writeFileSync('validation_results.json', JSON.stringify(out, null, 2));
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
