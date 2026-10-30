// Generate the final contelo_smart_queries.json from schema_dump.json
// + the SQL-validated relationship list (validate_relationships.js / validate_extra2.js).
const fs = require('fs');
const schema = require('./schema_dump.json').tables;

// ---------------------------------------------------------------------------
// SQL-validated relationships (orphans = 0, or < 2% noted in label)
// ---------------------------------------------------------------------------
const REL = [
  // child, fkCol, parent, pkCol, label, [opts]
  ['objkeys', 'parentid', 'objekte', 'objid', 'Each index line belongs to one archive object'],
  ['objekte', 'objparent', 'objekte', 'objid', 'Repository tree: each object has a parent folder (0 = root)'],
  ['objekte', 'objmask', 'docmasks', 'maskno', 'Each object is filed with one metadata mask'],
  ['objekte', 'objtype', 'sordtype', 'id', 'Object type (folder level / document icon); ~450 custom type ids unregistered'],
  ['objekte', 'objdoc', 'elodmdocs', 'docid', 'Current document version of the object (0 = pure folder)', { one: true }],
  ['dochistory', 'objectid', 'objekte', 'objid', 'Each document version entry belongs to one archive object'],
  ['dochistory', 'documentid', 'elodmdocs', 'docid', 'Each version entry points to one physical document file', { one: true }],
  ['elodmdocs', 'pathid', 'elodmpath', 'pathid', 'Each stored file lives in one storage path'],
  ['relation', 'parentid', 'objekte', 'objid', 'Logical reference: parent object (441 orphans → deleted parents)'],
  ['relation', 'objectid', 'objekte', 'objid', 'Logical reference: referenced object'],
  ['haftnotiz', 'parentid', 'objekte', 'objid', 'Each sticky note is attached to one object'],
  ['objhistory', 'objguid', 'objekte', 'objguid', 'Metadata change history per object'],
  ['objhistkeys', 'objhistguid', 'objhistory', 'objhistguid', 'Historic index values per metadata change'],
  ['objreplsets', 'objid', 'objekte', 'objid', 'Replication set assignment per object'],
  ['documentfeed', 'objguid', 'objekte', 'objguid', 'Each feed belongs to one archive object', { one: true }],
  ['feedaction', 'feedguid', 'documentfeed', 'feedguid', 'Each feed post belongs to one feed'],
  ['feedaction', 'parentguid', 'feedaction', 'actionguid', 'Replies reference their parent post'],
  ['hashtagrelations', 'actionguid', 'feedaction', 'actionguid', 'Hashtag usage: tagged feed post'],
  ['hashtagrelations', 'hashtagguid', 'hashtags', 'hstgguid', 'Hashtag usage: the hashtag'],
  ['masklines', 'maskno', 'docmasks', 'maskno', 'Each mask line (index field definition) belongs to one mask'],
  ['docmaskinherit', 'parentmaskid', 'docmasks', 'maskno', 'Mask inheritance: parent mask'],
  ['docmaskinherit', 'childmaskid', 'docmasks', 'maskno', 'Mask inheritance: child mask'],
  ['aspectassoc', 'maskid', 'docmasks', 'maskno', 'Aspect association to a mask'],
  ['aspectlines', 'aspectid', 'aspects', 'id', 'Field definitions of an aspect'],
  ['aspectlines', 'swlgroupid', 'swlgrp', 'swlgroupid', 'Aspect field may use a keyword list'],
  ['swl', 'groupid', 'swlgrp', 'swlgroupid', 'Each keyword entry belongs to one keyword list group'],
  ['asp_3', 'objid', 'objekte', 'objid', 'Customer aspect data per object'],
  ['asp_3', 'maskid', 'docmasks', 'maskno', 'Customer aspect data references its mask'],
  ['asp_4', 'objid', 'objekte', 'objid', 'Aspect data (table 4) per object'],
  ['workflowactivedoc', 'wf_flowid', 'workflowhead', 'wfflowid', 'Active workflow nodes belong to one workflow instance'],
  ['workflowcompletiondoc', 'wf_flowid', 'workflowhead', 'wfflowid', 'Completed workflow nodes belong to one workflow instance'],
  ['workflowhistory', 'wfguid', 'workflowhead', 'wfguid', 'Workflow step history per workflow instance'],
  ['workflowactivedoc', 'wf_eloobjid', 'objekte', 'objid', 'Active workflow runs on an archive object'],
  ['workflowcompletiondoc', 'wf_eloobjid', 'objekte', 'objid', 'Completed workflow ran on an archive object'],
  ['workflowhead', 'wfparent', 'workflowhead', 'wfflowid', 'Sub-workflows reference their parent workflow (0 = top level)'],
  ['map_objekte', 'mapid', 'objekte', 'objid', 'Key-value metadata per object (mapid = objid as varchar)', { cast: true }],
  ['maphead_objekte', 'mapid', 'objekte', 'objid', 'Map head/checksum per object (mapid = objid as varchar)', { cast: true }],
  ['map_wfactive', 'mapid', 'workflowhead', 'wfflowid', 'Key-value map of active workflows (mapid = wfflowid as varchar)', { cast: true }],
  ['map_wffinished', 'mapid', 'workflowhead', 'wfflowid', 'Key-value map of finished workflows (mapid = wfflowid as varchar)', { cast: true }],
  // --- ELO Solutions (accounting / invoice) ---
  ['sol_company', 'standard_currency_code', 'sol_common_fx', 'currency_code', 'Company standard currency'],
  ['sol_common_fx_history', 'currency_code', 'sol_common_fx', 'currency_code', 'Exchange-rate history per currency'],
  ['sol_common_fx_history', 'base_currency_code', 'sol_common_fx', 'currency_code', 'Exchange-rate history base currency'],
  ['sol_vendor', 'company_code', 'sol_company', 'code', 'Vendors are kept per company (1 orphan company code)'],
  ['sol_invoice_item', 'company_code', 'sol_company', 'code', 'Invoice items are kept per company'],
  ['sol_invoice_po_line', 'company_code', 'sol_company', 'code', 'PO lines are kept per company'],
  ['sol_invoice_po_line', 'vendor_no', 'sol_vendor', 'no', 'Each PO line belongs to a vendor (composite with company_code)', { composite: 'company_code' }],
  ['sol_invoice_po_line', 'currency_code', 'sol_common_fx', 'currency_code', 'PO line currency'],
  ['sol_accounting_costcenter', 'company_code', 'sol_company', 'code', 'Cost centers per company'],
  ['sol_accounting_costobject', 'company_code', 'sol_company', 'code', 'Cost objects per company'],
  ['sol_accounting_gl_account', 'company_code', 'sol_company', 'code', 'G/L accounts per company'],
  ['sol_business_area', 'company_code', 'sol_company', 'code', 'Business areas per company'],
  ['sol_profit_center', 'company_code', 'sol_company', 'code', 'Profit centers per company'],
  ['sol_project', 'company_code', 'sol_company', 'code', 'Projects per company'],
  ['sol_internal_order', 'company_code', 'sol_company', 'code', 'Internal orders per company'],
  ['sol_wbs_element', 'company_code', 'sol_company', 'code', 'WBS elements per company'],
  ['sol_special_gl_indicator', 'company_code', 'sol_company', 'code', 'Special G/L indicators per company'],
  ['sol_tax_code', 'company_code', 'sol_company', 'code', 'Tax codes per company'],
  ['sol_vendor_terms_of_payment', 'company_code', 'sol_company', 'code', 'Payment terms per company'],
  ['sol_vendor_terms_of_payment', 'vendor_no', 'sol_vendor', 'no', 'Payment terms per vendor (composite with company_code)', { composite: 'company_code' }],
];

