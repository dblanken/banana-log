// OpenAPI description of the AI door, imported by the custom GPT's Action.
// Enums and properties come from the validator's lists so the two can't drift apart.
import { COLOR_KEYS, CONFIDENCE, GROUP_KEYS, MEALS, NUTRIENTS } from './validate.js';

const NUTRIENT_PROPS = Object.fromEntries(Object.keys(NUTRIENTS).map((k) => [k, {
  type: 'number',
  minimum: 0,
  ...(k === 'potassium_mg' ? { description: 'Potassium in milligrams. The most important number.' } : {}),
}]));

const percent = { type: 'number', minimum: 0, maximum: 100 };
const percentMap = (keys) => Object.fromEntries(keys.map((k) => [k, percent]));

export function openApiSpec(origin) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Banana Log',
      version: '1.0.0',
      description: "Logs meals and reports a day's potassium and nutrition totals.",
    },
    servers: [{ url: origin }],
    paths: {
      '/api/ingest/entries': {
        post: {
          operationId: 'logMeal',
          summary: 'Log one meal or snack',
          description: 'Call only after the user confirms the estimate. Returns the saved entry, any warnings, and the updated totals for that day.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MealInput' } } },
          },
          responses: {
            201: { description: 'Saved', content: { 'application/json': { schema: { $ref: '#/components/schemas/LogResult' } } } },
            401: { description: 'Missing or wrong API key' },
            422: { description: 'Validation failed. details lists what to fix.' },
            429: { description: 'Too many entries in the last minute' },
          },
        },
      },
      '/api/ingest/summary': {
        get: {
          operationId: 'getSummary',
          summary: "Get a day's potassium and nutrition totals",
          parameters: [{
            name: 'date',
            in: 'query',
            required: false,
            description: 'Day as YYYY-MM-DD in her local time. Defaults to today.',
            schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          }],
          responses: {
            200: { description: 'Day summary', content: { 'application/json': { schema: { $ref: '#/components/schemas/DaySummary' } } } },
            401: { description: 'Missing or wrong API key' },
          },
        },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: {
        MealInput: {
          type: 'object',
          required: ['description', 'totals'],
          properties: {
            eaten_at: { type: 'string', description: 'When she ate, ISO 8601 with offset, e.g. 2026-10-19T12:30:00-04:00. Omit for now.' },
            meal: { type: 'string', enum: MEALS },
            description: { type: 'string', description: 'Short description of the meal', maxLength: 500 },
            items: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  portion: { type: 'string', description: 'Household measure, e.g. "1 cup"' },
                  grams: { type: 'number', minimum: 0 },
                  ...NUTRIENT_PROPS,
                },
              },
            },
            totals: { type: 'object', required: ['potassium_mg'], properties: NUTRIENT_PROPS },
            plate_color: {
              type: 'object',
              description: 'Share of the plate by color, percentages adding up to 100',
              properties: percentMap(COLOR_KEYS),
            },
            food_groups: {
              type: 'object',
              description: 'Share of the plate by food group, percentages adding up to 100',
              properties: percentMap(GROUP_KEYS),
            },
            allergens: { type: 'array', items: { type: 'string' }, description: 'Allergens present, e.g. seafood, peanuts' },
            confidence: { type: 'string', enum: CONFIDENCE },
            notes: { type: 'string', maxLength: 1000 },
          },
        },
        Potassium: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['goal', 'limit'], description: 'goal = reach at least the target; limit = stay under it' },
            food_mg: { type: 'number' },
            food_meq: { type: 'number' },
            supplement_meq: { type: 'number', description: 'Daily prescribed supplement, not included in food_mg' },
            total_meq: { type: 'number' },
            target_mg: { type: 'number', description: 'Daily target for potassium from food' },
            remaining_mg: { type: 'number' },
            percent_of_target: { type: 'number' },
            met: { type: 'boolean' },
          },
        },
        DaySummary: {
          type: 'object',
          properties: {
            date: { type: 'string' },
            entries: { type: 'integer' },
            potassium: { $ref: '#/components/schemas/Potassium' },
            totals: { type: 'object', properties: NUTRIENT_PROPS },
            allergens: { type: 'array', items: { type: 'string' } },
          },
        },
        LogResult: {
          type: 'object',
          properties: {
            entry: { type: 'object', properties: { id: { type: 'integer' }, local_date: { type: 'string' }, meal: { type: 'string' } } },
            warnings: { type: 'array', items: { type: 'string' } },
            today: { $ref: '#/components/schemas/DaySummary' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  };
}
