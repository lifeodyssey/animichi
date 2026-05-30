"use client";

import { useEffect, useState } from "react";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api-keys";
import type { ApiKey } from "@/lib/api-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listApiKeys().then(setKeys).catch((e) => setError(e.message));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setCreating(true);
    setError(null);
    setNewRawKey(null);
    try {
      const { rawKey, id } = await createApiKey(newKeyName.trim());
      setNewRawKey(rawKey);
      setNewKeyName("");
      setKeys((prev) => [
        { id, name: newKeyName.trim(), created_at: new Date().toISOString(), last_used_at: null, revoked: false },
        ...prev,
      ]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create key");
    }
    setCreating(false);
  }

  async function handleRevoke(id: string) {
    setError(null);
    try {
      await revokeApiKey(id);
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to revoke key");
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-xl font-semibold text-foreground">API Keys</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Use API keys to call the runtime from CLI tools, scripts, or AI agents.
        The key is shown once — save it immediately.
      </p>

      <form onSubmit={handleCreate} className="mb-8 flex gap-2">
        <Input shadow
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          placeholder="Key name (e.g. My CLI Agent)"
          className="flex-1"
          size="small"
        />
        <Button
          htmlType="submit"
          type="primary"
          size="small"
          disabled={creating || !newKeyName.trim()}
        >
          {creating ? "Creating..." : "Create key"}
        </Button>
      </form>

      {newRawKey && (
        <div className="mb-6 rounded-xl border border-primary bg-card p-4">
          <p className="mb-2 text-xs font-medium text-primary">
            Save this key — it will not be shown again.
          </p>
          <code className="block break-all rounded bg-background p-3 text-xs text-foreground">
            {newRawKey}
          </code>
          <Button
            type="link"
            size="small"
            onClick={() => navigator.clipboard.writeText(newRawKey)}
            className="mt-2"
          >
            Copy to clipboard
          </Button>
        </div>
      )}

      {keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">No API keys yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{key.name}</p>
                <p className="text-xs text-muted-foreground">
                  Created {new Date(key.created_at).toLocaleDateString()}
                  {key.last_used_at && (
                    <> · Last used {new Date(key.last_used_at).toLocaleDateString()}</>
                  )}
                </p>
              </div>
              <Button
                ghost
                size="small"
                onClick={() => handleRevoke(key.id)}
                className="ml-4 text-destructive hover:text-destructive"
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </div>
  );
}