// ---------------------------------------------------------------------------
// Entity descriptions (hand-written for the relevant tables, families, fallback)
// ---------------------------------------------------------------------------
const DESC = {
  objekte: 'Central archive table: every folder and document of the ELO repository is one row (tree via objparent, metadata mask via objmask).',
  objkeys: 'Index lines (keywording): the metadata field values of each archive object, one row per filled index field.',
  docmasks: 'Metadata mask definitions (document types) that control which index fields an object has.',
  masklines: 'Index field definitions per mask: name, type, min/max and behaviour of each metadata field.',
  docmaskinherit: 'Parent/child inheritance between metadata masks.',
  docmasklinetemplate: 'Reusable mask line (index field) templates.',
  elodmdocs: 'Document Manager: one row per physical document file version (size, MD5, extension, storage path).',
  elodmpath: 'Storage path definitions where document files are physically kept.',
  elodmdocpath: 'Additional storage path assignment per document (unused here).',
  elodmpreview: 'Preview file metadata for documents.',
  elodmcrypt: 'Encryption key sets for encrypted documents.',
  elodmbackupprofile: 'Backup profiles of the Document Manager.',
  elodmopt: 'Document Manager instance options (key/value).',
  dochistory: 'Document version history: links archive objects to their physical file versions with comment/version label.',
  objhistory: 'Metadata change history: one row per saved metadata edit of an object.',
  objhistkeys: 'Historic index values belonging to a metadata change (objhistory).',
  relation: 'Logical references between archive objects (reference/link entries in folders).',
  haftnotiz: 'Sticky notes / annotations placed on document pages.',
  wiedervorlage: 'Resubmission/follow-up reminders on objects (empty here).',
  objlinks: 'GUID-based object-to-object links (empty here).',
  objreplsets: 'Replication set membership per object.',
  objreplsetcombis: 'Replication set combinations (bitmask dictionary).',
  replsetnames: 'Replication set name definitions.',
  replihist: 'Replication history.',
  objspaces: 'Repository spaces (teamspaces/workspaces) registry.',
  physdel: 'Queue of physically deleted objects (purge log).',
  sordtype: 'Object type dictionary: folder levels (1-9) and document type icons with file extensions.',
  elocolor: 'Color dictionary for object markers.',
  swlgrp: 'Keyword list groups (Stichwortlisten) used by index fields.',
  swl: 'Keyword list entries belonging to a keyword group.',
  thesaurus: 'Thesaurus terms for search.',
  aspects: 'Aspect definitions (composable metadata blocks, ELO aspect model).',
  aspectlines: 'Field definitions per aspect.',
  aspectassoc: 'Assignment of aspects to metadata masks.',
  translations: 'Translation table: language texts (lang1..lang23) per translation key, used for masks, fields and workflow labels.',
  workflowhead: 'Workflow instance/template registry: one row per workflow (type, status, parent for sub-workflows).',
  workflowtempl: 'Workflow template node definitions (designer data).',
  workflowactivedoc: 'Nodes of currently running workflows incl. the archive object they run on (wf_eloobjid).',
  workflowcompletiondoc: 'Nodes of completed workflows (same structure as active).',
  workflowhistory: 'Per-node execution history of workflows (who, activate/terminate times).',
  documentfeed: 'Feed per archive object (social collaboration stream).',
  feedaction: 'Feed posts/comments/events inside a document feed.',
  feedactionhist: 'Edit history of feed posts (empty here).',
  hashtags: 'Hashtag dictionary used in feeds.',
  hashtagrelations: 'Junction: which hashtag is used in which feed post.',
  subscription: 'User subscriptions to feeds (watchguid → feed GUID; many point to purged feeds).',
  notification: 'Pending feed notifications per user (watchguid → feed GUID).',
  report: 'Audit log: every user/server action (41M+ rows in production); docid holds the affected object id incl. already purged ones.',
  alerts: 'System alert definitions.',
  healthcheck: 'Server health check results.',
  serverstat: 'Server status heartbeat.',
  eloixopt: 'Indexserver instance options.',
  actopt: 'Activity module options.',
  activity: 'Activities (transmittal/task records of the activity module).',
  activityobjekte: 'Activities joined with object data (denormalized activity view).',
  profileopts: 'User profile options (key/value per userid).',
  configurations: 'Client/server configuration documents registry.',
  arcsync: 'Archive synchronisation state.',
  arcpaths2: 'Archive path definitions (v2).',
  refpaths2: 'Reference path definitions (v2).',
  uniquearcpath: 'Unique archive path constraint helper.',
  destman: 'Destination manager entries (transfer targets).',
  package: 'ELO package (app/solution) registry.',
  packagelevel: 'Package levels (dev/test/prod) per package.',
  publicdownloads: 'Public download share links.',
  vtdocs: 'Full-text conversion queue for documents.',
  eloftopt: 'Full-text engine options.',
  eloftrel: 'Full-text: word-to-document relations.',
  eloftwords: 'Full-text word dictionary.',
  eloftswords: 'Full-text stop word candidates.',
  eloftstop: 'Full-text stop words.',
  fulltextctrl8: 'Full-text control queue (v8 engine).',
  fulltextctrl9: 'Full-text control queue (v9 engine).',
  mapdomain: 'Dictionary of map domains (objekte, formdata, wfactive, wffinished).',
  komfloorplan: 'Intray/clipboard floor plan (Postbox layout).',
  kommovement: 'Intray document movements.',
  komrequest: 'Intray requests.',
  dochistory_: '',
  Kundenakte: 'Custom customer master table (Kundenakte solution): customer number, name and address.',
  sol_company: 'Company codes (clients) of the ELO Invoice/Accounting solution — central lookup.',
  sol_vendor: 'Vendor master data per company (name, address, IBAN, VAT id).',
  sol_vendor_terms_of_payment: 'Payment terms per vendor.',
  sol_invoice_item: 'Invoice item catalog per company.',
  sol_invoice_po_line: 'Purchase order lines used for invoice matching (vendor, item, quantities, amounts).',
  sol_accounting_gl_account: 'General ledger accounts per company.',
  sol_accounting_costcenter: 'Cost centers per company.',
  sol_accounting_costobject: 'Cost objects per company.',
  sol_business_area: 'Business areas per company.',
  sol_profit_center: 'Profit centers per company.',
  sol_project: 'Projects per company.',
  sol_internal_order: 'Internal orders per company.',
  sol_wbs_element: 'WBS elements per company.',
  sol_special_gl_indicator: 'Special G/L indicators per company.',
  sol_tax_code: 'Tax codes per company.',
  sol_vat_rates: 'VAT rates per country with validity date.',
  sol_common_fx: 'Currency dictionary with current exchange rate.',
  sol_common_fx_history: 'Daily exchange-rate history per currency (197k rows).',
  sol_units: 'Unit of measure dictionary.',
  sol_trade_charge: 'Trade charge type dictionary.',
  sol_inbox_register: 'Inbox filing rules: register path + document type + workflow per position.',
  spacefeedaction2: 'Feed actions inside teamspaces.',
  shobjkeys: 'Search helper copy of object index values.',
  shobjkeys3: 'Search helper copy of object index values (v3).',
};
const famDesc = (t) => {
  let m;
  if ((m = t.match(/^asp_(\d)$/))) return `Aspect data table #${m[1]}: one row per object/aspect instance with the aspect's own columns.`;
  if ((m = t.match(/^asphistory_(\d)$/))) return `History of aspect data table #${m[1]} (one row per saved change).`;
  if ((m = t.match(/^map_(\w+)$/))) return `Key-value metadata map, domain "${m[1]}" (mapid = ${m[1] === 'objekte' ? 'object id' : m[1].startsWith('wf') ? 'workflow id' : 'form id'}).`;
  if ((m = t.match(/^maph_(\w+)$/))) return `History of the key-value map, domain "${m[1]}".`;
  if ((m = t.match(/^maphead_(\w+)$/))) return `Map head/checksum rows for domain "${m[1]}".`;
  if ((m = t.match(/^maphhead_(\w+)$/))) return `History of map head rows for domain "${m[1]}".`;
  return null;
};

