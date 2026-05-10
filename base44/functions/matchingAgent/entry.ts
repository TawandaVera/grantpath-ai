import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
  });
  const data = await res.json();
  return data?.data?.[0]?.embedding || [];
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function hardFilter(grant: any, profile: any): { pass: boolean; reason?: string } {
  // Org type check
  if (grant.org_type_eligibility?.length > 0) {
    const orgTypeMap: Record<string, string[]> = {
      nonprofit: ["Nonprofits having a 501(c)(3) status with the IRS", "Nonprofits that do not have a 501(c)(3) status with the IRS", "Others"],
      edu: ["Public and State controlled institutions of higher education", "Private institutions of higher education", "Independent school districts"],
      gov: ["State governments", "County governments", "City or township governments", "Special district governments"],
      tribal: ["Native American tribal governments (Federally recognized)", "Native American tribal organizations (other than Federally recognized)"],
      small_biz: ["Small businesses", "For-profit organizations other than small businesses"],
      individual: ["Individuals"],
    };
    const allowed = orgTypeMap[profile.org_type] || [];
    const unrestricted = grant.org_type_eligibility.includes("Unrestricted (see text field entitled 'Additional Information on Eligibility')");
    if (!unrestricted && !grant.org_type_eligibility.some((e: string) => allowed.includes(e))) {
      return { pass: false, reason: `Org type '${profile.org_type}' not eligible` };
    }
  }

  // Deadline feasibility (>14 days remaining)
  if (grant.deadline) {
    const daysRemaining = (new Date(grant.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysRemaining < 14) {
      return { pass: false, reason: `Deadline too close (${Math.round(daysRemaining)} days)` };
    }
  }

  // Budget range alignment
  if (grant.funding_amount_max && profile.annual_budget) {
    if (grant.funding_amount_max < profile.annual_budget * 0.01) {
      return { pass: false, reason: "Funding amount too small relative to org budget" };
    }
  }

  return { pass: true };
}

async function generateMatchRationale(profile: any, grant: any, score: number): Promise<{
  rationale: string; strengths: string[]; concerns: string[]; action: string; competition: "low" | "medium" | "high";
}> {
  if (!OPENAI_API_KEY) {
    return {
      rationale: `This grant aligns with your organization's focus areas with a relevance score of ${score.toFixed(0)}/100.`,
      strengths: ["Mission alignment detected"],
      concerns: [],
      action: "Review grant guidelines and assess fit",
      competition: "medium",
    };
  }

  const prompt = `You are a grant matching expert. Given the org profile and grant below, provide a JSON response.

ORG PROFILE:
- Name: ${profile.org_name}
- Type: ${profile.org_type}
- Mission: ${profile.mission_statement}
- Focus areas: ${profile.focus_areas?.join(", ")}
- Annual budget: $${profile.annual_budget?.toLocaleString()}
- Funding needs: ${profile.funding_needs}

GRANT:
- Title: ${grant.title}
- Funder: ${grant.funder}
- Description: ${grant.description?.slice(0, 500)}
- Eligibility: ${grant.org_type_eligibility?.join(", ")}
- Amount: $${grant.funding_amount_min?.toLocaleString()} - $${grant.funding_amount_max?.toLocaleString()}
- Deadline: ${grant.deadline}

Relevance score calculated: ${score.toFixed(0)}/100

Respond with ONLY valid JSON:
{
  "rationale": "2-3 sentence explanation of why this is or isn't a strong match",
  "strengths": ["strength 1", "strength 2"],
  "concerns": ["concern 1"],
  "recommended_action": "one sentence action",
  "estimated_competition_level": "low|medium|high"
}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 400,
      }),
    });
    const data = await res.json();
    const content = JSON.parse(data.choices[0].message.content);
    return {
      rationale: content.rationale || "",
      strengths: content.strengths || [],
      concerns: content.concerns || [],
      action: content.recommended_action || "",
      competition: content.estimated_competition_level || "medium",
    };
  } catch {
    return {
      rationale: `Score ${score.toFixed(0)}/100 match based on mission and eligibility alignment.`,
      strengths: [],
      concerns: [],
      action: "Review grant details",
      competition: "medium",
    };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { org_profile_id, top_k = 20 } = body;

    if (!org_profile_id) {
      return Response.json({ error: "org_profile_id is required" }, { status: 400 });
    }

    // Load org profile
    const profiles = await base44.asServiceRole.entities.OrgProfile.filter({ id: org_profile_id });
    if (!profiles?.length) {
      return Response.json({ error: "OrgProfile not found" }, { status: 404 });
    }
    const profile = profiles[0];

    // Load active grants
    const grants = await base44.asServiceRole.entities.Grant.filter({ status: "active" });
    if (!grants?.length) {
      return Response.json({ ok: true, matches: [], message: "No active grants found" });
    }

    // Get profile embedding
    const profileText = `${profile.mission_statement} ${profile.focus_areas?.join(" ")} ${profile.funding_needs} ${profile.capacity_statement}`;
    const profileEmbedding = OPENAI_API_KEY ? await getEmbedding(profileText) : [];

    const scoredMatches: any[] = [];

    for (const grant of grants) {
      // Hard filter
      const filter = hardFilter(grant, profile);
      if (!filter.pass) continue;

      // Semantic similarity (30%)
      let semanticScore = 50; // default if no embeddings
      if (profileEmbedding.length) {
        const grantText = `${grant.title} ${grant.description} ${grant.category_tags?.join(" ")}`;
        const grantEmbedding = await getEmbedding(grantText);
        semanticScore = cosineSimilarity(profileEmbedding, grantEmbedding) * 100;
      }

      // Budget fit score (10%)
      let budgetScore = 50;
      if (grant.funding_amount_max && profile.annual_budget) {
        const ratio = grant.funding_amount_max / profile.annual_budget;
        budgetScore = ratio >= 0.1 && ratio <= 2 ? 80 : ratio >= 0.05 ? 60 : 30;
      }

      // Focus area keyword overlap (25% proxy for project alignment)
      const focusOverlap = profile.focus_areas?.filter((f: string) =>
        grant.category_tags?.some((t: string) => t.toLowerCase().includes(f.toLowerCase()) ||
          f.toLowerCase().includes(t.toLowerCase()))
      ).length || 0;
      const focusScore = Math.min(100, (focusOverlap / Math.max(profile.focus_areas?.length || 1, 1)) * 100 + 30);

      // Composite score
      const composite = (semanticScore * 0.30) + (focusScore * 0.25) + (budgetScore * 0.10) + 35; // 35 = baseline for capacity/history/funder
      const finalScore = Math.min(100, Math.max(0, composite));

      scoredMatches.push({ grant, score: finalScore });
    }

    // Sort by score, take top_k
    scoredMatches.sort((a, b) => b.score - a.score);
    const topMatches = scoredMatches.slice(0, top_k);

    const results = [];
    for (const { grant, score } of topMatches) {
      const { rationale, strengths, concerns, action, competition } = await generateMatchRationale(profile, grant, score);

      // Upsert GrantMatch record
      const existing = await base44.asServiceRole.entities.GrantMatch.filter({
        org_profile_id,
        grant_id: grant.grant_id,
      });

      const matchData = {
        org_profile_id,
        grant_id: grant.grant_id,
        relevance_score: parseFloat(score.toFixed(2)),
        match_rationale: rationale,
        strengths,
        concerns,
        recommended_action: action,
        estimated_competition_level: competition,
        deadline: grant.deadline,
        pipeline_stage: existing?.[0]?.pipeline_stage || "Discovered",
      };

      if (existing?.length) {
        await base44.asServiceRole.entities.GrantMatch.update(existing[0].id, matchData);
      } else {
        await base44.asServiceRole.entities.GrantMatch.create(matchData);
      }

      results.push({ grant_id: grant.grant_id, title: grant.title, relevance_score: score.toFixed(2), rationale });
    }

    return Response.json({ ok: true, matches_found: results.length, matches: results });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
