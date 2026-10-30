function cleanUnsubstituted(sql, strict) {
  if (strict === undefined) strict = true;
  var UNSUB = strict
    ? /:[a-zA-Z_]\w*|(?:ILIKE|LIKE)\s*'%%'/i
    : /:[a-zA-Z_]\w*|(?:ILIKE|LIKE)\s*'%(?:[a-zA-Z_]\w*)?%'/i;
  if (!UNSUB.test(sql)) return '(unchanged) ' + sql;

  var depth = 0, wi = -1;
  for (var i = 0; i < sql.length; i++) {
    if (sql[i] === '(') { depth++; continue; }
    if (sql[i] === ')') { depth--; continue; }
    if (depth === 0 && /^WHERE\b/i.test(sql.slice(i))) { wi = i; break; }
  }
  if (wi === -1) return sql;

  depth = 0;
  var sfx = sql.length;
  for (var i = wi + 5; i < sql.length; i++) {
    if (sql[i] === '(') { depth++; continue; }
    if (sql[i] === ')') { depth--; continue; }
    if (depth === 0 && /^\b(?:ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET)\b/i.test(sql.slice(i))) { sfx = i; break; }
  }

  var before     = sql.slice(0, wi);
  var whereBlock = sql.slice(wi, sfx);
  var suffix     = sql.slice(sfx);
  var lines   = whereBlock.split('\n');
  var cleaned = lines.filter(function(line) { return !UNSUB.test(line); });
  var result  = cleaned.join('\n').trim();

  if (result && !/^WHERE\b/i.test(result)) {
    result = 'WHERE ' + result.replace(/^\s*(?:AND|OR)\s+/i, '');
  }
  result = result.replace(/^(WHERE\s+(?:\n\s*)?)((?:OR|AND)\s+)+/i, '$1');
  result = result.replace(/^WHERE\s*\n\s*(?:OR|AND)\s+/i, 'WHERE ');
  result = result.replace(/\s+(?:OR|AND)\s*$/i, '');

  if (/^WHERE\s*$/i.test(result) || !result) {
    return (before.trimEnd() + (suffix.trim() ? ' ' + suffix.trimStart() : '')).trim();
  }
  return (before + result + (suffix ? '\n' + suffix : '')).trim();
}

var tests = [
  {
    name: 'active-workflows (fixed WHERE wfstatus=1)',
    sql: 'SELECT * FROM workflowhead wh\nWHERE wh.wfstatus = 1\nORDER BY wh.wftstamp',
    strict: false
  },
  {
    name: 'vendor-search (all ILIKE %searchterm%)',
    sql: "SELECT * FROM sol_vendor\nWHERE name ILIKE '%searchterm%'\n   OR city ILIKE '%searchterm%'\nORDER BY name",
    strict: false
  },
  {
    name: 'document-search (ILIKE searchterm + fixed AND objstatus=0)',
    sql: "SELECT o.objid FROM objekte o\nWHERE o.objshort ILIKE '%searchterm%'\n  AND o.objstatus = 0\nORDER BY o.objxdate DESC",
    strict: false
  },
  {
    name: 'vendor-list after substituting :company_code -> ABC (strict=true)',
    sql: "SELECT * FROM sol_vendor v WHERE v.company_code = 'ABC' ORDER BY v.name",
    strict: true
  },
  {
    name: 'vendor-list unsubstituted :company_code (strict=true, should remove)',
    sql: 'SELECT * FROM sol_vendor v WHERE v.company_code = :company_code ORDER BY v.name',
    strict: true
  },
  {
    name: 'workflow-completion (fixed WHERE wfstatus=0, no params)',
    sql: 'SELECT * FROM workflowhead wh\nWHERE wh.wfstatus = 0\nGROUP BY wh.wfflowid\nORDER BY wh.wftstamp DESC',
    strict: false
  },
];

tests.forEach(function(t) {
  var result = cleanUnsubstituted(t.sql, t.strict);
  console.log('TEST: ' + t.name);
  console.log('  ==> ' + result.replace(/\n/g, ' | '));
  console.log();
});

// Mirrors DB._buildCountSql in web/public/index.html
function buildCountSql(sql) {
  var s = cleanUnsubstituted(sql.trim(), false).replace(/^\(unchanged\) /, '');
  s = s.replace(/:([a-zA-Z_]\w*)/g, 'NULL');
  s = s.replace(/\bORDER\s+BY\b[\s\S]*$/i, '').trim();
  s = s.replace(/\bLIMIT\s+\d+(\s*,\s*\d+)?\b/gi, '').replace(/\bOFFSET\s+\d+\b/gi, '').trim();
  return 'SELECT COUNT(*) AS __cnt FROM (' + s + ') AS __csub';
}

var countTests = [
  {
    name: 'count: active-workflows keeps fixed WHERE wfstatus=1',
    sql: 'SELECT wh.wfflowid FROM workflowhead wh\nJOIN workflowactivedoc wa ON wa.wf_flowid = wh.wfflowid\nWHERE wh.wfstatus = 1\nORDER BY wa.wf_duedate ASC\nLIMIT 200'
  },
  {
    name: 'count: vendor-list (lookup :company_code) drops WHERE',
    sql: 'SELECT v.no, v.name FROM sol_vendor v\nJOIN sol_company c ON c.code = v.company_code\nWHERE v.company_code = :company_code\nORDER BY v.name'
  },
  {
    name: 'count: document-search drops ILIKE, keeps objstatus=0',
    sql: "SELECT o.objid FROM objekte o\nWHERE o.objshort ILIKE '%searchterm%'\n  AND o.objstatus = 0\nORDER BY o.objxdate DESC\nLIMIT 500"
  },
  {
    name: 'count: GROUP BY preserved',
    sql: 'SELECT dm.maskno, COUNT(ml.maskno) AS cnt FROM docmasks dm\nLEFT JOIN masklines ml ON ml.maskno = dm.maskno\nGROUP BY dm.maskno\nORDER BY dm.maskno'
  },
];

