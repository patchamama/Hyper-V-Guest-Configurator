const fs = require('fs');

// Parse schema_columns.txt: table|column|type|char_len|num_prec|nullable|is_pk
const colLines = fs.readFileSync('schema_columns.txt', 'utf8').split('\n').filter(l => l.trim());
const schema = {};
for (const line of colLines) {
  const [table, column, type, charLen, numPrec, nullable, isPk] = line.split('|');
  if (!table || !column) continue;
  if (!schema[table]) schema[table] = {};
  let sqlType = type;
  if (charLen) sqlType += `(${charLen})`;
  else if (numPrec) sqlType += `(${numPrec})`;
  schema[table][column] = { type: sqlType, nullable: nullable === 'YES', pk: isPk === 'YES' };
}

// Parse row_counts.txt: schema|table|rows
const rowLines = fs.readFileSync('row_counts.txt', 'utf8').split('\n').filter(l => l.trim());
const rows = {};
for (const line of rowLines) {
  const parts = line.split('|');
  if (parts.length >= 3) rows[parts[1]] = parseInt(parts[2]) || 0;
}

// ── Metadata overrides: PK, displayField, description ──────────────────────
const META = {
  'Kundenakte':           { pk: 'Kundennr', display: 'Kundenname',       desc: 'Customer dossier linking clients to a company code.' },
  'activity':             { pk: null,        display: 'filename',          desc: 'Pending tasks/activities sent between ELO users.' },
  'activityobjekte':      { pk: null,        display: 'shortdesc',         desc: 'Activities linked to ELO object records.' },
  'actopt':               { pk: null,        display: 'optvalue',          desc: 'Configuration options for the activity module.' },
  'alerts':               { pk: null,        display: 'alertmemo',         desc: 'User-level alerts triggered by document or workflow events.' },
  'arcpaths2':            { pk: null,        display: 'name1',             desc: 'Archive path breadcrumbs stored as flat columns (legacy).' },
  'arcsync':              { pk: null,        display: 'arcname',           desc: 'Archive synchronisation state between ELO servers.' },
  'asp_0':                { pk: null,        display: 'i_template_guid',   desc: 'Aspect data store — template aspect values per document.' },
  'asp_1':                { pk: null,        display: 'i_name2',           desc: 'Aspect data store — address/contact aspect values.' },
  'asp_2':                { pk: null,        display: 'i_description',     desc: 'Aspect data store — date/description/number fields.' },
  'asp_3':                { pk: null,        display: 'i_customer_name',   desc: 'Aspect data store — customer name and number.' },
  'asp_4':                { pk: null,        display: 'i_invoice_number',  desc: 'Aspect data store — invoice metadata (number, date, status, amount).' },
  'asp_5':                { pk: null,        display: 'i_article_no',      desc: 'Aspect data store — article/line-item data.' },
  'asp_6':                { pk: null,        display: 'i_companyname',     desc: 'Aspect data store — company number and name.' },
  'aspectassoc':          { pk: null,        display: 'name',              desc: 'Associates aspects with document mask types.' },
  'aspectlines':          { pk: null,        display: 'linekey',           desc: 'Field definitions within an aspect template.' },
  'aspects':              { pk: 'id',        display: 'name',              desc: 'Aspect templates — reusable metadata blocks attached to document types.' },
  'asphistory_0':         { pk: null,        display: 'objhistguid',       desc: 'History of asp_0 values at each document version.' },
  'asphistory_1':         { pk: null,        display: 'objhistguid',       desc: 'History of asp_1 address values.' },
  'asphistory_2':         { pk: null,        display: 'objhistguid',       desc: 'History of asp_2 date/description values.' },
  'asphistory_3':         { pk: null,        display: 'i_customer_name',   desc: 'History of asp_3 customer values.' },
  'asphistory_4':         { pk: null,        display: 'i_invoice_number',  desc: 'History of asp_4 invoice values.' },
  'asphistory_5':         { pk: null,        display: 'i_article_no',      desc: 'History of asp_5 article values.' },
  'asphistory_6':         { pk: null,        display: 'i_companyname',     desc: 'History of asp_6 company values.' },
  'configurations':       { pk: 'cfgid',     display: 'cfgkey',            desc: 'System-wide and user-level ELO server configuration entries.' },
  'destman':              { pk: null,        display: 'path',              desc: 'Destination manager — tracks recently used filing paths per user.' },
  'dochistory':           { pk: 'objectid',  display: 'histversion',       desc: 'Version history of documents stored in ELO.' },
  'docmaskinherit':       { pk: null,        display: 'parentmaskid',      desc: 'Inheritance relationships between document mask types.' },
  'docmasklinetemplate':  { pk: null,        display: 'linebez',           desc: 'Field-line templates used when creating new document masks.' },
  'docmasks':             { pk: 'maskno',    display: 'maskname',          desc: 'Document index mask definitions — each mask is a document type with its metadata fields.' },
  'documentfeed':         { pk: null,        display: 'feedguid',          desc: 'Feed streams attached to documents for collaborative comments and events.' },
  'elocolor':             { pk: 'colorno',   display: 'colorname',         desc: 'Color lookup table used to mark document folders and objects.' },
  'elodmbackupprofile':   { pk: 'profileid', display: 'profilename',       desc: 'Document management backup profiles.' },
  'elodmcrypt':           { pk: 'cryptno',   display: 'cryptname',         desc: 'Encryption key sets for document storage.' },
  'elodmdocpath':         { pk: 'docid',     display: 'pathid',            desc: 'Maps stored document files to their physical storage paths.' },
  'elodmdocs':            { pk: 'docid',     display: 'ext',               desc: 'Physical document file metadata — size, path, checksum, encryption.' },
  'elodmopt':             { pk: 'instancename', display: 'optval',         desc: 'Document management daemon configuration options.' },
  'elodmpath':            { pk: 'pathid',    display: 'fullpath',          desc: 'Physical storage path definitions for document files.' },
  'elodmpreview':         { pk: null,        display: 'docpath',           desc: 'Preview file generation queue and status.' },
  'eloftopt':             { pk: null,        display: 'optval',            desc: 'Full-text indexing configuration options.' },
  'eloftrel':             { pk: null,        display: 'wordid',            desc: 'Full-text word-to-document index relations.' },
  'eloftstop':            { pk: null,        display: 'stopword',          desc: 'Full-text search stop words list.' },
  'eloftswords':          { pk: null,        display: 'word',              desc: 'Special word variants for full-text stemming.' },
  'eloftwords':           { pk: null,        display: 'word',              desc: 'Full-text word dictionary.' },
  'eloixopt':             { pk: 'ixid',      display: 'optname',           desc: 'Index server configuration options.' },
  'feedaction':           { pk: null,        display: 'actiontext',        desc: 'Individual feed actions — comments, mentions, workflow events on documents.' },
  'feedactionhist':       { pk: null,        display: 'actiontext',        desc: 'Edit history of feed action texts.' },
  'fulltextctrl8':        { pk: null,        display: 'ftobjid',           desc: 'Full-text index control queue (index 8).' },
  'fulltextctrl9':        { pk: null,        display: 'ftobjid',           desc: 'Full-text index control queue (index 9).' },
  'haftnotiz':            { pk: null,        display: 'noteid',            desc: 'Sticky notes attached to documents, positioned by page coordinates.' },
  'hashtagrelations':     { pk: null,        display: 'hashtagguid',       desc: 'Links hashtags to feed action entries.' },
  'hashtags':             { pk: null,        display: 'hstgname',          desc: 'Hashtag registry for document feed collaboration.' },
  'healthcheck':          { pk: null,        display: 'ixid',              desc: 'ELO index server health check snapshots.' },
  'komfloorplan':         { pk: null,        display: 'planname',          desc: 'KOM room/floor plan configuration.' },
  'kommovement':          { pk: null,        display: 'reqid',             desc: 'KOM physical document movement requests (in transit).' },
  'komrequest':           { pk: null,        display: 'reqid',             desc: 'KOM physical document checkout/loan requests.' },
  'map_formdata':         { pk: null,        display: 'mapid',             desc: 'Key-value property map for form data objects.' },
  'map_objekte':          { pk: null,        display: 'mapid',             desc: 'Key-value property map for document objects (main).' },
  'map_wfactive':         { pk: null,        display: 'mapid',             desc: 'Key-value property map for active workflow instances.' },
  'map_wffinished':       { pk: null,        display: 'mapid',             desc: 'Key-value property map for completed workflow instances.' },
  'mapdomain':            { pk: null,        display: 'mapdname',          desc: 'Map domain registry — defines namespaces for property maps.' },
  'maph_formdata':        { pk: null,        display: 'maphistguid',       desc: 'History of form data property maps.' },
  'maph_objekte':         { pk: null,        display: 'maphistguid',       desc: 'History of document object property maps.' },
  'maph_wfactive':        { pk: null,        display: 'maphistguid',       desc: 'History of active workflow property maps.' },
  'maph_wffinished':      { pk: null,        display: 'maphistguid',       desc: 'History of completed workflow property maps.' },
  'maphead_formdata':     { pk: null,        display: 'mapid',             desc: 'Header/metadata for form data property map versions.' },
  'maphead_objekte':      { pk: null,        display: 'mapid',             desc: 'Header/metadata for document object property map versions.' },
  'maphead_wfactive':     { pk: null,        display: 'mapid',             desc: 'Header/metadata for active workflow property map versions.' },
  'maphead_wffinished':   { pk: null,        display: 'mapid',             desc: 'Header/metadata for completed workflow property map versions.' },
  'maphhead_formdata':    { pk: null,        display: 'maphistguid',       desc: 'Extended history header for form data maps.' },
  'maphhead_objekte':     { pk: null,        display: 'maphistguid',       desc: 'Extended history header for document object maps.' },
  'maphhead_wfactive':    { pk: null,        display: 'maphistguid',       desc: 'Extended history header for active workflow maps.' },
  'maphhead_wffinished':  { pk: null,        display: 'maphistguid',       desc: 'Extended history header for completed workflow maps.' },
  'masklines':            { pk: null,        display: 'linebez',           desc: 'Index field line definitions within each document mask.' },
  'notification':         { pk: null,        display: 'userguid',          desc: 'User notification subscriptions for watched documents.' },
  'objekte':              { pk: 'objid',     display: 'objshort',          desc: 'Central ELO object store — every document, folder, and entry in the archive.' },
  'objhistkeys':          { pk: null,        display: 'okeyname',          desc: 'Index field values frozen at each document version.' },
  'objhistory':           { pk: null,        display: 'username',          desc: 'Audit log of who changed what on each ELO object.' },
  'objkeys':              { pk: 'parentid',  display: 'okeydata',          desc: 'Current index field values (metadata) for each ELO object.' },
  'objlinks':             { pk: null,        display: 'linkguid',          desc: 'Cross-reference links between ELO objects.' },
  'objreplsetcombis':     { pk: null,        display: 'combiid',           desc: 'Replication set combination definitions for multi-server setups.' },
  'objreplsets':          { pk: null,        display: 'tstamp',            desc: 'Replication set assignments per object.' },
  'objspaces':            { pk: null,        display: 'spaceguid',         desc: 'Collaboration space membership per object.' },
  'package':              { pk: 'pkguid',    display: 'pkname',            desc: 'Deployment packages — bundles of masks, workflows, and configuration.' },
  'packagelevel':         { pk: 'guid',      display: 'name',              desc: 'Version levels within a deployment package.' },
  'physdel':              { pk: null,        display: 'pdguid',            desc: 'Physical deletion queue — GUIDs pending secure data removal.' },
  'profileopts':          { pk: 'userid',    display: 'optkey',            desc: 'Per-user client-side preference settings.' },
  'publicdownloads':      { pk: null,        display: 'fname',             desc: 'Temporary public download links for sharing documents.' },
  'refpaths2':            { pk: null,        display: 'name1',             desc: 'Reference path breadcrumbs (legacy, mirrors arcpaths2).' },
  'relation':             { pk: 'parentid',  display: 'relguid',           desc: 'Parent-child structure links between ELO objects (folder tree).' },
  'replihist':            { pk: null,        display: 'rharcshort',        desc: 'Replication run history log between archive instances.' },
  'replsetnames':         { pk: null,        display: 'rsname',            desc: 'Named replication sets for controlling what syncs where.' },
  'report':               { pk: 'acttime',   display: 'addtext',           desc: 'High-volume ELO audit log — every user action on every document (41M+ rows).' },
  'serverstat':           { pk: null,        display: 'action',            desc: 'Server status and performance metrics.' },
  'shobjkeys':            { pk: null,        display: 'okeyname',          desc: 'Search-optimised shadow copy of objkeys for fast lookups.' },
  'shobjkeys3':           { pk: null,        display: 'okeyname',          desc: 'Alternative shadow index for long-text key values.' },
  'sol_accounting_costcenter': { pk: 'company_code', display: 'name',     desc: 'Cost centre master data, scoped per company.' },
  'sol_accounting_costobject': { pk: 'company_code', display: 'name',     desc: 'Cost object master data, scoped per company.' },
  'sol_accounting_gl_account': { pk: 'company_code', display: 'name',     desc: 'General ledger account master data, scoped per company.' },
  'sol_business_area':    { pk: 'company_code', display: 'name',          desc: 'Business area master data (SAP-style), scoped per company.' },
  'sol_common_fx':        { pk: 'currency_code', display: 'currency_description', desc: 'Current foreign exchange rates per currency.' },
  'sol_common_fx_history':{ pk: 'currency_code', display: 'currency_exchange_rate', desc: 'Historical exchange rate snapshots per currency and date.' },
  'sol_company':          { pk: 'code',      display: 'name',              desc: 'Legal entity master — all financial transactions are scoped to a company code.' },
  'sol_inbox_register':   { pk: 'pos',       display: 'doctype_name',      desc: 'Document type registry for the incoming invoice inbox, linking positions to ELO mask IDs.' },
  'sol_internal_order':   { pk: 'company_code', display: 'name',          desc: 'Internal order master data, scoped per company.' },
  'sol_invoice_item':     { pk: 'company_code', display: 'description',   desc: 'Invoice line-item master — predefined items with GL account, cost centre, and vendor defaults.' },
  'sol_invoice_po_line':  { pk: 'company_code', display: 'item_description', desc: 'Purchase order lines matched against incoming invoices.' },
  'sol_profit_center':    { pk: 'company_code', display: 'name',          desc: 'Profit centre master data, scoped per company.' },
  'sol_project':          { pk: 'company_code', display: 'name',          desc: 'Project master data for cost assignment, scoped per company.' },
  'sol_special_gl_indicator': { pk: 'company_code', display: 'description', desc: 'Special G/L indicators (e.g. down-payment flags), multi-language, scoped per company.' },
  'sol_tax_code':         { pk: 'company_code', display: 'description',   desc: 'Tax code master data with VAT rates, multi-language, scoped per company.' },
  'sol_trade_charge':     { pk: 'code',      display: 'description',       desc: 'Trade charge type lookup (e.g. freight, handling), multi-language.' },
  'sol_units':            { pk: 'code',      display: 'description',       desc: 'Unit of measure lookup, multi-language.' },
  'sol_vat_rates':        { pk: 'country',   display: 'vat_rates',         desc: 'VAT rate schedule per country and effective date.' },
  'sol_vendor':           { pk: 'company_code', display: 'name',          desc: 'Vendor/supplier master data with address, bank, and payment terms.' },
  'sol_vendor_terms_of_payment': { pk: 'company_code', display: 'cash_discount_rate', desc: 'Cash discount terms per vendor and company.' },
  'sol_wbs_element':      { pk: 'company_code', display: 'name',          desc: 'Work breakdown structure element master data, scoped per company.' },
  'sordtype':             { pk: 'id',        display: 'name',              desc: 'Document/folder type lookup — controls icons and behaviour in the ELO client.' },
  'spacefeedaction2':     { pk: null,        display: 'actiontext',        desc: 'Feed actions within collaboration spaces (ELO Spaces).' },
  'subscription':         { pk: null,        display: 'userguid',          desc: 'User watch subscriptions on documents or folders.' },
  'swl':                  { pk: 'groupid',   display: 'entry',             desc: 'Keyword list entries — dropdown values for index fields.' },
  'swlgrp':               { pk: 'swlgroupid', display: 'swlgroupid',       desc: 'Keyword list group headers — defines each dropdown list.' },
  'thesaurus':            { pk: 'groupid',   display: 'data',              desc: 'Synonym/thesaurus entries for full-text search expansion.' },
  'translations':         { pk: null,        display: 'lang1',             desc: 'Multi-language translation strings for masks, fields, and UI labels (up to 30 languages).' },
  'uniquearcpath':        { pk: null,        display: 'objshort',          desc: 'Enforces unique folder names within a parent path.' },
  'vtdocs':               { pk: null,        display: 'vtcode',            desc: 'Version transform queue for document conversion tasks.' },
  'wiedervorlage':        { pk: null,        display: 'short',             desc: 'Follow-up/resubmission reminders attached to documents.' },
  'workflowactivedoc':    { pk: 'wf_flowid', display: 'wf_flow_name',      desc: 'Active workflow instance node definitions — current state of running workflows.' },
  'workflowcompletiondoc':{ pk: 'wf_flowid', display: 'wf_flow_name',      desc: 'Completed workflow instance snapshots — final state of finished workflows.' },
  'workflowhead':         { pk: null,        display: 'wfguid',            desc: 'Workflow instance header — one row per workflow run with status and timestamps.' },
  'workflowhistory':      { pk: null,        display: 'wf_username',       desc: 'Step-by-step audit trail of every action taken within a workflow.' },
  'workflowtempl':        { pk: 'wf_flowid', display: 'wf_flow_name',      desc: 'Workflow template node definitions — the design-time blueprint for workflow types.' },
};

