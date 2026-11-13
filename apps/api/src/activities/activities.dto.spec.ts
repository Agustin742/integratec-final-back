import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  CreateActivityDto,
  ListActivitiesQueryDto,
  StudentActivityResponseDto,
  type StudentOptionDto,
  UpdateActivityDto,
} from './activities.dto';
import { futureInstant, withOffset } from '../testing/relative-dates';

const validOptions = [
  { label: 'Paris', isCorrect: true },
  { label: 'Rome', isCorrect: false },
];
const tp = {
  type: 'TP',
  format: 'FILE',
  title: 'Essay',
  dueAt: futureInstant(30, 15).toISOString(),
  maxScore: 10,
};
const mc = {
  ...tp,
  type: 'EXAM',
  format: 'MULTIPLE_CHOICE',
  questions: [{ prompt: 'Capital of France?', options: validOptions }],
};

// Same options as the global pipe: whitelist + forbidNonWhitelisted.
const check = async <T extends object>(cls: new () => T, plain: object) => {
  const instance = plainToInstance(cls, plain);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return { instance, errors };
};
const failing = (errors: ValidationError[]) => errors.map((e) => e.property);

describe('CreateActivityDto', () => {
  it('accepts a valid TP and leaves defaults to the service', async () => {
    const { instance, errors } = await check(CreateActivityDto, tp);
    expect(errors).toEqual([]);
    expect(instance.allowLate).toBeUndefined();
    expect(instance.weightMultiplier).toBeUndefined();
  });
  it('accepts a valid multiple-choice exam with opensAt', async () => {
    const { errors } = await check(CreateActivityDto, {
      ...mc,
      opensAt: withOffset(futureInstant(30, 15), '-03:00'),
    });
    expect(errors).toEqual([]);
  });
  it('trims the title', async () => {
    const { instance, errors } = await check(CreateActivityDto, { ...tp, title: '  Essay  ' });
    expect(errors).toEqual([]);
    expect(instance.title).toBe('Essay');
  });
  it.each([
    ['title too long', { title: 'x'.repeat(121) }, 'title'],
    ['blank title', { title: '   ' }, 'title'],
    ['description too long', { description: 'x'.repeat(5001) }, 'description'],
    ['maxScore 101', { maxScore: 101 }, 'maxScore'],
    ['maxScore -1', { maxScore: -1 }, 'maxScore'],
    ['fractional maxScore', { maxScore: 5.5 }, 'maxScore'],
    ['weight 0.4', { weightMultiplier: 0.4 }, 'weightMultiplier'],
    ['weight 3.01', { weightMultiplier: 3.01 }, 'weightMultiplier'],
    ['weight 3 decimals', { weightMultiplier: 1.255 }, 'weightMultiplier'],
    ['dueAt without offset', { dueAt: futureInstant(30, 15).toISOString().slice(0, 19) }, 'dueAt'],
    ['dueAt not a date', { dueAt: 'tomorrow' }, 'dueAt'],
    ['opensAt not a date', { opensAt: '2026-13-45' }, 'opensAt'],
    ['unknown type', { type: 'QUIZ' }, 'type'],
    ['unknown property', { secret: 'x' }, 'secret'],
    ['FILE with questions', { questions: mc.questions }, 'questions'],
  ])('rejects %s', async (_name, patch, field) => {
    const { errors } = await check(CreateActivityDto, { ...tp, ...patch });
    expect(failing(errors)).toContain(field);
  });

  it('rejects a missing dueAt', async () => {
    const rest: Partial<typeof tp> = { ...tp };
    delete rest.dueAt;
    const { errors } = await check(CreateActivityDto, rest);
    expect(failing(errors)).toContain('dueAt');
  });
  it('rejects multiple choice without questions', async () => {
    const rest: Partial<typeof mc> = { ...mc };
    delete rest.questions;
    const { errors } = await check(CreateActivityDto, rest);
    expect(failing(errors)).toContain('questions');
  });
  it('rejects an empty or oversized question list', async () => {
    const empty = await check(CreateActivityDto, { ...mc, questions: [] });
    expect(failing(empty.errors)).toContain('questions');
    const many = await check(CreateActivityDto, {
      ...mc,
      questions: Array.from({ length: 51 }, () => mc.questions[0]),
    });
    expect(failing(many.errors)).toContain('questions');
  });
  it.each([
    ['a single option', [{ label: 'Only', isCorrect: true }]],
    [
      'seven options',
      Array.from({ length: 7 }, (_, i) => ({ label: `o${i}`, isCorrect: i === 0 })),
    ],
    [
      'zero correct options',
      [
        { label: 'a', isCorrect: false },
        { label: 'b', isCorrect: false },
      ],
    ],
    [
      'two correct options',
      [
        { label: 'a', isCorrect: true },
        { label: 'b', isCorrect: true },
      ],
    ],
    [
      'an unknown option property',
      [
        { label: 'a', isCorrect: true, hint: 'x' },
        { label: 'b', isCorrect: false },
      ],
    ],
    [
      'a blank option label',
      [
        { label: ' ', isCorrect: true },
        { label: 'b', isCorrect: false },
      ],
    ],
  ])('rejects a question with %s', async (_name, options) => {
    const { errors } = await check(CreateActivityDto, {
      ...mc,
      questions: [{ prompt: 'Q?', options }],
    });
    expect(failing(errors)).toEqual(['questions']);
  });
  it('rejects a blank or oversized question prompt', async () => {
    for (const prompt of [' ', 'x'.repeat(1001)]) {
      const { errors } = await check(CreateActivityDto, {
        ...mc,
        questions: [{ prompt, options: validOptions }],
      });
      expect(failing(errors)).toEqual(['questions']);
    }
  });
});

