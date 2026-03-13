function extractTextContent(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.extendedTextMessage?.caption ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    message?.buttonsResponseMessage?.selectedDisplayText ||
    message?.listResponseMessage?.title ||
    ''
  );
}

function sanitizeNumber(remoteJid = '') {
  return remoteJid.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '');
}

export function normalizeEvolutionWebhook(payload) {
  const event = payload?.event || payload?.type || '';
  const data = payload?.data || payload;
  const key = data?.key || data?.message?.key || {};
  const message = data?.message || data?.messages?.[0]?.message || data?.data?.message || {};
  const pushName = data?.pushName || data?.data?.pushName || '';
  const fromMe = Boolean(key?.fromMe ?? data?.fromMe ?? false);
  const remoteJid = key?.remoteJid || data?.remoteJid || data?.jid || '';
  const isGroupMessage = remoteJid.endsWith('@g.us');
  const text = extractTextContent(message).trim();
  const contactId = sanitizeNumber(remoteJid);

  return {
    event,
    fromMe,
    isGroupMessage,
    remoteJid,
    contactId,
    pushName,
    text,
    isValidTextMessage: Boolean(contactId && text && !fromMe && !isGroupMessage)
  };
}
