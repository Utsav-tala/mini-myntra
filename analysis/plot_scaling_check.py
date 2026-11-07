"""Plots the Phase 2 scaling check: response time against instance count.

    python analysis/plot_scaling_check.py docs/results/P2-scaling-check

Reads cloudwatch-per-minute.csv (server side, measured at the load balancer)
and k6-per-minute.csv (client side, measured from the laptop running k6) and
writes two PNGs into the same folder:

  scaling-timeline.png   instances, CPU and p95 response time over the test
  p95-vs-instances.png   p95 response time at peak load, 1 vs 4 instances
"""

import csv
import sys
from datetime import datetime
from pathlib import Path
from statistics import mean

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402

# Reference palette (light mode): one accent, a second hue only where two
# series share a panel, greys for structure.
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_2 = "#52514e"
GRID = "#e4e3df"
BLUE = "#2a78d6"
ORANGE = "#eb6834"
REFERENCE = "#8a8984"

# Minutes at peak load (about 38,000 requests per minute), by instance count.
PEAK_1_INSTANCE = ("01:18", "01:21")
PEAK_4_INSTANCES = ("01:23", "01:26")


def read(path, time_col):
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["t"] = datetime.fromisoformat(r[time_col])
    return rows


def num(v):
    return float(v) if v not in ("", None) else None


def in_window(r, window):
    hm = r["t"].strftime("%H:%M")
    return window[0] <= hm <= window[1]


def style(ax):
    ax.set_facecolor(SURFACE)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=INK_2, labelsize=9)


def timeline(cw, k6, out):
    fig, axes = plt.subplots(3, 1, figsize=(10, 8.2), sharex=True,
                             gridspec_kw={"height_ratios": [1, 1, 1.5]})
    fig.patch.set_facecolor(SURFACE)
    t = [r["t"] for r in cw]

    peak_start = next(r["t"] for r in cw if r["t"].strftime("%H:%M") == "01:17")
    peak_end = next(r["t"] for r in cw if r["t"].strftime("%H:%M") == "01:27")
    for ax in axes:
        style(ax)
        ax.axvspan(peak_start, peak_end, color=GRID, alpha=0.5, linewidth=0)

    ax = axes[0]
    ax.step(t, [num(r["instances_in_service"]) for r in cw], where="post", color=BLUE, linewidth=2)
    ax.set_ylim(0, 4.6)
    ax.set_yticks([0, 1, 2, 3, 4])
    ax.set_ylabel("Instances\nin service", color=INK_2, fontsize=9)
    ax.text(peak_start, 4.25, " Sale peak (400 users)", color=INK_2, fontsize=9, va="center")

    ax = axes[1]
    ax.plot(t, [num(r["cpu_pct"]) for r in cw], color=BLUE, linewidth=2)
    ax.axhline(50, color=REFERENCE, linewidth=1, linestyle="--")
    ax.text(t[-1], 53, "Scaling target 50% ", color=INK_2, fontsize=9, ha="right", va="bottom")
    ax.set_ylim(0, 100)
    ax.set_ylabel("Average CPU\n(%)", color=INK_2, fontsize=9)

    ax = axes[2]
    kt = [r["t"] for r in k6]
    ax.plot(kt, [num(r["p95_ms"]) for r in k6], color=ORANGE, linewidth=2,
            label="Client side (laptop, includes internet)")
    ax.plot(t, [num(r["p95_ms"]) for r in cw], color=BLUE, linewidth=2,
            label="Server side (load balancer)")
    ax.set_ylim(0, 560)
    ax.set_ylabel("p95 response time\n(ms)", color=INK_2, fontsize=9)
    leg = ax.legend(loc="upper right", frameon=False, fontsize=9)
    for txt in leg.get_texts():
        txt.set_color(INK)

    axes[2].xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
    axes[2].set_xlabel("Time (IST), 8 Nov 2026", color=INK_2, fontsize=9)

    fig.suptitle("Adding 3 instances cut server p95 from about 155 ms to under 50 ms",
                 x=0.07, y=0.985, ha="left", fontsize=13, color=INK, fontweight="bold")
    fig.text(0.07, 0.945, "Phase 2 scaling check: 1 to 4 t3.micro instances, CPU target tracking at 50%",
             ha="left", fontsize=10, color=INK_2)
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    fig.savefig(out, dpi=150, facecolor=SURFACE)
    plt.close(fig)


def bars(cw, out):
    one = [num(r["p95_ms"]) for r in cw if in_window(r, PEAK_1_INSTANCE)]
    four = [num(r["p95_ms"]) for r in cw if in_window(r, PEAK_4_INSTANCES)]
    rpm_one = mean(num(r["requests_per_min"]) for r in cw if in_window(r, PEAK_1_INSTANCE))
    rpm_four = mean(num(r["requests_per_min"]) for r in cw if in_window(r, PEAK_4_INSTANCES))
    values = [mean(one), mean(four)]

    fig, ax = plt.subplots(figsize=(6.4, 4.4))
    fig.patch.set_facecolor(SURFACE)
    style(ax)
    labels = [f"1 instance\n({rpm_one / 1000:.1f}k req/min)", f"4 instances\n({rpm_four / 1000:.1f}k req/min)"]
    ax.bar(labels, values, color=[REFERENCE, BLUE], width=0.5)
    for i, v in enumerate(values):
        ax.text(i, v + 4, f"{v:.0f} ms", ha="center", va="bottom", color=INK, fontsize=11)
    ax.set_ylim(0, max(values) * 1.2)
    ax.set_ylabel("Server p95 response time (ms)", color=INK_2, fontsize=9)
    fig.suptitle(f"p95 fell {values[0] / values[1]:.1f}x with 4 instances at the same load",
                 x=0.04, y=0.98, ha="left", fontsize=12, color=INK, fontweight="bold")
    fig.text(0.04, 0.905, "Mean of per-minute p95 at the load balancer, peak minutes only",
             ha="left", fontsize=9, color=INK_2)
    fig.tight_layout(rect=(0, 0, 1, 0.89))
    fig.savefig(out, dpi=150, facecolor=SURFACE)
    plt.close(fig)
    return values, rpm_one, rpm_four


def main():
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/results/P2-scaling-check")
    cw = read(folder / "cloudwatch-per-minute.csv", "ist_minute")
    k6 = read(folder / "k6-per-minute.csv", "ist_minute")
    timeline(cw, k6, folder / "scaling-timeline.png")
    values, rpm_one, rpm_four = bars(cw, folder / "p95-vs-instances.png")
    print(f"p95 at peak: 1 instance {values[0]:.1f} ms ({rpm_one:.0f} req/min), "
          f"4 instances {values[1]:.1f} ms ({rpm_four:.0f} req/min)")


if __name__ == "__main__":
    main()
