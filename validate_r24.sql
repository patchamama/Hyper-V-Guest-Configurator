SELECT 'R24' AS rel,
  COUNT(*) FILTER (WHERE TRIM(company_code) != '') AS non_null,
  COUNT(*) FILTER (WHERE TRIM(company_code) != '' AND NOT EXISTS (SELECT 1 FROM sol_company WHERE code = TRIM(k.company_code))) AS orphans
FROM "Kundenakte" k;
SELECT 'R25_swl_groupid' AS rel,
  COUNT(*) FILTER (WHERE groupid IS NOT NULL) AS non_null,
  COUNT(*) FILTER (WHERE groupid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM swlgrp WHERE swlgroupid = swl.groupid)) AS orphans
FROM swl;
SELECT 'R26_docmaskinherit' AS rel,
  COUNT(*) FILTER (WHERE parentmaskid IS NOT NULL) AS non_null,
  COUNT(*) FILTER (WHERE parentmaskid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM docmasks WHERE maskno = docmaskinherit.parentmaskid)) AS orphans
FROM docmaskinherit;
SELECT 'R27_actobj_actguid' AS rel,
  COUNT(*) FILTER (WHERE actguid IS NOT NULL) AS non_null,
  COUNT(*) FILTER (WHERE actguid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM activity WHERE actguid = activityobjekte.actguid)) AS orphans
FROM activityobjekte;
SELECT 'R28_asp3_objid' AS rel,
  COUNT(*) FILTER (WHERE objid IS NOT NULL) AS non_null,
  COUNT(*) FILTER (WHERE objid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM objekte WHERE objid = asp_3.objid)) AS orphans
FROM asp_3;
SELECT 'R29_objhist_objguid' AS rel,
  COUNT(*) FILTER (WHERE objguid IS NOT NULL) AS non_null,
  COUNT(*) FILTER (WHERE objguid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM objekte WHERE objguid = objhistory.objguid)) AS orphans
FROM objhistory;
SELECT 'R30_vendorterms' AS rel,
  COUNT(*) AS non_null,
  COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM sol_vendor WHERE company_code = vt.company_code AND "no" = vt.vendor_no)) AS orphans
FROM sol_vendor_terms_of_payment vt;
