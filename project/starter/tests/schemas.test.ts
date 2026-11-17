import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  CodeQualityResultJSONSchema,
  CodeQualityResultSchema,
  RefactoringSuggestionJSONSchema,
  RefactoringSuggestionSchema,
  ReviewReportJSONSchema,
  ReviewReportSchema,
  TestCoverageResultJSONSchema,
  TestCoverageResultSchema
} from '../src/types/index.js';
import type {
  CodeQualityResult,
  RefactoringSuggestion,
  ReviewReport,
  TestCoverageResult
} from '../src/types/index.js';

type Issue = CodeQualityResult['issues'][number];
type UntestedPath = TestCoverageResult['untestedPaths'][number];
type Suggestion = RefactoringSuggestion['suggestions'][number];

function makeIssue(): Issue {
  return {
    line: 14,
    severity: 'high',
    category: 'security',
    description: 'User input is concatenated into a SQL query',
    suggestion: 'Use a parameterized query'
  };
}

function makeCodeQualityResult(overrides: Partial<CodeQualityResult> = {}): CodeQualityResult {
  return {
    file: 'src/db.ts',
    issues: [makeIssue()],
    overallScore: 70,
    summary: 'One injection risk in the user lookup.',
    ...overrides
  };
}

function makeUntestedPath(): UntestedPath {
  return {
    type: 'branch',
    location: 'findUser() lines 10-16',
    priority: 'high',
    reasoning: 'The not-found branch is never exercised',
    suggestedTest: 'it returns null for an unknown id'
  };
}

function makeTestCoverageResult(overrides: Partial<TestCoverageResult> = {}): TestCoverageResult {
  return {
    file: 'src/db.ts',
    hasTests: true,
    testFiles: ['src/db.test.ts'],
    untestedPaths: [makeUntestedPath()],
    coverageEstimate: 60,
    summary: 'The happy path is tested.',
    ...overrides
  };
}

function makeSuggestion(): Suggestion {
  return {
    type: 'modernize',
    location: 'findUser() line 12',
    impact: 'low',
    description: 'Replace the promise chain with async/await',
    before: 'return db.query(sql).then(rows => rows[0]);',
    after: 'const rows = await db.query(sql);\nreturn rows[0];',
    benefits: 'Easier to follow'
  };
}

function makeRefactoringSuggestion(overrides: Partial<RefactoringSuggestion> = {}): RefactoringSuggestion {
  return {
    file: 'src/db.ts',
    suggestions: [makeSuggestion()],
    summary: 'One small modernization.',
    ...overrides
  };
}

function makeReviewReport(overrides: Partial<ReviewReport> = {}): ReviewReport {
  return {
    pullRequest: { owner: 'acme', repo: 'widgets', number: 42 },
    fileReviews: [
      {
        file: 'src/db.ts',
        codeQuality: makeCodeQualityResult(),
        testCoverage: makeTestCoverageResult(),
        refactorings: makeRefactoringSuggestion()
      }
    ],
    summary: {
      totalFiles: 1,
      overallScore: 70,
      criticalIssues: 0,
      highPriorityTests: 1,
      refactoringOpportunities: 1
    },
    recommendations: [
      {
        priority: 'high',
        category: 'security',
        description: 'Parameterize the user lookup query',
        files: ['src/db.ts']
      }
    ],
    metadata: {
      analyzedAt: '2026-01-15T10:00:00.000Z',
      duration: 95000,
      agentVersions: {
        'code-quality-analyzer': 'inherit',
        'test-coverage-analyzer': 'inherit',
        'refactoring-suggester': 'inherit'
      }
    },
    ...overrides
  };
}

function without<T extends object>(value: T, key: keyof T): Partial<T> {
  const copy: Partial<T> = { ...value };
  delete copy[key];
  return copy;
}

