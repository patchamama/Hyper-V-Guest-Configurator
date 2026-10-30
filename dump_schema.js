// Dump full schema of Contelo to schema_dump.json
const { Client } = require('pg');
const fs = require('fs');

(async () => {
  const c = new Client({ host: '172.25.83.98', port: 5432, database: 'Contelo', user: 'elodb', password: 'elodb' });
  await c.connect();

  const cols = await c.query(`
    SELECT table_name, column_name, data_type, character_maximum_length, is_nullable, ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position`);

  const pks = await c.query(`
    SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY tc.table_name, kcu.ordinal_position`);

  const fks = await c.query(`
    SELECT COUNT(*) AS n FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND constraint_type = 'FOREIGN KEY'`);

  const rows = await c.query(`
    SELECT relname AS table_name, n_live_tup AS approx_rows
    FROM pg_stat_user_tables WHERE schemaname = 'public'`);

  const tables = {};
  for (const r of cols.rows) {
    if (!tables[r.table_name]) tables[r.table_name] = { columns: [], pk: [], approxRows: 0 };
    let type = r.data_type;
    if (r.character_maximum_length) type += `(${r.character_maximum_length})`;
    tables[r.table_name].columns.push({ name: r.column_name, type, nullable: r.is_nullable === 'YES' });
  }
  for (const r of pks.rows) if (tables[r.table_name]) tables[r.table_name].pk.push(r.column_name);
  for (const r of rows.rows) if (tables[r.table_name]) tables[r.table_name].approxRows = Number(r.approx_rows);

  fs.writeFileSync('schema_dump.json', JSON.stringify({ declaredFKs: Number(fks.rows[0].n), tables }, null, 2));
  console.log('tables:', Object.keys(tables).length, '| declared FKs:', fks.rows[0].n);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
