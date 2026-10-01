# Súper semanal: Project Requirements Archive

## 1. Project Overview

**Súper semanal** is a small weekly utility that converts a photo of a nutrition plan into a grocery list.

The user uploads an image containing seven days of meals. Each day may contain:

- Desayuno
- Colación 1
- Comida
- Colación 2
- Cena

The application reads the plan, totals the ingredients, confirms what the user already has, and creates a department-grouped shopping list that can be used directly while shopping.

## 2. Problem Statement

Nutrition plans repeat ingredients across multiple meals and days. Calculating the weekly quantities manually is repetitive and easy to get wrong.

The application should reduce that work while keeping the user in control of the data extracted from the image.

Example:

- Monday: 250 g of beef
- Thursday: 250 g of beef
- Shopping total: 500 g of beef

## 3. Primary User Flow

1. Open the application.
2. Upload or take a photo of the weekly nutrition plan.
3. Send the image to Gemini for extraction.
4. Review and correct the extracted meals and ingredients.
5. Mark meals that are crossed out so they are excluded.
6. Calculate the weekly ingredient totals.
7. Review ingredients one at a time:
   - Lo tengo
   - Lo necesito
   - Reemplazar
   - Siempre lo tengo
8. View the shopping list grouped by supermarket department.
9. Check items while shopping.
10. Copy the list as plain text or share it through the device share menu.

## 4. Image Extraction Requirements

The AI should extract:

- Day of the week
- Meal slot
- Dish title
- Ingredient name
- Quantity
- Unit
- Supermarket department
- Whether the complete meal is crossed out

The extraction prompt must follow these rules:

- Transcribe what is visible in the image.
- Do not invent ingredients or quantities.
- Convert written fractions such as `1/4` or `1 1/2` to numeric values.
- Use `pz` for countable ingredients when no unit is written.
- Do not guess a unit from another ingredient line.
- If the image says `1/2 aguacate`, return `0.5 pz`, not `0.5 taza`.
- Use `al gusto` when an ingredient has no quantity.
- Detect meals crossed out with a line, scribble or X.
- Omit an ingredient line that is individually crossed out.
- Map alternative meal labels to the five standard meal slots.
- Leave illegible or empty cells empty rather than inventing content.

## 5. Human Review Requirements

AI extraction must not be treated as final without user review.

The review screen must allow the user to:

- Edit the dish title.
- Edit ingredient text.
- Add or remove ingredient lines.
- Mark or unmark a meal as crossed out.
- See a summary of meals that will be counted.
- See a warning when the same ingredient appears with different units.

The user must be able to correct the plan before aggregation begins.

## 6. Ingredient Aggregation Requirements

Aggregation is performed by JavaScript, not by the AI.

The calculation must:

- Exclude every ingredient belonging to a crossed-out meal.
- Normalize accents and common plurals.
- Treat names such as `jitomate` and `jitomates` as the same ingredient.
- Treat names such as `limón` and `limones` as the same ingredient.
- Combine matching ingredients when their units can be summed.
- Convert kilograms to grams.
- Convert liters to milliliters.
- Keep incompatible units separate instead of guessing conversions.
- Track the days and meals where each ingredient is used.

Example:

- `70 g queso panela`
- `1 rebanada queso panela`

These remain as one ingredient entry with both quantities shown:

`Queso panela — 70 g + 1 rebanada`

## 7. Pantry Review Requirements

The pantry review should ask once per ingredient name, even if that ingredient appears with multiple units.

Available decisions:

- **Lo tengo:** omit it from the shopping list.
- **Lo necesito:** add it to the shopping list.
- **Reemplazar:** replace the ingredient with another ingredient and quantity.
- **Siempre lo tengo:** omit it and remember it for future weeks.

The application should remember:

- The current plan and progress.
- Pantry decisions.
- Ingredients marked as always available.
- Shopping-list checkbox state.

Persistence may use browser `localStorage`; a database is not required.

## 8. Shopping List Requirements

The list must:

- Include only ingredients marked as needed.
- Group ingredients by department.
- Display an interactive checkbox for every item.
- Preserve multiple incompatible units when necessary.
- Round up items that are normally purchased as whole units.
- Show the exact plan amount when rounding occurs.

Example:

`Aguacate — 3 pz (plan: 2 1/2)`

