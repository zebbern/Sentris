import type { ArtifactMetadata } from '@sentris/shared';
import { getArtifactPreviewEligibility } from '@/hooks/queries/useArtifactQueries';

export interface RunReportMetric {
  label: string;
  value: string;
}

export interface ActionableRunReportSummary {
  metrics: RunReportMetric[];
  notice: string | null;
  nextSteps: string[];
}

const MAX_METRICS = 4;
const MAX_ACTIONS = 2;
const MAX_METRIC_VALUE_LENGTH = 80;

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function humanizeLabel(label: string): string {
  const words = label
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();

  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : label;
}

function firstString(values: unknown): string | null {
  if (!Array.isArray(values)) return null;

  return values.find((value): value is string => typeof value === 'string') ?? null;
}

function stringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];

  return values.filter((value): value is string => typeof value === 'string').slice(0, MAX_ACTIONS);
}

function firstNotice(root: JsonObject, envelope: JsonObject): string | null {
  return (
    firstString(root.warnings) ??
    firstString(envelope.warnings) ??
    firstString(root.recommendations) ??
    firstString(envelope.recommendations)
  );
}

function nextSteps(root: JsonObject, envelope: JsonObject): string[] {
  const rootSteps = stringList(root.nextSteps);
  if (rootSteps.length > 0) return rootSteps;

  return stringList(envelope.nextSteps);
}

export function selectReportArtifact(artifacts: ArtifactMetadata[]): ArtifactMetadata | undefined {
  let selected: ArtifactMetadata | undefined;
  let highestScore = -1;

  for (const artifact of artifacts) {
    if (getArtifactPreviewEligibility(artifact) !== 'previewable') continue;

    let score = 0;
    score += artifact.componentRef === 'core.artifact.writer' ? 100 : 0;
    score += /application\/(?:[^;]+\+)?json/i.test(artifact.mimeType) ? 50 : 0;
    score += /(report|brief|result|triage|finding)/i.test(artifact.name) ? 20 : 0;

    if (score > highestScore) {
      selected = artifact;
      highestScore = score;
    }
  }

  return selected;
}

export function extractRunReportSummary(content: string): ActionableRunReportSummary | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (!isJsonObject(parsed)) return null;

  const root = parsed;
  const envelope = isJsonObject(root.report)
    ? root.report
    : isJsonObject(root.brief)
      ? root.brief
      : root;
  const metricSource = isJsonObject(envelope.summary) ? envelope.summary : envelope;
  const metrics = Object.entries(metricSource)
    .filter(([, value]) => value !== null && !Array.isArray(value) && typeof value !== 'object')
    .slice(0, MAX_METRICS)
    .map(([label, value]) => ({
      label: humanizeLabel(label),
      value: typeof value === 'string' ? value.slice(0, MAX_METRIC_VALUE_LENGTH) : String(value),
    }));

  return {
    metrics,
    notice: firstNotice(root, envelope),
    nextSteps: nextSteps(root, envelope),
  };
}
