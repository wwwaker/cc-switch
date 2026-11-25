import type { ComponentProps, ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render as rtlRender,
  screen,
  within,
} from "@testing-library/react";
import {
  createTestQueryClient,
  renderWithQueryClient as render,
} from "../utils/testQueryClient";
import { describe, expect, it, vi } from "vitest";
import { UsageTrendChart } from "@/components/usage/UsageTrendChart";

vi.mock("recharts", async (importOriginal) => {
  const recharts = await importOriginal<typeof import("recharts")>();
  return {
    ...recharts,
    // jsdom has no layout; keep the actual charts with fixed dimensions.
    AreaChart: (props: ComponentProps<typeof recharts.AreaChart>) => (
      <recharts.AreaChart
        {...props}
        responsive={false}
        width={640}
        height={132}
      />
    ),
    BarChart: (props: ComponentProps<typeof recharts.BarChart>) => (
      <recharts.BarChart
        {...props}
        responsive={false}
        width={640}
        height={132}
      />
    ),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "en", language: "en" },
  }),
}));

vi.mock("@/lib/query/usage", () => ({
  useUsageTrends: (
    _range: unknown,
    _filters: unknown,
    options: { byModel: boolean },
  ) => ({
    data: [
      {
        date: "2026-09-30T00:00:00Z",
        requestCount: 12,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        totalCost: "0.01",
        modelCosts: options.byModel
          ? { "model-a": 0.007, "model-b": 0.003 }
          : undefined,
      },
    ],
    isLoading: false,
  }),
}));

describe("UsageTrendChart (single metric)", () => {
  it("titles the chart with the metric picked on the metric strip", () => {
    const { rerender } = render(
      <UsageTrendChart
        range={{ preset: "7d" }}
        metric="tokens"
        refreshIntervalMs={0}
      />,
    );
    // 图表自己不再有指标切换和单系列图例：指标由上方指标条选
    expect(
      screen.getByRole("heading", { name: "usage.trend.titleMetric" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("usage-trend-legend")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "usage.trend.cost" }),
    ).not.toBeInTheDocument();

    rerender(
      <UsageTrendChart
        range={{ preset: "7d" }}
        metric="hitRate"
        refreshIntervalMs={0}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "usage.trend.titleMetric" }),
    ).toBeInTheDocument();
  });
});

describe("UsageTrendChart styles", () => {
  // 样式在用量「设置」里选，存在 settings.usageDisplay.trendChartType
  const renderWithChartType = (
    trendChartType?: string,
    metric: "cost" | "requests" | "tokens" | "hitRate" = "tokens",
  ) => {
    const props = {
      range: { preset: "7d" as const },
      metric,
      refreshIntervalMs: 0,
    };
    const client = createTestQueryClient();
    // 不让挂载时的重新拉取用 mock 后端的默认设置覆盖掉这里给的值
    client.setDefaultOptions({
      queries: { retry: false, staleTime: Infinity },
    });
    client.setQueryData(["settings"], { usageDisplay: { trendChartType } });
    return rtlRender(<UsageTrendChart {...props} />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
  };

  it("draws a bar chart by default without a style switch on the chart", () => {
    const { container } = renderWithChartType(undefined);
    expect(container.querySelector(".recharts-bar-rectangle")).not.toBeNull();
    expect(container.querySelector(".recharts-area")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "usage.display.trendChartTypes.area",
      }),
    ).not.toBeInTheDocument();
  });

  it.each(["bar", "area"])(
    "draws cost by model in the %s chart and previews each model on hover",
    async (chartType) => {
      const { container } = renderWithChartType(chartType, "cost");
      const series = () =>
        container.querySelectorAll(
          chartType === "bar" ? ".recharts-bar-rectangle" : ".recharts-area",
        );
      expect(series()).toHaveLength(1);

      const byModel = screen.getByRole("button", {
        name: "usage.trend.byModel",
      });
      fireEvent.click(byModel);
      expect(byModel).toHaveAttribute("aria-pressed", "true");
      expect(series()).toHaveLength(2);
      expect(screen.getByRole("list")).toHaveTextContent("model-a");

      const wrapper =
        container.querySelector<HTMLDivElement>(".recharts-wrapper")!;
      Object.defineProperties(wrapper, {
        offsetWidth: { value: 640 },
        offsetHeight: { value: 132 },
      });
      vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
        width: 640,
        height: 132,
        left: 0,
        top: 0,
        x: 0,
        y: 0,
        bottom: 132,
        right: 640,
        toJSON: () => ({}),
      });
      const point = container.querySelector(".recharts-area-dot");
      if (chartType === "area") {
        const dots = container.querySelectorAll(".recharts-area-dot");
        expect(dots).toHaveLength(2);
        // In series order, the first model has the larger cost and thus the smaller y coordinate.
        expect(Number(dots[0].getAttribute("cy"))).toBeLessThan(
          Number(dots[1].getAttribute("cy")),
        );
      }
      fireEvent.mouseMove(wrapper, {
        clientX: point ? Number(point.getAttribute("cx")) : 330,
        clientY: 70,
      });
      const tooltip = within(
        container.querySelector<HTMLElement>(".recharts-tooltip-wrapper")!,
      );
      expect(await tooltip.findByText("usage.trend.total")).toBeVisible();
      expect(tooltip.getByText("$0.0100")).toBeVisible();
      expect(tooltip.getByText("model-a")).toBeVisible();
      expect(tooltip.getByText("$0.0070")).toBeVisible();
      expect(tooltip.getByText("model-b")).toBeVisible();
      expect(tooltip.getByText("$0.0030")).toBeVisible();

      fireEvent.click(
        screen.getByRole("button", { name: "usage.trend.total" }),
      );
      expect(series()).toHaveLength(1);
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
    },
  );

  it.each(["tokens", "requests", "cost", "hitRate"] as const)(
    "draws the saved area style for the %s metric",
    (metric) => {
      const { container } = renderWithChartType("area", metric);
      expect(container.querySelector(".recharts-area")).not.toBeNull();
      const byModel = screen.queryByRole("button", {
        name: "usage.trend.byModel",
      });
      if (metric === "cost") {
        expect(byModel).toBeInTheDocument();
      } else {
        expect(byModel).not.toBeInTheDocument();
      }
      // A one-bucket range must still show a point in area mode.
      expect(container.querySelector(".recharts-area-dot")).not.toBeNull();
      expect(container.querySelector(".recharts-bar-rectangle")).toBeNull();
    },
  );

  it("falls back to a bar chart for an unknown saved style", () => {
    const { container } = renderWithChartType("unknown");
    expect(container.querySelector(".recharts-bar-rectangle")).not.toBeNull();
    expect(container.querySelector(".recharts-area")).toBeNull();
  });
});
