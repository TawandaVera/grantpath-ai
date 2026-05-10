import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

const IDC_RATES: Record<string, number> = {
  nonprofit: 0.10,  // typical de minimis
  edu: 0.26,        // typical university NICRA
  gov: 0.08,
  tribal: 0.10,
  small_biz: 0.15,
  individual: 0.00,
};

const FRINGE_RATES: Record<string, number> = {
  fulltime: 0.30,
  parttime: 0.15,
  consultant: 0.00,
};

async function callLLM(prompt: string): Promise<string> {
  if (!OPENAI_API_KEY) return "";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { application_id, line_items, action = "build" } = body;
    // action: "build" | "estimate" | "narrative"
    // line_items: [{category, description, quantity, unit_cost, employee_type}]

    if (!application_id) return Response.json({ error: "application_id is required" }, { status: 400 });

    const apps = await base44.asServiceRole.entities.GrantApplication.filter({ id: application_id });
    if (!apps?.length) return Response.json({ error: "Application not found" }, { status: 404 });
    const app = apps[0];

    const grants = await base44.asServiceRole.entities.Grant.filter({ grant_id: app.grant_id });
    const profiles = await base44.asServiceRole.entities.OrgProfile.filter({ id: app.org_profile_id });
    const grant = grants?.[0] || {};
    const profile = profiles?.[0] || {};

    const idcRate = IDC_RATES[profile.org_type] || 0.10;

    if (action === "estimate") {
      // Auto-generate a suggested budget structure based on grant size
      const maxAmount = grant.funding_amount_max || 100000;
      const suggested = [
        { category: "Personnel", description: "Project Director (0.5 FTE)", quantity: 1, unit_cost: maxAmount * 0.35, employee_type: "fulltime" },
        { category: "Personnel", description: "Program Coordinator (0.5 FTE)", quantity: 1, unit_cost: maxAmount * 0.25, employee_type: "fulltime" },
        { category: "Supplies", description: "Program supplies and materials", quantity: 1, unit_cost: maxAmount * 0.05, employee_type: null },
        { category: "Travel", description: "Domestic travel for program activities", quantity: 1, unit_cost: maxAmount * 0.05, employee_type: null },
        { category: "Contractual", description: "Evaluation consultant", quantity: 1, unit_cost: maxAmount * 0.10, employee_type: "consultant" },
        { category: "Other Direct Costs", description: "Communications, printing, meetings", quantity: 1, unit_cost: maxAmount * 0.05, employee_type: null },
      ];
      return Response.json({ ok: true, action: "estimate", suggested_line_items: suggested, note: "Submit these as line_items with action=build to finalize the budget." });
    }

    if (action === "build" || action === "narrative") {
      if (!line_items?.length && action === "build") {
        return Response.json({ error: "line_items array required for build action" }, { status: 400 });
      }

      const items = line_items || app.budget_json?.line_items || [];

      // Calculate totals
      let totalPersonnel = 0, totalOtherDirect = 0, totalFringe = 0;
      const processedItems = items.map((item: any) => {
        const subtotal = (item.quantity || 1) * (item.unit_cost || 0);
        const fringe = item.employee_type && item.employee_type !== "consultant"
          ? subtotal * FRINGE_RATES[item.employee_type as keyof typeof FRINGE_RATES]
          : 0;
        if (item.category === "Personnel") {
          totalPersonnel += subtotal;
          totalFringe += fringe;
        } else {
          totalOtherDirect += subtotal;
        }
        return { ...item, subtotal, fringe_benefit: fringe };
      });

      const totalDirect = totalPersonnel + totalFringe + totalOtherDirect;
      const totalIndirect = totalDirect * idcRate;
      const grandTotal = totalDirect + totalIndirect;
      const costShareRequired = grant.cost_sharing_required;
      const costShareAmount = costShareRequired ? grandTotal * 0.10 : 0; // default 10% match

      const warnings: string[] = [];
      if (grant.funding_amount_max && grandTotal > grant.funding_amount_max) {
        warnings.push(`Budget ($${grandTotal.toLocaleString()}) exceeds maximum award ($${grant.funding_amount_max.toLocaleString()})`);
      }
      if (grant.funding_amount_min && grandTotal < grant.funding_amount_min) {
        warnings.push(`Budget ($${grandTotal.toLocaleString()}) is below minimum award ($${grant.funding_amount_min.toLocaleString()})`);
      }
      if (totalPersonnel / totalDirect > 0.75) {
        warnings.push("Personnel costs exceed 75% of total budget — some funders may flag this");
      }

      // Generate narrative
      let narrative = "";
      if (OPENAI_API_KEY) {
        narrative = await callLLM(`
Write a professional budget narrative/justification for this grant application.

GRANT: ${grant.title} | Funder: ${grant.funder}
ORG: ${profile.org_name} (${profile.org_type})
IDC Rate: ${(idcRate * 100).toFixed(0)}%

BUDGET SUMMARY:
- Total Personnel: $${totalPersonnel.toLocaleString()}
- Fringe Benefits: $${totalFringe.toLocaleString()}
- Other Direct Costs: $${totalOtherDirect.toLocaleString()}
- Indirect Costs (${(idcRate * 100).toFixed(0)}%): $${totalIndirect.toLocaleString()}
- Grand Total: $${grandTotal.toLocaleString()}
${costShareRequired ? `- Cost Share: $${costShareAmount.toLocaleString()}` : ""}

LINE ITEMS:
${processedItems.map((i: any) => `- ${i.category}: ${i.description} — $${i.subtotal.toLocaleString()}`).join("\n")}

Write a 3-5 paragraph budget narrative justifying each cost category. Be specific and connect costs to program activities.
`);
      } else {
        narrative = `Budget narrative for ${grant.title}.\n\nPersonnel ($${totalPersonnel.toLocaleString()}): Includes salaries and fringe benefits for project staff.\nOther Direct Costs ($${totalOtherDirect.toLocaleString()}): Program-related expenses.\nIndirect Costs ($${totalIndirect.toLocaleString()}): Applied at ${(idcRate * 100).toFixed(0)}% of total direct costs per organizational policy.`;
      }

      const budgetJson = {
        line_items: processedItems,
        totals: {
          personnel: totalPersonnel,
          fringe: totalFringe,
          other_direct: totalOtherDirect,
          total_direct: totalDirect,
          indirect_rate: idcRate,
          total_indirect: totalIndirect,
          cost_share: costShareAmount,
          grand_total: grandTotal,
        },
        idc_rate_applied: idcRate,
      };

      // Save to application
      await base44.asServiceRole.entities.GrantApplication.update(application_id, {
        budget_json: budgetJson,
        budget_narrative: narrative,
        grand_total: grandTotal,
      });

      return Response.json({
        ok: true,
        application_id,
        total_direct: totalDirect,
        total_indirect: totalIndirect,
        total_cost_share: costShareAmount,
        grand_total: grandTotal,
        idc_rate: `${(idcRate * 100).toFixed(0)}%`,
        warnings,
        budget_json: budgetJson,
        budget_narrative: narrative,
      });
    }

    return Response.json({ error: "Invalid action. Use: estimate | build | narrative" }, { status: 400 });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
