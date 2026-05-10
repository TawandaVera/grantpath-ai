import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const GRANTS_GOV_BASE = "https://apply07.grants.gov/grantsws/rest/opportunities/search/";

interface GrantsGovOpportunity {
  id: string;
  number: string;
  title: string;
  agencyName: string;
  description: string;
  openDate: string;
  closeDate: string;
  synopsisUrl: string;
  fundingInstrumentTypes: string[];
  categoryExplanation: string;
  eligibilities: string[];
  awardCeiling: number;
  awardFloor: number;
  costSharingOrMatchingReq: boolean;
}

function normalizeGrant(opp: any, source: string) {
  // Normalize eligibility codes to human-readable
  const eligibilityMap: Record<string, string> = {
    "00": "State governments",
    "01": "County governments",
    "02": "City or township governments",
    "04": "Special district governments",
    "05": "Independent school districts",
    "06": "Public and State controlled institutions of higher education",
    "07": "Native American tribal governments (Federally recognized)",
    "08": "Public housing authorities/Indian housing authorities",
    "11": "Native American tribal organizations (other than Federally recognized)",
    "12": "Nonprofits having a 501(c)(3) status with the IRS",
    "13": "Nonprofits that do not have a 501(c)(3) status with the IRS",
    "20": "Private institutions of higher education",
    "21": "Individuals",
    "22": "For-profit organizations other than small businesses",
    "23": "Small businesses",
    "25": "Others",
    "99": "Unrestricted (see text field entitled 'Additional Information on Eligibility')",
  };

  const orgTypes: string[] = [];
  if (opp.applicantTypes) {
    for (const code of opp.applicantTypes) {
      if (eligibilityMap[String(code)]) {
        orgTypes.push(eligibilityMap[String(code)]);
      }
    }
  }

  // Auto-tag category
  const tags: string[] = [];
  if (opp.fundingInstrumentTypes) tags.push(...opp.fundingInstrumentTypes);
  if (opp.opportunityCategories) tags.push(...opp.opportunityCategories);

  // Normalize deadline
  let deadline: string | null = null;
  if (opp.closeDate) {
    try {
      // closeDate format: MMDDYYYY
      const d = opp.closeDate;
      if (d.length === 8) {
        const iso = `${d.slice(4, 8)}-${d.slice(0, 2)}-${d.slice(2, 4)}T23:59:59Z`;
        deadline = iso;
      } else {
        deadline = new Date(d).toISOString();
      }
    } catch {
      deadline = null;
    }
  }

  return {
    grant_id: `grantsgov_${opp.id || opp.number}`,
    title: opp.title || "Untitled",
    funder: opp.agencyName || opp.agencyCode || "Unknown Agency",
    description: opp.description || opp.synopsisText || "",
    eligibility_criteria: opp.additionalInformationOnEligibility
      ? [opp.additionalInformationOnEligibility]
      : [],
    funding_amount_min: opp.awardFloor ?? null,
    funding_amount_max: opp.awardCeiling ?? null,
    deadline,
    application_url: opp.synopsisUrl ||
      `https://www.grants.gov/web/grants/view-opportunity.html?oppId=${opp.id}`,
    category_tags: tags,
    geographic_restrictions: [],
    org_type_eligibility: orgTypes,
    cost_sharing_required: opp.costSharingOrMatchingReq ?? false,
    source,
    status: deadline && new Date(deadline) > new Date() ? "active" : "expired",
    last_verified: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json().catch(() => ({}));
    const keyword = body.keyword || "";
    const rows = body.rows || 25; // max we pull per run
    const startRecordNum = body.startRecordNum || 1;

    // Fetch from Grants.gov search API
    const searchPayload = {
      keyword,
      oppStatuses: "posted",
      rows,
      startRecordNum,
      sortBy: "openDate|desc",
    };

    const response = await fetch(GRANTS_GOV_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(searchPayload),
    });

    if (!response.ok) {
      const errText = await response.text();
      return Response.json(
        { error: `Grants.gov API error: ${response.status}`, detail: errText },
        { status: 502 }
      );
    }

    const data = await response.json();
    const opportunities = data.oppHits || [];

    const results = {
      total_fetched: opportunities.length,
      total_available: data.hitCount || 0,
      new_grants: 0,
      updated_grants: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const opp of opportunities) {
      try {
        const normalized = normalizeGrant(opp, "grants.gov");

        // Check for existing record (dedup by grant_id)
        const existing = await base44.asServiceRole.entities.Grant.filter({
          grant_id: normalized.grant_id,
        });

        if (existing && existing.length > 0) {
          // Update last_verified + status
          await base44.asServiceRole.entities.Grant.update(existing[0].id, {
            last_verified: normalized.last_verified,
            status: normalized.status,
            funding_amount_min: normalized.funding_amount_min,
            funding_amount_max: normalized.funding_amount_max,
            deadline: normalized.deadline,
          });
          results.updated_grants++;
        } else {
          // Create new record
          await base44.asServiceRole.entities.Grant.create(normalized);
          results.new_grants++;
        }
      } catch (err: any) {
        results.errors.push(`${opp.id}: ${err.message}`);
        results.skipped++;
      }
    }

    return Response.json({
      ok: true,
      timestamp: new Date().toISOString(),
      source: "grants.gov",
      ...results,
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
