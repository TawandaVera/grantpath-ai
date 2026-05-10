/**
 * GHIS-007: Human-in-the-Loop (HIL) Checkpoint Agent
 * Tiered HIL system: Tier 1 (blocking), Tier 2 (review, 48h timeout), Tier 3 (auto-approve)
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const TIER_CLASSIFICATION: Record<string, string> = {
  opportunity_selection: "tier_1",
  final_pack_approval: "tier_1",
  budget_approval: "tier_1",
  submission_approval: "tier_1",
  discovery_results: "tier_2",
  dossier_review: "tier_2",
  content_map_review: "tier_2",
  narrative_review_low: "tier_1",
  narrative_review_medium: "tier_2",
  narrative_review_high: "tier_3",
  asset_retrieval: "tier_3",
  auto_fill_content: "tier_3",
  eligibility_auto_check: "tier_3",
  dedup_rejection: "tier_3",
  url_validation: "tier_3",
};

function classifyTier(stage: string, confidence?: string, data: Record<string, unknown> = {}): string {
  // Narrative review depends on confidence
  if (stage === "narrative_review") {
    const conf = confidence?.toLowerCase() || "low";
    if (conf === "high") return "tier_3";
    if (conf === "medium") return "tier_2";
    return "tier_1";
  }

  // Escalation: urgent deadline
  const daysToDeadline = data.days_to_deadline as number | undefined;
  if (daysToDeadline !== undefined && daysToDeadline < 14) {
    const base = TIER_CLASSIFICATION[stage] || "tier_2";
    if (base === "tier_3") return "tier_2";
    if (base === "tier_2") return "tier_1";
    return base;
  }

  // New funder escalation
  if (data.is_new_funder) {
    const base = TIER_CLASSIFICATION[stage] || "tier_2";
    return base === "tier_3" ? "tier_2" : base;
  }

  return TIER_CLASSIFICATION[stage] || "tier_2";
}

function getAutoActionTime(tier: string): string | null {
  if (tier === "tier_2") {
    const d = new Date();
    d.setHours(d.getHours() + 48);
    return d.toISOString();
  }
  return null;
}

const TIER_LABELS: Record<string, string> = {
  tier_1: "🔴 TIER 1 — BLOCKING (action required, pipeline paused)",
  tier_2: "🟡 TIER 2 — REVIEW REQUESTED (48h to respond before escalation)",
  tier_3: "🟢 TIER 3 — NOTIFICATION ONLY (auto-approved, no action needed)",
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { action = "create", checkpoint_id } = body;

    // ─── CREATE CHECKPOINT ───
    if (action === "create") {
      const { stage, grant_id, application_id, section, action_required, data = {}, confidence } = body;
      if (!stage || !action_required) return Response.json({ error: "stage and action_required are required" }, { status: 400 });

      const tier = classifyTier(stage, confidence, data);
      const now = new Date().toISOString();
      const autoAt = getAutoActionTime(tier);

      const checkpoint = await base44.asServiceRole.entities.HILCheckpoint.create({
        tier,
        stage,
        grant_id: grant_id || null,
        application_id: application_id || null,
        section: section || null,
        action_required,
        data,
        presented_at: now,
        decision: tier === "tier_3" ? "auto_approved" : "pending",
        decided_at: tier === "tier_3" ? now : null,
        decided_by: tier === "tier_3" ? "system_auto" : null,
        auto_action_at: autoAt,
        escalated: false,
        confidence: confidence || null,
      });

      return Response.json({
        ok: true,
        checkpoint_id: checkpoint.id,
        tier,
        tier_label: TIER_LABELS[tier],
        stage,
        action_required,
        auto_approved: tier === "tier_3",
        pipeline_blocked: tier === "tier_1",
        review_window_hours: tier === "tier_2" ? 48 : null,
        hil_format: tier !== "tier_3" ? `─── HIL CHECKPOINT: ${stage.toUpperCase()} ───\nAction Required: ${action_required}\nOptions:\n  ✅ Approve & Advance\n  ✏️ Edit Before Continuing\n  🔄 Regenerate\n  🔍 Flag for Verification\n  ⏸️ Pause\n  🚫 Block This Opportunity\n⚠️ I cannot proceed until you select an option.` : null,
      });
    }

    // ─── RECORD DECISION ───
    if (action === "decide") {
      const { decision, decided_by, instructions } = body;
      if (!checkpoint_id || !decision) return Response.json({ error: "checkpoint_id and decision are required" }, { status: 400 });

      const valid = ["approve", "edit", "regenerate", "verify", "pause", "block"];
      if (!valid.includes(decision)) return Response.json({ error: `Invalid decision. Valid: ${valid.join(", ")}` }, { status: 400 });

      const checkpoints = await base44.asServiceRole.entities.HILCheckpoint.filter({ id: checkpoint_id });
      if (!checkpoints.length) return Response.json({ error: "Checkpoint not found" }, { status: 404 });

      const cp = checkpoints[0];
      if (cp.tier === "tier_1" && decision === "approve") {
        // Tier 1 approve — unblocks pipeline
      }

      await base44.asServiceRole.entities.HILCheckpoint.update(checkpoint_id, {
        decision,
        decided_at: new Date().toISOString(),
        decided_by: decided_by || "user",
        instructions: instructions || "",
      });

      return Response.json({
        ok: true,
        checkpoint_id,
        decision,
        decided_by,
        pipeline_unblocked: decision === "approve",
        next_step: decision === "approve" ? "Pipeline can advance" :
          decision === "block" ? "Opportunity blocked — will not advance" :
          decision === "edit" ? `Apply instructions and resubmit: ${instructions}` :
          decision === "regenerate" ? "Regenerating content..." :
          decision === "pause" ? "Pipeline paused — resume when ready" :
          "Flagged for verification",
      });
    }

    // ─── BATCH APPROVE (Tier 2 only) ───
    if (action === "batch_approve") {
      const { checkpoint_ids, decided_by } = body;
      if (!checkpoint_ids?.length) return Response.json({ error: "checkpoint_ids array required" }, { status: 400 });

      const results = [];
      for (const id of checkpoint_ids) {
        const cps = await base44.asServiceRole.entities.HILCheckpoint.filter({ id });
        if (!cps.length) { results.push({ id, error: "Not found" }); continue; }
        const cp = cps[0];
        if (cp.tier === "tier_1") { results.push({ id, error: "Cannot batch-approve Tier 1 checkpoints" }); continue; }
        if (cp.decision !== "pending") { results.push({ id, skipped: "Already decided" }); continue; }

        await base44.asServiceRole.entities.HILCheckpoint.update(id, {
          decision: "approve", decided_at: new Date().toISOString(), decided_by: decided_by || "user", instructions: "Batch approved",
        });
        results.push({ id, ok: true, decision: "approve" });
      }

      return Response.json({
        ok: true,
        batch_size: checkpoint_ids.length,
        approved: results.filter((r: any) => r.ok).length,
        failed: results.filter((r: any) => r.error).length,
        results,
      });
    }

    // ─── CHECK TIMEOUTS (Tier 2 → escalate to Tier 1) ───
    if (action === "check_timeouts") {
      const all = await base44.asServiceRole.entities.HILCheckpoint.filter({ decision: "pending" });
      const now = Date.now();
      const escalated = [];

      for (const cp of all) {
        if (cp.tier !== "tier_2") continue;
        if (!cp.auto_action_at) continue;
        if (new Date(cp.auto_action_at).getTime() <= now) {
          await base44.asServiceRole.entities.HILCheckpoint.update(cp.id, { tier: "tier_1", escalated: true });
          escalated.push({ id: cp.id, stage: cp.stage, grant_id: cp.grant_id });
        }
      }

      return Response.json({ ok: true, escalated_count: escalated.length, escalated });
    }

    // ─── PENDING SUMMARY ───
    if (action === "get_pending") {
      const all = await base44.asServiceRole.entities.HILCheckpoint.filter({ decision: "pending" });
      const now = Date.now();

      const tier1 = all.filter((c: any) => c.tier === "tier_1");
      const tier2 = all.filter((c: any) => c.tier === "tier_2");

      const withAge = (cps: any[]) => cps.map((c: any) => ({
        id: c.id, stage: c.stage, grant_id: c.grant_id, action_required: c.action_required,
        presented_at: c.presented_at,
        age_hours: Math.round((now - new Date(c.presented_at).getTime()) / 3600000 * 10) / 10,
        expires_in_hours: c.auto_action_at ? Math.max(0, Math.round((new Date(c.auto_action_at).getTime() - now) / 3600000 * 10) / 10) : null,
      }));

      return Response.json({
        ok: true,
        total_pending: all.length,
        pipeline_blocked: tier1.length > 0,
        tier_1_blocking: withAge(tier1),
        tier_2_review: withAge(tier2),
        oldest_hours: all.reduce((max: number, c: any) => Math.max(max, (now - new Date(c.presented_at).getTime()) / 3600000), 0),
      });
    }

    // ─── GET HISTORY ───
    if (action === "get_history") {
      const { grant_id, application_id, limit = 20 } = body;
      const query: any = {};
      if (grant_id) query.grant_id = grant_id;
      if (application_id) query.application_id = application_id;
      const history = await base44.asServiceRole.entities.HILCheckpoint.filter(query);
      return Response.json({ ok: true, total: history.length, checkpoints: history.slice(0, limit) });
    }

    return Response.json({ error: "Invalid action. Use: create | decide | batch_approve | check_timeouts | get_pending | get_history" }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