// ── Searchable column heuristic ────────────────────────────────────────────
function isSearchable(col, type) {
  if (!type.includes('character') && !type.includes('text')) return false;
  const low = col.toLowerCase();
  if (low.includes('guid') || low.includes('tstamp') || low.includes('acl') ||
      low.includes('blob') || low.includes('trkey') || low.includes('sync') ||
      low.includes('path') || low.includes('flags') || low.includes('script') ||
      low.includes('expression') || low.includes('posinfo')) return false;
  if (low.includes('name') || low.includes('desc') || low.includes('short') ||
      low.includes('email') || low.includes('code') || low.includes('no') ||
      low.includes('key') || low.includes('text') || low.includes('number') ||
      low.includes('comment') || low.includes('bez') || low.includes('entry') ||
      low.includes('value') || low.includes('word') || low.includes('iban') ||
      low.includes('vat') || low.includes('gln') || low.includes('article') ||
      low.includes('customer') || low.includes('invoice') || low.includes('vendor')) return true;
  return false;
}

// ── Human label from column name ──────────────────────────────────────────
function toLabel(col) {
  return col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bId\b/, 'ID').replace(/\bNo\b/, 'No.').replace(/\bPk\b/, 'PK')
    .replace(/\bGl\b/, 'GL').replace(/\bIban\b/, 'IBAN').replace(/\bBic\b/, 'BIC')
    .replace(/\bVat\b/, 'VAT').replace(/\bGln\b/, 'GLN').replace(/\bFx\b/, 'FX')
    .replace(/\bWf\b/, 'WF').replace(/\bWfs\b/, 'WF').replace(/\bUd\d/, s => s.toUpperCase());
}

