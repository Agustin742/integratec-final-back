import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));

describe('submission schema — activities-and-grading and data', () => {
  it('maps Submission and SubmissionFile to their own tables', () => {
    expect(models.get('Submission')?.dbName).toBe('submissions');
    expect(models.get('SubmissionFile')?.dbName).toBe('submission_files');
  });

  it('allows a single submission per activity and student', () => {
    expect(models.get('Submission')?.uniqueFields).toContainEqual(['activityId', 'studentId']);
  });

  it('models Submission fields deliberately', () => {
    const fields = new Map(models.get('Submission')?.fields.map((field) => [field.name, field]));
    expect(fields.get('isLate')?.default).toBe(false);
    expect(fields.get('submittedAt')?.isRequired).toBe(true);
    expect(fields.get('idempotencyKey')?.isRequired).toBe(true);
  });

  it('keeps files ordered per submission and storage keys unique', () => {
    expect(models.get('SubmissionFile')?.uniqueFields).toContainEqual(['submissionId', 'position']);
    const fields = new Map(
      models.get('SubmissionFile')?.fields.map((field) => [field.name, field]),
    );
    expect(fields.get('storageKey')?.isUnique).toBe(true);
  });

  it('declares back-relations from Activity and User', () => {
    const relations = (name: string) =>
      models
        .get(name)
        ?.fields.filter((field) => field.type === 'Submission')
        .map((field) => field.name);
    expect(relations('Activity')).toEqual(['submissions']);
    expect(relations('User')).toEqual(['submissions']);
  });
});
