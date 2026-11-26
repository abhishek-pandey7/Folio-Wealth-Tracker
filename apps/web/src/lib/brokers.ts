import { type BrokerId, BrokerSchema, BrokerStartResultSchema, type Brokers, BrokersSchema } from '@folio/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { deleteJson, getJson, postJson } from '../api.js';

/** The owner's brokers. The demo, and the local NestJS API (which has no broker routes), get none. */
export function useBrokers() {
  return useQuery({
    queryKey: ['brokers'],
    queryFn: () => getJson('/api/brokers', BrokersSchema),
    retry: false,
    staleTime: 30_000,
  });
}

/** A sync or login can change holdings, accounts and everything valued from them. */
function useInvalidateHoldings() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['brokers', 'accounts', 'portfolio', 'goals'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
}

const PENDING_KEY = 'folio-broker-login';
const PENDING_MAX_AGE_MS = 15 * 60_000;

interface PendingLogin {
  broker: BrokerId;
  state: string;
  carry: string | null;
  at: number;
}

/**
 * Sends the browser to the broker's login page. The state and the encrypted
 * login data stay in this tab's sessionStorage, so the page the broker
 * returns to can tell a login it started from one it did not.
 */
export async function startBrokerLogin(broker: BrokerId): Promise<void> {
  const state = crypto.randomUUID().replace(/-/g, '');
  const { url, carry } = await postJson(`/api/brokers/${broker}/start`, { state }, BrokerStartResultSchema);
  const pending: PendingLogin = { broker, state, carry, at: Date.now() };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  window.location.assign(url);
}

/** The login this tab started, if any and recent; reading it also clears it, so it works once. */
export function takePendingLogin(): PendingLogin | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as PendingLogin;
    return Date.now() - pending.at < PENDING_MAX_AGE_MS ? pending : null;
  } catch {
    return null;
  }
}

export function useCompleteLogin() {
  const invalidate = useInvalidateHoldings();
  return useMutation({
    mutationFn: ({
      broker,
      params,
      carry,
    }: {
      broker: BrokerId;
      params: Record<string, string>;
      carry: string | null;
    }) => postJson(`/api/brokers/${broker}/complete`, { params, carry }, BrokerSchema),
    onSuccess: invalidate,
  });
}

export function useSyncBroker() {
  const invalidate = useInvalidateHoldings();
  return useMutation({
    mutationFn: (broker: BrokerId) => postJson(`/api/brokers/${broker}/sync`, {}, BrokerSchema),
    onSuccess: invalidate,
  });
}

export function useDisconnectBroker() {
  const invalidate = useInvalidateHoldings();
  return useMutation({ mutationFn: (broker: BrokerId) => deleteJson(`/api/brokers/${broker}`), onSuccess: invalidate });
}

const SYNC_AFTER_MS = 15 * 60_000;

/**
 * Refreshes broker holdings when the portfolio is opened, if any live
 * connection last synced more than 15 minutes ago. Prices update every
 * minute regardless; this only picks up trades made at the broker.
 */
export function useAutoSync(brokers: Brokers | undefined) {
  const invalidate = useInvalidateHoldings();
  const sync = useMutation({
    mutationFn: () => postJson('/api/brokers/sync', {}, BrokersSchema),
    onSuccess: invalidate,
  });
  const done = useRef(false);
  const { mutate } = sync;
  useEffect(() => {
    if (done.current || !brokers?.enabled) return;
    const stale = brokers.brokers.some(({ connection: c }) => {
      if (c?.status !== 'active') return false;
      return !c.syncedAt || Date.now() - Date.parse(c.syncedAt) > SYNC_AFTER_MS;
    });
    done.current = true;
    if (stale) mutate();
  }, [brokers, mutate]);
  return sync;
}