// displayField overrides; fallback = heuristic
const DISPLAY = {
  objekte: 'objshort', docmasks: 'maskname', sordtype: 'name', elocolor: 'colorname',
  aspects: 'name', swlgrp: 'swlgroupid', swl: 'entry', masklines: 'linebez',
  elodmdocs: 'docguid', elodmpath: 'pathname', dochistory: 'histversion',
  workflowhead: 'wfguid', workflowactivedoc: 'wf_flow_name', workflowcompletiondoc: 'wf_flow_name',
  workflowtempl: 'wf_flow_name', workflowhistory: 'wf_username',
  documentfeed: 'feedguid', feedaction: 'actiontext', hashtags: 'hstgname',
  Kundenakte: 'Kundenname', report: 'addtext', package: 'pkname', packagelevel: 'name',
  replsetnames: 'rsname', translations: 'trankey', objkeys: 'okeydata', objhistory: 'username',
  sol_company: 'name', sol_vendor: 'name', sol_common_fx: 'currency_description',
  sol_invoice_item: 'description', sol_invoice_po_line: 'item_description',
  sol_inbox_register: 'doctype_name', sol_units: 'name', mapdomain: 'domainname',
};

const LABELS = {
  objid: 'Object ID', objshort: 'Short name', objdesc: 'Description', objmask: 'Mask no.',
  objparent: 'Parent object', objtype: 'Object type', objdoc: 'Current document ID',
  objguid: 'Object GUID', objtstamp: 'Timestamp', deletedate: 'Delete date (0 = active)',
  deleteuser: 'Deleted by user', objuser: 'Owner user ID', objstatus: 'Status flags',
  objidate: 'Internal date', objxdate: 'Document date', objchildcount: 'Child count',
  parentid: 'Parent object ID', okeyno: 'Field position', okeyname: 'Index field name',
  okeydata: 'Index value', okeyudata: 'Index value (uppercase)', okeydouble: 'Numeric value',
  maskno: 'Mask no.', maskname: 'Mask name', masktext: 'Mask description', maskguid: 'Mask GUID',
  mlineno: 'Line no.', linebez: 'Field label', linekey: 'Field group key', linetype: 'Field type',
  linemin: 'Min length', linemax: 'Max length', linedefault: 'Default value',
  docid: 'Document ID', docguid: 'Document GUID', docsize: 'File size (bytes)', md5: 'MD5 hash',
  pathid: 'Storage path ID', ext: 'File extension', createdate: 'Created', lastupdate: 'Last update',
  objectid: 'Object ID', documentid: 'Document ID', userid: 'User ID', histid: 'History position',
  histcomment: 'Version comment', histversion: 'Version label',
  wfflowid: 'Workflow ID', wf_flowid: 'Workflow ID', wfguid: 'Workflow GUID', wftype: 'Workflow type',
  wfstatus: 'Workflow status', wfparent: 'Parent workflow ID', wf_nodeid: 'Node ID',
  wf_flow_name: 'Workflow name', wf_name: 'Node name', wf_eloobjid: 'Archive object ID',
  wf_user: 'User ID', wf_username: 'User name', wf_activate: 'Activated at', wf_terminate: 'Terminated at',
  feedguid: 'Feed GUID', actionguid: 'Action GUID', actiontext: 'Post text', actiontype: 'Action type',
  parentguid: 'Parent action GUID', userguid: 'User GUID', createdateiso: 'Created (ISO)',
  hstgguid: 'Hashtag GUID', hstgname: 'Hashtag', watchguid: 'Watched GUID',
  groupid: 'Keyword group', swlgroupid: 'Keyword group ID', entry: 'Keyword entry', orderid: 'Sort key',
  aspectid: 'Aspect ID', maskid: 'Mask no.', assoc: 'Association name', ordinal: 'Ordinal',
  objhistguid: 'Metadata change GUID', objhistts: 'Changed at', username: 'User name',
  mapid: 'Map ID (object/workflow id)', mapkey: 'Key', mapvalue: 'Value',
  company_code: 'Company code', code: 'Code', name: 'Name', no: 'Number', description: 'Description',
  vendor_no: 'Vendor no.', currency_code: 'Currency', base_currency_code: 'Base currency',
  currency_exchange_rate: 'Exchange rate', currency_symbol: 'Symbol', currency_description: 'Currency name',
  standard_currency_code: 'Standard currency', gl_account_no: 'G/L account no.',
  cost_center_no: 'Cost center no.', cost_object_no: 'Cost object no.', purchase_order_no: 'PO number',
  line_no: 'Line no.', item_no: 'Item no.', item_description: 'Item description',
  unit_price: 'Unit price', line_amount: 'Line amount', quantity: 'Quantity',
  country_code: 'Country code', vat_id: 'VAT ID', tax_no: 'Tax number', iban: 'IBAN', bic: 'BIC',
  zipcode: 'ZIP', city: 'City', street: 'Street', due_days: 'Due days',
  acttime: 'Action time', actionno: 'Action code', addtext: 'Detail text', reportid: 'Report ID',
  Kundennr: 'Customer no.', Kundenname: 'Customer name', Adresse: 'Address', Plz: 'ZIP', Ort: 'City',
  trankey: 'Translation key', i_customer_name: 'Customer name', i_customer_number: 'Customer number',
};
const prettify = (c) => (LABELS[c] || (c.charAt(0).toUpperCase() + c.slice(1)).replace(/_/g, ' '));

