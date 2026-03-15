export const referralSteps = [
  {
    key: 'customerIdentification',
    objective: 'Obter o nome completo do cliente MV e o nome da empresa dele.',
    expectedData: 'Nome completo do cliente que indicou + nome da empresa cliente MV.',
    examplePrompt: 'Oi! Tudo bem? Eu sou a Drica e vou te ajudar por aqui com a campanha 😊 Para comecarmos, me passa seu nome completo e o nome da sua empresa cliente MV.',
    fallbackPrompts: [
      'Claro! Funciona assim: eu preciso registrar seus dados na campanha. Pode me passar seu nome completo e o nome da sua empresa cliente MV?',
      'Sem problema, eu te explico rapidinho 😊 Para seguir no cadastro, preciso do seu nome completo e do nome da sua empresa cliente MV.',
      'Vou te orientar bem rapidinho: me envia seu nome completo e o nome da sua empresa cliente MV para eu continuar o cadastro.'
    ]
  },
  {
    key: 'referralCompanyAndContact',
    objective: 'Obter o nome da empresa indicada e o nome do responsável nessa empresa.',
    expectedData: 'Nome da empresa indicada + nome do responsável.',
    examplePrompt: 'Perfeito, obrigada! Agora me conta qual e a empresa que voce quer indicar e quem e a pessoa responsavel por la 😊',
    fallbackPrompts: [
      'Para eu seguir com o cadastro, agora preciso do nome da empresa indicada e do nome da pessoa responsavel por ela.',
      'Se preferir, pode me mandar assim: nome da empresa indicada + nome do contato responsavel 😊',
      'Agora so preciso que voce me informe qual e a empresa indicada e quem e o responsavel por la.'
    ]
  },
  {
    key: 'referralPhone',
    objective: 'Obter o WhatsApp ou telefone da pessoa indicada.',
    expectedData: 'WhatsApp ou telefone do responsável indicado.',
    examplePrompt: 'Perfeito! Estamos quase finalizando por aqui 😊 Agora so falta o WhatsApp ou telefone da pessoa indicada.',
    fallbackPrompts: [
      'Pode me enviar o WhatsApp ou telefone desse contato para eu concluir o cadastro?',
      'Agora preciso so do numero da pessoa indicada, pode ser WhatsApp ou telefone 😊',
      'Se preferir, me manda apenas o WhatsApp ou telefone do responsavel indicado.'
    ]
  }
];

export const referralCompletionMessage = 'Perfeito, indicacao registrada com sucesso! 🎉 Assim que validarmos o contato, entraremos em contato com voce para liberar seu Certificado Digital CPF em nuvem. E lembre-se: se eles fecharem contrato, voce ganha 40% de desconto na sua proxima mensalidade!';
