const MAX_INDIVIDUAL_MODELS = 8;

type CostPoint = { xKey: string; modelCosts?: Record<string, number> };

type ModelCostSeries = {
  // null denotes the aggregate series. An empty model ID is a real bucket.
  model: string | null;
  key: string;
  color: string;
  cost: (point: CostPoint) => number;
};

function modelColor(model: string): string {
  // FNV-1a keeps colors independent of rank, chart style and query scope.
  let hash = 2166136261;
  for (let i = 0; i < model.length; i++) {
    hash = Math.imul(hash ^ model.charCodeAt(i), 16777619);
  }
  return `hsl(${(hash >>> 0) % 360} 65% var(--chart-model-lightness))`;
}

export function buildModelCostSeries(points: CostPoint[]): ModelCostSeries[] {
  const totals = new Map<string, number>();
  for (const point of points) {
    for (const [model, cost] of Object.entries(point.modelCosts ?? {})) {
      totals.set(model, (totals.get(model) ?? 0) + Math.abs(cost));
    }
  }
  const ranked = [...totals]
    .filter(([, cost]) => cost > 0)
    .sort(([a, aCost], [b, bCost]) => bCost - aCost || a.localeCompare(b));
  const top = ranked.slice(0, MAX_INDIVIDUAL_MODELS);
  const series: ModelCostSeries[] = top.map(([model]) => ({
    model,
    key: `model:${model}`,
    color: modelColor(model),
    cost: ({ modelCosts }) =>
      modelCosts && Object.prototype.hasOwnProperty.call(modelCosts, model)
        ? modelCosts[model]
        : 0,
  }));

  if (ranked.length > top.length) {
    const topModels = new Set(top.map(([model]) => model));
    const otherCosts = new Map<string, number>();
    for (const { xKey, modelCosts } of points) {
      let total = 0;
      for (const [model, cost] of Object.entries(modelCosts ?? {})) {
        if (!topModels.has(model)) total += cost;
      }
      otherCosts.set(xKey, total);
    }
    series.push({
      model: null,
      key: "other",
      color: "var(--text-3)",
      cost: ({ xKey }) => otherCosts.get(xKey) ?? 0,
    });
  }
  return series;
}
