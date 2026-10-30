const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '172.25.83.98', port: 5432, database: 'Contelo', user: 'elodb', password: 'elodb' });
  await c.connect();
  const run = async (label, sql) => {
    try { const r = await c.query(sql); console.log(label, JSON.stringify(r.rows.slice(0, 3))); }
    catch (e) { console.log(label, 'ERR', e.message); }
  };
  await run('subscription.watchguid->documentfeed.feedguid:',
    `SELECT COUNT(*) FILTER (WHERE ch.watchguid<>'') non_null, COUNT(*) FILTER (WHERE ch.watchguid<>'' AND p.feedguid IS NULL) orphans FROM subscription ch LEFT JOIN documentfeed p ON p.feedguid=ch.watchguid`);
  await run('notification.watchguid->documentfeed.feedguid:',
    `SELECT COUNT(*) FILTER (WHERE ch.watchguid<>'') non_null, COUNT(*) FILTER (WHERE ch.watchguid<>'' AND p.feedguid IS NULL) orphans FROM notification ch LEFT JOIN documentfeed p ON p.feedguid=ch.watchguid`);
  await run('feedactionhist.actionguid->feedaction:',
    `SELECT COUNT(*) FILTER (WHERE ch.actionguid<>'') non_null, COUNT(*) FILTER (WHERE ch.actionguid<>'' AND p.actionguid IS NULL) orphans FROM feedactionhist ch LEFT JOIN feedaction p ON p.actionguid=ch.actionguid`);
  await run('map_objekte sample mapid:', `SELECT mapid, mapkey FROM map_objekte LIMIT 3`);
  await run('map_objekte.mapid->objekte.objguid:',
    `SELECT COUNT(*) FILTER (WHERE ch.mapid<>'') non_null, COUNT(*) FILTER (WHERE ch.mapid<>'' AND p.objguid IS NULL) orphans FROM (SELECT DISTINCT mapid FROM map_objekte) ch LEFT JOIN objekte p ON p.objguid=ch.mapid`);
  await run('translations sample:', `SELECT trankey, lang1, lang2 FROM translations LIMIT 3`);
  await run('sordtype count:', `SELECT COUNT(*) n FROM sordtype`);
  await run('orphan objtype values:', `SELECT o.objtype, COUNT(*) FROM objekte o LEFT JOIN sordtype s ON s.id=o.objtype WHERE s.id IS NULL GROUP BY o.objtype ORDER BY 2 DESC LIMIT 5`);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
