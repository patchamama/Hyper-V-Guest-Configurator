// Execute every smartTemplate against the live DB with sample param values.
const { Client } = require('pg');
const j = require('./contelo_smart_queries.json');
const SAMPLE = { parent_id: 1, objid: 261301, flow_id: 4604, maskno: 0, company_code: null, currency_code: null };

(async () => {
  const c = new Client({ host: '172.25.83.98', port: 5432, database: 'Contelo', user: 'elodb', password: 'elodb' });
  await c.connect();
  // fetch sample dictionary values
  SAMPLE.company_code = (await c.query('SELECT code FROM sol_company LIMIT 1')).rows[0].code;
  SAMPLE.currency_code = (await c.query('SELECT currency_code FROM sol_common_fx LIMIT 1')).rows[0].currency_code;
  SAMPLE.maskno = (await c.query('SELECT maskno FROM docmasks ORDER BY maskno LIMIT 1')).rows[0].maskno;
  SAMPLE.objid = (await c.query('SELECT objectid FROM dochistory LIMIT 1')).rows[0].objectid;
  SAMPLE.flow_id = (await c.query('SELECT wfflowid FROM workflowhead LIMIT 1')).rows[0].wfflowid;
  let fail = 0;
  for (const t of j.smartTemplates) {
    let sql = t.sql;
    for (const p of t.params) {
      const v = SAMPLE[p.name];
      sql = sql.replace(new RegExp(':' + p.name + '\\b', 'g'), typeof v === 'number' ? v : `'${v}'`);
    }
    try {
      const r = await c.query(sql);
      console.log(`OK   ${t.id} (${r.rowCount} rows)`);
    } catch (e) {
      console.log(`FAIL ${t.id}: ${e.message}`);
      fail++;
    }
  }
  await c.end();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
