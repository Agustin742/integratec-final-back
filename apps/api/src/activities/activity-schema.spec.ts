import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));
const enums = new Map(Prisma.dmmf.datamodel.enums.map((entry) => [entry.name, entry]));

describe('activity schema — data and activities-and-grading', () => {
  it('defines closed sets for type, format and state', () => {
    const values = (name: string) => enums.get(name)?.values.map((value) => value.name);
    expect(values('ActivityType')).toEqual(['TP', 'EXAM']);
    expect(values('ActivityFormat')).toEqual(['FILE', 'MULTIPLE_CHOICE']);
    expect(values('ActivityState')).toEqual(['DRAFT', 'PUBLISHED']);
  });

  it('maps Activity to its own table, separate from ActivityMetric', () => {
    expect(models.get('Activity')?.dbName).toBe('activities');
    expect(models.get('ActivityMetric')?.dbName).toBe('activity_metrics');
  });

  it('models Activity fields deliberately', () => {
    const fields = new Map(models.get('Activity')?.fields.map((field) => [field.name, field]));
    expect(fields.get('state')?.default).toBe('DRAFT');
    expect(fields.get('allowLate')?.default).toBe(false);
    expect(fields.get('weightMultiplier')?.type).toBe('Decimal');
    expect(fields.get('dueAt')?.isRequired).toBe(true);
    expect(fields.get('opensAt')?.isRequired).toBe(false);
    expect(fields.get('deletedAt')?.isRequired).toBe(false);
    expect(fields.get('publishedAt')?.isRequired).toBe(false);
  });

  it('keeps questions and options ordered and unique per parent', () => {
    expect(models.get('Question')?.uniqueFields).toContainEqual(['activityId', 'position']);
    expect(models.get('Option')?.uniqueFields).toContainEqual(['questionId', 'position']);
  });

  it('declares relations from Classroom and User', () => {
    const relations = (name: string) =>
      models
        .get(name)
        ?.fields.filter((field) => field.type === 'Activity')
        .map((field) => field.name);
    expect(relations('Classroom')).toEqual(['activities']);
    expect(relations('User')).toEqual(['createdActivities']);
  });
});
