/**
 * GHIS-008: Financial / ROI Tracking Agent
 * Tracks cost-per-submission, ROI by grant class/funder,
 * and generates portfolio-level financial intelligence.
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const HOURLY_RATES: Record<string, number> = {
  discovery: 50,
  assessment: 75,
  writing: 100,
  review: 125,
  submission: 75,
  admin: 50,
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { action = "portfolio_report" } = body;

    // ─── PORTFOLIO REPORT ───
    if (action === "portfolio_report") {
      const outcomes = await base44.asServiceRole.entities.GrantOutcome.list();
      const applications = await base44.asServiceRole.entities.GrantApplication.list();
      const grants = await base44.asServiceRole.entities.Grant.list();

      const grantMap: Record<string, any> = {};
      grants.forEach((g: any) => { grantMap[g.grant_id] = g; });

      const submitted = outcomes.filter((o: any) => o.outcome !== "pending");
      const awarded = outcomes.filter((o: any) => o.outcome === "awarded");
      const declined = outcomes.filter((o: any) => o.outcome === "declined_by_funder");
      const pending = outcomes.filter((o: any) => o.outcome === "pending");

      const totalInvested = outcomes.reduce((sum: number, o: any) => sum + (o.cost_invested || 0), 0);
      const totalAwardedAmount = awarded.reduce((sum: number, o: any) => sum + (o.award_amount || 0), 0);
      const decided = awarded.length + declined.length;

      const successRate = decided > 0 ? awarded.length / decided : 0;
      const roi = totalInvested > 0 ? (totalAwardedAmount - totalInvested) / totalInvested : 0;
      const costPerSubmission = submitted.length > 0 ? totalInvested / submitted.length : 0;
      const costPerAward = awarded.length > 0 ? totalInvested / awarded.length : 0;
      const avgAward = awarded.length > 0 ? totalAwardedAmount / awarded.length : 0;

      // By funder
      const funderStats: Record<string, any> = {};
      for (const o of outcomes) {
        const f = o.funder_name || "Unknown";
        if (!funderStats[f]) funderStats[f] = { submitted: 0, awarded: 0, total_awarded_amount: 0 };
        funderStats[f].submitted++;
        if (o.outcome === "awarded") {
          funderStats[f].awarded++;
          funderStats[f].total_awarded_amount += o.award_amount || 0;
        }
      }
      for (const f of Object.keys(funderStats)) {
        funderStats[f].success_rate = funderStats[f].submitted > 0 ? +(funderStats[f].awarded / funderStats[f].submitted).toFixed(3) : 0;
      }

      // By class
      const classStats: Record<string, any> = {};
      for (const o of outcomes) {
        const c = o.class_id || "Unclassified";
        if (!classStats[c]) classStats[c] = { submitted: 0, awarded: 0, total_invested: 0, total_awarded: 0 };
        classStats[c].submitted++;
        classStats[c].total_invested += o.cost_invested || 0;
        if (o.outcome === "awarded") {
          classStats[c].awarded++;
          classStats[c].total_awarded += o.award_amount || 0;
        }
      }
      for (const c of Object.keys(classStats)) {
        const d = classStats[c];
        d.success_rate = d.submitted > 0 ? +(d.awarded / d.submitted).toFixed(3) : 0;
        d.roi = d.total_invested > 0 ? +((d.total_awarded - d.total_invested) / d.total_invested).toFixed(3) : 0;
      }

      const bestFunder = Object.entries(funderStats).sort((a: any, b: any) => b[1].success_rate - a[1].success_rate)[0]?.[0];
      const bestClass = Object.entries(classStats).sort((a: any, b: any) => b[1].roi - a[1].roi)[0]?.[0];

      // Recommendations
      const recommendations: string[] = [];
      if (roi < 0) recommendations.push("⚠️ Portfolio ROI is negative. Tighten GO threshold and reduce low-probability submissions.");
      else if (roi < 2) recommendations.push("Portfolio ROI is modest. Focus on highest-ROI grant classes.");
      else recommendations.push(`Strong portfolio ROI of ${roi.toFixed(1)}x. Current strategy is working.`);

      if (successRate < 0.15) recommendations.push("Success rate below 15%. Consider raising GO threshold to filter more aggressively.");
      if (costPerAward > 50000) recommendations.push(`Cost per award is $${costPerAward.toLocaleString(undefined, { maximumFractionDigits: 0 })}. Evaluate whether award size justifies investment.`);
      if (bestFunder) recommendations.push(`Best funder: ${bestFunder} (${(funderStats[bestFunder].success_rate * 100).toFixed(0)}% success rate). Prioritize.`);
      if (bestClass) recommendations.push(`Best class: ${bestClass} (ROI: ${classStats[bestClass].roi.toFixed(1)}x). Increase allocation.`);

      return Response.json({
        ok: true,
        report_date: new Date().toISOString().split("T")[0],
        portfolio_summary: {
          total_submissions: submitted.length,
          total_awarded: awarded.length,
          total_declined: declined.length,
          total_pending: pending.length,
          success_rate: +successRate.toFixed(4),
          success_rate_pct: `${(successRate * 100).toFixed(1)}%`,
        },
        financial_summary: {
          total_invested: +totalInvested.toFixed(2),
          total_awarded_amount: +totalAwardedAmount.toFixed(2),
          portfolio_roi: +roi.toFixed(4),
          roi_multiple: `${(roi + 1).toFixed(1)}x`,
          cost_per_submission: +costPerSubmission.toFixed(2),
          cost_per_award: +costPerAward.toFixed(2),
          average_award: +avgAward.toFixed(2),
        },
        by_funder: funderStats,
        by_class: classStats,
        best_performing_funder: bestFunder,
        best_performing_class: bestClass,
        recommendations,
      });
    }

    // ─── LOG INVESTMENT (time/cost for a grant) ───
    if (action === "log_investment") {
      const { grant_id, application_id, activity_type, hours, person, notes } = body;
      if (!grant_id || !activity_type || !hours) return Response.json({ error: "grant_id, activity_type, hours required" }, { status: 400 });

      const rate = HOURLY_RATES[activity_type] || 75;
      const cost = hours * rate;

      // Update GrantOutcome cost if exists, or store in notes
      const existing = await base44.asServiceRole.entities.GrantOutcome.filter({ grant_id });
      if (existing.length > 0) {
        const prev = existing[0];
        const newHours = (prev.hours_invested || 0) + hours;
        const newCost = (prev.cost_invested || 0) + cost;
        await base44.asServiceRole.entities.GrantOutcome.update(existing[0].id, {
          hours_invested: newHours,
          cost_invested: newCost,
          notes: `${prev.notes || ""} | ${activity_type}: ${hours}h @$${rate}/h = $${cost} (${person || "team"})`,
        });
      } else {
        await base44.asServiceRole.entities.GrantOutcome.create({
          grant_id, application_id, outcome: "pending",
          hours_invested: hours, cost_invested: cost,
          notes: `${activity_type}: ${hours}h @$${rate}/h = $${cost} (${person || "team"})`,
        });
      }

      return Response.json({
        ok: true,
        grant_id,
        activity_type,
        hours,
        hourly_rate: rate,
        cost,
        person: person || "team",
        notes,
      });
    }

    // ─── GET GRANT ROI ───
    if (action === "get_grant_roi") {
      const { grant_id } = body;
      if (!grant_id) return Response.json({ error: "grant_id required" }, { status: 400 });

      const outcomes = await base44.asServiceRole.entities.GrantOutcome.filter({ grant_id });
      if (!outcomes.length) return Response.json({ ok: false, error: "No outcome record found for this grant" });

      const o = outcomes[0];
      const roi = o.cost_invested > 0 ? (o.award_amount - o.cost_invested) / o.cost_invested : null;

      return Response.json({
        ok: true,
        grant_id,
        outcome: o.outcome,
        hours_invested: o.hours_invested,
        cost_invested: o.cost_invested,
        award_amount: o.award_amount,
        roi: roi !== null ? +roi.toFixed(4) : null,
        roi_multiple: roi !== null ? `${(roi + 1).toFixed(1)}x` : null,
      });
    }

    return Response.json({ error: "Invalid action. Use: portfolio_report | log_investment | get_grant_roi" }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
