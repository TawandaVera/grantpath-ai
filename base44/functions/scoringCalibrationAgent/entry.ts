/**
 * GHIS-006: Scoring Calibration Agent
 * Learns from actual grant outcomes to optimize scoring weights and thresholds.
 * Bayesian-inspired weight updating with conservative blending (70/30).
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const DEFAULT_WEIGHTS = {
  mandate_alignment: 0.40,
  eligibility_fit: 0.30,
  deadline_feasibility: 0.20,
  geographic_match: 0.10,
};

const DEFAULT_THRESHOLDS = { GO: 80, PREP: 60, DEF: 40 };
const MIN_DECISIONS = 10;

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdev(arr: number[]): number {
  if (arr.length < 2) return 1;
  const avg = mean(arr);
  const variance = arr.reduce((a, b) => a + (b - avg) ** 2, 0) / arr.length;
  return Math.sqrt(variance) || 1;
}

function calcCorrelations(
  awarded: Record<string, unknown>[],
  declined: Record<string, unknown>[]
): Record<string, Record<string, unknown>> {
  const dims = ["mandate_alignment_score", "eligibility_fit_score", "deadline_feasibility_score", "geographic_match_score"];
  const result: Record<string, Record<string, unknown>> = {};

  for (const dim of dims) {
    const key = dim.replace("_score", "");
    const aScores = awarded.map((g) => (g[dim] as number) || 0).filter((v) => v > 0);
    const dScores = declined.map((g) => (g[dim] as number) || 0).filter((v) => v > 0);

    if (!aScores.length || !dScores.length) {
      result[key] = { correlation: 0, insufficient_data: true };
      continue;
    }

    const avgA = mean(aScores);
    const avgD = mean(dScores);
    const combinedStd = stdev([...aScores, ...dScores]);
    const separation = (avgA - avgD) / combinedStd;

    result[key] = {
      avg_awarded: +avgA.toFixed(2),
      avg_declined: +avgD.toFixed(2),
      separation_ratio: +separation.toFixed(4),
      predictive_power: +Math.abs(separation).toFixed(4),
      sample_awarded: aScores.length,
      sample_declined: dScores.length,
    };
  }
  return result;
}

function computeNewWeights(
  correlations: Record<string, Record<string, unknown>>,
  currentWeights: Record<string, number>
): Record<string, number> {
  const powers: Record<string, number> = {};
  for (const [dim, data] of Object.entries(correlations)) {
    powers[dim] = (data.insufficient_data ? currentWeights[dim] || 0.25 : Math.max(0.05, (data.predictive_power as number) || 0.1));
  }
  const total = Object.values(powers).reduce((a, b) => a + b, 0) || 1;
  const raw = Object.fromEntries(Object.entries(powers).map(([k, v]) => [k, +(v / total).toFixed(4)]));

  // Blend: 70% current + 30% new
  const blended: Record<string, number> = {};
  for (const dim of Object.keys(raw)) {
    blended[dim] = +(((currentWeights[dim] || 0.25) * 0.7) + (raw[dim] * 0.3)).toFixed(4);
  }
  const blendTotal = Object.values(blended).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(blended).map(([k, v]) => [k, +(v / blendTotal).toFixed(4)]));
}

function calcPredictiveAccuracy(
  awarded: Record<string, unknown>[],
  declined: Record<string, unknown>[]
): number {
  let correct = 0, total = 0;
  for (const g of awarded) {
    if (["GO", "PREP"].includes(g.state_at_submission as string)) correct++;
    total++;
  }
  for (const g of declined) {
    if (["DEF", "DECLINE"].includes(g.state_at_submission as string)) correct++;
    total++;
  }
  return total > 0 ? +(correct / total).toFixed(4) : 0;
}

function recommendThresholds(
  successRates: Record<string, Record<string, unknown>>,
  currentThresholds: Record<string, number>
): { adjustments: Record<string, unknown>[]; new_thresholds: Record<string, number> } {
  const adjustments: Record<string, unknown>[] = [];
  const newThresholds = { ...currentThresholds };

  const goData = successRates["GO"] || {};
  const goRate = (goData.success_rate as number) || 0;
  const goSample = (goData.with_known_outcome as number) || 0;
  if (goRate < 0.20 && goSample >= 5) {
    const newGo = Math.min(95, currentThresholds.GO + 5);
    adjustments.push({ state: "GO", direction: "raise", from: currentThresholds.GO, to: newGo, reason: `GO success rate ${(goRate * 100).toFixed(0)}% < 20% target` });
    newThresholds.GO = newGo;
  }

  const prepData = successRates["PREP"] || {};
  const prepRate = (prepData.success_rate as number) || 0;
  const prepSample = (prepData.with_known_outcome as number) || 0;
  if (prepRate > 0.40 && prepSample >= 5) {
    const newGo = Math.max(60, currentThresholds.GO - 5);
    adjustments.push({ state: "GO", direction: "lower", from: currentThresholds.GO, to: newGo, reason: `PREP success rate ${(prepRate * 100).toFixed(0)}% > 40%` });
    newThresholds.GO = newGo;
  }

  const defData = successRates["DEF"] || {};
  const defRate = (defData.success_rate as number) || 0;
  const defSample = (defData.with_known_outcome as number) || 0;
  if (defRate > 0.20 && defSample >= 5) {
    const newPrep = Math.max(40, currentThresholds.PREP - 5);
    adjustments.push({ state: "PREP", direction: "lower", from: currentThresholds.PREP, to: newPrep, reason: `DEF success rate ${(defRate * 100).toFixed(0)}% > 20%` });
    newThresholds.PREP = newPrep;
  }

  return { adjustments, new_thresholds: newThresholds };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { action = "calibrate" } = body;

    // ─── LOAD CURRENT CONFIG ───
    const snapshots = await base44.asServiceRole.entities.CalibrationSnapshot.filter({ is_active: true });
    const currentConfig = snapshots[0] || null;
    const currentWeights: Record<string, number> = currentConfig?.weights || { ...DEFAULT_WEIGHTS };
    const currentThresholds: Record<string, number> = currentConfig?.thresholds || { ...DEFAULT_THRESHOLDS };

    // ─── CALIBRATE ───
    if (action === "calibrate") {
      const outcomes = await base44.asServiceRole.entities.GrantOutcome.list();
      const awarded = outcomes.filter((o: any) => o.outcome === "awarded");
      const declined = outcomes.filter((o: any) => o.outcome === "declined_by_funder");
      const total = awarded.length + declined.length;

      if (total < MIN_DECISIONS) {
        return Response.json({
          ok: true,
          calibrated: false,
          reason: `Only ${total} outcomes recorded. Need at least ${MIN_DECISIONS} to calibrate.`,
          current_weights: currentWeights,
          current_thresholds: currentThresholds,
          outcomes_recorded: total,
        });
      }

      const correlations = calcCorrelations(awarded, declined);
      const newWeights = computeNewWeights(correlations, currentWeights);
      const accuracy = calcPredictiveAccuracy(awarded, declined);

      // Success rates by state
      const states = ["GO", "PREP", "DEF", "DECLINE"];
      const successRates: Record<string, Record<string, unknown>> = {};
      for (const state of states) {
        const inState = outcomes.filter((o: any) => o.state_at_submission === state);
        const withOutcome = inState.filter((o: any) => ["awarded", "declined_by_funder"].includes(o.outcome));
        const awardedCount = withOutcome.filter((o: any) => o.outcome === "awarded").length;
        successRates[state] = {
          total_classified: inState.length,
          with_known_outcome: withOutcome.length,
          awarded: awardedCount,
          success_rate: withOutcome.length > 0 ? +(awardedCount / withOutcome.length).toFixed(4) : 0,
        };
      }

      const thresholdRecs = recommendThresholds(successRates, currentThresholds);

      // Generate recommendations
      const recommendations = [
        `Predictive accuracy: ${(accuracy * 100).toFixed(0)}% (${accuracy > 0.7 ? "good" : "needs improvement"})`,
        ...thresholdRecs.adjustments.map((a: any) => `Recommend ${a.direction}ing ${a.state} threshold from ${a.from} to ${a.to}: ${a.reason}`),
        ...states.filter((s) => (successRates[s].with_known_outcome as number) >= 3).map((s) =>
          `${s}: ${((successRates[s].success_rate as number) * 100).toFixed(0)}% success rate (${successRates[s].awarded}/${successRates[s].with_known_outcome})`
        ),
      ];

      // Save snapshot (not yet active — requires approval)
      const snapshot = await base44.asServiceRole.entities.CalibrationSnapshot.create({
        snapshot_id: `snap_${Date.now()}`,
        total_decisions: total,
        weights: newWeights,
        thresholds: thresholdRecs.new_thresholds,
        success_rates: successRates,
        predictive_accuracy: accuracy,
        recommendations,
        is_active: false,
        correlations,
      });

      return Response.json({
        ok: true,
        calibrated: true,
        snapshot_id: snapshot.id,
        outcomes_analyzed: total,
        current_weights: currentWeights,
        proposed_weights: newWeights,
        current_thresholds: currentThresholds,
        proposed_thresholds: thresholdRecs.new_thresholds,
        threshold_adjustments: thresholdRecs.adjustments,
        predictive_accuracy: accuracy,
        correlations,
        recommendations,
        note: "Run action=apply_calibration with snapshot_id to activate (requires human approval)",
      });
    }

    // ─── APPLY CALIBRATION (HIL — requires approval) ───
    if (action === "apply_calibration") {
      const { snapshot_id, approved_by } = body;
      if (!snapshot_id || !approved_by) return Response.json({ error: "snapshot_id and approved_by required" }, { status: 400 });

      const snaps = await base44.asServiceRole.entities.CalibrationSnapshot.filter({ id: snapshot_id });
      if (!snaps.length) return Response.json({ error: "Snapshot not found" }, { status: 404 });

      // Deactivate all current
      const active = await base44.asServiceRole.entities.CalibrationSnapshot.filter({ is_active: true });
      for (const a of active) {
        await base44.asServiceRole.entities.CalibrationSnapshot.update(a.id, { is_active: false });
      }

      await base44.asServiceRole.entities.CalibrationSnapshot.update(snapshot_id, {
        is_active: true, applied_by: approved_by,
      });

      return Response.json({
        ok: true,
        applied: true,
        snapshot_id,
        approved_by,
        new_weights: snaps[0].weights,
        new_thresholds: snaps[0].thresholds,
      });
    }

    // ─── LOG OUTCOME ───
    if (action === "log_outcome") {
      const { grant_id, application_id, outcome, award_amount, funder_name, class_id, state_at_submission, scores = {} } = body;
      if (!grant_id || !outcome) return Response.json({ error: "grant_id and outcome required" }, { status: 400 });

      const record = await base44.asServiceRole.entities.GrantOutcome.create({
        grant_id, application_id, outcome, award_amount: award_amount || 0,
        funder_name, class_id, state_at_submission,
        mandate_alignment_score: scores.mandate_alignment,
        eligibility_fit_score: scores.eligibility_fit,
        deadline_feasibility_score: scores.deadline_feasibility,
        geographic_match_score: scores.geographic_match,
        final_overall_score: scores.overall,
        notes: body.notes || "",
      });

      return Response.json({ ok: true, outcome_id: record.id, message: `Outcome '${outcome}' logged for grant ${grant_id}` });
    }

    // ─── GET STATUS ───
    if (action === "get_status") {
      const outcomes = await base44.asServiceRole.entities.GrantOutcome.list();
      return Response.json({
        ok: true,
        current_weights: currentWeights,
        current_thresholds: currentThresholds,
        outcomes_recorded: outcomes.length,
        awarded: outcomes.filter((o: any) => o.outcome === "awarded").length,
        declined: outcomes.filter((o: any) => o.outcome === "declined_by_funder").length,
        pending: outcomes.filter((o: any) => o.outcome === "pending").length,
        calibration_data_source: currentConfig ? `Active snapshot from ${currentConfig.created_date}` : "Default weights (no calibration run yet)",
        min_decisions_needed: MIN_DECISIONS,
        ready_for_calibration: outcomes.filter((o: any) => ["awarded", "declined_by_funder"].includes(o.outcome)).length >= MIN_DECISIONS,
      });
    }

    return Response.json({ error: "Invalid action. Use: calibrate | apply_calibration | log_outcome | get_status" }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
