const sessions = new Map();

export function getSession(contactId) {
  return sessions.get(contactId) || null;
}

export function createSession(contactId, replyTarget = '') {
  const session = {
    contactId,
    replyTarget,
    startedAt: new Date().toISOString(),
    currentQuestionIndex: 0,
    answers: [],
    partialDraft: '',
    pendingConfirmation: null,
    promptHistory: [],
    semanticEvents: [],
    stepMemory: {},
    lastModelAnalysis: null,
    repromptCount: 0,
    status: 'collecting'
  };

  sessions.set(contactId, session);
  return session;
}

export function saveSession(contactId, session) {
  sessions.set(contactId, session);
  return session;
}

export function deleteSession(contactId) {
  sessions.delete(contactId);
}

export function getAllSessions() {
  return Array.from(sessions.values());
}
