import type { PropsWithChildren } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usageApi } from "@/lib/api/usage";
import { useUsageTrends } from "@/lib/query/usage";
import type { DailyStats, UsageScopeFilters } from "@/types/usage";
import { createTestQueryClient } from "../utils/testQueryClient";

afterEach(() => vi.restoreAllMocks());

it("loads the selected app, provider and model without showing the previous scope", async () => {
  const row: DailyStats = {
    date: "2026-06-10T12:00:00Z",
    requestCount: 1,
    totalCost: "5.000000",
    totalTokens: 12,
    totalInputTokens: 10,
    totalOutputTokens: 2,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    modelCosts: { "selected-model": 5 },
  };
  let resolveFiltered: (data: DailyStats[]) => void = () => {};
  const filtered = new Promise<DailyStats[]>((resolve) => {
    resolveFiltered = resolve;
  });
  const request = vi
    .spyOn(usageApi, "getUsageTrends")
    .mockResolvedValueOnce([row])
    .mockReturnValueOnce(filtered);
  const client = createTestQueryClient();
  const range = {
    preset: "custom",
    customStartDate: 100,
    customEndDate: 200,
  } as const;
  const { result, rerender } = renderHook(
    (scope: UsageScopeFilters) =>
      useUsageTrends(range, scope, { byModel: true, refetchInterval: false }),
    {
      initialProps: { appType: "all" } as UsageScopeFilters,
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(result.current.data).toEqual([row]));
  expect(request).toHaveBeenNthCalledWith(
    1,
    100,
    200,
    undefined,
    undefined,
    undefined,
    true,
  );

  rerender({
    appType: "claude",
    providerName: "Target",
    model: "selected-model",
  });
  await waitFor(() => expect(result.current.isLoading).toBe(true));
  expect(result.current.data).toBeUndefined();
  expect(request).toHaveBeenNthCalledWith(
    2,
    100,
    200,
    "claude",
    "Target",
    "selected-model",
    true,
  );

  const matching = {
    ...row,
    totalCost: "2.000000",
    modelCosts: { "selected-model": 2 },
  };
  resolveFiltered([matching]);
  await waitFor(() => expect(result.current.data).toEqual([matching]));
});
