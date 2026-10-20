import { z } from 'zod';
import { LEDGER_TYPES } from './ledger.js';
import { AssetClassSchema, CurrencySchema, DecimalStringSchema, SymbolMatchSchema } from './schemas.js';

// Precision matches the database columns, so nothing is silently rounded on save.
const decimal = (places: number) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d+(\\.\\d{1,${places}})?$`), `Use a number with at most ${places} decimals`);
const positive = (places: number) => decimal(places).refine((v) => Number(v) > 0, 'Must be greater than zero');

export const AccountSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  broker: z.string().nullable(),
  currency: CurrencySchema,
  createdAt: z.iso.datetime(),
});
export type Account = z.infer<typeof AccountSchema>;

export const CreateAccountSchema = z.object({
  name: z.string().trim().min(1, 'Give the account a name').max(60),
  broker: z.string().trim().max(60).optional(),
  currency: CurrencySchema.default('INR'),
});
export type CreateAccount = z.infer<typeof CreateAccountSchema>;

export const UpdateAccountSchema = CreateAccountSchema.pick({ name: true, broker: true }).partial();
export type UpdateAccount = z.infer<typeof UpdateAccountSchema>;

export const InstrumentRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('symbol'),
    symbol: z.string().trim().min(1).max(20),
    name: z.string().trim().max(200).optional(),
    type: SymbolMatchSchema.shape.type.optional(),
  }),
  z.object({ kind: z.literal('fund'), code: z.string().regex(/^\d{1,8}$/, 'Invalid scheme code') }),
]);
export type InstrumentRef = z.infer<typeof InstrumentRefSchema>;

export const LedgerTypeSchema = z.enum(LEDGER_TYPES);

export const CreateTransactionSchema = z
  .object({
    accountId: z.uuid(),
    instrument: InstrumentRefSchema,
    type: LedgerTypeSchema,
    tradeDate: z.iso.date(),
    quantity: positive(6).optional(),
    price: positive(4).optional(),
    fees: decimal(4).optional(),
    amount: positive(4).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.type !== 'dividend') {
      if (!t.quantity) ctx.addIssue({ code: 'custom', path: ['quantity'], message: `A ${t.type} needs a quantity` });
      if (!t.price) ctx.addIssue({ code: 'custom', path: ['price'], message: `A ${t.type} needs a price` });
    } else if (!t.amount) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'A dividend needs the amount received' });
    }
  });
export type CreateTransaction = z.infer<typeof CreateTransactionSchema>;

export const TransactionSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  accountName: z.string(),
  instrumentKey: z.string(),
  symbol: z.string().nullable(),
  schemeCode: z.string().nullable(),
  name: z.string(),
  type: LedgerTypeSchema,
  tradeDate: z.iso.date(),
  quantity: DecimalStringSchema.nullable(),
  price: DecimalStringSchema.nullable(),
  fees: DecimalStringSchema,
  /** Signed cash effect: negative for money put in. */
  amount: DecimalStringSchema,
  currency: CurrencySchema,
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

const Money = DecimalStringSchema;

export const HoldingSchema = z.object({
  instrumentKey: z.string(),
  symbol: z.string().nullable(),
  schemeCode: z.string().nullable(),
  name: z.string(),
  assetClass: AssetClassSchema,
  currency: CurrencySchema,
  sector: z.string().nullable(),
  accounts: z.array(z.string()),
  quantity: Money,
  /** Per unit, fees included, in the instrument's currency. */
  avgCost: Money,
  price: Money.nullable(),
  investedInr: Money,
  valueInr: Money,
  unrealizedInr: Money,
  unrealizedPct: z.number().nullable(),
  dayChangeInr: Money,
  dayChangePct: z.number().nullable(),
  realizedInr: Money,
  dividendsInr: Money,
  /** Share of the portfolio's current value, 0 to 100. */
  weight: z.number(),
  xirr: z.number().nullable(),
  /** False when no live price was available and the value falls back to cost. */
  priced: z.boolean(),
});
export type Holding = z.infer<typeof HoldingSchema>;

export const AllocationSliceSchema = z.object({
  key: z.string(),
  label: z.string(),
  valueInr: Money,
  weight: z.number(),
});
export type AllocationSlice = z.infer<typeof AllocationSliceSchema>;

export const PortfolioSummarySchema = z.object({
  asOf: z.iso.datetime(),
  usdInr: Money,
  totals: z.object({
    valueInr: Money,
    investedInr: Money,
    unrealizedInr: Money,
    unrealizedPct: z.number().nullable(),
    realizedInr: Money,
    dividendsInr: Money,
    dayChangeInr: Money,
    dayChangePct: z.number().nullable(),
    xirr: z.number().nullable(),
  }),
  holdings: z.array(HoldingSchema),
  allocation: z.object({
    assetClass: z.array(AllocationSliceSchema),
    market: z.array(AllocationSliceSchema),
    sector: z.array(AllocationSliceSchema),
  }),
  transactionCount: z.number().int(),
});
export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;
