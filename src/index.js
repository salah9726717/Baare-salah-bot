
require('dotenv').config();

const http = require('http');
const { Telegraf, Markup } = require('telegraf');
const {
  initDb,
  upsertContent,
  searchContent,
  saveUser,
  logSearch,
  stats,
  getUsers,
  pool
} = require('./db');
const { parseCaption, mediaInfo } = require('./captions');

// ─── CONFIG ─────────────────────────────────────────────
const required = ['BOT_TOKEN', 'DATABASE_URL', 'STORAGE_CHANNEL_ID'];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const PORT = Number(process.env.PORT || 3000);
const bot = new Telegraf(process.env.BOT_TOKEN);
const storageId = String(process.env.STORAGE_CHANNEL_ID);

const admins = new Set(
  (process.env.ADMIN_IDS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
);

const support = (process.env.SUPPORT_USERNAME || 'Baare_Salah').replace(/^@/, '');
const botUsername = (process.env.BOT_USERNAME || 'BaareSalahBot').replace(/^@/, '');

const pendingSearch = new Map();
const isAdmin = ctx => admins.has(String(ctx.from?.id));

const escapeHtml = value =>
  String(value ?? '').replace(/[&<>"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  })[char]);

// ─── HTTP SERVER: RENDER FREE WEB SERVICE ───────────────
const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  if (req.url === '/health') {
    return res.end('OK');
  }

  res.end('Baare Salah Bot is running 🤖');
});

server.on('error', error => {
  console.error('HTTP server error:', error.message);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

// ─── CAPTION TITLE FALLBACK ─────────────────────────────
function findTitle(caption, parsed) {
  if (parsed?.title && String(parsed.title).trim()) {
    return String(parsed.title).trim();
  }

  const explicit = caption.match(
    /^\s*(?:🏷️?\s*)?(?:Magac|Title|Name)\s*:\s*(.+?)\s*$/im
  );

  if (explicit?.[1]) return explicit[1].trim();

  // Supports captions such as: Avatar 3 | Miskiiney Films 🎬
  const lines = caption.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (/^(?:🎬|📺)?\s*(?:Nooca|Type|Sharaxaad|Description|Keywords|Erayo|Season|Xilli|Episode|Qayb)\s*:/i.test(line)) {
      continue;
    }

    const title = line
      .split('|')[0]
      .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '')
      .trim();

    if (title) return title;
  }

  return '';
}

// ─── INDEX STORAGE CHANNEL POSTS ────────────────────────
async function indexChannelPost(msg) {
  if (String(msg.chat?.id) !== storageId) return;

  const caption = msg.caption || msg.text || '';
  const parsed = parseCaption(caption) || {};
  const title = findTitle(caption, parsed);

  // Do not save posts that have no usable title.
  if (!title) {
    console.warn(`Skipped post ${msg.message_id}: caption/title missing.`);
    return;
  }

  const media = mediaInfo(msg);

  parsed.title = title;

  if (!parsed.type) {
    parsed.type = /taxane|series|musalsal/i.test(caption) ? 'series' : 'film';
  }

  await upsertContent({
    channelId: msg.chat.id,
    messageId: msg.message_id,
    fileId: media?.fileId || null,
    mediaType: media?.mediaType || 'text',
    parsed,
    caption
  });

  console.log(`Indexed storage post ${msg.message_id}: ${title}`);
}

bot.on('channel_post', async ctx => {
  try {
    await indexChannelPost(ctx.channelPost);
  } catch (error) {
    console.error('Index channel post failed:', error.message);
  }
});

bot.on('edited_channel_post', async ctx => {
  try {
    await indexChannelPost(ctx.editedChannelPost);
  } catch (error) {
    console.error('Re-index edited post failed:', error.message);
  }
});

// ─── START / USER COMMANDS ──────────────────────────────
bot.start(async ctx => {
  try {
    await saveUser(ctx.from);

    await ctx.reply(
      '👋 <b>Ku soo dhawoow Baare Salah!</b> 🎬\n' +
      '🔎 Magaca filimka ama taxanaha qor, si fududna u hel. 🍿',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('🎉 Casuumad', 'invite'),
            Markup.button.callback('💬 Caawimaad', 'help')
          ]
        ])
      }
    );
  } catch (error) {
    console.error('/start failed:', error.message);
    await ctx.reply('⚠️ Cilad ayaa dhacday. Fadlan mar kale isku day.');
  }
});

bot.command('casuumad', async ctx => {
  await ctx.reply(
    `🎉 <b>Saaxiibbadaa casuum!</b> 🍿\nhttps://t.me/${botUsername}`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[
        Markup.button.url('🔗 Fur bot-ka', `https://t.me/${botUsername}`)
      ]])
    }
  );
});

async function sendSupport(ctx) {
  await ctx.reply(
    `💬 <b>Caawimaad & Taageero</b>\n` +
    `🛠️ Caawimaad: @${support}\n` +
    `📖 Magac qor, natiijadana dooro. 🎬`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[
        Markup.button.url('💬 La xiriir', `https://t.me/${support}`)
      ]])
    }
  );
}