describe('CodeQualityResultSchema', () => {
  it('accepts a valid result', () => {
    expect(() => CodeQualityResultSchema.parse(makeCodeQualityResult())).not.toThrow();
  });

  it('accepts a result with no issues', () => {
    expect(() => CodeQualityResultSchema.parse(makeCodeQualityResult({ issues: [] }))).not.toThrow();
  });

  it.each([0, 100])('accepts an overallScore of %i', (overallScore) => {
    expect(() => CodeQualityResultSchema.parse(makeCodeQualityResult({ overallScore }))).not.toThrow();
  });

  it.each([-1, 101])('rejects an overallScore of %i', (overallScore) => {
    expect(() => CodeQualityResultSchema.parse(makeCodeQualityResult({ overallScore }))).toThrow(ZodError);
  });

  it('rejects fields with the wrong type', () => {
    const result = makeCodeQualityResult();
    const issue = { ...makeIssue(), line: '14' };
    expect(() => CodeQualityResultSchema.parse({ ...result, overallScore: '70' })).toThrow(ZodError);
    expect(() => CodeQualityResultSchema.parse({ ...result, issues: [issue] })).toThrow(ZodError);
  });

  it('rejects a result with a missing field', () => {
    const result = makeCodeQualityResult();
    const issue = without(makeIssue(), 'suggestion');
    expect(() => CodeQualityResultSchema.parse(without(result, 'summary'))).toThrow(ZodError);
    expect(() => CodeQualityResultSchema.parse({ ...result, issues: [issue] })).toThrow(ZodError);
  });

  it('rejects an unknown severity or category', () => {
    const result = makeCodeQualityResult();
    const badSeverity = { ...makeIssue(), severity: 'blocker' };
    const badCategory = { ...makeIssue(), category: 'typo' };
    expect(() => CodeQualityResultSchema.parse({ ...result, issues: [badSeverity] })).toThrow(ZodError);
    expect(() => CodeQualityResultSchema.parse({ ...result, issues: [badCategory] })).toThrow(ZodError);
  });
});

describe('TestCoverageResultSchema', () => {
  it('accepts a valid result', () => {
    expect(() => TestCoverageResultSchema.parse(makeTestCoverageResult())).not.toThrow();
  });

  it('accepts a file with no tests and no untested paths', () => {
    const result = makeTestCoverageResult({ hasTests: false, testFiles: [], untestedPaths: [] });
    expect(() => TestCoverageResultSchema.parse(result)).not.toThrow();
  });

  it.each([0, 100])('accepts a coverageEstimate of %i', (coverageEstimate) => {
    expect(() => TestCoverageResultSchema.parse(makeTestCoverageResult({ coverageEstimate }))).not.toThrow();
  });

  it.each([-1, 101])('rejects a coverageEstimate of %i', (coverageEstimate) => {
    expect(() => TestCoverageResultSchema.parse(makeTestCoverageResult({ coverageEstimate }))).toThrow(ZodError);
  });

  it('rejects fields with the wrong type', () => {
    const result = makeTestCoverageResult();
    expect(() => TestCoverageResultSchema.parse({ ...result, hasTests: 'yes' })).toThrow(ZodError);
    expect(() => TestCoverageResultSchema.parse({ ...result, testFiles: 'src/db.test.ts' })).toThrow(ZodError);
  });

  it('rejects a result with a missing field', () => {
    const result = makeTestCoverageResult();
    const path = without(makeUntestedPath(), 'suggestedTest');
    expect(() => TestCoverageResultSchema.parse(without(result, 'coverageEstimate'))).toThrow(ZodError);
    expect(() => TestCoverageResultSchema.parse({ ...result, untestedPaths: [path] })).toThrow(ZodError);
  });

  it('rejects an unknown path type or priority', () => {
    const result = makeTestCoverageResult();
    const badType = { ...makeUntestedPath(), type: 'method' };
    const badPriority = { ...makeUntestedPath(), priority: 'urgent' };
    expect(() => TestCoverageResultSchema.parse({ ...result, untestedPaths: [badType] })).toThrow(ZodError);
    expect(() => TestCoverageResultSchema.parse({ ...result, untestedPaths: [badPriority] })).toThrow(ZodError);
  });
});

describe('RefactoringSuggestionSchema', () => {
  it('accepts a valid result', () => {
    expect(() => RefactoringSuggestionSchema.parse(makeRefactoringSuggestion())).not.toThrow();
  });

  it('accepts a result with no suggestions', () => {
    expect(() => RefactoringSuggestionSchema.parse(makeRefactoringSuggestion({ suggestions: [] }))).not.toThrow();
  });

  it('rejects fields with the wrong type', () => {
    const result = makeRefactoringSuggestion();
    const suggestion = { ...makeSuggestion(), before: null };
    expect(() => RefactoringSuggestionSchema.parse({ ...result, summary: 42 })).toThrow(ZodError);
    expect(() => RefactoringSuggestionSchema.parse({ ...result, suggestions: [suggestion] })).toThrow(ZodError);
  });

  it('rejects a result with a missing field', () => {
    const result = makeRefactoringSuggestion();
    const suggestion = without(makeSuggestion(), 'after');
    expect(() => RefactoringSuggestionSchema.parse(without(result, 'suggestions'))).toThrow(ZodError);
    expect(() => RefactoringSuggestionSchema.parse({ ...result, suggestions: [suggestion] })).toThrow(ZodError);
  });

  it('rejects an unknown suggestion type or impact', () => {
    const result = makeRefactoringSuggestion();
    const badType = { ...makeSuggestion(), type: 'inline' };
    const badImpact = { ...makeSuggestion(), impact: 'critical' };
    expect(() => RefactoringSuggestionSchema.parse({ ...result, suggestions: [badType] })).toThrow(ZodError);
    expect(() => RefactoringSuggestionSchema.parse({ ...result, suggestions: [badImpact] })).toThrow(ZodError);
  });
});

