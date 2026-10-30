const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '172.25.83.98', port: 5432, database: 'Contelo', user: 'elodb', password: 'elodb' });
  await c.connect();
  const r = await c.query(`
    SELECT COUNT(*) total,
           COUNT(*) FILTER (WHERE wf_activate > 0) activated,
           COUNT(*) FILTER (WHERE wf_terminate > 0) terminated,
           COUNT(*) FILTER (WHERE wf_is_next = 1) is_next,
           COUNT(*) FILTER (WHERE wf_in_use_date > 0) in_use
    FROM workflowactivedoc`);
  console.log(JSON.stringify(r.rows[0]));
  const r2 = await c.query(`SELECT wf_activate, wf_terminate, wf_is_next, wf_in_use_date FROM workflowactivedoc WHERE wf_nodeid > 0 LIMIT 5`);
  console.log(JSON.stringify(r2.rows));
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
