require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { initDb, upsertContent, searchContent, saveUser, logSearch, stats, getUsers, pool } = require('./db');
const { parseCaption, mediaInfo } = require('./captions');

const required = ['BOT_TOKEN','DATABASE_URL','STORAGE_CHANNEL_ID'];
for (const key of required) if (!process.env[key]) { console.error(`Missing required environment variable: ${key}`); process.exit(1); }
const bot = new Telegraf(process.env.BOT_TOKEN);
const storageId = String(process.env.STORAGE_CHANNEL_ID);
const admins = new Set((process.env.ADMIN_IDS || '').split(',').map(x=>x.trim()).filter(Boolean));
const support = (process.env.SUPPORT_USERNAME || 'Baare_Salah').replace(/^@/,'');
const botUsername = (process.env.BOT_USERNAME || 'BaareSalahBot').replace(/^@/,'');
const pendingSearch = new Map();
const isAdmin = ctx => admins.has(String(ctx.from?.id));
const escapeHtml = s => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

async function indexChannelPost(msg) {
  if (String(msg.chat?.id) !== storageId) return;
  const caption = msg.caption || msg.text || '';
  const parsed = parseCaption(caption);
  const media = mediaInfo(msg);
  await upsertContent({channelId:msg.chat.id,messageId:msg.message_id,fileId:media.fileId,mediaType:media.mediaType,parsed,caption});
  console.log(`Indexed storage post ${msg.message_id}: ${parsed.title || 'untitled'}`);
}
bot.on('channel_post', async ctx => { try { await indexChannelPost(ctx.channelPost); } catch(e) { console.error('Index channel post failed:',e.message); } });
bot.on('edited_channel_post', async ctx => { try { await indexChannelPost(ctx.editedChannelPost); } catch(e) { console.error('Re-index edited post failed:',e.message); } });

bot.start(async ctx => {
  await saveUser(ctx.from);
  await ctx.reply('👋 <b>Ku soo dhawoow Baare Salah!</b> 🎬\n🔎 Magaca filimka ama taxanaha qor, si fududna u hel. 🍿', {parse_mode:'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🎉 Casuumad','invite'),Markup.button.callback('💬 Caawimaad','help')]])});
});
bot.command('casuumad', async ctx => ctx.reply(`🎉 <b>Saaxiibbadaa casuum!</b> 🍿\nhttps://t.me/${botUsername}`, {parse_mode:'HTML', ...Markup.inlineKeyboard([[Markup.button.url('🔗 Fur bot-ka',`https://t.me/${botUsername}`)]])}));
bot.command('casuumad_taagero', async ctx => ctx.reply(`💬 <b>Caawimaad & Taageero</b>\n🛠️ Caawimaad: @${support}\n💖 Taageer system-ka: @${support}\n📖 Magac qor, natiijadana dooro. 🎬`, {parse_mode:'HTML', ...Markup.inlineKeyboard([[Markup.button.url('💬 La xiriir',`https://t.me/${support}`)]])}));
bot.command('caawinad_taagero', async ctx => ctx.reply(`💬 <b>Caawimaad & Taageero</b>\n🛠️ Caawimaad: @${support}\n💖 Taageer system-ka: @${support}\n📖 Magac qor, natiijadana dooro. 🎬`, {parse_mode:'HTML', ...Markup.inlineKeyboard([[Markup.button.url('💬 La xiriir',`https://t.me/${support}`)]])}));
bot.command('baare', async ctx => ctx.reply('🔎 <b>Baare Salah</b> 🎬\n🍿 Magaca filimka ama taxanaha qor!', {parse_mode:'HTML'}));
bot.command('admin', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Amarkan ma lihid.');
  return ctx.reply('🛡️ <b>Baare Salah Admin</b>\nDooro hawsha aad rabto 👇', {parse_mode:'HTML', ...Markup.inlineKeyboard([
    [Markup.button.callback('📊 Tirakoob','adm:stats'),Markup.button.callback('🔎 Tijaabi raadinta','adm:test')],
    [Markup.button.callback('📣 Ogeysiis','adm:broadcast'),Markup.button.callback('📦 Kaydka','adm:storage')]
  ])});
});
bot.action('invite', async ctx => { await ctx.answerCbQuery(); await ctx.reply(`🎉 Saaxiibbadaa casuum! 🍿\nhttps://t.me/${botUsername}`); });
bot.action('help', async ctx => { await ctx.answerCbQuery(); await ctx.reply(`💬 Caawimaad: @${support}`); });
bot.action('adm:stats', async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Ma lihid oggolaansho.',{show_alert:true});
  await ctx.answerCbQuery(); const s = await stats();
  await ctx.reply(`📊 <b>Tirakoobka</b>\n👥 Users: ${s.users}\n📦 Files: ${s.files}\n🔎 Raadis guud: ${s.searches}\n📅 Raadis maanta: ${s.today}`,{parse_mode:'HTML'});
});
bot.action('adm:storage', async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Ma lihid oggolaansho.',{show_alert:true});
  await ctx.answerCbQuery(); const s = await stats();
  await ctx.reply(`📦 Kaydka database-ka: ${s.files} posts.\n➕ Files cusub ku dir storage channel-ka adigoo raacaya caption-ka tilmaamaha. Bot-ku waa inuu channel-ka admin ka yahay.`);
});
bot.action('adm:test', async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Ma lihid oggolaansho.',{show_alert:true});
  await ctx.answerCbQuery(); pendingSearch.set(String(ctx.from.id), {mode:'test'}); await ctx.reply('🔎 Soo dir magaca aad rabto inaan tijaabino.');
});
bot.action('adm:broadcast', async ctx => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Ma lihid oggolaansho.',{show_alert:true});
  await ctx.answerCbQuery(); pendingSearch.set(String(ctx.from.id), {mode:'broadcast'}); await ctx.reply('📣 Soo dir qoraalka ogeysiiska.');
});