describe('ReviewReportSchema', () => {
  it('accepts a valid report', () => {
    expect(() => ReviewReportSchema.parse(makeReviewReport())).not.toThrow();
  });

  it('accepts a report with no file reviews or recommendations', () => {
    expect(() => ReviewReportSchema.parse(makeReviewReport({ fileReviews: [], recommendations: [] }))).not.toThrow();
  });

  it('accepts empty agentVersions', () => {
    const report = makeReviewReport();
    const metadata = { ...report.metadata, agentVersions: {} };
    expect(() => ReviewReportSchema.parse({ ...report, metadata })).not.toThrow();
  });

  it('rejects fields with the wrong type', () => {
    const report = makeReviewReport();
    expect(() => ReviewReportSchema.parse({ ...report, pullRequest: { ...report.pullRequest, number: '42' } }))
      .toThrow(ZodError);
    expect(() => ReviewReportSchema.parse({
      ...report,
      metadata: { ...report.metadata, agentVersions: { 'code-quality-analyzer': 1 } }
    })).toThrow(ZodError);
  });

  it('rejects a report with a missing field', () => {
    const report = makeReviewReport();
    expect(() => ReviewReportSchema.parse(without(report, 'metadata'))).toThrow(ZodError);
    expect(() => ReviewReportSchema.parse({ ...report, pullRequest: without(report.pullRequest, 'repo') }))
      .toThrow(ZodError);
  });

  it('rejects an unknown recommendation priority', () => {
    const report = makeReviewReport();
    const recommendation = { priority: 'urgent', category: 'security', description: 'Fix it', files: [] };
    expect(() => ReviewReportSchema.parse({ ...report, recommendations: [recommendation] })).toThrow(ZodError);
  });

  it('rejects a file review whose nested result is invalid', () => {
    const report = makeReviewReport();
    const fileReview = {
      file: 'src/db.ts',
      codeQuality: makeCodeQualityResult({ overallScore: 101 }),
      testCoverage: makeTestCoverageResult(),
      refactorings: makeRefactoringSuggestion()
    };
    expect(() => ReviewReportSchema.parse({ ...report, fileReviews: [fileReview] })).toThrow(ZodError);
  });
});

describe('JSON Schema export', () => {
  it.each([
    {
      name: 'CodeQualityResultJSONSchema',
      schema: CodeQualityResultJSONSchema,
      required: ['file', 'issues', 'overallScore', 'summary']
    },
    {
      name: 'TestCoverageResultJSONSchema',
      schema: TestCoverageResultJSONSchema,
      required: ['file', 'hasTests', 'testFiles', 'untestedPaths', 'coverageEstimate', 'summary']
    },
    {
      name: 'RefactoringSuggestionJSONSchema',
      schema: RefactoringSuggestionJSONSchema,
      required: ['file', 'suggestions', 'summary']
    },
    {
      name: 'ReviewReportJSONSchema',
      schema: ReviewReportJSONSchema,
      required: ['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata']
    }
  ])('$name is an object schema that requires every field', ({ schema, required }) => {
    expect(schema).toMatchObject({ type: 'object', required });
    expect(Object.keys(schema.properties as Record<string, unknown>)).toEqual(required);
  });

  it('requires every field of a code quality issue', () => {
    expect(CodeQualityResultJSONSchema).toMatchObject({
      properties: {
        issues: {
          type: 'array',
          items: { type: 'object', required: ['line', 'severity', 'category', 'description', 'suggestion'] }
        }
      }
    });
  });

  it('requires every field of an untested path', () => {
    expect(TestCoverageResultJSONSchema).toMatchObject({
      properties: {
        untestedPaths: {
          type: 'array',
          items: { type: 'object', required: ['type', 'location', 'priority', 'reasoning', 'suggestedTest'] }
        }
      }
    });
  });

  it('requires every field of a refactoring suggestion', () => {
    expect(RefactoringSuggestionJSONSchema).toMatchObject({
      properties: {
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'location', 'impact', 'description', 'before', 'after', 'benefits']
          }
        }
      }
    });
  });

  it('requires every field of a file review, its code quality result and metadata', () => {
    expect(ReviewReportJSONSchema).toMatchObject({
      properties: {
        fileReviews: {
          type: 'array',
          items: {
            type: 'object',
            required: ['file', 'codeQuality', 'testCoverage', 'refactorings'],
            properties: {
              codeQuality: { type: 'object', required: ['file', 'issues', 'overallScore', 'summary'] }
            }
          }
        },
        metadata: { type: 'object', required: ['analyzedAt', 'duration', 'agentVersions'] }
      }
    });
  });
});
