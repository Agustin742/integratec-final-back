import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));

describe('activity metric schema — data and activities-and-grading', () => {
  it('maps ActivityMetric to one row per user, classroom and UTC day', () => {
    const model = models.get('ActivityMetric');
    expect(model?.dbName).toBe('activity_metrics');
    expect(model?.uniqueFields).toContainEqual(['classroomId', 'userId', 'day']);
    expect(model?.fields.find((field) => field.name === 'day')?.type).toBe('DateTime');
  });

  it('stores connected time only as a coarse aggregate', () => {
    const fields = new Map(
      models.get('ActivityMetric')?.fields.map((field) => [field.name, field]),
    );
    expect(fields.get('connectedSeconds')?.default).toBe(0);
    // No per-instant column exists: rows grow with days, never with movement or ticks.
    expect([...fields.keys()].filter((name) => /instant|tick|position/i.test(name))).toEqual([]);
  });

  it('counts submissions and participation as raw values with a zero default', () => {
    const fields = new Map(
      models.get('ActivityMetric')?.fields.map((field) => [field.name, field]),
    );
    expect(fields.get('submissionCount')?.type).toBe('Int');
    expect(fields.get('submissionCount')?.default).toBe(0);
    expect(fields.get('messageCount')?.type).toBe('Int');
    expect(fields.get('messageCount')?.default).toBe(0);
    // The composite formula is open (gap 17): raw values only, no derived level column.
    expect([...fields.keys()].filter((name) => /level|score/i.test(name))).toEqual([]);
  });

  it('keeps the metric scoped to its classroom and user with restrict on delete', () => {
    const relations = models
      .get('ActivityMetric')
      ?.fields.filter((field) => field.kind === 'object')
      .map((field) => [field.name, field.relationOnDelete]);
    expect(relations).toEqual([
      ['classroom', 'Restrict'],
      ['user', 'Restrict'],
    ]);
  });
});
