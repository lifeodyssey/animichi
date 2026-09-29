import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { appendList, list, sessionName, setValue } from "@earendil-works/pi-agent-core/harness/session";
import { NeonSessionRepo } from "@animichi/pi-session-neon";
import { serviceDatabase } from "./postgres.ts";

const events = list<string>("test.application.events", "");

void test("a Neon tree fork carries list elements in the source order and sequence", async () => {
  const repo = new NeonSessionRepo(serviceDatabase);
  const source = await repo.create({ id: "list-source" }, BACKGROUND_CONTEXT);
  await source.appendList(events, "first", BACKGROUND_CONTEXT);
  await source.appendList(events, "second", BACKGROUND_CONTEXT);
  await source.appendList(events, "third", BACKGROUND_CONTEXT);
  const fork = await repo.fork(source.metadata, { id: "list-fork", scope: "tree" }, BACKGROUND_CONTEXT);
  const elements = await fork.readList(events, undefined, BACKGROUND_CONTEXT);
  assert.deepEqual(elements, await source.readList(events, undefined, BACKGROUND_CONTEXT));
  assert.deepEqual(elements.map(({ value }) => value), ["first", "second", "third"]);
  await Promise.all([source.close(BACKGROUND_CONTEXT), fork.close(BACKGROUND_CONTEXT)]);
});

void test("a fork of a Neon tree fork does not duplicate list elements", async () => {
  const repo = new NeonSessionRepo(serviceDatabase);
  const source = await repo.create({ id: "list-refork-source" }, BACKGROUND_CONTEXT);
  await source.appendList(events, "first", BACKGROUND_CONTEXT);
  await source.appendList(events, "second", BACKGROUND_CONTEXT);
  const fork = await repo.fork(source.metadata, { id: "list-refork", scope: "tree" }, BACKGROUND_CONTEXT);
  const refork = await repo.fork(fork.metadata, { id: "list-refork-again", scope: "tree" }, BACKGROUND_CONTEXT);
  const elements = await refork.readList(events, undefined, BACKGROUND_CONTEXT);
  assert.deepEqual(elements, await source.readList(events, undefined, BACKGROUND_CONTEXT));
  assert.equal(elements.length, 2);
  await Promise.all([
    source.close(BACKGROUND_CONTEXT),
    fork.close(BACKGROUND_CONTEXT),
    refork.close(BACKGROUND_CONTEXT),
  ]);
});

void test("a Neon tree fork stays appendable after carrying list elements", async () => {
  const repo = new NeonSessionRepo(serviceDatabase);
  const source = await repo.create({ id: "list-mixed-source" }, BACKGROUND_CONTEXT);
  await source.mutate(
    (mutator) => mutator.commit([appendList(events, "first"), setValue(sessionName, "named")], BACKGROUND_CONTEXT),
    BACKGROUND_CONTEXT,
  );
  const fork = await repo.fork(source.metadata, { id: "list-mixed-fork", scope: "tree" }, BACKGROUND_CONTEXT);
  assert.deepEqual((await fork.readList(events, undefined, BACKGROUND_CONTEXT)).map(({ value }) => value), ["first"]);
  assert.equal(await fork.getName(BACKGROUND_CONTEXT), "named");
  await fork.appendList(events, "second", BACKGROUND_CONTEXT);
  assert.deepEqual(await fork.readList(events, undefined, BACKGROUND_CONTEXT), [
    { seq: 1, value: "first" },
    { seq: 2, value: "second" },
  ]);
  await Promise.all([source.close(BACKGROUND_CONTEXT), fork.close(BACKGROUND_CONTEXT)]);
  const listOnly = await repo.create({ id: "list-only-source" }, BACKGROUND_CONTEXT);
  await listOnly.appendList(events, "first", BACKGROUND_CONTEXT);
  const listOnlyFork = await repo.fork(listOnly.metadata, { id: "list-only-fork", scope: "tree" }, BACKGROUND_CONTEXT);
  await listOnlyFork.appendList(events, "second", BACKGROUND_CONTEXT);
  assert.deepEqual(await listOnlyFork.readList(events, undefined, BACKGROUND_CONTEXT), [
    { seq: 1, value: "first" },
    { seq: 2, value: "second" },
  ]);
  await Promise.all([listOnly.close(BACKGROUND_CONTEXT), listOnlyFork.close(BACKGROUND_CONTEXT)]);
});
