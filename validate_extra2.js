const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '172.25.83.98', port: 5432, database: 'Contelo', user: 'elodb', password: 'elodb' });
  await c.connect();
  const run = async (label, sql) => {
    try { const r = await c.query(sql); console.log(label, JSON.stringify(r.rows.slice(0, 5))); }
    catch (e) { console.log(label, 'ERR', e.message); }
  };
  await run('map_objekte.mapid::int->objekte.objid:',
    `SELECT COUNT(*) non_null, COUNT(*) FILTER (WHERE p.objid IS NULL) orphans
     FROM (SELECT DISTINCT mapid FROM map_objekte WHERE mapid ~ '^[0-9]+$') ch
     LEFT JOIN objekte p ON p.objid = ch.mapid::int`);
  await run('map_formdata.mapid sample:', `SELECT DISTINCT mapid FROM map_formdata LIMIT 3`);
  await run('map_wfactive.mapid sample:', `SELECT DISTINCT mapid FROM map_wfactive LIMIT 3`);
  await run('map_wfactive.mapid::int->workflowhead.wfflowid:',
    `SELECT COUNT(*) non_null, COUNT(*) FILTER (WHERE p.wfflowid IS NULL) orphans
     FROM (SELECT DISTINCT mapid FROM map_wfactive WHERE mapid ~ '^[0-9]+$') ch
     LEFT JOIN workflowhead p ON p.wfflowid = ch.mapid::int`);
  await run('map_wffinished.mapid::int->workflowhead.wfflowid:',
    `SELECT COUNT(*) non_null, COUNT(*) FILTER (WHERE p.wfflowid IS NULL) orphans
     FROM (SELECT DISTINCT mapid FROM map_wffinished WHERE mapid ~ '^[0-9]+$') ch
     LEFT JOIN workflowhead p ON p.wfflowid = ch.mapid::int`);
  await run('maphead_objekte.mapid::int->objekte.objid:',
    `SELECT COUNT(*) non_null, COUNT(*) FILTER (WHERE p.objid IS NULL) orphans
     FROM (SELECT DISTINCT mapid FROM maphead_objekte WHERE mapid ~ '^[0-9]+$') ch
     LEFT JOIN objekte p ON p.objid = ch.mapid::int`);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
