import { MealSlot, Vendor, ResolvedMealInfo } from "../entities/MessMeal";

export interface GetMealQuery {
	readonly mealDate: string;
	readonly mealSlot?: MealSlot;
	readonly vendor?: Vendor;
}

export interface MessRepositoryPort {
	getResolvedMeal(query: GetMealQuery): Promise<ResolvedMealInfo>;
}
