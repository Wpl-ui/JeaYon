import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { binaryChild, progressFromChildren, parentStatusOverrideAttempt } from '../src/tasks/hierarchy-contract.js';

describe('hierarchy contract', () => {
  it('binaryChild collapses in_progress and partial progress to todo/0', () => {
    assert.deepEqual(binaryChild('in_progress', 39), { status: 'todo', progress: 0 });
    assert.deepEqual(binaryChild('todo', 0), { status: 'todo', progress: 0 });
    assert.deepEqual(binaryChild('done', 100), { status: 'done', progress: 100 });
    assert.deepEqual(binaryChild('todo', 100), { status: 'done', progress: 100 });
  });

  it('progressFromChildren is done_count / total', () => {
    assert.equal(progressFromChildren([]), null);
    assert.deepEqual(
      progressFromChildren([{ status: 'todo', progress: 0 }, { status: 'done', progress: 100 }]),
      { status: 'in_progress', progress: 50 },
    );
    assert.deepEqual(
      progressFromChildren([{ status: 'done', progress: 100 }, { status: 'done', progress: 100 }, { status: 'todo', progress: 0 }]),
      { status: 'in_progress', progress: 67 },
    );
    assert.deepEqual(
      progressFromChildren([{ status: 'done', progress: 100 }, { status: 'done', progress: 100 }]),
      { status: 'done', progress: 100 },
    );
    assert.deepEqual(
      progressFromChildren([{ status: 'todo', progress: 0 }, { status: 'todo', progress: 0 }]),
      { status: 'todo', progress: 0 },
    );
  });

  it('parentStatusOverrideAttempt detects client drift', () => {
    assert.equal(parentStatusOverrideAttempt({ status: 'todo', progress: 0 }, { status: 'in_progress', progress: 50 }), true);
    assert.equal(parentStatusOverrideAttempt({ status: 'in_progress', progress: 50 }, { status: 'in_progress', progress: 50 }), false);
  });
});
