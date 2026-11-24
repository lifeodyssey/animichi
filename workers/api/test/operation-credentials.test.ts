import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai";
import { nativeByokModels } from "../src/agent/host/native-models.ts";
import { OperationCredentials } from "../src/agent/host/operation-credentials.ts";

/**
 * OperationCredentials, the BYOK credentials one SessionAgent incarnation holds until settlement releases them. A
 * release forgets the credential and removes its provider from the session's models whether or not the logout
 * throws, and what it holds is what a stored write must never contain.
 */

const refuseFetch = () => Promise.reject(new Error("No provider traffic is expected"));

/** A bound caller credential whose provider the session's models also hold, as admission leaves them. */
async function boundCredential(secret: string, operationId: string, credentials: OperationCredentials) {
  const credential = await nativeByokModels({ family: "openai-compatible", provider: "openai", modelId: "gpt-4.1",
    baseUrl: "https://api.openai.com/v1", secret }, refuseFetch);
  const provider = credential.models.getProvider(credential.model.provider);
  assert.ok(provider);
  const sessionModels = createModels();
  sessionModels.setProvider(provider);
  credentials.bind(operationId, credential);
  return { credential, sessionModels };
}

void test("a release forgets the credential and removes its provider even when the logout throws, and still rejects", async () => {
  const credentials = new OperationCredentials();
  const { credential, sessionModels } = await boundCredential("caller-echo-key-7f3a", "operation", credentials);
  credential.models.logout = () => Promise.reject(new Error("logout failed"));
  await assert.rejects(credentials.release("operation", sessionModels), /logout failed/);
  assert.equal(credentials.has("operation"), false);
  assert.equal(sessionModels.getProvider(credential.model.provider), undefined);
  assert.equal(credentials.literals().isEmpty, true);
});

void test("the literals hold every bound credential's key, and none once each is released", async () => {
  const credentials = new OperationCredentials();
  const first = await boundCredential("caller-echo-key-one", "first", credentials);
  const second = await boundCredential("caller-echo-key-two", "second", credentials);
  assert.equal(credentials.literals().text("caller-echo-key-one and caller-echo-key-two"), "[redacted] and [redacted]");
  await credentials.release("first", first.sessionModels);
  await credentials.release("second", second.sessionModels);
  assert.equal(credentials.literals().isEmpty, true);
});
