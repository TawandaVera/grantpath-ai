import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

async function callLLM(prompt: string): Promise<any> {
  if (!OPENAI_API_KEY) return null;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 1500,
    }),
  });
  const data = await res.json();
  try { return JSON.parse(data.choices[0].message.content); } catch { return null; }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { application_id } = body;

    if (!application_id) return Response.json({ error: "application_id is required" }, { status: 400 });

    const apps = await base44.asServiceRole.entities.GrantApplication.filter({ id: application_id });
    if (!apps?.length) return Response.json({ error: "Application not found" }, { status: 404 });
    const app = apps[0];

    const grants = await base44.asServiceRole.entities.Grant.filter({ grant_id: app.grant_id });
    const profiles = await base44.asServiceRole.entities.OrgProfile.filter({ id: app.org_profile_id });
    const grant = grants?.[0] || {};
    const profile = profiles?.[0] || {};
    const sections = app.sections || {};

    const issues: any[] = [];
    const checklist: Record<string, boolean> = {};

    // --- ELIGIBILITY CHECKS ---
    // Org type
    const orgTypeMap: Record<string, string[]> = {
      nonprofit: ["Nonprofits having a 501(c)(3) status with the IRS", "Nonprofits that do not have a 501(c)(3) status with the IRS"],
      edu: ["Public and State controlled institutions of higher education", "Private institutions of higher education"],
      gov: ["State governments", "County governments", "City or township governments"],
      tribal: ["Native American tribal governments (Federally recognized)"],
      small_biz: ["Small businesses"],
      individual: ["Individuals"],
    };
    const allowed = orgTypeMap[profile.org_type] || [];
    const unrestricted = grant.org_type_eligibility?.includes("Unrestricted (see text field entitled 'Additional Information on Eligibility')");
    const orgEligible = unrestricted || !grant.org_type_eligibility?.length || grant.org_type_eligibility.some((e: string) => allowed.includes(e));
    checklist["org_type_eligible"] = orgEligible;
    if (!orgEligible) {
      issues.push({ severity: "critical", category: "eligibility_verification", description: `Organization type '${profile.org_type}' may not be eligible for this grant.`, location: "Eligibility section", suggested_fix: "Verify eligibility requirements and consider if any exceptions apply." });
    }

    // Deadline feasibility
    const daysToDeadline = grant.deadline ? (new Date(grant.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24) : 999;
    checklist["deadline_feasible"] = daysToDeadline > 3;
    if (daysToDeadline <= 3 && daysToDeadline > 0) {
      issues.push({ severity: "critical", category: "deadline", description: `Deadline is in ${Math.round(daysToDeadline)} days.`, location: "Submission timeline", suggested_fix: "Prioritize submission immediately." });
    }

    // UEI / SAM.gov (registration)
    checklist["uei_present"] = !!profile.uei_number;
    if (!profile.uei_number) {
      issues.push({ severity: "critical", category: "eligibility_verification", description: "UEI number not found in organization profile.", location: "Org Profile", suggested_fix: "Register at SAM.gov and add your UEI number to your organization profile." });
    }

    // Cost sharing
    checklist["cost_sharing_addressed"] = !grant.cost_sharing_required || !!sections["Budget Narrative"];
    if (grant.cost_sharing_required && !sections["Budget Narrative"]) {
      issues.push({ severity: "warning", category: "document_completeness", description: "Cost sharing is required for this grant but no Budget Narrative has been drafted.", location: "Budget Narrative", suggested_fix: "Draft a Budget Narrative that explicitly addresses cost-sharing commitments." });
    }

    // --- DOCUMENT COMPLETENESS ---
    const requiredSections = ["Executive Summary", "Statement of Need", "Project Description", "Goals and Objectives", "Organizational Capacity"];
    for (const sec of requiredSections) {
      const present = !!sections[sec] && sections[sec].length > 100;
      checklist[`section_${sec.toLowerCase().replace(/ /g, "_")}`] = present;
      if (!present) {
        issues.push({ severity: present === false ? "critical" : "warning", category: "document_completeness", description: `Section "${sec}" is missing or too short.`, location: sec, suggested_fix: `Use the Writing Agent to draft the "${sec}" section.` });
      }
    }

    // Budget present
    checklist["budget_present"] = !!(app.budget_json || sections["Budget Narrative"]);
    if (!app.budget_json && !sections["Budget Narrative"]) {
      issues.push({ severity: "warning", category: "document_completeness", description: "No budget has been created for this application.", location: "Budget", suggested_fix: "Use the Budget Builder Agent to create a detailed budget." });
    }

    // --- LLM CONTENT QUALITY CHECK ---
    let llmIssues: any[] = [];
    if (OPENAI_API_KEY && Object.keys(sections).length > 0) {
      const sectionSummary = Object.entries(sections).map(([k, v]) => `[${k}]: ${String(v).slice(0, 300)}`).join("\n\n");
      const llmResult = await callLLM(`
You are a grant compliance expert. Review this grant application for content quality issues.

GRANT: ${grant.title} | Funder: ${grant.funder}
Funding: $${grant.funding_amount_min?.toLocaleString()} - $${grant.funding_amount_max?.toLocaleString()}
Tags: ${grant.category_tags?.join(", ")}

APPLICATION SECTIONS (truncated):
${sectionSummary}

Identify up to 5 content quality issues. Return JSON:
{
  "issues": [
    {
      "severity": "critical|warning|info",
      "category": "content_quality",
      "description": "...",
      "location": "section name",
      "suggested_fix": "..."
    }
  ]
}
`);
      llmIssues = llmResult?.issues || [];
    }

    const allIssues = [...issues, ...llmIssues];
    const criticalCount = allIssues.filter((i) => i.severity === "critical").length;
    const warningCount = allIssues.filter((i) => i.severity === "warning").length;

    // Score: start at 100, deduct for issues
    const score = Math.max(0, 100 - (criticalCount * 20) - (warningCount * 8));
    const status = criticalCount > 0 ? "not_ready" : warningCount > 2 ? "needs_attention" : "ready";

    // Save back to application
    await base44.asServiceRole.entities.GrantApplication.update(application_id, {
      compliance_score: score,
      compliance_status: status,
      compliance_issues: allIssues,
    });

    return Response.json({
      ok: true,
      application_id,
      compliance_score: score,
      status,
      critical_issues: criticalCount,
      warnings: warningCount,
      issues: allIssues,
      checklist,
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