bot.command('casuumad_taagero', sendSupport);
bot.command('caawinad_taagero', sendSupport);

bot.command('baare', async ctx => {
  await ctx.reply(
    '🔎 <b>Baare Salah</b> 🎬\n🍿 Magaca filimka ama taxanaha qor!',
    { parse_mode: 'HTML' }
  );
});

// ─── ADMIN PANEL ────────────────────────────────────────
bot.command('admin', async ctx => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Amarkan ma lihid.');

  await ctx.reply(
    '🛡️ <b>Baare Salah Admin</b>\nDooro hawsha aad rabto 👇',
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('📊 Tirakoob', 'adm:stats'),
          Markup.button.callback('🔎 Tijaabi raadinta', 'adm:test')
        ],
        [
          Markup.button.callback('📣 Ogeysiis', 'adm:broadcast'),
          Markup.button.callback('📦 Kaydka', 'adm:storage')
        ]
      ])
    }
  );
});

bot.action('invite', async ctx => {
  await ctx.answerCbQuery();
  await ctx.reply(`🎉 Saaxiibbadaa casuum! 🍿\nhttps://t.me/${botUsername}`);
});

bot.action('help', async ctx => {
  await ctx.answerCbQuery();
  await sendSupport(ctx);
});

bot.action('adm:stats', async ctx => {
  if (!isAdmin(ctx)) {
    return ctx.answerCbQuery('Ma lihid oggolaansho.', { show_alert: true });
  }

  await ctx.answerCbQuery();
  const s = await stats();

  await ctx.reply(
    `📊 <b>Tirakoobka</b>\n` +
    `👥 Users: ${s.users}\n` +
    `📦 Files: ${s.files}\n` +
    `🔎 Raadis guud: ${s.searches}\n` +
    `📅 Raadis maanta: ${s.today}`,
    { parse_mode: 'HTML' }
  );
});

bot.action('adm:storage', async ctx => {
  if (!isAdmin(ctx)) {
    return ctx.answerCbQuery('Ma lihid oggolaansho.', { show_alert: true });
  }

  await ctx.answerCbQuery();
  const s = await stats();

  await ctx.reply(
    `📦 Kaydka database-ka: ${s.files} posts.\n` +
    '➕ File cusub ku dir storage channel-ka adigoo caption sax ah raacinaya.\n' +
    '🤖 Bot-ku waa inuu channel-ka admin ka yahay.'
  );
});

bot.action('adm:test', async ctx => {
  if (!isAdmin(ctx)) {
    return ctx.answerCbQuery('Ma lihid oggolaansho.', { show_alert: true });
  }

  await ctx.answerCbQuery();
  pendingSearch.set(String(ctx.from.id), { mode: 'test' });
  await ctx.reply('🔎 Soo dir magaca aad rabto inaan tijaabino.');
});

bot.action('adm:broadcast', async ctx => {
  if (!isAdmin(ctx)) {
    return ctx.answerCbQuery('Ma lihid oggolaansho.', { show_alert: true });
  }

  await ctx.answerCbQuery();
  pendingSearch.set(String(ctx.from.id), { mode: 'broadcast' });
  await ctx.reply('📣 Soo dir qoraalka ogeysiiska.');
});

bot.action('adm:cancel', async ctx => {
  if (!isAdmin(ctx)) {
    return ctx.answerCbQuery('Ma lihid oggolaansho.', { show_alert: true });
  }

  pendingSearch.delete(String(ctx.from.id));
  await ctx.answerCbQuery('La joojiyey');
});

// ─── SEARCH ─────────────────────────────────────────────
async function showResults(ctx, query, adminTest = false) {
  await logSearch(ctx.from.id, query);

  const results = await searchContent(query);

  if (!results.length) {
    return ctx.reply('😕 Wax natiijo ah lama helin. Hubi magaca oo mar kale isku day.');
  }

  const unique = [];
  const seen = new Set();

  for (const item of results) {
    const key = `${item.title}|${item.content_type}`;

    if (!seen.has(key)) {
      unique.push(item);
      seen.add(key);
    }
  }

  const buttons = unique.slice(0, 10).map(item => [
    Markup.button.callback(
      `${item.content_type === 'series' ? '📺' : '🎬'} ${item.title}`,
      item.content_type === 'series' ? `series:${item.id}` : `file:${item.id}`
    )
  ]);

  if (adminTest) {
    buttons.push([Markup.button.callback('🛑 Jooji', 'adm:cancel')]);
  }

  await ctx.reply(
    `✅ Waxaa la helay ${unique.length} natiijo. Dooro midka saxda ah:`,
    Markup.inlineKeyboard(buttons)
  );
}