const SEARCH_RE = /(name|short|desc|text|comment|bez|entry|data$|street|city|label|filename|trankey|code$|^no$|ext$|version|^addtext)/i;
const NOSEARCH_RE = /(guid|tstamp|acl|md5|stamp)/i;
const isSearchable = (col) =>
  /character|text/.test(col.type) && SEARCH_RE.test(col.name) && !NOSEARCH_RE.test(col.name);

// pk fallback for tables without a declared PK
const PK_FALLBACK = {
  workflowhead: 'wfflowid', documentfeed: 'feedguid', feedaction: 'actionguid',
  hashtags: 'hstgguid', objhistory: 'objhistguid', translations: 'guid',
  Kundenakte: 'Kundennr', masklines: 'maskno, mlineno', workflowhistory: 'wfhistguid',
  hashtagrelations: 'hashtagguid, actionguid', replsetnames: 'rsid', mapdomain: 'domainid',
};

// ---------------------------------------------------------------------------
// Build entities
// ---------------------------------------------------------------------------
const entities = {};
for (const [t, def] of Object.entries(schema)) {
  const colNames = def.columns.map((c) => c.name);
  let pk = def.pk.length ? def.pk.join(', ') : (PK_FALLBACK[t] || '');
  if (!pk) {
    const g = colNames.find((n) => /guid$/.test(n)) || colNames.find((n) => /id$/.test(n));
    pk = g || colNames[0];
  }
  let display = DISPLAY[t];
  if (!display) {
    const cand = def.columns.find((c) => /character|text/.test(c.type) && /(name|bez|short|desc|label|title|text|entry)/i.test(c.name));
    display = cand ? cand.name : (def.columns.find((c) => /character|text/.test(c.type)) || { name: pk.split(',')[0].trim() }).name;
  }
  const description = DESC[t] || famDesc(t) || `ELO internal table "${t}".`;
  const columns = {};
  for (const c of def.columns) {
    columns[c.name] = {
      type: c.type,
      label: prettify(c.name),
      pk: def.pk.includes(c.name),
      nullable: c.nullable,
      searchable: isSearchable(c),
    };
  }
  entities[t] = { table: t, pk, displayField: display, description, columns, relations: {} };
}