describe('CreateActivityDto optional fields', () => {
  it.each(['opensAt', 'description', 'allowLate', 'weightMultiplier'])(
    'rejects an explicit null for %s (absent is fine)',
    async (field) => {
      expect((await check(CreateActivityDto, tp)).errors).toEqual([]);
      const res = await check(CreateActivityDto, { ...tp, [field]: null });
      expect(failing(res.errors)).toEqual([field]);
    },
  );
});

describe('UpdateActivityDto explicit nulls', () => {
  it.each([
    'title',
    'description',
    'opensAt',
    'dueAt',
    'allowLate',
    'maxScore',
    'weightMultiplier',
    'questions',
  ])('rejects an explicit null for %s', async (field) => {
    const res = await check(UpdateActivityDto, { [field]: null });
    expect(failing(res.errors)).toEqual([field]);
  });
});

describe('ListActivitiesQueryDto sort', () => {
  it.each([undefined, 'dueAt', '-dueAt', 'createdAt', '-createdAt'])('accepts %s', async (sort) => {
    const { errors } = await check(ListActivitiesQueryDto, sort === undefined ? {} : { sort });
    expect(errors).toEqual([]);
  });
  it.each(['password', '-password', 'title', 'dueAt,createdAt', '', '--dueAt', 'duedat'])(
    'rejects %j',
    async (sort) => {
      const { errors } = await check(ListActivitiesQueryDto, { sort });
      expect(failing(errors)).toEqual(['sort']);
    },
  );
});

describe('UpdateActivityDto', () => {
  it('accepts an empty body and a partial one', async () => {
    const empty = await check(UpdateActivityDto, {});
    expect(empty.errors).toEqual([]);
    // No implicit defaults: a PATCH must never reset allowLate or weightMultiplier.
    expect(Object.values(empty.instance).filter((v) => v !== undefined)).toEqual([]);
    expect((await check(UpdateActivityDto, { title: 'New', maxScore: 0 })).errors).toEqual([]);
  });
  it('replaces questions and still validates them', async () => {
    expect((await check(UpdateActivityDto, { questions: mc.questions })).errors).toEqual([]);
    const bad = await check(UpdateActivityDto, {
      questions: [{ prompt: 'Q?', options: [{ label: 'a', isCorrect: false }] }],
    });
    expect(failing(bad.errors)).toContain('questions');
  });
  it('keeps field limits and does not allow changing type or format', async () => {
    expect(failing((await check(UpdateActivityDto, { maxScore: 101 })).errors)).toEqual([
      'maxScore',
    ]);
    expect(failing((await check(UpdateActivityDto, { format: 'FILE' })).errors)).toEqual([
      'format',
    ]);
    expect(failing((await check(UpdateActivityDto, { type: 'EXAM' })).errors)).toEqual(['type']);
  });
});

describe('student response never carries isCorrect', () => {
  it('StudentOptionDto declares no isCorrect (type-level)', () => {
    // @ts-expect-error isCorrect must not exist on the student option type
    const leaked: StudentOptionDto['isCorrect'] = true;
    void leaked;
    const option: StudentOptionDto = { id: 'o1', position: 1, label: 'Paris' };
    expect(Object.keys(option)).not.toContain('isCorrect');
    expect(StudentActivityResponseDto).toBeDefined();
  });
});
