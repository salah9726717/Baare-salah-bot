const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (user_id BIGINT PRIMARY KEY, username TEXT, first_name TEXT, last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), searches BIGINT NOT NULL DEFAULT 0)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS content (id BIGSERIAL PRIMARY KEY, channel_id BIGINT NOT NULL, message_id BIGINT NOT NULL, file_id TEXT, media_type TEXT NOT NULL DEFAULT 'text', title TEXT NOT NULL, normalized_title TEXT NOT NULL, content_type TEXT NOT NULL DEFAULT 'film', season TEXT, episode TEXT, description TEXT NOT NULL DEFAULT '', keywords TEXT[] NOT NULL DEFAULT '{}', caption TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(channel_id, message_id))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS content_title_idx ON content USING GIN (to_tsvector('simple', normalized_title))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS content_type_title_idx ON content(content_type, normalized_title)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS searches (id BIGSERIAL PRIMARY KEY, user_id BIGINT, query TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
}
function normalize(s='') { return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim(); }
async function upsertContent({channelId, messageId, fileId, mediaType, parsed, caption}) {
  const title = parsed.title || caption.split(/\r?\n/)[0]?.slice(0,180) || 'Untitled';
  const normalizedTitle = normalize([title, ...parsed.keywords].join(' '));
  await pool.query(`INSERT INTO content(channel_id,message_id,file_id,media_type,title,normalized_title,content_type,season,episode,description,keywords,caption)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(channel_id,message_id) DO UPDATE SET file_id=EXCLUDED.file_id,media_type=EXCLUDED.media_type,title=EXCLUDED.title,normalized_title=EXCLUDED.normalized_title,content_type=EXCLUDED.content_type,season=EXCLUDED.season,episode=EXCLUDED.episode,description=EXCLUDED.description,keywords=EXCLUDED.keywords,caption=EXCLUDED.caption`,
    [channelId,messageId,fileId,mediaType,title,normalizedTitle,parsed.type,parsed.season,parsed.episode,parsed.description,parsed.keywords,caption]);
}
async function searchContent(query) {
  const q = normalize(query);
  if (!q) return [];
  const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const { rows } = await pool.query(`SELECT * FROM content WHERE normalized_title ILIKE $1 OR EXISTS (SELECT 1 FROM unnest(keywords) k WHERE lower(k) ILIKE $1) OR lower(caption) ILIKE $1 ORDER BY CASE WHEN normalized_title=$2 THEN 0 WHEN normalized_title LIKE $3 THEN 1 ELSE 2 END, title, season NULLS FIRST, episode NULLS FIRST LIMIT 30`, [pattern,q,`${q}%`]);
  return rows;
}
async function saveUser(from) {
  await pool.query(`INSERT INTO users(user_id,username,first_name,last_seen) VALUES($1,$2,$3,NOW()) ON CONFLICT(user_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,last_seen=NOW()`, [from.id,from.username || null,from.first_name || '']);
}
async function logSearch(userId, query) {
  await pool.query('INSERT INTO searches(user_id,query) VALUES($1,$2)',[userId,query]);
  await pool.query('UPDATE users SET searches=searches+1,last_seen=NOW() WHERE user_id=$1',[userId]);
}
async function stats() {
  const [users, files, searches, today] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS n FROM users'), pool.query('SELECT COUNT(*)::int AS n FROM content'),
    pool.query('SELECT COUNT(*)::int AS n FROM searches'), pool.query('SELECT COUNT(*)::int AS n FROM searches WHERE created_at >= CURRENT_DATE')
  ]);
  return { users:users.rows[0].n, files:files.rows[0].n, searches:searches.rows[0].n, today:today.rows[0].n };
}
async function getUsers() { const { rows } = await pool.query('SELECT user_id FROM users ORDER BY user_id'); return rows.map(r => String(r.user_id)); }
module.exports = { pool, initDb, normalize, upsertContent, searchContent, saveUser, logSearch, stats, getUsers };