// ─── SERIES → SEASONS → EPISODES ────────────────────────
bot.action(/^series:(\d+)$/, async ctx => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM content WHERE id = $1',
      [Number(ctx.match[1])]
    );

    const item = rows[0];

    if (!item) {
      return ctx.answerCbQuery('Taxanahan lama helin.', { show_alert: true });
    }

    const result = await pool.query(
      `SELECT season, MIN(id) AS id
       FROM content
       WHERE content_type = 'series' AND lower(title) = lower($1)
       GROUP BY season
       ORDER BY season NULLS FIRST`,
      [item.title]
    );

    await ctx.answerCbQuery();

    const buttons = result.rows.map(season => [
      Markup.button.callback(
        season.season ? `📂 Season ${season.season}` : '📂 Qaybaha',
        `season:${item.id}:${season.season || '0'}`
      )
    ]);

    if (!buttons.length) {
      return ctx.reply('😕 Taxanahan season-yo lagama helin.');
    }

    await ctx.reply(
      `📺 <b>${escapeHtml(item.title)}</b>\nDooro season-ka:`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) }
    );
  } catch (error) {
    console.error('Show seasons failed:', error.message);
    await ctx.answerCbQuery('Cilad ayaa dhacday.', { show_alert: true });
  }
});

bot.action(/^season:(\d+):([\w.-]+)$/, async ctx => {
  try {
    const base = await pool.query(
      'SELECT title FROM content WHERE id = $1',
      [Number(ctx.match[1])]
    );

    if (!base.rows[0]) {
      return ctx.answerCbQuery('Taxanahan lama helin.', { show_alert: true });
    }

    const season = ctx.match[2] === '0' ? null : ctx.match[2];

    const result = await pool.query(
      `SELECT id, episode, title
       FROM content
       WHERE content_type = 'series'
         AND lower(title) = lower($1)
         AND (($2::text IS NULL AND season IS NULL) OR season = $2)
       ORDER BY episode NULLS FIRST, id
       LIMIT 50`,
      [base.rows[0].title, season]
    );

    await ctx.answerCbQuery();

    const buttons = result.rows.map(episode => [
      Markup.button.callback(
        `🎞️ Episode ${episode.episode || '—'}`,
        `file:${episode.id}`
      )
    ]);

    if (!buttons.length) {
      return ctx.reply('😕 Season-kan wax episodes ah lagama helin.');
    }

    await ctx.reply(
      `🎬 <b>${escapeHtml(base.rows[0].title)}</b>` +
      `${season ? ` · Season ${escapeHtml(season)}` : ''}\nDooro qaybta:`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) }
    );
  } catch (error) {
    console.error('Show episodes failed:', error.message);
    await ctx.answerCbQuery('Cilad ayaa dhacday.', { show_alert: true });
  }
});

// ─── SEND SELECTED STORAGE POST ─────────────────────────
bot.action(/^file:(\d+)$/, async ctx => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM content WHERE id = $1',
      [Number(ctx.match[1])]
    );

    const item = rows[0];

    if (!item) {
      return ctx.answerCbQuery('Natiijadan lama helin.', { show_alert: true });
    }

    await ctx.answerCbQuery('File-ka waa la helay.');

    await ctx.telegram.copyMessage(
      ctx.chat.id,
      item.channel_id,
      Number(item.message_id)
    );

    // Remove the result-selection message after successful delivery.
    try {
      await ctx.deleteMessage();
    } catch {}
  } catch (error) {
    console.error('Send selected file failed:', error.message);
    await ctx.reply('⚠️ File-ka lama soo diri karin. Admin-ka ha hubiyo storage channel-ka.');
  }
});

// ─── TEXT SEARCH / ADMIN BROADCAST ──────────────────────
bot.on('text', async ctx => {
  const text = ctx.message.text.trim();

  if (!text || text.startsWith('/')) return;

  try {
    await saveUser(ctx.from);

    const state = pendingSearch.get(String(ctx.from.id));

    if (state?.mode === 'broadcast' && isAdmin(ctx)) {
      pendingSearch.delete(String(ctx.from.id));

      const users = await getUsers();
      let sent = 0;
      let failed = 0;

      await ctx.reply('📣 Ogeysiiska waa la dirayaa...');

      for (const userId of users) {
        try {
          await ctx.telegram.sendMessage(userId, text);
          sent++;
        } catch {
          failed++;
        }
      }

      return ctx.reply(`✅ Waa la diray: ${sent}\n⚠️ Lama gaarsiin: ${failed}`);
    }

    if (state?.mode === 'test' && isAdmin(ctx)) {
      pendingSearch.delete(String(ctx.from.id));
      return showResults(ctx, text, true);
    }

    return showResults(ctx, text, false);
  } catch (error) {
    console.error('Text handler failed:', error.message);
    await ctx.reply('⚠️ Raadinta way fashilantay. Fadlan mar kale isku day.');
  }
});

// ─── ERROR HANDLING & STARTUP ───────────────────────────
bot.catch(error => {
  console.error('Telegram bot error:', error.message);
});

(async () => {
  await initDb();
  await bot.launch();
  console.log('Baare Salah Bot started. Database connected; polling active.');
})().catch(error => {
  console.error('Startup failed:', error);
  process.exit(1);
});

// ─── CLEAN SHUTDOWN ─────────────────────────────────────
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Received ${signal}; shutting down...`);

  try {
    bot.stop(signal);
  } catch (error) {
    console.error('Bot shutdown error:', error.message);
  }

  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });

  // Do not leave the process hanging during shutdown.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
