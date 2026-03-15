import { env } from '../config/env.js';
import { createSession, deleteSession, getSession, saveSession } from '../store/session-store.js';
import { referralCompletionMessage, referralSteps } from '../config/referral-flow.js';
import { sendTextMessage } from '../services/evolution.service.js';
import { runReferralStepConversation } from '../services/groq.service.js';
import { hasIndicationForReferrer, saveIndication } from '../services/indication-store.service.js';

const affirmativeAnswers = ['sim', 's', 'isso', 'isso mesmo', 'certo', 'certo sim', 'correto', 'confirmo', 'confirmado', 'pode seguir', 'pode prosseguir', 'ok', 'okay', 'perfeito', 'exato'];
const negativeAnswers = ['nao', 'não', 'n', 'negativo', 'errado', 'incorreto', 'nao foi isso', 'não foi isso'];
const MAX_PROMPT_HISTORY = 20;
const MAX_SEMANTIC_EVENTS = 30;
const PRESENTATION_COOLDOWN_MS = 10 * 60 * 1000;
const stepFields = {
  customerIdentification: ['customerName', 'customerCompany'],
  referralCompanyAndContact: ['referralCompany', 'referralContactName'],
  referralPhone: ['referralPhone']
};
const stepFieldLabels = {
  customerName: 'seu nome completo',
  customerCompany: 'o nome da sua empresa cliente MV',
  referralCompany: 'o nome da empresa indicada',
  referralContactName: 'o nome da pessoa responsavel',
  referralPhone: 'o WhatsApp ou telefone da pessoa indicada'
};
const stepConfirmationLabels = {
  customerIdentification: 'seu nome completo e a empresa cliente MV',
  referralCompanyAndContact: 'a empresa indicada e a pessoa responsavel',
  referralPhone: 'o WhatsApp ou telefone da pessoa indicada'
};
const greetingOnlyMessages = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'opa'];

function isObviouslyInsufficient(answer) {
  if (!answer) {
    return true;
  }

  const normalized = answer.trim().toLowerCase();
  const vagueAnswers = ['sim', 'nao', 'talvez', 'ok', 'acho', 'sei la', 'nada', 'ajuda'];

  return normalized.length < env.minAnswerLength || vagueAnswers.includes(normalized);
}

function buildIndicationPayload(session) {
  return {
    createdAt: new Date().toISOString(),
    referrerWhatsapp: session.contactId,
    customerIdentification: session.answers[0] || '',
    referralCompanyAndContact: session.answers[1] || '',
    referralPhone: session.answers[2] || ''
  };
}

function buildCurrentDraft(session, latestUserMessage = '') {
  const baseDraft = String(session?.partialDraft || '').trim();
  const latestDraft = String(latestUserMessage || '').trim();

  if (!baseDraft) {
    return latestDraft;
  }

  if (!latestDraft) {
    return baseDraft;
  }

  return `${baseDraft}\n${latestDraft}`.trim();
}

function hasRecentPresentation(session) {
  if (!session?.presentedAt) {
    return false;
  }

  const presentedAt = new Date(session.presentedAt).getTime();

  if (!Number.isFinite(presentedAt)) {
    return false;
  }

  return Date.now() - presentedAt < PRESENTATION_COOLDOWN_MS;
}

function markBotPresented(session, { mode = 'intro' } = {}) {
  session.hasPresentedBot = true;
  session.presentationCount = Number(session.presentationCount || 0) + 1;
  session.presentedAt = new Date().toISOString();
  session.lastBotMode = mode;
}

function buildSessionContext(session, currentStep) {
  return {
    hasPresentedBot: Boolean(session?.hasPresentedBot),
    presentationCount: Number(session?.presentationCount || 0),
    hasRecentPresentation: hasRecentPresentation(session),
    lastUserIntent: session?.lastUserIntent || '',
    lastBotMode: session?.lastBotMode || '',
    lastHandledSocialQuestion: session?.lastHandledSocialQuestion || '',
    pendingConfirmationValue: session?.pendingConfirmation?.value || '',
    currentStepKey: getStepKey(currentStep),
    currentStepMemory: getStepMemory(session, currentStep)
  };
}

