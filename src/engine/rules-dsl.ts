/**
 * DSL de condições avaliado sobre um "contexto de partida" plano.
 * Sem eval, sem dependências: só leitura de chaves e comparação.
 *
 * Exemplo:
 *   { all: [
 *       { metric: "threat.totalHealth", op: ">=", value: 3000 },
 *       { metric: "self.primaryDamageType", op: "eq", value: "PHYSICAL" },
 *       { not: { metric: "self.tags", op: "includes", value: "PERCENT_HP_DMG" } }
 *   ]}
 */

export type ComparisonOp = ">=" | "<=" | ">" | "<" | "eq" | "neq" | "includes" | "excludes";

export type LeafCondition = {
  metric: string;
  op: ComparisonOp;
  value: number | string | boolean;
};

export type RuleCondition =
  | LeafCondition
  | { all: RuleCondition[] }
  | { any: RuleCondition[] }
  | { not: RuleCondition };

/** Contexto plano: chaves com ponto são resolvidas por caminho. */
export type EvalContext = Record<string, unknown>;

function resolve(ctx: EvalContext, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
      ctx,
    );
}

function compare(actual: unknown, op: ComparisonOp, expected: LeafCondition["value"]): boolean {
  switch (op) {
    case ">=":
    case "<=":
    case ">":
    case "<": {
      const a = Number(actual);
      const b = Number(expected);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (op === ">=") return a >= b;
      if (op === "<=") return a <= b;
      if (op === ">") return a > b;
      return a < b;
    }
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "includes":
      return Array.isArray(actual) ? actual.includes(expected) : String(actual ?? "").includes(String(expected));
    case "excludes":
      return !compare(actual, "includes", expected);
    default:
      return false;
  }
}

export function evaluateCondition(condition: RuleCondition, ctx: EvalContext): boolean {
  if ("all" in condition) return condition.all.every((c) => evaluateCondition(c, ctx));
  if ("any" in condition) return condition.any.some((c) => evaluateCondition(c, ctx));
  if ("not" in condition) return !evaluateCondition(condition.not, ctx);
  return compare(resolve(ctx, condition.metric), condition.op, condition.value);
}

/** Explica quais folhas passaram — usado para justificar a recomendação na UI. */
export function explainCondition(
  condition: RuleCondition,
  ctx: EvalContext,
  acc: { metric: string; actual: unknown; passed: boolean }[] = [],
): { metric: string; actual: unknown; passed: boolean }[] {
  if ("all" in condition) condition.all.forEach((c) => explainCondition(c, ctx, acc));
  else if ("any" in condition) condition.any.forEach((c) => explainCondition(c, ctx, acc));
  else if ("not" in condition) explainCondition(condition.not, ctx, acc);
  else
    acc.push({
      metric: condition.metric,
      actual: resolve(ctx, condition.metric),
      passed: compare(resolve(ctx, condition.metric), condition.op, condition.value),
    });
  return acc;
}