Whole-unit categories include:

- pz
- lata
- paquete
- sobre
- rebanada
- diente

Measured units such as grams, milliliters, cups and tablespoons remain exact.

## 9. Department Rules

Department placement is decided by local keyword rules before falling back to the department returned by Gemini. This keeps placement consistent with the user's supermarket.

Departments:

- Frutas y verduras
- Carnes y pescados
- Deli
- Lácteos y huevo
- Panadería y tortillas
- Abarrotes
- Congelados
- Otros

Specific placement rules:

- Fruits and vegetables remain in `Frutas y verduras`.
- Jamón, salchicha, salami, pepperoni, mortadela, tocino, sliced turkey breast and related cold cuts go to `Deli`.
- Queso panela and related deli cheeses go to `Deli`.
- Chicharrón de cerdo goes to `Abarrotes`.
- Fresh meats and seafood go to `Carnes y pescados`.
- Milk, yogurt, eggs, cream, butter and cottage cheese remain in `Lácteos y huevo`.

## 10. Export Requirements

The application should provide:

- Copy to clipboard.
- Native device sharing when supported.
- A plain-text fallback for desktop browsers or browsers that block clipboard access.

The plain-text format uses department headings and checkbox characters:

```text
FRUTAS Y VERDURAS
☐ Aguacate — 3 pz (plan: 2 1/2)
☐ Manzana — 2 pz
```

The in-app list remains the authoritative checklist because pasted text in Samsung Notes may not become native checkboxes automatically.

## 11. Technology Requirements

The project should remain simple enough for a five-minute demonstration.

Chosen implementation:

- Vanilla HTML
- CSS
- JavaScript ES modules
- Gemini API for multimodal image extraction
- GitHub Pages for hosting
- Browser `localStorage` for persistence
- No application backend
- No login system
- No database
- No build step

The application is currently published at:

<https://hectorgzzg.github.io/super-semanal/>

## 12. API and Privacy Requirements

The user provides a Gemini API key in the Settings dialog.

The application should:

- Keep the key in the browser's local storage only.
- Never commit the key to the repository.
- Explain that uploaded images are sent to Google for processing.
- Explain that free-tier data may be used by Google according to its terms.
- Show a useful error for invalid keys, unavailable models, rate limits, temporary service failures and network failures.
- Retry temporary failures with exponential backoff.
- Use structured JSON output from Gemini.

For a larger or shared production application, the API call should move behind a small backend proxy so the key is not entered by every user or exposed in browser requests.

## 13. Demo Requirements

The five-minute presentation should cover:

### Two-minute live demonstration

- Explain the personal problem.
- Upload a nutrition-plan image.
- Show AI extraction.
- Show the human review step.
- Demonstrate excluding a crossed-out meal.
- Demonstrate the pantry questions.
- Show the final grouped list and checkbox interaction.

### Two-minute technology explanation

- Explain the static GitHub Pages architecture.
- Explain Gemini multimodal extraction.
- Explain structured JSON output.
- Explain that JavaScript performs the calculations deterministically.
- Mention the main challenges: image quality, units, crossed-out meals, API limits and mobile sharing.

### One-minute learning explanation

- AI is useful for interpreting ambiguous input.
- Traditional code is better for totals, rules and validation.
- Human review makes AI-assisted automation more trustworthy.
- A small focused application can solve a recurring weekly problem without a complex backend.

## 14. Known Limitations

- The application does not reliably convert between grams, cups and slices because product weights vary.
- Samsung Notes may paste checkbox characters as plain text rather than native checklist controls.
- The Gemini key is stored in the browser and is appropriate for a personal demo, not a public production service.
- Poor lighting, blur, unusual handwriting or heavily crossed-out content can reduce extraction quality.
- Supermarket department rules are currently based on a fixed local keyword list.
- A user must review AI extraction before relying on the totals.

## 15. Verification Requirements

The project includes browser-based checks in `test.html` for:

- Fractions and decimals.
- Name normalization.
- Unit normalization.
- Crossed-out meal exclusion.
- Kilogram-to-gram aggregation.
- Mixed-unit ingredient grouping.
- Department classification.
- Whole-unit rounding.
- Plain-text shopping-list generation.

The current test suite contains 35 passing checks.
