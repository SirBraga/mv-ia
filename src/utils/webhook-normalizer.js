function sanitizePhoneNumber(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function extractPhoneFromVcard(vcard = '') {
  const rawVcard = String(vcard || '');
  const telMatches = Array.from(rawVcard.matchAll(/TEL[^:]*:([^\n\r]+)/gi));

  for (const match of telMatches) {
    const normalized = sanitizePhoneNumber(match?.[1] || '');

    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function extractSharedContactContent(message) {
  const singleContact = message?.contactMessage;
  const multipleContacts = message?.contactsArrayMessage?.contacts || [];
  const firstArrayContact = Array.isArray(multipleContacts) ? multipleContacts[0] : null;
  const candidate = singleContact || firstArrayContact || null;

  if (!candidate) {
    return '';
  }

  const directNumber =
    sanitizePhoneNumber(candidate?.waid) ||
    sanitizePhoneNumber(candidate?.phoneNumber) ||
    sanitizePhoneNumber(candidate?.id);

  if (directNumber) {
    return directNumber;
  }

  return extractPhoneFromVcard(candidate?.vcard || candidate?.vCard || '');
}

function extractMessageContent(message) {
  const textContent =
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.extendedTextMessage?.caption ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    message?.buttonsResponseMessage?.selectedDisplayText ||
    message?.listResponseMessage?.title ||
    '';

  const sharedContact = extractSharedContactContent(message);

  return {
    text: String(textContent || '').trim(),
    sharedContact
  };
}

function sanitizeNumber(remoteJid = '') {
  return remoteJid.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '');
}

export function normalizeEvolutionWebhook(payload) {
  const event = payload?.event || payload?.type || '';
  const data = payload?.data || payload;
  const key = data?.key || data?.message?.key || {};
  const message = data?.message || data?.messages?.[0]?.message || data?.data?.message || {};
  const extractedContent = extractMessageContent(message);
  const messageId = key?.id || data?.id || data?.messageId || data?.data?.id || '';
  const messageTimestamp = data?.messageTimestamp || data?.timestamp || data?.data?.messageTimestamp || data?.data?.timestamp || '';
  const pushName = data?.pushName || data?.data?.pushName || '';
  const fromMe = Boolean(key?.fromMe ?? data?.fromMe ?? false);
  const remoteJid = key?.remoteJid || data?.remoteJid || data?.jid || '';
  const isGroupMessage = remoteJid.endsWith('@g.us');
  const text = extractedContent.text;
  const sharedContact = extractedContent.sharedContact;
  const contactId = sanitizeNumber(remoteJid);

  return {
    event,
    messageId,
    messageTimestamp,
    fromMe,
    isGroupMessage,
    remoteJid,
    contactId,
    pushName,
    text,
    sharedContact,
    normalizedInput: text || sharedContact,
    isValidTextMessage: Boolean(contactId && (text || sharedContact) && !fromMe && !isGroupMessage)
  };
}
