export const referralSteps = [
  {
    key: 'customerIdentification',
    objective: 'Obter o nome completo do cliente MV e o nome da empresa dele.',
    expectedData: 'Nome completo do cliente que indicou + nome da empresa cliente MV.',
    examplePrompt: 'Oi! Para eu registrar sua participacao na campanha, me passa seu nome completo e o nome da sua empresa cliente MV.',
    fallbackPrompts: [
      'Para seguir com o cadastro, preciso do seu nome completo e do nome da sua empresa cliente MV.',
      'Me confirma seu nome completo e a empresa cliente MV vinculada a voce, por favor.',
      'Pode me enviar seu nome completo junto com o nome da sua empresa cliente MV?'
    ]
  },
  {
    key: 'referralCompanyAndContact',
    objective: 'Obter o nome da empresa indicada e o nome do responsável nessa empresa.',
    expectedData: 'Nome da empresa indicada + nome do responsável.',
    examplePrompt: 'Perfeito. Agora me fala o nome da empresa indicada e quem e a pessoa responsavel por la.',
    fallbackPrompts: [
      'Agora preciso do nome da empresa indicada e do nome do responsavel nessa empresa.',
      'Pode me passar a empresa que voce quer indicar e o nome do contato responsavel por ela?',
      'Qual e a empresa indicada e quem e a pessoa responsavel nela?'
    ]
  },
  {
    key: 'referralPhone',
    objective: 'Obter o WhatsApp ou telefone da pessoa indicada.',
    expectedData: 'WhatsApp ou telefone do responsável indicado.',
    examplePrompt: 'Agora so falta o WhatsApp ou telefone da pessoa indicada.',
    fallbackPrompts: [
      'Pode me enviar o WhatsApp ou telefone desse contato?',
      'Me passa o numero da pessoa indicada para eu concluir o cadastro.',
      'Qual e o WhatsApp ou telefone do responsavel indicado?'
    ]
  }
];

export const referralCompletionMessage = 'Indicacao registrada! 🎉 Assim que validarmos o contato, entraremos em contato com voce para liberar seu Certificado Digital CPF em nuvem. E lembre-se: se eles fecharem contrato, voce ganha 40% de desconto na sua proxima mensalidade!';