countTests.forEach(function(t) {
  console.log('TEST: ' + t.name);
  console.log('  ==> ' + buildCountSql(t.sql).replace(/\n/g, ' | '));
  console.log();
});

// Mirrors DB._parseSelectFields in web/public/index.html
function parseSelectFields(sql) {
  var m = (sql || '').match(/SELECT\s+(?:DISTINCT\s+)?([\s\S]+?)\s+FROM\b/i);
  if (!m) return [];
  var parts = [], depth = 0, cur = '';
  for (var i = 0; i < m[1].length; i++) {
    var ch = m[1][i];
    if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')') { depth--; cur += ch; }
    else if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean).map(function(part) {
    var am = part.match(/^([\s\S]+?)\s+AS\s+(?:"([^"]+)"|(\w+))\s*$/i);
    var expr = (am ? am[1] : part).trim();
    var col = expr.split('.').pop().replace(/"/g, '');
    var alias = am ? (am[2] || am[3]) : col;
    var complex = /[(*]/.test(expr) || /\bCASE\b/i.test(expr);
    return { expr: expr, alias: alias, col: col, complex: complex };
  });
}

// Mirrors DB._buildTplDistinctSql in web/public/index.html
function buildTplDistinctSql(tplSql, keyExpr, dispExpr) {
  var s = cleanUnsubstituted((tplSql || '').trim(), false).replace(/^\(unchanged\) /, '');
  s = s.replace(/:([a-zA-Z_]\w*)/g, 'NULL');
  s = s.replace(/\bORDER\s+BY\b[\s\S]*$/i, '').trim();
  s = s.replace(/\bGROUP\s+BY\b[\s\S]*$/i, '').trim();
  s = s.replace(/\bLIMIT\s+\d+(\s*,\s*\d+)?\b/gi, '').replace(/\bOFFSET\s+\d+\b/gi, '').trim();
  var depth = 0, fi = -1;
  for (var i = 0; i < s.length; i++) {
    if (s[i] === '(') { depth++; continue; }
    if (s[i] === ')') { depth--; continue; }
    if (depth === 0 && (i === 0 || !/\w/.test(s[i - 1])) && /^FROM\b/i.test(s.slice(i))) { fi = i; break; }
  }
  if (fi === -1) return null;
  return 'SELECT DISTINCT ' + keyExpr + ' AS __k, ' + dispExpr + ' AS __d\n' + s.slice(fi) + '\nORDER BY 2 LIMIT 300';
}

var DICT_KW = ['desc', 'detail', 'value', 'name', 'label', 'title', 'comment', 'text', 'info', 'bezeichnung'];
function isDictCol(f) {
  return !!f && !f.complex && DICT_KW.some(function(kw) {
    return f.alias.toLowerCase().includes(kw) || f.col.toLowerCase().includes(kw);
  });
}

var autoLbTests = [
  {
    name: 'auto-lb: company list (code + name) → tpl mode, key c.code, disp c.name',
    sql: 'SELECT c.code AS "Company Code", c.name AS "Company", c.country_code AS "Country"\nFROM sol_company c\nLEFT JOIN sol_common_fx fx ON fx.currency_code = c.standard_currency_code\nORDER BY c.code'
  },
  {
    name: 'auto-lb: masks (maskno + maskname) → tpl mode',
    sql: 'SELECT dm.maskno AS "Mask No.", dm.maskname AS "Mask Name", dm.maskstatus AS "Status"\nFROM docmasks dm\nORDER BY dm.maskname'
  },
  {
    name: 'auto-lb: vendor lookup (company_code + no) → 2nd field not dict → table fallback',
    sql: 'SELECT v.company_code, v.no AS "Vendor No.", v.name AS "Vendor"\nFROM sol_vendor v\nWHERE v.company_code = :company_code\nORDER BY v.name'
  },
  {
    name: 'auto-lb: aggregate 1st field (COUNT) → complex → table fallback',
    sql: 'SELECT COUNT(*) AS "Total", dm.maskname AS "Mask Name"\nFROM docmasks dm\nGROUP BY dm.maskname'
  },
  {
    name: 'auto-lb: fixed WHERE kept in distinct (workflows: flowid + flow name)',
    sql: 'SELECT wh.wfflowid AS "Flow ID", wa.wf_flow_name AS "Workflow"\nFROM workflowhead wh\nJOIN workflowactivedoc wa ON wa.wf_flowid = wh.wfflowid\nWHERE wh.wfstatus = 1\nORDER BY wa.wf_duedate ASC\nLIMIT 200'
  },
];

autoLbTests.forEach(function(t) {
  var fields = parseSelectFields(t.sql);
  var f1 = fields[0], f2 = fields[1];
  console.log('TEST: ' + t.name);
  if (f1 && !f1.complex && isDictCol(f2)) {
    console.log('  mode=tpl  key=' + f1.expr + '  disp=' + f2.expr + '  label="' + f1.alias + ' / ' + f2.alias + '"');
    console.log('  ==> ' + buildTplDistinctSql(t.sql, f1.expr, f2.expr).replace(/\n/g, ' | '));
  } else {
    console.log('  mode=table fallback (f1.complex=' + (f1 ? f1.complex : 'n/a') + ', f2 dict=' + isDictCol(f2) + ')');
  }
  console.log();
});
