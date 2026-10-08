// JSON Schema блоков сценария. Везде additionalProperties: false — неизвестное
// поле должно быть ошибкой, а не молча игнорироваться (docs/scenario-format.md, п. 2–10).

const id = { type: "string", pattern: "^[a-z][a-z0-9_]*$" } as const;
const str = { type: "string", minLength: 1 } as const;
const int = { type: "integer" } as const;
const posInt = { type: "integer", minimum: 0 } as const;
const scalar = { type: ["string", "number"] } as const;
const condition = {
  oneOf: [
    { type: "string", pattern: "^!?[a-z][a-z0-9_]*$" },
    { type: "object", required: ["expr"], additionalProperties: false, properties: { expr: {} } },
  ],
} as const;
const column = {
  type: "object",
  required: ["label", "value"],
  additionalProperties: false,
  properties: { label: str, value: {}, format: { enum: ["int", "money", "percent", "percent1", "text"] } },
} as const;

export const frontmatterSchema = {
  type: "object",
  required: ["id", "version", "title", "locale", "duration_min", "format", "library"],
  additionalProperties: false,
  properties: {
    id,
    version: posInt,
    title: str,
    locale: str,
    duration_min: { type: "integer", minimum: 1 },
    format: { const: 1 },
    library: { const: 1 },
    teams: {
      type: "object",
      additionalProperties: false,
      properties: { min: posInt, max: posInt, recommended: { type: "array", items: posInt, minItems: 2, maxItems: 2 } },
    },
    include: { type: "array", items: { type: "string", pattern: "^[^/\\\\]+\\.md$" } },
  },
} as const;

export const rootSchema = {
  type: "object",
  required: ["currency", "params", "reference"],
  additionalProperties: false,
  properties: {
    currency: { type: "object", required: ["label"], additionalProperties: false, properties: { label: str, short: str } },
    params: { type: "object" },
    accounts: {
      type: "object",
      additionalProperties: { type: "object", required: ["label"], additionalProperties: false, properties: { label: str } },
    },
    sources: { type: "object", additionalProperties: str },
    conditions: { type: "object", additionalProperties: condition },
    reference: id,
  },
} as const;

const input = {
  type: "object",
  required: ["id", "type", "label"],
  additionalProperties: false,
  properties: {
    id,
    type: { enum: ["choice", "number", "quiz", "forecast"] },
    label: str,
    options: {
      type: "array",
      minItems: 2,
      items: { type: "object", required: ["value", "label"], additionalProperties: false, properties: { value: scalar, label: str } },
    },
    min: { type: "number" },
    max: { type: "number" },
    step: { type: "number", exclusiveMinimum: 0 },
    unit: str,
    samples: { type: "array", minItems: 1, items: { type: "number" } },
    default: scalar,
    answer: {},
    tolerance: { type: "number", minimum: 0 },
    explain: str,
  },
  allOf: [
    { if: { properties: { type: { const: "choice" } } }, then: { required: ["options"] } },
    { if: { properties: { type: { const: "quiz" } } }, then: { required: ["answer"], not: { required: ["default"] } } },
    { if: { properties: { type: { const: "forecast" } } }, then: { not: { anyOf: [{ required: ["default"] }, { required: ["answer"] }] } } },
  ],
} as const;

const panel = {
  oneOf: [
    { enum: ["facts", "choices", "answers", "variants", "statements", "takeaways"] },
    {
      type: "object",
      minProperties: 1,
      maxProperties: 1,
      additionalProperties: false,
      properties: {
        metrics: { type: "array", minItems: 1, items: column },
        table: id,
        variants: id,
        takeaways: { const: "all" },
        statement: {
          type: "object",
          required: ["kind", "scope"],
          additionalProperties: false,
          properties: { kind: { enum: ["pnl", "cashflow", "balance"] }, scope: { enum: ["step", "phase", "game"] } },
        },
        teams: {
          type: "object",
          required: ["columns"],
          additionalProperties: false,
          properties: { columns: { type: "array", minItems: 1, items: column } },
        },
      },
    },
  ],
} as const;

export const stepSchema = {
  type: "object",
  required: ["duration"],
  additionalProperties: false,
  properties: {
    duration: { type: "object", required: ["min", "max"], additionalProperties: false, properties: { min: posInt, max: posInt } },
    type: { const: "summary" },
    legend: {
      type: "object",
      additionalProperties: false,
      properties: { image: { type: "string", pattern: "^assets/[^:]+$" }, layout: { enum: ["side", "full", "text"] } },
    },
    inputs: { type: "array", minItems: 1, items: input },
    mechanics: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["use"],
        additionalProperties: false,
        properties: { use: id, id, when: condition, params: { type: "object" } },
      },
    },
    results: { type: "object", required: ["panels"], additionalProperties: false, properties: { panels: { type: "array", minItems: 1, items: panel } } },
    variants: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "input", "values", "columns"],
        additionalProperties: false,
        properties: {
          id,
          input: { type: "string", pattern: "^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$" },
          values: { oneOf: [{ const: "options" }, { type: "array", minItems: 1, items: scalar }] },
          columns: { type: "array", minItems: 1, items: column },
        },
      },
    },
    tables: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["rows", "columns"],
        additionalProperties: false,
        properties: { rows: { type: "string" }, columns: { type: "array", minItems: 1, items: column } },
      },
    },
    conditions: { type: "object", additionalProperties: condition },
    trainer: {
      type: "object",
      additionalProperties: false,
      properties: { checkpoint: { type: "string", pattern: "^\\d+:\\d\\d$" }, protected: { type: "boolean" } },
    },
  },
} as const;

export const pageSchema = {
  type: "object",
  additionalProperties: false,
  properties: { from: id },
} as const;

export const lessonSchema = {
  type: "object",
  required: ["kind"],
  additionalProperties: false,
  properties: {
    phase: id,
    takeaway: { type: "boolean" },
    kind: { enum: ["path", "contrast", "sweep", "unverified"] },
    assert: {},
    contrast: {
      type: "object",
      required: ["input", "a", "b"],
      additionalProperties: false,
      properties: {
        input: { type: "string" },
        a: { oneOf: [scalar, { type: "array", minItems: 1, items: scalar }] },
        b: scalar,
        quantifier: { enum: ["all", "any"] },
        where: condition,
      },
    },
    sweep: { type: "object", required: ["input"], additionalProperties: false, properties: { input: { type: "string" } } },
  },
  allOf: [
    { if: { properties: { kind: { const: "contrast" } } }, then: { required: ["contrast", "assert"] } },
    { if: { properties: { kind: { const: "sweep" } } }, then: { required: ["sweep", "assert"] } },
    { if: { properties: { kind: { const: "path" } } }, then: { required: ["assert"] } },
    { if: { properties: { kind: { const: "unverified" } } }, then: { not: { required: ["assert"] } } },
  ],
} as const;

const expectMap = { type: "object", minProperties: 1 } as const;

export const checkSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decisions: { type: "object", additionalProperties: scalar },
    expect: expectMap,
    sweep: {
      type: "object",
      required: ["input", "rows"],
      additionalProperties: false,
      properties: {
        base: id,
        input: { type: "string" },
        rows: {
          type: "array",
          minItems: 1,
          items: { type: "object", required: ["value", "expect"], additionalProperties: false, properties: { value: scalar, expect: expectMap } },
        },
      },
    },
  },
  anyOf: [{ required: ["expect"] }, { required: ["sweep"] }],
} as const;

export const intSchema = int;
