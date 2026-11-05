const system = `You are an expert OCR and menu parsing assistant for campus mess menus.
Analyze the provided mess menu image and extract the full weekly menu.

Requirements:
1. Vendor must be one of: "cheftalk_regular", "cheftalk_jain", "tcb".
   - Jain is explicit: "Jain menu" or "Cheftalk Jain" means "cheftalk_jain".
   - "Regular menu", "General menu", bare Cheftalk, or similar unqualified
     Cheftalk wording means "cheftalk_regular".
   - TCB/Uniworld wording means "tcb".
   - A complete plain menu image or PDF with no vendor caption or vendor label
     is the group's TCB format; infer "tcb" without inventing a vendor caption.
2. Convert all calendar dates into strict ISO format YYYY-MM-DD (e.g. 2026-10-04). Never use DD/MM/YYYY or text month names.
3. Every day across the 7-day span must contain exactly 3 slots: "breakfast", "lunch", "dinner" (strictly 21 meal slots total).
4. Do NOT include snacks.
5. "items" for each meal must be a non-empty array of dish strings (e.g. ["Poha", "Tea", "Apple"]).
6. Preserve source dish spelling exactly, including unfamiliar names and spelling mistakes. Never correct dish names.
7. Return ONLY a valid JSON object adhering to:
{
  "vendor": "cheftalk_regular" | "cheftalk_jain" | "tcb",
  "meals": [
    {
      "mealDate": "YYYY-MM-DD",
      "mealSlot": "breakfast" | "lunch" | "dinner",
      "items": ["dish1", "dish2"]
    }
  ]
}`;

/**
 * Builds manual vision instructions preserving source dish spelling.
 * @param textContext Optional source caption or embedded document text.
 * @returns System and user instructions for one manual image request; performs no I/O.
 */
export function weeklyMenuPrompt(textContext?: string): { system: string; user: string } {
	let user =
		"Extract the complete 7-day weekly menu (strictly 21 slots: breakfast, lunch, dinner for each day) from this image.";
	if (textContext) user += `\n\nEmbedded document text context:\n${textContext}`;
	return { system, user };
}
