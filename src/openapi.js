// OpenAPI description of the AI door, imported by the custom GPT's Action.
const nutrient = (description) => ({ type: 'number', minimum: 0, description });

const NUTRIENT_PROPS = {
  potassium_mg: nutrient('Potassium in milligrams. The most important number.'),
  calories: nutrient('Calories (kcal)'),
  protein_g: nutrient('Protein in grams'),
  carbs_g: nutrient('Carbohydrates in grams'),
  fat_g: nutrient('Fat in grams'),
  fiber_g: nutrient('Fiber in grams'),
  sugar_g: nutrient('Sugar in grams'),
  sodium_mg: nutrient('Sodium in milligrams'),
};

const percent = { type: 'number', minimum: 0, maximum: 100 };

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
            meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
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
              properties: { green: percent, white: percent, red_orange: percent, yellow: percent, brown: percent, other: percent },
            },
            food_groups: {
              type: 'object',
              description: 'Share of the plate by food group, percentages adding up to 100',
              properties: { vegetables: percent, fruit: percent, grains: percent, protein: percent, dairy: percent, fats_sweets: percent, other: percent },
            },
            allergens: { type: 'array', items: { type: 'string' }, description: 'Allergens present, e.g. seafood, peanuts' },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
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
