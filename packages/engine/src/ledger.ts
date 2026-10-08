// Учётное ядро: журнал сбалансированных транзакций и проекции.
// Знак в журнале: дебет «+», кредит «−» (docs/engine.md, п. 3).

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type CashCategory = "operating" | "investing" | "financing";

export const ACCOUNTS: Record<string, AccountType> = {
  cash: "asset",
  receivables: "asset",
  inventory: "asset",
  equipment: "asset",
  loan: "liability",
  retained_earnings: "equity",
  revenue: "income",
  cogs: "expense",
  waste: "expense",
  bad_debt: "expense",
  fixed_costs: "expense",
  marketing: "expense",
};

export interface Leg {
  account: string;
  amount: number;
}

export interface Transaction {
  source: string;
  category: CashCategory;
  legs: Leg[];
}

export interface JournalEntry extends Transaction {
  step: string;
}

export class LedgerError extends Error {
  constructor(message: string, public tx: Transaction) {
    super(message);
  }
}

/** Естественный знак: активы и расходы — дебетом, остальное — кредитом. */
export function natural(account: string, amount: number): number {
  const t = ACCOUNTS[account];
  return t === "asset" || t === "expense" ? amount : -amount;
}

export function isPnl(account: string): boolean {
  const t = ACCOUNTS[account];
  return t === "income" || t === "expense";
}

export class Ledger {
  readonly journal: JournalEntry[] = [];
  /** Остатки в знаке журнала. */
  readonly balances: Record<string, number> = {};

  post(step: string, tx: Transaction): void {
    let sum = 0;
    for (const leg of tx.legs) {
      if (!(leg.account in ACCOUNTS)) throw new LedgerError(`неизвестный счёт ${leg.account}`, tx);
      if (!Number.isInteger(leg.amount)) throw new LedgerError(`нецелая сумма ${leg.amount} на счёте ${leg.account}`, tx);
      sum += leg.amount;
    }
    if (sum !== 0) throw new LedgerError(`транзакция не сбалансирована: сумма ног ${sum}`, tx);
    const legs = tx.legs.filter((l) => l.amount !== 0);
    if (!legs.length) return;
    this.journal.push({ ...tx, legs, step });
    for (const leg of legs) this.balances[leg.account] = (this.balances[leg.account] ?? 0) + leg.amount;
  }

  /** Остатки в естественном знаке. */
  naturalBalances(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [a, v] of Object.entries(this.balances)) out[a] = natural(a, v);
    return out;
  }
}

/** Обороты по P&L-счетам: доходы и расходы положительные. */
export function pnlLines(entries: JournalEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries)
    for (const l of e.legs) if (isPnl(l.account)) out[l.account] = (out[l.account] ?? 0) + natural(l.account, l.amount);
  return out;
}

export function profit(lines: Record<string, number>): number {
  let p = 0;
  for (const [a, v] of Object.entries(lines)) p += ACCOUNTS[a] === "income" ? v : -v;
  return p;
}

/** Движение денег по источникам. */
export function cashBySource(entries: JournalEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) for (const l of e.legs) if (l.account === "cash") out[e.source] = (out[e.source] ?? 0) + l.amount;
  return out;
}

export interface CashFlowStatement {
  sections: Record<CashCategory, { source: string; amount: number }[]>;
  total: number;
}

export function cashFlow(entries: JournalEntry[]): CashFlowStatement {
  const sections: CashFlowStatement["sections"] = { operating: [], investing: [], financing: [] };
  const acc = new Map<string, { category: CashCategory; amount: number }>();
  for (const e of entries)
    for (const l of e.legs) {
      if (l.account !== "cash") continue;
      const key = `${e.category}:${e.source}`;
      const cur = acc.get(key) ?? { category: e.category, amount: 0 };
      cur.amount += l.amount;
      acc.set(key, cur);
    }
  let total = 0;
  for (const [key, { category, amount }] of acc) {
    sections[category].push({ source: key.split(":")[1], amount });
    total += amount;
  }
  return { sections, total };
}

/** Активы − обязательства − капитал − накопленная прибыль. Всегда 0. */
export function balanceCheck(naturalBalances: Record<string, number>, cumulativeProfit: number): number {
  let assets = 0,
    claims = 0;
  for (const [a, v] of Object.entries(naturalBalances)) {
    const t = ACCOUNTS[a];
    if (t === "asset") assets += v;
    else if (t === "liability" || t === "equity") claims += v;
  }
  return assets - claims - cumulativeProfit;
}
