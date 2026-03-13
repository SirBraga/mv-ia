import { env } from '../config/env.js';
import { createSession, deleteSession, getSession, saveSession } from '../store/session-store.js';
import { referralCompletionMessage, referralSteps } from '../config/referral-flow.js';
import { sendTextMessage } from '../services/evolution.service.js';
import { runReferralStepConversation } from '../services/groq.service.js';
import { hasIndicationForReferrer, saveIndication } from '../services/indication-store.service.js';

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

function buildResumeGreeting(session) {
  const currentStep = referralSteps[session.currentQuestionIndex];
  const fallbackPrompt = currentStep?.fallbackPrompts?.[0] || currentStep?.examplePrompt || 'Pode me passar essa informacao?';

  return `Oi! Que bom falar com voce de novo. Seu cadastro da campanha ainda nao foi concluido e eu posso continuar de onde paramos.\n\n${fallbackPrompt}`;
}

function buildReturningGreeting() {
  return 'Oi! Que bom ter voce de volta por aqui 😊 Se quiser fazer uma nova indicacao na campanha, eu sigo com voce. Para comecarmos, me passa seu nome completo e o nome da sua empresa cliente MV.';
}

export async function startQualification(contactId, replyTarget = '') {
  const session = createSession(contactId, replyTarget);
  const hasPreviousIndication = hasIndicationForReferrer(contactId);
  let openingMessage = '';

  if (hasPreviousIndication) {
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

  await sendTextMessage({
    number: replyTarget || contactId,
    text: openingMessage
  });

  return session;
}

export async function handleIncomingAnswer({ contactId, text, replyTarget = '' }) {
  let session = getSession(contactId);
  const normalizedText = String(text || '').trim().toLowerCase();
  const isGreetingOnly = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'opa'].includes(normalizedText);

  if (!session) {
    session = await startQualification(contactId, replyTarget);
    return { status: 'started' };
  }

  if (replyTarget && session.replyTarget !== replyTarget) {
    session.replyTarget = replyTarget;
    saveSession(contactId, session);
  }

  if (session.status !== 'collecting') {
    return { status: 'ignored' };
  }

  if (isGreetingOnly && session.currentQuestionIndex < referralSteps.length) {
    const resumeMessage = buildResumeGreeting(session);

    await sendTextMessage({
      number: session.replyTarget || contactId,
      text: resumeMessage
    });

    return { status: 'resumed_with_greeting', nextQuestionIndex: session.currentQuestionIndex };
  }

  const currentStep = referralSteps[session.currentQuestionIndex];
  const groqResponse = await runReferralStepConversation({
    currentStep,
    previousAnswers: session.answers,
    latestUserMessage: text
  });

  if (isObviouslyInsufficient(text) && !groqResponse.satisfactory) {
    session.repromptCount += 1;
    saveSession(contactId, session);

    await sendTextMessage({
      number: session.replyTarget || contactId,
      text: groqResponse.reply
    });

    return { status: 'reprompted', reason: 'too_short' };
  }

  if (!groqResponse.satisfactory) {
    session.repromptCount += 1;
    saveSession(contactId, session);

    await sendTextMessage({
      number: session.replyTarget || contactId,
      text: groqResponse.reply
    });

    return { status: 'reprompted', reason: 'insufficient_context' };
  }

  session.answers[session.currentQuestionIndex] = groqResponse.extractedValue || text;
  session.currentQuestionIndex += 1;
  session.repromptCount = 0;

  if (session.currentQuestionIndex < referralSteps.length) {
    saveSession(contactId, session);

    await sendTextMessage({
      number: session.replyTarget || contactId,
      text: groqResponse.reply
    });

    return { status: 'next_question', nextQuestionIndex: session.currentQuestionIndex };
  }

  session.status = 'completed';
  saveSession(contactId, session);

  const indication = buildIndicationPayload(session);
  saveIndication(indication);

  await sendTextMessage({
    number: session.replyTarget || contactId,
    text: groqResponse.reply || referralCompletionMessage
  });

  deleteSession(contactId);

  return { status: 'completed', indication };
}
