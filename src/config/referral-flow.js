export const referralSteps = [
  {
    key: 'customerIdentification',
    objective: 'Obter o nome completo do cliente MV e o nome da empresa dele.',
    expectedData: 'Nome completo do cliente que indicou + nome da empresa cliente MV.',
    examplePrompt: 'Oi! Tudo bem? Eu sou a Drica e vou te ajudar por aqui com a campanha 😊 Para começarmos, me passe seu nome completo e o nome da sua empresa cliente MV.',
    fallbackPrompts: [
      'Claro! Funciona assim: eu preciso registrar seus dados na campanha. Pode me passar seu nome completo e o nome da sua empresa cliente MV?',
      'Sem problema, eu te explico rapidinho 😊 Para seguir com o cadastro, preciso do seu nome completo e do nome da sua empresa cliente MV.',
      'Vou te orientar bem rapidinho: me envie seu nome completo e o nome da sua empresa cliente MV para eu continuar o cadastro.',
      'Pra eu dar sequência por aqui, me passe seu nome completo e o nome da sua empresa cliente MV 😊',
      'Vamos começar por essa parte: qual é o seu nome completo e qual é a sua empresa cliente MV?',
      'Se quiser, pode me mandar nesse formato: seu nome completo + nome da sua empresa cliente MV.',
      'Me passe, por favor, seu nome completo e o nome da sua empresa cliente MV para eu seguir com o cadastro.',
      'Pra eu continuar certinho por aqui, só preciso do seu nome completo e do nome da sua empresa cliente MV.'
    ]
  },
  {
    key: 'referralCompanyAndContact',
    objective: 'Obter o nome da empresa indicada e o nome do responsável nessa empresa.',
    expectedData: 'Nome da empresa indicada + nome do responsável.',
    examplePrompt: 'Perfeito, obrigada! Agora me conta qual é a empresa que você quer indicar e quem é a pessoa responsável por lá 😊',
    fallbackPrompts: [
      'Para eu seguir com o cadastro, agora preciso do nome da empresa indicada e do nome da pessoa responsável por ela.',
      'Se preferir, pode me mandar assim: nome da empresa indicada + nome do contato responsável 😊',
      'Agora só preciso que você me informe qual é a empresa indicada e quem é o responsável por lá.',
      'Me conta qual empresa você quer indicar e com quem eu devo falar por lá 😊',
      'Pra eu registrar direitinho, me passe o nome da empresa indicada e o nome da pessoa responsável.',
      'Pode me enviar o nome da empresa indicada e também o nome do contato responsável por ela?',
      'Agora seguimos com a indicação 😊 Qual é a empresa e quem é a pessoa responsável nela?',
      'Se ficar mais fácil, pode mandar assim: empresa indicada / nome do responsável.'
    ]
  },
  {
    key: 'referralPhone',
    objective: 'Obter o WhatsApp ou telefone da pessoa indicada.',
    expectedData: 'WhatsApp ou telefone do responsável indicado.',
    examplePrompt: 'Perfeito! Estamos quase finalizando por aqui 😊 Agora só falta o WhatsApp ou telefone da pessoa indicada.',
    fallbackPrompts: [
      'Pode me enviar o WhatsApp ou telefone desse contato para eu concluir o cadastro?',
      'Agora preciso só do número da pessoa indicada, pode ser WhatsApp ou telefone 😊',
      'Se preferir, me mande apenas o WhatsApp ou telefone do responsável indicado.',
      'Pra eu finalizar aqui, só falta o número desse contato.',
      'Me passe o WhatsApp ou telefone da pessoa indicada e eu já concluo essa etapa 😊',
      'Agora é só o contato: pode me enviar o WhatsApp ou telefone dessa pessoa?',
      'Se tiver o WhatsApp dela, pode me mandar. Se não, o telefone também serve.',
      'Estamos quase lá 😊 Só preciso do WhatsApp ou telefone da pessoa responsável.'
    ]
  }
];

export const referralCompletionMessage = 'Perfeito, indicacao registrada com sucesso! 🎉 Assim que validarmos o contato, entraremos em contato com voce para liberar seu Certificado Digital CPF em nuvem. E lembre-se: se eles fecharem contrato, voce ganha 40% de desconto na sua proxima mensalidade!';
