import { useState, useEffect } from "react";
import { OrgProfile } from "@/api/entities";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

const ORG_TYPES = ["nonprofit", "edu", "gov", "tribal", "small_biz", "individual"];
const FOCUS_AREA_SUGGESTIONS = [
  "health equity", "digital health", "workforce development", "community engagement",
  "mental health", "substance abuse", "maternal health", "pediatrics", "chronic disease",
  "HIV/AIDS", "social determinants of health", "rural health", "primary care",
  "health informatics", "public health", "environmental health",
];

export default function OrgProfileSetup() {
  const [profiles, setProfiles] = useState([]);
  const [form, setForm] = useState({
    org_name: "", org_type: "nonprofit", mission_statement: "", location_state: "",
    location_country: "United States", annual_budget: "", team_size: "",
    focus_areas: [], funding_needs: "", capacity_statement: "",
    preferred_funders: [], uei_number: "", ein_number: "", sam_gov_active: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [focusInput, setFocusInput] = useState("");
  const [funderInput, setFunderInput] = useState("");
  const [editingId, setEditingId] = useState(null);

  useEffect(() => { loadProfiles(); }, []);

  async function loadProfiles() {
    try {
      const data = await OrgProfile.list();
      setProfiles(data);
      if (data.length > 0) {
        const p = data[0];
        setForm({ ...p, annual_budget: p.annual_budget || "", team_size: p.team_size || "" });
        setEditingId(p.id);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function saveProfile() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        annual_budget: form.annual_budget ? parseFloat(form.annual_budget) : null,
        team_size: form.team_size ? parseInt(form.team_size) : null,
      };
      if (editingId) {
        await OrgProfile.update(editingId, payload);
      } else {
        const created = await OrgProfile.create(payload);
        setEditingId(created.id);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  }

  function addFocusArea(area) {
    if (area && !form.focus_areas.includes(area)) {
      setForm({ ...form, focus_areas: [...form.focus_areas, area] });
    }
    setFocusInput("");
  }

  function removeFocusArea(area) {
    setForm({ ...form, focus_areas: form.focus_areas.filter((f) => f !== area) });
  }

  function addFunder(funder) {
    if (funder && !form.preferred_funders.includes(funder)) {
      setForm({ ...form, preferred_funders: [...form.preferred_funders, funder] });
    }
    setFunderInput("");
  }

  function removeFunder(f) {
    setForm({ ...form, preferred_funders: form.preferred_funders.filter((x) => x !== f) });
  }

  const completionFields = ["org_name", "org_type", "mission_statement", "location_state", "annual_budget", "team_size", "funding_needs", "capacity_statement"];
  const completed = completionFields.filter((f) => form[f]).length;
  const completionPct = Math.round((completed / completionFields.length) * 100);

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">GP</span>
            </div>
            <h1 className="text-lg font-bold text-gray-900">Grant Path AI</h1>
          </div>
          <nav className="flex gap-1">
            {[
              { label: "Dashboard", page: "Dashboard" },
              { label: "Discover", page: "GrantDiscovery" },
              { label: "Matches", page: "GrantMatches" },
              { label: "Applications", page: "Applications" },
              { label: "Pipeline", page: "Pipeline" },
              { label: "Org Profile", page: "OrgProfileSetup" },
            ].map((item) => (
              <Link key={item.page} to={createPageUrl(item.page)}
                className={`px-3 py-2 text-sm rounded-lg transition-colors ${item.page === "OrgProfileSetup" ? "bg-emerald-50 text-emerald-700 font-medium" : "text-gray-600 hover:text-emerald-700 hover:bg-emerald-50"}`}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Organization Profile</h2>
            <p className="text-gray-500 mt-1">This powers the matching engine — the more complete, the better your matches</p>
          </div>
          <div className="text-right">
            <div className="text-sm font-medium text-gray-700">{completionPct}% complete</div>
            <div className="w-32 bg-gray-200 rounded-full h-2 mt-1">
              <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${completionPct}%` }} />
            </div>
          </div>
        </div>

        {saved && (
          <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center gap-2">
            <span>✅</span> Profile saved successfully
          </div>
        )}

        <div className="space-y-6">
          {/* Basic Info */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Basic Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-sm font-medium text-gray-700">Organization Name *</label>
                <input value={form.org_name} onChange={(e) => setForm({ ...form, org_name: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="GHIS LLC" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Organization Type *</label>
                <select value={form.org_type} onChange={(e) => setForm({ ...form, org_type: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                  {ORG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">State / Region</label>
                <input value={form.location_state} onChange={(e) => setForm({ ...form, location_state: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="e.g. Maryland" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Annual Budget ($)</label>
                <input type="number" value={form.annual_budget} onChange={(e) => setForm({ ...form, annual_budget: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="e.g. 500000" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Team Size</label>
                <input type="number" value={form.team_size} onChange={(e) => setForm({ ...form, team_size: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="e.g. 12" />
              </div>
            </div>
          </div>

          {/* Mission & Capacity */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Mission & Capacity</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Mission Statement *</label>
                <textarea value={form.mission_statement} onChange={(e) => setForm({ ...form, mission_statement: e.target.value })}
                  rows={3} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                  placeholder="Describe your organization's mission in 2-4 sentences..." />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Funding Needs</label>
                <textarea value={form.funding_needs} onChange={(e) => setForm({ ...form, funding_needs: e.target.value })}
                  rows={2} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                  placeholder="What are you seeking funding for?" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Capacity Statement</label>
                <textarea value={form.capacity_statement} onChange={(e) => setForm({ ...form, capacity_statement: e.target.value })}
                  rows={3} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                  placeholder="Describe your team's expertise, past performance, and capabilities..." />
              </div>
            </div>
          </div>

          {/* Focus Areas */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Focus Areas</h3>
            <div className="flex gap-2 mb-3">
              <input value={focusInput} onChange={(e) => setFocusInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addFocusArea(focusInput)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Type a focus area and press Enter" />
              <button onClick={() => addFocusArea(focusInput)} className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm">Add</button>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {form.focus_areas.map((area) => (
                <span key={area} className="flex items-center gap-1 bg-emerald-50 text-emerald-700 text-xs px-3 py-1.5 rounded-full border border-emerald-200">
                  {area}
                  <button onClick={() => removeFocusArea(area)} className="text-emerald-500 hover:text-emerald-700 ml-1">×</button>
                </span>
              ))}
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-2">Suggestions:</p>
              <div className="flex flex-wrap gap-1.5">
                {FOCUS_AREA_SUGGESTIONS.filter((s) => !form.focus_areas.includes(s)).slice(0, 10).map((s) => (
                  <button key={s} onClick={() => addFocusArea(s)}
                    className="text-xs border border-gray-200 text-gray-600 px-2.5 py-1 rounded-full hover:border-emerald-400 hover:text-emerald-600 transition-colors">
                    + {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Compliance & Registration */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Compliance & Registration</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700">UEI Number</label>
                <input value={form.uei_number} onChange={(e) => setForm({ ...form, uei_number: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="SAM.gov UEI" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">EIN Number</label>
                <input value={form.ein_number} onChange={(e) => setForm({ ...form, ein_number: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="XX-XXXXXXX" />
              </div>
              <div className="col-span-2 flex items-center gap-3">
                <input type="checkbox" id="sam" checked={form.sam_gov_active}
                  onChange={(e) => setForm({ ...form, sam_gov_active: e.target.checked })}
                  className="w-4 h-4 accent-emerald-600" />
                <label htmlFor="sam" className="text-sm text-gray-700">SAM.gov registration is active</label>
              </div>
            </div>
          </div>

          {/* Preferred Funders */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Preferred Funders</h3>
            <div className="flex gap-2 mb-3">
              <input value={funderInput} onChange={(e) => setFunderInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addFunder(funderInput)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="e.g. Robert Wood Johnson Foundation" />
              <button onClick={() => addFunder(funderInput)} className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm">Add</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {form.preferred_funders.map((f) => (
                <span key={f} className="flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-3 py-1.5 rounded-full border border-blue-200">
                  {f}
                  <button onClick={() => removeFunder(f)} className="text-blue-400 hover:text-blue-700 ml-1">×</button>
                </span>
              ))}
            </div>
          </div>

          {/* Save */}
          <div className="flex justify-end">
            <button onClick={saveProfile} disabled={saving || !form.org_name}
              className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-emerald-700 disabled:opacity-60 transition-colors text-sm">
              {saving ? "Saving..." : editingId ? "Update Profile" : "Create Profile"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
