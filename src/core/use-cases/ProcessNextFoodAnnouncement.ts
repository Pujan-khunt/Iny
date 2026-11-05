import type * as Food from "../entities/FoodIngestion";
import type { FoodIngestionRepositoryPort } from "../ports/FoodIngestionRepositoryPort";
import type { FoodAssessmentPort } from "../ports/FoodAssessmentPort";
import type { LoggerPort } from "../ports/LoggerPort";
import { FoodCandidateValidator } from "../services/FoodCandidateValidator";
import { classifyProcessingFailure } from "../services/FoodProcessingFailure";
import { MenuDishNormalizer } from "../services/MenuDishNormalizer";
import type { MealSwapResolver } from "../services/MealSwapResolver";

type Assessment = Extract<Food.FoodAssessmentResult, { kind: "candidate" }>;
type Rejection = Extract<Food.FoodDecision, { outcome: "rejected" }>;

/** Coordinates one leased food message without owning transaction or inference infrastructure. */
export class ProcessNextFoodAnnouncement {
	/** @param repository Fenced persistence. @param assessment Strict source assessment. @param swaps Read-only prerequisite resolver. @param logger Structured failure diagnostics. */
	constructor(
		private readonly repository: FoodIngestionRepositoryPort,
		private readonly assessment: FoodAssessmentPort,
		private readonly swaps: MealSwapResolver,
		private readonly logger: LoggerPort,
	) {}

	/** @param signal Invocation deadline/cancellation. @returns One fenced result or null if idle. @throws Claim or failure-persistence errors. */
	async execute(signal: AbortSignal): Promise<Food.FoodDecision | Food.RetryScheduled | null> {
		const work = await this.repository.claimNext();
		if (!work) return null;
		this.logger.info?.("Claimed food announcement candidate", {
			messageId: work.lease.messageId,
			type: work.source.messageType,
			attempt: work.lease.attempt,
		});
		return this.processClaimed(work, signal);
	}

	private async processClaimed(
		work: Food.ClaimedFoodWork,
		signal: AbortSignal,
	): Promise<Food.FoodDecision | Food.RetryScheduled> {
		let phase = "assess";
		try {
			signal.throwIfAborted();
			const result = await this.assessment.assess(work.source, signal);
			signal.throwIfAborted();
			phase = "validate";
			const validated = FoodCandidateValidator.validate(work.source, result);
			if (!validated.ok) {
				phase = "reject";
				return await this.reject(work.lease, result, validated);
			}
			const assessment = validated.value;
			phase = "resolve_swaps";
			const swaps = await this.swaps.resolve(
				assessment.candidate.kind === "operational_announcement"
					? assessment.candidate.announcement.swaps
					: [],
			);
			signal.throwIfAborted();
			if (!swaps.ok) {
				phase = "reject";
				return await this.reject(work.lease, assessment, swaps);
			}
			phase = "accept";
			return await this.accept(work.lease, assessment, swaps.value);
		} catch (error) {
			return this.fail(work.lease, error, phase, signal);
		}
	}

	private async accept(
		lease: Food.FoodLease,
		assessment: Assessment,
		swaps: Food.ValidatedFoodCommit["resolvedSwaps"],
	): Promise<Food.FoodDecision> {
		const decision = await this.repository.accept(lease, this.commit(assessment, swaps));
		this.logger.info?.("Food announcement accepted and committed", {
			messageId: lease.messageId,
			kind: assessment.candidate.kind,
		});
		return decision;
	}

	private commit(
		{ kind: _kind, ...data }: Assessment,
		resolvedSwaps: Food.ValidatedFoodCommit["resolvedSwaps"],
	): Food.ValidatedFoodCommit {
		const menuExtraction =
			data.candidate.kind === "weekly_menu"
				? { menuExtraction: MenuDishNormalizer.normalize(data.candidate.menu) }
				: {};
		return { ...data, resolvedSwaps, ...menuExtraction };
	}

	private reject(
		lease: Food.FoodLease,
		result: Food.FoodAssessmentResult,
		rejection: Pick<Rejection, "reason" | "detail">,
	): Promise<Food.FoodDecision> {
		const { rawExtraction, rawVerification, model, promptVersion } = result;
		const diagnostics =
			result.kind === "candidate"
				? {
						candidate: result.candidate,
						evidence: result.evidence,
						verification: result.verification,
						recognizedType: result.candidate.kind,
					}
				: { recognizedType: result.recognizedType };
		this.logger.warn?.("Food announcement rejected", {
			messageId: lease.messageId,
			reason: rejection.reason,
			detail: rejection.detail,
		});
		return this.repository.reject(lease, {
			outcome: "rejected",
			reason: rejection.reason,
			detail: rejection.detail,
			diagnostics: { rawExtraction, rawVerification, model, promptVersion, ...diagnostics },
		});
	}

	private async fail(
		lease: Food.FoodLease,
		error: unknown,
		phase: string,
		signal: AbortSignal,
	): Promise<Food.FoodDecision | Food.RetryScheduled> {
		const failure = classifyProcessingFailure(error, signal);
		if (failure.code === "unexpected_failure") {
			this.logger.error("Food processing failed.", error, { messageId: lease.messageId, phase });
		} else {
			this.logger.warn?.("Food processing failed attempt", {
				messageId: lease.messageId,
				phase,
				failure,
			});
		}
		try {
			const outcome = await this.repository.fail(lease, failure);
			if (outcome.outcome === "retry_scheduled") {
				this.logger.info?.("Food announcement retry scheduled", {
					messageId: lease.messageId,
					nextAttemptAt: outcome.nextAttemptAt,
				});
			}
			return outcome;
		} catch (saveError) {
			this.logger.error("Food failure persistence failed.", saveError, {
				messageId: lease.messageId,
				phase: "fail",
				failedPhase: phase,
			});
			throw saveError;
		}
	}
}
