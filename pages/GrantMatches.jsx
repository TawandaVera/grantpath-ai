import { useState, useEffect } from "react";
import { GrantMatch } from "@/api/entities";
import { OrgProfile } from "@/api/entities";
import { Grant } from "@/api/entities";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function GrantMatches() {
  const [matches, setMatches] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [grantMap, setGrantMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [minScore, setMinScore] = useState(0);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [matchList, profileList, grantList] = await Promise.all([
        GrantMatch.list(),
        OrgProfile.list(),
        Grant.list(),
      ]);
      setMatches(matchList.sort((a, b) => b.relevance_score - a.relevance_score));
      setProfiles(profileList);
      if (profileList.length > 0) setSelectedProfile(profileList[0]);
      const map = {};
      grantList.forEach((g) => { map[g.grant_id] = g; });
      setGrantMap(map);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function runMatching() {
    if (!selectedProfile) return;
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_BASE44_BACKEND_URL}/api/apps/${import.meta.env.VITE_BASE44_APP_ID}/functions/matchingAgent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ org_profile_id: selectedProfile.id, top_k: 20 }),
        }
      );
      const data = await res.json();
      setRunResult(data);
      const updated = await GrantMatch.list();
      setMatches(updated.sort((a, b) => b.relevance_score - a.relevance_score));
    } catch (e) {
      setRunResult({ error: e.message });
    } finally {
      setRunning(false);
    }
  }

  async function updateFeedback(matchId, feedback) {
    await GrantMatch.update(matchId, { user_feedback: feedback });
    setMatches((prev) => prev.map((m) => m.id === matchId ? { ...m, user_feedback: feedback } : m));
  }

  const scoreColor = (score) => {
    if (score >= 70) return "text-emerald-700 bg-emerald-100";
    if (score >= 50) return "text-yellow-700 bg-yellow-100";
    return "text-gray-600 bg-gray-100";
  };

  const competitionColor = { low: "text-green-600", medium: "text-yellow-600", high: "text-red-600" };

  const filteredMatches = matches.filter((m) => m.relevance_score >= minScore);

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
                className={`px-3 py-2 text-sm rounded-lg transition-colors ${item.page === "GrantMatches" ? "bg-emerald-50 text-emerald-700 font-medium" : "text-gray-600 hover:text-emerald-700 hover:bg-emerald-50"}`}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Grant Matches</h2>
            <p className="text-gray-500 mt-1">AI-scored matches based on your organization profile</p>
          </div>
          <div className="flex items-center gap-3">
            {profiles.length > 1 && (
              <select value={selectedProfile?.id} onChange={(e) => setSelectedProfile(profiles.find((p) => p.id === e.target.value))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.org_name}</option>)}
              </select>
            )}
            <button onClick={runMatching} disabled={running || !selectedProfile}
              className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-60 transition-colors">
              {running ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Matching...</>
              ) : "🎯 Run Matching"}
            </button>
          </div>
        </div>

        {runResult && (
          <div className={`mb-4 p-4 rounded-lg border ${runResult.error ? "bg-red-50 border-red-200 text-red-700" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>
            {runResult.error ? `Error: ${runResult.error}` : `✅ Found ${runResult.matches_found} matches for ${selectedProfile?.org_name}`}
          </div>
        )}

        {profiles.length === 0 && !loading && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 mb-6 flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-medium text-yellow-800">No organization profile found</p>
              <p className="text-yellow-700 text-sm mt-1">Set up your org profile first so the matching agent can find relevant grants.</p>
              <Link to={createPageUrl("OrgProfileSetup")} className="text-yellow-800 underline text-sm font-medium mt-1 inline-block">Set up profile →</Link>
            </div>
          </div>
        )}

        {/* Filter */}
        <div className="flex items-center gap-4 mb-4">
          <span className="text-sm text-gray-600">Min score:</span>
          <input type="range" min={0} max={90} step={10} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-40 accent-emerald-600" />
          <span className="text-sm font-medium text-gray-700">{minScore}%+</span>
          <span className="text-sm text-gray-400 ml-auto">{filteredMatches.length} matches</span>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-3">
            {loading ? (
              <div className="text-center py-20 text-gray-400">Loading matches...</div>
            ) : filteredMatches.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-xl border border-gray-200 text-gray-400">
                <div className="text-5xl mb-4">🎯</div>
                <p className="font-medium">No matches yet</p>
                <p className="text-sm mt-1">Click "Run Matching" to score grants against your profile</p>
              </div>
            ) : (
              filteredMatches.map((match) => {
                const grant = grantMap[match.grant_id];
                return (
                  <div key={match.id}
                    onClick={() => setSelectedMatch(match)}
                    className={`bg-white rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md ${selectedMatch?.id === match.id ? "border-emerald-500 shadow-md" : "border-gray-200"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${scoreColor(match.relevance_score)}`}>
                            {match.relevance_score?.toFixed(0)}% match
                          </span>
                          {match.estimated_competition_level && (
                            <span className={`text-xs font-medium ${competitionColor[match.estimated_competition_level]}`}>
                              {match.estimated_competition_level} competition
                            </span>
                          )}
                        </div>
                        <h3 className="font-semibold text-gray-900 text-sm">
                          {grant?.title || match.grant_id}
                        </h3>
                        <p className="text-xs text-gray-500">{grant?.funder}</p>
                        {match.match_rationale && (
                          <p className="text-xs text-gray-600 mt-1.5 line-clamp-2">{match.match_rationale}</p>
                        )}
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-2">
                        {grant && (
                          <p className="text-sm font-semibold text-gray-700">
                            {grant.funding_amount_max ? `$${(grant.funding_amount_max / 1000).toFixed(0)}K` : "—"}
                          </p>
                        )}
                        <div className="flex gap-1">
                          <button onClick={(e) => { e.stopPropagation(); updateFeedback(match.id, "thumbs_up"); }}
                            className={`text-sm px-2 py-0.5 rounded ${match.user_feedback === "thumbs_up" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500 hover:bg-emerald-50"}`}>
                            👍
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); updateFeedback(match.id, "thumbs_down"); }}
                            className={`text-sm px-2 py-0.5 rounded ${match.user_feedback === "thumbs_down" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500 hover:bg-red-50"}`}>
                            👎
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Detail panel */}
          <div className="col-span-1">
            {selectedMatch ? (
              <div className="bg-white rounded-xl border border-gray-200 p-5 sticky top-4 space-y-4">
                <div className="flex justify-between items-start">
                  <span className={`text-sm font-bold px-3 py-1 rounded-full ${scoreColor(selectedMatch.relevance_score)}`}>
                    {selectedMatch.relevance_score?.toFixed(0)}% Match
                  </span>
                  <button onClick={() => setSelectedMatch(null)} className="text-gray-400 hover:text-gray-600">×</button>
                </div>

                {grantMap[selectedMatch.grant_id] && (
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm">{grantMap[selectedMatch.grant_id].title}</h3>
                    <p className="text-xs text-gray-500">{grantMap[selectedMatch.grant_id].funder}</p>
                  </div>
                )}

                {selectedMatch.strengths?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">Strengths</p>
                    <ul className="space-y-1">
                      {selectedMatch.strengths.map((s, i) => (
                        <li key={i} className="text-xs text-gray-700 flex gap-1.5"><span className="text-emerald-500">✓</span>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedMatch.concerns?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide mb-1">Concerns</p>
                    <ul className="space-y-1">
                      {selectedMatch.concerns.map((c, i) => (
                        <li key={i} className="text-xs text-gray-700 flex gap-1.5"><span className="text-orange-400">⚠</span>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedMatch.recommended_action && (
                  <div className="bg-blue-50 rounded-lg p-3">
                    <p className="text-xs font-semibold text-blue-700 mb-1">Recommended Action</p>
                    <p className="text-xs text-blue-800">{selectedMatch.recommended_action}</p>
                  </div>
                )}

                <Link to={createPageUrl("Applications")}
                  className="block w-full text-center bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">
                  Start Application →
                </Link>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-5 text-center text-gray-400">
                <div className="text-4xl mb-3">🎯</div>
                <p className="text-sm">Select a match to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