function getStepKey(stepOrKey) {
  return typeof stepOrKey === 'string' ? stepOrKey : stepOrKey?.key || '';
}

function getExpectedStepFields(stepOrKey) {
  return stepFields[getStepKey(stepOrKey)] || [];
}

function sanitizeCapturedFields(stepOrKey, capturedFields = {}) {
  const expectedFields = getExpectedStepFields(stepOrKey);
  const sanitized = {};

  for (const fieldName of expectedFields) {
    const value = capturedFields?.[fieldName];

    if (typeof value === 'string' && value.trim()) {
      sanitized[fieldName] = value.trim();
    }
  }

  return sanitized;
}

function computeMissingFields(stepOrKey, capturedFields = {}, missingFields = []) {
  const expectedFields = getExpectedStepFields(stepOrKey);
  const providedMissingFields = Array.isArray(missingFields)
    ? missingFields.filter((item) => expectedFields.includes(item))
    : [];

  if (providedMissingFields.length) {
    return [...new Set(providedMissingFields)];
  }

  return expectedFields.filter((fieldName) => !capturedFields[fieldName]);
}

function getDefaultStepMemory(stepOrKey) {
  return {
    capturedFields: {},
    missingFields: getExpectedStepFields(stepOrKey),
    confidence: 0,
    intent: 'unclear',
    rawDraft: '',
    lastExtractedValue: '',
    confirmedValue: '',
    lastUpdatedAt: ''
  };
}

function getStepMemory(session, stepOrKey) {
  const stepKey = getStepKey(stepOrKey);
  const storedMemory = session?.stepMemory?.[stepKey];

  if (!storedMemory) {
    return getDefaultStepMemory(stepKey);
  }

  const capturedFields = sanitizeCapturedFields(stepKey, storedMemory.capturedFields);

  return {
    ...getDefaultStepMemory(stepKey),
    ...storedMemory,
    capturedFields,
    missingFields: computeMissingFields(stepKey, capturedFields, storedMemory.missingFields)
  };
}

function upsertStepMemory(session, stepOrKey, nextPartial = {}) {
  const stepKey = getStepKey(stepOrKey);
  const currentMemory = getStepMemory(session, stepKey);
  const mergedCapturedFields = {
    ...currentMemory.capturedFields,
    ...sanitizeCapturedFields(stepKey, nextPartial.capturedFields || {})
  };
  const nextMemory = {
    ...currentMemory,
    ...nextPartial,
    capturedFields: mergedCapturedFields,
    missingFields: computeMissingFields(stepKey, mergedCapturedFields, nextPartial.missingFields),
    lastUpdatedAt: new Date().toISOString()
  };

  session.stepMemory = {
    ...(session.stepMemory || {}),
    [stepKey]: nextMemory
  };

  return nextMemory;
}

function resetStepMemory(session, stepOrKey) {
  const stepKey = getStepKey(stepOrKey);

  session.stepMemory = {
    ...(session.stepMemory || {}),
    [stepKey]: {
      ...getDefaultStepMemory(stepKey),
      lastUpdatedAt: new Date().toISOString()
    }
  };
}

function appendSemanticEvent(session, type, details = {}) {
  const nextEvents = [
    ...(Array.isArray(session.semanticEvents) ? session.semanticEvents : []),
    {
      type,
      timestamp: new Date().toISOString(),
      ...details
    }
  ];

  session.semanticEvents = nextEvents.slice(-MAX_SEMANTIC_EVENTS);
}