// ---------------------------------------------------------------------------
// Relations + relationships array
// ---------------------------------------------------------------------------
const relationships = [];
for (const [child, fk, parent, pkCol, label, opts = {}] of REL) {
  relationships.push({
    from: { table: child, column: fk },
    to: { table: parent, column: pkCol },
    type: opts.one ? 'ONE_TO_ONE' : 'MANY_TO_ONE',
    confidence: 'inferred',
    label,
  });
  if (!entities[child].relations[parent]) {
    entities[child].relations[parent] = {
      type: opts.one ? 'hasOne' : 'belongsTo',
      foreignKey: fk,
      localKey: pkCol,
      label: `${child} → ${parent}: ${label}`,
    };
  }
  if (child !== parent && !entities[parent].relations[child]) {
    entities[parent].relations[child] = {
      type: 'hasMany',
      foreignKey: fk,
      localKey: pkCol,
      label: `${parent} has many ${child} (via ${fk})`,
    };
  }
}

// ---------------------------------------------------------------------------
// Smart templates
// ---------------------------------------------------------------------------
const smartTemplates = [
  {
    id: 'repo-folder-children', label: 'Repository: folder contents',
    description: 'Children of a folder with mask and object type names (3-table join).',
    category: 'Overview',
    sql: "SELECT o.objid, o.objshort AS name, m.maskname, s.name AS object_type, o.objtstamp\nFROM objekte o\nLEFT JOIN docmasks m ON m.maskno = o.objmask\nLEFT JOIN sordtype s ON s.id = o.objtype\nWHERE o.objparent = :parent_id AND o.deletedate = 0\nORDER BY o.objshort\nLIMIT 200",
    params: [{ name: 'parent_id', type: 'number', label: 'Parent object ID', default: 1 }],
  },
  {
    id: 'object-index-search', label: 'Search index values',
    description: "Full metadata search across all index fields — replace 'example' with your term.",
    category: 'Lookups',
    sql: "SELECT o.objid, o.objshort, k.okeyname AS field, k.okeydata AS value, m.maskname\nFROM objkeys k\nJOIN objekte o ON o.objid = k.parentid\nLEFT JOIN docmasks m ON m.maskno = o.objmask\nWHERE k.okeydata ILIKE '%example%'\nLIMIT 100",
    params: [],
  },
  {
    id: 'objects-per-mask', label: 'Objects per mask',
    description: 'How many live objects are filed with each metadata mask.',
    category: 'Aggregate',
    sql: 'SELECT m.maskno, m.maskname, COUNT(o.objid) AS objects\nFROM docmasks m\nLEFT JOIN objekte o ON o.objmask = m.maskno AND o.deletedate = 0\nGROUP BY m.maskno, m.maskname\nORDER BY objects DESC',
    params: [],
  },
  {
    id: 'document-version-history', label: 'Document version history',
    description: 'All file versions of one object with size and extension (objekte + dochistory + elodmdocs).',
    category: 'Audit',
    sql: 'SELECT o.objid, o.objshort, h.histversion, h.histcomment, d.ext, d.docsize, h.histid\nFROM dochistory h\nJOIN objekte o ON o.objid = h.objectid\nJOIN elodmdocs d ON d.docid = h.documentid\nWHERE h.objectid = :objid\nORDER BY h.histid DESC',
    params: [{ name: 'objid', type: 'number', label: 'Object ID' }],
  },
  {
    id: 'largest-documents', label: 'Largest documents',
    description: 'Top 50 documents by file size with object name and mask (3-table join).',
    category: 'Reports',
    sql: 'SELECT o.objid, o.objshort, d.ext, d.docsize, ROUND(d.docsize / 1048576.0, 2) AS size_mb, m.maskname\nFROM elodmdocs d\nJOIN objekte o ON o.objdoc = d.docid\nLEFT JOIN docmasks m ON m.maskno = o.objmask\nORDER BY d.docsize DESC\nLIMIT 50',
    params: [],
  },
  {
    id: 'active-workflow-tasks', label: 'Active workflow tasks',
    description: 'Currently active workflow nodes with the archive object they run on (3-table join).',
    category: 'Overview',
    sql: 'SELECT w.wf_flowid, w.wf_flow_name, w.wf_nodeid, w.wf_name AS node_name, o.objid, o.objshort\nFROM workflowactivedoc w\nJOIN workflowhead h ON h.wfflowid = w.wf_flowid\nLEFT JOIN objekte o ON o.objid = w.wf_eloobjid\nWHERE w.wf_activate > 0 AND w.wf_terminate <= 0\nORDER BY w.wf_flowid DESC, w.wf_nodeid\nLIMIT 200',
    params: [],
  },
  {
    id: 'workflow-step-trail', label: 'Workflow step trail',
    description: 'Execution history (who did which node when) for one workflow instance.',
    category: 'Audit',
    sql: 'SELECT h.wfflowid, hist.wf_nodeid, hist.wf_username, hist.wf_activate, hist.wf_terminate\nFROM workflowhistory hist\nJOIN workflowhead h ON h.wfguid = hist.wfguid\nWHERE h.wfflowid = :flow_id\nORDER BY hist.wf_activate',
    params: [{ name: 'flow_id', type: 'number', label: 'Workflow ID' }],
  },
  {
    id: 'feed-recent-activity', label: 'Recent feed activity',
    description: 'Latest feed posts with the archive object they belong to (3-table join).',
    category: 'Overview',
    sql: 'SELECT f.createdateiso, f.actiontype, f.actiontext, o.objid, o.objshort\nFROM feedaction f\nJOIN documentfeed df ON df.feedguid = f.feedguid\nJOIN objekte o ON o.objguid = df.objguid\nORDER BY f.createdateiso DESC\nLIMIT 100',
    params: [],
  },
  {
    id: 'hashtag-usage', label: 'Hashtag usage',
    description: 'How often each hashtag is used in feed posts.',
    category: 'Aggregate',
    sql: 'SELECT t.hstgname, COUNT(r.actionguid) AS uses\nFROM hashtags t\nLEFT JOIN hashtagrelations r ON r.hashtagguid = t.hstgguid\nGROUP BY t.hstgname\nORDER BY uses DESC',
    params: [],
  },
  {
    id: 'audit-recent-actions', label: 'Audit: recent actions',
    description: 'Latest entries of the audit log (report) with object names where still resolvable.',
    category: 'Audit',
    sql: 'SELECT r.reportid, r.acttime, r.actionno, r.userid, o.objshort, r.addtext\nFROM report r\nLEFT JOIN objekte o ON o.objid = r.docid\nORDER BY r.reportid DESC\nLIMIT 200',
    params: [],
  },
  {
    id: 'object-metadata-audit', label: 'Object metadata changes',
    description: 'Who changed which index values of one object (objekte + objhistory + objhistkeys).',
    category: 'Audit',
    sql: 'SELECT o.objid, o.objshort, h.objhistts AS changed_at, h.username, k.okeyname AS field, k.okeydata AS value\nFROM objhistory h\nJOIN objekte o ON o.objguid = h.objguid\nJOIN objhistkeys k ON k.objhistguid = h.objhistguid\nWHERE o.objid = :objid\nORDER BY h.objhistts DESC\nLIMIT 300',
    params: [{ name: 'objid', type: 'number', label: 'Object ID' }],
  },
  {
    id: 'soft-deleted-objects', label: 'Soft-deleted objects',
    description: 'Objects marked as deleted (deletedate <> 0) but not yet physically purged.',
    category: 'Audit',
    sql: 'SELECT o.objid, o.objshort, o.deletedate, o.deleteuser, m.maskname\nFROM objekte o\nLEFT JOIN docmasks m ON m.maskno = o.objmask\nWHERE o.deletedate <> 0\nORDER BY o.deletedate DESC\nLIMIT 200',
    params: [],
  },
  {
    id: 'customer-files', label: 'Customer aspect data',
    description: 'Customer name/number aspect rows with their archive object and mask (3-table join).',
    category: 'Lookups',
    sql: 'SELECT a.i_customer_number, a.i_customer_name, o.objid, o.objshort, m.maskname\nFROM asp_3 a\nJOIN objekte o ON o.objid = a.objid\nLEFT JOIN docmasks m ON m.maskno = o.objmask\nORDER BY a.i_customer_number\nLIMIT 200',
    params: [],
  },
  {
    id: 'mask-structure', label: 'Mask field structure',
    description: 'Index field definitions of one metadata mask.',
    category: 'Lookups',
    sql: 'SELECT ml.mlineno, ml.linebez AS field_label, ml.linekey AS group_key, ml.linetype, ml.linemin, ml.linemax, ml.linedefault\nFROM masklines ml\nWHERE ml.maskno = :maskno\nORDER BY ml.mlineno',
    params: [{ name: 'maskno', type: 'select', label: 'Mask', source: 'docmasks.maskno', displaySource: 'docmasks.maskname' }],
  },
  {
    id: 'keyword-lists', label: 'Keyword lists',
    description: 'All keyword list groups with their entries.',
    category: 'Lookups',
    sql: 'SELECT g.swlgroupid, s.orderid, s.entry\nFROM swlgrp g\nJOIN swl s ON s.groupid = g.swlgroupid\nORDER BY g.swlgroupid, s.orderid\nLIMIT 500',
    params: [],
  },
  {
    id: 'po-lines-by-company', label: 'PO lines by company',
    description: 'Purchase order lines with vendor, company and currency names (4-table join, dictionary dropdown).',
    category: 'Join',
    sql: 'SELECT pl.purchase_order_no, pl.line_no, pl.item_description, pl.quantity, pl.unit_price, pl.line_amount, COALESCE(fx.currency_symbol, pl.currency_code) AS currency, v.name AS vendor_name, co.name AS company_name\nFROM sol_invoice_po_line pl\nJOIN sol_vendor v ON v.company_code = pl.company_code AND v.no = pl.vendor_no\nJOIN sol_company co ON co.code = pl.company_code\nLEFT JOIN sol_common_fx fx ON fx.currency_code = pl.currency_code\nWHERE pl.company_code = :company_code\nORDER BY pl.purchase_order_no, pl.line_no',
    params: [{ name: 'company_code', type: 'select', label: 'Company', source: 'sol_company.code', displaySource: 'sol_company.name' }],
  },
  {
    id: 'vendor-directory', label: 'Vendor directory',
    description: 'Vendors of one company with bank and tax data.',
    category: 'Lookups',
    sql: 'SELECT v.no, v.name, v.street, v.zipcode, v.city, v.country_code, v.iban, v.vat_id, v.due_days\nFROM sol_vendor v\nWHERE v.company_code = :company_code\nORDER BY v.name',
    params: [{ name: 'company_code', type: 'select', label: 'Company', source: 'sol_company.code', displaySource: 'sol_company.name' }],
  },
  {
    id: 'fx-rate-history', label: 'FX rate history',
    description: 'Exchange-rate history of one currency (newest first).',
    category: 'Reports',
    sql: 'SELECT h.time, h.currency_code, h.currency_exchange_rate, h.base_currency_code, fx.currency_description\nFROM sol_common_fx_history h\nJOIN sol_common_fx fx ON fx.currency_code = h.currency_code\nWHERE h.currency_code = :currency_code\nORDER BY h.time DESC\nLIMIT 500',
    params: [{ name: 'currency_code', type: 'select', label: 'Currency', source: 'sol_common_fx.currency_code', displaySource: 'sol_common_fx.currency_description' }],
  },
  {
    id: 'kundenakte-search', label: 'Search Kundenakte',
    description: "Find customers by number, name or address — replace 'example' with your term.",
    category: 'Lookups',
    sql: 'SELECT "Kundennr", "Kundenname", "Adresse", "Plz", "Ort"\nFROM "Kundenakte"\nWHERE "Kundennr" ILIKE \'%example%\'\n   OR "Kundenname" ILIKE \'%example%\'\n   OR "Adresse" ILIKE \'%example%\'\nLIMIT 50',
    params: [],
  },
];

