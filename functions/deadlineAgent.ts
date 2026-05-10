import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const PIPELINE_STAGES = [
  "Discovered", "Evaluating", "Preparing", "Drafting",
  "Internal Review", "Final Review", "Submitted",
  "Awaiting Decision", "Awarded", "Declined", "Reporting",
];

const DEADLINE_RULES: { days: number; stage_target: string; message: string; severity: string }[] = [
  { days: 60, stage_target: "Preparing", message: "Begin preparation — 60 days to deadline", severity: "info" },
  { days: 30, stage_target: "Drafting", message: "Draft should be in progress — 30 days to deadline", severity: "info" },
  { days: 14, stage_target: "Internal Review", message: "Internal review should begin — 2 weeks to deadline", severity: "warning" },
  { days: 7, stage_target: "Final Review", message: "Final review and compliance check needed — 1 week to deadline", severity: "warning" },
  { days: 3, stage_target: "Final Review", message: "Urgent: submit within 3 days", severity: "critical" },
  { days: 1, stage_target: "Submitted", message: "Critical: deadline is tomorrow", severity: "critical" },
];

function getWorkbackSchedule(deadline: Date): Record<string, string> {
  return {
    "Start Preparation": new Date(deadline.getTime() - 60 * 86400000).toISOString().split("T")[0],
    "Begin Drafting": new Date(deadline.getTime() - 30 * 86400000).toISOString().split("T")[0],
    "Internal Review": new Date(deadline.getTime() - 14 * 86400000).toISOString().split("T")[0],
    "Final Review + Compliance": new Date(deadline.getTime() - 7 * 86400000).toISOString().split("T")[0],
    "Final Revisions": new Date(deadline.getTime() - 3 * 86400000).toISOString().split("T")[0],
    "Submit": deadline.toISOString().split("T")[0],
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { action = "check_all", application_id, org_profile_id } = body;
    // action: "check_all" | "workback" | "pipeline_status" | "update_stage"

    if (action === "update_stage") {
      if (!application_id || !body.stage) return Response.json({ error: "application_id and stage required" }, { status: 400 });
      if (!PIPELINE_STAGES.includes(body.stage)) return Response.json({ error: `Invalid stage. Options: ${PIPELINE_STAGES.join(", ")}` }, { status: 400 });
      await base44.asServiceRole.entities.GrantApplication.update(application_id, { pipeline_stage: body.stage });
      return Response.json({ ok: true, application_id, new_stage: body.stage });
    }

    if (action === "workback") {
      if (!application_id) return Response.json({ error: "application_id required" }, { status: 400 });
      const apps = await base44.asServiceRole.entities.GrantApplication.filter({ id: application_id });
      if (!apps?.length) return Response.json({ error: "Application not found" }, { status: 404 });
      const app = apps[0];
      if (!app.deadline) return Response.json({ error: "No deadline set on application" }, { status: 400 });
      
      const deadline = new Date(app.deadline);
      const schedule = getWorkbackSchedule(deadline);
      const daysRemaining = Math.round((deadline.getTime() - Date.now()) / 86400000);
      
      return Response.json({ ok: true, application_id, deadline: app.deadline, days_remaining: daysRemaining, workback_schedule: schedule });
    }

    if (action === "pipeline_status" || action === "check_all") {
      // Load all active applications for org
      const query: any = {};
      if (org_profile_id) query.org_profile_id = org_profile_id;
      
      const allApps = await base44.asServiceRole.entities.GrantApplication.filter(query);
      const now = Date.now();
      
      const pipeline: any[] = [];
      const alerts: any[] = [];
      const overdueApps: any[] = [];

      // Check for overlapping deadlines (capacity planning)
      const upcomingDeadlines = allApps
        .filter((a: any) => a.deadline && new Date(a.deadline).getTime() > now)
        .sort((a: any, b: any) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());

      for (let i = 0; i < upcomingDeadlines.length - 1; i++) {
        const diff = (new Date(upcomingDeadlines[i + 1].deadline).getTime() - new Date(upcomingDeadlines[i].deadline).getTime()) / 86400000;
        if (diff < 7) {
          alerts.push({ severity: "warning", type: "capacity_conflict", message: `Two deadlines within ${Math.round(diff)} days of each other`, applications: [upcomingDeadlines[i].id, upcomingDeadlines[i + 1].id] });
        }
      }

      for (const app of allApps) {
        if (!app.deadline) {
          pipeline.push({ id: app.id, grant_id: app.grant_id, stage: app.pipeline_stage, deadline: null, days_remaining: null, status: "no_deadline" });
          continue;
        }

        const deadline = new Date(app.deadline);
        const daysRemaining = Math.round((deadline.getTime() - now) / 86400000);

        if (daysRemaining < 0) {
          overdueApps.push({ id: app.id, grant_id: app.grant_id, days_overdue: Math.abs(daysRemaining) });
        }

        // Check what alerts apply
        const appAlerts: any[] = [];
        for (const rule of DEADLINE_RULES) {
          if (daysRemaining <= rule.days && daysRemaining > 0) {
            appAlerts.push({ severity: rule.severity, message: rule.message, stage_target: rule.stage_target });
          }
        }

        pipeline.push({
          id: app.id,
          grant_id: app.grant_id,
          stage: app.pipeline_stage,
          deadline: app.deadline,
          days_remaining: daysRemaining,
          compliance_status: app.compliance_status,
          alerts: appAlerts,
          workback_schedule: getWorkbackSchedule(deadline),
          status: daysRemaining < 0 ? "overdue" : daysRemaining < 3 ? "critical" : daysRemaining < 14 ? "urgent" : "on_track",
        });
      }

      return Response.json({
        ok: true,
        total_applications: allApps.length,
        overdue: overdueApps.length,
        critical: pipeline.filter((p) => p.status === "critical").length,
        on_track: pipeline.filter((p) => p.status === "on_track").length,
        capacity_alerts: alerts,
        overdue_applications: overdueApps,
        pipeline: pipeline.sort((a, b) => (a.days_remaining ?? 999) - (b.days_remaining ?? 999)),
      });
    }

    return Response.json({ error: "Invalid action. Use: check_all | workback | pipeline_status | update_stage" }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
