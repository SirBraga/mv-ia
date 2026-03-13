export const referralSteps = [
  {
    key: 'customerIdentification',
    objective: 'Obter o nome completo do cliente MV e o nome da empresa dele.',
    expectedData: 'Nome completo do cliente que indicou + nome da empresa cliente MV.',
    examplePrompt: 'Olá! Que bom que você está participando da nossa campanha. Para começarmos, qual o seu nome completo e o nome da sua empresa cliente MV?'
  },
  {
    key: 'referralCompanyAndContact',
    objective: 'Obter o nome da empresa indicada e o nome do responsável nessa empresa.',
    expectedData: 'Nome da empresa indicada + nome do responsável.',
    examplePrompt: 'Perfeito! Agora, qual o nome da empresa que você está indicando e o nome do responsável lá?'
  },
  {
    key: 'referralPhone',
    objective: 'Obter o WhatsApp ou telefone da pessoa indicada.',
    expectedData: 'WhatsApp ou telefone do responsável indicado.',
    examplePrompt: 'Pode nos passar o WhatsApp ou telefone dessa pessoa que você indicou?'
  }
];

export const referralCompletionMessage = 'Indicacao registrada! 🎉 Assim que validarmos o contato, entraremos em contato com voce para liberar seu Certificado Digital CPF em nuvem. E lembre-se: se eles fecharem contrato, voce ganha 40% de desconto na sua proxima mensalidade!';
