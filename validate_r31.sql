SELECT 'R31_wfhist_wfguid' AS rel,
  COUNT(*) FILTER (WHERE wfguid IS NOT NULL) AS non_null,
  COUNT(*) FILTER (WHERE wfguid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workflowhead WHERE wfguid = workflowhistory.wfguid)) AS orphans
FROM workflowhistory;

SELECT 'R32_hashtagrel_actionguid' AS rel,
  COUNT(*) FILTER (WHERE actionguid IS NOT NULL) AS non_null,
  COUNT(*) FILTER (WHERE actionguid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM feedaction WHERE actionguid = hashtagrelations.actionguid)) AS orphans
FROM hashtagrelations;

SELECT 'R33_invitem_vendor' AS rel,
  COUNT(*) FILTER (WHERE vendor_no IS NOT NULL) AS non_null,
  COUNT(*) FILTER (WHERE vendor_no IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sol_vendor WHERE company_code = sol_invoice_item.company_code AND "no" = sol_invoice_item.vendor_no
  )) AS orphans
FROM sol_invoice_item;

SELECT 'R34_invpoline_vendor' AS rel,
  COUNT(*) FILTER (WHERE vendor_no IS NOT NULL) AS non_null,
  COUNT(*) FILTER (WHERE vendor_no IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sol_vendor WHERE company_code = sol_invoice_po_line.company_code AND "no" = sol_invoice_po_line.vendor_no
  )) AS orphans
FROM sol_invoice_po_line;

SELECT 'R35_invpoline_costcenter' AS rel,
  COUNT(*) FILTER (WHERE cost_center_no IS NOT NULL) AS non_null,
  COUNT(*) FILTER (WHERE cost_center_no IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sol_accounting_costcenter WHERE company_code = sol_invoice_po_line.company_code AND "no" = sol_invoice_po_line.cost_center_no
  )) AS orphans
FROM sol_invoice_po_line;

SELECT 'R36_invpoline_glaccount' AS rel,
  COUNT(*) FILTER (WHERE gl_account_no IS NOT NULL) AS non_null,
  COUNT(*) FILTER (WHERE gl_account_no IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sol_accounting_gl_account WHERE company_code = sol_invoice_po_line.company_code AND "no" = sol_invoice_po_line.gl_account_no
  )) AS orphans
FROM sol_invoice_po_line;

SELECT 'R37_docmasks_sordtype' AS rel,
  COUNT(*) FILTER (WHERE sordtype IS NOT NULL) AS non_null,
  COUNT(*) FILTER (WHERE sordtype IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sordtype WHERE id = docmasks.sordtype)) AS orphans
FROM docmasks;

SELECT 'R38_objekte_objmask' AS rel,
  COUNT(*) FILTER (WHERE objmask IS NOT NULL) AS non_null,
  COUNT(*) FILTER (WHERE objmask IS NOT NULL AND NOT EXISTS (SELECT 1 FROM docmasks WHERE maskno = objekte.objmask)) AS orphans
FROM objekte LIMIT 1;
