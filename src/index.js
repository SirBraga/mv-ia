import { createApp } from './app.js';
import { env, validateStartupEnv } from './config/env.js';
import { clearAllSessions } from './store/session-store.js';
import { logInfo } from './utils/logger.js';

validateStartupEnv();
clearAllSessions();
logInfo('Sessoes em aberto foram limpas na inicializacao para facilitar os testes.');

const app = createApp();

app.listen(env.port, () => {
  logInfo(`Servidor iniciado na porta ${env.port}`);
});
