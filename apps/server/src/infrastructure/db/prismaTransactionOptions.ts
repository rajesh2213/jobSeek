export const batchTransactionOptionsDefault = {
  maxWait: 5_000,
  timeout: 20_000,
} as const;

export const batchTransactionOptionsLong = {
  maxWait: 10_000,
  timeout: 60_000,
} as const;
