const pool = require('../src/config/database');

async function migrate() {
  const [cols] = await pool.query('SHOW COLUMNS FROM tbahan');
  const colNames = cols.map(c => c.Field);
  console.log('Current columns count:', colNames.length);

  const queries = [];
  if (!colNames.includes('bhn_divisi')) {
    queries.push("ALTER TABLE tbahan ADD COLUMN bhn_divisi VARCHAR(20) NOT NULL DEFAULT 'GARMEN' AFTER Bhn_kode");
  }
  if (!colNames.includes('bhn_ktg_kode')) {
    queries.push("ALTER TABLE tbahan ADD COLUMN bhn_ktg_kode VARCHAR(20) NULL DEFAULT NULL AFTER bhn_divisi");
  }
  if (!colNames.includes('bhn_gdg_default')) {
    queries.push("ALTER TABLE tbahan ADD COLUMN bhn_gdg_default VARCHAR(20) NULL DEFAULT 'WH-16' AFTER bhn_ktg_kode");
  }
  if (!colNames.includes('bhn_sup_kode')) {
    queries.push("ALTER TABLE tbahan ADD COLUMN bhn_sup_kode VARCHAR(20) NULL DEFAULT NULL AFTER bhn_gdg_default");
  }
  if (!colNames.includes('bhn_hrgjual')) {
    queries.push("ALTER TABLE tbahan ADD COLUMN bhn_hrgjual DECIMAL(15,2) NULL DEFAULT 0 AFTER Bhn_hargabeli");
  }
  if (!colNames.includes('bhn_isstok')) {
    queries.push("ALTER TABLE tbahan ADD COLUMN bhn_isstok TINYINT(1) NOT NULL DEFAULT 1 AFTER bhn_aktif");
  }
  if (!colNames.includes('bhn_isexpired')) {
    queries.push("ALTER TABLE tbahan ADD COLUMN bhn_isexpired TINYINT(1) NOT NULL DEFAULT 0 AFTER bhn_isstok");
  }

  for (const q of queries) {
    console.log('Running:', q);
    await pool.query(q);
  }

  // Widen Bhn_jb_kode if char(2)
  const jbCol = cols.find(c => c.Field === 'Bhn_jb_kode');
  if (jbCol && jbCol.Type.toLowerCase().startsWith('char(2)')) {
    console.log('Widening Bhn_jb_kode to VARCHAR(10)');
    await pool.query("ALTER TABLE tbahan MODIFY COLUMN Bhn_jb_kode VARCHAR(10) NOT NULL DEFAULT ''");
  }

  // Update existing tbahan bhn_divisi based on prefix 'SB'
  const [upd] = await pool.query("UPDATE tbahan SET bhn_divisi = IF(LEFT(Bhn_kode, 2) = 'SB', 'SPANDUK', 'GARMEN')");
  console.log('Updated existing rows:', upd.affectedRows);

  const [verify] = await pool.query('SELECT bhn_divisi, count(*) as c FROM tbahan GROUP BY bhn_divisi');
  console.log('tbahan divisions:', verify);

  pool.end();
}

migrate().catch(e => {
  console.error(e);
  pool.end();
});
