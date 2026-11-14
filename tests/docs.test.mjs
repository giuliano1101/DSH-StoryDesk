import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkDocuments} from '../scripts/check-docs.mjs';

test('documentation links resolve relative to each document and ignore external URLs and examples', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storydesk-docs-'));
  try {
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'README.md'), '[Guide](docs/guide.md#intro) ![Icon](docs/icon.svg) [Web](https://example.com)\n```md\n[Example](missing.md)\n```');
    await writeFile(join(root, 'docs/guide.md'), '[Home](../README.md) [Email](mailto:example@example.com)');
    await writeFile(join(root, 'docs/icon.svg'), '<svg/>');
    assert.deepEqual(await checkDocuments(root, ['README.md', 'docs/guide.md']), []);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('documentation check reports missing files and refuses links outside the repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storydesk-docs-'));
  try {
    await writeFile(join(root, 'README.md'), '[Missing](docs/missing.md) [Escape](../private.md)');
    const problems = await checkDocuments(root, ['README.md']);
    assert.equal(problems.length, 2);
    assert.ok(problems.some(p => p.reason === 'missing file'));
    assert.ok(problems.some(p => p.reason === 'outside repository'));
  } finally { await rm(root, {recursive: true, force: true}); }
});
