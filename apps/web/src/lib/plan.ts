import {
  type CreateGoal,
  type CreateSip,
  GoalSchema,
  type SetGoalHoldings,
  SipSchema,
  type UpdateGoal,
  type UpdateSip,
} from '@folio/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { deleteJson, getJson, patchJson, postJson, putJson } from '../api.js';

export function useSips() {
  return useQuery({ queryKey: ['sips'], queryFn: () => getJson('/api/sips', z.array(SipSchema)) });
}

export function useGoals() {
  return useQuery({ queryKey: ['goals'], queryFn: () => getJson('/api/goals', z.array(GoalSchema)) });
}

/** SIPs write ledger entries, so a SIP or goal change can move every portfolio number. */
function useInvalidatePlan() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['sips', 'goals', 'portfolio', 'transactions'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
}

export function useCreateSip() {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: (input: CreateSip) => postJson('/api/sips', input, SipSchema),
    onSuccess: invalidate,
  });
}

export function useUpdateSip() {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateSip & { id: string }) => patchJson(`/api/sips/${id}`, input, SipSchema),
    onSuccess: invalidate,
  });
}

export function useDeleteSip() {
  const invalidate = useInvalidatePlan();
  return useMutation({ mutationFn: (id: string) => deleteJson(`/api/sips/${id}`), onSuccess: invalidate });
}

export function useCreateGoal() {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: (input: CreateGoal) => postJson('/api/goals', input, GoalSchema),
    onSuccess: invalidate,
  });
}

export function useUpdateGoal() {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateGoal & { id: string }) => patchJson(`/api/goals/${id}`, input, GoalSchema),
    onSuccess: invalidate,
  });
}

export function useSetGoalHoldings() {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: ({ id, ...input }: SetGoalHoldings & { id: string }) =>
      putJson(`/api/goals/${id}/holdings`, input, GoalSchema),
    onSuccess: invalidate,
  });
}

export function useDeleteGoal() {
  const invalidate = useInvalidatePlan();
  return useMutation({ mutationFn: (id: string) => deleteJson(`/api/goals/${id}`), onSuccess: invalidate });
}
