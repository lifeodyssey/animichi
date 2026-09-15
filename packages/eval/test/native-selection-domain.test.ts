import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { MemorySessionRepo } from '@earendil-works/pi-agent-core';
import type { Entry, Session } from '@earendil-works/pi-agent-core';
import { createPilgrimageHarness } from '@animichi/agent/harness';
import { createCatalogClient } from '@animichi/agent/tools';
import { executeSelection, SELECTION_ENTRY, selectionEntryData } from '@animichi/agent/selection';
import { optionsFor } from './native-task-fixture.ts';

const pointA = { id: 'a', name: 'Station', bangumi_id: '123', screenshot_url: '', latitude: 35, longitude: 139 };
const pointB = { ...pointA, id: 'b', name: 'Bridge', latitude: 35.1 };
const ORIGIN = '35.8,139.2';

/** The production itinerary response; every ordered point must match an offered point. */
function plannedCatalog(requests: Request[], ordered: (typeof pointA)[]) {
  return createCatalogClient((request) => {
    requests.push(request);
    return Promise.resolve(Response.json({ ordered_points: ordered, point_count: ordered.length,
      timed_itinerary: { stops: [], legs: [], total_minutes: 10, total_distance_m: 0, pacing: 'normal' } }));
  });
}

function searchOffer(rows: (typeof pointA)[]) {
  return { role: 'toolResult' as const, toolCallId: 'search', toolName: 'search_bangumi', timestamp: 0,
    isError: false, content: [], details: { kind: 'bangumi' as const, anime_id: '123', rows, partial: false } };
}

function selectPoints(pointIds: string[], entries: readonly Entry[], catalog: ReturnType<typeof createCatalogClient>) {
  return executeSelection({ of: 'points', pointIds, origin: ORIGIN, locale: 'en' }, entries, catalog, BACKGROUND_CONTEXT);
}

void test('native eval reaches the production deterministic point-selection domain path', async () => {
  const repo = new MemorySessionRepo({ now: () => 0 });
  const session = await repo.create({}, BACKGROUND_CONTEXT);
  const branch = await session.createBranch('main', null, BACKGROUND_CONTEXT);
  await branch.appendMessage(searchOffer([pointA, pointB]), BACKGROUND_CONTEXT);
  const requests: Request[] = [];
  const catalog = plannedCatalog(requests, [pointB, pointA]);
  try {
    const result = await selectPoints([' b ', 'a', 'b'], await branch.findEntries(undefined, BACKGROUND_CONTEXT), catalog);
    assert.deepEqual(await requests[0]?.json(), { point_ids: ['b', 'a'], origin: { lat: 35.8, lng: 139.2 } });
    assert.equal(result.response.success, true);
    assert.deepEqual(result.itinerary?.ordered_points.map((point) => point.id), ['b', 'a']);
  } finally {
    await repo.close(BACKGROUND_CONTEXT);
  }
});

void test('a native custom selection entry is an offered-point source for the same domain path', async () => {
  const requests: Request[] = [];
  const catalog = plannedCatalog(requests, [pointB]);
  const repo = new MemorySessionRepo({ now: () => 0 });
  const session = await repo.create({}, BACKGROUND_CONTEXT);
  const { harness } = await createPilgrimageHarness(optionsFor(session, []), BACKGROUND_CONTEXT);
  try {
    const chosen = await seededChoice(session, catalog);
    const lane = await harness.lane('main', BACKGROUND_CONTEXT);
    await lane.appendCustomEntry(SELECTION_ENTRY, selectionEntryData('carry', chosen), BACKGROUND_CONTEXT);
    const result = await selectPoints(['b'], await laneEntries(lane, BACKGROUND_CONTEXT), catalog);
    assert.deepEqual(await requests[1]?.json(), { point_ids: ['b'], origin: { lat: 35.8, lng: 139.2 } });
    assert.equal(result.response.success, true);
    assert.deepEqual(result.itinerary?.ordered_points.map((point) => point.id), ['b']);
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
    await repo.close(BACKGROUND_CONTEXT);
  }
});

/** A separate ledger supplies the first result; the lane under test starts with no message entries. */
async function seededChoice(session: Session, catalog: ReturnType<typeof createCatalogClient>) {
  const ledger = await session.createBranch('ledger', null, BACKGROUND_CONTEXT);
  await ledger.appendMessage(searchOffer([pointB]), BACKGROUND_CONTEXT);
  return selectPoints(['b'], await ledger.findEntries(undefined, BACKGROUND_CONTEXT), catalog);
}

async function laneEntries(lane: Awaited<ReturnType<Awaited<ReturnType<typeof createPilgrimageHarness>>['harness']['lane']>>, context: typeof BACKGROUND_CONTEXT) {
  const entries = await lane.findEntries(undefined, context);
  assert.deepEqual(entries.map((entry) => entry.type), ['custom']);
  return entries;
}
