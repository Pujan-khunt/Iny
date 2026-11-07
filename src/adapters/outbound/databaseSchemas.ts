import * as dialogueSchema from "./dialogue-turn-repository/postgres/schema";
import * as whatsappSchema from "./whatsapp/postgres/schema";
import * as accessControlSchema from "./access-control/postgres/schema";
import * as messSchema from "./mess/postgres/schema";

/** Aggregated drizzle schema mapping all database tables and enums. */
export const applicationSchema = {
	...dialogueSchema,
	...whatsappSchema,
	...accessControlSchema,
	...messSchema,
};
