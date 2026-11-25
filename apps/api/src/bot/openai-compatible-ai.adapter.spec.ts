import { describe, expect, it, vi } from 'vitest';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { AiProviderUnavailableError } from './ai-provider.ports';
import { OpenAiCompatibleAiAdapter } from './openai-compatible-ai.adapter';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('OpenAiCompatibleAiAdapter', () => {
  it('fails closed without HTTP calls when AI_PROVIDER_API_KEY is missing', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const adapter = new OpenAiCompatibleAiAdapter(authTestConfig({ aiProviderApiKey: undefined }), {
      fetchFn: fetchMock,
    });

    await expect(adapter.embed(['hello'])).rejects.toBeInstanceOf(AiProviderUnavailableError);
    await expect(
      adapter.chatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(AiProviderUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls /embeddings with configured model/dimensions and orders vectors by index', async () => {
    const v0 = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
    const v1 = Array.from({ length: 768 }, (_, i) => (i === 1 ? 1 : 0));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        data: [
          { index: 1, embedding: v1 },
          { index: 0, embedding: v0 },
        ],
        usage: { total_tokens: 18 },
      }),
    );
    const adapter = new OpenAiCompatibleAiAdapter(
      authTestConfig({
        aiProviderApiKey: 'synthetic-key-for-unit-test',
        aiProviderBaseUrl: 'https://ai.example.test/v1/',
        aiEmbeddingModel: 'gemini-embedding-001',
        aiEmbeddingDimension: 768,
      }),
      { fetchFn: fetchMock },
    );

    const result = await adapter.embed(['first', 'second']);
    expect(result.vectors).toEqual([v0, v1]);
    expect(result.totalTokens).toBe(18);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://ai.example.test/v1/embeddings');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer synthetic-key-for-unit-test',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'gemini-embedding-001',
      input: ['first', 'second'],
      dimensions: 768,
    });
  });

  it('rejects embeddings whose vector dimension does not match config', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        data: [{ index: 0, embedding: [0.1, 0.2] }],
      }),
    );
    const adapter = new OpenAiCompatibleAiAdapter(
      authTestConfig({ aiProviderApiKey: 'synthetic-key', aiEmbeddingDimension: 768 }),
      { fetchFn: fetchMock },
    );

    await expect(adapter.embed(['hello'])).rejects.toBeInstanceOf(AiProviderUnavailableError);
  });

  it('treats an omitted index as 0, as Gemini does', async () => {
    const v0 = [1, 0];
    const v1 = [0, 1];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        data: [{ index: 1, embedding: v1 }, { embedding: v0 }],
      }),
    );
    const adapter = new OpenAiCompatibleAiAdapter(
      authTestConfig({ aiProviderApiKey: 'synthetic-key', aiEmbeddingDimension: 2 }),
      { fetchFn: fetchMock },
    );

    const result = await adapter.embed(['first', 'second']);
    expect(result.vectors).toEqual([v0, v1]);
  });

  it.each([
    ['duplicate', [{ index: 1 }, { index: 1 }]],
    ['repeatedly omitted', [{}, {}]],
    ['omitted and explicit zero', [{}, { index: 0 }]],
    ['out-of-range', [{}, { index: 2 }]],
    ['null', [{ index: null }, { index: 1 }]],
  ])('rejects embeddings with %s indexes', async (_label, items) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ data: items.map((item) => ({ ...item, embedding: [1, 0] })) }),
      );
    const adapter = new OpenAiCompatibleAiAdapter(
      authTestConfig({ aiProviderApiKey: 'synthetic-key', aiEmbeddingDimension: 2 }),
      { fetchFn: fetchMock },
    );

    await expect(adapter.embed(['first', 'second'])).rejects.toBeInstanceOf(
      AiProviderUnavailableError,
    );
  });

  it('parses chat completions with tool calls and usage', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'search_allowed_material',
                    arguments: '{"query":"mitochondria"}',
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 24 },
      }),
    );
    const adapter = new OpenAiCompatibleAiAdapter(
      authTestConfig({
        aiProviderApiKey: 'synthetic-key',
        aiProviderBaseUrl: 'https://ai.example.test/v1',
        aiChatModel: 'gemini-3.8-flash',
      }),
      { fetchFn: fetchMock },
    );

    const result = await adapter.chatCompletion({
      messages: [{ role: 'user', content: 'What is ATP?' }],
      tools: [
        {
          name: 'search_allowed_material',
          description: 'Search material',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      ],
    });

    expect(result).toEqual({
      content: null,
      toolCalls: [
        {
          id: 'call_1',
          name: 'search_allowed_material',
          argumentsJson: '{"query":"mitochondria"}',
        },
      ],
      usage: { promptTokens: 120, completionTokens: 24 },
    });
  });

  it('round-trips per-call provider context unchanged on the exact tool call', async () => {
    const extraContent = { google: { thought_signature: 'synthetic-signature' } };
    const wireCalls = [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'search_allowed_material', arguments: '{"query":"atp"}' },
        extra_content: extraContent,
      },
      // With parallel calls Gemini signs only the first one.
      {
        id: 'call_2',
        type: 'function',
        function: { name: 'list_my_pending_activities', arguments: '{}' },
      },
    ];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: null, tool_calls: wireCalls } }] }),
      )
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Done' } }] }));
    const adapter = new OpenAiCompatibleAiAdapter(
      authTestConfig({ aiProviderApiKey: 'synthetic-key' }),
      { fetchFn: fetchMock },
    );

    const first = await adapter.chatCompletion({ messages: [{ role: 'user', content: 'hi' }] });
    expect(first.toolCalls[0]?.providerContext).toEqual(extraContent);
    expect(first.toolCalls[1]).not.toHaveProperty('providerContext');

    await adapter.chatCompletion({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: null, toolCalls: first.toolCalls },
        { role: 'tool', toolCallId: 'call_1', content: '{}' },
        { role: 'tool', toolCallId: 'call_2', content: '{}' },
      ],
    });
    const sent = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)) as {
      messages: Array<{ tool_calls?: unknown }>;
    };
    expect(sent.messages[1]?.tool_calls).toStrictEqual(wireCalls);
  });

  it('retries transient 503 errors up to aiMaxRetries and never retries 401 or echoes secrets', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'busy' } }, 503))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: 'Guided answer' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      );
    const adapter = new OpenAiCompatibleAiAdapter(
      authTestConfig({
        aiProviderApiKey: 'secret-never-echo',
        aiMaxRetries: 1,
      }),
      { fetchFn: fetchMock, retryBaseDelayMs: 0 },
    );

    const ok = await adapter.chatCompletion({
      messages: [{ role: 'user', content: 'Secret prompt text' }],
    });
    expect(ok.content).toBe('Guided answer');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'invalid secret-never-echo' } }, 401),
    );
    await expect(
      adapter.chatCompletion({
        messages: [{ role: 'user', content: 'Secret prompt text' }],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AiProviderUnavailableError);
      expect(String(error)).not.toContain('secret-never-echo');
      expect(String(error)).not.toContain('Secret prompt text');
      return true;
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
