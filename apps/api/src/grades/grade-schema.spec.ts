import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));

describe('grade schema — activities-and-grading and data', () => {
  it('maps Grade and GradeRevision to their own tables', () => {
    expect(models.get('Grade')?.dbName).toBe('grades');
    expect(models.get('GradeRevision')?.dbName).toBe('grade_revisions');
  });

  it('enforces one Grade per submission and unique (gradeId, version) revisions', () => {
    const gradeFields = new Map(models.get('Grade')?.fields.map((field) => [field.name, field]));
    expect(gradeFields.get('submissionId')?.isUnique).toBe(true);
    expect(gradeFields.get('pointTransactionId')?.isUnique).toBe(true);
    expect(gradeFields.get('version')?.default).toBe(1);

    const rev = models.get('GradeRevision');
    expect(rev?.uniqueFields).toContainEqual(['gradeId', 'version']);
    const revFields = new Map(rev?.fields.map((field) => [field.name, field]));
    expect(revFields.get('pointTransactionId')?.isUnique).toBe(true);
  });

  it('declares back-relations on Submission, User, and PointTransaction with RESTRICT FKs', () => {
    const submissionGrade = models
      .get('Submission')
      ?.fields.find((field) => field.name === 'grade');
    expect(submissionGrade?.type).toBe('Grade');

    const pointTxFields = models
      .get('PointTransaction')
      ?.fields.filter((field) => ['grade', 'gradeRevision'].includes(field.name))
      .map((field) => field.name);
    expect(pointTxFields?.sort()).toEqual(['grade', 'gradeRevision']);

    const gradeFks = models
      .get('Grade')
      ?.fields.filter((field) => field.relationFromFields && field.relationFromFields.length > 0);
    expect(gradeFks?.every((field) => field.relationOnDelete === 'Restrict')).toBe(true);

    const revFks = models
      .get('GradeRevision')
      ?.fields.filter((field) => field.relationFromFields && field.relationFromFields.length > 0);
    expect(revFks?.every((field) => field.relationOnDelete === 'Restrict')).toBe(true);
  });
});
