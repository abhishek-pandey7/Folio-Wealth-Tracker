import { z } from 'zod';
import { MAX_SIP_DAY } from './plan.js';
import { DecimalStringSchema } from './schemas.js';

const rupees = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Use an amount in rupees, with at most 2 decimals')
  .refine((v) => Number(v) > 0, 'Must be greater than zero');

export const SIP_STATUSES = ['active', 'paused', 'stopped'] as const;
export const SipStatusSchema = z.enum(SIP_STATUSES);

export const SipSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  accountName: z.string(),
  schemeCode: z.string(),
  fundName: z.string(),
  amount: DecimalStringSchema,
  dayOfMonth: z.number().int(),
  startDate: z.iso.date(),
  status: SipStatusSchema,
  goalId: z.uuid().nullable(),
  goalName: z.string().nullable(),
  instalments: z.number().int(),
  investedInr: DecimalStringSchema,
  /** Null when the SIP is paused or stopped. */
  nextDue: z.iso.date().nullable(),
  createdAt: z.iso.datetime(),
});
export type Sip = z.infer<typeof SipSchema>;

export const CreateSipSchema = z.object({
  accountId: z.uuid(),
  schemeCode: z.string().regex(/^\d{1,8}$/, 'Invalid scheme code'),
  amount: rupees,
  dayOfMonth: z.number().int().min(1).max(MAX_SIP_DAY, `Pick a day from 1 to ${MAX_SIP_DAY}`),
  /** May be in the past: every instalment since then is recorded at the NAV of its date. */
  startDate: z.iso.date(),
  goalId: z.uuid().optional(),
});
export type CreateSip = z.infer<typeof CreateSipSchema>;

export const UpdateSipSchema = z.object({
  amount: rupees.optional(),
  dayOfMonth: z.number().int().min(1).max(MAX_SIP_DAY).optional(),
  status: SipStatusSchema.optional(),
  goalId: z.uuid().nullable().optional(),
});
export type UpdateSip = z.infer<typeof UpdateSipSchema>;

export const GoalHoldingSchema = z.object({
  instrumentKey: z.string(),
  name: z.string(),
  /** Fraction of this holding counted toward the goal, 0 to 1. */
  share: z.number(),
  valueInr: DecimalStringSchema,
});

export const GoalSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  targetAmount: DecimalStringSchema,
  targetDate: z.iso.date().nullable(),
  /** Annual return assumed for the projection, as a fraction (0.1 = 10%). */
  assumedReturn: z.number(),
  createdAt: z.iso.datetime(),
  currentInr: DecimalStringSchema,
  progressPct: z.number(),
  monthlySipInr: DecimalStringSchema,
  monthsLeft: z.number().int().nullable(),
  projectedInr: DecimalStringSchema.nullable(),
  requiredMonthlyInr: DecimalStringSchema.nullable(),
  onTrack: z.boolean().nullable(),
  holdings: z.array(GoalHoldingSchema),
  sips: z.array(z.object({ id: z.uuid(), fundName: z.string(), amount: DecimalStringSchema, status: SipStatusSchema })),
});
export type Goal = z.infer<typeof GoalSchema>;

export const CreateGoalSchema = z.object({
  name: z.string().trim().min(1, 'Name the goal').max(60),
  targetAmount: rupees,
  targetDate: z.iso.date().optional(),
  assumedReturn: z.number().min(0).max(0.3, 'Assume at most 30% a year').default(0.1),
});
export type CreateGoal = z.infer<typeof CreateGoalSchema>;

export const UpdateGoalSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  targetAmount: rupees.optional(),
  targetDate: z.iso.date().nullable().optional(),
  assumedReturn: z.number().min(0).max(0.3).optional(),
});
export type UpdateGoal = z.infer<typeof UpdateGoalSchema>;

export const SetGoalHoldingsSchema = z.object({
  holdings: z.array(z.object({ instrumentKey: z.string().min(1).max(30), share: z.number().gt(0).max(1) })).max(100),
});
export type SetGoalHoldings = z.infer<typeof SetGoalHoldingsSchema>;