// ── Confirmed relationships (from SQL validation) ─────────────────────────
const RELATIONS = {
  objkeys: [{ toTable: 'objekte', toCol: 'objid', fromCol: 'parentid', type: 'belongsTo', label: 'Index keys belong to an object' }],
  dochistory: [{ toTable: 'objekte', toCol: 'objid', fromCol: 'objectid', type: 'belongsTo', label: 'Document version belongs to an object' }],
  haftnotiz: [{ toTable: 'objekte', toCol: 'objid', fromCol: 'parentid', type: 'belongsTo', label: 'Sticky note is on a document' }],
  workflowactivedoc: [{ toTable: 'workflowhead', toCol: 'wfflowid', fromCol: 'wf_flowid', type: 'belongsTo', label: 'Active workflow nodes belong to a workflow run' }],
  workflowcompletiondoc: [{ toTable: 'workflowhead', toCol: 'wfflowid', fromCol: 'wf_flowid', type: 'belongsTo', label: 'Completion nodes belong to a workflow run' }],
  workflowhistory: [{ toTable: 'workflowhead', toCol: 'wfguid', fromCol: 'wfguid', type: 'belongsTo', label: 'Workflow history step belongs to a workflow run' }],
  feedaction: [{ toTable: 'documentfeed', toCol: 'feedguid', fromCol: 'feedguid', type: 'belongsTo', label: 'Feed action belongs to a document feed' }],
  hashtagrelations: [{ toTable: 'feedaction', toCol: 'actionguid', fromCol: 'actionguid', type: 'belongsTo', label: 'Hashtag relation tags a feed action' }],
  masklines: [{ toTable: 'docmasks', toCol: 'maskno', fromCol: 'maskno', type: 'belongsTo', label: 'Field line belongs to a document mask' }],
  aspectlines: [{ toTable: 'aspects', toCol: 'id', fromCol: 'aspectid', type: 'belongsTo', label: 'Aspect field belongs to an aspect template' }],
  aspectassoc: [{ toTable: 'docmasks', toCol: 'maskno', fromCol: 'maskid', type: 'belongsTo', label: 'Aspect association links an aspect to a mask' }],
  objhistory: [{ toTable: 'objekte', toCol: 'objguid', fromCol: 'objguid', type: 'belongsTo', label: 'Object history entry belongs to an object' }],
  swl: [{ toTable: 'swlgrp', toCol: 'swlgroupid', fromCol: 'groupid', type: 'belongsTo', label: 'Keyword entry belongs to a keyword list group' }],
  docmaskinherit: [{ toTable: 'docmasks', toCol: 'maskno', fromCol: 'parentmaskid', type: 'belongsTo', label: 'Child mask inherits from parent mask' }],
  sol_common_fx_history: [{ toTable: 'sol_common_fx', toCol: 'currency_code', fromCol: 'currency_code', type: 'belongsTo', label: 'FX history entry belongs to a currency' }],
  sol_company: [{ toTable: 'sol_common_fx', toCol: 'currency_code', fromCol: 'standard_currency_code', type: 'belongsTo', label: "Company's standard currency" }],
  sol_invoice_item: [{ toTable: 'sol_company', toCol: 'code', fromCol: 'company_code', type: 'belongsTo', label: 'Invoice item belongs to a company' }],
  sol_invoice_po_line: [
    { toTable: 'sol_company', toCol: 'code', fromCol: 'company_code', type: 'belongsTo', label: 'PO line belongs to a company' },
    { toTable: 'sol_vendor', toCol: 'no', fromCol: 'vendor_no', type: 'belongsTo', label: 'PO line references a vendor' },
    { toTable: 'sol_common_fx', toCol: 'currency_code', fromCol: 'currency_code', type: 'belongsTo', label: 'PO line uses a currency' },
  ],
  sol_accounting_costcenter: [{ toTable: 'sol_company', toCol: 'code', fromCol: 'company_code', type: 'belongsTo', label: 'Cost centre belongs to a company' }],
  sol_accounting_costobject: [{ toTable: 'sol_company', toCol: 'code', fromCol: 'company_code', type: 'belongsTo', label: 'Cost object belongs to a company' }],
  sol_accounting_gl_account: [{ toTable: 'sol_company', toCol: 'code', fromCol: 'company_code', type: 'belongsTo', label: 'GL account belongs to a company' }],
  sol_business_area: [{ toTable: 'sol_company', toCol: 'code', fromCol: 'company_code', type: 'belongsTo', label: 'Business area belongs to a company' }],
  sol_profit_center: [{ toTable: 'sol_company', toCol: 'code', fromCol: 'company_code', type: 'belongsTo', label: 'Profit centre belongs to a company' }],
  sol_project: [{ toTable: 'sol_company', toCol: 'code', fromCol: 'company_code', type: 'belongsTo', label: 'Project belongs to a company' }],
  sol_internal_order: [{ toTable: 'sol_company', toCol: 'code', fromCol: 'company_code', type: 'belongsTo', label: 'Internal order belongs to a company' }],
  sol_wbs_element: [{ toTable: 'sol_company', toCol: 'code', fromCol: 'company_code', type: 'belongsTo', label: 'WBS element belongs to a company' }],
  sol_special_gl_indicator: [{ toTable: 'sol_company', toCol: 'code', fromCol: 'company_code', type: 'belongsTo', label: 'Special GL indicator belongs to a company' }],
  sol_tax_code: [{ toTable: 'sol_company', toCol: 'code', fromCol: 'company_code', type: 'belongsTo', label: 'Tax code belongs to a company' }],
  sol_vendor: [{ toTable: 'sol_company', toCol: 'code', fromCol: 'company_code', type: 'belongsTo', label: 'Vendor belongs to a company' }],
  sol_vendor_terms_of_payment: [
    { toTable: 'sol_company', toCol: 'code', fromCol: 'company_code', type: 'belongsTo', label: 'Payment terms belong to a company' },
    { toTable: 'sol_vendor', toCol: 'no', fromCol: 'vendor_no', type: 'belongsTo', label: 'Payment terms belong to a vendor' },
  ],
  asp_0: [{ toTable: 'objekte', toCol: 'objid', fromCol: 'objid', type: 'belongsTo', label: 'Aspect data belongs to an object' }],
  asp_1: [{ toTable: 'objekte', toCol: 'objid', fromCol: 'objid', type: 'belongsTo', label: 'Aspect data belongs to an object' }],
  asp_2: [{ toTable: 'objekte', toCol: 'objid', fromCol: 'objid', type: 'belongsTo', label: 'Aspect data belongs to an object' }],
  asp_3: [{ toTable: 'objekte', toCol: 'objid', fromCol: 'objid', type: 'belongsTo', label: 'Aspect data belongs to an object' }],
  asp_4: [{ toTable: 'objekte', toCol: 'objid', fromCol: 'objid', type: 'belongsTo', label: 'Aspect data belongs to an object' }],
  asp_5: [{ toTable: 'objekte', toCol: 'objid', fromCol: 'objid', type: 'belongsTo', label: 'Aspect data belongs to an object' }],
  asp_6: [{ toTable: 'objekte', toCol: 'objid', fromCol: 'objid', type: 'belongsTo', label: 'Aspect data belongs to an object' }],
  objekte: [{ toTable: 'docmasks', toCol: 'maskno', fromCol: 'objmask', type: 'belongsTo', label: 'Object uses a document mask type' }],
};

