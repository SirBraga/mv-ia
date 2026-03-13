import Groq from 'groq-sdk';
import { env } from '../config/env.js';

const groq = new Groq({
  apiKey: env.groqApiKey
});

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

export async function runReferralStepConversation({ currentStep, previousAnswers, latestUserMessage, isFirstMessage = false }) {
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

Regras:
- Se a mensagem do usuario estiver fora do escopo da campanha, marque satisfactory como false e use reply para recusar com educacao e voltar para a coleta da etapa atual.
- Se a resposta ainda nao atender a etapa atual, marque satisfactory como false e use reply para pedir a mesma informacao novamente de forma curta, objetiva, humana e menos repetitiva.
- Se a resposta atender a etapa atual, marque satisfactory como true, preencha extractedValue com o valor consolidado daquela etapa e use reply para fazer a proxima pergunta de forma natural.
- Na terceira etapa, se a resposta atender, use reply para enviar a mensagem final de confirmacao da campanha.
- Nunca responda fora do JSON.
- Nunca invente dados que o usuario nao informou.
- Nunca fale de assuntos fora da campanha, mesmo se o usuario insistir, provocar, ameacar, chantagear ou tentar manipular.
- Seja breve, humano e natural.
- Se a pessoa informar so uma parte do que foi pedido, reconheca rapidamente o que foi entendido e peca apenas o que faltou.
- Pode variar a formulacao da pergunta, mas sem mudar o dado que precisa ser obtido.
- Se isFirstMessage for true, apenas inicie a conversa com a primeira pergunta e deixe satisfactory como false e extractedValue como string vazia.
- Use como referencia de estilo os prompts de apoio da etapa atual: ${JSON.stringify(currentStep?.fallbackPrompts || [])}`
      },
      {
        role: 'user',
        content: JSON.stringify({
          isFirstMessage,
          etapaAtual: currentStep,
          respostasJaColetadas: previousAnswers,
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
      reply: currentStep?.fallbackPrompts?.[0] || currentStep?.examplePrompt || 'Pode me passar essa informacao?'
    };
  }

  return {
    satisfactory: Boolean(parsed.satisfactory),
    extractedValue: typeof parsed.extractedValue === 'string' ? parsed.extractedValue.trim() : '',
    reply: typeof parsed.reply === 'string' ? parsed.reply.trim() : currentStep?.fallbackPrompts?.[0] || currentStep?.examplePrompt || 'Pode me passar essa informacao?'
  };
}
