import express from 'express';
import { logger } from '../logging/logger';
import { GeminiProvider } from '../providers/GeminiProvider';
import { GroqProvider } from '../providers/GroqProvider';
import { MockProvider } from '../providers/MockProvider';
import { OpenRouterProvider } from '../providers/OpenRouterProvider';
import { NvidiaProvider } from '../providers/NvidiaProvider';
import { ChatStreamChunk, Provider } from '../providers/Provider';
import { Router } from '../router/Router';
import { QuotaManager } from '../quota/QuotaManager';
import { ChatCompletionRequest, ChatRequest } from '../types';

function createConfiguredProviders(): Provider[] {
  const providers: Provider[] = [];
  providers.push(new GeminiProvider(process.env.GEMINI_API_KEY ?? ''));
  providers.push(new GroqProvider(process.env.GROQ_API_KEY ?? ''));
  providers.push(new NvidiaProvider());
  providers.push(new OpenRouterProvider(process.env.OPENROUTER_API_KEY ?? ''));

  if (providers.length === 0) {
    providers.push(new MockProvider());
    logger.warn('No external providers configured or keys missing. Router is falling back to MockProvider.');
  }
  return providers;
}

export function createApp(providers?: Provider[], quotaManager?: QuotaManager) {
  const app = express();
  app.use(express.json());
  const router = new Router(providers ?? createConfiguredProviders(), quotaManager);

  app.get('/v1/models', async (_req, res) => {
    logger.info('GET /v1/models');

    const models = await router.getModels();

    return res.json({
      data: models
    });
  });

  app.post('/v1/chat/completions', async (req, res) => {
    logger.master('created', { method: 'POST', path: '/v1/chat/completions' });
    const body = req.body as ChatCompletionRequest;

    if (!body || !Array.isArray(body.messages)) {
      logger.warn('Bad request: missing messages');
      return res.status(400).json({ error: 'Invalid request: messages required' });
    }

    try {
      const request: ChatRequest = {
        model: body.model || 'router-auto',
        messages: body.messages,
        temperature: body.temperature,
        stream: body.stream === true,
        tools: body.tools,
        tool_choice: body.tool_choice,
      };

      if (request.stream) {
        return streamResponse(router, request, body.messages.length, req, res);
      }

      const response = await router.route(request);

      logger.master('summary', { messages: body.messages.length });

      logger.router('response', { provider: response.model ?? 'router-auto', status: 200 });

      return res.json(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.router('error', { message: errorMessage, status: 503 });
      return res.status(503).json({
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'provider_unavailable'
        }
      });
    }
  });

  return app;
}

async function streamResponse(
  router: Router,
  request: ChatRequest,
  messageCount: number,
  req: express.Request,
  res: express.Response
): Promise<void> {
  const controller = new AbortController();
  const abortOnClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.once('close', abortOnClose);
  let started = false;

  try {
    for await (const chunk of router.routeStream(request, controller.signal)) {
      if (controller.signal.aborted) return;
      if (!started) {
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        started = true;
      }
      res.write(`data: ${JSON.stringify(toOpenAiStreamChunk(chunk, request))}\n\n`);
    }
    if (started && !controller.signal.aborted) {
      res.write('data: [DONE]\n\n');
      logger.router('stream_completed', { messages: messageCount });
      res.end();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown stream error';
    logger.router('error', { message: errorMessage, status: 500 });
    if (!started) {
      logger.router('response', { status: 503 });
      res.status(503).json(openAiError(errorMessage));
      return;
    }
    if (!controller.signal.aborted) {
      res.write(`data: ${JSON.stringify(streamErrorChunk(errorMessage, request))}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } finally {
    res.off('close', abortOnClose);
  }
}

function toOpenAiStreamChunk(chunk: ChatStreamChunk, request: ChatRequest) {
  return {
    id: chunk.id ?? `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: chunk.created ?? Math.floor(Date.now() / 1000),
    model: chunk.model ?? request.model ?? 'router-auto',
    choices: [{ index: 0, delta: chunk.delta, finish_reason: chunk.finish_reason ?? null }],
    ...(chunk.usage ? { usage: chunk.usage } : {})
  };
}

function streamErrorChunk(message: string, request: ChatRequest) {
  return {
    ...toOpenAiStreamChunk({ delta: { content: '' }, finish_reason: 'error' }, request),
    error: { message, type: 'server_error', code: 'stream_interrupted' }
  };
}

function openAiError(message: string) {
  return { error: { message, type: 'server_error', code: 'provider_unavailable' } };
}

const app = createApp();

if (require.main === module) {
  const port = parseInt(process.env.PORT || '3040', 10);

  app.listen(port, () => {
    logger.info(`AI Provider Router listening on port ${port}`);
  });
}

export { app };