function rememberPrompt(session, stepOrKey, kind, prompt) {
  if (!prompt) {
    return;
  }

  const nextHistory = [
    ...(Array.isArray(session.promptHistory) ? session.promptHistory : []),
    {
      stepKey: getStepKey(stepOrKey),
      kind,
      prompt,
      timestamp: new Date().toISOString()
    }
  ];

  session.promptHistory = nextHistory.slice(-MAX_PROMPT_HISTORY);
}

function selectPromptFromPool(session, stepOrKey, kind, pool, seed = 0) {
  const uniquePool = [...new Set(pool.filter(Boolean))];

  if (!uniquePool.length) {
    return 'Pode me passar essa informacao?';
  }

  const recentPrompts = (Array.isArray(session.promptHistory) ? session.promptHistory : [])
    .slice()
    .reverse()
    .filter((entry) => entry.stepKey === getStepKey(stepOrKey) && entry.kind === kind)
    .slice(0, 2)
    .map((entry) => entry.prompt);
  const nonRepeatedPool = uniquePool.filter((prompt) => !recentPrompts.includes(prompt));
  const finalPool = nonRepeatedPool.length ? nonRepeatedPool : uniquePool;
  const prompt = finalPool[Math.abs(seed) % finalPool.length];

  rememberPrompt(session, stepOrKey, kind, prompt);
  return prompt;
}

function pickStepPrompt(step, session, { kind = 'step_prompt', includeExample = true, seed = 0 } = {}) {
  const promptPool = [];

  if (includeExample && step?.examplePrompt) {
    promptPool.push(step.examplePrompt);
  }

  if (Array.isArray(step?.fallbackPrompts)) {
    promptPool.push(...step.fallbackPrompts.filter(Boolean));
  }

  return selectPromptFromPool(session, step?.key || 'generic', kind, promptPool, seed);
}

function composeExtractedValue(stepOrKey, capturedFields = {}, fallback = '') {
  const stepKey = getStepKey(stepOrKey);

  if (stepKey === 'customerIdentification') {
    const parts = [capturedFields.customerName, capturedFields.customerCompany].filter(Boolean);
    return parts.length ? parts.join(' - ') : fallback;
  }

  if (stepKey === 'referralCompanyAndContact') {
    const parts = [capturedFields.referralCompany, capturedFields.referralContactName].filter(Boolean);
    return parts.length ? parts.join(' - ') : fallback;
  }

  if (stepKey === 'referralPhone') {
    return capturedFields.referralPhone || fallback;
  }

  return fallback;
}

function buildMissingFieldsReply(step, session, fallbackReply = '') {
  const stepMemory = getStepMemory(session, step);
  const missingFields = stepMemory.missingFields;
  const capturedFields = stepMemory.capturedFields;

  if (!missingFields.length) {
    return fallbackReply || pickStepPrompt(step, session, { kind: 'missing_fields_prompt', includeExample: false, seed: session.repromptCount + 1 });
  }

  if (getStepKey(step) === 'customerIdentification') {
    if (missingFields.length === 1 && missingFields[0] === 'customerCompany' && capturedFields.customerName) {
      return `Perfeito! Peguei seu nome como "${capturedFields.customerName}" 😊 Agora so me fala o nome da sua empresa cliente MV.`;
    }

    if (missingFields.length === 1 && missingFields[0] === 'customerName' && capturedFields.customerCompany) {
      return `Boa! Ja anotei a empresa cliente MV como "${capturedFields.customerCompany}" 😊 Agora so preciso do seu nome completo.`;
    }
  }

  if (getStepKey(step) === 'referralCompanyAndContact') {
    if (missingFields.length === 1 && missingFields[0] === 'referralContactName' && capturedFields.referralCompany) {
      return `Perfeito! Ja entendi a empresa indicada como "${capturedFields.referralCompany}" 😊 Agora so me fala o nome da pessoa responsavel por la.`;
    }

    if (missingFields.length === 1 && missingFields[0] === 'referralCompany' && capturedFields.referralContactName) {
      return `Boa! Ja peguei o nome da pessoa responsavel como "${capturedFields.referralContactName}" 😊 Agora so preciso do nome da empresa indicada.`;
    }
  }

  if (getStepKey(step) === 'referralPhone') {
    return 'Perfeito! Agora so preciso do WhatsApp ou telefone da pessoa indicada para concluir essa etapa 😊';
  }

  return fallbackReply || pickStepPrompt(step, session, { kind: 'missing_fields_prompt', includeExample: false, seed: session.repromptCount + missingFields.length });
}

