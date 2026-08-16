import nock from 'nock';
import { NvidiaProvider } from '../src/providers/NvidiaProvider';
import { ProviderError } from '../src/errors/ProviderError';
import { ChatRequest, ChatResponse, ChatStreamChunk } from '../src/providers/Provider';

const BASE_URL = 'https://api.nv.test/v1';
const MODEL = 'z-ai/glm-5.2';

describe('NvidiaProvider', () => {
    let provider: NvidiaProvider;

    beforeAll(() => {
        process.env.NVIDIA_API_KEY = 'test-nvidia-api-key';
        process.env.NVIDIA_BASE_URL = BASE_URL;
        process.env.NVIDIA_MODEL = MODEL;
    });

    beforeEach(() => {
        // Re-instantiate to clear any potential state, though it's stateless
        provider = new NvidiaProvider();
        nock.cleanAll();
    });

    it('should handle a successful non-streaming chat completion', async () => {
        const mockResponse = {
            id: 'chatcmpl-123',
            object: 'chat.completion',
            created: 1677652288,
            model: MODEL,
            choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };

        nock(BASE_URL)
            .post('/chat/completions')
            .reply(200, mockResponse);

        const result = await provider.chat({
            messages: [{ role: 'user', content: 'Hi' }],
            model: 'ignored'
        });
        expect(result).toEqual(mockResponse);
    });

    it('should handle successful streaming chat completion', async () => {
        const chunks = [
            { id: '1', choices: [{ delta: { content: 'Hel' } }] },
            { id: '1', choices: [{ delta: { content: 'lo!' } }] },
        ];

        const stream = `data: ${JSON.stringify(chunks[0])}\n\ndata: ${JSON.stringify(chunks[1])}\n\ndata: [DONE]\n\n`;

        nock(BASE_URL)
            .post('/chat/completions')
            .reply(200, stream, { 'Content-Type': 'text/event-stream' });

        const result = provider.streamChat({
            messages: [{ role: 'user', content: 'Hi' }],
            model: 'ignored',
            stream: true
        });
        const receivedChunks = [];
        // The original test was incorrect, it should yield ChatStreamChunk objects, not the raw chunks.
        const expectedChunks: ChatStreamChunk[] = [
            { id: '1', delta: { content: 'Hel' } },
            { id: '1', delta: { content: 'lo!' } }
        ];

        for await (const chunk of result as AsyncIterable<ChatStreamChunk>) {
            receivedChunks.push(chunk);
        }

        // We can't compare directly because created/model might be added by the parser.
        expect(receivedChunks.length).toBe(2);
        expect(receivedChunks[0]?.delta.content).toBe('Hel');
        expect(receivedChunks[1]?.delta.content).toBe('lo!');
    });

    it('should handle a successful non-streaming tool call', async () => {
        const mockResponse: ChatResponse = {
            id: 'chatcmpl-tool',
            object: 'chat.completion',
            created: Date.now(),
            model: MODEL,
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [
                            {
                                id: 'call_123',
                                type: 'function',
                                function: {
                                    name: 'run_commands',
                                    arguments: '{"commands":["ls -l"]}',
                                },
                            },
                        ],
                    },
                    finish_reason: 'tool_calls',
                },
            ],
        };

        nock(BASE_URL)
            .post('/chat/completions')
            .reply(200, mockResponse);

        const result = await provider.chat({
            messages: [{ role: 'user', content: 'list files' }],
            tools: [{ type: 'function', function: { name: 'run_commands', parameters: {} } }],
        });

        expect(result.choices[0].finish_reason).toBe('tool_calls');
        expect(result.choices[0].message.tool_calls).toBeDefined();
        expect(result.choices[0].message.tool_calls?.[0].function.name).toBe('run_commands');
    });

    it('should handle a successful streaming tool call', async () => {
        const streamChunks = [
            `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"${MODEL}","choices":[{"index":0,"delta":{"role":"assistant","content":null},"finish_reason":null}]}`,
            `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"${MODEL}","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"run_commands","arguments":""}}]},"finish_reason":null}]}`,
            `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"${MODEL}","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"commands\\":"}}]},"finish_reason":null}]}`,
            `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"${MODEL}","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"[\\"ls -l\\"]}"}}]},"finish_reason":null}]}`,
            `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"${MODEL}","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
            `data: [DONE]`,
        ];

        nock(BASE_URL)
            .post('/chat/completions')
            .reply(200, streamChunks.join('\n\n'), { 'Content-Type': 'text/event-stream' });

        const result = provider.streamChat({
            messages: [{ role: 'user', content: 'list files' }],
            tools: [{ type: 'function', function: { name: 'run_commands', parameters: {} } }],
            stream: true,
        });

        const receivedToolCalls: any[] = [];
        for await (const chunk of result) {
            if (chunk.delta.tool_calls) {
                receivedToolCalls.push(...chunk.delta.tool_calls);
            }
        }

        // Basic check to see if tool calls are being streamed
        expect(receivedToolCalls.length).toBeGreaterThan(0);
        expect(receivedToolCalls.some(tc => tc.function?.name === 'run_commands')).toBe(true);
    });

    it('should correctly extract usage when present', async () => {
        const mockResponse: ChatResponse = {
            id: 'chatcmpl-123',
            object: 'chat.completion',
            created: Date.now(),
            choices: [{ index: 0, message: { role: 'assistant', content: 'test' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
        nock(BASE_URL).post('/chat/completions').reply(200, mockResponse);
        const result = await provider.chat({ messages: [{ role: 'user', content: 'Hi' }] });
        expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    });

    const testError = async (status: number, message: string) => {
        nock(BASE_URL)
            .post('/chat/completions')
            .reply(status, { error: { message } });

        const request: ChatRequest = { messages: [{ role: 'user', content: 'Hi' }] };

        await expect(provider.chat(request)).rejects.toThrow(ProviderError);
        await expect(provider.chat(request)).rejects.toHaveProperty('status', status);
    };

    it('should throw ProviderError for 400 Bad Request', async () => {
        await testError(400, 'Bad request');
    });

    it('should throw ProviderError for 401 Unauthorized', async () => {
        await testError(401, 'Invalid API Key');
    });

    it('should throw ProviderError for 403 Forbidden', async () => {
        await testError(403, 'Forbidden');
    });

    it('should throw ProviderError for 429 Rate Limit Exceeded', async () => {
        await testError(429, 'Rate limit exceeded');
    });

    it('should throw ProviderError for network errors', async () => {
        nock(BASE_URL)
            .post('/chat/completions')
            .replyWithError('Network error');

        const request: ChatRequest = { messages: [{ role: 'user', content: 'Hi' }] };
        await expect(provider.chat(request)).rejects.toThrow('Network error');
    });
});