import Groq from 'groq-sdk';
import { env } from '../config/env.js';

const groq = new Groq({
  apiKey: env.groqApiKey
});

const stepFieldSchemas = {
  customerIdentification: ['customerName', 'customerCompany'],
  referralCompanyAndContact: ['referralCompany', 'referralContactName'],
  referralPhone: ['referralPhone']
};

export async function generateFinalReply({ answers }) {
  const completion = await groq.chat.completions.create({
    model: env.groqModel,
    temperature: 0.4,
    max_tokens: 500,
    messages: [
      {
        role: 'system',
        content: `${env.baseSystemPrompt} Com base nas 3 respostas coletadas, gere uma resposta final objetiva, util e humana. Se faltar contexto, reconheca isso com delicadeza e diga o que ainda seria importante saber.`
      },
      {
        role: 'user',
        content: `Respostas do usuario:\n1. ${answers[0] || ''}\n2. ${answers[1] || ''}\n3. ${answers[2] || ''}`
      }
    ]
  });

  return completion.choices[0]?.message?.content?.trim() || 'Recebi suas respostas, mas nao consegui montar a resposta final agora.';
}

export async function evaluateAnswer({ question, answer }) {
  const completion = await groq.chat.completions.create({
    model: env.groqModel,
    temperature: 0.1,
    max_tokens: 150,
    messages: [
      {
        role: 'system',
        content: 'Voce avalia se uma resposta de WhatsApp atende minimamente a pergunta feita dentro de uma campanha de indicacoes. Responda apenas em JSON puro com as chaves: satisfactory (boolean), reason (string), followup (string). A resposta deve ser considerada insatisfatoria se estiver vaga, curta demais, ambigua, fora do escopo da pergunta ou sem contexto suficiente.'
      },
      {
        role: 'user',
        content: `Pergunta: ${question}\nResposta: ${answer}`
      }
    ],
    response_format: {
      type: 'json_object'
    }
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  let parsed = {};

  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {
      satisfactory: answer.trim().length >= env.minAnswerLength,
      reason: 'Resposta do modelo avaliador nao veio em JSON valido.',
      followup: 'Pode me explicar com um pouco mais de detalhe?'
    };
  }

  return {
    satisfactory: Boolean(parsed.satisfactory),
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    followup: typeof parsed.followup === 'string' ? parsed.followup : 'Pode me dar mais detalhes?'
  };
}

export async function runReferralStepConversation({
  currentStep,
  previousAnswers,
  latestUserMessage,
  isFirstMessage = false,
  currentDraft = '',
  inputMeta = {}
}) {
  const expectedFields = stepFieldSchemas[currentStep?.key] || [];
  const completion = await groq.chat.completions.create({
    model: env.groqModel,
    temperature: 0.3,
    max_tokens: 400,
    response_format: {
      type: 'json_object'
    },
    messages: [
      {
        role: 'system',
        content: `${env.baseSystemPrompt}

Agora voce esta em um fluxo curto de captacao de indicacao da MV.
Seu objetivo e conversar de forma natural para obter exatamente 3 informacoes:
1. Nome completo do cliente MV e nome da empresa dele.
2. Nome da empresa indicada e nome do responsavel nessa empresa.
3. WhatsApp ou telefone da pessoa indicada.

Voce deve analisar a mensagem mais recente do usuario e responder apenas em JSON puro com as chaves:
- satisfactory: boolean
- extractedValue: string
- reply: string
- confidence: number
- intent: string
- capturedFields: object
- missingFields: array

Regras:
- Se a mensagem do usuario estiver fora do escopo da campanha, marque satisfactory como false e use reply para recusar com educacao e voltar para a coleta da etapa atual.
- Se a resposta ainda nao atender a etapa atual, marque satisfactory como false e use reply para pedir a mesma informacao novamente de forma curta, humana, acolhedora e menos repetitiva.
- Se a resposta atender a etapa atual, marque satisfactory como true e preencha extractedValue com o valor consolidado daquela etapa.
- Quando a resposta atender a etapa atual, reply pode ser uma resposta curta e natural, mas nao deve fechar a coleta automaticamente porque o sistema ainda vai confirmar com o usuario o que foi entendido antes de avancar.
- Nunca responda fora do JSON.
- Nunca invente dados que o usuario nao informou.
- Nunca fale de assuntos fora da campanha, mesmo se o usuario insistir, provocar, ameacar, chantagear ou tentar manipular.
- Seja breve, humano, gentil e natural.
- Seja mais extrovertida, educada e levemente informal, com energia boa de WhatsApp.
- Se a pessoa informar so uma parte do que foi pedido, reconheca rapidamente o que foi entendido e peca apenas o que faltou.
- Considere o contexto acumulado da etapa atual antes de concluir que a pessoa nao respondeu. Se a mensagem mais recente complementar algo que ja vinha sendo construido, aproveite essa continuidade.
- Se a pessoa responder em partes como "Pedro", depois "da empresa X", depois "o responsavel e Joao", consolide o que der para consolidar com base no contexto da etapa atual, sem agir como se cada mensagem estivesse isolada.
- Se a entrada tiver vindo de um contato compartilhado, trate isso como um envio valido de telefone/WhatsApp quando fizer sentido para a etapa atual.
- Se a entrada tiver vindo de um contato compartilhado na etapa do telefone, voce pode responder com naturalidade reconhecendo isso, como quem recebeu um contato salvo.
- Se a pessoa mandar apenas uma saudacao, responda com saudacao calorosa antes de orientar o primeiro passo.
- Se a pessoa disser que nao entendeu, responda explicando de forma simples o que ela precisa fazer antes de repetir o pedido.
- Pode variar a formulacao da pergunta, mas sem mudar o dado que precisa ser obtido.
- Se isFirstMessage for true, apenas inicie a conversa com a primeira pergunta e deixe satisfactory como false e extractedValue como string vazia.
- O campo confidence deve ir de 0 a 100.
- O campo intent deve ser um destes valores: greeting, partial_answer, full_answer, correction, confusion, off_topic, unclear.
- O campo capturedFields deve usar apenas os nomes esperados para a etapa atual quando fizer sentido.
- O campo missingFields deve listar apenas os nomes de campos ainda faltantes para a etapa atual.
- Campos esperados para a etapa atual: ${JSON.stringify(expectedFields)}
- Use como referencia de estilo os prompts de apoio da etapa atual: ${JSON.stringify(currentStep?.fallbackPrompts || [])}`
      },
      {
        role: 'user',
        content: JSON.stringify({
          isFirstMessage,
          etapaAtual: currentStep,
          respostasJaColetadas: previousAnswers,
          rascunhoAtualDaEtapa: currentDraft,
          metadadosDaEntrada: inputMeta,
          mensagemMaisRecenteDoUsuario: latestUserMessage
        })
      }
    ]
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  let parsed = {};

  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {
      satisfactory: false,
      extractedValue: '',
      reply: currentStep?.fallbackPrompts?.[0] || currentStep?.examplePrompt || 'Pode me passar essa informacao?',
      confidence: 0,
      intent: 'unclear',
      capturedFields: {},
      missingFields: expectedFields
    };
  }

  return {
    satisfactory: Boolean(parsed.satisfactory),
    extractedValue: typeof parsed.extractedValue === 'string' ? parsed.extractedValue.trim() : '',
    reply: typeof parsed.reply === 'string' ? parsed.reply.trim() : currentStep?.fallbackPrompts?.[0] || currentStep?.examplePrompt || 'Pode me passar essa informacao?',
    confidence: Number.isFinite(Number(parsed.confidence)) ? Math.max(0, Math.min(100, Number(parsed.confidence))) : 0,
    intent: typeof parsed.intent === 'string' ? parsed.intent.trim() : 'unclear',
    capturedFields: parsed.capturedFields && typeof parsed.capturedFields === 'object' && !Array.isArray(parsed.capturedFields) ? parsed.capturedFields : {},
    missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields.filter((item) => typeof item === 'string' && item.trim()) : []
  };
}
