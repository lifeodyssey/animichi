import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Dataset } from 'logfire/evals';
import { PrefixEvidenceMissingError, loadPrefixCorpus } from '../src/native/prefix-corpus.ts';
import { corpusCase, corpusManifest, corpusSourceText } from './native-prefix-fixture.ts';

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'prefix-corpus-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeCorpus(root: string, manifest: unknown, source = true): Promise<void> {
  await mkdir(join(root, 'probe', ''), { recursive: true });
  await writeFile(join(root, 'probe.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (source) await writeFile(join(root, 'probe', 'case.jsonl'), `${corpusSourceText()}\n`, 'utf8');
}

void test('a prefix corpus binds every case to its frozen source and records its boundary', async () => {
  await withRoot(async (root) => {
    await writeCorpus(root, corpusManifest());
    const corpus = await loadPrefixCorpus('probe', root);
    assert.equal(corpus.name, 'probe');
    assert.deepEqual(corpus.cases.map((entry) => entry.name), ['case']);
    const [entry] = corpus.cases;
    assert.ok(entry);
    assert.equal(entry.inputs.prefix.boundary, 'pending_anime_ambiguity');
    assert.equal(entry.metadata.expected_next_action.tool, 'none');
    assert.equal(entry.metadata.prefix_state.clarification_id, 3);
    assert.equal(entry.sourcePath, join(root, 'probe', 'case.jsonl'));
  });
});

void test('a case declaring a required prefix fails when its frozen source is absent', async () => {
  await withRoot(async (root) => {
    await writeCorpus(root, corpusManifest(), false);
    await assert.rejects(loadPrefixCorpus('probe', root), PrefixEvidenceMissingError);
    await assert.rejects(loadPrefixCorpus('probe', root), /required prefix but its frozen source is missing: .*case\.jsonl/);
  });
});

void test('a corpus name with no manifest is refused with the path it looked for', async () => {
  await withRoot(async (root) => {
    await assert.rejects(loadPrefixCorpus('absent', root), /no prefix corpus named "absent" at .*absent\.json/);
  });
});

async function roundTripped(format: 'json' | 'yaml'): Promise<{ inputs: unknown; metadata: unknown }> {
  const root = await mkdtemp(join(tmpdir(), 'prefix-roundtrip-'));
  try {
    await writeCorpus(root, corpusManifest());
    return serializedCase(await Dataset.fromFile(join(root, 'probe.json')), format);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function serializedCase(dataset: Dataset, format: 'json' | 'yaml'): { inputs: unknown; metadata: unknown } {
  const reloaded = Dataset.fromText(dataset.toText(format), { format });
  return { inputs: reloaded.cases[0]?.inputs, metadata: reloaded.cases[0]?.metadata };
}

void test('the official dataset reader round-trips inputs, provenance and expected-action metadata', async () => {
  const json = await roundTripped('json');
  const yaml = await roundTripped('yaml');
  assert.deepEqual(json, yaml);
  assert.deepEqual(json.metadata, corpusCase().metadata);
  assert.deepEqual(json.inputs, corpusCase().inputs);
});
