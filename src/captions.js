function parseCaption(caption = '') {
  const fields = {};
  for (const line of caption.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:🏷️?\s*)?(?:Magac|Title|Name)\s*:\s*(.+)$/i)
      || line.match(/^\s*(?:📂\s*)?(?:Season|Xilli)\s*:\s*(.+)$/i)
      || line.match(/^\s*(?:🎞️?\s*)?(?:Episode|Qayb)\s*:\s*(.+)$/i)
      || line.match(/^\s*(?:📝\s*)?(?:Sharaxaad|Description)\s*:\s*(.+)$/i)
      || line.match(/^\s*(?:🔎\s*)?(?:Keywords|Erayo)\s*:\s*(.+)$/i)
      || line.match(/^\s*(?:🎬|📺)?\s*(?:Nooca|Type)\s*:\s*(.+)$/i);
    if (!m) continue;
    const keyMatch = line.match(/(?:Magac|Title|Name|Season|Xilli|Episode|Qayb|Sharaxaad|Description|Keywords|Erayo|Nooca|Type)\s*:/i);
    if (!keyMatch) continue;
    const key = keyMatch[0].replace(':','').trim().toLowerCase();
    fields[key] = m[1].trim();
  }
  const title = fields['magac'] || fields['title'] || fields['name'] || '';
  const typeText = (fields['nooca'] || fields['type'] || '').toLowerCase();
  const season = fields['season'] || fields['xilli'] || null;
  const episode = fields['episode'] || fields['qayb'] || null;
  const type = /taxane|series|musalsal/.test(typeText) || season || episode ? 'series' : 'film';
  const description = fields['sharaxaad'] || fields['description'] || '';
  const keywords = (fields['keywords'] || fields['erayo'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return { title, type, season: season ? String(season).replace(/^S/i, '') : null, episode: episode ? String(episode).replace(/^E/i, '') : null, description, keywords };
}
function mediaInfo(message) {
  if (message.video) return { fileId: message.video.file_id, mediaType: 'video' };
  if (message.document) return { fileId: message.document.file_id, mediaType: 'document' };
  if (message.animation) return { fileId: message.animation.file_id, mediaType: 'animation' };
  if (message.audio) return { fileId: message.audio.file_id, mediaType: 'audio' };
  if (message.video_note) return { fileId: message.video_note.file_id, mediaType: 'video_note' };
  if (message.photo?.length) return { fileId: message.photo[message.photo.length - 1].file_id, mediaType: 'photo' };
  return { fileId: null, mediaType: 'text' };
}
module.exports = { parseCaption, mediaInfo };
