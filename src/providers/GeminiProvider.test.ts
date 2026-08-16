import nock from 'nock';
import { GeminiProvider, toGeminiContents } from './GeminiProvider';
import { ChatRequest } from './Provider';

const API_KEY = 'test-gemini-api-key';
const BASE_URL = 'https://generativelanguage.googleapis.com';

describe('GeminiProvider', () => {
    let provider: GeminiProvider;

    beforeEach(() => {
        provider = new GeminiProvider(API_KEY);
        nock.cleanAll();
    });

    it('should handle a simple chat completion', async () => {
        nock(BASE_URL)
            .post('/v1beta/models/gemini-1.5-flash-latest:generateContent')
            .reply(200, {
                candidates: [{
                    content: { parts: [{ text: 'Hello from Gemini' }] },
                    finishReason: 'STOP',
                }],
            });

        const response = await provider.chat({ messages: [{ role: 'user', content: 'Hi' }] });
        expect(response.choices[0].message.content).toBe('Hello from Gemini');
    });

    it('should handle a simple streaming chat completion', async () => {
        const stream = `data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\ndata: {"candidates":[{"content":{"parts":[{"text":" Gemini"}]}}]}`;

        nock(BASE_URL)
            .post('/v1beta/models/gemini-1.5-flash-latest:streamGenerateContent')
            .reply(200, stream, { 'Content-Type': 'text/event-stream' });

        const result = provider.streamChat({ messages: [{ role: 'user', content: 'Hi' }] });
        const receivedChunks = [];
        for await (const chunk of result) {
            receivedChunks.push(chunk);
        }

        expect(receivedChunks.length).toBe(2);
        expect(receivedChunks[0].delta.content).toBe('Hello');
        expect(receivedChunks[1].delta.content).toBe(' Gemini');
    });

    it('should correctly convert a tool calling cycle to Gemini format', () => {
        const messages: ChatRequest['messages'] = [
            { role: 'user', content: 'What is the weather in Paris?' },
            {
                role: 'assistant',
                content: null, // Assistant message with only tool calls
                tool_calls: [
                    {
                        id: 'get_weather_123',
                        type: 'function',
                        function: { name: 'get_weather', arguments: '{"location": "Paris"}' },
                    },
                ],
            },
            {
                role: 'tool',
                tool_call_id: 'get_weather_123',
                content: '{"temperature": "22°C"}', // Result of the tool call
            },
        ];

        const geminiContents = toGeminiContents(messages);

        // Check assistant message conversion
        expect(geminiContents[1].role).toBe('model');
        expect(geminiContents[1].parts[0].function_call).toEqual({ name: 'get_weather', args: { location: 'Paris' } });

        // Check tool message conversion
        expect(geminiContents[2].role).toBe('tool');
        expect(geminiContents[2].parts[0].function_response).toEqual({ name: 'get_weather_123', response: { content: '{"temperature": "22°C"}' } });
    });

    it('should sanitize unsupported JSON schema properties from tool parameters', () => {
        const schemaWithUnsupportedFields = {
            type: 'object',
            properties: {
                age: {
                    type: 'number',
                    description: 'The age',
                    exclusiveMinimum: 18, // Unsupported field
                },
                name: {
                    type: 'string',
                },
            },
            required: ['age'],
        };

        const sanitized = sanitizeSchema(schemaWithUnsupportedFields);

        // Check that the unsupported field is gone
        expect(sanitized.properties.age.exclusiveMinimum).toBeUndefined();

        // Check that supported fields remain
        expect(sanitized.properties.age.type).toBe('number');
        expect(sanitized.properties.name.type).toBe('string');
    });

    it('should sanitize "additionalProperties" from tool parameters', () => {
        const schemaWithUnsupportedFields = {
            type: 'object',
            properties: {
                user: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' }
                    },
                    additionalProperties: false, // Unsupported field
                },
            },
        };

        const sanitized = sanitizeSchema(schemaWithUnsupportedFields);

        // Check that the unsupported field is gone
        expect(sanitized.properties.user.additionalProperties).toBeUndefined();

        // Check that supported fields remain
        expect(sanitized.properties.user.type).toBe('object');
    });

    it('should sanitize "$schema" from tool parameters', () => {
        const schemaWithUnsupportedFields = {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: {
                name: { type: 'string' }
            },
        };

        const sanitized = sanitizeSchema(schemaWithUnsupportedFields);

        // Check that the unsupported field is gone
        expect(sanitized.$schema).toBeUndefined();

        // Check that supported fields remain
        expect(sanitized.type).toBe('object');
    });

    it('should throw a MODEL_UNAVAILABLE error for a specific 404 message', async () => {
        const errorResponse = {
            error: {
                code: 404,
                message: 'This model is no longer available to new users.',
                status: 'NOT_FOUND',
            },
        };

        nock(BASE_URL)
            .post('/v1beta/models/gemini-1.5-flash-latest:generateContent')
            .reply(404, errorResponse);

        const request: ChatRequest = { messages: [{ role: 'user', content: 'Hi' }] };

        await expect(provider.chat(request)).rejects.toThrow(ProviderError);
        await expect(provider.chat(request)).rejects.toHaveProperty('category', 'MODEL_UNAVAILABLE');
    });
});