function buildResumeGreeting(session) {
  const currentStep = referralSteps[session.currentQuestionIndex];
  const fallbackPrompt = pickStepPrompt(currentStep, session, {
    kind: 'resume_prompt',
    includeExample: false,
    seed: session.repromptCount + 1
  });

  if (session.pendingConfirmation?.stepIndex === session.currentQuestionIndex) {
    return `Oi! Que bom falar com voce de novo 😊 Antes de eu seguir, so quero confirmar uma coisinha: foi isso mesmo que eu entendi — "${session.pendingConfirmation.value}"?`;
  }

  return `Oi! Que bom falar com voce de novo 😊 ${fallbackPrompt}`;
}

function isAffirmative(text) {
  return affirmativeAnswers.includes(String(text || '').trim().toLowerCase());
}

function isNegative(text) {
  return negativeAnswers.includes(String(text || '').trim().toLowerCase());
}

function buildConfirmationPrompt(step, value, session, { sharedContact = false } = {}) {
  const sharedContactVariations = [
    'Perfeito! Recebi o contato compartilhado aqui 😊 So confirmando:',
    'Boa! Vi que voce me mandou o contato salvo 😊 Deixa eu confirmar:',
    'Perfeito, recebi o contato compartilhado direitinho 😊 Entendi',
    'Otimo! O contato compartilhado chegou certinho por aqui 😊 Entendi'
  ];
  const defaultVariations = [
    'Perfeito! So pra eu confirmar direitinho: entendi',
    'Certo, deixa eu confirmar com voce: entendi',
    'Pra eu registrar certinho, eu entendi',
    'So confirmando aqui com carinho: eu entendi'
  ];
  const variations = sharedContact ? sharedContactVariations : defaultVariations;
  const intro = selectPromptFromPool(
    session,
    step,
    sharedContact ? 'shared_contact_confirmation_intro' : 'confirmation_intro',
    variations,
    String(value || '').length + getStepKey(step).length
  );

  if (sharedContact && getStepKey(step) === 'referralPhone') {
    return `${intro} o WhatsApp ou telefone da pessoa indicada como "${value}", certo?`;
  }

  return `${intro} ${stepConfirmationLabels[getStepKey(step)] || 'essa informacao'} como "${value}", certo?`;
}

function buildRetryAfterNegativePrompt(step, session) {
  const intro = selectPromptFromPool(
    session,
    step,
    'retry_intro',
    [
      'Sem problema 😊 Obrigada por me corrigir.',
      'Perfeito 😊 Obrigada por me avisar.',
      'Boa 😊 Obrigada por ajustar isso comigo.',
      'Tranquilo 😊 Vamos acertar isso juntas.'
    ],
    getStepKey(step).length + session.repromptCount
  );
  const fallbackPrompt = pickStepPrompt(step, session, {
    kind: 'retry_prompt',
    includeExample: false,
    seed: session.repromptCount + 2
  });

  return `${intro} ${fallbackPrompt}`;
}

function buildReturningGreeting() {
  return 'Oi! Que bom te ver por aqui de novo 😊 Se quiser fazer uma nova indicacao, eu sigo com voce. Me manda seu nome completo e a empresa cliente MV.';
}

function getShortStepRetake(step, session, kind = 'short_retake_prompt') {
  return pickStepPrompt(step, session, {
    kind,
    includeExample: false,
    seed: session.repromptCount + getStepKey(step).length
  });
}

