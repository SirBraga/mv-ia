import { env } from '../config/env.js';
import { createSession, deleteSession, getSession, saveSession } from '../store/session-store.js';
import { referralCompletionMessage, referralSteps } from '../config/referral-flow.js';
import { sendTextMessage } from '../services/evolution.service.js';
import { runReferralStepConversation } from '../services/groq.service.js';
import { hasIndicationForReferrer, saveIndication } from '../services/indication-store.service.js';

const affirmativeAnswers = ['sim', 's', 'isso', 'isso mesmo', 'certo', 'certo sim', 'correto', 'confirmo', 'confirmado', 'pode seguir', 'pode prosseguir', 'ok', 'okay', 'perfeito', 'exato'];
const negativeAnswers = ['nao', 'não', 'n', 'negativo', 'errado', 'incorreto', 'nao foi isso', 'não foi isso'];

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

  if (session.pendingConfirmation?.stepIndex === session.currentQuestionIndex) {
    return `Oi! Que bom falar com voce de novo 😊 Antes de eu seguir, so quero confirmar uma coisinha: entendi "${session.pendingConfirmation.value}", certo?`;
  }

  return `Oi! Que bom falar com voce de novo. Seu cadastro da campanha ainda nao foi concluido e eu posso continuar de onde paramos.\n\n${fallbackPrompt}`;
}

function isAffirmative(text) {
  return affirmativeAnswers.includes(String(text || '').trim().toLowerCase());
}

function isNegative(text) {
  return negativeAnswers.includes(String(text || '').trim().toLowerCase());
}

function buildConfirmationPrompt(step, value) {
  const labels = {
    customerIdentification: 'seu nome completo e a empresa cliente MV',
    referralCompanyAndContact: 'a empresa indicada e a pessoa responsavel',
    referralPhone: 'o WhatsApp ou telefone da pessoa indicada'
  };

  const label = labels[step?.key] || 'essa informacao';

  return `Perfeito! So pra eu confirmar direitinho: entendi ${label} como "${value}", certo?`;
}

function buildRetryAfterNegativePrompt(step) {
  const fallbackPrompt = step?.fallbackPrompts?.[0] || step?.examplePrompt || 'Pode me passar essa informacao?';

  return `Sem problema! Obrigada por me corrigir 😊 ${fallbackPrompt}`;
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

  if (session.pendingConfirmation && session.pendingConfirmation.stepIndex === session.currentQuestionIndex) {
    if (isAffirmative(text)) {
      session.answers[session.currentQuestionIndex] = session.pendingConfirmation.value;
      session.currentQuestionIndex += 1;
      session.pendingConfirmation = null;
      session.repromptCount = 0;

      if (session.currentQuestionIndex < referralSteps.length) {
        const nextStep = referralSteps[session.currentQuestionIndex];
        saveSession(contactId, session);

        await sendTextMessage({
          number: session.replyTarget || contactId,
          text: nextStep?.examplePrompt || 'Pode me passar a proxima informacao?'
        });

        return { status: 'next_question', nextQuestionIndex: session.currentQuestionIndex };
      }

      session.status = 'completed';
      saveSession(contactId, session);

      const indication = buildIndicationPayload(session);
      saveIndication(indication);

      await sendTextMessage({
        number: session.replyTarget || contactId,
        text: referralCompletionMessage
      });

      deleteSession(contactId);

      return { status: 'completed', indication };
    }

    if (isNegative(text)) {
      session.pendingConfirmation = null;
      session.repromptCount += 1;
      saveSession(contactId, session);

      await sendTextMessage({
        number: session.replyTarget || contactId,
        text: buildRetryAfterNegativePrompt(currentStep)
      });

      return { status: 'reprompted', reason: 'user_rejected_confirmation' };
    }

    const revisedGroqResponse = await runReferralStepConversation({
      currentStep,
      previousAnswers: session.answers,
      latestUserMessage: text
    });

    if (revisedGroqResponse.satisfactory && revisedGroqResponse.extractedValue) {
      session.pendingConfirmation = {
        stepIndex: session.currentQuestionIndex,
        value: revisedGroqResponse.extractedValue
      };
      saveSession(contactId, session);

      await sendTextMessage({
        number: session.replyTarget || contactId,
        text: buildConfirmationPrompt(currentStep, revisedGroqResponse.extractedValue)
      });

      return { status: 'awaiting_confirmation', nextQuestionIndex: session.currentQuestionIndex };
    }

    await sendTextMessage({
      number: session.replyTarget || contactId,
      text: `So pra eu nao registrar errado: o que eu entendi foi "${session.pendingConfirmation.value}". Se estiver certo, me responde "sim". Se nao estiver, pode me mandar novamente do jeitinho correto 😊`
    });

    return { status: 'awaiting_confirmation', nextQuestionIndex: session.currentQuestionIndex };
  }

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

  session.pendingConfirmation = {
    stepIndex: session.currentQuestionIndex,
    value: groqResponse.extractedValue || text
  };
  session.repromptCount = 0;
  saveSession(contactId, session);

  await sendTextMessage({
    number: session.replyTarget || contactId,
    text: buildConfirmationPrompt(currentStep, session.pendingConfirmation.value)
  });

  return { status: 'awaiting_confirmation', nextQuestionIndex: session.currentQuestionIndex };
}
