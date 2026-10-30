
import { useEffect, useState } from "react";

type Stint = {
    stint: number;
    compound: string;
    start_lap: number;
    end_lap: number;
    laps: number;
};

type AdvisorResult = {
    verdict: string;
    reason: string;
    original_pit_laps: number[];
    recommended_pit_laps: number[];
    potential_gain_seconds: number;
    change_recommended: boolean;
    recommended_stints: Stint[];
    confidence: string;
    evaluated_candidates: number;
    limitations: string[];
};

export default function StrategyAdvisor({
    file,
}: {
    file: File | null;
}) {
    const [result, setResult] = useState<AdvisorResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!file) {
            setResult(null);
            setError("");
            return;
        }

        const controller = new AbortController();

        async function analyze() {
            setLoading(true);
            setError("");
            setResult(null);

            try {
                const formData = new FormData();
                formData.append("file", file!);

                const response = await fetch("/api/strategy/optimize", {
                    method: "POST",
                    body: formData,
                    signal: controller.signal,
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.detail || "Strategy analysis failed.");
                }

                if (!controller.signal.aborted) {
                    setResult(data);
                }
            } catch (err) {
                if (!controller.signal.aborted) {
                    setError(
                        err instanceof Error ? err.message : "Unknown error"
                    );
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            }
        }

        analyze();
        return () => controller.abort();
    }, [file]);

    return (
        <section className="rounded-2xl border border-white/10 bg-slate-900 p-6 text-white">
            <div className="mb-4">
                <p className="text-sm font-semibold uppercase tracking-widest text-red-400">
                    Laplogic Strategy Advisor
                </p>
                <h2 className="mt-2 text-2xl font-bold">
                    Automatic Race Strategy Optimization
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                    Estimates improved pit windows from uploaded race data.
                </p>
            </div>

            {!file && (
                <p className="text-slate-400">
                    Upload a race CSV to generate a strategy recommendation.
                </p>
            )}

            {loading && (
                <p className="text-slate-300">
                    Analyzing lap pace, stint lengths and pit windows...
                </p>
            )}

            {error && (
                <p className="rounded-lg bg-red-950 p-3 text-red-300">
                    {error}
                </p>
            )}

            {result && (
                <div className="space-y-5">
                    <div className="rounded-xl bg-slate-800 p-4">
                        <p className="text-sm text-slate-400">
                            Laplogic Recommendation
                        </p>
                        <h3 className="mt-1 text-xl font-bold">
                            {result.verdict}
                        </h3>
                        <p className="mt-2 text-sm text-slate-300">
                            {result.reason}
                        </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg bg-slate-800 p-4">
                            <p className="text-xs text-slate-400">
                                Recorded Pit Laps
                            </p>
                            <p className="mt-1 text-xl font-bold">
                                {result.original_pit_laps.join(", ")}
                            </p>
                        </div>
                        <div className="rounded-lg bg-slate-800 p-4">
                            <p className="text-xs text-slate-400">
                                Suggested Pit Laps
                            </p>
                            <p className="mt-1 text-xl font-bold text-green-400">
                                {result.recommended_pit_laps.join(", ")}
                            </p>
                        </div>
                    </div>

                    <div className="rounded-xl border border-green-700/40 bg-green-950/30 p-4">
                        <p className="text-sm text-green-300">
                            Estimated Time Improvement
                        </p>
                        <p className="mt-1 text-3xl font-bold text-green-400">
                            {result.potential_gain_seconds.toFixed(2)}s
                        </p>
                        <p className="mt-2 text-xs text-slate-400">
                            Experimental prediction, not a guaranteed lap-time gain.
                        </p>
                    </div>

                    <div>
                        <h3 className="mb-3 font-semibold">
                            Recommended Stints
                        </h3>

                        <div className="space-y-2">
                            {result.recommended_stints.map((stint) => (
                                <div
                                    key={stint.stint}
                                    className="flex items-center justify-between rounded-lg bg-slate-800 p-3"
                                >
                                    <div>
                                        <p className="font-medium">
                                            Stint {stint.stint} · {stint.compound}
                                        </p>
                                        <p className="text-xs text-slate-400">
                                            Laps {stint.start_lap}–{stint.end_lap}
                                        </p>
                                    </div>

                                    <span className="text-sm font-semibold">
                                        {stint.laps} laps
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <p className="text-xs text-slate-500">
                        Compared {result.evaluated_candidates} supported pit-window
                        combinations. Confidence: {result.confidence}.
                        {result.limitations.join(" ")}
                    </p>
                </div>
            )}
        </section>
    );
}