function buildIdentityReply(session, step) {
  const identityLine = selectPromptFromPool(
    session,
    step,
    'identity_reply',
    [
      'Sou a Drica 😊 To te ajudando aqui com a campanha de indicacoes da MV.',
      'Sou a Drica 😊 Cuido desse atendimento da campanha por aqui.',
      'Sou a Drica 😊 Estou te acompanhando nessa etapa da campanha.'
    ],
    Number(session.presentationCount || 0) + getStepKey(step).length
  );

  return `${identityLine}\n${getShortStepRetake(step, session, 'identity_retake_prompt')}`;
}

function buildProcessReply(session, step) {
  const processLine = selectPromptFromPool(
    session,
    step,
    'process_reply',
    [
      'E bem rapidinho 😊 Eu vou te pedindo os dados da campanha por etapa.',
      'Funciona de forma simples 😊 Eu te peço uma info por vez e vou confirmando com voce.',
      'Eu vou registrando sua indicacao aos poucos e confirmando tudo com voce 😊'
    ],
    session.repromptCount + getStepKey(step).length
  );

  return `${processLine}\n${getShortStepRetake(step, session, 'process_retake_prompt')}`;
}

function buildNoiseReply(session, step, intent = 'noise') {
  const promptKind = intent === 'message_test' ? 'message_test_reply' : 'noise_reply';
  const line = selectPromptFromPool(
    session,
    step,
    promptKind,
    intent === 'message_test'
      ? [
          'Recebi seu teste por aqui 😊',
          'To por aqui sim 😊',
          'Chegou certinho por aqui 😄'
        ]
      : [
          'Nao consegui entender essa mensagem direitinho 😅',
          'Recebi sua mensagem, mas ainda nao deu pra aproveitar essa parte 😊',
          'Essa mensagem veio meio solta por aqui 😅'
        ],
    session.repromptCount + String(step?.objective || '').length
  );

  return `${line}\n${getShortStepRetake(step, session, 'noise_retake_prompt')}`;
}

function isSocialIntent(intent) {
  return ['identity_question', 'process_question', 'message_test', 'noise'].includes(intent);
}

function buildSocialReply(intent, session, step) {
  if (intent === 'identity_question') {
    return buildIdentityReply(session, step);
  }

  if (intent === 'process_question') {
    return buildProcessReply(session, step);
  }

  return buildNoiseReply(session, step, intent);
}

function updateSocialState(session, intent) {
  session.lastUserIntent = intent;

  if (intent === 'identity_question' || intent === 'process_question') {
    session.lastHandledSocialQuestion = intent;
    session.lastBotMode = 'social_reply';
  }

  if (intent === 'message_test' || intent === 'noise') {
    session.lastBotMode = 'noise_recovery';
  }
}

