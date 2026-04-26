/** Display copy for Pro plans (must match Lemon Squeezy / checkout). */

export const PRO_MONTHLY_USD = 4.99;
export const PRO_ANNUAL_USD_PER_MONTH = 3.5;

export const PRO_ANNUAL_BILLED_YEAR_USD = PRO_ANNUAL_USD_PER_MONTH * 12;

/** Rounded percent saved vs paying Pro Monthly for a full year. */
export const PRO_ANNUAL_SAVE_VS_MONTHLY_PERCENT = Math.round(
  ((PRO_MONTHLY_USD * 12 - PRO_ANNUAL_BILLED_YEAR_USD) / (PRO_MONTHLY_USD * 12)) * 100,
);

export const PRO_ANNUAL_BILLED_YEAR_LABEL = `$${PRO_ANNUAL_BILLED_YEAR_USD.toFixed(2)}/year`;
