import { useEffect, useState, useCallback, useRef } from "react";
import { Button, Card, Input } from "./ui";
import {
  cancelRenderJob,
  fetchRenderCapabilities,
  getRenderImageUrl,
  listRenderJobs,
  retryRenderJob,
  submitRenderJob,
  type RenderCapabilities,
  type RenderJobSummary,
  type RenderPreset,
} from "../lib/renderApi";
import { downloadBlob } from "../lib/download";

interface RenderStudioModalProps {
  projectId: string;
  sourceRevision: number;
  initialSourceImageBase64?: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function RenderStudioModal({
  projectId,
  sourceRevision,
  initialSourceImageBase64,
  isOpen,
  onClose,
}: RenderStudioModalProps) {
  const [capabilities, setCapabilities] = useState<RenderCapabilities | null>(null);
  const [jobs, setJobs] = useState<RenderJobSummary[]>([]);
  const [currentProjectRevision, setCurrentProjectRevision] = useState(sourceRevision);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<string>("photorealistic-daylight");
  const [sourceImageBase64, setSourceImageBase64] = useState<string | null>(initialSourceImageBase64 || null);
  const [selectedPreviewJob, setSelectedPreviewJob] = useState<RenderJobSummary | null>(null);

  const pollTimerRef = useRef<number | null>(null);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const [caps, jobData] = await Promise.all([
        fetchRenderCapabilities(projectId),
        listRenderJobs(projectId),
      ]);
      setCapabilities(caps);
      setJobs(jobData.jobs);
      setCurrentProjectRevision(jobData.project.revision);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load render studio data");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (isOpen) {
      void loadData();
      if (initialSourceImageBase64) {
        setSourceImageBase64(initialSourceImageBase64);
      }
    } else {
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
  }, [isOpen, loadData, initialSourceImageBase64]);

  // Polling while any job is active
  useEffect(() => {
    const hasActiveJob = jobs.some((j) => j.status === "queued" || j.status === "running");
    if (isOpen && hasActiveJob) {
      pollTimerRef.current = window.setTimeout(() => {
        void listRenderJobs(projectId).then((data) => {
          setJobs(data.jobs);
          setCurrentProjectRevision(data.project.revision);
        });
      }, 2500);
    }
    return () => {
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isOpen, jobs, projectId]);

  if (!isOpen) return null;

  const handleFileUpload = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 32 * 1024 * 1024) {
      setError("Source image exceeds 32 MiB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setSourceImageBase64(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError("Please describe the desired photorealistic architectural render.");
      return;
    }
    if (!sourceImageBase64) {
      setError("Please provide a source design image from the viewport or file upload.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const res = await submitRenderJob(projectId, {
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || undefined,
        stylePreset: selectedPreset,
        sourceRevision: currentProjectRevision,
        sourceImageBase64,
      });
      setPrompt("");
      setJobs((prev) => [res.job, ...prev]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = async (jobId: string) => {
    try {
      setError(null);
      const res = await retryRenderJob(projectId, jobId);
      setJobs((prev) => [res.job, ...prev]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Retry failed");
    }
  };

  const handleCancel = async (jobId: string) => {
    try {
      setError(null);
      const res = await cancelRenderJob(projectId, jobId);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? res.job : j)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Cancellation failed");
    }
  };

  const handleDownload = async (job: RenderJobSummary) => {
    try {
      const url = getRenderImageUrl(projectId, job.id, "output");
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Could not download rendered image");
      const blob = await resp.blob();
      downloadBlob(`render-rev${job.sourceRevision}-${job.id.slice(0, 8)}.png`, blob);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-900/50">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span>AI Photorealistic Render Studio</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Phase 9 Durable
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Generate non-destructive, versioned photorealistic architectural renders from your 3D design source.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 p-1.5 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300">
              {error}
            </div>
          )}

          {/* Provider Gating Notice */}
          {capabilities && (
            <div
              className={`rounded-xl border p-3.5 text-xs flex items-center justify-between ${
                capabilities.configured
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-300"
              }`}
            >
              <div>
                <span className="font-semibold uppercase tracking-wider mr-2">
                  Provider: {capabilities.provider} ({capabilities.model})
                </span>
                {capabilities.configured ? (
                  <span>Ready for photorealistic rendering</span>
                ) : (
                  <span>Configuration gated: {capabilities.unconfiguredReason}</span>
                )}
              </div>
              <span className="text-[11px] opacity-75">Project Rev {currentProjectRevision}</span>
            </div>
          )}

          {/* Submit New Render Form */}
          <Card className="p-4 border-slate-800 bg-slate-950/40 space-y-4">
            <h3 className="text-sm font-semibold text-slate-200">New Photorealistic Render Job</h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Source Viewport Thumbnail */}
              <div className="space-y-2">
                <label className="text-xs text-slate-400 font-medium">Source Image Snapshot</label>
                <div className="relative aspect-video rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-center overflow-hidden">
                  {sourceImageBase64 ? (
                    <img
                      src={sourceImageBase64}
                      alt="Source Snapshot"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xs text-slate-500">No source image provided</span>
                  )}
                  <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-slate-950/80 text-[10px] text-slate-300">
                    Bound Rev {currentProjectRevision}
                  </span>
                </div>
                <Input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    handleFileUpload(file);
                  }}
                  className="text-xs"
                />
              </div>

              {/* Style Presets and Prompts */}
              <div className="md:col-span-2 space-y-3">
                <div>
                  <label className="text-xs text-slate-400 font-medium block mb-1.5">Style Preset</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {capabilities?.presets.map((preset: RenderPreset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setSelectedPreset(preset.id)}
                        className={`text-left p-2 rounded-lg border text-xs transition ${
                          selectedPreset === preset.id
                            ? "border-indigo-500 bg-indigo-500/15 text-indigo-200 shadow-sm"
                            : "border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700"
                        }`}
                      >
                        <div className="font-medium text-slate-200">{preset.name}</div>
                        <div className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">
                          {preset.description}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-400 font-medium block mb-1">
                    Architectural Prompt & Lighting Instructions
                  </label>
                  <textarea
                    rows={2}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g. Modern glass curtain wall residence with timber louvers, landscaped reflecting pool, evening lights..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <input
                    type="text"
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    placeholder="Negative prompt (e.g. cartoon, blurry, distorted)"
                    className="w-2/3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-300 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                  />
                  <Button
                    onClick={handleSubmit}
                    disabled={submitting || !sourceImageBase64 || !prompt.trim()}
                    className="text-xs px-4"
                  >
                    {submitting ? "Submitting..." : "Submit Render Job"}
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          {/* Render History & Versioned Gallery */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">
                Render History & Outputs ({jobs.length})
              </h3>
              <Button variant="ghost" size="sm" onClick={() => void loadData()} disabled={loading}>
                Refresh
              </Button>
            </div>

            {jobs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-xs text-slate-500">
                No render jobs submitted yet for this project.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {jobs.map((job) => {
                  const isStale = job.sourceRevision !== currentProjectRevision;
                  return (
                    <Card
                      key={job.id}
                      className="p-3 border-slate-800 bg-slate-950/60 space-y-3 flex flex-col justify-between"
                    >
                      <div className="space-y-2">
                        {/* Status Header */}
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                              job.status === "succeeded"
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                                : job.status === "running"
                                ? "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 animate-pulse"
                                : job.status === "queued"
                                ? "bg-sky-500/15 text-sky-400 border border-sky-500/20"
                                : job.status === "unconfigured"
                                ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                                : "bg-rose-500/15 text-rose-400 border border-rose-500/20"
                            }`}
                          >
                            {job.status}
                          </span>

                          {/* Stale Revision Badge */}
                          {isStale ? (
                            <span
                              className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30"
                              title={`Rendered at project revision ${job.sourceRevision}, but project is now at revision ${currentProjectRevision}`}
                            >
                              Stale: Rev {job.sourceRevision} (Now Rev {currentProjectRevision})
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                              Current Rev {job.sourceRevision}
                            </span>
                          )}
                        </div>

                        {/* Image Preview */}
                        <div className="relative aspect-video rounded-lg overflow-hidden border border-slate-800 bg-slate-900 flex items-center justify-center">
                          {job.status === "succeeded" && job.outputArtifactId ? (
                            <img
                              src={getRenderImageUrl(projectId, job.id, "output")}
                              alt={job.prompt}
                              className="w-full h-full object-cover cursor-pointer hover:scale-105 transition duration-300"
                              onClick={() => setSelectedPreviewJob(job)}
                            />
                          ) : job.status === "running" ? (
                            <div className="text-center p-4 text-xs text-indigo-300">
                              <div className="inline-block animate-spin rounded-full h-5 w-5 border-2 border-indigo-500 border-t-transparent mb-2" />
                              <p>Synthesizing photorealistic output...</p>
                            </div>
                          ) : (
                            <img
                              src={getRenderImageUrl(projectId, job.id, "source")}
                              alt="Source thumbnail"
                              className="w-full h-full object-cover opacity-40 grayscale"
                            />
                          )}
                        </div>

                        {/* Prompt & Details */}
                        <div>
                          <p className="text-xs font-medium text-slate-200 line-clamp-2">{job.prompt}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] text-slate-400">
                            <span>Preset: {job.stylePreset || "default"}</span>
                            <span>·</span>
                            <span>Model: {job.model}</span>
                            <span>·</span>
                            <span>{new Date(job.createdAt * 1000).toLocaleTimeString()}</span>
                          </div>
                          {job.errorMessage && (
                            <p className="text-[11px] text-rose-400 mt-1">{job.errorMessage}</p>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 text-xs">
                        {job.status === "succeeded" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleDownload(job)}
                            className="text-xs h-7"
                          >
                            Export PNG
                          </Button>
                        )}
                        {(job.status === "queued" || job.status === "running") && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => void handleCancel(job.id)}
                            className="text-xs h-7"
                          >
                            Cancel
                          </Button>
                        )}
                        {(job.status === "failed" || job.status === "cancelled" || job.status === "unconfigured") && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleRetry(job.id)}
                            className="text-xs h-7"
                          >
                            Retry
                          </Button>
                        )}
                        <span className="text-[10px] text-slate-500 font-mono">
                          ID: {job.id.slice(0, 8)}
                        </span>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox Preview Modal */}
      {selectedPreviewJob && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setSelectedPreviewJob(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
            <img
              src={getRenderImageUrl(projectId, selectedPreviewJob.id, "output")}
              alt={selectedPreviewJob.prompt}
              className="max-h-[80vh] w-auto rounded-xl shadow-2xl border border-slate-700 object-contain"
            />
            <div className="mt-3 flex items-center justify-between w-full px-2 text-xs text-slate-300">
              <span className="truncate max-w-md">{selectedPreviewJob.prompt}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDownload(selectedPreviewJob);
                }}
              >
                Download Full PNG
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
