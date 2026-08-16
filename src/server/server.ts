import express from 'express';
import config from '../config/config';
import { logger } from '../logging/logger';
import { GeminiProvider } from '../providers/GeminiProvider';
import { GroqProvider } from '../providers/GroqProvider';
import { MockProvider } from '../providers/MockProvider';
import { OpenRouterProvider } from '../providers/OpenRouterProvider';
import { Provider } from '../providers/Provider';
import { Router } from '../router/Router';
import { ChatCompletionRequest, ChatRequest } from '../types';

const app = express();
app.use(express.json());

const providers: Provider[] = [];

if (config.providers.gemini.enabled) {
  providers.push(new GeminiProvider(process.env.GEMINI_API_KEY ?? ''));
}

if (config.providers.groq.enabled) {
  providers.push(new GroqProvider(process.env.GROQ_API_KEY ?? ''));
}

if (config.providers.openrouter.enabled) {
  providers.push(new OpenRouterProvider(process.env.OPENROUTER_API_KEY ?? ''));
}

if (providers.length === 0) {
  providers.push(new MockProvider());
  logger.warn('No external providers configured or keys missing. Router is falling back to MockProvider.');
}

const router = new Router(providers);

app.get('/v1/models', async (_req, res) => {
  logger.info('GET /v1/models');

  const models = await router.getModels();

  return res.json({
    data: models
  });
});

app.post('/v1/chat/completions', async (req, res) => {
  logger.info('Request received: POST /v1/chat/completions');
  const body = req.body as ChatCompletionRequest;

  if (!body || !Array.isArray(body.messages)) {
    logger.warn('Bad request: missing messages');
    return res.status(400).json({ error: 'Invalid request: messages required' });
  }

  try {
    const request: ChatRequest = {
      model: body.model || 'router-auto',
      messages: body.messages,
      temperature: body.temperature
    };

    const response = await router.route(request);

    logger.info(`Provider selected: ${response.model ?? 'router-auto'}`);
    logger.info(`Request summary: ${body.messages.length} messages`);

    return res.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Router error: ${errorMessage}`);
    return res.status(503).json({ error: 'No available provider' });
  }
});

if (require.main === module) {
  const port = config.server.port || 3040;

  app.listen(port, () => {
    logger.info(`AI Provider Router listening on port ${port}`);
  });
}

export { app };