function updateSessionWithModelAnalysis(session, step, analysis, currentDraft, inputMeta = {}) {
  const stepKey = getStepKey(step);
  const sanitizedFields = sanitizeCapturedFields(stepKey, analysis.capturedFields);
  const extractedValue = composeExtractedValue(stepKey, sanitizedFields, analysis.extractedValue || '');
  const stepMemory = upsertStepMemory(session, stepKey, {
    capturedFields: sanitizedFields,
    missingFields: analysis.missingFields,
    confidence: analysis.confidence,
    intent: analysis.intent,
    rawDraft: currentDraft,
    lastExtractedValue: extractedValue
  });

  session.lastModelAnalysis = {
    stepKey,
    satisfactory: analysis.satisfactory,
    confidence: analysis.confidence,
    intent: analysis.intent,
    capturedFields: stepMemory.capturedFields,
    missingFields: stepMemory.missingFields,
    extractedValue,
    originalReply: analysis.reply,
    currentDraft,
    inputMeta,
    timestamp: new Date().toISOString()
  };

  if (inputMeta?.hasSharedContact) {
    appendSemanticEvent(session, 'shared_contact_received', {
      stepKey,
      value: inputMeta.sharedContact
    });
  }

  if (analysis.satisfactory) {
    appendSemanticEvent(session, 'full_answer_detected', {
      stepKey,
      confidence: analysis.confidence,
      extractedValue
    });
  } else if (Object.keys(stepMemory.capturedFields).length > 0 || analysis.intent === 'partial_answer') {
    appendSemanticEvent(session, 'partial_answer_detected', {
      stepKey,
      confidence: analysis.confidence,
      missingFields: stepMemory.missingFields
    });
  } else if (analysis.intent === 'correction') {
    appendSemanticEvent(session, 'correction_detected', {
      stepKey
    });
  } else if (analysis.intent === 'confusion') {
    appendSemanticEvent(session, 'confusion_detected', {
      stepKey
    });
  } else if (analysis.intent === 'off_topic') {
    appendSemanticEvent(session, 'off_topic_detected', {
      stepKey
    });
  }

  return {
    ...analysis,
    extractedValue,
    capturedFields: stepMemory.capturedFields,
    missingFields: stepMemory.missingFields
  };
}

function finalizePendingConfirmation(session, step, value, metadata = {}) {
  const stepKey = getStepKey(step);
  const currentMemory = getStepMemory(session, stepKey);
  const fallbackFieldValue = getExpectedStepFields(stepKey).length === 1
    ? { [getExpectedStepFields(stepKey)[0]]: value }
    : {};

  upsertStepMemory(session, stepKey, {
    capturedFields: Object.keys(currentMemory.capturedFields).length ? currentMemory.capturedFields : fallbackFieldValue,
    missingFields: [],
    confidence: 100,
    intent: 'full_answer',
    rawDraft: '',
    lastExtractedValue: value,
    confirmedValue: value
  });

  session.partialDraft = '';
  session.pendingConfirmation = null;

  appendSemanticEvent(session, 'step_confirmed', {
    stepKey,
    value,
    sourceType: metadata.sourceType || 'text',
    confidence: metadata.confidence ?? 100
  });
}

export async function startQualification(contactId, replyTarget = '') {
  const session = createSession(contactId, replyTarget);
  const hasPreviousIndication = hasIndicationForReferrer(contactId);
  let openingMessage = '';

  appendSemanticEvent(session, 'session_started', {
    replyTarget: replyTarget || contactId
  });

  if (hasPreviousIndication) {
    appendSemanticEvent(session, 'returning_referrer_detected', {});
    openingMessage = buildReturningGreeting();
  } else {
    const firstStep = referralSteps[0];
    const groqResponse = await runReferralStepConversation({
      currentStep: firstStep,
      previousAnswers: [],
      latestUserMessage: '',
      isFirstMessage: true
    });

    openingMessage = groqResponse.reply;
  }

  markBotPresented(session, {
    mode: 'intro'
  });

  saveSession(contactId, session);

  await sendTextMessage({
    number: replyTarget || contactId,
    text: openingMessage
  });

  return session;
}

