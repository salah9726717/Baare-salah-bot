# Baare Salah Bot

Telegram search bot (Node.js 20+, Telegraf, PostgreSQL) for a single storage channel.

## 1. Storage channel caption format

**Film (one post per file):**

```text
🎬 Nooca: FILM
🏷️ Magac: Avatar 3
📝 Sharaxaad: Avatar 3 (2025)
🔎 Keywords: avatar, avatar 3, pandora
```

**Series (one post per episode/file):**

```text
📺 Nooca: TAXANE
🏷️ Magac: Wednesday
📂 Season: 1
🎞️ Episode: 2
📝 Sharaxaad: Wednesday - Season 1 Episode 2
🔎 Keywords: wednesday, wednesday season 1, wednesday episode 2
```

Rules:
- Send each video/file as its own channel post and place the template in its **caption**.
- Keep the main title the same for all episodes in a series (e.g. `Wednesday`).
- Use numbers for season and episode (`1`, `2`, etc.).
- Keywords are optional, comma-separated; add common spellings and alternate titles.
- Do not write the title only in a separate message; attach the caption to the file.
- Add the bot as an **administrator** of the storage channel. New posts are indexed as Telegram updates arrive.

## 2. Existing posts

Telegram Bot API does not provide an endpoint for a bot to fetch the full history of channel posts. Existing channel content needs to be re-sent/forwarded through an indexing workflow or indexed by adding an explicit admin import feature. The bot cannot magically scan the old history. New posts are indexed automatically when the bot receives channel-post updates.

## 3. Render deployment

1. Create a PostgreSQL database (Render PostgreSQL is suitable).
2. Push this folder to GitHub.
3. Create a Render **Background Worker** (recommended for Telegram long polling) or a Web Service if you separately add a health endpoint.
4. Build command: `npm install`
5. Start command: `npm start`
6. Add environment variables from `.env.example`; set `DATABASE_URL` to the PostgreSQL **internal** URL when the worker and database are in the same Render region.
7. Set `PGSSL=true` for hosted PostgreSQL if required.
8. Add the bot to the storage channel as administrator and confirm it can read channel posts.
9. Put your Telegram numeric user ID(s) in `ADMIN_IDS`, comma-separated.

## 4. Important notes

- This project uses PostgreSQL to store users, searches, file metadata, captions, and season/episode information. Actual files remain in Telegram.
- `copyMessage` requires the source post to remain accessible and Telegram to allow copying it.
- Test the bot with a few sample film/episode posts before bulk use. Do not treat deployment as tested until you run the checklist below.
- For a production release, add a protected health endpoint and an explicit old-post importer if you need bulk indexing of content already in the channel.

## 5. Test checklist

- `/start` replies with short welcome and registers user.
- Post a sample film in the storage channel using the exact caption format; check Render logs for `Indexed storage post`.
- Search the exact film title and select the result; confirm the actual stored post is copied.
- Post two episodes for one series and check season/episode buttons/results.
- Search a missing title and confirm a short not-found message.
- Confirm `/admin` is blocked for non-admin users and works for IDs in `ADMIN_IDS`.
- Restart the worker and confirm indexed content remains searchable from PostgreSQL.
