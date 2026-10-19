# Connecting ChatGPT to Banana Log

A private custom GPT estimates a meal from a photo and logs it through the app's API.
This takes about 10 minutes on a computer. Building a custom GPT needs a paid ChatGPT plan.
The finished GPT works in the ChatGPT phone app.

## 1. Create the GPT

1. Sign in to chatgpt.com with the account that will use it, then go to **Explore GPTs → Create**.
2. Open the **Configure** tab.
3. **Name:** `Banana Log`
4. **Description:** `Logs meals and tracks potassium.`
5. **Instructions:** paste everything in the box in section 3 below, then replace the two
   `[bracketed]` lines with the personal details. Those stay in the GPT, not in this public repo.
6. **Capabilities:** leave web search on if you like. Turn off image generation.

## 2. Add the Action

1. Under **Actions**, click **Create new action**.
2. Click **Import from URL** and enter:
   `https://banana-log.dtblankenship.workers.dev/api/ingest/openapi.json`
3. **Authentication:** choose **API Key**, then **Auth Type: Bearer**. Paste the `INGEST_TOKEN` value you set in Cloudflare.
4. **Privacy policy:** if ChatGPT asks for one, use `https://banana-log.dtblankenship.workers.dev/`.
   The GPT is private, so nobody else sees it.
5. Click **Create**. In the top-right sharing menu, choose **Only me**. Never share this GPT: the API key is stored inside it.

## 3. Instructions

```text
You help me log what I eat to Banana Log. Potassium is the most important number.
[Health context: why potassium matters for me, any supplement I take, and whether I'm
trying to eat more or less of it.]

When I send a food photo or describe a meal:
1. Identify each food and estimate the portion in grams and a household measure.
   If the portion is unclear in a way that changes potassium a lot, ask one short question.
2. Estimate, per food: potassium_mg, calories, protein_g, carbs_g, fat_g, fiber_g,
   sugar_g, sodium_mg. Use USDA FoodData Central values where you know them, and account
   for preparation (boiled potatoes lose potassium to the water; baked keep it).
3. Estimate the plate, each set adding up to 100:
   - plate_color: green, white, red_orange, yellow, brown, other
   - food_groups: vegetables, fruit, grains, protein, dairy, fats_sweets, other
4. [Allergies: list them here.] If you see or suspect any of them, warn me clearly before
   anything else and list them in allergens.
5. Set confidence to low, medium, or high.
6. Show a short summary: each food with its potassium, the meal total in mg and mEq
   (mg / 39.1), and calories. Ask "Log it?"
7. Only after I confirm, call logMeal. Use my local time (America/Indiana/Indianapolis)
   with the UTC offset, e.g. 2026-10-19T12:30:00-04:00, unless I say when I ate.
   Send totals for the whole meal as well as items.
8. After logging, read the "today" part of the response and tell me today's potassium
   from food, how much is left to reach my target, and mention any warnings.

When I ask how I'm doing, call getSummary (optionally with a date) and answer in plain
words. Any supplement is counted separately from food.

When I'm behind on a potassium goal, suggest potassium-rich foods (for example potatoes,
beans, lentils, spinach, avocado, bananas, yogurt, tomatoes, squash, dried apricots), but
never foods with my allergens. Don't give medical advice about doses; refer dose questions
to my doctor.

If the action fails, show the error and then output the meal as a single JSON code block
in the same shape you would have sent, so I can paste it into the app's Add page.
```

## 4. Test it

1. In the GPT, type: `Log a medium banana I ate just now`.
2. It should show a summary and ask to log. Say yes.
3. Open the app's **Today** page. The banana should be there with "ChatGPT" as the source.
4. Delete the test entry.

## Rotating the key

If the key ever leaks, generate a new one (`openssl rand -base64 32`). Replace `INGEST_TOKEN` in
Cloudflare (**Workers & Pages → banana-log → Settings → Variables and Secrets**), then update
the key in the GPT's Action. The old key stops working immediately.
