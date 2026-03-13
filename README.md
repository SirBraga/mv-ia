# MV-IA

Backend em Node.js para integrar WhatsApp via Evolution API com IA do Groq.

## O que esta base faz

- Recebe mensagens da Evolution API por webhook
- Mantem sessao em memoria por contato
- Faz 3 perguntas sequenciais
- Detecta respostas insuficientes ou muito curtas
- Faz repescagem pedindo mais contexto
- Ao final, usa o Groq para gerar uma resposta consolidada

## Variaveis de ambiente

Copie `.env.example` para `.env` e preencha:

- `PORT`
- `GROQ_API_KEY`
- `GROQ_MODEL`
- `EVOLUTION_API_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_INSTANCE`
- `EVOLUTION_WEBHOOK_SECRET`
- `BASE_SYSTEM_PROMPT`
- `MIN_ANSWER_LENGTH`

## Instalar

```bash
npm install
```

## Rodar em desenvolvimento

```bash
npm run dev
```

## Endpoint principal

- `POST /webhook/evolution`

## Fluxo

1. A primeira mensagem inicia a sessao.
2. O bot envia a pergunta 1.
3. Cada resposta do usuario e validada.
4. Se estiver muito curta ou vaga, o bot pede complemento.
5. Quando as 3 perguntas forem respondidas adequadamente, o Groq gera uma resposta final.
6. A sessao e encerrada.

## Observacoes

- Esta base usa armazenamento em memoria. Se quiser persistencia, o proximo passo e plugar Redis ou banco.
- O parser do webhook tenta suportar formatos comuns da Evolution API para mensagens de texto.
- Ajuste o `BASE_SYSTEM_PROMPT` e a lista de perguntas conforme seu caso de uso.