// ---------------------------------------------------------------------------
// Mermaid diagram
// ---------------------------------------------------------------------------
const attrBlocks = {
  objekte: ['integer objid PK', 'varchar objshort', 'integer objparent FK', 'integer objmask FK', 'integer objtype FK', 'integer objdoc FK', 'varchar objguid', 'integer deletedate'],
  objkeys: ['integer parentid PK_FK', 'integer okeyno PK', 'varchar okeyname', 'varchar okeydata'],
  docmasks: ['integer maskno PK', 'varchar maskname'],
  masklines: ['integer maskno FK', 'integer mlineno', 'varchar linebez'],
  elodmdocs: ['integer docid PK', 'bigint docsize', 'varchar ext', 'integer pathid FK'],
  elodmpath: ['integer pathid PK', 'varchar pathname'],
  dochistory: ['integer objectid PK_FK', 'integer documentid PK_FK', 'varchar histversion'],
  workflowhead: ['integer wfflowid PK', 'varchar wfguid', 'integer wftype', 'integer wfparent FK'],
  workflowactivedoc: ['integer wf_flowid PK_FK', 'integer wf_nodeid PK', 'varchar wf_flow_name', 'integer wf_eloobjid FK'],
  workflowcompletiondoc: ['integer wf_flowid PK_FK', 'integer wf_nodeid PK', 'integer wf_eloobjid FK'],
  workflowhistory: ['varchar wfguid FK', 'integer wf_nodeid', 'varchar wf_username'],
  documentfeed: ['varchar feedguid PK', 'varchar objguid FK'],
  feedaction: ['varchar actionguid PK', 'varchar feedguid FK', 'varchar parentguid FK', 'varchar actiontext'],
  hashtags: ['varchar hstgguid PK', 'varchar hstgname'],
  hashtagrelations: ['varchar hashtagguid FK', 'varchar actionguid FK'],
  sordtype: ['integer id PK', 'varchar name'],
  sol_company: ['varchar code PK', 'varchar name', 'varchar standard_currency_code FK'],
  sol_vendor: ['varchar company_code PK_FK', 'varchar no PK', 'varchar name'],
  sol_invoice_po_line: ['varchar company_code PK_FK', 'varchar vendor_no PK_FK', 'varchar purchase_order_no PK', 'varchar line_no PK'],
  sol_common_fx: ['varchar currency_code PK', 'varchar currency_description'],
  sol_common_fx_history: ['varchar currency_code PK_FK', 'varchar time PK', 'varchar base_currency_code FK'],
};
let mer = 'erDiagram\n';
const inDiagram = new Set();
for (const r of relationships) {
  const child = r.from.table, parent = r.to.table;
  inDiagram.add(child); inDiagram.add(parent);
  const card = r.type === 'ONE_TO_ONE' ? '||--o|' : '||--o{';
  const lbl = r.from.column.replace(/"/g, '');
  mer += `  ${parent} ${card} ${child} : "${lbl}"\n`;
}
mer += '\n';
for (const [t, attrs] of Object.entries(attrBlocks)) {
  mer += `  ${t} {\n` + attrs.map((a) => `    ${a}`).join('\n') + '\n  }\n';
}
// standalone tables (no confirmed relationship) — declared with one column
for (const t of Object.keys(schema).sort()) {
  if (inDiagram.has(t) || attrBlocks[t]) continue;
  const c0 = schema[t].columns[0];
  const typ = c0.type.replace(/\(.*\)/, '').replace(/\s+/g, '_');
  mer += `  ${t} {\n    ${typ} ${c0.name}\n  }\n`;
}

// ---------------------------------------------------------------------------
const out = {
  version: '1.0',
  generatedAt: new Date().toISOString(),
  connection: { type: 'postgresql', host: '172.25.83.98', port: 5432, database: 'Contelo' },
  entities,
  relationships,
  smartTemplates,
  diagram: { mermaid: mer },
};
fs.writeFileSync('contelo_smart_queries.json', JSON.stringify(out, null, 2));
fs.writeFileSync('contelo-er.mmd', mer);
console.log('entities:', Object.keys(entities).length,
  '| relationships:', relationships.length,
  '| templates:', smartTemplates.length,
  '| mermaid chars:', mer.length);
// sanity: unique template ids
const ids = smartTemplates.map((t) => t.id);
if (new Set(ids).size !== ids.length) { console.error('DUPLICATE TEMPLATE IDS'); process.exit(1); }
// sanity: params match :names in sql
for (const t of smartTemplates) {
  const used = [...t.sql.matchAll(/:([a-z_]+)/g)].map((m) => m[1]);
  const declared = t.params.map((p) => p.name);
  for (const u of used) if (!declared.includes(u)) { console.error(`template ${t.id}: param :${u} not declared`); process.exit(1); }
  for (const d of declared) if (!used.includes(d)) { console.error(`template ${t.id}: declared param ${d} unused`); process.exit(1); }
}
console.log('sanity checks OK');