async function showResults(ctx, query, adminTest=false) {
  await logSearch(ctx.from.id, query);
  const results = await searchContent(query);
  if (!results.length) return ctx.reply('😕 Wax natiijo ah lama helin. Hubi magaca oo mar kale isku day.');
  const unique = [];
  const seen = new Set();
  for (const r of results) {
    const k = `${r.title}|${r.content_type}`;
    if (!seen.has(k)) { unique.push(r); seen.add(k); }
  }
  const buttons = unique.slice(0,10).map(r => [Markup.button.callback(`${r.content_type==='series'?'📺':'🎬'} ${r.title}`, r.content_type==='series' ? `series:${r.id}` : `file:${r.id}`)]);
  if (adminTest) buttons.push([Markup.button.callback('🛑 Jooji','adm:cancel')]);
  await ctx.reply(`✅ Waxaa la helay ${unique.length} natiijo. Dooro midka saxda ah:`, Markup.inlineKeyboard(buttons));
}
bot.action(/^series:(\d+)$/, async ctx => {
  try {
    const { rows } = await pool.query('SELECT * FROM content WHERE id=$1',[Number(ctx.match[1])]);
    const item = rows[0];
    if (!item) return ctx.answerCbQuery('Taxanahan lama helin.',{show_alert:true});
    const seasons = await pool.query("SELECT season, MIN(id) AS id FROM content WHERE content_type='series' AND lower(title)=lower($1) GROUP BY season ORDER BY season NULLS FIRST",[item.title]);
    await ctx.answerCbQuery();
    const buttons = seasons.rows.map(s => [Markup.button.callback(s.season ? `📂 Season ${s.season}` : '📂 Qaybaha', `season:${item.id}:${s.season || '0'}`)]);
    await ctx.reply(`📺 <b>${escapeHtml(item.title)}</b>
Dooro season-ka:`,{parse_mode:'HTML',...Markup.inlineKeyboard(buttons)});
  } catch(e) { console.error('Show seasons failed:',e.message); await ctx.answerCbQuery('Cilad ayaa dhacday.',{show_alert:true}); }
});
bot.action(/^season:(\d+):([\w.-]+)$/, async ctx => {
  try {
    const base = await pool.query('SELECT title FROM content WHERE id=$1',[Number(ctx.match[1])]);
    if (!base.rows[0]) return ctx.answerCbQuery('Taxanahan lama helin.',{show_alert:true});
    const season = ctx.match[2] === '0' ? null : ctx.match[2];
    const result = await pool.query(`SELECT id,episode,title FROM content WHERE content_type='series' AND lower(title)=lower($1) AND (($2::text IS NULL AND season IS NULL) OR season=$2) ORDER BY episode NULLS FIRST,id LIMIT 50`,[base.rows[0].title,season]);
    await ctx.answerCbQuery();
    const buttons = result.rows.map(ep => [Markup.button.callback(`🎞️ Episode ${ep.episode || '—'}`,`file:${ep.id}`)]);
    if (!buttons.length) return ctx.reply('😕 Season-kan wax episodes ah lagama helin.');
    await ctx.reply(`🎬 <b>${escapeHtml(base.rows[0].title)}</b>${season ? ` · Season ${season}` : ''}
Dooro qaybta:`,{parse_mode:'HTML',...Markup.inlineKeyboard(buttons)});
  } catch(e) { console.error('Show episodes failed:',e.message); await ctx.answerCbQuery('Cilad ayaa dhacday.',{show_alert:true}); }
});
bot.action('adm:cancel', async ctx => { if(!isAdmin(ctx)) return ctx.answerCbQuery(); pendingSearch.delete(String(ctx.from.id)); await ctx.answerCbQuery('La joojiyey'); });
bot.action(/^file:(\d+)$/, async ctx => {
  const id = Number(ctx.match[1]);
  try {
    const { rows } = await pool.query('SELECT * FROM content WHERE id=$1',[id]);
    const item = rows[0];
    if (!item) { await ctx.answerCbQuery('Natiijadan lama helin.',{show_alert:true}); return; }
    await ctx.answerCbQuery('File-ka waa la helay.');
    await ctx.telegram.copyMessage(ctx.chat.id, item.channel_id, Number(item.message_id));
    try { await ctx.deleteMessage(); } catch {}
  } catch(e) { console.error('Send selected file failed:',e.message); await ctx.reply('⚠️ File-ka lama soo diri karin. Admin-ka ha hubiyo storage channel-ka.'); }
});

bot.on('text', async ctx => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;
  await saveUser(ctx.from);
  const state = pendingSearch.get(String(ctx.from.id));
  if (state?.mode === 'broadcast' && isAdmin(ctx)) {
    pendingSearch.delete(String(ctx.from.id));
    const users = await getUsers(); let sent=0, failed=0;
    await ctx.reply('📣 Ogeysiiska waa la dirayaa...');
    for (const uid of users) { try { await ctx.telegram.sendMessage(uid,text); sent++; } catch { failed++; } }
    return ctx.reply(`✅ Waa la diray: ${sent}\n⚠️ Lama gaarsiin: ${failed}`);
  }
  if (state?.mode === 'test' && isAdmin(ctx)) { pendingSearch.delete(String(ctx.from.id)); return showResults(ctx,text,true); }
  return showResults(ctx,text,false);
});
bot.catch(err => console.error('Telegram bot error:',err));

(async () => {
  await initDb();
  await bot.launch();
  console.log('Baare Salah Bot started. Database connected; polling active.');
})().catch(err => { console.error('Startup failed:',err); process.exit(1); });
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
