import { getApiBaseUrl } from './apiBase';
import { useServerBackupStore } from './cloudSync/serverBackup';
import { useOwnerFlag } from './ownerFlag';

/**
 * Ask the server whether this device's backup identity is the owner's (api/owner-verify). Owner tools
 * and owner lifetime access turn on only on a server "yes" for this launch. No backup identity, no
 * network, a timeout, or any error all mean NOT owner — never a default.
 */
export async function verifyOwnerIdentity(): Promise<boolean> {
  const { backupKey, secret } = useServerBackupStore.getState();
  if (!backupKey || !secret) {
    useOwnerFlag.getState().set(false);
    return false;
  }
  let owner = false;
  try {
    const res = await fetch(getApiBaseUrl().replace(/\/+$/, '') + '/api/owner-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: backupKey, secret }),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as { ok?: boolean; owner?: boolean };
    owner = json.ok === true && json.owner === true;
  } catch {
    owner = false;
  }
  useOwnerFlag.getState().set(owner);
  return owner;
}