// ── Build entities ─────────────────────────────────────────────────────────
const entities = {};
for (const [tbl, cols] of Object.entries(schema)) {
  const meta = META[tbl] || {};
  const pk = meta.pk || null;
  const display = meta.display || Object.keys(cols)[0] || null;
  const desc = meta.desc || `Stores ${tbl} records.`;

  const columns = {};
  for (const [col, info] of Object.entries(cols)) {
    columns[col] = {
      type: info.type,
      label: toLabel(col),
      pk: info.pk,
      nullable: info.nullable,
      searchable: isSearchable(col, info.type),
    };
  }

  const rels = RELATIONS[tbl] || [];
  const relObj = {};
  for (const r of rels) {
    relObj[r.toTable] = { type: r.type, foreignKey: r.fromCol, localKey: r.toCol, label: r.label };
  }

  entities[tbl] = { table: tbl, pk, displayField: display, description: desc, columns, relations: relObj };
}

// ── Flat relationships array ───────────────────────────────────────────────
const relationships = [];
for (const [tbl, rels] of Object.entries(RELATIONS)) {
  for (const r of rels) {
    relationships.push({
      from: { table: tbl, column: r.fromCol },
      to: { table: r.toTable, column: r.toCol },
      type: 'MANY_TO_ONE',
      confidence: 'inferred',
      label: r.label,
    });
  }
}

