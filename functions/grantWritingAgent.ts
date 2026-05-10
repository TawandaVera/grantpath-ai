import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

const SUPPORTED_SECTIONS = [
  "Executive Summary",
  "Statement of Need",
  "Project Description",
  "Goals and Objectives",
  "Methods and Approach",
  "Evaluation Plan",
  "Organizational Capacity",
  "Sustainability Plan",
  "Budget Narrative",
  "Logic Model",
  "Letters of Support",
  "Data Management Plan",
];

async function callLLM(systemPrompt: string, userPrompt: string, maxTokens = 1200): Promise<string> {
  if (!OPENAI_API_KEY) return "[OpenAI API key not configured — set OPENAI_API_KEY to enable content generation]";
  
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { application_id, section, feedback, action = "draft" } = body;
    // action: "draft" | "refine" | "outline" | "all_sections"

    if (!application_id) return Response.json({ error: "application_id is required" }, { status: 400 });

    const apps = await base44.asServiceRole.entities.GrantApplication.filter({ id: application_id });
    if (!apps?.length) return Response.json({ error: "Application not found" }, { status: 404 });
    const app = apps[0];

    // Load grant and org profile
    const grants = await base44.asServiceRole.entities.Grant.filter({ grant_id: app.grant_id });
    const profiles = await base44.asServiceRole.entities.OrgProfile.filter({ id: app.org_profile_id });
    const grant = grants?.[0] || {};
    const profile = profiles?.[0] || {};

    const systemPrompt = `You are an expert grant writer with 20+ years of experience writing successful grant proposals. 
You write in a professional, compelling, evidence-based style. 
You adapt your tone to match funder expectations and focus on measurable outcomes.
Always be specific, avoid jargon, and connect organizational strengths to funder priorities.`;

    let result: any = {};

    if (action === "outline") {
      const outline = await callLLM(systemPrompt, `
Create a structured outline for a grant proposal for the following:

GRANT: ${grant.title} | Funder: ${grant.funder}
Grant Description: ${grant.description?.slice(0, 600)}
Funding Amount: $${grant.funding_amount_min?.toLocaleString()} - $${grant.funding_amount_max?.toLocaleString()}

ORG: ${profile.org_name} (${profile.org_type})
Mission: ${profile.mission_statement}
Focus Areas: ${profile.focus_areas?.join(", ")}

Provide a JSON outline with sections, their purpose, recommended length (words), and key points to cover.
Format: {"sections": [{"name": "...", "purpose": "...", "word_count": 300, "key_points": ["..."]}]}
`, 800);
      result = { action: "outline", outline: JSON.parse(outline.match(/\{[\s\S]*\}/)?.[0] || '{"sections":[]}') };

    } else if (action === "draft" && section) {
      if (!SUPPORTED_SECTIONS.includes(section)) {
        return Response.json({ error: `Unsupported section. Valid: ${SUPPORTED_SECTIONS.join(", ")}` }, { status: 400 });
      }
      const existingContent = app.sections?.[section] || "";
      const draft = await callLLM(systemPrompt, `
Draft the "${section}" section for this grant proposal.

GRANT: ${grant.title}
Funder: ${grant.funder}
Description: ${grant.description?.slice(0, 600)}

ORG PROFILE:
- Name: ${profile.org_name}
- Type: ${profile.org_type}  
- Mission: ${profile.mission_statement}
- Focus Areas: ${profile.focus_areas?.join(", ")}
- Team Size: ${profile.team_size}
- Annual Budget: $${profile.annual_budget?.toLocaleString()}
- Funding Needs: ${profile.funding_needs}
- Capacity: ${profile.capacity_statement}

${existingContent ? `EXISTING DRAFT (improve upon this):\n${existingContent}` : "Write a strong first draft."}

Write 300-500 words unless the section type calls for less. Be specific and compelling.
`, 1200);

      const updatedSections = { ...(app.sections || {}), [section]: draft };
      await base44.asServiceRole.entities.GrantApplication.update(application_id, { sections: updatedSections });
      result = { action: "draft", section, content: draft };

    } else if (action === "refine" && section && feedback) {
      const currentContent = app.sections?.[section] || "";
      if (!currentContent) return Response.json({ error: "No existing draft to refine for this section" }, { status: 400 });
      
      const refined = await callLLM(systemPrompt, `
Refine the following "${section}" section based on the feedback provided.

CURRENT DRAFT:
${currentContent}

FEEDBACK:
${feedback}

GRANT CONTEXT: ${grant.title} | ${grant.funder}

Provide an improved version that addresses all feedback while maintaining the original strengths.
`, 1200);

      const updatedSections = { ...(app.sections || {}), [section]: refined };
      await base44.asServiceRole.entities.GrantApplication.update(application_id, { sections: updatedSections });
      result = { action: "refine", section, original_feedback: feedback, content: refined };

    } else if (action === "all_sections") {
      const drafted: Record<string, string> = { ...(app.sections || {}) };
      const coreSections = ["Executive Summary", "Statement of Need", "Project Description", "Goals and Objectives", "Methods and Approach", "Organizational Capacity"];
      
      for (const sec of coreSections) {
        if (!drafted[sec]) {
          const draft = await callLLM(systemPrompt, `
Draft the "${sec}" section (200-350 words) for:
GRANT: ${grant.title} | ${grant.funder}
ORG: ${profile.org_name} | ${profile.mission_statement?.slice(0, 200)}
Focus: ${profile.focus_areas?.join(", ")}
`, 600);
          drafted[sec] = draft;
        }
      }
      await base44.asServiceRole.entities.GrantApplication.update(application_id, { sections: drafted });
      result = { action: "all_sections", sections_drafted: coreSections, sections: drafted };
    } else {
      return Response.json({ error: "Invalid action or missing parameters. Use action: outline|draft|refine|all_sections" }, { status: 400 });
    }

    return Response.json({ ok: true, application_id, ...result });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
