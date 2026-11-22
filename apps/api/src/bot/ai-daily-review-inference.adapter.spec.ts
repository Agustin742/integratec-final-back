import { describe, expect, it, vi } from 'vitest';
import { AiProviderUnavailableError, type ChatModelPort } from './ai-provider.ports';
import { AiDailyReviewInferenceAdapter } from './ai-daily-review-inference.adapter';

function createAdapter(chatCompletion: ChatModelPort['chatCompletion'], timeoutSeconds = 15) {
  const chatModel: ChatModelPort = { chatCompletion };
  return new AiDailyReviewInferenceAdapter(chatModel, { aiRequestTimeoutSeconds: timeoutSeconds });
}

describe('AiDailyReviewInferenceAdapter', () => {
  it('generates a bounded summary, strips surrounding quotes, and passes configured timeoutMs', async () => {
    const chatCompletion = vi.fn().mockResolvedValue({
      content: '  "Tenés una entrega mañana en Biología. ¡A darle con todo!"  ',
      toolCalls: [],
      usage: { promptTokens: 20, completionTokens: 15 },
    });
    const adapter = createAdapter(chatCompletion, 12);

    const summary = await adapter.generateSummary({
      userId: 'user-1',
      audience: 'STUDENT',
      sections: [
        {
          kind: 'pending',
          items: [
            {
              kind: 'pending_activity',
              title: 'TP 1',
              classroomName: 'Biología',
              dueAt: '2026-11-22T20:00:00.000Z',
              detail: null,
            },
          ],
        },
      ],
    });

    expect(summary).toBe('Tenés una entrega mañana en Biología. ¡A darle con todo!');
    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(chatCompletion.mock.calls[0]?.[0]).toMatchObject({
      timeoutMs: 12_000,
    });
  });

  it('truncates oversized summaries to 400 characters', async () => {
    const longText = 'A'.repeat(450);
    const chatCompletion = vi.fn().mockResolvedValue({
      content: longText,
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 100 },
    });
    const adapter = createAdapter(chatCompletion);

    const summary = await adapter.generateSummary({
      userId: 'user-1',
      audience: 'TEACHER',
      sections: [
        {
          kind: 'pending',
          items: [
            {
              kind: 'teacher_review',
              title: 'TP 1',
              classroomName: 'Historia',
              dueAt: null,
              detail: null,
            },
          ],
        },
      ],
    });

    expect(summary).toHaveLength(400);
  });

  it('returns null without calling chatModel when sections are empty', async () => {
    const chatCompletion = vi.fn();
    const adapter = createAdapter(chatCompletion);

    const summary = await adapter.generateSummary({
      userId: 'user-1',
      audience: 'STUDENT',
      sections: [],
    });

    expect(summary).toBeNull();
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('returns null when summary generation throws a provider error', async () => {
    const chatCompletion = vi.fn().mockRejectedValue(new AiProviderUnavailableError('timeout'));
    const adapter = createAdapter(chatCompletion);

    const summary = await adapter.generateSummary({
      userId: 'user-1',
      audience: 'STUDENT',
      sections: [
        {
          kind: 'news',
          items: [
            {
              kind: 'announcement',
              title: 'Aviso',
              classroomName: 'Física',
              dueAt: null,
              detail: null,
            },
          ],
        },
      ],
    });

    expect(summary).toBeNull();
  });

  it('parses a valid JSON daily question', async () => {
    const chatCompletion = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        prompt: '¿Qué organelo realiza la fotosíntesis?',
        options: ['Cloroplasto', 'Mitocondria'],
        correctOption: 'Cloroplasto',
        materialTitle: 'Célula vegetal',
      }),
      toolCalls: [],
      usage: { promptTokens: 30, completionTokens: 40 },
    });
    const adapter = createAdapter(chatCompletion);

    const question = await adapter.generateDailyQuestion({
      userId: 'user-1',
      materials: [{ classroomName: 'Biología', title: 'Célula vegetal' }],
    });

    expect(question).toEqual({
      prompt: '¿Qué organelo realiza la fotosíntesis?',
      options: ['Cloroplasto', 'Mitocondria'],
      correctOption: 'Cloroplasto',
      materialTitle: 'Célula vegetal',
    });
  });

  it('strips markdown json code fences when parsing daily question output', async () => {
    const chatCompletion = vi.fn().mockResolvedValue({
      content:
        '```json\n{"prompt":"¿Cuál es la capital?","options":["A","B"],"correctOption":"A","materialTitle":null}\n```',
      toolCalls: [],
      usage: { promptTokens: 20, completionTokens: 30 },
    });
    const adapter = createAdapter(chatCompletion);

    const question = await adapter.generateDailyQuestion({
      userId: 'user-1',
      materials: [{ classroomName: 'Geografía', title: 'Mapa político' }],
    });

    expect(question).toEqual({
      prompt: '¿Cuál es la capital?',
      options: ['A', 'B'],
      correctOption: 'A',
      materialTitle: null,
    });
  });

  it('returns null on malformed JSON or invalid question schema', async () => {
    const chatCompletion = vi
      .fn()
      .mockResolvedValueOnce({
        content: 'not valid json {',
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 10 },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          prompt: 'Missing options array',
          options: 'invalid',
          correctOption: 'A',
        }),
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 10 },
      });
    const adapter = createAdapter(chatCompletion);
    const input = {
      userId: 'user-1',
      materials: [{ classroomName: 'Biología', title: 'Guía 1' }],
    };

    expect(await adapter.generateDailyQuestion(input)).toBeNull();
    expect(await adapter.generateDailyQuestion(input)).toBeNull();
  });

  it('returns null when daily question generation throws a provider error', async () => {
    const chatCompletion = vi.fn().mockRejectedValue(new Error('network error'));
    const adapter = createAdapter(chatCompletion);

    const question = await adapter.generateDailyQuestion({
      userId: 'user-1',
      materials: [{ classroomName: 'Biología', title: 'Guía 1' }],
    });

    expect(question).toBeNull();
  });

  it('returns null without calling chatModel when materials list is empty', async () => {
    const chatCompletion = vi.fn();
    const adapter = createAdapter(chatCompletion);

    const question = await adapter.generateDailyQuestion({
      userId: 'user-1',
      materials: [],
    });

    expect(question).toBeNull();
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});
