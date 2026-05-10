import { useState, useEffect } from "react";
import { Grant } from "@/api/entities";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function GrantDiscovery() {
  const [grants, setGrants] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [selectedGrant, setSelectedGrant] = useState(null);
  const [runResult, setRunResult] = useState(null);

  useEffect(() => { loadGrants(); }, []);

  useEffect(() => {
    let result = grants;
    if (statusFilter !== "all") result = result.filter((g) => g.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (g) =>
          g.title?.toLowerCase().includes(q) ||
          g.funder?.toLowerCase().includes(q) ||
          g.description?.toLowerCase().includes(q) ||
          g.category_tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    setFiltered(result);
  }, [grants, search, statusFilter]);

  async function loadGrants() {
    try {
      const data = await Grant.list();
      setGrants(data.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function runDiscovery() {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_BASE44_BACKEND_URL}/api/apps/${import.meta.env.VITE_BASE44_APP_ID}/functions/grantDiscoveryAgent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: search || "", rows: 25 }),
      });
      const data = await res.json();
      setRunResult(data);
      await loadGrants();
    } catch (e) {
      setRunResult({ error: e.message });
    } finally {
      setRunning(false);
    }
  }

  const daysUntil = (date) => {
    if (!date) return null;
    return Math.round((new Date(date) - new Date()) / 86400000);
  };

  const formatAmount = (min, max) => {
    if (!min && !max) return "Not specified";
    const fmt = (n) => n >= 1000000 ? `$${(n / 1000000).toFixed(1)}M` : `$${(n / 1000).toFixed(0)}K`;
    if (min && max) return `${fmt(min)} – ${fmt(max)}`;
    if (max) return `Up to ${fmt(max)}`;
    return `From ${fmt(min)}`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
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
                className={`px-3 py-2 text-sm rounded-lg transition-colors ${item.page === "GrantDiscovery" ? "bg-emerald-50 text-emerald-700 font-medium" : "text-gray-600 hover:text-emerald-700 hover:bg-emerald-50"}`}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Grant Discovery</h2>
            <p className="text-gray-500 mt-1">{grants.length} grants in database · Pulling from Grants.gov every 6 hours</p>
          </div>
          <button onClick={runDiscovery} disabled={running}
            className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-60 transition-colors">
            {running ? (
              <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Running...</>
            ) : (
              <><span>🔄</span> Run Discovery</>
            )}
          </button>
        </div>

        {runResult && (
          <div className={`mb-4 p-4 rounded-lg border ${runResult.error ? "bg-red-50 border-red-200 text-red-700" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>
            {runResult.error ? (
              <p>Error: {runResult.error}</p>
            ) : (
              <p>✅ Discovery complete: <strong>{runResult.new_grants}</strong> new grants added, <strong>{runResult.updated_grants}</strong> updated. ({runResult.total_available?.toLocaleString()} available on Grants.gov)</p>
            )}
          </div>
        )}

        {/* Search + Filter */}
        <div className="flex gap-3 mb-6">
          <div className="flex-1 relative">
            <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, funder, or keyword..."
              className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="unverified">Unverified</option>
          </select>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* Grant List */}
          <div className="col-span-2 space-y-3">
            {loading ? (
              <div className="text-center py-20 text-gray-400">
                <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                Loading grants...
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 text-gray-400 bg-white rounded-xl border border-gray-200">
                <div className="text-5xl mb-4">🔍</div>
                <p className="font-medium">No grants found</p>
                <p className="text-sm mt-1">Try running discovery or adjusting your search</p>
              </div>
            ) : (
              filtered.map((grant) => {
                const days = daysUntil(grant.deadline);
                return (
                  <div key={grant.id}
                    onClick={() => setSelectedGrant(grant)}
                    className={`bg-white rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md ${selectedGrant?.id === grant.id ? "border-emerald-500 shadow-md" : "border-gray-200"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${grant.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                            {grant.status}
                          </span>
                          {grant.source && <span className="text-xs text-gray-400">{grant.source}</span>}
                        </div>
                        <h3 className="font-semibold text-gray-900 text-sm leading-tight">{grant.title}</h3>
                        <p className="text-xs text-gray-500 mt-1">{grant.funder}</p>
                        {grant.category_tags?.length > 0 && (
                          <div className="flex gap-1 flex-wrap mt-2">
                            {grant.category_tags.slice(0, 3).map((tag) => (
                              <span key={tag} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-semibold text-gray-900">{formatAmount(grant.funding_amount_min, grant.funding_amount_max)}</p>
                        {days !== null && (
                          <p className={`text-xs mt-1 font-medium ${days < 0 ? "text-red-500" : days < 14 ? "text-orange-500" : "text-gray-500"}`}>
                            {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Detail Panel */}
          <div className="col-span-1">
            {selectedGrant ? (
              <div className="bg-white rounded-xl border border-gray-200 p-5 sticky top-4">
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${selectedGrant.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                    {selectedGrant.status}
                  </span>
                  <button onClick={() => setSelectedGrant(null)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
                </div>
                <h3 className="font-bold text-gray-900 text-sm leading-snug mb-1">{selectedGrant.title}</h3>
                <p className="text-xs text-gray-500 mb-3">{selectedGrant.funder}</p>

                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Funding</span>
                    <p className="font-semibold text-gray-900">{formatAmount(selectedGrant.funding_amount_min, selectedGrant.funding_amount_max)}</p>
                  </div>
                  {selectedGrant.deadline && (
                    <div>
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Deadline</span>
                      <p className="font-semibold text-gray-900">{new Date(selectedGrant.deadline).toLocaleDateString()}</p>
                    </div>
                  )}
                  {selectedGrant.org_type_eligibility?.length > 0 && (
                    <div>
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Eligible Orgs</span>
                      <div className="mt-1 space-y-1">
                        {selectedGrant.org_type_eligibility.slice(0, 3).map((e, i) => (
                          <p key={i} className="text-xs text-gray-700 bg-gray-50 px-2 py-1 rounded">{e}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedGrant.description && (
                    <div>
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Description</span>
                      <p className="text-xs text-gray-700 mt-1 line-clamp-5">{selectedGrant.description}</p>
                    </div>
                  )}
                </div>

                {selectedGrant.application_url && (
                  <a href={selectedGrant.application_url} target="_blank" rel="noopener noreferrer"
                    className="mt-4 block w-full text-center bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">
                    View on Grants.gov →
                  </a>
                )}
                <Link to={createPageUrl("GrantMatches")}
                  className="mt-2 block w-full text-center border border-emerald-600 text-emerald-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-50 transition-colors">
                  Find Matches for This
                </Link>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-5 text-center text-gray-400">
                <div className="text-4xl mb-3">👆</div>
                <p className="text-sm">Select a grant to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