// ── Smart Templates ────────────────────────────────────────────────────────
const smartTemplates = [
  // ── OVERVIEW ──
  {
    id: 'company-overview',
    label: 'All Companies',
    description: 'Lists all legal entities with currency and row counts.',
    category: 'Overview',
    sql: `SELECT c.code AS "Company Code", c.name AS "Company", c.country_code AS "Country",
  c.standard_currency_code AS "Currency", fx.currency_description AS "Currency Name",
  c.gln AS "GLN"
FROM sol_company c
LEFT JOIN sol_common_fx fx ON fx.currency_code = c.standard_currency_code
ORDER BY c.code`,
    params: [],
  },
  {
    id: 'vendor-list',
    label: 'Vendors by Company',
    description: 'Lists all vendors for a selected company with address and bank data.',
    category: 'Overview',
    sql: `SELECT v.company_code, v.no AS "Vendor No.", v.name AS "Vendor", v.city, v.country_code,
  v.iban, v.bic, v.vat_id, v.tax_no, v.due_days AS "Due Days"
FROM sol_vendor v
JOIN sol_company c ON c.code = v.company_code
WHERE v.company_code = :company_code
ORDER BY v.name`,
    params: [{ name: 'company_code', type: 'select', label: 'Company', source: 'sol_company.code', displaySource: 'sol_company.name' }],
  },
  {
    id: 'document-masks',
    label: 'Document Masks',
    description: 'All document type definitions with field count and workflow assignment.',
    category: 'Overview',
    sql: `SELECT dm.maskno AS "Mask No.", dm.maskname AS "Mask Name",
  COUNT(ml.maskno) AS "Field Count",
  dm.maskflowid AS "Workflow ID",
  dm.maskstatus AS "Status"
FROM docmasks dm
LEFT JOIN masklines ml ON ml.maskno = dm.maskno
GROUP BY dm.maskno, dm.maskname, dm.maskflowid, dm.maskstatus
ORDER BY dm.maskname`,
    params: [],
  },
  {
    id: 'active-workflows',
    label: 'Active Workflows',
    description: 'Running workflow instances with current node, assignee, and due date.',
    category: 'Overview',
    sql: `SELECT wh.wfflowid AS "Flow ID", wh.wfguid AS "GUID",
  wa.wf_flow_name AS "Workflow", wa.wf_name AS "Current Node",
  wa.wf_node_type AS "Node Type", wa.wf_department AS "Department",
  wa.wf_duedate AS "Due Date", wa.wf_prio AS "Priority",
  wa.wf_eloobjid AS "Document ID"
FROM workflowhead wh
JOIN workflowactivedoc wa ON wa.wf_flowid = wh.wfflowid
WHERE wh.wfstatus = 1
ORDER BY wa.wf_duedate ASC
LIMIT 200`,
    params: [],
  },
  // ── REPORTS ──
  {
    id: 'invoice-po-lines-by-vendor',
    label: 'PO Lines by Vendor',
    description: 'Purchase order lines with vendor name, amounts, and GL account — 3-table join.',
    category: 'Reports',
    sql: `SELECT pol.purchase_order_no AS "PO No.", pol.line_no AS "Line",
  v.name AS "Vendor", pol.item_description AS "Item",
  pol.quantity, pol.quantity_unit AS "Unit",
  pol.unit_price AS "Unit Price", pol.line_amount AS "Line Amount",
  fx.currency_symbol AS "Currency",
  pol.gl_account_no AS "GL Account", pol.cost_center_no AS "Cost Centre",
  pol.delivery_note_no AS "Delivery Note", pol.delivery_note_date AS "Delivery Date",
  pol.received AS "Received"
FROM sol_invoice_po_line pol
JOIN sol_vendor v ON v.company_code = pol.company_code AND v.no = pol.vendor_no
LEFT JOIN sol_common_fx fx ON fx.currency_code = pol.currency_code
WHERE pol.company_code = :company_code
ORDER BY pol.purchase_order_no, pol.line_no::int`,
    params: [{ name: 'company_code', type: 'select', label: 'Company', source: 'sol_company.code', displaySource: 'sol_company.name' }],
  },
  {
    id: 'vendor-terms-full',
    label: 'Vendor Payment Terms',
    description: 'Vendors with payment terms and country — 3-table join.',
    category: 'Reports',
    sql: `SELECT v.no AS "Vendor No.", v.name AS "Vendor", v.city,
  vr.country AS "Country", vr.vat_rates AS "VAT Rates",
  vt.cash_discount_days AS "Discount Days",
  vt.cash_discount_rate AS "Discount Rate %",
  v.due_days AS "Net Due Days"
FROM sol_vendor v
LEFT JOIN sol_vendor_terms_of_payment vt
  ON vt.company_code = v.company_code AND vt.vendor_no = v.no
LEFT JOIN sol_vat_rates vr ON vr.country = v.country_code
WHERE v.company_code = :company_code
ORDER BY v.name`,
    params: [{ name: 'company_code', type: 'select', label: 'Company', source: 'sol_company.code', displaySource: 'sol_company.name' }],
  },
  {
    id: 'workflow-completion-report',
    label: 'Completed Workflows',
    description: 'Finished workflows with step history and duration.',
    category: 'Reports',
    sql: `SELECT wh.wfflowid AS "Flow ID",
  wc.wf_flow_name AS "Workflow", wc.wf_name AS "Final Node",
  wh.wftstamp AS "Timestamp", wh.wfstatus AS "Status",
  wc.wf_eloobjid AS "Document ID",
  COUNT(whi.wf_nodeid) AS "Steps Taken"
FROM workflowhead wh
JOIN workflowcompletiondoc wc ON wc.wf_flowid = wh.wfflowid
LEFT JOIN workflowhistory whi ON whi.wfguid = wh.wfguid
WHERE wh.wfstatus = 0
GROUP BY wh.wfflowid, wc.wf_flow_name, wc.wf_name, wh.wftstamp, wh.wfstatus, wc.wf_eloobjid
ORDER BY wh.wftstamp DESC
LIMIT 200`,
    params: [],
  },
  {
    id: 'document-index-full',
    label: 'Documents + Index Fields',
    description: 'Objects with all their metadata index fields pivoted as rows — 3-table join.',
    category: 'Reports',
    sql: `SELECT o.objid AS "Object ID", o.objshort AS "Title",
  dm.maskname AS "Document Type",
  ok.okeyname AS "Field Name", ok.okeydata AS "Field Value",
  o.objidate AS "Created", o.objxdate AS "Modified"
FROM objekte o
JOIN docmasks dm ON dm.maskno = o.objmask
JOIN objkeys ok ON ok.parentid = o.objid
WHERE o.objstatus = 0
ORDER BY o.objid DESC, ok.okeyno
LIMIT 500`,
    params: [],
  },
  {
    id: 'fx-rate-history',
    label: 'FX Rate History',
    description: 'Exchange rate evolution for a selected currency over time.',
    category: 'Reports',
    sql: `SELECT h.currency_code AS "Currency",
  fx.currency_description AS "Currency Name", fx.currency_symbol AS "Symbol",
  h.base_currency_code AS "Base Currency",
  h.currency_exchange_rate AS "Rate",
  h.time AS "Date"
FROM sol_common_fx_history h
JOIN sol_common_fx fx ON fx.currency_code = h.currency_code
WHERE h.currency_code = :currency_code
ORDER BY h.time DESC
LIMIT 365`,
    params: [{ name: 'currency_code', type: 'select', label: 'Currency', source: 'sol_common_fx.currency_code', displaySource: 'sol_common_fx.currency_description' }],
  },
  {
    id: 'cost-centres-by-company',
    label: 'Cost Centres by Company',
    description: 'All cost centres for a selected company with GL accounts.',
    category: 'Reports',
    sql: `SELECT cc.company_code, c.name AS "Company",
  cc.no AS "Cost Centre No.", cc.name AS "Cost Centre",
  gl.no AS "GL Account No.", gl.name AS "GL Account"
FROM sol_accounting_costcenter cc
JOIN sol_company c ON c.code = cc.company_code
LEFT JOIN sol_accounting_gl_account gl ON gl.company_code = cc.company_code
WHERE cc.company_code = :company_code
ORDER BY cc.no`,
    params: [{ name: 'company_code', type: 'select', label: 'Company', source: 'sol_company.code', displaySource: 'sol_company.name' }],
  },
  {
    id: 'workflow-steps-for-flow',
    label: 'Workflow Step History',
    description: 'Full step-by-step audit trail for a specific workflow run.',
    category: 'Reports',
    sql: `SELECT whi.wf_nodeid AS "Node", whi.wf_username AS "User",
  whi.wf_activate AS "Activated", whi.wf_terminate AS "Terminated",
  (whi.wf_terminate - whi.wf_activate) AS "Duration (sec)",
  whi.wf_succ_0 AS "Next Node"
FROM workflowhistory whi
WHERE whi.wfguid = (
  SELECT wfguid FROM workflowhead WHERE wfflowid = :flow_id
)
ORDER BY whi.wf_activate`,
    params: [{ name: 'flow_id', type: 'number', label: 'Flow ID', default: '' }],
  },
  // ── LOOKUPS ──
  {
    id: 'vendor-search',
    label: 'Search Vendors',
    description: 'Full-text search across vendor name, city, VAT ID, and IBAN.',
    category: 'Lookups',
    sql: `SELECT company_code, "no" AS "Vendor No.", name AS "Vendor",
  city, country_code, iban, vat_id, tax_no, due_days
FROM sol_vendor
WHERE name ILIKE '%searchterm%'
   OR city ILIKE '%searchterm%'
   OR vat_id ILIKE '%searchterm%'
   OR iban ILIKE '%searchterm%'
   OR "no" ILIKE '%searchterm%'
ORDER BY name
LIMIT 50`,
    params: [],
  },
  {
    id: 'document-search',
    label: 'Search Documents',
    description: 'Search ELO objects by title/short name.',
    category: 'Lookups',
    sql: `SELECT o.objid AS "ID", o.objshort AS "Title",
  dm.maskname AS "Type", o.objidate AS "Created",
  o.objxdate AS "Modified", o.objstatus AS "Status"
FROM objekte o
LEFT JOIN docmasks dm ON dm.maskno = o.objmask
WHERE o.objshort ILIKE '%searchterm%'
  AND o.objstatus = 0
ORDER BY o.objxdate DESC
LIMIT 100`,
    params: [],
  },
  {
    id: 'keyword-list-entries',
    label: 'Keyword List Values',
    description: 'Shows all entries in a keyword list group.',
    category: 'Lookups',
    sql: `SELECT s.groupid AS "Group ID", s.entry AS "Entry", s.orderid AS "Order"
FROM swl s
JOIN swlgrp g ON g.swlgroupid = s.groupid
WHERE s.groupid = :group_id
ORDER BY s.orderid`,
    params: [{ name: 'group_id', type: 'select', label: 'Keyword List', source: 'swlgrp.swlgroupid', displaySource: 'swlgrp.swlgroupid' }],
  },
  {
    id: 'mask-fields',
    label: 'Mask Field Definitions',
    description: 'All index fields for a selected document mask with types and keywords.',
    category: 'Lookups',
    sql: `SELECT ml.mlineno AS "Position", ml.linebez AS "Label",
  ml.linekey AS "Key", ml.linetype AS "Type",
  ml.linedefault AS "Default", ml.linecomment AS "Comment",
  ml.lineflags AS "Flags"
FROM masklines ml
JOIN docmasks dm ON dm.maskno = ml.maskno
WHERE ml.maskno = :mask_no
ORDER BY ml.mlineno`,
    params: [{ name: 'mask_no', type: 'select', label: 'Document Mask', source: 'docmasks.maskno', displaySource: 'docmasks.maskname' }],
  },
  {
    id: 'tax-codes',
    label: 'Tax Codes by Company',
    description: 'Tax codes with VAT rates for a selected company.',
    category: 'Lookups',
    sql: `SELECT tc.code AS "Tax Code", tc.description AS "Description",
  tc.vat_rate AS "VAT Rate %", tc.language AS "Language",
  c.name AS "Company"
FROM sol_tax_code tc
JOIN sol_company c ON c.code = tc.company_code
WHERE tc.company_code = :company_code
ORDER BY tc.code`,
    params: [{ name: 'company_code', type: 'select', label: 'Company', source: 'sol_company.code', displaySource: 'sol_company.name' }],
  },
  // ── AUDIT ──
  {
    id: 'recent-audit-log',
    label: 'Recent Audit Log',
    description: 'Last 500 audit entries from the report table with object ID and action.',
    category: 'Audit',
    sql: `SELECT r.reportid AS "ID", r.acttime AS "Timestamp",
  r.userid AS "User ID", r.actionno AS "Action",
  r.docid AS "Doc ID", r.sessionno AS "Session",
  r.addtext AS "Details"
FROM report r
ORDER BY r.reportid DESC
LIMIT 500`,
    params: [],
  },
  {
    id: 'object-history',
    label: 'Object Change History',
    description: 'Full change audit trail for a specific ELO object.',
    category: 'Audit',
    sql: `SELECT oh.objhistts AS "Timestamp", oh.username AS "User",
  oh.objhiststatus AS "Status", oh.objhistsrc AS "Source",
  oh.objhistwks AS "Workstation"
FROM objhistory oh
JOIN objekte o ON o.objguid = oh.objguid
WHERE o.objid = :obj_id
ORDER BY oh.objhistts DESC`,
    params: [{ name: 'obj_id', type: 'number', label: 'Object ID', default: '' }],
  },
  {
    id: 'document-versions',
    label: 'Document Version History',
    description: 'All versions of a document with timestamps, user, and checksum.',
    category: 'Audit',
    sql: `SELECT dh.histversion AS "Version", dh.histid AS "Hist ID",
  dh.userid AS "User ID", dh.createdate AS "Created",
  dh.histcomment AS "Comment", dh.docmd5 AS "MD5",
  dh.docflags AS "Flags", dh.docstatus AS "Status"
FROM dochistory dh
WHERE dh.objectid = :obj_id
ORDER BY dh.histid DESC`,
    params: [{ name: 'obj_id', type: 'number', label: 'Object ID', default: '' }],
  },
  // ── JOIN ──
  {
    id: 'invoice-full-join',
    label: 'Invoice PO Lines — Full Detail',
    description: 'PO lines with vendor, cost centre name, GL account name, and currency — 4-table join.',
    category: 'Join',
    sql: `SELECT pol.purchase_order_no AS "PO No.", pol.line_no AS "Line",
  v.name AS "Vendor", pol.item_description AS "Item",
  pol.quantity, fx.currency_symbol AS "Ccy",
  pol.unit_price AS "Unit Price", pol.line_amount AS "Total",
  cc.name AS "Cost Centre", gl.name AS "GL Account",
  pol.delivery_note_no AS "Delivery Note"
FROM sol_invoice_po_line pol
JOIN sol_vendor v ON v.company_code = pol.company_code AND v.no = pol.vendor_no
LEFT JOIN sol_common_fx fx ON fx.currency_code = pol.currency_code
LEFT JOIN sol_accounting_costcenter cc
  ON cc.company_code = pol.company_code AND cc.no = pol.cost_center_no
LEFT JOIN sol_accounting_gl_account gl
  ON gl.company_code = pol.company_code AND gl.no = pol.gl_account_no
WHERE pol.company_code = :company_code
ORDER BY pol.purchase_order_no, pol.line_no::int`,
    params: [{ name: 'company_code', type: 'select', label: 'Company', source: 'sol_company.code', displaySource: 'sol_company.name' }],
  },
  {
    id: 'document-with-aspects',
    label: 'Documents + Invoice Aspect Data',
    description: 'ELO objects (mask=invoice type) joined with asp_4 invoice metadata — 3-table join.',
    category: 'Join',
    sql: `SELECT o.objid AS "Object ID", o.objshort AS "Title",
  dm.maskname AS "Mask", a.i_invoice_number AS "Invoice No.",
  a.i_invoice_date AS "Invoice Date", a.i_status AS "Status",
  a.i_total_amount AS "Total Amount"
FROM objekte o
JOIN docmasks dm ON dm.maskno = o.objmask
JOIN asp_4 a ON a.objid = o.objid
WHERE o.objstatus = 0
ORDER BY a.i_invoice_date DESC
LIMIT 200`,
    params: [],
  },
  {
    id: 'objects-with-customer-aspect',
    label: 'Documents + Customer Aspect',
    description: 'ELO objects joined with asp_3 customer metadata — 3-table join.',
    category: 'Join',
    sql: `SELECT o.objid AS "Object ID", o.objshort AS "Title",
  dm.maskname AS "Document Type",
  a.i_customer_name AS "Customer Name",
  a.i_customer_number AS "Customer No.",
  o.objidate AS "Created"
FROM objekte o
JOIN docmasks dm ON dm.maskno = o.objmask
JOIN asp_3 a ON a.objid = o.objid
WHERE o.objstatus = 0
ORDER BY o.objidate DESC
LIMIT 200`,
    params: [],
  },
  // ── AGGREGATE ──
  {
    id: 'vendor-invoice-volume',
    label: 'Invoice Volume by Vendor',
    description: 'Total PO line amounts per vendor for a given company.',
    category: 'Aggregate',
    sql: `SELECT v.no AS "Vendor No.", v.name AS "Vendor",
  COUNT(pol.line_no) AS "PO Lines",
  SUM(pol.line_amount) AS "Total Amount",
  pol.currency_code AS "Currency"
FROM sol_invoice_po_line pol
JOIN sol_vendor v ON v.company_code = pol.company_code AND v.no = pol.vendor_no
WHERE pol.company_code = :company_code
GROUP BY v.no, v.name, pol.currency_code
ORDER BY "Total Amount" DESC NULLS LAST`,
    params: [{ name: 'company_code', type: 'select', label: 'Company', source: 'sol_company.code', displaySource: 'sol_company.name' }],
  },
  {
    id: 'workflow-stats',
    label: 'Workflow Statistics',
    description: 'Count of active vs. completed workflow runs per template name.',
    category: 'Aggregate',
    sql: `SELECT wf_flow_name AS "Workflow Template",
  COUNT(*) FILTER (WHERE wh.wfstatus = 1) AS "Active",
  COUNT(*) FILTER (WHERE wh.wfstatus = 0) AS "Completed",
  COUNT(*) AS "Total"
FROM workflowhead wh
JOIN workflowcompletiondoc wc ON wc.wf_flowid = wh.wfflowid
GROUP BY wf_flow_name
ORDER BY "Total" DESC`,
    params: [],
  },
  {
    id: 'objects-per-mask',
    label: 'Documents per Mask Type',
    description: 'Count of ELO objects grouped by document mask / document type.',
    category: 'Aggregate',
    sql: `SELECT dm.maskname AS "Document Type", dm.maskno AS "Mask No.",
  COUNT(o.objid) AS "Document Count"
FROM docmasks dm
LEFT JOIN objekte o ON o.objmask = dm.maskno AND o.objstatus = 0
GROUP BY dm.maskno, dm.maskname
ORDER BY "Document Count" DESC`,
    params: [],
  },
  {
    id: 'aspect-invoice-summary',
    label: 'Invoice Aspect Summary',
    description: 'Aggregate invoice amounts from asp_4 grouped by status.',
    category: 'Aggregate',
    sql: `SELECT i_status AS "Status",
  COUNT(*) AS "Count",
  SUM(i_total_amount) AS "Total Amount",
  AVG(i_total_amount) AS "Avg Amount",
  MIN(i_total_amount) AS "Min", MAX(i_total_amount) AS "Max"
FROM asp_4
WHERE i_total_amount IS NOT NULL
GROUP BY i_status
ORDER BY "Total Amount" DESC`,
    params: [],
  },
];

