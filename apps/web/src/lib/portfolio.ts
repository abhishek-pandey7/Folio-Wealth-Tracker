import {
  AccountSchema,
  type CreateAccount,
  type CreateTransaction,
  PortfolioSummarySchema,
  TransactionSchema,
} from '@folio/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { deleteJson, getJson, postJson } from '../api.js';

const qs = (accountId?: string) => (accountId ? `?accountId=${accountId}` : '');

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => getJson('/api/accounts', z.array(AccountSchema)),
  });
}

export function usePortfolio(accountId?: string) {
  return useQuery({
    queryKey: ['portfolio', accountId ?? 'all'],
    queryFn: () => getJson(`/api/portfolio${qs(accountId)}`, PortfolioSummarySchema),
    refetchInterval: 60_000,
  });
}

export function useTransactions(accountId?: string) {
  return useQuery({
    queryKey: ['transactions', accountId ?? 'all'],
    queryFn: () => getJson(`/api/transactions${qs(accountId)}`, z.array(TransactionSchema)),
  });
}

/** Any change to accounts or the ledger can move every number on the page. */
function useInvalidateLedger() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['accounts', 'portfolio', 'transactions'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
}

export function useCreateAccount() {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: (input: CreateAccount) => postJson('/api/accounts', input, AccountSchema),
    onSuccess: invalidate,
  });
}

export function useDeleteAccount() {
  const invalidate = useInvalidateLedger();
  return useMutation({ mutationFn: (id: string) => deleteJson(`/api/accounts/${id}`), onSuccess: invalidate });
}

export function useCreateTransaction() {
  const invalidate = useInvalidateLedger();
  return useMutation({
    mutationFn: (input: CreateTransaction) => postJson('/api/transactions', input, TransactionSchema),
    onSuccess: invalidate,
  });
}

export function useDeleteTransaction() {
  const invalidate = useInvalidateLedger();
  return useMutation({ mutationFn: (id: string) => deleteJson(`/api/transactions/${id}`), onSuccess: invalidate });
}
