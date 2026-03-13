import { createApp } from './app.js';
import { env, validateStartupEnv } from './config/env.js';
import { logInfo } from './utils/logger.js';

validateStartupEnv();

const app = createApp();

app.listen(env.port, () => {
  logInfo(`Servidor iniciado na porta ${env.port}`);
});