export async function handleIncomingAnswer({ contactId, text, replyTarget = '', inputMeta = {} }) {
  let session = getSession(contactId);
  const normalizedText = String(text || '').trim().toLowerCase();
  const isGreetingOnly = greetingOnlyMessages.includes(normalizedText);

  if (!session) {
    session = await startQualification(contactId, replyTarget);
    return { status: 'started' };
  }

  if (replyTarget && session.replyTarget !== replyTarget) {
    session.replyTarget = replyTarget;
    appendSemanticEvent(session, 'reply_target_updated', { replyTarget });
    saveSession(contactId, session);
  }

  if (session.status !== 'collecting') {
    return { status: 'ignored' };
  }

  if (isGreetingOnly && session.currentQuestionIndex < referralSteps.length) {
    appendSemanticEvent(session, 'greeting_only_received', {
      stepKey: getStepKey(referralSteps[session.currentQuestionIndex])
    });

    const resumeMessage = buildResumeGreeting(session);
    saveSession(contactId, session);

    await sendTextMessage({
      number: session.replyTarget || contactId,
      text: resumeMessage
    });

    return { status: 'resumed_with_greeting', nextQuestionIndex: session.currentQuestionIndex };
  }

  const currentStep = referralSteps[session.currentQuestionIndex];
  const currentDraft = buildCurrentDraft(session, text);

  if (session.pendingConfirmation && session.pendingConfirmation.stepIndex === session.currentQuestionIndex) {
    if (isAffirmative(text)) {
      const confirmedValue = session.pendingConfirmation.value;
      const confirmationMetadata = {
        confidence: session.pendingConfirmation.confidence,
        sourceType: session.pendingConfirmation.sourceType
      };

      session.answers[session.currentQuestionIndex] = confirmedValue;
      finalizePendingConfirmation(session, currentStep, confirmedValue, confirmationMetadata);
      session.currentQuestionIndex += 1;
      session.repromptCount = 0;

      if (session.currentQuestionIndex < referralSteps.length) {
        const nextStep = referralSteps[session.currentQuestionIndex];
        saveSession(contactId, session);

        await sendTextMessage({
          number: session.replyTarget || contactId,
          text: pickStepPrompt(nextStep, session, {
            kind: 'next_step_prompt',
            seed: session.currentQuestionIndex + session.repromptCount
          })
        });

        return { status: 'next_question', nextQuestionIndex: session.currentQuestionIndex };
      }

      session.status = 'completed';
      saveSession(contactId, session);

      const indication = buildIndicationPayload(session);
      saveIndication(indication);

      appendSemanticEvent(session, 'flow_completed', {
        indication
      });

      await sendTextMessage({
        number: session.replyTarget || contactId,
        text: referralCompletionMessage
      });

      deleteSession(contactId);

      return { status: 'completed', indication };
    }

    if (isNegative(text)) {
      session.repromptCount += 1;
      session.partialDraft = '';
      session.pendingConfirmation = null;
      resetStepMemory(session, currentStep);
      appendSemanticEvent(session, 'confirmation_rejected', {
        stepKey: getStepKey(currentStep)
      });
      saveSession(contactId, session);

      await sendTextMessage({
        number: session.replyTarget || contactId,
        text: buildRetryAfterNegativePrompt(currentStep, session)
      });

      return { status: 'reprompted', reason: 'user_rejected_confirmation' };
    }

    const revisedAnalysis = updateSessionWithModelAnalysis(
      session,
      currentStep,
      await runReferralStepConversation({
        currentStep,
        previousAnswers: session.answers,
        latestUserMessage: text,
        currentDraft,
        inputMeta,
        sessionContext: buildSessionContext(session, currentStep)
      }),
      currentDraft,
      inputMeta
    );

    session.lastUserIntent = revisedAnalysis.intent;

    if (isSocialIntent(revisedAnalysis.intent)) {
      session.partialDraft = '';
      session.repromptCount = 0;
      updateSocialState(session, revisedAnalysis.intent);
      appendSemanticEvent(session, revisedAnalysis.intent, {
        stepKey: getStepKey(currentStep),
        duringConfirmation: true
      });
      saveSession(contactId, session);

      await sendTextMessage({
        number: session.replyTarget || contactId,
        text: buildSocialReply(revisedAnalysis.intent, session, currentStep)
      });

      return {
        status: 'social_reply',
        reason: revisedAnalysis.intent,
        nextQuestionIndex: session.currentQuestionIndex
      };
    }

    if (revisedAnalysis.satisfactory && revisedAnalysis.extractedValue) {
      session.partialDraft = '';
      session.pendingConfirmation = {
        stepIndex: session.currentQuestionIndex,
        value: revisedAnalysis.extractedValue,
        confidence: revisedAnalysis.confidence,
        sourceType: inputMeta?.hasSharedContact ? 'shared_contact' : 'text'
      };
      appendSemanticEvent(session, 'awaiting_confirmation', {
        stepKey: getStepKey(currentStep),
        confidence: revisedAnalysis.confidence
      });
      saveSession(contactId, session);

      await sendTextMessage({
        number: session.replyTarget || contactId,
        text: buildConfirmationPrompt(currentStep, revisedAnalysis.extractedValue, session, {
          sharedContact: Boolean(inputMeta?.hasSharedContact)
        })
      });

      return { status: 'awaiting_confirmation', nextQuestionIndex: session.currentQuestionIndex };
    }

    session.partialDraft = currentDraft;
    session.repromptCount += 1;
    saveSession(contactId, session);

    await sendTextMessage({
      number: session.replyTarget || contactId,
      text: Object.keys(revisedAnalysis.capturedFields || {}).length
        ? buildMissingFieldsReply(currentStep, session, revisedAnalysis.reply)
        : `So pra eu nao registrar errado: eu entendi "${session.pendingConfirmation.value}". Se estiver certinho, pode me responder "sim". Se nao, me manda novamente do jeitinho certo 😊`
    });

    return { status: 'awaiting_confirmation', nextQuestionIndex: session.currentQuestionIndex };
  }

  const analysis = updateSessionWithModelAnalysis(
    session,
    currentStep,
    await runReferralStepConversation({
      currentStep,
      previousAnswers: session.answers,
      latestUserMessage: text,
      currentDraft,
      inputMeta,
      sessionContext: buildSessionContext(session, currentStep)
    }),
    currentDraft,
    inputMeta
  );

  session.lastUserIntent = analysis.intent;

  if (isSocialIntent(analysis.intent)) {
    session.partialDraft = '';
    session.repromptCount = 0;
    updateSocialState(session, analysis.intent);
    appendSemanticEvent(session, analysis.intent, {
      stepKey: getStepKey(currentStep)
    });
    saveSession(contactId, session);

    await sendTextMessage({
      number: session.replyTarget || contactId,
      text: buildSocialReply(analysis.intent, session, currentStep)
    });

    return {
      status: 'social_reply',
      reason: analysis.intent,
      nextQuestionIndex: session.currentQuestionIndex
    };
  }

  if (!analysis.satisfactory) {
    session.partialDraft = currentDraft;
    session.repromptCount += 1;
    session.lastBotMode = 'reprompt';
    saveSession(contactId, session);

    await sendTextMessage({
      number: session.replyTarget || contactId,
      text: Object.keys(analysis.capturedFields || {}).length
        ? buildMissingFieldsReply(currentStep, session, analysis.reply)
        : analysis.reply
    });

    return {
      status: 'reprompted',
      reason: isObviouslyInsufficient(text) ? 'too_short' : analysis.intent === 'partial_answer' ? 'partial_answer' : 'insufficient_context'
    };
  }

  session.pendingConfirmation = {
    stepIndex: session.currentQuestionIndex,
    value: analysis.extractedValue || text,
    confidence: analysis.confidence,
    sourceType: inputMeta?.hasSharedContact ? 'shared_contact' : 'text'
  };
  session.partialDraft = '';
  session.repromptCount = 0;
  session.lastBotMode = 'confirmation';
  appendSemanticEvent(session, 'awaiting_confirmation', {
    stepKey: getStepKey(currentStep),
    confidence: analysis.confidence
  });
  saveSession(contactId, session);

  await sendTextMessage({
    number: session.replyTarget || contactId,
    text: buildConfirmationPrompt(currentStep, session.pendingConfirmation.value, session, {
      sharedContact: Boolean(inputMeta?.hasSharedContact)
    })
  });

  return { status: 'awaiting_confirmation', nextQuestionIndex: session.currentQuestionIndex };
}