// ── Mermaid diagram ────────────────────────────────────────────────────────
const mermaid = `erDiagram
  sol_company {
    varchar code PK
    varchar name
    varchar country_code
    varchar standard_currency_code FK
  }
  sol_common_fx {
    varchar currency_code PK
    varchar currency_description
    varchar currency_exchange_rate
  }
  sol_common_fx_history {
    varchar currency_code FK
    varchar time PK
    varchar currency_exchange_rate
    varchar base_currency_code
  }
  sol_vendor {
    varchar company_code FK
    varchar no PK
    varchar name
    varchar country_code
    varchar iban
  }
  sol_vendor_terms_of_payment {
    varchar company_code FK
    varchar vendor_no FK
    int cash_discount_days
    numeric cash_discount_rate
  }
  sol_invoice_po_line {
    varchar company_code FK
    varchar vendor_no FK
    varchar purchase_order_no PK
    varchar line_no PK
    varchar currency_code FK
    varchar cost_center_no
    varchar gl_account_no
    numeric line_amount
  }
  sol_invoice_item {
    varchar company_code FK
    varchar no PK
    varchar description
    varchar gl_account_no
  }
  sol_accounting_costcenter {
    varchar company_code FK
    varchar no PK
    varchar name
  }
  sol_accounting_costobject {
    varchar company_code FK
    varchar no PK
    varchar name
  }
  sol_accounting_gl_account {
    varchar company_code FK
    varchar no PK
    varchar name
  }
  sol_vat_rates {
    varchar country PK
    date start_date PK
    varchar vat_rates
  }
  sol_tax_code {
    varchar company_code FK
    varchar code PK
    numeric vat_rate
  }
  objekte {
    int objid PK
    varchar objshort
    int objmask FK
    int objparent
    int objstatus
  }
  docmasks {
    int maskno PK
    varchar maskname
    int maskflowid
  }
  masklines {
    int maskno FK
    int mlineno
    varchar linebez
    varchar linekey
  }
  objkeys {
    int parentid FK
    int okeyno
    varchar okeyname
    varchar okeydata
  }
  dochistory {
    int objectid FK
    int documentid
    varchar histversion
    int userid
  }
  objhistory {
    varchar objguid FK
    varchar objhistts
    varchar username
  }
  aspects {
    int id PK
    varchar name
    varchar guid
  }
  aspectlines {
    int aspectid FK
    varchar linekey
    varchar linetype
  }
  aspectassoc {
    int maskid FK
    int aspectid
    varchar name
  }
  asp_3 {
    int objid FK
    varchar i_customer_name
    int i_customer_number
  }
  asp_4 {
    int objid FK
    int i_invoice_number
    varchar i_status
    float i_total_amount
  }
  asp_6 {
    int objid FK
    varchar i_companyno
    varchar i_companyname
  }
  workflowhead {
    int wfflowid
    varchar wfguid
    int wfstatus
    varchar wftstamp
  }
  workflowactivedoc {
    int wf_flowid FK
    int wf_nodeid PK
    varchar wf_flow_name
    int wf_department
    int wf_eloobjid
  }
  workflowcompletiondoc {
    int wf_flowid FK
    int wf_nodeid PK
    varchar wf_flow_name
  }
  workflowhistory {
    varchar wfguid FK
    int wf_nodeid
    varchar wf_username
    int wf_activate
  }
  workflowtempl {
    int wf_flowid PK
    varchar wf_flow_name
    int wf_version
  }
  feedaction {
    varchar actionguid PK
    varchar feedguid FK
    varchar actiontext
    int actiontype
  }
  documentfeed {
    varchar feedguid PK
    varchar objguid
    varchar createdateiso
  }
  hashtagrelations {
    varchar actionguid FK
    varchar hashtagguid
  }
  hashtags {
    varchar hstgguid PK
    varchar hstgname
  }
  swl {
    varchar groupid FK
    varchar orderid PK
    varchar entry
  }
  swlgrp {
    varchar swlgroupid PK
    int swluser
  }
  haftnotiz {
    int parentid FK
    int noteid
    int pageno
  }
  docmaskinherit {
    int parentmaskid FK
    int childmaskid FK
  }
  sol_company ||--o{ sol_vendor : "has vendors"
  sol_company ||--o{ sol_accounting_costcenter : "has cost centres"
  sol_company ||--o{ sol_accounting_costobject : "has cost objects"
  sol_company ||--o{ sol_accounting_gl_account : "has GL accounts"
  sol_company ||--o{ sol_invoice_item : "has invoice items"
  sol_company ||--o{ sol_invoice_po_line : "has PO lines"
  sol_company ||--o{ sol_tax_code : "has tax codes"
  sol_company }o--|| sol_common_fx : "standard currency"
  sol_common_fx ||--o{ sol_common_fx_history : "has history"
  sol_common_fx ||--o{ sol_invoice_po_line : "used in"
  sol_vendor ||--o{ sol_invoice_po_line : "supplies"
  sol_vendor ||--o{ sol_vendor_terms_of_payment : "has terms"
  objekte ||--o{ objkeys : "has index fields"
  objekte ||--o{ dochistory : "has versions"
  objekte ||--o{ objhistory : "has audit trail"
  objekte ||--o{ haftnotiz : "has sticky notes"
  objekte ||--o{ asp_3 : "has customer aspect"
  objekte ||--o{ asp_4 : "has invoice aspect"
  objekte ||--o{ asp_6 : "has company aspect"
  docmasks ||--o{ objekte : "types objects"
  docmasks ||--o{ masklines : "has fields"
  docmasks ||--o{ aspectassoc : "has aspects"
  docmasks ||--o{ docmaskinherit : "is parent mask"
  aspects ||--o{ aspectlines : "has field lines"
  workflowhead ||--o{ workflowactivedoc : "has active nodes"
  workflowhead ||--o{ workflowcompletiondoc : "has completion nodes"
  workflowhead ||--o{ workflowhistory : "has step history"
  documentfeed ||--o{ feedaction : "has actions"
  feedaction ||--o{ hashtagrelations : "is tagged"
  swlgrp ||--o{ swl : "has entries"`;

// ── Assemble final JSON ────────────────────────────────────────────────────
const out = {
  version: '1.0',
  generatedAt: new Date().toISOString(),
  connection: { type: 'postgresql', host: '172.25.83.98', port: 5432, database: 'Contelo' },
  entities,
  relationships,
  smartTemplates,
  diagram: { mermaid },
};

fs.writeFileSync('contelo_smart_queries.json', JSON.stringify(out, null, 2), 'utf8');
const stats = {
  tables: Object.keys(entities).length,
  relationships: relationships.length,
  templates: smartTemplates.length,
  fileSizeKB: Math.round(Buffer.byteLength(JSON.stringify(out)) / 1024),
};
console.log(JSON.stringify(stats));
