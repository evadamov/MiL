import { describe, expect, it } from "vitest";
import { Ledger, LedgerError, balanceCheck, cashFlow, pnlLines, profit } from "../src/ledger.ts";

describe("учётное ядро", () => {
  it("заём: cash +, loan −; в естественном знаке долг положительный", () => {
    const l = new Ledger();
    l.post("s", { source: "loan", category: "financing", legs: [{ account: "cash", amount: 500 }, { account: "loan", amount: -500 }] });
    expect(l.balances).toEqual({ cash: 500, loan: -500 });
    expect(l.naturalBalances()).toEqual({ cash: 500, loan: 500 });
    expect(balanceCheck(l.naturalBalances(), 0)).toBe(0);
  });

  it("отклоняет несбалансированную транзакцию — например, заём с двумя плюсами", () => {
    const l = new Ledger();
    expect(() =>
      l.post("s", { source: "loan", category: "financing", legs: [{ account: "cash", amount: 500 }, { account: "loan", amount: 500 }] }),
    ).toThrow(LedgerError);
    expect(l.journal).toHaveLength(0);
  });

  it("отклоняет нецелые суммы и неизвестные счета", () => {
    const l = new Ledger();
    expect(() => l.post("s", { source: "x", category: "operating", legs: [{ account: "cash", amount: 0.5 }, { account: "revenue", amount: -0.5 }] })).toThrow(/нецелая/);
    expect(() => l.post("s", { source: "x", category: "operating", legs: [{ account: "foo", amount: 1 }, { account: "cash", amount: -1 }] })).toThrow(/неизвестный счёт/);
  });

  it("P&L, Cash Flow и Баланс сходятся по построению", () => {
    const l = new Ledger();
    l.post("s", { source: "sales", category: "operating", legs: [{ account: "cash", amount: 70 }, { account: "revenue", amount: -70 }] });
    l.post("s", { source: "sales", category: "operating", legs: [{ account: "receivables", amount: 80 }, { account: "revenue", amount: -80 }] });
    l.post("s", { source: "production", category: "operating", legs: [{ account: "cogs", amount: 56 }, { account: "waste", amount: 4 }, { account: "cash", amount: -60 }] });
    l.post("s", { source: "jug", category: "investing", legs: [{ account: "equipment", amount: 15 }, { account: "cash", amount: -15 }] });
    const lines = pnlLines(l.journal);
    expect(lines).toEqual({ revenue: 150, cogs: 56, waste: 4 });
    expect(profit(lines)).toBe(90);
    const cf = cashFlow(l.journal);
    expect(cf.total).toBe(-5);
    expect(cf.sections.investing).toEqual([{ source: "jug", amount: -15 }]);
    expect(balanceCheck(l.naturalBalances(), 90)).toBe(0);
  });
});
